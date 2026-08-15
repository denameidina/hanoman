import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAutoMerge, autoMergeTargetOf } from "@hanoman/shared";
import { prisma } from "../db";
import { integrate, sourceBranch, discardMergeWorktree, deleteMergedBranch } from "./integrate";
import { resolveRepoDir } from "./local-binding";
import { defaultBranch } from "./branches";
import { recordAutoMerge } from "./notifications";

// SPEC-486 · ADR-0103 · EKSEKUTOR kebijakan auto-merge.
//
// Kenapa sweep dan bukan hook di titik `done`: `stage = "done"` dipersist di TIGA jalur
// (`live-specs.ts`, `scheduler/reconcile.ts`, `DELETE /terminal/sessions/:id`), dan menempelkan
// efek samping di ketiganya adalah kelas bug yang sudah digigit repo ini empat kali
// (SPEC-431/448/475/481) — efek samping tak punya tipe yang memaksanya konsisten. Lebih dari itu,
// tak satu pun dari ketiganya AMAN sebagai pemicu: prompt sesi menyuruh agen menulis baris fase
// terakhir LEBIH DULU, baru `commit` + `git push`. `liveSpecs` karena itu bisa memindahkan stage
// ke `done` beberapa detik sebelum `hanoman/<spec>` ada di origin.
//
// Sweep menyelesaikan keduanya sekaligus: nol call site, dan "belum siap" cukup dicoba lagi.

/** Selesai lebih lama dari ini = sejarah. Pagar yang membuat MENYALAKAN setting tak pernah
 *  menggabungkan seluruh backlog lama sebuah project. */
export const AUTO_MERGE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Sesudah ini, branch kerja yang tak kunjung muncul dilaporkan — bukan ditunggu diam-diam. */
export const AUTO_MERGE_GRACE_MS = 15 * 60 * 1000;
const TICK_MS = 60_000;

export type AutoMergeDeps = {
  repoDir: (projectId: string) => Promise<string | null>;
  defaultBranch: (repoDir: string) => Promise<string | null>;
  /** Tip `hanoman/<spec>`: origin lebih dulu (hasil push), lalu lokal. null = branch belum ada. */
  sourceTip: (repoDir: string, branch: string) => Promise<string | null>;
  /** `sha` sudah menjadi leluhur `tip`? = bukti push sesi sudah mendarat. */
  contains: (repoDir: string, tip: string, sha: string) => Promise<boolean>;
  integrate: typeof integrate;
  discardWorktree: (repoDir: string, wt: string) => Promise<void>;
  deleteBranch: (repoDir: string, branch: string) => Promise<void>;
};

const exec = promisify(execFile);
const GIT = { timeout: 30_000, maxBuffer: 1 << 24, encoding: "utf8" as const };
const gitOut = async (cwd: string, args: string[]): Promise<string | null> => {
  try { return (await exec("git", args, { cwd, ...GIT })).stdout.trim(); } catch { return null; }
};

export const prodAutoMergeDeps: AutoMergeDeps = {
  repoDir: resolveRepoDir,
  defaultBranch,
  // Tanpa `fetch`: `git push` dari worktree repo yang sama memperbarui remote-tracking ref
  // di repo itu juga, jadi origin/<branch> sudah mutakhir tepat setelah sesi mem-push.
  sourceTip: async (repoDir, branch) =>
    (await gitOut(repoDir, ["rev-parse", "--verify", "-q", "--end-of-options", `refs/remotes/origin/${branch}^{commit}`]))
    ?? (await gitOut(repoDir, ["rev-parse", "--verify", "-q", "--end-of-options", `refs/heads/${branch}^{commit}`])),
  // `merge-base --is-ancestor` keluar 0/1 tanpa output → "" saat benar, null saat salah/galat.
  contains: async (repoDir, tip, sha) =>
    (await gitOut(repoDir, ["merge-base", "--is-ancestor", "--end-of-options", sha, tip])) !== null,
  integrate,
  discardWorktree: discardMergeWorktree,
  deleteBranch: deleteMergedBranch,
};

type Candidate = { specId: string; projectId: string; doneAt: Date };

/** Kandidat mentah = notifikasi `done:` dalam window yang BELUM punya penanda `automerge:`.
 *  Baris `done:` ditulis `recordCompletion` tepat pada transisi ke `done` di ketiga jalur, jadi
 *  ia satu-satunya stempel "kapan item ini selesai" yang sudah ada dan konsisten. */
async function candidates(now: Date): Promise<Candidate[]> {
  const since = new Date(now.getTime() - AUTO_MERGE_WINDOW_MS);
  const done = await prisma.notification.findMany({
    where: { type: "done", createdAt: { gte: since }, specId: { not: null } },
    select: { specId: true, projectId: true, createdAt: true },
  });
  if (!done.length) return [];
  const keys = done.map((d) => `automerge:${d.specId}`);
  const marked = new Set(
    (await prisma.notification.findMany({ where: { key: { in: keys } }, select: { key: true } }))
      .map((n) => n.key!),
  );
  return done
    .filter((d) => !marked.has(`automerge:${d.specId}`))
    .map((d) => ({ specId: d.specId!, projectId: d.projectId ?? "", doneAt: d.createdAt }));
}

