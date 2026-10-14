import { phaseOverridesProblem, resolvePhasePlan, type Agent, type PhasePlan, type PhaseOverrides, type Setting } from "@hanoman/shared";
import type { Flow } from "@hanoman/runner";
import { nativeAgentsAvailable } from "./pty";
import { normalizePhaseOverrides } from "./settings";

export class PhasePlanValidationError extends Error {
  readonly statusCode = 400;
}

export function validatePhaseOverrides(agent: Agent, overrides?: PhaseOverrides): void {
  const problem = phaseOverridesProblem(agent, overrides);
  if (problem) throw new PhasePlanValidationError(problem);
}

// ADR-0164 · satu titik resolusi rencana fase untuk SEMUA pemanggil sesi ber-flow (backlog manual,
// governor scheduler, lead, reverse/scaffold/prd/breakdown). Menyalinnya ke tiap route adalah kelas
// bug SPEC-431/448: satu pintu yang lupa gerbang `nativeAgents` melahirkan orchestrator codex tua
// tanpa satu pun agen fase.
export function sessionPhasePlan(
  setting: Setting, flow: Flow, agent: Agent, orchestrator: { model: string; effort: string },
  phaseOverrides?: PhaseOverrides,
): PhasePlan | null {
  validatePhaseOverrides(agent, phaseOverrides);
  return resolvePhasePlan({
    flow, runtime: agent, orchestration: setting.orchestration, orchestrator,
    // S6 · override transient dinormalisasi sama seperti sel Setting (model pensiun, koersi codex).
    phaseOverrides: normalizePhaseOverrides(agent, phaseOverrides),
    nativeAgents: nativeAgentsAvailable(agent),
  });
}
