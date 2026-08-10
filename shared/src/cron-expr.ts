// SPEC-646 · ADR-0112 — jadwal cron sebagai fungsi MURNI.
//
// Ia hidup di `shared` (bukan di server) karena dua pemakainya harus sepakat: server yang
// menghitung `nextRunAt` dan browser yang menampilkan preview "jalan berikutnya" sembari operator
// mengetik. Dua implementasi yang wajib sepakat adalah kelas bug "satu definisi, N call site"
// (SPEC-431/448/475/481) — di sini bahkan tanpa tipe yang memaksanya.
//
// Dependensi cron eksternal sengaja tak dipakai: yang dibutuhkan hanyalah subset 5-field, dan
// paket npm apa pun tak bisa dijamin memberi jawaban identik di kedua sisi.

export type CronSpec = {
  minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>;
  // Aturan Vixie: tanggal DAN hari-pekan sama-sama dibatasi → keduanya di-OR, bukan di-AND.
  // Karena itu "dibatasi" harus diingat dari TEKS field-nya; himpunan penuh tak bisa dibedakan
  // dari `*` sesudah di-expand.
  domRestricted: boolean; dowRestricted: boolean;
};

// dow menerima 7 (= Minggu, konvensi Vixie) lalu dinormalkan ke 0.
const BOUNDS: readonly (readonly [number, number])[] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(raw: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const slash = part.indexOf("/");
    const rangePart = slash === -1 ? part : part.slice(0, slash);
    const stepPart = slash === -1 ? undefined : part.slice(slash + 1);
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d{1,2}$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }
    let from: number; let to: number;
    if (rangePart === "*") { from = lo; to = hi; }
    else if (/^\d{1,2}$/.test(rangePart)) {
      from = Number(rangePart);
      to = stepPart === undefined ? from : hi;   // `5/2` berarti 5,7,9,… sampai batas atas
    } else {
      const m = /^(\d{1,2})-(\d{1,2})$/.exec(rangePart);
      if (!m) return null;
      from = Number(m[1]); to = Number(m[2]);
    }
    if (from < lo || to > hi || from > to) return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export function parseCron(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const [lo, hi] = BOUNDS[i]!;
    const s = parseField(parts[i]!, lo, hi);
    if (!s) return null;
    sets.push(s);
  }
  return {
    minute: sets[0]!, hour: sets[1]!, dom: sets[2]!, month: sets[3]!,
    dow: new Set([...sets[4]!].map((n) => (n === 7 ? 0 : n))),
    domRestricted: parts[2] !== "*", dowRestricted: parts[4] !== "*",
  };
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.month.has(d.getMonth() + 1)) return false;
  const dom = spec.dom.has(d.getDate());
  const dow = spec.dow.has(d.getDay());
  return spec.domRestricted && spec.dowRestricted ? dom || dow : dom && dow;
}

/**
 * Jatuh tempo pertama SESUDAH `after`, dalam zona waktu LOKAL.
 *
 * Kandidatnya dibangun `new Date(y, mo, d, h, mi)` — konstruktor komponen-lokal, bukan geseran
 * dari UTC. Itulah yang membuatnya aman DST: jam lokal yang tak ada (lompat maju) dinormalkan JS
 * ke depan dan tetap lolos gerbang `> after`, sementara jam ganda (mundur) memberi kemunculan
 * pertama sehingga jadwalnya jalan SEKALI. Menghitung dari komponen UTC lalu menggesernya justru
 * yang akan salah dua kali setahun.
 *
 * `limitDays` = 400 supaya jadwal setahun sekali (mis. `0 0 1 1 *`) tetap terjangkau, dan jadwal
 * yang mustahil (`0 0 30 2 *`) berhenti alih-alih beriterasi selamanya.
 */
export function nextRun(spec: CronSpec, after: Date, limitDays = 400): Date | null {
  const hours = [...spec.hour].sort((a, b) => a - b);
  const minutes = [...spec.minute].sort((a, b) => a - b);
  const t = after.getTime();
  for (let d = 0; d <= limitDays; d++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + d);
    if (!dayMatches(spec, day)) continue;
    for (const h of hours) {
      for (const mi of minutes) {
        const cand = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
        if (cand.getTime() > t) return cand;
      }
    }
  }
  return null;
}

export function nextRunFor(expr: string, after: Date): Date | null {
  const spec = parseCron(expr);
  return spec ? nextRun(spec, after) : null;
}

export type CronPreset =
  | { kind: "harian"; hour: number; minute: number }
  | { kind: "hari-kerja"; hour: number; minute: number }
  | { kind: "mingguan"; hour: number; minute: number; weekday: number }
  | { kind: "tiap-n-jam"; everyHours: number; minute: number };

export function presetToExpr(p: CronPreset): string {
  switch (p.kind) {
    case "harian": return `${p.minute} ${p.hour} * * *`;
    case "hari-kerja": return `${p.minute} ${p.hour} * * 1-5`;
    case "mingguan": return `${p.minute} ${p.hour} * * ${p.weekday}`;
    case "tiap-n-jam": return `${p.minute} */${p.everyHours} * * *`;
  }
}

/**
 * Kebalikan `presetToExpr`, dan sengaja KETAT: hanya bentuk yang persis dihasilkannya yang
 * dikenali. Menyimpan preset sebagai kolom kedua di samping `expr` akan melahirkan drift yang tak
 * punya arbiter — jadi preset selalu diturunkan, dan apa pun di luar keempat bentuk itu jatuh ke
 * kolom cron expression lanjutan.
 */
export function exprToPreset(expr: string): CronPreset | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [mi, h, dom, mo, dow] = p as [string, string, string, string, string];
  if (dom !== "*" || mo !== "*") return null;
  if (!/^\d{1,2}$/.test(mi)) return null;
  const minute = Number(mi);
  if (minute > 59) return null;
  const every = /^\*\/(\d{1,2})$/.exec(h);
  if (every) {
    if (dow !== "*") return null;
    const everyHours = Number(every[1]);
    return everyHours >= 1 && everyHours <= 23 ? { kind: "tiap-n-jam", everyHours, minute } : null;
  }
  if (!/^\d{1,2}$/.test(h)) return null;
  const hour = Number(h);
  if (hour > 23) return null;
  if (dow === "*") return { kind: "harian", hour, minute };
  if (dow === "1-5") return { kind: "hari-kerja", hour, minute };
  if (/^[0-6]$/.test(dow)) return { kind: "mingguan", hour, minute, weekday: Number(dow) };
  return null;
}

export const WEEKDAY_LABELS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

export function describeCron(expr: string): string {
  const p = exprToPreset(expr);
  if (!p) return expr.trim();
  switch (p.kind) {
    case "harian": return `setiap hari ${hhmm(p.hour, p.minute)}`;
    case "hari-kerja": return `hari kerja ${hhmm(p.hour, p.minute)}`;
    case "mingguan": return `setiap ${WEEKDAY_LABELS[p.weekday]} ${hhmm(p.hour, p.minute)}`;
    case "tiap-n-jam": return `tiap ${p.everyHours} jam (menit ${p.minute})`;
  }
}
