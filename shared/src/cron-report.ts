// ADR-0222 · murni (tanpa zod/Node, tanpa Buffer: dibundel Vite ke browser) — dibagi server dan dashboard.

/** Batas isi satu laporan: baris ini menyeberang sebagai SATU record change-feed sync. */
export const CRON_REPORT_MAX_BYTES = 64 * 1024;
/** Laporan terbaru yang dipertahankan per cron. */
export const CRON_REPORT_KEEP = 90;

const SLUG_MAX = 48;

export function cronReportSlug(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, SLUG_MAX).replace(/-+$/g, "") || "cron";
}

/** `<runDate>-<slug cronName>-<runId>.md` — diturunkan, tak pernah disimpan. */
export const cronReportFilename = (r: { runDate: string; cronName: string; id: string }): string =>
  `${r.runDate}-${cronReportSlug(r.cronName)}-${r.id}.md`;

const NOTE = "\n\n> … laporan dipotong (melebihi 64 KiB).\n";

const enc = new TextEncoder();
const len = (t: string): number => enc.encode(t).length;

export function truncateCronReport(text: string): { body: string; bytes: number; truncated: boolean } {
  const bytes = len(text);
  if (bytes <= CRON_REPORT_MAX_BYTES) return { body: text, bytes, truncated: false };
  const room = CRON_REPORT_MAX_BYTES - len(NOTE);
  // Potong di batas byte lalu buang potongan karakter multibyte di ujungnya (U+FFFD).
  const head = new TextDecoder().decode(enc.encode(text).subarray(0, room)).replace(/�+$/, "");
  const body = head + NOTE;
  return { body, bytes: len(body), truncated: true };
}

export type CronReportView = {
  id: string; projectId: string; cronId: string; cronName: string; runDate: string; dueAt: string;
  sessionId: string | null; bytes: number; filename: string; createdAt: string; updatedAt: string;
};
export type CronReportDetail = CronReportView & { body: string };
