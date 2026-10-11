import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zTelegramReplyInput } from "@hanoman/shared";
import { prisma } from "../db";
import { reloadTelegramGateway } from "../services/telegram/bootstrap";
import {
  clearTelegramCredentials, gatewayEscalation, saveTelegramCredentials, telegramCredentialView,
  testTelegramConnection,
} from "../services/telegram/credentials";
import { telegramRuntimeStatus } from "../services/telegram/runtime";
import { TelegramStore } from "../services/telegram/store";

const store = new TelegramStore(prisma);

const zContextPatch = z.object({
  activeProjectId: z.string().min(1).nullable().optional(),
  activeSessionId: z.string().min(1).nullable().optional(),
  personalityAgentId: z.string().min(1).nullable().optional(),
  summary: z.string().trim().min(1).max(4_000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "empty patch");
const zMemory = z.object({ content: z.string().trim().min(1).max(1_000) });

export default async function telegramRoutes(app: FastifyInstance) {
  // SPEC-477 · ADR-0097 · permukaan KREDENSIAL. ADR-0193: terjangkau agent token HANYA dengan
  // `telegram:admin` (lihat `capabilityForRoute`) — capability yang TIDAK dimiliki token gateway
  // sendiri (yang wajib memegang `settings:write` dsb.), jadi gateway tetap tak bisa menyentuhnya.
  app.get("/telegram/settings", async () => telegramCredentialView());

  app.put("/telegram/settings", async (req, reply) => {
    const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
    // ADR-0193 · agent token tak boleh memberi gateway (atau orang di allowlist-nya) capability yang
    // ia sendiri tak punya. Cookie manusia tak terkena: ia memang pemilik keputusan itu.
    if (req.agent) {
      const denied = await gatewayEscalation(req.agent.capabilities, body);
      if (denied) return reply.code(403).send(denied);
    }
    const saved = await saveTelegramCredentials(body);
    if (!saved.ok) return reply.code(400).send({ error: saved.error, key: saved.key });
    await reloadTelegramGateway();
    return telegramCredentialView();
  });

  app.post("/telegram/test", async () => testTelegramConnection());

  app.delete("/telegram/credentials", async () => {
    const result = await clearTelegramCredentials();
    await reloadTelegramGateway();
    return result;
  });

  app.get("/telegram/status", async () => telegramRuntimeStatus());

  app.get("/telegram/chats/:chatId/context", async (req, reply) => {
    const context = await store.chatContext((req.params as { chatId: string }).chatId);
    return context ?? reply.code(404).send({ error: "chat not found" });
  });

  app.patch("/telegram/chats/:chatId/context", async (req, reply) => {
    const parsed = zContextPatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const chatId = (req.params as { chatId: string }).chatId;
    try {
      await store.patchChat(chatId, parsed.data);
    } catch {
      return reply.code(404).send({ error: "chat not found" });
    }
    return store.chatContext(chatId);
  });

  app.post("/telegram/chats/:chatId/memories", async (req, reply) => {
    const parsed = zMemory.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const chatId = (req.params as { chatId: string }).chatId;
    if (!await prisma.telegramChat.findUnique({ where: { chatId }, select: { chatId: true } })) {
      return reply.code(404).send({ error: "chat not found" });
    }
    return reply.code(201).send(await store.addMemory(chatId, parsed.data.content));
  });

  app.delete("/telegram/chats/:chatId/memories/:id", async (req, reply) => {
    const { chatId, id } = req.params as { chatId: string; id: string };
    if (!await store.forgetMemory(chatId, id)) return reply.code(404).send({ error: "memory not found" });
    return reply.code(204).send();
  });

  app.delete("/telegram/chats/:chatId/memories", async (req, reply) => {
    if (!await store.resetMemory((req.params as { chatId: string }).chatId)) {
      return reply.code(404).send({ error: "chat not found" });
    }
    return reply.code(204).send();
  });

  app.post("/telegram/replies", async (req, reply) => {
    const parsed = zTelegramReplyInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const input = parsed.data;
    const update = await prisma.telegramUpdate.findFirst({
      where: { updateId: input.updateId, chatId: input.chatId, state: { in: ["dispatching", "dispatched"] } },
    });
    if (!update?.userId) return reply.code(409).send({ error: "update/chat correlation invalid" });
    const outbox = await store.enqueueReply({
      chatId: input.chatId,
      updateId: input.updateId,
      kind: input.kind,
      text: input.text,
      ...(input.confirmation ? { confirmation: {
        callbackToken: randomBytes(12).toString("base64url"),
        userId: update.userId,
        description: input.confirmation.description,
        method: input.confirmation.method,
        path: input.confirmation.path,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      } } : {}),
    });
    if (input.summary !== undefined) await store.patchChat(input.chatId, { summary: input.summary });
    for (const memory of input.remember ?? []) await store.addMemory(input.chatId, memory);
    await store.audit({
      chatId: input.chatId,
      userId: update.userId,
      updateId: input.updateId,
      action: "reply-enqueue",
      outcome: input.kind,
      correlationId: `tg:${input.updateId}`,
    });
    return reply.code(202).send({ id: outbox.id, state: outbox.state });
  });

  app.get("/telegram/audit", async (req, reply) => {
    const parsed = z.object({
      chatId: z.string().optional(),
      updateId: z.coerce.number().int().nonnegative().optional(),
      take: z.coerce.number().int().min(1).max(100).default(50),
      skip: z.coerce.number().int().min(0).default(0),
    }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid query" });
    return store.listAudit(parsed.data);
  });
}
