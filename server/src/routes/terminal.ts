import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { prisma } from "../db";
import { zTerminalSession, zIntegrate, zTerminalSteerInput, METHODS, type Stage } from "@hanoman/shared";
import { resolveHome, realGit, startProjectPrompt, startPrdPrompt, startScaffoldPrompt, startBreakdownPrompt, RESUMED_WORKTREE_NOTE, CODE_STYLE_CLAUSE, type Flow } from "@hanoman/runner";
import { phaseFilePath, decisionFilePath, readPhases, stageForRun } from "../services/session-phases";
import { specReview, reviewFile } from "../services/spec-review";
import { downloadFormat, sendReviewDownload } from "../services/doc-export";
import { integrateBranch } from "../services/integrate";
import { sessionAgentDefaults, conflictSessionDefaults, terminalAgentDefaults } from "../services/settings";
import { ensureCodexTrust } from "../services/codex-trust";
import { startSpecSession, LaunchError } from "../services/session-launch";
import { approveLaunch, launchPrincipal } from "../services/launch-authority";
import { admitBrowserWs, openWsConnection, revalidateWsPrincipal, createPrincipalWatch, WsMessageGuard } from "../services/ws-admission";
import { installCommand } from "../services/method-status";
import { resolveRepoDir } from "../services/local-binding";
import { ownsWorktree } from "../services/session-worktree";
import { listCleanups } from "../services/worktree-reaper";
import { closeSession } from "../services/session-close";
import { recordHeadSha } from "../services/spec-head";
import { appendDiag } from "../services/terminal-diag";
import { readPrd } from "../services/project-prds";
import { readAuditDoc } from "../services/audit-escalation";
import { recordSessionResult } from "../services/session-result";
import { recordCompletion } from "../services/notifications";
import { STAGES } from "../services/stage-machine";
import {
  createSession, getSession, listSessions, killSession, sessionPhases,
  attach, detach, writeTo, resize, shellBin, sendToPane, interruptPane, type Client,
} from "../services/pty";
import { saveSessionUpload } from "../services/uploads";

// SPEC-816 · lampiran gambar sesi terminal. Berkas + path, bukan gambar inline: yang bisa dikirim
// ke PTY hanyalah teks, dan CLI-lah yang menyusun blok image dari berkas yang dibacanya.
// Allowlist ini CERMIN kunci `EXT` di services/uploads.ts — `image/gif` sengaja di luar karena
// `extFor` memetakannya ke `.bin`.
const ATTACHMENT_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

// SPEC-771 · input xterm berbingkai per keystroke; default 120/menit menutup koneksi pada dua
// karakter/detik. 100/detik tetap bounded tetapi berada di atas key-repeat browser yang wajar.
const TERMINAL_WS_MESSAGES_PER_MINUTE = 6_000;

// Sebuah PTY di atas WebSocket adalah remote code execution secara desain — identik
// dengan menyerahkan shell. hanoman tidak punya autentikasi; satu-satunya yang berdiri
// di antara endpoint ini dan jaringan adalah server.ts yang bind ke 127.0.0.1.
// Bila HOST pernah diubah ke 0.0.0.0, endpoint inilah yang pertama harus digembok.

// SPEC-394 · ADR-0084 · worktree yang masih sah TIDAK dibangun ulang. `realGit.addWorktree` selalu
// merebut path lebih dulu (`worktree remove --force` + `rmSync`) — benar sebagai *reclaim* untuk id
// yang dipakai ulang, fatal saat sebuah sesi project-level dilahirkan ulang di atas pane mati:
// dokumen yang belum sempat di-commit akan lenyap. Kedua sifat itu satu paket dengan gerbang
// `!exited` di bawah; memperbaiki gerbangnya sendirian menukar "tombol diam" dengan kehilangan data.
// Mengembalikan `true` bila worktree lama dipakai ulang (→ prompt diberi catatan).
const ensureWorktree = (repoDir: string, wt: string, branchFrom: string): boolean => {
  if (realGit.worktreeAlive(wt)) return true;
  realGit.addWorktree(repoDir, wt, branchFrom);
  return false;
};
const resumeNote = (reused: boolean): string => (reused ? `\n\n${RESUMED_WORKTREE_NOTE}` : "");

