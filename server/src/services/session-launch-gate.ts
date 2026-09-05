import { cpus, loadavg, platform } from "node:os";
import { createSession, listPanesAsync, sessionIdForSpec, type CreateOpts, type SessionInfo } from "./pty";
import { getScheduler } from "./scheduler/config";
import { createLaunchGate, launchStatus, type HostLoad, type LaunchPane } from "./session-admission";
import type { Scheduler } from "@hanoman/shared";

export const readHostLoad = (): HostLoad => ({ platform: platform(), loadAverage: loadavg()[0] ?? NaN, cores: cpus().length });
const gate = createLaunchGate({
  listPanes: () => listPanesAsync(), config: () => getScheduler(), host: () => readHostLoad(),
});
export const withSessionAdmission = gate.run;
export const currentLaunchStatus = (panes: LaunchPane[], config: Scheduler) =>
  launchStatus(panes, config, readHostLoad());

export async function createAgentSession(
  projectId: string, cwd: string, opts: CreateOpts = {},
): Promise<SessionInfo & { reused?: true }> {
  const id = opts.id ?? (opts.specId ? sessionIdForSpec(opts.specId) : undefined);
  return withSessionAdmission({ id }, async () => createSession(projectId, cwd, opts),
    (pane) => ({ ...pane, reused: true as const }));
}

export async function createOperatorSession(
  projectId: string, cwd: string, opts: CreateOpts = {},
): Promise<SessionInfo> {
  return withSessionAdmission({ id: opts.id, exempt: true }, async () => createSession(projectId, cwd, opts),
    (pane) => pane);
}
