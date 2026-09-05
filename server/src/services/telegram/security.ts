import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db";
import { telegramGatewayAgentTokenId } from "./runtime";
import { TelegramStore } from "./store";

const store = new TelegramStore(prisma);

export function isDestructiveTelegramRequest(method: string, path: string, body: unknown): boolean {
  const verb = method.toUpperCase();
  if (verb === "DELETE") return true;
  if (verb === "POST") {
    if (/\/update\/apply$/.test(path)) return true;
    if (/\/(?:specs|terminal\/sessions)\/[^/]+\/integrate$/.test(path)) return true;
    if (/\/projects\/[^/]+\/(?:git\/(?:merge|rebase|drop|reset|clean)|(?:branches|worktrees)\/delete)$/.test(path)) return true;
    if (/\/projects\/[^/]+\/git$/.test(path)) {
      const data = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      return new Set([
        "merge", "cherry-pick", "revert", "delete-branch", "reset", "delete-tag",
        "reset-worktree", "clean", "stash-pop", "stash-drop",
      ]).has(String(data.op ?? ""));
    }
    if (/\/vps\/[^/]+\/(?:harden|remediate)$/.test(path)) return true;
  }
  if (verb === "PATCH" && /\/specs\/[^/]+$/.test(path)) {
    const data = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
    // Route revert existing memakai dua langkah: request pertama tanpa confirmDelete adalah preview;
    // hanya request kedua yang benar-benar menghapus artefak docs/worktree.
    return typeof data.stage === "string" && data.confirmDelete === true;
  }
  return false;
}

const header = (req: FastifyRequest, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === "string" && value ? value : null;
};

async function reject(
  req: FastifyRequest,
  reply: FastifyReply,
  message: string,
  updateId?: number,
): Promise<void> {
  const path = req.url.split("?")[0] ?? req.url;
  await store.audit({
    updateId: updateId ?? null,
    action: "api-guard",
    outcome: `rejected:${message}`,
    correlationId: updateId === undefined ? null : `tg:${updateId}`,
    method: req.method,
    path,
    statusCode: 403,
  }).catch(() => {});
  await reply.code(403).send({ error: message });
}

/** Fastify preHandler sesudah auth/capability: hanya identitas AgentToken gateway yang kena pagar ini. */
export async function guardTelegramGatewayRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const gatewayId = telegramGatewayAgentTokenId();
  if (!gatewayId || req.agent?.id !== gatewayId) return;
  const correlation = header(req, "x-hanoman-telegram-update");
  const updateId = correlation && /^\d+$/.test(correlation) ? Number(correlation) : null;
  if (updateId === null || !Number.isSafeInteger(updateId)) {
    return reject(req, reply, "telegram correlation required");
  }
  const update = await prisma.telegramUpdate.findUnique({ where: { updateId } });
  if (!update?.chatId || !update.userId) return reject(req, reply, "telegram correlation invalid", updateId);

  const path = req.url.split("?")[0] ?? req.url;
  if (!isDestructiveTelegramRequest(req.method, path, req.body)) return;
  const confirmationId = header(req, "x-hanoman-telegram-confirmation");
  if (!confirmationId) return reject(req, reply, "telegram confirmation required", updateId);
  const consumed = await prisma.telegramConfirmation.updateMany({
    where: {
      id: confirmationId,
      state: "approved",
      updateId,
      chatId: update.chatId,
      userId: update.userId,
      method: req.method,
      path,
      expiresAt: { gt: new Date() },
    },
    data: { state: "used", usedAt: new Date() },
  });
  if (consumed.count !== 1) return reject(req, reply, "telegram confirmation invalid", updateId);
  await store.audit({
    chatId: update.chatId,
    userId: update.userId,
    updateId,
    action: "confirmation-consume",
    outcome: "accepted",
    correlationId: `tg:${updateId}`,
    method: req.method,
    path,
  }).catch(() => {});
}

export async function auditTelegramGatewayResponse(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const gatewayId = telegramGatewayAgentTokenId();
  if (!gatewayId || req.agent?.id !== gatewayId) return;
  const value = header(req, "x-hanoman-telegram-update");
  const updateId = value && /^\d+$/.test(value) ? Number(value) : null;
  const update = updateId === null ? null : await prisma.telegramUpdate.findUnique({ where: { updateId } });
  await store.audit({
    chatId: update?.chatId ?? null,
    userId: update?.userId ?? null,
    updateId,
    action: "api-request",
    outcome: reply.statusCode < 400 ? "accepted" : "rejected",
    correlationId: updateId === null ? null : `tg:${updateId}`,
    method: req.method,
    path: req.url.split("?")[0] ?? req.url,
    statusCode: reply.statusCode,
  }).catch(() => {});
}
