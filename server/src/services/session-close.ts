import type { Flow } from "@hanoman/runner";
import { realGit } from "@hanoman/runner";
import type { Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { getSession, killSession } from "./pty";
import { phaseFilePath, readPhases, stageForRun } from "./session-phases";
import { recordSessionResult } from "./session-result";
import { recordCompletion } from "./notifications";
import { STAGES } from "./stage-machine";
import { recordHeadSha } from "./spec-head";
import { resolveRepoDir } from "./local-binding";
import { ownsWorktree } from "./session-worktree";
import { releaseWorktree } from "./worktree-reaper";

// Stage hanya maju (ADR-0008). Agen bisa saja tak pernah menulis berkas fasenya; itu tak
// boleh menyeret backlog item mundur ke `brainstorming`.
async function advanceStage(
  specId: string, repoDir: string, sessionId: string, flow: Flow, worktree: string,
): Promise<void> {
  // stageForRun (bukan stageFor): `Execute done` tak boleh mencapai `done` selama plan
  // spec-nya di worktree masih punya `- [ ]` — tahan di `executing` (SPEC-173, ADR-0029).
  const next = stageForRun(readPhases(phaseFilePath(repoDir, sessionId), flow), worktree, specId);
  if (!next) return;
  const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { stage: true, title: true, projectId: true } });
  if (!spec || STAGES.indexOf(next) <= STAGES.indexOf(spec.stage as Stage)) return;
  // CAS (SPEC-197): hanya maju bila stage DB belum berubah sejak dibaca. Revert konkuren
  // (PATCH /specs mundur + hapus artefak docs) tak boleh ter-overwrite maju lagi.
  const { count } = await prisma.spec.updateMany({ where: { id: specId, stage: spec.stage }, data: { stage: next } });
  if (count === 0) return; // stage berubah di bawah kita → jangan lanjut ke recordCompletion
  // SPEC-213 · ADR-0047 · catat ringkasan hasil (activity log) untuk transisi stage ini —
  // whitelist field saja, tanpa transkrip/kredensial (AC-20/21). Best-effort: jangan blok sesi.
  let commitSha: string | null = null;
  try { commitSha = realGit.headSha(worktree); } catch { /* worktree lenyap */ }
  await recordSessionResult({
    projectId: spec.projectId, specId, oldStage: spec.stage, newStage: next,
    commitSha, branch: `hanoman/${sessionId}`, status: next === "done" ? "done" : "progress",
  }).catch(() => { /* activity log opsional */ });
  // SPEC-180 · transisi masuk `done` (guard di atas menjamin stage lama < done).
  if (next === "done") await recordCompletion(specId, spec.title, spec.projectId);
}

// SPEC-861 · ADR-0132 · SATU definisi penutupan sesi, dipakai `DELETE /terminal/sessions/:id`
// DAN `POST /projects/:id/worktrees/delete`. Menyalinnya ke call site kedua berarti mengulang
// kelas bug "satu definisi, N call site" (SPEC-431/448/475/481) pada operasi yang, bila terlewat,
// membuang kemajuan stage dan bukti dependency antar-backlog.
//
// Mengembalikan `null` bila sesinya tak ada; `{ cleanup }` = nama entri `.trash` yang lahir
// (SPEC-742/ADR-0116), `null` bila memang tak ada yang perlu dilepas.
export async function closeSession(id: string): Promise<{ cleanup: string | null } | null> {
  const s = getSession(id);
  if (!s) return null;

  // Sesi ber-flow (run/reverse) DAN sesi integrasi (SPEC-175, tanpa flow) sama-sama hidup di
  // worktree-nya sendiri di `.worktrees/*` — keduanya harus dibersihkan. Hanya yang ber-spec-flow
  // menggerakkan stage. Terminal biasa (cwd = repoDir) tak tersentuh.
  // SPEC-362 · syarat ini hanya memilih sesi mana yang perlu BOOKKEEPING akhir; penghapusan
  // worktree digerbangi `ownsWorktree` di bawah, karena bentuk path saja bukan bukti kepemilikan.
  if (s.flow || s.cwd.includes("/.worktrees/")) {
    // SPEC-213 · pakai binding lokal (menang atas Project.repoDir) agar worktree sesi ter-bind
    // pada project murni-metadata tetap dibersihkan.
    const repoDir = await resolveRepoDir(s.projectId);
    if (repoDir) {
      // SPEC-742 · ADR-0116 · dua bacaan ini WAJIB tetap di sini, sebelum worktree-nya lepas:
      // keduanya membaca berkas fase, plan, dan HEAD dari DALAM worktree. Memindahkannya ke latar
      // berarti stage tak maju dan headSha hilang — dan bersamanya bukti dependency antar-backlog.
      // Keduanya murah; yang mahal cuma penghapusan byte-nya, dan itulah yang pindah ke latar.
      if (s.specId) {
        if (s.flow) await advanceStage(s.specId, repoDir, id, s.flow, s.cwd);
        // HEAD worktree = ujung range review sesudah item selesai (SPEC-176, ADR-0030).
        // Gagal-diam agar tak memblok penutupan sesi.
        // SPEC-475 · lewat penulis BERSAMA — jalur ini dulu satu-satunya yang menulis kolomnya,
        // dan itulah sebabnya dua jalur otonom lain kehilangan bukti dependency-nya.
        await recordHeadSha(s.specId, s.cwd);
      }
      killSession(id);
      // SPEC-362 · hanya lepas worktree yang benar-benar milik sesi ini. Tanpa gerbang ini,
      // project yang di-bind ke checkout di bawah `.worktrees/` kehilangan seluruh checkout-nya
      // saat sebuah terminal biasa ditutup (`cwd === repoDir`). `rename` sama merusaknya dengan
      // `rm`, jadi gerbangnya berdiri di depan KEDUANYA.
      const cleanup = ownsWorktree(repoDir, s.cwd) ? releaseWorktree(repoDir, s.cwd, s.projectId) : null;
      return { cleanup };
    }
  }
  killSession(id);
  return { cleanup: null };
}
