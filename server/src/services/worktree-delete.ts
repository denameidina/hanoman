// ADR-0213 · SATU definisi "hapus worktree project". Dipakai `POST /projects/:id/worktrees/delete`
// (IDE, ADR-0132) dan `DELETE /specs/:id/worktree` (layar Review). Deps penutupan sesi, unlock,
// prune, dan kunci branch disusun di sini — jalur kedua yang menyusunnya sendiri berarti dua
// definisi yang bisa berselisih tanpa error.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../db";
import { listSessions } from "./pty";
import { sourceBranch } from "./integrate";
import { deleteBranches } from "./branch-cleanup";
import { deleteWorktrees } from "./worktree-list";
import { closeSession } from "./session-close";
import { releaseWorktree } from "./worktree-reaper";
import { projectWorktreeInputs as worktreeInputs } from "./worktree-project";

const execAsync = promisify(execFile);

// ADR-0077 · sinyal NON-git yang mengunci sebuah branch dari penghapusan. Dikumpulkan di sini
// (yang boleh menyentuh DB & tmux) lalu diserahkan sebagai himpunan nama branch ke service murni.
export async function lockInputs(id: string) {
  const open = await prisma.spec.findMany({
    where: { projectId: id, stage: { not: "done" } }, select: { id: true } });
  // Sesi backlog lahir TANPA opts.branch (session-launch.ts) → SessionInfo.branch undefined;
  // nama branch-nya diturunkan dari id sesi yang deterministik dari id spec (ADR-0015).
  // Sesi PRD/breakdown memang membawa `branch`. Keduanya harus terlindungi.
  const sessions = listSessions()
    .filter((s) => s.projectId === id && !s.exited)
    .map((s) => s.branch || (s.specId ? `hanoman/${s.id}` : ""))
    .filter(Boolean);
  return {
    openSpecBranches: new Set(open.map((s) => sourceBranch(s.id))),
    sessionBranches: new Set(sessions),
  };
}

/** Hapus worktree bernama `names` di `repoDir` milik project `projectId`. `withBranch` ikut menghapus
 *  branch-nya lewat `deleteBranches` (pagar kunci ikut). Selalu menjawab baris per nama — galat hidup
 *  di `results`, bukan di status HTTP pemanggil. */
export async function deleteProjectWorktrees(
  projectId: string, repoDir: string, names: string[], opts: { withBranch: boolean },
) {
  const locks = await lockInputs(projectId);
  return deleteWorktrees(repoDir, names, {
    withBranch: opts.withBranch,
    ...(await worktreeInputs(projectId)),
    closeSession,
    release: (repo, path) => releaseWorktree(repo, path, projectId),
    // Worktree terkunci (`git worktree lock`) tetap boleh dihapus: buka kuncinya dulu.
    unlock: async (repo, path) => {
      await execAsync("git", ["worktree", "unlock", path], { cwd: repo, timeout: 30_000 });
    },
    prune: async (repo) => {
      // Gagal-diam: registrasi basi bukan alasan menahan penghapusan (cermin prodReaperDeps).
      try { await execAsync("git", ["worktree", "prune"], { cwd: repo, timeout: 30_000 }); } catch { /* */ }
    },
    // Pagar kunci ADR-0077 ikut apa adanya — satu-satunya jalur hapus branch di codebase.
    deleteBranch: async (repo, name) => {
      const r = await deleteBranches(repo, [name], { scope: "both", ...locks });
      const first = r.results[0];
      return { ok: !!first?.ok, ...(first?.error ? { error: first.error } : {}) };
    },
  });
}
