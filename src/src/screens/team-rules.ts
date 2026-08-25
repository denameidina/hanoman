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

export const TIMELINE_ZOOMS = ["day", "week", "month"] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

/** Lebar sel & panjang sumbu minimum per zoom. Minimum ada supaya papan yang seluruh tugasnya
    jatuh di satu minggu tetap punya sumbu yang bisa dibaca, bukan satu sel selebar layar. */
const ZOOM: Record<TimelineZoom, { cell: number; minTicks: number }> = {
  day: { cell: 34, minTicks: 14 },
  week: { cell: 56, minTicks: 8 },
  month: { cell: 84, minTicks: 6 },
};
export const zoomCell = (zoom: TimelineZoom): number => ZOOM[zoom].cell;

/**
 * Plafon jumlah sel header. Tanpa ini satu task bertanggal 2031 di zoom hari melahirkan ±2 000 sel
 * dan kanvas selebar 70 000 px. Task yang lalu jatuh di luar jendela **didaftar** di bawah kanvas
 * (`timelineRows`) — plafon yang menghilangkan baris tanpa jejak adalah kelas bug yang sudah
 * dijawab ADR-0151 dengan "menampilkan N dari M".
 */
export const MAX_TICKS = 120;

export type TimelineTick = { start: number; label: string; major: boolean };
export type TimelineWindow = {
  from: number; to: number; zoom: TimelineZoom; ticks: TimelineTick[];
};

/** Awal satuan zoom yang MEMUAT `ms`. Minggu mulai **Senin** (ISO, dan konvensi kerja di sini);
    `getUTCDay()` memberi 0 untuk Minggu, jadi pergeserannya `(hari + 6) % 7`. */
const unitStart = (ms: number, zoom: TimelineZoom): number => {
  const d = dayStart(ms);
  if (zoom === "day") return d;
  if (zoom === "week") return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY;
  const t = new Date(d);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
};

/** Satuan bulan adalah satuan **kalender**, bukan 30 hari — jadi tick bulan tak sama lebar dalam
    hari. Itulah sebabnya batang diposisikan oleh WAKTU (persen) sementara gridline oleh PIKSEL:
    di zoom bulan, garis grid adalah penanda bulan, bukan koordinat presisi batang. */
const nextUnit = (ms: number, zoom: TimelineZoom): number => {
  if (zoom === "day") return ms + DAY;
  if (zoom === "week") return ms + 7 * DAY;
  const t = new Date(ms);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
};

// `timeZone: "UTC"` di keempatnya: tanpa itu label bergeser sehari di zona barat, dan sumbu yang
// menyebut tanggal yang salah adalah bug yang tak memunculkan satu pun error.
const TICK_D = new Intl.DateTimeFormat("id-ID", { day: "numeric", timeZone: "UTC" });
const TICK_DM = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const TICK_M = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });
const TICK_MY = new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Tick yang mendapat garis lebih tegas — satu-satunya cara membaca sumbu panjang tanpa menghitung
    sel satu per satu. Di zoom minggu penandanya **Senin pertama** bulan itu, bukan "minggu yang
    memuat tanggal 1": saat tanggal 1 bukan Senin ia jatuh di minggu sebelumnya. Yang dijanjikan
    penanda ini adalah "tepat satu per bulan", dan `getUTCDate() <= 7` memberikannya. */
const tickMajor = (ms: number, zoom: TimelineZoom): boolean => {
  const d = new Date(ms);
  if (zoom === "day") return d.getUTCDate() === 1;
  if (zoom === "week") return d.getUTCDate() <= 7;
  return d.getUTCMonth() === 0;
};

const tickLabel = (ms: number, zoom: TimelineZoom, major: boolean): string => {
  const d = new Date(ms);
  if (zoom === "day") return (major ? TICK_DM : TICK_D).format(d);
  if (zoom === "week") return TICK_DM.format(d);
  return (major ? TICK_MY : TICK_M).format(d);
};

/**
 * Jendela lahir dari **data ∪ hari ini**, dibulatkan keluar ke batas satuan zoom.
 *
 * Jendela tetap ("hari ini ± N") membuat papan berisi rencana kuartal depan tampak kosong; jendela
 * dari data saja membuat papan yang seluruh tugasnya bulan lalu tak memperlihatkan "sekarang".
 */