export default async function (app: FastifyInstance, opts: { allowedOrigins?: Set<string> }) {
  app.get("/terminal/sessions", async () => listSessions());

  app.post("/terminal/sessions", async (req, reply) => {
    const parsed = zTerminalSession.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    // Sesi backlog item: `claude` interaktif di worktree-nya sendiri, dengan prompt awal yang
    // memuat objective dan pipeline fase-nya (SPEC-162). SPEC-294 · jalur peluncuran diseragamkan
    // di startSpecSession() (dipakai bersama governor scheduler); route memetakan LaunchError → status.
    if ("spec" in parsed.data) {
      const spec = await prisma.spec.findUnique({ where: { id: parsed.data.spec } });
      if (!spec) return reply.code(404).send({ error: "spec not found" });
      try {
        const principal = launchPrincipal(req);
        if (principal) await approveLaunch(spec.id, principal);
        const launchable = principal
          ? (await prisma.spec.findUnique({ where: { id: spec.id } }))!
          : spec;
        const r = await startSpecSession(launchable, {
          flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
          goal: parsed.data.goal, goalCondition: parsed.data.goalCondition,   // SPEC-332 · ADR-0073
          agent: parsed.data.agent,                                           // SPEC-338 · ADR-0074
          verifyScope: parsed.data.verifyScope,                               // SPEC-376 · ADR-0080
          method: parsed.data.method,                                         // SPEC-734 · ADR-0113
          force: parsed.data.force,                                           // SPEC-447 · ADR-0093
        });
        // SPEC-394 · ADR-0084 · `resumed` hanya muncul saat peluncuran benar-benar MELANJUTKAN
        // artefak sesi sebelumnya. Aditif — klien yang hanya membaca `id` tak terpengaruh.
        return reply.code(201).send(r.resumed ? { id: r.id, resumed: true } : { id: r.id });
      } catch (e) {
        if (e instanceof LaunchError) {
          // Parity status: needs-bind → 400 {needsBind}, worktree gagal → 422.
          // SPEC-447 · ADR-0093 · dependency belum siap → 409 + daftar pemblokirnya, supaya UI
          // bisa menyebut SIAPA yang ditunggu dan menawarkan "Mulai tetap" (force).
          if (e.kind === "blocked")
            return reply.code(409).send({ error: e.message, blocked: true, blockers: e.blockers });
          if (e.kind === "not-approved") return reply.code(403).send({ error: e.message });
          return e.kind === "needs-bind"
            ? reply.code(400).send({ error: e.message, needsBind: true })
            : reply.code(422).send({ error: e.message });
        }
        throw e;
      }
    }

    const project = await prisma.project.findUnique({ where: { id: parsed.data.project } });
    if (!project) return reply.code(404).send({ error: "project not found" });

    // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project. Reuse cabang
    // createSession({command}) (ADR-0042/0056). Tanpa flow → tak menggerakkan stage; cwd=repoDir
    // (bukan .worktrees) → DELETE hanya kill pane, tak menyentuh working tree. Ditaruh sebelum
    // guard repoDir lama supaya TS menyempitkan varian shell keluar sebelum `parsed.data.flow`.
    // `shell` = z.literal(true), jadi keberadaannya cukup mengidentifikasi varian (tanpa `&&
    // parsed.data.shell` yang menggagalkan penyempitan control-flow di cabang else).
    if ("shell" in parsed.data) {
      const repoDir = await resolveRepoDir(project.id);
      if (!repoDir) return reply.code(400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
      // SPEC-739 · ADR-0114 · pemasangan skill metode. Yang menjalankan perintah adalah SHELL di
      // dalam pane, bukan server: ADR-0087 menolak "server memasang dirinya sendiri" dan ADR-0088
      // memindahkan pemasangan ke CLI supervisor justru karena itu. Pemasang bukan-server berarti
      // nol executor baru — ADR-0037 utuh.
      const inst = parsed.data.install;
      if (inst) {
        // Sengaja bukan `resolveMethod` yang lenient: resolusi longgar benar untuk MEMBACA (id
        // dari hub jatuh diam ke default), tapi ini tindakan — memasang default karena metodenya
        // tak dikenal berarti menjalankan perintah yang tak diminta siapa pun.
        const m = METHODS[inst.method];
        if (!m) return reply.code(400).send({ error: `metode "${inst.method}" tak dikenal` });
        const s = createSession(project.id, repoDir, { command: installCommand(m, inst.agent) });
        return reply.code(201).send({ id: s.id });
      }
      const s = createSession(project.id, repoDir, { command: [shellBin()] });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-8). Kode status
    // dipertahankan (flow → 422, non-flow → 400) untuk parity; `needsBind` memberi sinyal UI.
    const repoDir = await resolveRepoDir(project.id);
    if (!repoDir) {
      return reply.code(parsed.data.flow ? 422 : 400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
    }

    // SPEC-166 · sesi reverse: worktree + prompt standar docs, tanpa Spec. Id deterministik
    // dari project-nya supaya Start kedua menyambung ke sesi yang sama (ADR-0015).
    if (parsed.data.flow === "reverse") {
      const id = `reverse-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      // SPEC-394 · ADR-0084 · hanya pane HIDUP yang berarti "sesinya sudah jalan"; pane mati
      // dilahirkan ulang (dibunuh di titik cekik `createSession`).
      const live = getSession(id);
      if (live && !live.exited) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      const wt = `${repoDir}/.worktrees/${id}`;
      let reused: boolean;
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        reused = ensureWorktree(repoDir, wt, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, wt, {
        id, flow: "reverse", model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startProjectPrompt("reverse", {
          id: project.id, name: project.name, desc: project.desc, stack: project.stack,
        }, "reverse-docs") + resumeNote(reused),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-222 · sesi scaffold project-level: dari ide → Source of Truth penuh. Id deterministik
    // dari project (Start kedua menyambung, ADR-0015). Cermin reverse; diseed dari project.desc.
    if (parsed.data.flow === "scaffold") {
      const id = `scaffold-${project.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
      // SPEC-394 · ADR-0084 · pane mati bukan sesi — lihat cabang reverse di atas.
      const live = getSession(id);
      if (live && !live.exited) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      const wt = `${repoDir}/.worktrees/${id}`;
      let reused: boolean;
      try {
        // SPEC-223 · "project baru pasti kosongan": repoDir bisa BELUM ada di disk saat scaffold
        // (project di-sync dari device lain, folder dipindah/hapus, atau init-saat-create tak jalan).
        // initRepo idempoten (mkdir + git init + commit seed bila belum ada HEAD) — jaring pengaman
        // agar scaffold dari ide tak pernah mati `spawnSync git ENOENT`. Scaffold ⟺ from-scratch,
        // jadi memiliki lifecycle repo kosong memang tugasnya (bukan mengasumsikannya, ADR-0052).
        // Tetap dipanggil lebih dulu walau worktree-nya dipakai ulang: ia idempoten.
        realGit.initRepo(repoDir);
        reused = ensureWorktree(repoDir, wt, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const s = createSession(project.id, wt, {
        id, flow: "scaffold", model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startScaffoldPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          "scaffold-docs") + resumeNote(reused),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-210 · sesi prd project-level: PM menyusun dokumen PRD dari brief + brainstorm. Meniru
    // reverse (worktree isolasi, push ke branch prd/<slug>, manusia merge). Tanpa Spec: DELETE
    // session tak menggerakkan stage (dijaga `if (s.specId)`), worktree tetap dibersihkan.
    if (parsed.data.flow === "prd") {
      const { brief, branchFrom, fromAudit } = parsed.data;
      const slug = brief.title.toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      if (!slug) return reply.code(400).send({ error: "judul PRD kosong" });
      const id = `prd-${slug}`;
      // SPEC-394 · ADR-0084 · pane mati bukan sesi — lihat cabang reverse di atas.
      const live = getSession(id);
      if (live && !live.exited) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      const wt = `${repoDir}/.worktrees/${id}`;
      let reused: boolean;
      try {
        // HEAD, bukan "main": repo target bukan milik hanoman — default branch-nya bebas.
        // SPEC-340 · ADR-0076 · PRD hasil eskalasi audit lahir dari branch auditnya, supaya
        // dokumen audit ada di worktree & jejak git PRD bersambung dengan auditnya.
        reused = ensureWorktree(repoDir, wt, branchFrom ?? "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      // SPEC-340 · isi dokumen audit (freshest-wins) disematkan ke prompt — prompt self-contained,
      // lepas dari status merge branch audit. Dokumen tak terbaca → PRD tetap jalan tanpa blok itu.
      const auditDoc = fromAudit ? await readAuditDoc(fromAudit) : null;
      const s = createSession(project.id, wt, {
        id, flow: "prd", branch: `prd/${slug}`, model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startPrdPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          brief, `prd/${slug}`,
          auditDoc ? { id: fromAudit!, path: auditDoc.path, content: auditDoc.content } : undefined)
          + resumeNote(reused),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-273 · sesi breakdown project-level: pecah SATU PRD → manifest N backlog paralel-independen.
    // Meniru prd (worktree isolasi dari HEAD, push branch breakdown/<slug>, manusia review→materialize).
    // Isi PRD disematkan ke prompt (freshest-wins), jadi breakdown lepas dari status merge PRD.
    if (parsed.data.flow === "breakdown") {
      const { prdPath } = parsed.data;
      const content = await readPrd(project.id, prdPath); // gate: hanya docs/prd/*.md, freshest-wins
      if (content === null) return reply.code(400).send({ error: "PRD tak terbaca" });
      const base = prdPath.slice(prdPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
      const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      if (!slug) return reply.code(400).send({ error: "path PRD tak valid" });
      const id = `breakdown-${slug}`;
      // SPEC-394 · ADR-0084 · pane mati bukan sesi — lihat cabang reverse di atas.
      const live = getSession(id);
      if (live && !live.exited) return reply.code(201).send({ id: live.id });

      // SPEC-252 · ADR-0061 · default global (per sesi). SPEC-338 · ADR-0074 · sesi project-level
      // tak punya picker: ia mengikuti agen default global.
      const { agent, model, effort } = await sessionAgentDefaults();
      if (agent === "codex") ensureCodexTrust(repoDir);
      const wt = `${repoDir}/.worktrees/${id}`;
      let reused: boolean;
      try {
        reused = ensureWorktree(repoDir, wt, "HEAD");
      } catch (e) {
        return reply.code(422).send({ error: `gagal membuat worktree: ${(e as Error).message}` });
      }
      const titleM = content.match(/^#\s+(.+)$/m);
      const title = titleM ? titleM[1]!.trim() : slug;
      const s = createSession(project.id, wt, {
        id, flow: "breakdown", branch: `breakdown/${slug}`, model, effort, agent,
        phaseFile: phaseFilePath(repoDir, id),
        decisionFile: decisionFilePath(repoDir, id),
        prompt: startBreakdownPrompt(
          { id: project.id, name: project.name, desc: project.desc, stack: project.stack },
          { title, path: prdPath, content }, `breakdown/${slug}`) + resumeNote(reused),
      });
      return reply.code(201).send({ id: s.id });
    }

    // SPEC-338 · ADR-0074 · terminal agen biasa (bukan shell mentah) ikut agen default global,
    // termasuk model/effort-nya — sebelumnya jalur ini lahir tanpa argv model sama sekali.
    // SPEC-517 · …kecuali bila operator memilihnya di form "Sesi baru": `agent`/`model`/`effort`
    // per-request menang, dan agen terpilih menentukan blok Setting mana yang dibaca. Body
    // `{project}` polos tetap berperilaku persis seperti sebelumnya.
    // `ensureCodexTrust` diturunkan dari agen HASIL resolusi — sejak sekarang ia bisa berbeda dari
    // `Setting.agent`, dan membaca yang salah membuat sesi mentok di layar trust codex (SPEC-377).
    const { agent, model, effort } = await terminalAgentDefaults(parsed.data);
    if (agent === "codex") ensureCodexTrust(repoDir);
    const s = createSession(project.id, repoDir, { agent, model, effort });
    return reply.code(201).send({ id: s.id });
  });

  app.get("/terminal/sessions/:id/phases", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    const phases = sessionPhases(id);
    if (!s?.flow || !phases) return reply.code(404).send({ error: "not found" });
    return { flow: s.flow, phases };
  });

  // SPEC-476 · ADR-0096 · parity kontrol Telegram. Dua endpoint sempit ini hanya beroperasi pada
  // pane Hanoman yang sudah ada; tidak menerima argv/command dan capability-nya tetap `sessions`.
  app.post("/terminal/sessions/:id/steer", async (req, reply) => {
    const parsed = zTerminalSteerInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const ok = await sendToPane((req.params as { id: string }).id, parsed.data.text);
    if (!ok) return reply.code(404).send({ error: "live session not found" });
    return reply.code(202).send({ accepted: true });
  });

  app.post("/terminal/sessions/:id/interrupt", async (req, reply) => {
    const ok = interruptPane((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: "live session not found" });
    return reply.code(202).send({ accepted: true });
  });

  // SPEC-230 · review diff worktree hidup sebuah sesi project-level (PRD). Kunci worktree = id
  // sesi (worktreeDir(repoDir, id) === s.cwd). Tanpa baseSha/branchFrom → mergeBase jatuh ke
  // default repo/HEAD (SPEC-227). Worktree lenyap (sesi ditutup) → 409, bukan 500.
  type WtOk = { ok: true; id: string; repoDir: string };
  type WtErr = { ok: false; code: number; msg: string };
  const sessionWorktree = async (id: string): Promise<WtOk | WtErr> => {
    const s = getSession(id);
    if (!s) return { ok: false, code: 404, msg: "not found" };
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return { ok: false, code: 409, msg: "project belum punya repoDir" };
    if (!s.cwd.includes("/.worktrees/") || !existsSync(s.cwd))
      return { ok: false, code: 409, msg: "belum ada worktree untuk di-review — jalankan/lanjutkan sesi dulu" };
    return { ok: true, id: s.id, repoDir };
  };
  app.get("/terminal/sessions/:id/review", async (req, reply) => {
    const r = await sessionWorktree((req.params as { id: string }).id);
    if (!r.ok) return reply.code(r.code).send({ error: r.msg });
    return specReview(r.repoDir, r.id, null, null);
  });
  app.get("/terminal/sessions/:id/review/*", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const r = await sessionWorktree(id);
    if (!r.ok) return reply.code(r.code).send({ error: r.msg });
    const rf = await reviewFile(r.repoDir, r.id, null, null, path);
    if (rf === null) return reply.code(404).send({ error: "not found" });
    // SPEC-385 · ADR-0078 · sama seperti review backlog; Review sesi PRD memakai layar yang sama.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendReviewDownload(reply, fmt, rf, { prefix: id, eyebrow: `hanoman · ${id}`, path });
    return rf;
  });

  // SPEC-230 · rebase/merge branch sesi project-level (PRD: prd/<slug>). Bersih → langsung;
  // konflik → spawn sesi claude di worktree merge-<id> (tanpa flow → tak menggerakkan stage, ADR-0031).
  app.post("/terminal/sessions/:id/integrate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zIntegrate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "op/target invalid" });
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (!s.branch) return reply.code(409).send({ error: "sesi ini tak punya branch untuk di-integrasi" });
    const repoDir = await resolveRepoDir(s.projectId);
    if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await integrateBranch(repoDir, { branch: s.branch, mergeId: s.id }, parsed.data.op, parsed.data.target);
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    // conflict → sesi agen interaktif di worktree yang tertinggal (tanpa flow → tak menggerakkan stage).
    // SPEC-338 · ADR-0074 · ikut agen dari Settings, seperti sesi project-level lainnya.
    // SPEC-383 · ADR-0081 · blok `Setting.conflict` bila dinyalakan; mati = default global.
    const { agent, model, effort } = await conflictSessionDefaults();
    if (agent === "codex") ensureCodexTrust(repoDir);
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${s.branch}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      // SPEC-543 · ADR-0108 · cermin pintu konflik backlog di routes/specs.ts.
      CODE_STYLE_CLAUSE,
      `Sesi PRD ${s.id}.`,
    ].join("\n\n");
    const cs = createSession(s.projectId, r.worktree, {
      id: `merge-${id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`,
      model, effort, agent, prompt,
    });
    return { status: "conflict", sessionId: cs.id };
  });

  // SPEC-742 · ADR-0116 · pembersihan worktree yang masih tertunda. Sesinya sudah lenyap saat baris
  // ini lahir, jadi yang diamati adalah pembersihannya: muncul = `closing`, hilang = `closed`.
  app.get("/terminal/cleanups", async () => ({ items: listCleanups() }));

  // SPEC-861 · ADR-0132 · badannya pindah ke services/session-close.ts — dipakai bersama
  // POST /projects/:id/worktrees/delete. Perilaku route ini tak berubah sebaris pun.
  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await closeSession(id);
    if (!r) return reply.code(404).send({ error: "not found" });
    return reply.code(202).send(r);
  });

  // SPEC-816 · lampiran gambar → berkas di server, path-nya yang masuk ke prompt sesi.
  app.post("/terminal/sessions/:id/attachments", async (req, reply) => {
    const { id } = req.params as { id: string };
    // Gerbang sesi hidup berdiri SEBELUM disk tersentuh: id yang mencoba traversal tak akan pernah
    // cocok dengan sesi tmux mana pun, jadi ia jatuh di 404 yang sama.
    if (!getSession(id)) return reply.code(404).send({ error: "not found" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const part = await (req as any).file?.();
    if (!part) return reply.code(400).send({ error: "unggahan tak valid" });
    const buf = await part.toBuffer();           // menguras stream lebih dulu
    // throwFileSizeLimit:false (app.ts) → oversize datang ter-truncate, bukan sebagai error.
    if (part.file?.truncated) return reply.code(413).send({ error: "berkas melebihi 5 MB" });
    if (!ATTACHMENT_MIME.has(part.mimetype)) return reply.code(415).send({ error: "tipe berkas tak didukung" });

    const { path } = await saveSessionUpload(id, buf, part.mimetype);
    return { path };
  });

  app.get("/terminal/sessions/:id/ws", {
    websocket: true,
    preValidation: async (req, reply) => {
      const { id } = req.params as { id: string };
      try { req.wsPrincipal = admitBrowserWs(req, `terminal:${id}`, opts.allowedOrigins ?? new Set()); }
      catch { return reply.code(401).send({ error: "WebSocket admission rejected" }); }
    },
  }, (socket, req) => {
    const { id } = req.params as { id: string };
    if (!getSession(id)) return socket.close(4004, "not found");
    const principal = req.wsPrincipal!;
    let release: () => void;
    try { release = openWsConnection(principal); }
    catch { socket.close(1008, "connection limit"); return; }
    const guard = new WsMessageGuard({ perWindow: TERMINAL_WS_MESSAGES_PER_MINUTE });
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    attach(id, client);
    // Revalidasi principal (SPEC-761) berjalan di LATAR, dipicu frame yang datang (≤ 1×/dtk) dan
    // interval 60 dtk di bawah. Sebelumnya setiap frame `in` di-`await` di belakang satu query
    // Prisma sebelum `writeTo`: dua frame beruntun berlomba dan mendarat terbalik di pty (terukur
    // `bcdef` → `bdcef`, 3/3 run), satu query yang tertahan pool menahan ketikan 5 dtk, dan P1008
    // milik sync menutup socket yang sah dengan "session revoked". Handler di bawah karena itu
    // SINKRON dari ujung ke ujung — urutan ke pty = urutan kedatangan frame, tanpa satu `await` pun.
    const watch = createPrincipalWatch({
      check: () => revalidateWsPrincipal(req, principal),
      onRevoked: () => socket.close(1008, "session revoked"),
    });
    socket.on("message", (raw: Buffer) => {
      const verdict = guard.accept(raw);
      if (!verdict.ok) { socket.close(verdict.code, verdict.reason); return; }
      if (!watch.admit()) return;
      let m: { t?: string; d?: string; cols?: number; rows?: number; seq?: number; ev?: unknown[] };
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "in" && typeof m.d === "string") {
        writeTo(id, m.d, client);
        // SPEC-878 · ADR-0134 · pengakuan pengiriman, dibalas SESUDAH writeTo. Klien memakainya
        // sebagai satu-satunya titik nol jam TTL echo prediktif: sebelum bytenya sampai, diamnya
        // pty tak memisahkan "pty bungkam" dari "jaringan lambat", dan menghukumnya terukur
        // membeli 30,5 dtk layar bisu. `seq` opsional — klien lama tak mengirimnya.
        if (typeof m.seq === "number") socket.send(JSON.stringify({ t: "ack", seq: m.seq }));
      }
      else if (m.t === "resize" && m.cols && m.rows) resize(id, m.cols, m.rows);
      // Perekam diagnostik jalur input (opt-in, dimatikan secara default di klien). Ia menutup satu
      // batas yang tak bisa diukur dari sini: antara jari operator di kaca perangkat dan byte yang
      // keluar dari `term.onData`. Sengaja BUKAN route REST — kanal ini sudah terautentikasi tiket
      // sekali pakai dan sudah berlaju-batas, jadi tak ada permukaan auth baru yang dibuka.
      // Kegagalan menulis TAK PERNAH menjatuhkan sesi terminal: diagnostik tak boleh lebih penting
      // daripada pekerjaan yang sedang diselidikinya.
      else if (m.t === "diag" && Array.isArray(m.ev)) {
        try { appendDiag(resolveHome(), id, m.ev); } catch { /* diagnostik bukan alasan sesi mati */ }
      }
    });
    const revalidate = setInterval(() => watch.refresh(), 60_000);
    revalidate.unref?.();
    socket.on("close", () => { clearInterval(revalidate); watch.dispose(); release(); detach(id, client); });
  });
}
