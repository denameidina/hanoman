import { prisma } from "../db";
import { listSessions, listSessionsAsync } from "./pty";
import { worktreeHistory } from "./session-history";
import { sessionIdForSpec } from "./session-id";
import { listWorktrees, type WorktreeInputs } from "./worktree-list";
import { prodReaperDeps } from "./worktree-reaper";

const toWorktreeSession = (s: { cwd: string; id: string; specId?: string }) =>
  ({ cwd: s.cwd, id: s.id, specId: s.specId ?? null });

// Termasuk pane exited dan project lain: cwd dapat dipakai ulang atau binding repo dibagi.
// Sinkron SENGAJA: `collectOrphanWorktrees` tak boleh menyela sesudah cek ini sampai rename.
export function worktreeSessions(): WorktreeInputs["sessions"] {
  return listSessions().map(toWorktreeSession);
}

// SPEC-1267 · jalur periodik (reaper 60 dtk) membaca daftar sesi tanpa memblokir event loop.
export async function worktreeSessionsAsync(): Promise<WorktreeInputs["sessions"]> {
  return (await listSessionsAsync()).map(toWorktreeSession);
}

export async function projectWorktreeInputs(
  projectId: string, sessions: () => WorktreeInputs["sessions"] | Promise<WorktreeInputs["sessions"]> = worktreeSessionsAsync,
): Promise<WorktreeInputs> {
  const [specs, history] = await Promise.all([
    prisma.spec.findMany({ where: { projectId }, select: { id: true, stage: true } }),
    worktreeHistory(projectId),
  ]);
  return {
    specs: new Map(specs.map((s) => [sessionIdForSpec(s.id), s])),
    history, sessions: await sessions(),
  };
}

export type OrphanDetectionDeps = {
  repos: () => Promise<{ projectId: string; repoDir: string }[]>;
  inputs: (projectId: string) => Promise<WorktreeInputs>;
};

export async function detectOrphanWorktrees(
  deps: OrphanDetectionDeps = { repos: prodReaperDeps.repos, inputs: projectWorktreeInputs },
): Promise<{ projectId: string; count: number }[]> {
  const found: { projectId: string; count: number }[] = [];
  for (const { projectId, repoDir } of await deps.repos()) {
    const report = await listWorktrees(repoDir, await deps.inputs(projectId));
    const count = report.worktrees.filter((w) => w.orphan).length;
    if (count) found.push({ projectId, count });
  }
  return found;
}
