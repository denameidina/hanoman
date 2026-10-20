import { describe, expect, it } from "vitest";
import {
  inboundDigest,
  normalizeTelegramCommand,
  parseConfirmationCallback,
  parseLeadApprovalCallback,
  parseTelegramUpdate,
  sanitizeTelegramOutput,
  splitTelegramText,
} from "../src/services/telegram/protocol";

const allowed = new Set(["7"]);
const privateMessage = (text: string, overrides: Record<string, unknown> = {}) => ({
  update_id: 17,
  message: {
    message_id: 3,
    date: 1,
    from: { id: 7, is_bot: false, first_name: "Dena" },
    chat: { id: 42, type: "private" },
    text,
    ...overrides,
  },
});

describe("Telegram inbound protocol (SPEC-476)", () => {
  it("accepts an allowlisted private text update without persisting a body-shaped result", () => {
    expect(parseTelegramUpdate(privateMessage("status proyek"), allowed)).toEqual({
      ok: true,
      input: {
        updateId: 17, chatId: "42", userId: "7", messageId: 3,
        kind: "text", text: "status proyek",
      },
    });
  });

  it("normalizes addressed commands but leaves natural language intact", () => {
    expect(normalizeTelegramCommand("/STATUS@HanomanBot   sekarang")).toBe("/status sekarang");
    expect(normalizeTelegramCommand("  apa statusnya?  ")).toBe("apa statusnya?");
    expect(parseTelegramUpdate(privateMessage("/STATUS@HanomanBot   sekarang"), allowed))
      .toMatchObject({ ok: true, input: { kind: "command", text: "/status sekarang" } });
  });

  it.each([
    ["group", privateMessage("halo", { chat: { id: -9, type: "group" } })],
    ["sender-bot", privateMessage("halo", { from: { id: 7, is_bot: true, first_name: "bot" } })],
    ["not-allowed", privateMessage("halo", { from: { id: 8, is_bot: false, first_name: "X" } })],
    ["non-text", { update_id: 17, message: { message_id: 3, date: 1, from: { id: 7, is_bot: false }, chat: { id: 42, type: "private" }, photo: [] } }],
  ])("rejects %s updates before dispatch", (reason, update) => {
    expect(parseTelegramUpdate(update, allowed)).toMatchObject({ ok: false, reason });
  });

  it("validates opaque confirmation callbacks and callback ownership fields", () => {
    const update = {
      update_id: 18,
      callback_query: {
        id: "cb-1", from: { id: 7, is_bot: false, first_name: "Dena" },
        message: { message_id: 9, date: 1, chat: { id: 42, type: "private" } },
        data: "tgcf:abc_123:approve",
      },
    };
    expect(parseTelegramUpdate(update, allowed)).toMatchObject({
      ok: true,
      input: { kind: "callback", callbackQueryId: "cb-1", callbackToken: "abc_123", callbackAction: "approve" },
    });
    expect(parseConfirmationCallback("tgcf:abc_123:deny")).toEqual({ token: "abc_123", action: "deny" });
    expect(parseConfirmationCallback(`tgcf:${"x".repeat(61)}:approve`)).toBeNull();
  });

  // ADR-0228 · tombol izin hanoman-lead.
  it("parses lead approval callbacks, still behind the allowlist", () => {
    const cb = (data: string, from = 7) => ({
      update_id: 19,
      callback_query: {
        id: "cb-2", from: { id: from, is_bot: false, first_name: "Dena" },
        message: { message_id: 9, date: 1, chat: { id: 42, type: "private" } }, data,
      },
    });
    expect(parseTelegramUpdate(cb("tgla:cmabc123:approve"), allowed)).toMatchObject({
      ok: true, input: { kind: "callback", leadApprovalId: "cmabc123", callbackAction: "approve", callbackQueryId: "cb-2" },
    });
    expect(parseTelegramUpdate(cb("tgla:cmabc123:deny", 8), allowed)).toMatchObject({ ok: false, reason: "not-allowed" });
    expect(parseLeadApprovalCallback("tgla:x:maybe")).toBeNull();
    expect(parseLeadApprovalCallback("tgla:cm1:deny")).toEqual({ approvalId: "cm1", action: "deny" });
  });

  it("produces a stable digest without echoing the inbound text", () => {
    const digest = inboundDigest({ updateId: 17, chatId: "42", userId: "7", kind: "text", text: "rahasia" });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("rahasia");
  });
});

describe("Telegram outbound safety (SPEC-476)", () => {
  it("removes ANSI/control bytes and redacts exact and patterned credentials", () => {
    const bot = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
    const agent = "hnm_agent_abcdefghijklmnopqrstuvwxyz";
    const dirty = `\u001b[31mhasil\u001b[0m\u0000 ${bot} ${agent} sk-ant-api03-abcdefghijklmnopqrstuvwxyz`;
    const clean = sanitizeTelegramOutput(dirty, [bot, agent]);
    expect(clean).toContain("hasil");
    expect(clean).not.toMatch(/\u001b|\u0000/);
    expect(clean).not.toContain(bot);
    expect(clean).not.toContain(agent);
    expect(clean).not.toContain("sk-ant-");
    expect(clean.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("splits at 4096 UTF-16 units without cutting surrogate pairs", () => {
    const text = `${"a".repeat(4094)}😀${"b".repeat(20)}`;
    const chunks = splitTelegramText(text);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(chunks.join("")).toBe(text);
    expect(chunks.some((chunk) => chunk.endsWith("\ud83d"))).toBe(false);
    expect(chunks.some((chunk) => chunk.startsWith("\ude00"))).toBe(false);
  });

  it("prefers readable whitespace boundaries and rejects empty sanitized output", () => {
    const chunks = splitTelegramText(`${"word ".repeat(1_000)}tail`, 100);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.slice(0, -1).every((chunk) => chunk.endsWith(" "))).toBe(true);
    expect(splitTelegramText("\u001b[31m\u0000\u001b[0m")).toEqual([]);
  });
});
