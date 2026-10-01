import type { QaCaseStatus, QaReportStatus, QaSeverity, QaVerdict } from "@hanoman/shared";

export type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
export const SEVERITY_TONE: Record<QaSeverity, Tone> = { blocker: "err", critical: "err", major: "warn", minor: "info", trivial: "neutral" };
export const CASE_TONE: Record<QaCaseStatus, Tone> = { todo: "neutral", pass: "ok", fail: "err", blocked: "warn", skipped: "info" };
export const REPORT_TONE: Record<QaReportStatus, Tone> = { draft: "neutral", submitted: "brass", closed: "ok" };
export const VERDICT_TONE: Record<QaVerdict, Tone> = { go: "ok", "no-go": "err", conditional: "warn" };
export const VERDICT_LABEL: Record<QaVerdict, string> = { go: "Go", "no-go": "No-go", conditional: "Conditional" };

export const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** Pesan galat dari ApiError (`detail.error` string) atau Error biasa. */
export function errText(e: unknown): string {
  const d = (e as { detail?: { error?: unknown } } | null)?.detail?.error;
  if (typeof d === "string") return d;
  return e instanceof Error ? e.message : "Gagal";
}

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
