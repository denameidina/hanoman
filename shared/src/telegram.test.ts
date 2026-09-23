import { describe, expect, it } from "vitest";
import {
  TELEGRAM_DEFAULTS,
  zTelegramAuditRecord,
  zTelegramChatContext,
  zTelegramGatewayStatus,
  zTelegramMemoryRecord,
  zTelegramReplyInput,
  zTelegramSettings,
  zTerminalSteerInput,
  TELEGRAM_BOT_TOKEN_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  TELEGRAM_ALLOWLIST_PATTERN,
  TELEGRAM_CONFIG_KEYS,
} from "./telegram";

describe("Telegram shared contracts (SPEC-476)", () => {
  it("keeps the gateway opt-in while progress defaults on", () => {
    // SPEC-492 · `engine` menyusul di sini; default `enabled:false` menjaga janji "instalasi yang
    // sudah jalan tak berubah perilakunya setelah upgrade".
    expect(TELEGRAM_DEFAULTS).toEqual({
      enabled: false, progress: true,
      engine: { enabled: false, agent: "claude", model: "opus", effort: "xhigh" },
    });
    expect(zTelegramSettings.parse({})).toEqual(TELEGRAM_DEFAULTS);
    expect(zTelegramSettings.safeParse({ enabled: "yes" }).success).toBe(false);
  });

  it("validates secret-free gateway status", () => {
    expect(zTelegramGatewayStatus.parse({
      configured: true,
      enabled: true,
      running: false,
      readiness: "ready",
      botUsername: "hanoman_bot",
      allowlistCount: 1,
      agentTokenConfigured: true,
      missingCapabilities: [],
      lastUpdateAt: null,
      lastError: null,
    })).toMatchObject({ readiness: "ready", allowlistCount: 1, missingCapabilities: [] });
    expect(zTelegramGatewayStatus.safeParse({
      configured: false, enabled: false, running: false, readiness: "unknown",
      allowlistCount: 0, agentTokenConfigured: false,
    }).success).toBe(false);
  });

  it("validates durable chat context and curated memory views", () => {
    const memory = zTelegramMemoryRecord.parse({
      id: "mem-1", chatId: "42", content: "Suka jawaban ringkas.",
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(zTelegramChatContext.parse({
      chatId: "42", userId: "7", sessionId: null, activeProjectId: null,
      activeSessionId: null, personalityAgentId: null, summary: null,
      agent: "claude", model: "opus", effort: "xhigh", memories: [memory],
    }).memories).toHaveLength(1);
  });

  it("accepts only explicit reply kinds and bounded memory/confirmation payloads", () => {
    const base = { chatId: "42", updateId: 17, text: "Selesai." };
    expect(zTelegramReplyInput.parse({ ...base, kind: "final" }).kind).toBe("final");
    expect(zTelegramReplyInput.parse({
      ...base,
      kind: "confirmation",
      confirmation: { description: "Hentikan sesi s-1", method: "DELETE", path: "/api/terminal/sessions/s-1" },
    }).confirmation?.method).toBe("DELETE");
    expect(zTelegramReplyInput.safeParse({ ...base, kind: "reasoning" }).success).toBe(false);
    expect(zTelegramReplyInput.safeParse({ ...base, kind: "final", text: "" }).success).toBe(false);
  });

  it("validates metadata-only audit records and non-empty steer input", () => {
    expect(zTelegramAuditRecord.parse({
      id: "audit-1", chatId: "42", userId: "7", updateId: 17,
      action: "dispatch", outcome: "accepted", correlationId: "tg:17",
      method: null, path: null, statusCode: null, createdAt: "2026-08-01T00:00:00.000Z",
    }).action).toBe("dispatch");
    expect(zTerminalSteerInput.parse({ text: "cek migration" }).text).toBe("cek migration");
    expect(zTerminalSteerInput.safeParse({ text: "   " }).success).toBe(false);
  });
});

describe("SPEC-477 · pola kredensial Telegram", () => {
  it("bot token BotFather diterima, bentuk lain ditolak", () => {
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(true);
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("abc")).toBe(false);
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("123456789")).toBe(false);          // tanpa ":"
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test("123456789:pendek")).toBe(false);   // secret terlalu pendek
    expect(TELEGRAM_BOT_TOKEN_PATTERN.test(" 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(false);
  });

  // Gotcha 4 · channel & supergroup NEGATIF. Pola ^\d+$ menolak persis kasus "Channel ID"
  // yang diminta brief.
  it("chat id menerima negatif (channel/supergroup)", () => {
    expect(TELEGRAM_CHAT_ID_PATTERN.test("42")).toBe(true);
    expect(TELEGRAM_CHAT_ID_PATTERN.test("-1001234567890")).toBe(true);
    expect(TELEGRAM_CHAT_ID_PATTERN.test("@channel")).toBe(false);
    expect(TELEGRAM_CHAT_ID_PATTERN.test("")).toBe(false);
  });

  it("allowlist user id NON-negatif, boleh banyak, koma atau spasi", () => {
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("7")).toBe(true);
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("7,8 9")).toBe(true);
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("-7")).toBe(false);
    expect(TELEGRAM_ALLOWLIST_PATTERN.test("")).toBe(false);
  });

  it("TELEGRAM_CONFIG_KEYS memuat keempat key", () => {
    expect([...TELEGRAM_CONFIG_KEYS]).toEqual([
      "HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN",
      "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
    ]);
  });
});
