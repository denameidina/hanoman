import type { FastifyInstance } from "fastify";
import { zLogSearchQuery, zLogRetention } from "@hanoman/shared";
import { searchLogs, readRemoteTranscript } from "../services/logs/search";
import { getSetting } from "../services/settings";
import { prisma } from "../db";
import { Prisma } from "@prisma/client";
import { auditAgentAdmin } from "../services/admin-audit";

export default async function (app: FastifyInstance) {
  app.get("/logs", async (req, reply) => {
    const parsed = zLogSearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await searchLogs(parsed.data);
    if (!result) return reply.code(400).send({ error: "cursor cacat" });
    return result;
  });

  app.get("/logs/:id/transcript", async (req, reply) => {
    const { id } = req.params as { id: string };
    const text = await readRemoteTranscript(Number(id));
    if (text === null) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", "text/plain; charset=utf-8");
    return reply.send(text);
  });

  app.get("/logs/retention", async () => (await getSetting()).logRetention);

  app.put("/logs/retention", async (req, reply) => {
    const parsed = zLogRetention.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    // ADR-0197 · memendekkan retensi menghapus jejak audit. Bila pelakunya agent token, catatannya
    // ditulis SEBELUM nilainya berubah (dan retensi event baru memangkas sesudahnya), supaya
    // perubahan itu sendiri tak ikut terhapus oleh perubahan yang dicatatnya.
    await auditAgentAdmin(req, "log-retention.updated", "retensi log diubah", {
      from: before.logRetention, to: parsed.data,
    });
    const data = { ...before, logRetention: parsed.data } as unknown as Prisma.InputJsonValue;
    await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
    return parsed.data;
  });
}
