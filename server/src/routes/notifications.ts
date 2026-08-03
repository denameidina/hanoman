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
  app.delete("/notifications", async (_req, reply) => {
    await prisma.notification.deleteMany({});
    return reply.code(204).send();
  });
}
