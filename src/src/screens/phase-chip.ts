import { CLAUDE_SUBAGENT_INHERIT, CODEX_MODELS, claudeModel } from "@hanoman/shared";
import type { Phase } from "../api/client";

// ADR-0164 · format chip fase. Murni supaya PhaseStrip dan chip header memakai label yang sama.
export const modelLabel = (id?: string): string =>
  !id ? "" : id === CLAUDE_SUBAGENT_INHERIT ? "warisi orchestrator"
    : claudeModel(id)?.label ?? CODEX_MODELS.find((m) => m.id === id)?.label ?? id;

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export type ChipTone = "done" | "running" | "pending" | "skipped" | "failed" | "abandoned";

export function chipTone(p: Phase): ChipTone {
  if (p.state === "skipped") return "skipped";
  const status = p.agent?.status;
  if (status === "abandoned") return "abandoned";
  if (status === "interrupted") return "failed";
  if (p.state === "done") return "done";
  if (status === "running" || p.state === "active") return "running";
  return "pending";
}

// Audit R2 · status chip terbaca pembaca layar (ikon CHIP_ICON `aria-hidden`).
export const CHIP_STATUS_LABEL: Record<ChipTone, string> = {
  done: "selesai", running: "berjalan", pending: "menunggu", skipped: "dilewati",
  failed: "terputus", abandoned: "ditinggalkan",
};

/** Audit R2 · nama aksesibel chip fase: SELALU lengkap (juga saat mode ringkas menyembunyikan
 *  model/effort/durasi secara visual) — `Fase X: status · model · effort · durasi · percobaan n · ⚠`. */
export function chipAccessibleName(p: Phase, duration: string): string {
  const a = p.agent;
  const parts = [
    CHIP_STATUS_LABEL[chipTone(p)],
    modelLabel(a?.model),
    a?.effort ?? "",
    duration,
    a && a.attempts > 1 ? `percobaan ${a.attempts}` : "",
    a?.evidence === "missing" ? "bukti subagent tak diterima" : "",
  ].filter(Boolean);
  return `Fase ${p.name}: ${parts.join(" · ")}`;
}
