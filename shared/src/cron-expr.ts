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

/** Hari kalender (bukan instan): bulan 1–12, tanggal, dan hari-pekan 0–6 (0 = Minggu). */
type CalDay = { mo: number; dom: number; dow: number };

function dayMatches(spec: CronSpec, day: CalDay): boolean {
  if (!spec.month.has(day.mo)) return false;
  const dom = spec.dom.has(day.dom);
  const dow = spec.dow.has(day.dow);
  return spec.domRestricted && spec.dowRestricted ? dom || dow : dom && dow;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Jatuh tempo pertama SESUDAH `after`.
 *
 * Tanpa `tz` → zona LOKAL proses (perilaku lama, dipakai server). Dengan `tz` (nama zona IANA,
 * mis. `Asia/Jakarta`) → jam dinding dihitung dalam zona itu, lepas dari zona proses; lihat
 * `nextRunInZone` untuk perilaku DST-nya.
 *
 * Kandidat zona-lokal dibangun `new Date(y, mo, d, h, mi)` — konstruktor komponen-lokal, bukan
 * geseran dari UTC. Itulah yang membuatnya aman DST: jam lokal yang tak ada (lompat maju) dinormalkan
 * JS ke depan dan tetap lolos gerbang `> after`, sementara jam ganda (mundur) memberi kemunculan
 * pertama sehingga jadwalnya jalan SEKALI. Menghitung dari komponen UTC lalu menggesernya justru
 * yang akan salah dua kali setahun.
 *
 * `limitDays` = 400 supaya jadwal setahun sekali (mis. `0 0 1 1 *`) tetap terjangkau, dan jadwal
 * yang mustahil (`0 0 30 2 *`) berhenti alih-alih beriterasi selamanya.
 */
export function nextRun(spec: CronSpec, after: Date, limitDays = 400, tz?: string): Date | null {
  if (tz !== undefined) return nextRunInZone(spec, after.getTime(), limitDays, tz);
  const hours = [...spec.hour].sort((a, b) => a - b);
  const minutes = [...spec.minute].sort((a, b) => a - b);
  const t = after.getTime();
  for (let d = 0; d <= limitDays; d++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + d);
    if (!dayMatches(spec, { mo: day.getMonth() + 1, dom: day.getDate(), dow: day.getDay() })) continue;
    for (const h of hours) {
      for (const mi of minutes) {
        const cand = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
        if (cand.getTime() > t) return cand;
      }
    }
  }
  return null;
}

/**
 * `nextRun` dalam zona IANA `tz`. Jam dinding dipecah lewat `Intl.DateTimeFormat` (hourCycle h23,
 * jadi tengah malam selalu 00, bukan 24), lalu dikonversi balik ke instan.
 *
 * Perilaku DST (sengaja sama dengan zona lokal JS, diuji di `cron-expr.test.ts`):
 * - Musim semi, jam yang TAK ADA (mis. 02:30 saat 02:00 → 03:00): jatuh tempo bergeser ke jam
 *   sesudah celah (03:30), sekali. Tak dilewati, tak dijalankan dua kali.
 * - Musim gugur, jam GANDA (mis. 01:30 saat 02:00 → 01:00): dihitung di kemunculan PERTAMA. Jadwal
 *   berjalan sekali; kemunculan kedua tak pernah jadi jatuh tempo.
 * - Hari yang melintasi transisi memakai pemindaian penuh (kandidatnya boleh tak monoton saat
 *   celah); hari lain memakai satu offset dan tak perlu konversi per kandidat.
 *
 * Zona tak dikenal → null (sama seperti ekspresi tak sah).
 */
