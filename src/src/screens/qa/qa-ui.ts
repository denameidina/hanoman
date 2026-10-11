import { failureMessage } from "../../lib/report-error";
import type {
  QaAttachmentSyncState, QaCaseStatus, QaExportFormat, QaFindingStatus, QaPriority, QaReportStatus, QaSeverity, QaVerdict,
} from "@hanoman/shared";

// Peta label dipusatkan di lib/labels.ts (Audit 2026-10 · Fase 2D). Nama lama tetap diekspor di sini
// agar impor yang sudah ada tetap jalan.
export {
  FINDING_STATUS_LABEL, VERDICT_LABEL, CASE_STATUS_LABEL as CASE_LABEL, QA_SEVERITY_LABEL as SEVERITY_LABEL,
  QA_PRIORITY_LABEL as PRIORITY_LABEL, REPORT_STATUS_LABEL as REPORT_LABEL,
} from "../../lib/labels";

export type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
export const SEVERITY_TONE: Record<QaSeverity, Tone> = { blocker: "err", critical: "err", major: "warn", minor: "info", trivial: "neutral" };
// Prioritas dibedakan lewat nada (bukan semua brass): P0 mendesak, P3 bisa menunggu.
export const PRIORITY_TONE: Record<QaPriority, Tone> = { P0: "err", P1: "warn", P2: "info", P3: "neutral" };
export const FINDING_STATUS_TONE: Record<QaFindingStatus, Tone> = { open: "warn", sent: "info", wontfix: "neutral" };
export const CASE_TONE: Record<QaCaseStatus, Tone> = { todo: "neutral", pass: "ok", fail: "err", blocked: "warn", skipped: "info" };
export const REPORT_TONE: Record<QaReportStatus, Tone> = { draft: "neutral", submitted: "brass", closed: "ok" };
export const VERDICT_TONE: Record<QaVerdict, Tone> = { go: "ok", "no-go": "err", conditional: "warn" };

export const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

/**
 * Format ekspor laporan. ZIP = laporan + lampiran (bisa diimpor kembali) dan jadi pintu utama; DOCX/PDF untuk
 * dibaca dan diserahkan; XLSX = laporan lengkap; CSV = matriks test case; MD = dokumennya saja.
 */
export const QA_EXPORTS: { format: QaExportFormat; label: string }[] = [
  { format: "zip", label: "Unduh ZIP (laporan + lampiran)" }, { format: "docx", label: "Unduh DOCX" },
  { format: "pdf", label: "Unduh PDF" }, { format: "xlsx", label: "Unduh XLSX" },
  { format: "csv", label: "Unduh CSV (test case)" }, { format: "md", label: "Unduh .md" },
];

/**
 * Alasan galat yang layak dibaca: pesan server (`detail.error`), selain itu status HTTP. Pesan bawaan
 * klien memuat URL mentah ("PATCH /api/… → 400") dan tak boleh sampai ke layar.
 */
export function errText(e: unknown): string {
  const d = (e as { detail?: { error?: unknown } } | null)?.detail?.error;
  if (typeof d === "string" && d.trim()) return d;
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `server menolak permintaan (HTTP ${status})`;
  return e instanceof Error ? e.message : "Gagal";
}

/** "Gagal <aksi>: <alasan>" untuk galat yang harus tetap terlihat (inline), memakai helper galat bersama. */
export const failText = (action: string, e: unknown): string => failureMessage(action, new Error(errText(e)));

export const envToText = (e: Record<string, string>): string =>
  Object.entries(e).map(([k, v]) => `${k}=${v}`).join("\n");
export const textToEnv = (t: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    const i = l.indexOf("=");
    const k = (i < 0 ? l : l.slice(0, i)).trim();
    if (k) out[k] = i < 0 ? "" : l.slice(i + 1).trim();
  }
  return out;
};

export const fmtSize = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

/**
 * Penanda status sync byte lampiran (per mesin). `available` sengaja tanpa penanda — keadaan normal tak perlu
 * berisik. Server sudah menormalkan: di hub/standalone tak pernah ada `local-only`.
 */
export const SYNC_STATE_BADGE: Partial<Record<QaAttachmentSyncState, { label: string; tone: Tone; hint: string }>> = {
  "local-only": { label: "menunggu unggah", tone: "warn", hint: "Berkas ini baru ada di perangkat ini dan akan diunggah ke server pada sinkronisasi berikutnya." },
  remote: { label: "di server · belum diunduh", tone: "info", hint: "Berkas dibuat di perangkat lain. Ia diunduh otomatis saat dibuka atau diekspor." },
  failed: { label: "gagal diunggah", tone: "err", hint: "Server menolak isi berkas ini (ukuran/tipe tak cocok) atau berkas lokal hilang. Hapus dan unggah ulang." },
};


