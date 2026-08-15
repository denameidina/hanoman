import type { FastifyInstance } from "fastify";
import type { SessionResultView } from "@hanoman/shared";
import { prisma } from "../db";
import { deleteSynced } from "../services/sync-delete";

// SPEC-213 · ADR-0047 · baca & purge activity log (cookie-authed dashboard). Append-only:
// satu-satunya penghapusan adalah purge manual scoped project dan/atau rentang tanggal (AC-22).
const view = (r: {
  id: string; projectId: string; specId: string | null; oldStage: string | null; newStage: string | null;
  commitSha: string | null; branch: string | null; prUrl: string | null; status: string;
  deviceId: string | null; author: string | null; createdAt: Date;
}): SessionResultView => ({
  id: r.id, projectId: r.projectId, specId: r.specId, oldStage: r.oldStage, newStage: r.newStage,
  commitSha: r.commitSha, branch: r.branch, prUrl: r.prUrl, status: r.status,
  deviceId: r.deviceId, author: r.author, createdAt: r.createdAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  app.get("/session-results", async (req) => {
    const { projectId, limit } = req.query as { projectId?: string; limit?: string };
    const take = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const rows = await prisma.sessionResult.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: "desc" }, take,
    });
    return rows.map(view);
  });

  app.delete("/session-results", async (req, reply) => {
    const { projectId, before } = req.query as { projectId?: string; before?: string };
    if (!projectId && !before) return reply.code(400).send({ error: "purge butuh projectId dan/atau before" });
    const where: { projectId?: string; createdAt?: { lt: Date } } = {};
    if (projectId) where.projectId = projectId;
    if (before) {
      const d = new Date(before);
      if (Number.isNaN(d.getTime())) return reply.code(400).send({ error: "before bukan tanggal valid" });
      where.createdAt = { lt: d };
    }
    // SPEC-799 · ADR-0119 · id dikumpulkan LEBIH DULU: `deleteMany` tak mengembalikan barisnya, dan
    // tombstone butuh version + snapshot tiap baris. Purge tetap satu operasi bagi pemanggilnya.
    const rows = await prisma.sessionResult.findMany({ where, select: { id: true } });
    let purged = 0;
    for (const r of rows) if (await deleteSynced("sessionResult", r.id)) purged++;
    return { purged };
  });
}
