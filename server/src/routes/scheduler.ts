import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { zScheduler, zCreateCron, zPatchCron } from "@hanoman/shared";
import { prisma } from "../db";
import { getScheduler, setScheduler } from "../services/scheduler/config";
import { buildQueuePage, markCanceled, markRequeued } from "../services/scheduler/queue";
import { computeNextRun, listCronRunsPage } from "../services/scheduler/cron";
import { buildSchedulerState } from "../services/scheduler/state";

// SPEC-294 · ADR-0072 · config (knob) + state (antrean/sesi/cadence) scheduler. Di belakang gate cookie.
// SPEC-522 · ADR-0106 · + pembatalan satu baris antrean. Sengaja di bawah prefix `/scheduler` supaya
// capability-nya turunan peta yang sudah ada (`agent-capabilities.ts`: `scheduler` → `settings`
// MENURUT METHOD) — tak ada baris peta baru, dan tak ada pengulangan kelas bug SPEC-405.
const CANCEL_NOTE = "dibatalkan operator";
const zCancelBody = z.object({ reason: z.string().trim().max(200).optional() });

// Alasan penolakan disusun SESUDAH CAS gagal, bukan sebelum ia dicoba: memeriksa status lebih dulu
// lalu menulis adalah persis balapan yang dihindari CAS-nya.
async function refuse(reply: FastifyReply, id: string, verb: string) {
  const row = await prisma.schedulerQueueItem.findUnique({ where: { id }, select: { status: true } });
  if (!row) return reply.code(404).send({ error: "item antrean tak ada" });
  const why = row.status === "launched"
    ? "sesinya sudah berjalan — tutup dari Terminal bila memang tak diperlukan"
    : `statusnya sudah ${row.status}`;
  return reply.code(409).send({ error: `tak bisa ${verb}: ${why}`, status: row.status });
}

