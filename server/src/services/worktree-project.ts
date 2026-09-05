import { prisma } from "../db";
import { listSessions } from "./pty";
import { worktreeHistory } from "./session-history";
import { sessionIdForSpec } from "./session-id";
import { listWorktrees, type WorktreeInputs } from "./worktree-list";
import { prodReaperDeps } from "./worktree-reaper";

export function worktreeSessions(): WorktreeInputs["sessions"] {
  // Termasuk pane exited dan project lain: cwd dapat dipakai ulang atau binding repo dibagi.
  return listSessions().map((s) => ({ cwd: s.cwd, id: s.id, specId: s.specId ?? null }));
}

export async function projectWorktreeInputs(
  projectId: string, sessions = worktreeSessions,
): Promise<WorktreeInputs> {
  const [specs, history] = await Promise.all([
    prisma.spec.findMany({ where: { projectId }, select: { id: true, stage: true } }),
    worktreeHistory(projectId),
  ]);
  return {
    specs: new Map(specs.map((s) => [sessionIdForSpec(s.id), s])),
    history, sessions: sessions(),
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
