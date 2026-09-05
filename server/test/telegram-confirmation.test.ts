import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING } from "../src/services/settings";
import { isDestructiveTelegramRequest } from "../src/services/telegram/security";
import { clearTelegramRuntime, setTelegramRuntime } from "../src/services/telegram/runtime";

const app = buildApp();
let gatewayHeaders: { authorization: string };
let ordinaryHeaders: { authorization: string };

async function clean() {
  clearTelegramRuntime();
  await prisma.$transaction([
    prisma.telegramAudit.deleteMany(), prisma.telegramConfirmation.deleteMany(),
    prisma.telegramOutbox.deleteMany(), prisma.telegramMemory.deleteMany(),
    prisma.telegramUpdate.deleteMany(), prisma.telegramChat.deleteMany(),
    prisma.telegramGatewayState.deleteMany(), prisma.agentToken.deleteMany(), prisma.setting.deleteMany(),
  ]);
}

beforeEach(async () => {
  await clean();
  await prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } } });
  const gateway = await issueAgentToken({ name: "telegram-gateway", capabilities: ["telegram:write", "ide:git"] });
  const ordinary = await issueAgentToken({ name: "ordinary-agent", capabilities: ["telegram:write"] });
  gatewayHeaders = { authorization: `Bearer ${gateway.token}` };
  ordinaryHeaders = { authorization: `Bearer ${ordinary.token}` };
  setTelegramRuntime({ agentTokenId: gateway.view.id });
  await prisma.telegramChat.create({ data: {
    chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh",
  } });
  await prisma.telegramUpdate.create({ data: {
    updateId: 17, chatId: "42", userId: "7", kind: "command", digest: "a".repeat(64), state: "dispatched",
  } });
  await prisma.telegramMemory.create({ data: { chatId: "42", content: "hapus saya" } });
});
afterAll(async () => { await clean(); await app.close(); });

describe("Telegram destructive confirmation guard (SPEC-476)", () => {
  it("pemungutan worktree memerlukan konfirmasi Telegram sebelum route berjalan", async () => {
    const response = await app.inject({ method: "POST", url: "/api/projects/p1/worktrees/delete",
      headers: { ...gatewayHeaders, "x-hanoman-telegram-update": "17" },
      payload: { names: ["spec-1"], orphanOnly: true } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "telegram confirmation required" });
  });

  it("classifies irreversible route shapes without treating reads or preview as destructive", () => {
    expect(isDestructiveTelegramRequest("DELETE", "/api/telegram/chats/42/memories", undefined)).toBe(true);
    expect(isDestructiveTelegramRequest("POST", "/api/specs/SPEC-1/integrate", {})).toBe(true);
    expect(isDestructiveTelegramRequest("POST", "/api/projects/p1/git/rebase", {})).toBe(true);
    expect(isDestructiveTelegramRequest("POST", "/api/projects/p1/git", { op: "reset-worktree", mode: "hard" })).toBe(true);
    expect(isDestructiveTelegramRequest("POST", "/api/projects/p1/git", { op: "delete-branch", name: "lama" })).toBe(true);
    expect(isDestructiveTelegramRequest("POST", "/api/projects/p1/git", { op: "fetch" })).toBe(false);
    expect(isDestructiveTelegramRequest("POST", "/api/vps/v1/remediate", {})).toBe(true);
    expect(isDestructiveTelegramRequest("POST", "/api/vps/v1/remediate/preview", {})).toBe(false);
    expect(isDestructiveTelegramRequest("GET", "/api/projects", undefined)).toBe(false);
    expect(isDestructiveTelegramRequest("PATCH", "/api/specs/SPEC-1", { stage: "planned" })).toBe(false);
    expect(isDestructiveTelegramRequest("PATCH", "/api/specs/SPEC-1", { stage: "planned", confirmDelete: true })).toBe(true);
  });

  it("requires correlation on every request made by the configured gateway identity", async () => {
    const response = await app.inject({ method: "DELETE", url: "/api/telegram/chats/42/memories", headers: gatewayHeaders });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "telegram correlation required" });
  });

  it("consumes one matching approved confirmation before running a destructive route", async () => {
    const confirmation = await prisma.telegramConfirmation.create({ data: {
      callbackToken: "abc123", chatId: "42", userId: "7", updateId: 17,
      description: "Reset memory", method: "DELETE", path: "/api/telegram/chats/42/memories",
      state: "approved", expiresAt: new Date(Date.now() + 60_000), approvedAt: new Date(),
    } });
    const headers = {
      ...gatewayHeaders,
      "x-hanoman-telegram-update": "17",
      "x-hanoman-telegram-confirmation": confirmation.id,
    };
    expect((await app.inject({ method: "DELETE", url: "/api/telegram/chats/42/memories", headers })).statusCode).toBe(204);
    expect((await prisma.telegramConfirmation.findUnique({ where: { id: confirmation.id } }))?.state).toBe("used");
    expect(await prisma.telegramMemory.count()).toBe(0);
    expect((await app.inject({ method: "DELETE", url: "/api/telegram/chats/42/memories", headers })).statusCode).toBe(403);
  });

  it("does not impose Telegram confirmation on ordinary agent tokens", async () => {
    expect((await app.inject({
      method: "DELETE", url: "/api/telegram/chats/42/memories", headers: ordinaryHeaders,
    })).statusCode).toBe(204);
  });
});
