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

/* ── SPEC-948 · aritmetika linimasa ───────────────────────────────────────────────────────────
   Nol React, nol I/O, dan `today` SELALU argumen: fungsi yang membaca jam sistem sendiri hanya
   bisa diuji dengan membekukan waktu global, dan membekukan `Date.now` di repo ini sudah pernah
   menjatuhkan test lain. */

const DAY = 86_400_000;

/** Awal hari **UTC**. UTC di kedua sisi karena `dateInputToIso` menulis tengah hari UTC: menghitung
    dengan awal hari LOKAL berarti membandingkan tengah hari dengan tengah malam, dan selisih 12
    jam itu cukup untuk menggeser batang setengah sel di zoom hari. */
const dayStart = (ms: number): number => Math.floor(ms / DAY) * DAY;

/** `new Date("besok").getTime()` adalah `NaN`, dan satu `NaN` yang lolos ke `Math.min` jendela
    membuat SELURUH kanvas kosong tanpa satu pun galat. Disaring di satu pintu masuk. */
const stamp = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
};

export type TaskSpan = { start: number; end: number; invalid: boolean };

/**
 * Dua tanggal menjadi satu rentang setengah terbuka `[start, end)` dalam epoch ms.
 *
 * Akhir **inklusif**: task yang mulai dan selesai di hari yang sama punya `end - start === DAY`,
 * bukan 0. Ini kesalahan Gantt paling senyap — batang selebar nol tak terlihat sama sekali, jadi
 * kartunya seolah tak bertanggal padahal bertanggal.
 *
 * `null` HANYA untuk "tak punya tanggal sah sama sekali" — satu-satunya arti "belum dijadwalkan".
 * Satu tanggal saja tetap terjadwal (batang 1 hari): kartu ber-`dueDate` saja adalah tenggat, dan
 * tenggat justru yang dicari linimasa. `taskDates` di bawah sudah merender rentang setengah terisi
 * sejak SPEC-946; menyembunyikannya di sini membuat dua permukaan berselisih tentang apa artinya
 * "punya tanggal".
 *
 * Tenggat yang mendahului mulai **digambar**, tidak ditukar: `zCreateTask` tak memaksa
 * `due >= start` dan `TaskModal` tak memvalidasinya, jadi keadaan ini bisa ada di DB. Menukarnya
 * diam-diam membuat layar menampilkan rencana yang tak pernah diketik siapa pun; menolak
 * menggambarnya membuat kartunya lenyap tanpa sebab. `invalid` yang membuat barisnya mengaku.
 */
export function taskSpan(task: Pick<TaskView, "startDate" | "dueDate">): TaskSpan | null {
  const a = stamp(task.startDate);
  const b = stamp(task.dueDate);
  if (a === null && b === null) return null;
  const lo = a ?? b!;
  const hi = b ?? a!;
  return {
    start: dayStart(Math.min(lo, hi)),
    end: dayStart(Math.max(lo, hi)) + DAY,
    invalid: hi < lo,
  };
}

const DATE_FMT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const shortDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null);

/** Rentang yang boleh setengah terisi. Tanpa tanggal tak merender barisnya sama sekali — "—"
    adalah ruang yang terpakai untuk mengatakan "tidak ada". Dipindah ke sini dari `team-board.tsx`
    (SPEC-948) supaya kanvas linimasa memakainya tanpa mengimpor papan. */
export function taskDates(t: Pick<TaskView, "startDate" | "dueDate">): string | null {
  const a = shortDate(t.startDate);
  const b = shortDate(t.dueDate);
  if (a && b) return `${a} → ${b}`;
  if (b) return `→ ${b}`;
  return a;
}
