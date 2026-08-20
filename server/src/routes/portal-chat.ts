import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  zPortalChatType, TEKS_TETAP,
  type PortalChatMessageView, type PortalChatSessionView,
} from "@hanoman/shared";
import { prisma } from "../db";
import { paginate } from "../services/paginate";
import { hasProjectAccess } from "../services/client-access";
import { getSetting } from "../services/settings";
import { runTurn } from "../services/portal-chat/turn";
import { sanitizeClientText } from "../services/portal-chat/guard-input";
import { quotaView, startSessionWithQuota } from "../services/portal-chat/quota";

// SPEC-854 · ADR-0129 · permukaan chat klien. Ia hidup di berkas sendiri, bukan di `portal.ts`:
// portal.ts adalah permukaan BACA + satu pintu tiket, dan menaruh mesin percakapan di sana
// membuat dua tanggung jawab yang sangat berbeda berbagi satu berkas.

// Project tak ditugaskan, project tak ada, dan chat yang dimatikan menjawab hal yang SAMA —
// permukaan ini tak boleh jadi alat enumerasi (preseden ADR-0110/0062).
const NOT_FOUND = { error: "not found" };

const zStart = z.object({ type: zPortalChatType });
const zSend = z.object({ text: z.string().min(1).max(4000) });

const toSessionView = (s: {
  id: string; type: string; summary: string; prdReadyAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): PortalChatSessionView => ({
  id: s.id, type: s.type as PortalChatSessionView["type"], summary: s.summary,
  prdSiap: !!s.prdReadyAt, createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

const toMessageView = (m: {
  id: string; seq: number; role: string; text: string; createdAt: Date;
}): PortalChatMessageView => ({
  id: m.id, seq: m.seq, role: m.role as PortalChatMessageView["role"],
  text: m.text, createdAt: m.createdAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  /** Gerbang bersama: master switch + akses project. Satu tempat, bukan empat. */
  async function gate(userId: string, projectId: string) {
    const s = await getSetting();
    if (!s.portalChat.enabled) return null;
    if (!(await hasProjectAccess(userId, projectId))) return null;
    return s.portalChat;
  }

  /** Sesi milik project lain ATAU akun lain dijawab null — id sesi tak boleh jadi jalan pintas. */
  async function ownSession(userId: string, projectId: string, sid: string) {
    const s = await prisma.portalChatSession.findUnique({ where: { id: sid } });
    return s && s.projectId === projectId && s.userId === userId ? s : null;
  }

  app.get("/portal/projects/:id/chat", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cfg = await gate(req.user!.id, id);
    if (!cfg) return reply.code(404).send(NOT_FOUND);
    return quotaView(id, cfg);
  });

  app.get("/portal/projects/:id/chat/sessions", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await gate(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const { page, limit } = req.query as { page?: string; limit?: string };
    const rows = await prisma.portalChatSession.findMany({
      where: { projectId: id, userId: req.user!.id }, orderBy: { updatedAt: "desc" } });
    return paginate(rows.map(toSessionView), page, limit);
  });

  app.post("/portal/projects/:id/chat/sessions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cfg = await gate(req.user!.id, id);
    if (!cfg) return reply.code(404).send(NOT_FOUND);
    const parsed = zStart.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "tipe sesi tak dikenal" });
    const hasil = await startSessionWithQuota({
      projectId: id, userId: req.user!.id, type: parsed.data.type, cfg });
    // BUKAN pesan galat: klien membaca sisa jatah & tanggal resetnya dalam bahasa biasa (huruf C).
    // Statusnya tetap 409 supaya klien HTTP tak menganggapnya sesi yang lahir.
    if ("error" in hasil)
      return reply.code(409).send({ pesan: TEKS_TETAP.kuotaHabis, kuota: await quotaView(id, cfg) });
    return reply.code(201).send(toSessionView(hasil.session));
  });

  app.get("/portal/projects/:id/chat/sessions/:sid", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    if (!(await gate(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const s = await ownSession(req.user!.id, id, sid);
    if (!s) return reply.code(404).send(NOT_FOUND);
    const { page, limit } = req.query as { page?: string; limit?: string };
    const rows = await prisma.portalChatMessage.findMany({
      where: { sessionId: sid }, orderBy: { seq: "asc" } });
    return { session: toSessionView(s), messages: paginate(rows.map(toMessageView), page, limit) };
  });

  app.post("/portal/projects/:id/chat/sessions/:sid/messages", async (req, reply) => {
    const { id, sid } = req.params as { id: string; sid: string };
    const cfg = await gate(req.user!.id, id);
    if (!cfg) return reply.code(404).send(NOT_FOUND);
    const s = await ownSession(req.user!.id, id, sid);
    if (!s) return reply.code(404).send(NOT_FOUND);
    const parsed = zSend.safeParse(req.body);
    const text = parsed.success ? sanitizeClientText(parsed.data.text).trim() : "";
    if (!text) return reply.code(400).send({ error: "pesan kosong" });

    // Giliran klien disimpan SEBELUM agen dipanggil: kalau panggilan itu gagal atau timeout,
    // yang ditulis klien tetap ada dan tak hilang bersama kegagalannya.
    const prior = await prisma.portalChatMessage.findMany({
      where: { sessionId: sid }, orderBy: { seq: "asc" } });
    const seq = prior.length;
    await prisma.portalChatMessage.create({
      data: { sessionId: sid, seq: seq + 1, role: "klien", text } });

    const turn = await runTurn({
      projectId: id, type: s.type as "brainstorm" | "tanya",
      history: prior.map((m) => ({ role: m.role as "klien" | "hanoman", text: m.text })),
      message: text, model: cfg.model, effort: cfg.effort, timeoutSec: cfg.timeoutSec,
    });

    const row = await prisma.portalChatMessage.create({ data: {
      sessionId: sid, seq: seq + 2, role: "hanoman", text: turn.reply,
      rawText: turn.raw, blocked: turn.blocked,
      blockReasons: turn.reasons.length ? turn.reasons : undefined } });
    await prisma.portalChatSession.update({ where: { id: sid }, data: {
      ...(turn.summary ? { summary: turn.summary } : {}),
      ...(turn.prd ? { prdMarkdown: turn.prd, prdReadyAt: new Date() } : {}) } });
    return reply.code(201).send(toMessageView(row));
  });
}
