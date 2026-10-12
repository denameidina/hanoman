// Audit UI/UX 2026-10 · Fase 2D — SATU format waktu relatif untuk seluruh dashboard.
//
// Sebelumnya tiga bentuk hidup berdampingan: "5 mnt" dan "3 jam 7 mnt" (Klien), "5m lalu" dan "2j lalu"
// (lonceng notifikasi), serta "baru saja lalu" karena penyambung " lalu" ditempel di luar fungsi.
// Glosarium: "baru saja", "5 menit lalu", "2 jam lalu", "kemarin", "3 hari lalu", lalu tanggal.
// Di sini satu-satunya tempat bentuk itu dirakit. Panduan: internal/docs/frontend/glossary.md.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Batas "N hari lalu" sebelum beralih ke tanggal absolut. */
const RELATIVE_DAY_LIMIT = 7;

export type TimeInput = string | number | Date | null | undefined;

/** Milidetik epoch dari masukan, atau `null` bila kosong/tak valid. */
export function toEpochMs(input: TimeInput): number | null {
  if (input === null || input === undefined || input === "") return null;
  const ms = input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

/** Selisih hari kalender lokal (bukan 24 jam), supaya "kemarin" benar di sekitar tengah malam. */
function calendarDayDiff(thenMs: number, nowMs: number): number {
  const a = new Date(thenMs); a.setHours(0, 0, 0, 0);
  const b = new Date(nowMs); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

/**
 * Waktu relatif dalam bahasa biasa. `""` bila masukan kosong/tak valid (pemanggil memilih
 * fallback sendiri, mis. `|| "—"`). Masa depan sampai satu menit juga "baru saja" (selisih jam).
 */
export function relativeTime(input: TimeInput, now: number = Date.now()): string {
  const then = toEpochMs(input);
  if (then === null) return "";
  const diff = now - then;
  if (diff < MINUTE) return "baru saja";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} menit lalu`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} jam lalu`;
  const days = calendarDayDiff(then, now);
  if (days === 1) return "kemarin";
  if (days < RELATIVE_DAY_LIMIT) return `${days} hari lalu`;
  return absoluteDate(then, now);
}

/** Tanggal pendek id-ID: "4 Okt", atau "4 Okt 2025" bila beda tahun dengan `now`. */
export function absoluteDate(input: TimeInput, now: number = Date.now()): string {
  const then = toEpochMs(input);
  if (then === null) return "";
  const sameYear = new Date(then).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(then));
}
