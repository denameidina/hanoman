import type { LeadDecision } from "@prisma/client";
import { flowForSource, leadActionAllowed, leadRefusalReason, type LeadAction } from "@hanoman/shared";
import { prisma } from "../../db";
import { getSession, killSession, sessionIdForSpec } from "../pty";
import { planComplete } from "../session-phases";
import { resolveRepoDir } from "../local-binding";
import { worktreeDir } from "../spec-review";
import { startSpecSession } from "../session-launch";
import { integrate } from "../integrate";
import { recordLeadDecision } from "../notifications";
import { getLead } from "./config";
import { leadProjectConfig } from "./project-config";
import { runVerify } from "./verify";
import { withActor } from "../webhooks/actor";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// SPEC-409 · ADR-0091 · H · PERMUKAAN TINDAKAN LEAD. Satu-satunya tempat sebuah keputusan lead
// berubah jadi perbuatan.
//
// Batas kerasnya ditegakkan DI SINI (server), bukan dengan memasang hook penolak perintah pada
// sesi agen pekerja (AC-34) — ADR-0037 tetap dicabut, sesi pekerja tetap `--dangerously-skip-
// permissions`. Yang dibatasi adalah apa yang bisa DIPANGGIL lead, dan `switch` di bawah ini
// tertutup: tak ada cabang `default` yang mengeksekusi apa pun.

export type ApplyResult = { ok: boolean; detail: string };

export type ApplyDeps = {
  killSession: (id: string) => boolean;
  sessionExists: (id: string) => boolean;
  startSpec: typeof startSpecSession;
  repoDir: (projectId: string) => Promise<string | null>;
  planDone: (cwd: string, specId: string) => boolean;
  integrate: typeof integrate;
  notify: (id: string, title: string, projectId: string, specId: string | null, sessionId: string | null) => Promise<void>;
  /** ADR-0228 · bukti hijau dijalankan server di worktree sesi. */
  verify: typeof runVerify;
  /** ADR-0228 · worktree punya perubahan yang belum di-commit? */
  dirty: (cwd: string) => Promise<boolean>;
  /** ADR-0228 · branch target & perintah verifikasi per proyek. */
  targetOf: (projectId: string) => Promise<{ branch: string; verifyCommand: string }>;
};

const execFileAsync = promisify(execFile);

export const prodApplyDeps: ApplyDeps = {
  killSession: (id) => { try { return killSession(id); } catch { return false; } },
  sessionExists: (id) => { try { return !!getSession(id); } catch { return false; } },
  startSpec: startSpecSession,
  repoDir: resolveRepoDir,
  planDone: planComplete,
  integrate,
  notify: recordLeadDecision,
  verify: runVerify,
  // Bacaan gagal = KOTOR: syarat objektif yang tak bisa dibuktikan tak boleh dianggap terpenuhi.
  dirty: async (cwd) => {
    try { return (await execFileAsync("git", ["status", "--porcelain"], { cwd })).stdout.trim().length > 0; }
    catch { return true; }
  },
  targetOf: async (projectId) => {
    const p = leadProjectConfig(await getLead(), projectId);
    return { branch: p.targetBranch, verifyCommand: p.verifyCommand };
  },
};

// SPEC-481 · ADR-0100 · tindakan lead adalah satu-satunya penulis latar yang punya identitas
// sendiri. Dibungkus di SATU titik terluar, bukan per tindakan: membungkus tiap `case` adalah N
// call site untuk satu keputusan — kelas bug SPEC-475. Tanpa ini integrate/stop yang dilakukan
// lead terbaca `system` di amplop webhook.
export function applyAction(row: LeadDecision, deps: ApplyDeps = prodApplyDeps): Promise<ApplyResult> {
  return withActor({ kind: "lead", id: null, label: "hanoman-lead" }, () => applyActionInner(row, deps));
}

async function applyActionInner(row: LeadDecision, deps: ApplyDeps): Promise<ApplyResult> {
  const action = row.action;
  // Sabuk kedua: `decide()` sudah menurunkan aksi tak dikenal jadi `none`, tapi baris jejak bisa
  // datang dari mana saja (override operator, migrasi data). Gerbangnya tak boleh cuma satu.
  if (!leadActionAllowed(action)) {
    await deps.notify(row.id, `Lead menolak tindakan terkunci: ${leadRefusalReason(action)}`,
      row.projectId, row.specId, row.sessionId);
    return { ok: false, detail: `tindakan terkunci: ${leadRefusalReason(action)}` };
  }
  switch (action as LeadAction) {
    // Keputusan yang wujudnya memang hanya baris jejak.
    case "none":
    case "answer-session":     // sudah diketikkan ke pane oleh pintu deteksi
    case "order-queue":        // sudah diserahkan ke antrean oleh denyut (AC-13)
      return { ok: true, detail: "tak ada tindakan tersisa" };

    // Ditata sebagai keputusan, dieksekusi operator di versi ini (lihat ADR-0091 §Konsekuensi).
    case "hold-work":
    case "push-branch":
    case "run-migration":
      return { ok: true, detail: `dicatat sebagai keputusan; "${action}" dieksekusi operator di versi ini` };

    case "stop-session":
      return stopSession(row, deps);
    case "start-session":
    case "resume-session":
    case "restart-session":
      return relaunch(row, deps);
    case "integrate-main":
      return integrateMain(row, deps);
  }
}

