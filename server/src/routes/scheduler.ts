import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { zScheduler } from "@hanoman/shared";
import { prisma } from "../db";
import { getScheduler, setScheduler } from "../services/scheduler/config";
import { listQueue, markCanceled, markRequeued } from "../services/scheduler/queue";
import { getLastRun } from "../services/scheduler/registry";
import { listSessions } from "../services/pty";

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

  app.get("/scheduler/state", async () => {
    const cfg = await getScheduler();
    const live = listSessions().filter((s) => !s.exited);
    const queue = await listQueue();
    // Akses kunci source tetap (backlog/errors/triase) langsung — bukan index dinamis — agar
    // tetap tertype di bawah noUncheckedIndexedAccess. minCount hanya milik errors.
    const srcView = (id: string, sc: { enabled: boolean; everyMin: number }, minCount?: number) => {
      const last = getLastRun(id);
      return {
        id, enabled: sc.enabled, everyMin: sc.everyMin, minCount,
        lastRunAt: last ? new Date(last).toISOString() : null,
        nextRunAt: last ? new Date(last + sc.everyMin * 60_000).toISOString() : null,
      };
    };
    const sources = [
      srcView("backlog", cfg.sources.backlog),
      srcView("triase", cfg.sources.triase),
    ];
    // Sesi scheduler = sesi live yang punya item antrean 'launched' (marker asal-scheduler).
    const launchedSpecs = new Set(queue.filter((q) => q.status === "launched").map((q) => q.specId));
    const sessions = live.filter((s) => s.specId && launchedSpecs.has(s.specId));
    return { config: cfg, cap: cfg.maxConcurrent, liveCount: live.length, sources, queue, sessions };
  });
}
