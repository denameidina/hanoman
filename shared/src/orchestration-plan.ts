import {
  CLAUDE_DEFAULT_ALIAS, ORCHESTRATION_DEFAULTS, cmpVersion, coerceClaudeEffort, coerceCodexEffort,
  type Orchestration, type PhaseOverrides,
} from "./entities";

/** Nilai `model` subagent claude yang berarti "model percakapan utama" (dokumen sub-agents Claude Code). */
export const CLAUDE_SUBAGENT_INHERIT = "inherit";
import {
  FLOW_PHASES, REVIEWER_CELL, REVIEWER_DEFAULTS, REVIEWER_FLOWS, phaseAgentName,
  type OrchestrationFlow, type PhasePlan, type PhaseReviewerEntry,
} from "./orchestration";

// ADR-0164 · resolver rencana fase. Satu fungsi murni dipakai server (kelahiran sesi) dan UI
// (pratinjau modal Start) — dua salinan aturan warisan/koersi akan membuat pratinjau berbohong.

/** Pindahan dari runner/src/codex-agent-config.ts (ADR-0159): UI butuh gerbang yang sama. */
export const CODEX_NATIVE_AGENTS_MIN_CLIENT = "0.151.0";

export function codexNativeAgentsSupported(version: string | null): boolean {
  const parsed = version ? /(\d+)\.(\d+)\.(\d+)/.exec(version)?.[0] : null;
  return parsed ? cmpVersion(parsed, CODEX_NATIVE_AGENTS_MIN_CLIENT) >= 0 : false;
}

export type PhasePlanInput = {
  flow: OrchestrationFlow;
  runtime: "claude" | "codex";
  /** `undefined` = respons Setting lama tanpa blok ini → `ORCHESTRATION_DEFAULTS` (matriks bawaan,
   *  `no_effort` mati — amandemen 2026-09-17), sama dengan `.default()` zSetting di server. */
  orchestration: Orchestration | undefined;
  orchestrator: { model: string; effort: string };
  /** Override model/effort yang dipilih operator hanya untuk sesi ini. */
  phaseOverrides?: PhaseOverrides;
  /** Runtime sanggup subagent native: claude selalu, codex bila client >= 0.151.0. */
  nativeAgents: boolean;
};

export function resolvePhasePlan(input: PhasePlanInput): PhasePlan | null {
  const cfg = (input.orchestration ?? ORCHESTRATION_DEFAULTS)[input.flow];
  if (!input.nativeAgents || cfg?.enabled === false) return null;
  const cells = cfg?.[input.runtime] ?? {};
  // Effort dikoersi ke model HASIL resolusi: sel Luna yang mewarisi `ultra` harus turun ke
  // fallback Luna sebelum sampai ke `model_reasoning_effort`.
  const coerce = input.runtime === "codex" ? coerceCodexEffort : coerceClaudeEffort;
  const resolve = (key: string, fallback: { model: string; effort: string }) => {
    const cell = cells[key];
    const override = input.phaseOverrides?.[key];
    const picked = override?.model ?? cell?.model ?? fallback.model;
    // `default` hanya sah untuk `--model` sesi; `--agents` claude menerimanya sebagai `inherit`.
    const model = input.runtime === "claude" && picked === CLAUDE_DEFAULT_ALIAS ? CLAUDE_SUBAGENT_INHERIT : picked;
    return { model, effort: coerce(model, override?.effort ?? cell?.effort ?? fallback.effort) };
  };
  // ADR-0170 P2 · reviewer TIDAK mewarisi orchestrator: default-nya konstanta peran (penilai
  // independen butuh model kuat walau orchestrator murah), sel/override `Review` menimpanya.
  const reviewer: PhaseReviewerEntry | undefined = REVIEWER_FLOWS.has(input.flow)
    ? { agentName: phaseAgentName(REVIEWER_CELL), phase: "Execute",
        ...resolve(REVIEWER_CELL, REVIEWER_DEFAULTS[input.runtime]) }
    : undefined;
  return {
    flow: input.flow,
    runtime: input.runtime,
    phases: FLOW_PHASES[input.flow].map((phase) => ({
      phase, agentName: phaseAgentName(phase), ...resolve(phase, input.orchestrator),
    })),
    ...(reviewer ? { reviewer } : {}),
  };
}