/**
 * AC-32a · menghentikan sesi TIDAK menghapus worktree-nya. Karena itu ia memanggil `killSession`
 * langsung — BUKAN `DELETE /terminal/sessions/:id`, yang memang menghapus worktree saat operator
 * menutup sesi (SPEC-362) dan akan membuang pekerjaan yang belum di-commit.
 */
function stopSession(row: LeadDecision, deps: ApplyDeps): ApplyResult {
  if (!row.sessionId) return { ok: false, detail: "keputusan ini tak menunjuk sesi" };
  const killed = deps.killSession(row.sessionId);
  return killed
    ? { ok: true, detail: `sesi ${row.sessionId} dihentikan; worktree dibiarkan utuh (AC-32a)` }
    : { ok: false, detail: `sesi ${row.sessionId} tak ada` };
}

/**
 * AC-18 · "lanjutkan" memakai jalur lanjutkan-sesi yang sudah ada (ADR-0084) dan TIDAK menulis
 * ulang basis review: `startSpecSession` sendiri yang memilih live/resume/fresh, dan jalur resume
 * di sana sengaja tak menyentuh `baseSha`/`headSha`.
 *
 * "Ulangi" (`restart-session`) berbagi jalur yang sama dengan satu perbedaan: pane lama dibunuh
 * lebih dulu. Ia TIDAK bisa berarti "hapus worktree lalu mulai dari nol" — penghapusan worktree
 * terkunci untuk lead (AC-32), jadi ulangan lead selalu berdiri di atas worktree yang ada.
 */
async function relaunch(row: LeadDecision, deps: ApplyDeps): Promise<ApplyResult> {
  if (!row.specId) return { ok: false, detail: "keputusan ini tak menunjuk backlog" };
  const spec = await prisma.spec.findUnique({ where: { id: row.specId } });
  if (!spec) return { ok: false, detail: `backlog ${row.specId} tak ada` };
  const sid = sessionIdForSpec(spec.id);
  // Pane MATI bukan sesi (ADR-0084): ia harus dibunuh dulu supaya `startSpecSession` melihat
  // keadaan resume, bukan keadaan live. Pane hidup dibiarkan — itu re-attach, bukan sesi kedua.
  if (deps.sessionExists(sid)) deps.killSession(sid);
  const r = await deps.startSpec(spec, { flow: flowForSource(spec.source) });
  return { ok: true, detail: `sesi ${r.id}${r.resumed ? " dilanjutkan" : " dimulai"}` };
}

/**
 * AC-19 · bukti yang menjadi dasar keputusan integrasi DICATAT pada jejaknya.
 * ADR-0228 · syarat OBJEKTIF diperiksa server dari berkas, git, dan perintah verifikasi — bukan
 * penilaian prosa lead — dan TAK BISA dilonggarkan untuk jalur lead: `requireGreenBeforeIntegrate`
 * tak lagi dibaca di sini (merge tanpa bukti hijau berarti "minta izin", ditegakkan `guard.ts`).
 * Urutan murah → mahal: plan tanpa `- [ ]` (ADR-0029), worktree bersih, satu integrasi per proyek,
 * `verifyCommand` hijau, lalu merge ke `targetBranch` proyek (bukan `main` terpatok).
 *
 * `detail` hasil gagal DIAWALI kode (`plan-open:`, `worktree-dirty:`, `integrate-busy:`,
 * `verify-failed:`, `conflict:`) — `post.ts` memetakannya menjadi event `integrate-failed`.
 *
 * SPEC-451 · integrasi yang BERSIH juga MELEPAS panenya. Tanpa itu jawaban `integrate-main` cuma
 * menyelesaikan separuh keluhan: hasilnya masuk main, tapi pane sesi yang sudah selesai tetap
 * terhitung `liveCount()` governor (scheduler/engine.ts) — dan pane sesi sukses tak pernah mati
 * sendiri (SPEC-433), jadi slot itu tertahan selamanya dan antrean tak pernah dapat ruang.
 */
