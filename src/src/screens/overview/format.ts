// ADR-0220 · formatter Overview "Koran Pagi" (id-ID). Murni; dipakai semua panel.
export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} menit`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} rb`;
  return String(n);
}
export function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h ? `${d} hari ${h} jam` : `${d} hari`;
  if (h > 0) return m ? `${h} jam ${m} menit` : `${h} jam`;
  return `${m} menit`;
}
export function fmtClock(t: string | number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
}
const LONG_DATE = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const longDate = (t: number): string => LONG_DATE.format(t);
