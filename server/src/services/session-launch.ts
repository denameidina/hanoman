import { prisma } from "../db";
import type { Spec } from "@prisma/client";
import { realGit, startPrompt, continuePrompt, resumePrompt, startGoalPrompt, resolveGoalCondition, type Flow, type Autonomy, type VerifyScope, type ResumeCtx } from "@hanoman/runner";
import { resolveMethod, readSpecMethod, stampSpecMethod, isGoalShapedFlow, type Agent } from "@hanoman/shared";
import { resolveRepoDir } from "./local-binding";
import { getSetting } from "./settings";
import { ensureCodexTrust } from "./codex-trust";
import { createSession, getSession, killSession, sessionIdForSpec } from "./pty";
import { blockersForSpec, blockedNote, type SpecBlocker } from "./spec-deps";
import { phaseFilePath, decisionFilePath, readPhases } from "./session-phases";
import { specAttachmentsDir, syncSpecAttachmentsDir } from "./spec-attachment-dir";
import { assertLaunchApproved } from "./launch-authority";

// Re-ekspor supaya pemanggil (governor, test) punya satu titik impor jalur peluncuran.
export { sessionIdForSpec } from "./pty";

// SPEC-294 · ADR-0072 · satu jalur peluncuran sesi backlog — dipakai POST /terminal/sessions (manual)
// & governor scheduler. Melempar LaunchError dengan `kind` agar pemanggil memetakan status HTTP
// (route) atau menandai antrean gagal (governor).
export class LaunchError extends Error {
  // SPEC-447 · `blockers` hanya terisi untuk kind "blocked"; route memetakannya ke body 409.
  constructor(message: string, readonly kind: "needs-bind" | "worktree" | "blocked" | "not-approved",
              readonly blockers: SpecBlocker[] = []) { super(message); }
}
export type StartSpecResult = { id: string; reused?: boolean; resumed?: boolean };

// SPEC-394 · ADR-0084 — keadaan KETIGA sebuah peluncuran, di antara "re-attach" dan "sesi baru".
// Resume hanya sah bila artefaknya benar-benar masih ada (syarat yang ditulis ADR-0017): worktree
// yang masih sah, atau tip branch sesi yang bisa di-checkout. `baseSha` null = spec ini belum
// pernah punya worktree, jadi apa pun isi disk bukan miliknya.
type Resume = { worktreeKept: boolean; base?: string };
function resumeState(
  repoDir: string, worktree: string, branchTo: string, headSha: string | null,
): Resume | null {
  if (realGit.worktreeAlive(worktree)) return { worktreeKept: true };
  // Urutan mengikat: `origin/<branchTo>` lebih dulu karena ITULAH ref yang push berikutnya harus
  // fast-forward — worktree yang lahir dari basis lain membuat `git push` di akhir sesi ditolak
  // non-fast-forward (ADR-0017). `headSha` (SPEC-176) jadi jaring terakhir untuk commit yang tak
  // sempat di-push; ia bisa sudah tak terjangkau, jadi resolve-nya lunak.
  const base = realGit.revParse(repoDir, `origin/${branchTo}`)
    ?? realGit.revParse(repoDir, branchTo)
    ?? (headSha ? realGit.revParse(repoDir, headSha) : null);
  return base ? { worktreeKept: false, base } : null;
}

// SPEC-394 · fase yang sudah tercatat hidup DI LUAR worktree (session-phases.ts) dan tak ikut
// ter-checkout, jadi agen tak punya cara lain mengetahuinya selain diberi tahu di prompt.
function buildResumeCtx(repoDir: string, id: string, flow: Flow, worktreeKept: boolean): ResumeCtx {
  const phases = readPhases(phaseFilePath(repoDir, id), flow);
  return {
    recorded: phases.filter((p) => p.state === "done" || p.state === "skipped")
      .map((p) => `${p.name} ${p.state}`),
    next: phases.find((p) => p.state === "active")?.name,
    worktreeKept,
  };
}

