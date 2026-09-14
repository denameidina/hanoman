import { resolvePhasePlan, type Agent, type PhasePlan, type Setting } from "@hanoman/shared";
import type { Flow } from "@hanoman/runner";
import { nativeAgentsAvailable } from "./pty";

// ADR-0164 · satu titik resolusi rencana fase untuk SEMUA pemanggil sesi ber-flow (backlog manual,
// governor scheduler, lead, reverse/scaffold/prd/breakdown). Menyalinnya ke tiap route adalah kelas
// bug SPEC-431/448: satu pintu yang lupa gerbang `nativeAgents` melahirkan orchestrator codex tua
// tanpa satu pun agen fase.
export function sessionPhasePlan(
  setting: Setting, flow: Flow, agent: Agent, orchestrator: { model: string; effort: string },
): PhasePlan | null {
  return resolvePhasePlan({
    flow, runtime: agent, orchestration: setting.orchestration, orchestrator,
    nativeAgents: nativeAgentsAvailable(agent),
  });
}
