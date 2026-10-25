import type { Agent, Lead } from "@hanoman/shared";
import type { AskVia } from "@hanoman/runner";
import { getLead, leadActive, leadProjects } from "./config";

// ADR-0231 · "lead yang menjawab project ini" — syarat yang SAMA dengan gerbang `admitAsk`
// (detect.ts): lead aktif, tak dijeda, project opt-in, dan project tak dijeda. Satu predikat untuk
// dua pertanyaan: siapa yang menjawab tanya yang masuk, dan cara bertanya sesi yang baru lahir.
export function leadDecides(cfg: Lead, optIn: readonly string[], projectId: string): boolean {
  return optIn.includes(projectId) && leadActive(cfg, projectId);
}

export type AskViaDeps = { cfg: () => Promise<Lead>; optIn: () => Promise<string[]> };
const prodDeps: AskViaDeps = { cfg: getLead, optIn: leadProjects };

/**
 * ADR-0231 · cara bertanya sesi claude, DIKUNCI saat sesi lahir: `text` bila lead menjawab project-nya,
 * `tool` (AskUserQuestion → manusia) bila tidak. Runtime lain selalu bertanya lewat teks → `undefined`.
 * Galat membaca konfigurasi → `tool`: ragu berarti manusia yang memutuskan.
 */
export async function askViaFor(
  projectId: string, agent: Agent | undefined, deps: AskViaDeps = prodDeps,
): Promise<AskVia | undefined> {
  if ((agent ?? "claude") !== "claude") return undefined;
  try {
    const [cfg, optIn] = await Promise.all([deps.cfg(), deps.optIn()]);
    return leadDecides(cfg, optIn, projectId) ? "text" : "tool";
  } catch {
    return "tool";
  }
}