export const integrateLocks = new Set<string>();

async function integrateMain(row: LeadDecision, deps: ApplyDeps): Promise<ApplyResult> {
  if (!row.specId) return { ok: false, detail: "no-session: keputusan ini tak menunjuk backlog" };
  const repoDir = await deps.repoDir(row.projectId);
  if (!repoDir) return { ok: false, detail: `no-session: project ${row.projectId} belum di-bind ke checkout lokal` };
  const spec = await prisma.spec.findUnique({ where: { id: row.specId } });
  if (!spec) return { ok: false, detail: `no-session: backlog ${row.specId} tak ada` };

  const sid = sessionIdForSpec(spec.id);
  const cwd = worktreeDir(repoDir, spec.id);
  const evidence: string[] = [];
  const refuse = async (code: string, why: string): Promise<ApplyResult> => {
    await recordEvidence(row, evidence, `integrasi DIBATALKAN — ${why}`);
    await deps.notify(row.id, `Lead membatalkan integrasi ${spec.id}: ${why.split("\n")[0]}`,
      row.projectId, row.specId, row.sessionId);
    return { ok: false, detail: `${code}: ${why}; ${evidence.join("; ")}` };
  };

  const done = deps.planDone(cwd, spec.id);
  evidence.push(done ? "plan tak menyisakan `- [ ]`" : "plan MASIH menyisakan `- [ ]`");
  evidence.push(deps.sessionExists(sid) ? `pane ${sid} masih ada` : `pane ${sid} sudah tak ada`);
  if (!done) return refuse("plan-open", "plan belum tuntas");
  if (await deps.dirty(cwd)) {
    evidence.push("worktree kotor");
    return refuse("worktree-dirty", "worktree punya perubahan yang belum di-commit");
  }
  evidence.push("worktree bersih");
  if (integrateLocks.has(row.projectId)) return refuse("integrate-busy", "integrasi lain sedang berjalan di proyek ini");

  integrateLocks.add(row.projectId);
  try {
    const target = await deps.targetOf(row.projectId);
    if (target.verifyCommand.trim()) {
      const v = await deps.verify(cwd, target.verifyCommand, 15 * 60_000);
      evidence.push(`\`${target.verifyCommand}\` → ${v.ok ? "hijau" : `merah (keluar ${v.code})`}`);
      if (!v.ok) return refuse("verify-failed", `verifikasi merah\n${v.tail.slice(-1500)}`);
    } else {
      evidence.push("tanpa perintah verifikasi (disetujui manusia)");
    }

    const res = await deps.integrate(repoDir, spec.id, "merge", `local:${target.branch}`);
    evidence.push(`integrate → ${target.branch}: ${res.status}`);
    // Pane dilepas hanya pada integrasi BERSIH: hasil `conflict` meninggalkan worktree yang justru
    // harus diselesaikan, dan panenya masih dibutuhkan. `killSession` LANGSUNG, bukan
    // `DELETE /terminal/sessions/:id` — worktree sesi tetap utuh (AC-32a), jadi rentang review
    // ADR-0030 selamat dan "Lanjutkan" (ADR-0084) tetap bermakna.
    if (res.status === "clean" && deps.sessionExists(sid)) {
      evidence.push(deps.killSession(sid) ? `pane ${sid} dilepas (worktree utuh)` : `pane ${sid} gagal dilepas`);
    }
    await recordEvidence(row, evidence, res.status === "clean" ? "integrasi bersih" : `integrasi tak bersih: ${res.status}`);
    if (res.status !== "clean") {
      await deps.notify(row.id, `Integrasi ${spec.id} oleh lead tak bersih (${res.status}) — butuh operator`,
        row.projectId, row.specId, row.sessionId);
      return { ok: false, detail: `conflict: integrasi ke ${target.branch} tak bersih (${res.status}); ${evidence.join("; ")}` };
    }
    return { ok: true, detail: evidence.join("; ") };
  } finally {
    integrateLocks.delete(row.projectId);
  }
}

/** Bukti ditempel ke baris jejak yang bersangkutan — bukan ke baris baru (AC-19: "pada jejak keputusan yang bersangkutan"). */
async function recordEvidence(row: LeadDecision, evidence: string[], verdict: string): Promise<void> {
  await prisma.leadDecision.update({
    where: { id: row.id },
    data: { reason: `${row.reason}\n\nBukti integrasi: ${evidence.join("; ")} → ${verdict}.` },
  }).catch(() => { /* baris bisa saja sudah ditimpa operator; bukti tetap ada di log tindakan */ });
}
