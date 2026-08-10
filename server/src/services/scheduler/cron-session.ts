import { prisma } from "../../db";
import { realGit, cronPrompt } from "@hanoman/runner";
import type { Agent } from "@hanoman/shared";
import { resolveRepoDir } from "../local-binding";
import { terminalAgentDefaults } from "../settings";
import { ensureCodexTrust } from "../codex-trust";
import { createSession, getSession } from "../pty";

export type CronLaunchInput = {
  id: string; projectId: string; name: string; prompt: string;
  agent: string | null; model: string | null; effort: string | null;
};

// SPEC-646 · ADR-0112 · id sesi DETERMINISTIK per cron. Ia bukan kenyamanan penamaan melainkan
// mekanisme "satu sesi per unit kerja" (ADR-0015) itu sendiri: pane `cron-<id>` yang masih hidup
// adalah satu-satunya bukti yang dibutuhkan, dan bukti itu selamat dari restart server tanpa satu
// pun kolom yang bisa basi.
export const cronSessionId = (cronId: string) =>
  `cron-${cronId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;

/** Sesi cron sudah berjalan? Mengembalikan id pane hidup, atau null. */
export function liveCronSession(cronId: string): string | null {
  const s = getSession(cronSessionId(cronId));
  return s && !s.exited ? s.id : null;
}

/**
 * Lahirkan sesi cron di worktree isolasi project. Cermin cabang `reverse` di `routes/terminal.ts`:
 * project-level, tanpa `flow`, worktree lahir dari HEAD dan DIPAKAI ULANG bila masih sah (SPEC-394
 * — `addWorktree` selalu merebut path lebih dulu, dan itu fatal untuk pekerjaan yang belum sempat
 * di-commit).
 *
 * Melempar bila project belum di-bind atau worktree gagal lahir; pemanggil (governor) yang menandai
 * barisnya `failed` beserta pesannya.
 */
export async function startCronSession(cron: CronLaunchInput): Promise<{ id: string }> {
  const repoDir = await resolveRepoDir(cron.projectId);
  if (!repoDir) throw new Error(`project "${cron.projectId}" belum di-bind ke checkout lokal`);
  const project = await prisma.project.findUnique({ where: { id: cron.projectId } });
  if (!project) throw new Error(`project "${cron.projectId}" tak ada`);

  // SPEC-517 · resolver yang SAMA dengan form "Sesi baru": knob cron tak boleh bisa berselisih
  // dengan knob sesi manual. Kolom null = warisi.
  const { agent, model, effort } = await terminalAgentDefaults({
    agent: (cron.agent ?? undefined) as Agent | undefined,
    model: cron.model ?? undefined,
    effort: cron.effort ?? undefined,
  });
  // SPEC-377/383 · diturunkan dari agen HASIL resolusi, bukan `Setting.agent` — keduanya bisa
  // berbeda, dan membaca yang salah membuat sesi mentok di layar trust codex tanpa manusia di pane.
  if (agent === "codex") ensureCodexTrust(repoDir);

  const id = cronSessionId(cron.id);
  const wt = `${repoDir}/.worktrees/${id}`;
  if (!realGit.worktreeAlive(wt)) realGit.addWorktree(repoDir, wt, "HEAD");

  const s = createSession(cron.projectId, wt, {
    id, agent, model, effort,
    prompt: cronPrompt(
      { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
      { name: cron.name, prompt: cron.prompt },
    ),
  });
  return { id: s.id };
}
