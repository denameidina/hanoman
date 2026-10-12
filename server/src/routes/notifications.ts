import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { notificationsFeed } from "../services/notifications";

// SPEC-180 · daftar notifikasi backlog selesai. Read-state global (satu readAt per baris),
// bukan per-user: workspace single-team. Rute di belakang gate auth (app.ts).
export default async function (app: FastifyInstance) {
  // SPEC-523 · tanpa page/limit → 50 teratas (perilaku lama, dipakai bell yang didorong WS).
  app.get("/notifications", async (req) =>
    notificationsFeed(req.query as { page?: string; limit?: string }));
  app.post("/notifications/read", async (_req, reply) => {
    await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });
  // ADR-0204 · tandai SATU notifikasi terbaca. Read-state global (lihat atas), jadi tak ada pemeriksaan
  // kepemilikan: yang dijaga hanya keberadaan. Idempoten: `readAt` yang sudah terisi TIDAK ditulis ulang,
  // jadi waktu baca pertama yang tercatat, dan permintaan kedua tetap 204.
  app.post("/notifications/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await prisma.notification.findUnique({ where: { id }, select: { id: true } });
    if (!row) return reply.code(404).send({ error: "notifikasi tak ada" });
    await prisma.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });
  app.delete("/notifications", async (_req, reply) => {
    await prisma.notification.deleteMany({});
    return reply.code(204).send();
  });
}
