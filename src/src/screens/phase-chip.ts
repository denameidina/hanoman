import { CODEX_MODELS, claudeModel } from "@hanoman/shared";
import type { Phase } from "../api/client";

// ADR-0164 · format chip fase. Murni supaya PhaseStrip dan chip header memakai label yang sama.
export const modelLabel = (id?: string): string =>
  !id ? "" : claudeModel(id)?.label ?? CODEX_MODELS.find((m) => m.id === id)?.label ?? id;

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