export function timelineWindow(
  spans: TaskSpan[], zoom: TimelineZoom, today: number,
): TimelineWindow {
  const t = dayStart(today);
  let lo = t;
  let hi = t + DAY;
  for (const s of spans) {
    if (s.start < lo) lo = s.start;
    if (s.end > hi) hi = s.end;
  }
  const from = unitStart(lo, zoom);
  const { minTicks } = ZOOM[zoom];
  const ticks: TimelineTick[] = [];
  let cur = from;
  // Berhenti saat sumbu sudah MENUTUPI `hi` DAN sudah mencapai tick minimum — jendela sempit tetap
  // terbaca, jendela lebar tetap memuat seluruh data sampai plafon.
  while (ticks.length < MAX_TICKS && (cur < hi || ticks.length < minTicks)) {
    const major = tickMajor(cur, zoom);
    ticks.push({ start: cur, label: tickLabel(cur, zoom, major), major });
    cur = nextUnit(cur, zoom);
  }
  return { from, to: cur, zoom, ticks };
}

export type BarGeometry = {
  /** Persen `0..100` terhadap `[window.from, window.to)`. */
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  invalid: boolean;
};

/**
 * Tanggal menjadi `{left%, width%}` dengan clamping di kedua tepi jendela.
 *
 * `null` berarti **tak ada batang di jendela ini** — task tanpa tanggal, atau rentangnya tak
 * beririsan sama sekali. Pemanggil yang membedakan keduanya lewat `taskSpan`, jadi tak ada
 * informasi yang hilang di sini.
 *
 * `clippedStart`/`clippedEnd` menyala saat rentang aslinya melewati tepi. Batang terpotong yang
 * tak mengaku terpotong berbohong tentang tenggat.
 *
 * Lebar PIKSEL minimum sengaja **tidak** ada di sini — itu urusan CSS. Memaksa lebar minimum ke
 * dalam persen membuat batang satu hari di zoom bulan tampak lebih panjang dari waktunya, dan itu
 * kebohongan yang sama jenisnya.
 */
export function barGeometry(
  task: Pick<TaskView, "startDate" | "dueDate">, window: TimelineWindow,
): BarGeometry | null {
  const span = taskSpan(task);
  if (!span) return null;
  const total = window.to - window.from;
  if (total <= 0) return null;
  // Irisan SETENGAH TERBUKA: rentang yang berakhir tepat di tepi kiri tak beririsan. Tanpa aturan
  // ini, task yang berakhir kemarin muncul sebagai garis rambut selebar nol di tepi kiri.
  if (span.end <= window.from || span.start >= window.to) return null;
  const left = Math.max(span.start, window.from);
  const right = Math.min(span.end, window.to);
  return {
    left: ((left - window.from) / total) * 100,
    width: ((right - left) / total) * 100,
    clippedStart: span.start < window.from,
    clippedEnd: span.end > window.to,
    invalid: span.invalid,
  };
}

/** Persen posisi hari ini, atau `null` bila di luar jendela — garis "hari ini" yang dijepit ke
    tepi menandai hari yang salah. */
export function todayOffset(window: TimelineWindow, today: number): number | null {
  const t = dayStart(today);
  if (t < window.from || t >= window.to) return null;
  return ((t - window.from) / (window.to - window.from)) * 100;
}

export type TimelineTaskRow = { task: TaskView; geometry: BarGeometry };

/**
 * Satu-satunya tempat ketiga ember dibagi, jadi tak ada task yang bisa jatuh di luar ketiganya —
 * invarian `rows + unscheduled + outside === tasks` diuji langsung.
 *
 * `outside` ada karena jendela berplafon (`MAX_TICKS`): task yang tak muat **didaftar**, bukan
 * dihilangkan.
 */
export function timelineRows(tasks: TaskView[], window: TimelineWindow): {
  rows: TimelineTaskRow[]; unscheduled: TaskView[]; outside: TaskView[];
} {
  const scheduled: (TimelineTaskRow & { start: number })[] = [];
  const unscheduled: TaskView[] = [];
  const outside: TaskView[] = [];
  for (const task of tasks) {
    const span = taskSpan(task);
    if (!span) { unscheduled.push(task); continue; }
    const geometry = barGeometry(task, window);
    if (!geometry) { outside.push(task); continue; }
    scheduled.push({ task, geometry, start: span.start });
  }
  // Diurutkan oleh `span.start`, BUKAN oleh `geometry.left`: batang yang terpotong di kiri
  // semuanya ber-`left` 0 dan urutannya akan runtuh jadi urutan kedatangan.
  scheduled.sort((a, b) =>
    a.start - b.start
    || a.task.title.localeCompare(b.task.title, "id")
    || a.task.id.localeCompare(b.task.id));
  return { rows: scheduled.map(({ task, geometry }) => ({ task, geometry })), unscheduled, outside };
}
