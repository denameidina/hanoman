import { cmpVersion, coerceClaudeEffort, coerceCodexEffort, type Orchestration, type PhaseOverrides } from "./entities";
import { FLOW_PHASES, phaseAgentName, type OrchestrationFlow, type PhasePlan } from "./orchestration";

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
  /** `undefined` = respons Setting lama tanpa blok ini → default aktif. */
  orchestration: Orchestration | undefined;
  orchestrator: { model: string; effort: string };
  /** Override model/effort yang dipilih operator hanya untuk sesi ini. */
  phaseOverrides?: PhaseOverrides;
  /** Runtime sanggup subagent native: claude selalu, codex bila client >= 0.151.0. */
  nativeAgents: boolean;
};

export function resolvePhasePlan(input: PhasePlanInput): PhasePlan | null {
  const cfg = input.orchestration?.[input.flow];
  if (!input.nativeAgents || cfg?.enabled === false) return null;
  const cells = cfg?.[input.runtime] ?? {};
  // Effort dikoersi ke model HASIL resolusi: sel Luna yang mewarisi `ultra` harus turun ke
  // fallback Luna sebelum sampai ke `model_reasoning_effort`.
  const coerce = input.runtime === "codex" ? coerceCodexEffort : coerceClaudeEffort;
  return {
    flow: input.flow,
    runtime: input.runtime,
    phases: FLOW_PHASES[input.flow].map((phase) => {
      const cell = cells[phase];
      const override = input.phaseOverrides?.[phase];
      const model = override?.model ?? cell?.model ?? input.orchestrator.model;
      return {
        phase, agentName: phaseAgentName(phase), model,
        effort: coerce(model, override?.effort ?? cell?.effort ?? input.orchestrator.effort),
      };
    }),
  };
}
