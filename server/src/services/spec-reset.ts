import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Stage } from "@hanoman/shared";
import { artifactsToRemove } from "./stage-artifacts";
import { deleteDoc } from "./docs";
import { resolveRepoDir } from "./local-binding";
import { releaseWorktree } from "./worktree-reaper";
import { ownsWorktree } from "./session-worktree";
import { runGitOp } from "./git-ide";
import { shaResolvable } from "./spec-review";
import { sessionIdForSpec } from "./session-id";

// ADR-0149 · efek samping "kembalikan item ke titik nol" saat type-nya pindah LINTAS-ALUR.
//
// Berdiri sendiri karena dua tetangganya tak boleh menampungnya: `spec-source.ts` wajib tetap
// MURNI (gerbangnya adalah bagian yang paling pantas diuji tanpa harness), dan route bukan tempat
// untuk urutan operasi yang mengikat — urutan di `applySpecReset` di bawah punya tiga alasan yang
// masing-masing merusak bila ditukar, dan itu perlu satu tempat untuk dibaca dan diuji.

const exec = promisify(execFile);

export type ResetPlan = {
  /** Path docs relatif repo yang akan dihapus. */
  wouldDelete: string[];
  /** Path absolut worktree sesi, `null` bila sudah lepas atau tak pernah ada. */
  worktree: string | null;
  /** Nama branch lokal sesi, `null` bila tak ada. */
  branch: string | null;
};

const EMPTY: ResetPlan = { wouldDelete: [], worktree: null, branch: null };

/** Apa saja yang akan hilang. TIDAK menyentuh apa pun — inilah isi layar konfirmasi. */
export async function planSpecReset(
  spec: { id: string; projectId: string; stage: string },
): Promise<ResetPlan> {
  // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir).
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) return EMPTY;
  const sid = sessionIdForSpec(spec.id);
  const wt = join(repoDir, ".worktrees", sid);
  const branch = `hanoman/${sid}`;
  // `GitOp` sengaja tak punya varian BACA — seluruh variannya menulis. `shaResolvable` sudah
  // melakukan persis pemeriksaan ini (`git cat-file -e <ref>^{commit}`) dan sudah dipakai route
  // yang sama, jadi tak ada varian baru yang perlu lahir untuk sekadar bertanya.
  const hasBranch = await shaResolvable(repoDir, `refs/heads/${branch}`);
  return {
    // Berkas fase seluruh stage yang ditinggalkan — rentang yang sama persis dengan revert stage
    // SPEC-167, karena tujuan akhirnya memang sama: item berdiri lagi di `brainstorming`.
    wouldDelete: await artifactsToRemove(spec.projectId, spec.id, "brainstorming", spec.stage as Stage),
    worktree: existsSync(wt) ? wt : null,
    branch: hasBranch ? branch : null,
  };
}

/**
 * Jalankan rencana. Urutannya MENGIKAT, dan tiap langkah punya alasannya sendiri:
 *
 * 1. dokumen fase dulu — ia dibaca lewat repoDir dan tak bergantung pada worktree;
 * 2. worktree dilepas SEBELUM branch dihapus — git menolak menghapus branch yang sedang
 *    di-checkout sebuah worktree;
 * 3. branch dihapus SEBELUM pemanggil menulis `stage: "brainstorming"` ke DB — kunci `spec-open`
 *    di `branch-cleanup.ts` menyala untuk backlog yang belum selesai, jadi sesudah baris DB
 *    berubah tak ada lagi jalur yang mau membuang branch itu.
 *
 * Tiap langkah gagal-diam: reset yang setengah jalan lebih baik daripada type yang gagal
 * berpindah, dan sisanya tetap bisa dibuang lewat tab Worktrees (SPEC-861) / Branches (SPEC-859).
 */
export async function applySpecReset(
  spec: { id: string; projectId: string }, plan: ResetPlan,
): Promise<void> {
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) return;
  for (const rel of plan.wouldDelete) await deleteDoc(spec.projectId, rel).catch(() => { });
  // SPEC-362 · `ownsWorktree` bukan formalitas: tanpa gerbang itu, project yang di-bind ke sebuah
  // checkout di bawah `.worktrees/` kehilangan seluruh checkout-nya.
  if (plan.worktree && ownsWorktree(repoDir, plan.worktree)) {
    // SPEC-742 · ADR-0116 · lewat `.trash`, bukan `rm` langsung — penghapusan byte-nya di latar.
    try { releaseWorktree(repoDir, plan.worktree, spec.projectId); } catch { /* tab Worktrees */ }
    // `trashWorktree` hanya me-RENAME direktorinya; registrasi worktree di `.git/worktrees/`
    // tetap hidup, dan selama itu git menganggap branch sesi masih ter-checkout dan menolak
    // menghapusnya. `addWorktree` sudah memanggil prune persis sesudah trash karena alasan yang
    // sama (runner/src/git.ts:84); jalur ini butuh yang sama sebelum langkah branch di bawah.
    await exec("git", ["worktree", "prune"], { cwd: repoDir }).catch(() => { });
  }
  if (plan.branch) {
    // Sengaja BUKAN `deleteBranches`: gerbang di sana dirancang untuk pembersihan massal
    // tak-terarah, tempat operator tak melihat satu per satu apa yang dibuang — dan salah satu
    // kuncinya (`spec-open`) justru menyala untuk item yang sedang kita kembalikan ke backlog.
    // Di sini operator menunjuk satu branch dan sudah menyetujui daftarnya.
    // `remote` tak diisi: branch di origin tak pernah disentuh operasi ini.
    await runGitOp(repoDir, { op: "delete-branch", name: plan.branch, force: true });
  }
}