function nextRunInZone(spec: CronSpec, t0: number, limitDays: number, tz: string): Date | null {
  if (!isValidTimeZone(tz)) return null;
  const hours = [...spec.hour].sort((a, b) => a - b);
  const minutes = [...spec.minute].sort((a, b) => a - b);
  const start = partsIn(tz, t0);
  for (let d = 0; d <= limitDays; d++) {
    const cal = new Date(Date.UTC(start.y, start.mo - 1, start.d + d));
    const y = cal.getUTCFullYear(), mo = cal.getUTCMonth() + 1, dom = cal.getUTCDate();
    if (!dayMatches(spec, { mo, dom, dow: cal.getUTCDay() })) continue;
    const dayWall = Date.UTC(y, mo - 1, dom);
    // Tanpa transisi di jendela ±2 hari, satu offset berlaku untuk seluruh hari: kandidat monoton
    // terhadap jam dinding, jadi kandidat pertama yang > t0 adalah yang terkecil.
    if (offsetAt(tz, dayWall - 2 * DAY_MS) === offsetAt(tz, dayWall + 2 * DAY_MS)) {
      const off = offsetAt(tz, dayWall + 12 * HOUR_MS);
      for (const h of hours) for (const mi of minutes) {
        const t = Date.UTC(y, mo - 1, dom, h, mi) - off;
        if (t > t0) return new Date(t);
      }
      continue;
    }
    let best: number | null = null;
    for (const h of hours) for (const mi of minutes) {
      const t = wallToInstant(tz, y, mo, dom, h, mi);
      if (t > t0 && (best === null || t < best)) best = t;
    }
    if (best !== null) return new Date(best);
  }
  return null;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(tz: string): Intl.DateTimeFormat {
  let f = zoneFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    zoneFormats.set(tz, f);
  }
  return f;
}

type WallParts = { y: number; mo: number; d: number; h: number; mi: number; s: number };
function partsIn(tz: string, t: number): WallParts {
  const got: Record<string, string> = {};
  for (const p of zoneFormat(tz).formatToParts(new Date(Math.floor(t / 1000) * 1000))) got[p.type] = p.value;
  return { y: +got.year!, mo: +got.month!, d: +got.day!, h: +got.hour!, mi: +got.minute!, s: +got.second! };
}

/** Jam dinding zona pada instan `t`, dinyatakan sebagai ms UTC; selisihnya terhadap `t` = offset. */
function offsetAt(tz: string, t: number): number {
  const p = partsIn(tz, t);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

/**
 * Jam dinding (y-mo-d h:mi) dalam `tz` → instan. Kandidat dicoba dengan offset di dua sisi hari
 * (sebelum/sesudah transisi), dan hanya yang jam dindingnya kembali persis dipakai. Dua-duanya
 * valid = jam ganda → yang terkecil (kemunculan pertama). Tak satu pun valid = jam tak ada →
 * offset SEBELUM transisi, sehingga jatuh tempo bergeser ke sesudah celah.
 */
function wallToInstant(tz: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  const valid: number[] = [];
  for (const off of new Set([offsetAt(tz, wall - DAY_MS), offsetAt(tz, wall + DAY_MS)])) {
    const t = wall - off;
    const p = partsIn(tz, t);
    if (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) === wall) valid.push(t);
  }
  if (valid.length) return Math.min(...valid);
  return wall - offsetAt(tz, wall - DAY_MS);
}

/** Zona IANA yang dikenali runtime ini. Dipakai `nextRunFor` untuk menolak zona tak dikenal. */
export function isValidTimeZone(tz: string): boolean {
  try { zoneFormat(tz); return true; } catch { return false; }
}

/**
 * Jatuh tempo berikutnya untuk ekspresi `expr` sesudah `after`. `tz` opsional (ADR-0212): tanpa
 * `tz`, zona lokal proses; dengan `tz`, jam dinding dihitung di zona itu. Ekspresi tak sah, atau
 * `tz` tak dikenal, menghasilkan null.
 */
export function nextRunFor(expr: string, after: Date, tz?: string): Date | null {
  const spec = parseCron(expr);
  return spec ? nextRun(spec, after, 400, tz) : null;
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
