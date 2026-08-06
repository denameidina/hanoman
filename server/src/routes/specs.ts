import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { zCreateSpec, zPatchSpec, zIntegrate, zBatchCreateSpec, type Stage } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "@hanoman/runner";
import { integrate, sourceBranch } from "../services/integrate";
import { createSession } from "../services/pty";
import { conflictSessionDefaults } from "../services/settings";
import { ensureCodexTrust } from "../services/codex-trust";
import { prisma } from "../db";
import { specReview, reviewFile, worktreeDir, specCommitRange, specReviewRange, reviewFileRange, shaResolvable } from "../services/spec-review";
import { nextSpecId } from "../services/id";
import { notifySynced } from "../services/sync-notify";
import { branchFromCandidates } from "../services/branches";
import { STAGES } from "../services/stage-machine";
import { artifactsToRemove } from "../services/stage-artifacts";
import { deleteDoc } from "../services/docs";
import { listSpecDocs, resolveDir } from "../services/spec-docs";
import { readEscalation } from "../services/audit-escalation";
import { resolveRepoDir } from "../services/local-binding";
import { validateDependsOn, dependsOnOf } from "../services/spec-deps";
import { checkAutoMerge } from "../services/auto-merge-gate";
import { Prisma } from "@prisma/client";
import { readDocFile } from "../services/scan";
import { downloadFormat, sendDocDownload, sendReviewDownload } from "../services/doc-export";
import { paginate } from "../services/paginate";
import { dayStart, dayEnd, inDayRange } from "../services/date-range";
// SPEC-199 · overlay stage-live + write-through + notifikasi kini di liveSpecs (dipakai juga hub
// siar WS) supaya push & pull tak drift. Rute tinggal filter+paginasi (SPEC-198) di atasnya.
import { liveSpecs } from "../services/live-specs";

// SPEC-143: daftar yang mengisi dropdown adalah daftar yang menjaga gerbang — tak ada validator
// terpisah yang bisa ikut basi. Branch karangan ditolak di sini, bukan beberapa menit kemudian
// saat worktree gagal di dalam run. SPEC-244 · kandidat = lokal ∪ origin (branch PRD/audit remote-only).
const branchUnknown = async (repoDir: string | null, branch: string) =>
  !(await branchFromCandidates(repoDir)).includes(branch);

// SPEC-186 · derivasi priority + objective dari source+payload. Satu sumber untuk POST & PATCH:
// qa → priority dari severity, objective dari actual/steps; brief → priority manual, objective dari outcome/context.
function deriveSpecFields(source: string, payload: any, manualPriority: string) {
  // SPEC-407 · ADR-0089 · backlog goal: objective ADALAH goal-nya (yang dibaca prompt sesi &
  // kondisi Stop hook). Prioritas tetap manual — tak ada severity untuk diturunkan, dan operator
  // yang tahu seberapa mendesak goal itu.
  if (source === "goal") {
    const pick = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      priority: manualPriority,
      objective: pick(payload?.goal) || pick(payload?.done) || "— goal belum diisi.",
    };
  }
  const isQa = source === "qa";
  const priority = isQa && payload && "severity" in payload
    ? (payload.severity === "minor" ? "sedang" : "tinggi") : manualPriority;
  const objective = isQa && payload && "actual" in payload
    ? (payload.actual || payload.steps || "— audit untuk menelusuri akar masalah.")
    : (payload && "outcome" in payload ? (payload.outcome || payload.context || "— brainstorm untuk memperjelas objective.") : "");
  return { priority, objective };
}

// SPEC-198 · search/filter di layer response, DITERAPKAN SETELAH overlay stage-live —
// jadi filter `stage`/`startable` mencocokkan stage live, bukan stage DB yang basi.
// SPEC-408 · ADR-0090 · + rentang tanggal. `dateField` memilih SUMBU-nya: `created` (kapan item
// difilekan) atau `started` (kapan sesi pertama lahir). Tanggal tak valid → batas null → filter
// mati; konsisten dengan `stage`/`priority` yang juga lenient di sini, bukan 400.
function filterSpecs<T extends {
  id: string; title: string; objective: string; stage: string; priority: string;
  createdAt: Date; startedAt: Date | null;
}>(
  specs: T[], f: { q?: string; stage?: string; priority?: string; startable?: string;
    dateField?: string; from?: string; to?: string },
): T[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  const from = dayStart(f.from);
  const to = dayEnd(f.to);
  const byStarted = f.dateField === "started";
  return specs.filter((s) =>
    (!f.stage || s.stage === f.stage) &&
    (!f.priority || s.priority === f.priority) &&
    (f.startable !== "true" || s.stage !== "done") &&
    inDayRange(byStarted ? s.startedAt : s.createdAt, from, to) &&
    (needle === "" || `${s.id} ${s.title} ${s.objective}`.toLowerCase().includes(needle)));
}