/** Satu putaran. Mengembalikan jumlah item yang DISELESAIKAN (ditandai) pada putaran ini —
 *  item yang sengaja ditunggu tidak dihitung. */
export async function sweepAutoMerge(
  deps: AutoMergeDeps = prodAutoMergeDeps, now: Date = new Date(),
): Promise<number> {
  const list = await candidates(now);
  if (!list.length) return 0;
  let settled = 0;
  for (const c of list) {
    try { if (await settleOne(c, deps, now)) settled++; }
    catch (e) { console.error(`auto-merge ${c.specId}:`, e); }   // satu item gagal ≠ sisanya batal
  }
  return settled;
}

async function settleOne(c: Candidate, deps: AutoMergeDeps, now: Date): Promise<boolean> {
  const spec = await prisma.spec.findUnique({ where: { id: c.specId } });
  if (!spec || spec.stage !== "done") return false;
  // SPEC-804 · ADR-0120 · "ditandai selesai manual" berarti pekerjaannya beres DI LUAR sesi — tak
  // ada yang perlu di-merge. Tanpa gerbang ini item tanpa sesi melahirkan notifikasi "branch kerja
  // belum ter-push" sesudah grace, dan item yang punya branch sesi lama yang DITINGGALKAN akan
  // di-merge setengah jadi. Diam, bukan `report()`: tak ada yang perlu dilaporkan ke operator.
  if (spec.manualDone) return false;
  const project = await prisma.project.findUnique({ where: { id: spec.projectId } });
  if (!project) return false;

  const policy = resolveAutoMerge(
    (project as { autoMerge?: unknown }).autoMerge, (spec as { autoMerge?: unknown }).autoMerge);
  if (policy.mode === "off") return false;   // tak ada kebijakan → tak ada jejak, tak ada penanda

  const report = (t: string) => recordAutoMerge(spec.id, spec.projectId, t).then(() => true);

  const repoDir = await deps.repoDir(spec.projectId);
  if (!repoDir)
    return report(`Auto-merge ${spec.id} dilewati — project belum di-bind ke checkout lokal`);

  const target = autoMergeTargetOf(
    policy, policy.mode === "default-branch" ? await deps.defaultBranch(repoDir) : null);
  if (!target)
    return report(`Auto-merge ${spec.id} dilewati — default branch repo tak bisa diresolve; pilih branch tujuan di Settings project`);

  // Kesiapan: branch kerja ADA, dan (bila ujung kerjanya diketahui) push-nya sudah mendarat.
  const branch = sourceBranch(spec.id);
  const tip = await deps.sourceTip(repoDir, branch);
  const ready = tip !== null && (spec.headSha === null || await deps.contains(repoDir, tip, spec.headSha));
  if (!ready) {
    if (now.getTime() - c.doneAt.getTime() <= AUTO_MERGE_GRACE_MS) return false;   // tunggu, coba lagi
    return report(`Auto-merge ${spec.id} dilewati — branch kerja \`${branch}\` belum ter-push ke origin`);
  }

  const res = await deps.integrate(repoDir, spec.id, "merge", target);
  if (res.status === "clean") {
    // Hapus branch kerja HANYA sesudah merge terbukti bersih (batasan spec). Best-effort:
    // kegagalan hapus tak me-rollback merge yang sudah mendarat.
    if (policy.deleteBranch) await deps.deleteBranch(repoDir, branch).catch(() => { });
    return report(`Auto-merge ${spec.id} → ${target} bersih (${res.detail})`);
  }
  if (res.status === "conflict") {
    // ADR-0031 meninggalkan worktree konflik by design (untuk sesi agen); auto-merge tak
    // melahirkan sesi, jadi ia membereskannya sendiri. Branch kerja TIDAK tersentuh — operator
    // bisa menekan Rebase/Merge di backlog dan mendapat jalur konflik ADR-0031 yang lengkap.
    await deps.discardWorktree(repoDir, res.worktree).catch(() => { });
    return report(`Auto-merge ${spec.id} → ${target} GAGAL: konflik — branch kerja \`${branch}\` utuh, selesaikan lewat Rebase / Merge di backlog`);
  }
  return report(`Auto-merge ${spec.id} → ${target} GAGAL: ${res.error}`);
}

let timer: NodeJS.Timeout | undefined;
let busy = false;

export async function tick(): Promise<void> {
  if (busy) return;   // satu putaran bisa memakan detik (fetch + merge); jangan menumpuk
  busy = true;
  try { await sweepAutoMerge(); }
  catch (e) { console.error("auto-merge sweep:", e); }
  finally { busy = false; }
}

/** Dipanggil `server.ts` SAJA (app.ts bebas-timer). unref → tak menahan proses. */
export function startAutoMerge(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}
export function stopAutoMerge(): void { if (timer) clearInterval(timer); timer = undefined; }
