// ADR-0181 · kosakata tampilan halaman Memori. Satu tempat, supaya label badge tak berselisih
// antara daftar, riwayat, dan test.
import type { MemoryKind, MemoryListItem } from "@hanoman/shared";

export type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";

export const KIND_LABEL: Record<MemoryKind, string> = {
  convention: "konvensi", gotcha: "jebakan", decision: "keputusan", fact: "fakta",
};
export const KIND_TONE: Record<MemoryKind, Tone> = {
  convention: "info", gotcha: "warn", decision: "brass", fact: "neutral",
};
export const REVIEW_REASON_LABEL: Record<string, string> = {
  decision: "keputusan arsitektur",
  "no-anchor": "tanpa jangkar",
  "anchor-unverified": "jangkar belum terverifikasi",
  "untrusted-source": "sumber tak tepercaya",
};

/** Keadaan memori DI MESIN INI (verdict jangkar). */
export function verdictBadge(local: MemoryListItem["local"]): { label: string; tone: Tone } {
  if (local.verdict === "valid") return { label: "terverifikasi", tone: "ok" };
  if (local.verdict === "stale") return { label: "usang di mesin ini", tone: "warn" };
  return { label: "belum terverifikasi di mesin ini", tone: "neutral" };
}

export const OP_LABEL: Record<string, string> = {
  propose: "diusulkan", activate: "diaktifkan", reject: "ditolak", invalidate: "dibatalkan",
  supersede: "digantikan", reverify: "diverifikasi ulang",
};

/** "claude · sesi spec-12 · abcdef1" — sumber ringkas satu memori. */
export function sourceLine(m: MemoryListItem): string {
  const parts: string[] = [m.source.runtime];
  if (m.source.sessionId) parts.push(`sesi ${m.source.sessionId}`);
  if (m.source.commitSha) parts.push(m.source.commitSha.slice(0, 7));
  return parts.join(" · ");
}

/** Id memori yang digantikan oleh lebih dari satu memori aktif (sync paralel, ADR-0180). */
export function duplicateSupersedes(active: MemoryListItem[]): string[] {
  const n = new Map<string, number>();
  for (const m of active) if (m.supersedesId) n.set(m.supersedesId, (n.get(m.supersedesId) ?? 0) + 1);
  return [...n].filter(([, c]) => c > 1).map(([id]) => id);
}

/** Pesan galat dari ApiError (`detail.error` string) atau Error biasa. */
export function errText(e: unknown): string {
  const d = (e as { detail?: { error?: unknown } } | null)?.detail?.error;
  if (typeof d === "string") return d;
  return e instanceof Error ? e.message : "Gagal";
}
