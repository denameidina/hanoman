import { TASK_STATUSES, type TaskStatus, type TaskView } from "@hanoman/shared";

// SPEC-946 · aturan papan tim sebagai fungsi MURNI: nol React, nol I/O, jadi ia bisa diuji tanpa
// jsdom dan tak bisa diam-diam menumbuhkan state. Dipisah karena `from`/`to` yang tertukar LOLOS
// dari unit test aturannya sendiri — yang menangkapnya render test yang men-drag kartu sungguhan
// (`src/test/team-board.test.tsx`), dan itu hanya bisa ditulis kalau aturannya punya nama.

/** Label kolom. `Record<TaskStatus, …>` supaya status baru = galat kompilasi, bukan kolom tanpa
    judul. Kolomnya lahir dari `TASK_STATUSES`, BUKAN daftar literal baru: `COLUMNS` milik
    `BacklogScreen` sudah jadi cermin kedua, dan yang ketiga akan drift. */
const COLUMN_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog", doing: "Dikerjakan", review: "Review", done: "Selesai",
};

export const TEAM_COLUMNS: { key: TaskStatus; label: string }[] =
  TASK_STATUSES.map((key) => ({ key, label: COLUMN_LABEL[key] }));

export type Board = Record<TaskStatus, TaskView[]>;

export const emptyBoard = (): Board =>
  Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as TaskView[]])) as Board;

/**
 * Berbeda dari `canDrop` board Backlog, yang MENYEMPIT karena `Spec.stage` diturunkan dari fase
 * sesi (ADR-0008/0024) dan UI yang menulisnya membuat `executing`/`done` tercapai tanpa sesi yang
 * benar-benar berjalan. `Task.status` milik manusia, jadi keempat kolom saling menerima.
 *
 * Yang tersisa satu larangan: drop ke kolom asal bukan perpindahan. Menerimanya berarti satu PATCH
 * yang menulis nilai yang sudah ada, satu baris `SyncLog`, dan satu siaran ke tiap device — biaya
 * baris yang lahir tanpa pembaca sudah terukur di ADR-0131.
 */
export const canDropTask = (from: TaskStatus, to: TaskStatus): boolean => from !== to;

/** `order` bagi kartu yang mendarat di UJUNG kolom tujuan. Kolom kosong mulai dari 0.
    Kasus kosong dipisah, bukan diserap seed `-1`: seed itu membuat kolom yang seluruh
    `order`-nya negatif menjawab `0` — kartunya mendarat di ATAS, bukan di ujung. */
export const nextOrder = (items: { order: number }[]): number =>
  items.length === 0 ? 0 : items.reduce((max, t) => (t.order > max ? t.order : max), -Infinity) + 1;

/**
 * Pemindahan OPTIMISTIS. Mengembalikan papan baru berikut muatan PATCH-nya — keduanya lahir dari
 * satu fungsi supaya `order` yang ditampilkan dan yang disimpan tak bisa berselisih.
 *
 * `null` = tak ada yang berubah (tujuannya kolomnya sendiri, atau kartunya tak ada di kolom asal).
 */
export function moveCard(board: Board, id: string, from: TaskStatus, to: TaskStatus):
  { board: Board; patch: { status: TaskStatus; order: number } } | null {
  if (!canDropTask(from, to)) return null;
  const card = board[from].find((t) => t.id === id);
  if (!card) return null;
  const patch = { status: to, order: nextOrder(board[to]) };
  const next: Board = { ...board };
  next[from] = board[from].filter((t) => t.id !== id);
  next[to] = [...board[to], { ...card, ...patch }];
  return { board: next, patch };
}

/** Mengganti satu kartu di tempatnya — dipakai mutasi yang TIDAK memindahkan kolom (assignee). */
export function replaceCard(board: Board, task: TaskView): Board {
  const next: Board = { ...board };
  next[task.status] = board[task.status].map((t) => (t.id === task.id ? task : t));
  return next;
}

/**
 * `<input type="date">` memancarkan `YYYY-MM-DD`, sedangkan `zCreateTask` menuntut ISO 8601
 * BER-OFFSET (`z.string().datetime({ offset: true })`) — mengirim nilai input apa adanya dijawab
 * `400` oleh route. Konversinya duduk di SATU tempat; dua salinan adalah cara keduanya mulai
 * berbeda.
 */
export const dateInputValue = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

/** Tengah hari UTC, bukan tengah malam: `T00:00:00Z` mundur ke tanggal sebelumnya di zona waktu
    barat, dan tanggal yang bergeser sehari saat dibaca kembali adalah bug yang tak memunculkan
    satu pun error. */
export const dateInputToIso = (v: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00.000Z` : null;