export default async function (app: FastifyInstance) {
  app.get("/scheduler/config", async () => getScheduler());

  app.put("/scheduler/config", async (req, reply) => {
    const parsed = zScheduler.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setScheduler(parsed.data);   // ganti blok penuh (pola PUT /settings). Pause = { paused:true }.
  });

  // SPEC-522 · membatalkan SATU baris. Sebelum ini jalan keluar dari antrean cuma dua, keduanya
  // kasar: menunggu item meluncur (worktree + branch + `Spec.baseSha`/`startedAt` ditulis permanen,
  // ADR-0090) lalu menutup sesinya, atau rem global Pause/Stop yang menghentikan SELURUH antrean.
  app.post("/scheduler/queue/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zCancelBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const note = parsed.data.reason ? `${CANCEL_NOTE}: ${parsed.data.reason}` : CANCEL_NOTE;
    if (!(await markCanceled(id, note))) return refuse(reply, id, "membatalkan");
    return prisma.schedulerQueueItem.findUnique({ where: { id } });
  });

  // SPEC-522 · jalan pulang. Tanpa ini pembatalan permanen: barisnya tombstone, dan `enqueue`
  // (`upsert` ber-`update:{}`) sengaja tak bisa menghidupkannya lagi.
  app.post("/scheduler/queue/:id/requeue", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await markRequeued(id))) return refuse(reply, id, "mengembalikan ke antrean");
    return prisma.schedulerQueueItem.findUnique({ where: { id } });
  });

  // SPEC-908 · satu definisi dipakai bersama topik siar `schedulerState`
  // (services/scheduler/state.ts).
  app.get("/scheduler/state", () => buildSchedulerState());

  // SPEC-523 · daftar antrean berhalaman. Penyaring `status` diterapkan di query DB, bukan di klien.
  app.get("/scheduler/queue", async (req) => {
    const { status, page, limit } = req.query as Record<string, string | undefined>;
    // SPEC-908 · satu definisi dipakai bersama topik siar `schedulerQueue`.
    return buildQueuePage({ status, page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined });
  });

  // SPEC-646 · ADR-0112 · CRUD cronjob per project. Semua di bawah prefix `/scheduler` seperti
  // tetangganya, TAPI `capabilityForRoute` memberi `crons` cabang COOKIE_ONLY sendiri.
  const cronView = (c: {
    id: string; projectId: string; name: string; expr: string; prompt: string;
    agent: string | null; model: string | null; effort: string | null; enabled: boolean;
    nextRunAt: Date | null; lastRunAt: Date | null; createdAt: Date;
  }) => ({
    id: c.id, projectId: c.projectId, name: c.name, expr: c.expr, prompt: c.prompt,
    agent: c.agent, model: c.model, effort: c.effort, enabled: c.enabled,
    nextRunAt: c.nextRunAt ? c.nextRunAt.toISOString() : null,
    lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  });
  const runView = (r: {
    id: string; cronId: string; projectId: string; dueAt: Date; startedAt: Date | null;
    status: string; sessionId: string | null; note: string | null; manual: boolean; createdAt: Date;
  }) => ({
    id: r.id, cronId: r.cronId, projectId: r.projectId,
    dueAt: r.dueAt.toISOString(), startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    status: r.status, sessionId: r.sessionId, note: r.note, manual: r.manual,
    createdAt: r.createdAt.toISOString(),
  });

  app.get("/scheduler/crons", async (req) => {
    const { projectId, page, limit } = req.query as Record<string, string | undefined>;
    const where = projectId ? { projectId } : undefined;
    const total = await prisma.schedulerCron.count({ where });
    const pageSize = limit ? Math.max(1, Math.floor(+limit) || 1) : (total || 1);
    const p = page ? Math.max(1, Math.floor(+page) || 1) : 1;
    const items = await prisma.schedulerCron.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (p - 1) * pageSize, take: pageSize,
    });
    return { items: items.map(cronView), total, page: p, pageSize };
  });

  app.post("/scheduler/crons", async (req, reply) => {
    const parsed = zCreateCron.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    if (!(await prisma.project.findUnique({ where: { id: d.project } })))
      return reply.code(404).send({ error: "project not found" });
    const created = await prisma.schedulerCron.create({
      data: {
        projectId: d.project, name: d.name, expr: d.expr, prompt: d.prompt,
        agent: d.agent ?? null, model: d.model ?? null, effort: d.effort ?? null,
        enabled: d.enabled,
        // Dihitung sekarang walau cron-nya nonaktif: kolomnya juga yang memberi makan preview
        // "jalan berikutnya" di daftar, dan menghitungnya baru saat diaktifkan membuat baris yang
        // baru dibuat tampak tak berjadwal.
        nextRunAt: computeNextRun(d.expr, new Date()),
      },
    });
    return reply.code(201).send(cronView(created));
  });

  app.patch("/scheduler/crons/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPatchCron.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const cur = await prisma.schedulerCron.findUnique({ where: { id } });
    if (!cur) return reply.code(404).send({ error: "cron tak ada" });
    const d = parsed.data;
    // `nextRunAt` dihitung ulang saat expr berubah ATAU saat kolomnya kosong — cron yang jadwalnya
    // sudah habis (dan karena itu ber-nextRunAt null) harus bisa dihidupkan lagi lewat PATCH.
    const recompute = d.expr !== undefined || cur.nextRunAt === null;
    const updated = await prisma.schedulerCron.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.expr !== undefined ? { expr: d.expr } : {}),
        ...(d.prompt !== undefined ? { prompt: d.prompt } : {}),
        ...(d.agent !== undefined ? { agent: d.agent } : {}),
        ...(d.model !== undefined ? { model: d.model } : {}),
        ...(d.effort !== undefined ? { effort: d.effort } : {}),
        ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
        ...(recompute ? { nextRunAt: computeNextRun(d.expr ?? cur.expr, new Date()) } : {}),
      },
    });
    return cronView(updated);
  });

  app.delete("/scheduler/crons/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.schedulerCron.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "cron tak ada" });
    // Riwayat run ikut terhapus: tanpa FK di skema (cermin SchedulerQueueItem/LeadDecision),
    // membiarkannya berarti baris yatim yang tak punya cara ditampilkan maupun dibersihkan.
    await prisma.schedulerCronRun.deleteMany({ where: { cronId: id } });
    await prisma.schedulerCron.delete({ where: { id } });
    return reply.code(204).send();
  });

  // SPEC-646 · "Jalankan sekarang" TIDAK melahirkan sesi langsung: ia membuat baris run manual, dan
  // tick berikutnya (≤10 dtk) yang meluncurkannya lewat governor. Itu satu-satunya cara tombol uji
  // coba tetap tunduk cap, Pause, dan master switch tanpa menyalin gerbangnya ke sini — kelas bug
  // SPEC-431/448/475/481. Karena itu penolakannya EKSPLISIT (409), bukan tombol yang diam.
  app.post("/scheduler/crons/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cron = await prisma.schedulerCron.findUnique({ where: { id } });
    if (!cron) return reply.code(404).send({ error: "cron tak ada" });
    const cfg = await getScheduler();
    if (!cfg.enabled) return reply.code(409).send({ error: "scheduler sedang berhenti — aktifkan dulu di panel Kendali" });
    if (cfg.paused) return reply.code(409).send({ error: "scheduler sedang dijeda — lanjutkan dulu di panel Kendali" });
    const pending = await prisma.schedulerCronRun.findFirst({ where: { cronId: id, status: "queued" } });
    if (pending) return reply.code(409).send({ error: "masih ada run yang menunggu dijalankan", runId: pending.id });
    try {
      const run = await prisma.schedulerCronRun.create({
        data: { cronId: id, projectId: cron.projectId, dueAt: new Date(), manual: true },
      });
      return reply.code(201).send(runView(run));
    } catch {
      return reply.code(409).send({ error: "run untuk jatuh tempo ini sudah ada" });   // P2002
    }
  });

  app.get("/scheduler/crons/:id/runs", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await prisma.schedulerCron.findUnique({ where: { id } })))
      return reply.code(404).send({ error: "cron tak ada" });
    const { page, limit } = req.query as Record<string, string | undefined>;
    const r = await listCronRunsPage(id, { page, limit });
    return { items: r.items.map(runView), total: r.total, page: r.page, pageSize: r.pageSize };
  });
}