export default async function (app: FastifyInstance) {
  app.get("/specs", async (req) => {
    const { project, source, q, stage, priority, startable, dateField, from, to, page, limit } =
      req.query as { project?: string; source?: string; q?: string; stage?: string;
        priority?: string; startable?: string; dateField?: string; from?: string; to?: string;
        page?: string; limit?: string };
    // Overlay stage-live + write-through + notifikasi atas SET PENUH (scope project/source) —
    // sekarang di liveSpecs, dibagi dengan hub siar WS (SPEC-199) supaya push & pull tak drift.
    // Filter/paginasi DITERAPKAN SETELAH overlay (SPEC-198): filter `stage`/`startable` mencocokkan
    // stage live, bukan DB basi; spec off-page tetap maju stage & bernotif karena overlay lebih dulu.
    const overlaid = await liveSpecs({ project, source });
    return paginate(filterSpecs(overlaid, { q, stage, priority, startable, dateField, from, to }), page, limit);
  });
  app.post("/specs", async (req, reply) => {
    const parsed = zCreateSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    // Validasi branch menuntut baris Project-nya dimuat. Efek sampingnya diinginkan:
    // project tak dikenal kini 404 jujur, bukan pelanggaran foreign-key.
    const project = await prisma.project.findUnique({ where: { id: b.project } });
    if (!project) return reply.code(404).send({ error: `project "${b.project}" tidak ada` });
    // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir) untuk validasi branch & id.
    const repoDir = await resolveRepoDir(b.project);
    if (b.branchFrom && await branchUnknown(repoDir, b.branchFrom))
      return reply.code(400).send({ error: `branch "${b.branchFrom}" tidak ada di repo project` });
    // SPEC-447 · ADR-0093 · integritas dependency ditegakkan DI SINI (tak ada FK untuk kolom Json):
    // id harus ada, satu project, bukan diri sendiri. Siklus mustahil untuk spec baru (belum ada
    // yang bisa menunjuk ke sana), jadi specId dikirim null.
    const dep = await validateDependsOn(null, b.project, b.dependsOn ?? []);
    if (!dep.ok) return reply.code(400).send({ error: dep.error });
    const isQa = b.source === "qa";
    const { priority, objective } = deriveSpecFields(b.source, b.payload, b.priority);
    // Author = user yang login (req.user diisi gate auth; dijamin ada di prod, fallback hanya
    // untuk test requireAuth:false). Prefix `QA ·` tetap menandai spec dari alur QA.
    const author = req.user?.email ?? "system";
    // SPEC-197 · nextSpecId menurunkan id dari max saat ini (TOCTOU): dua POST /specs konkuren bisa
    // menghitung id yang sama → unique violation P2002. Retry hitung ulang id (maks 3x) — bukan 500.
    let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
    for (let attempt = 0; attempt < 3 && !spec; attempt++) {
      const id = await nextSpecId(repoDir);
      try {
        spec = await prisma.spec.create({
          data: {
            id, projectId: b.project, title: b.title, source: b.source, stage: "brainstorming",
            priority,
            author: isQa ? `QA · ${author}`
              : b.source === "audit" ? `Audit · ${author}`
              // SPEC-407 · asal item goal terbaca di backlog (cermin `Audit ·`).
              : b.source === "goal" ? `Goal · ${author}`
              : author,
            objective, payload: b.payload,
            branchFrom: b.branchFrom ?? null,
            dependsOn: dep.ids,   // SPEC-447 · ADR-0093
          }
        });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
        throw e;
      }
    }
    if (spec) await notifySynced("spec", spec.id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    return reply.code(201).send(spec);
  });
  // SPEC-273 · materialize breakdown: buat N spec independen dari usulan yang di-review manusia.
  // Tiap item = brief satu backlog; provenance PRD dicantumkan di teks Konteks (tanpa kolom baru,
  // pola take-to-backlog). Id berurutan lewat nextSpecId + retry P2002 (TOCTOU), sama seperti POST
  // tunggal. Backlog hasil breakdown by-construction independen → jalan paralel (satu sesi/worktree).
  app.post("/specs/batch", async (req, reply) => {
    const parsed = zBatchCreateSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: b.project } });
    if (!project) return reply.code(404).send({ error: `project "${b.project}" tidak ada` });
    const repoDir = await resolveRepoDir(b.project);
    if (b.branchFrom && await branchUnknown(repoDir, b.branchFrom))
      return reply.code(400).send({ error: `branch "${b.branchFrom}" tidak ada di repo project` });
    const author = req.user?.email ?? "system";
    const created: Awaited<ReturnType<typeof prisma.spec.create>>[] = [];
    for (const item of b.items) {
      const context = b.prdPath ? `Dari PRD (breakdown): ${b.prdPath}\n\n${item.context}` : item.context;
      const payload = { context, outcome: item.outcome, constraints: "", priority: item.priority };
      const { priority, objective } = deriveSpecFields("brief", payload, item.priority);
      let spec: Awaited<ReturnType<typeof prisma.spec.create>> | null = null;
      for (let attempt = 0; attempt < 3 && !spec; attempt++) {
        const id = await nextSpecId(repoDir);
        try {
          spec = await prisma.spec.create({
            data: {
              id, projectId: b.project, title: item.title, source: "brief", stage: "brainstorming",
              priority, author, objective, payload, branchFrom: b.branchFrom ?? null,
            },
          });
        } catch (e) {
          if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
          throw e;
        }
      }
      if (spec) { await notifySynced("spec", spec.id); created.push(spec); }
    }
    return reply.code(201).send({ created });
  });
  // branchFrom (SPEC-143): basis run BERIKUTNYA; `null` = kembali ke default project.
  // stage (SPEC-167): revert backward-only, cermin terbalik dari guard forward-only
  // advanceStage() di terminal.ts. Saat mundur, artefak docs fase di atas target dibersihkan
  // lewat dry-run + confirmDelete (daftar berkas dikonfirmasi human di UI).
  app.patch("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchSpec.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    const { branchFrom, stage, confirmDelete, title, priority: newPriority, payload, dependsOn, autoMerge } = parsed.data;
    const editingContent = title !== undefined || newPriority !== undefined || payload !== undefined;
    // SPEC-186 · konten hanya boleh diubah selagi item masih di backlog & belum dimulai.
    if (editingContent && (spec.stage !== "brainstorming" || spec.baseSha !== null))
      return reply.code(409).send({ error: "backlog item sudah dimulai — tak bisa diedit" });
    if (branchFrom) {
      // SPEC-217 · validasi branch di path efektif (binding lokal per-mesin ?? Project.repoDir).
      if (await branchUnknown(await resolveRepoDir(spec.projectId), branchFrom))
        return reply.code(400).send({ error: `branch "${branchFrom}" tidak ada di repo project` });
    }
    // SPEC-447 · ADR-0093 · SENGAJA tak ikut gerbang `editingContent` di atas: dependency
    // menggerbangi peluncuran BERIKUTNYA, bukan konten yang sedang dikerjakan sesi hidup —
    // menguncinya berarti item yang terlanjur terblokir salah tulis hanya bisa dihapus.
    let depIds: string[] | undefined;
    if (dependsOn !== undefined) {
      const d = await validateDependsOn(spec.id, spec.projectId, dependsOn);
      if (!d.ok) return reply.code(400).send({ error: d.error });
      depIds = d.ids;
    }
    // SPEC-486 · ADR-0103 · cermin dependsOn: di luar gerbang `editingContent`, divalidasi
    // terhadap repo efektif project item ini.
    if ("autoMerge" in parsed.data) {
      const gate = await checkAutoMerge(await resolveRepoDir(spec.projectId), autoMerge);
      if (!gate.ok) return reply.code(gate.code).send({ error: gate.error });
    }
    if (stage !== undefined) {
      if (STAGES.indexOf(stage) >= STAGES.indexOf(spec.stage as Stage))
        return reply.code(422).send({ error: "stage hanya boleh dikembalikan mundur" });
      const wouldDelete = await artifactsToRemove(spec.projectId, spec.id, stage, spec.stage as Stage);
      if (wouldDelete.length && confirmDelete !== true)
        return reply.send({ pending: true, stage, wouldDelete });
      for (const rel of wouldDelete) await deleteDoc(spec.projectId, rel).catch(() => { });
    }
    const data: { branchFrom?: string | null; stage?: string; title?: string; priority?: string; objective?: string; payload?: any; dependsOn?: string[]; autoMerge?: any } = {};
    if (branchFrom !== undefined) data.branchFrom = branchFrom;
    if (depIds !== undefined) data.dependsOn = depIds;   // SPEC-447 · ADR-0093
    // SPEC-486 · Prisma `Json?` menolak `null` polos — `Prisma.DbNull` yang mengosongkan kolomnya.
    if ("autoMerge" in parsed.data) data.autoMerge = autoMerge === null ? Prisma.DbNull : autoMerge;
    if (stage !== undefined) data.stage = stage;
    if (editingContent) {
      const effPayload = payload ?? spec.payload;
      const { priority, objective } = deriveSpecFields(spec.source, effPayload, newPriority ?? spec.priority);
      if (title !== undefined) data.title = title;
      if (payload !== undefined) data.payload = payload;
      data.priority = priority;
      data.objective = objective;
    }
    const updated = await prisma.spec.update({ where: { id }, data });
    await notifySynced("spec", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    return updated;
  });
  // SPEC-170 · dokumen sebuah backlog item (audit/objective/spec/plan/brainstorm).
  // Sumber freshest-wins ada di resolveDir: worktree sesi hidup > repoDir.
  app.get("/specs/:id/docs", async (req) =>
    ({ files: await listSpecDocs((req.params as { id: string }).id) }));

  app.get("/specs/:id/docs/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const dir = await resolveDir(id);
    const content = dir ? readDocFile(dir, path) : null; // readDocFile menolak non-.md -> null
    if (content === null) return reply.code(404).send({ error: "not found" });
    // SPEC-361 · ADR-0078 · unduh .md mentah / .pdf; tanpa query → JSON seperti semula.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendDocDownload(reply, fmt, { content, name: path, prefix: id, eyebrow: `hanoman · ${id}`, path });
    return { path, content };
  });

  // SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit — NILAI TURUNAN dari blok ```json di
  // dokumen audit (freshest-wins), bukan kolom DB. Dokumen/blok tak ada atau rusak → 200 dengan
  // escalation:null; itu keadaan normal (audit pra-SPEC-340 / sesi masih menulis), bukan error.
  // 404 hanya bila spec-nya sendiri tak ada.
  app.get("/specs/:id/escalation", async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = await prisma.spec.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: "not found" });
    return readEscalation(id);
  });

  app.delete("/specs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // SPEC-447 · ADR-0093 · baca projectId SEBELUM menghapus: kolom `dependsOn` tak punya FK, jadi
    // tanpa pembersihan ini menghapus satu item mengunci dependent-nya SELAMANYA dengan alasan
    // `missing` yang tak bisa diperbaiki dari UI.
    const gone = await prisma.spec.findUnique({ where: { id }, select: { projectId: true } });
    await prisma.spec.delete({ where: { id } }).catch(() => { });
    if (gone) {
      const rows = await prisma.spec.findMany({
        where: { projectId: gone.projectId }, select: { id: true, dependsOn: true },
      });
      for (const r of rows) {
        const ids = dependsOnOf(r);
        if (!ids.includes(id)) continue;
        await prisma.spec.update({ where: { id: r.id }, data: { dependsOn: ids.filter((x) => x !== id) } });
        await notifySynced("spec", r.id);   // SPEC-213/330 · perubahan ini nyata, harus menyeberang
      }
    }
    return reply.code(204).send();
  });

  // SPEC-175 · rebase/merge branch hasil sebuah done spec. Hanya untuk stage `done`. Server jalankan
  // git di worktree isolasi (never touch main working tree); conflict di-serahkan ke sesi claude (Task 4).
  app.post("/specs/:id/integrate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zIntegrate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "op/target invalid" });
    const spec = await prisma.spec.findUnique({ where: { id }, include: { project: true } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (spec.stage !== "done") return reply.code(409).send({ error: "hanya backlog item yang sudah done bisa di-rebase/merge" });
    // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir).
    const repoDir = await resolveRepoDir(spec.projectId);
    if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await integrate(repoDir, spec.id, parsed.data.op, parsed.data.target);
    if (r.status === "error") return reply.code(r.code).send({ error: r.error });
    if (r.status === "clean") return { status: "clean", detail: r.detail };
    // conflict → sesi agen interaktif di worktree yang tertinggal (never touch main working tree).
    // Tanpa flow: tak menggerakkan stage; worktree-nya dibersihkan saat sesi ditutup (terminal.ts DELETE).
    // SPEC-377 · ADR-0074 · ikut agen dari Settings (cermin POST /terminal/sessions/:id/integrate).
    // `sessionModel()` hanya membaca blok claude, jadi memakainya di sini membuat sesi konflik selalu
    // lahir claude dengan model default — apa pun isi Settings.
    // SPEC-383 · ADR-0081 · lewat `conflictSessionDefaults()`: blok `Setting.conflict` bila operator
    // menyalakannya, kalau tidak mewarisi default global persis seperti sebelumnya.
    const { agent, model, effort } = await conflictSessionDefaults();
    // Gerbang trust codex dibuka untuk ROOT REPO; worktree `.worktrees/merge-*` mewarisinya.
    if (agent === "codex") ensureCodexTrust(repoDir);
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${sourceBranch(spec.id)}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      // SPEC-543 · ADR-0108 · menyelesaikan konflik selalu berarti menyunting kode, dan prompt ini
      // dirakit inline di route — gerbang `writesCode` di runner/src/prompt.ts tak menjangkaunya.
      CODE_STYLE_CLAUSE,
      `Backlog item ${spec.id} — ${spec.title}.`,
    ].join("\n\n");
    const s = createSession(spec.projectId, r.worktree, {
      id: `merge-${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`,
      specId: spec.id, model, effort, agent, prompt,
    });
    return { status: "conflict", sessionId: s.id };
  });

  // SPEC-171 · review backlog item: all files + file changed, diturunkan dari git.
  // Worktree hidup <repoDir>/.worktrees/<specid> → diff atas working tree. Worktree lenyap
  // (item selesai) → diff `baseSha..headSha` tersimpan (SPEC-176, ADR-0030), atau fallback
  // range commit `oldest(spec-N)^..newest` di history untuk spec lama tanpa SHA. Tak ada
  // sumber apa pun → 409. Gerbang path ada di reviewFile*.
  const specWithProject = (id: string) =>
    prisma.spec.findUnique({ where: { id }, include: { project: true } });
  // wt hidup > SHA tersimpan (bila objeknya masih terjangkau) > grep pesan commit. Null = 409.
  const resolveReview = async (
    repoDir: string, spec: { id: string; baseSha: string | null; headSha: string | null },
  ) => {
    if (existsSync(worktreeDir(repoDir, spec.id))) return { wt: true as const };
    if (spec.baseSha && spec.headSha
        && await shaResolvable(repoDir, spec.baseSha) && await shaResolvable(repoDir, spec.headSha))
      return { wt: false as const, base: spec.baseSha, head: spec.headSha };
    const r = await specCommitRange(repoDir, spec.id);
    return r ? { wt: false as const, ...r } : null;
  };
  app.get("/specs/:id/review", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await specWithProject(id);
    if (!spec) return reply.code(404).send({ error: "not found" });
    // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir).
    const repoDir = await resolveRepoDir(spec.projectId);
    if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await resolveReview(repoDir, spec);
    if (!r) return reply.code(409).send({ error: "belum ada worktree atau commit untuk di-review — jalankan/lanjutkan sesi backlog dulu" });
    return r.wt ? specReview(repoDir, id, spec.baseSha, spec.branchFrom)
      : specReviewRange(repoDir, r.base, r.head);
  });
  app.get("/specs/:id/review/*", async (req, reply) => {
    const { id } = req.params as { id: string };
    const path = (req.params as Record<string, string>)["*"] ?? "";
    const spec = await specWithProject(id);
    if (!spec) return reply.code(404).send({ error: "not found" });
    // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir).
    const repoDir = await resolveRepoDir(spec.projectId);
    if (!repoDir) return reply.code(409).send({ error: "project belum punya repoDir" });
    const r = await resolveReview(repoDir, spec);
    if (!r) return reply.code(409).send({ error: "belum ada worktree atau commit" });
    const rf = r.wt ? await reviewFile(repoDir, id, spec.baseSha, spec.branchFrom, path)
      : await reviewFileRange(repoDir, r.base, r.head, path);
    if (rf === null) return reply.code(404).send({ error: "not found" });
    // SPEC-385 · ADR-0078 · unduh berkas yang sedang dipratinjau di Review. Tanpa query → JSON lama.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendReviewDownload(reply, fmt, rf, { prefix: id, eyebrow: `hanoman · ${id}`, path });
    return rf;
  });
}