export async function startSpecSession(
  spec: Spec,
  opts: {
    flow: Flow; model?: string; effort?: string; autonomy?: Autonomy;
    // SPEC-332 · ADR-0073 · mode goal per sesi. undefined → ikut Setting.goal.enabled;
    // false → mati walau global menyala. Governor scheduler tak memasoknya → ikut global.
    goal?: boolean; goalCondition?: string;
    // SPEC-338 · ADR-0074 · mesin sesi. undefined → ikut Setting.agent. Governor scheduler tak
    // memasoknya → ikut default global, seperti model/effort.
    agent?: Agent;
    // SPEC-376 · ADR-0080 · scope verifikasi. undefined → ikut Setting.verifyScope (default
    // "changed"). Governor scheduler tak memasoknya → ikut default global, seperti model/effort.
    verifyScope?: VerifyScope;
    // SPEC-734 · ADR-0113 · metode workflow. undefined → metode yang TERCATAT di
    // `Spec.payload.method` → `Setting.method` → "superpowers". Governor scheduler tak
    // memasoknya → ikut rantai itu, seperti model/effort.
    method?: string;
    // SPEC-447 · ADR-0093 · lewati gerbang dependency. HANYA jalur manusia yang memasoknya
    // (POST /terminal/sessions); governor & denyut lead TAK PERNAH memaksa.
    force?: boolean;
  },
): Promise<StartSpecResult> {
  const id = sessionIdForSpec(spec.id);
  const pane = getSession(id);
  if (pane && !pane.exited) return { id: pane.id, reused: true };
  try { assertLaunchApproved(spec); }
  catch (error) { throw new LaunchError((error as Error).message, "not-approved"); }
  // SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-8). Tanpa checkout lokal →
  // minta bind/clone dulu (route: 400 needsBind; governor: markFailed).
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) throw new LaunchError(`project "${spec.projectId}" belum di-bind ke checkout lokal`, "needs-bind");

  // SPEC-394 · ADR-0084 — pane HIDUP adalah sesinya: re-attach (ADR-0015), jangan sentuh apa pun.
  // Pane MATI bukan sesi: tmux menahannya (`remain-on-exit on`) hanya supaya layar terakhirnya
  // masih terbaca. Mengembalikannya sebagai "sesi" membuat tombol Lanjutkan diam — UI sendiri
  // sudah menghitung `!exited`, jadi tombol itu muncul persis saat pane-nya mati. Dibunuh dulu
  // (SPEC-362: menutup baris SessionHistory + menyimpan transkrip pane) lalu dilahirkan ulang.
  // SPEC-447 · ADR-0093 · gerbang dependency. Berdiri SESUDAH cek pane hidup (re-attach ke sesi
  // yang sedang berjalan tak boleh ikut ditolak — itu menyembunyikan pekerjaan yang justru perlu
  // dilihat operator) dan SEBELUM `killSession`/worktree, supaya penolakan tak meninggalkan efek.
  if (!opts.force) {
    const blockers = await blockersForSpec(spec, repoDir);
    if (blockers.length)
      throw new LaunchError(`${spec.id} ${blockedNote(blockers)}`, "blocked", blockers);
  }
  if (pane) killSession(id);

  // SPEC-252 · ADR-0061 · model/effort per SESI: default global, override per-instance opsional.
  // Satu bacaan Setting dipakai bersama resolusi mode goal di bawah.
  const setting = await getSetting();
  // SPEC-338 · ADR-0074 · agen menentukan blok model/effort mana yang jadi default. Override per
  // sesi (opts.model/opts.effort) tetap menang, apa pun agennya.
  const agent: Agent = opts.agent ?? setting.agent;
  const agentDefaults = agent === "codex"
    ? { model: setting.codex.model, effort: setting.codex.effort }
    : { model: setting.model, effort: setting.effort };
  const model = opts.model ?? agentDefaults.model;
  const effort = opts.effort ?? agentDefaults.effort;
  const isContinue = spec.stage === "done";
  const worktree = `${repoDir}/.worktrees/${id}`;
  const branchTo = `hanoman/${id}`;
  // SPEC-394 · ADR-0084 · keadaan ketiga: melanjutkan. `done` tetap milik SPEC-172 — kerjanya
  // umumnya sudah ter-merge ke branchFrom, jadi worktree barunya memang harus lahir dari sana
  // dan bukan dari tip branch sesi yang sudah usang.
  const resume = !isContinue && spec.baseSha
    ? resumeState(repoDir, worktree, branchTo, spec.headSha)
    : null;
  // SPEC-332 · ADR-0073 · kondisi goal: override sesi → template global → default DoD bawaan.
  // SPEC-407 · ADR-0089 · flow goal adalah pengecualiannya. (a) Mode goal SELALU menyala —
  // `opts.goal:false` tak boleh mematikannya, karena backlog goal tanpa Stop hook cuma backlog
  // biasa berprompt lain. (b) Template global DILEWATI: ia generik untuk semua sesi, sedangkan
  // item goal membawa kondisinya sendiri, dan yang lebih spesifik harus menang. Override
  // per-sesi tetap paling tinggi.
  // SPEC-825 · ADR-0123 · flow `no_effort` mewarisi ketiga aturan di atas apa adanya — satu
  // predikat bersama (`isGoalShapedFlow`), bukan dua gerbang yang bisa berselisih.
  const isGoalFlow = isGoalShapedFlow(opts.flow);
  const goalArgs = {
    flow: opts.flow, specId: spec.id, branchTo,
    spec: { payload: spec.payload ?? undefined, objective: spec.objective },
  };
  const goal = (isGoalFlow || (opts.goal ?? setting.goal.enabled))
    ? resolveGoalCondition(goalArgs, opts.goalCondition, isGoalFlow ? null : setting.goal.condition)
    : undefined;
  // SPEC-376 · ADR-0080 · scope verifikasi: override sesi → Setting global → "changed".
  const verifyScope: VerifyScope = opts.verifyScope ?? setting.verifyScope;
  // SPEC-734 · ADR-0113 · resolusi metode, cermin verifyScope: override sesi → metode yang TERCATAT
  // di item → Setting global → default. `recordedMethod` dibaca SEBELUM stempel ditulis; begitu
  // terisi ia beku, supaya mengganti default global tak memindahkan item yang sedang berjalan ke
  // direktori plan lain di tengah jalan.
  const recordedMethod = readSpecMethod(spec.payload);
  const method = resolveMethod(opts.method ?? recordedMethod ?? setting.method);

  // Worktree lahir `--detach` di commit branchFrom (fallback HEAD, SPEC-197): sesi tak pernah jalan
  // di working tree utama. baseSha disimpan agar review men-diff baseSha..headSha (SPEC-176/ADR-0030).
  // SPEC-338 · buka gerbang trust codex untuk ROOT REPO sebelum worktree lahir — worktree
  // mewarisi trust root, jadi cukup sekali per project. Gagal-diam di dalam.
  if (agent === "codex") ensureCodexTrust(repoDir);

  let baseSha: string;
  if (resume?.worktreeKept) {
    // SPEC-394 · satu-satunya jalur yang TIDAK memanggil addWorktree: helper itu selalu merebut
    // path lebih dulu (`worktree remove --force` + `rmSync`), dan di sini path itu berisi persis
    // pekerjaan yang mau dilanjutkan. baseSha dijamin non-null oleh gerbang resume di atas.
    baseSha = spec.baseSha!;
  } else {
    try {
      const born = realGit.addWorktree(repoDir, worktree, resume?.base ?? spec.branchFrom ?? "HEAD");
      // Resume: rentang review tetap diukur dari basis ASLI (ADR-0030) — yang berubah hanya titik
      // checkout-nya. Fresh: basis barulah yang dicatat.
      baseSha = resume ? spec.baseSha! : born;
    } catch (e) {
      throw new LaunchError(`gagal membuat worktree: ${(e as Error).message}`, "worktree");
    }
    // Menulis ulang baseSha saat resume akan memotong rentang review jadi "sejak dilanjutkan";
    // headSha yang di-null-kan menghapus ujung yang sudah tercatat sesi sebelumnya.
    // SPEC-408 · ADR-0090 · `startedAt` ikut jalur yang SAMA persis: ia berarti "kapan item ini
    // MULAI dikerjakan", jadi melanjutkan sesi tak boleh memundurkan/memajukannya.
    if (!resume) await prisma.spec.update({
      where: { id: spec.id }, data: { baseSha, headSha: null, startedAt: new Date() },
    });
  }

  // SPEC-734 · ADR-0113 · AC-5 · stempel metode item. Ditulis hanya bila belum ada: sesudah itu ia
  // fakta historis ("metode saat item ini PERTAMA diluncurkan"), cermin `startedAt` (ADR-0090).
  // Payload yang bukan objek biasa tak distempel — `stampSpecMethod` mengembalikan null di sana,
  // dan resolusi tetap benar tanpanya.
  if (!recordedMethod) {
    const stamped = stampSpecMethod(spec.payload, method.id);
    if (stamped) await prisma.spec.update({ where: { id: spec.id }, data: { payload: stamped } });
  }

  // SPEC-843 · ADR-0124 · lampiran dimaterialisasi ULANG di tiap kelahiran sesi, bukan hanya saat
  // diunggah: worktree bisa dibangun ulang dan direktori materialisasi bisa ikut hilang bersamanya.
  const attachments = {
    dir: specAttachmentsDir(repoDir, id),
    items: await syncSpecAttachmentsDir(spec.id, spec.projectId),
  };

  const brief = {
    id: spec.id, title: spec.title, source: spec.source,
    priority: spec.priority, objective: spec.objective, payload: spec.payload ?? undefined,
  };
  const resumeCtx = resume ? buildResumeCtx(repoDir, id, opts.flow, resume.worktreeKept) : undefined;
  let prompt: string;
  if (isGoalFlow) {
    // SPEC-407 · satu builder untuk ketiga keadaan sesi goal: `continuePrompt`/`resumePrompt`
    // bicara plan berkotak & fase perencanaan, dan sesi goal tak punya keduanya.
    prompt = startGoalPrompt(opts.flow as "goal" | "no_effort", brief, branchTo, {
      autonomy: opts.autonomy, verifyScope, resume: resumeCtx, method: method.id, attachments,
    });
  } else if (isContinue) {
    prompt = continuePrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id, attachments);
  } else if (resumeCtx) {
    prompt = resumePrompt(opts.flow, brief, branchTo, resumeCtx, opts.autonomy, verifyScope, method.id, attachments);
  } else {
    prompt = startPrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id, attachments);
  }
  // SPEC-376 · ADR-0080 · env sesi. baseSha SUDAH dihitung di addWorktree di atas — tanpa
  // meneruskannya, klausa "berkas yang berubah" tak bisa dieksekusi tanpa menebak: worktree
  // lahir `--detach`, jadi `main` belum tentu ada dan `HEAD~1` salah.
  const scopeEnv: Record<string, string> = { HANOMAN_BASE_SHA: baseSha, HANOMAN_VERIFY_SCOPE: verifyScope };
  const s = createSession(spec.projectId, worktree, {
    specId: spec.id, flow: opts.flow, model, effort, goal, agent,
    phaseFile: phaseFilePath(repoDir, id),
    decisionFile: decisionFilePath(repoDir, id),
    attachmentsDir: attachments.items.length ? attachments.dir : undefined,
    prompt,
    env: scopeEnv,
  });
  return resume ? { id: s.id, resumed: true } : { id: s.id };
}
