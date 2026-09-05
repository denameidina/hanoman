import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Agent } from "@hanoman/shared";
import { prisma } from "../src/db";
import { TelegramSessionCoordinator, telegramOperatorSessionId, type TelegramSessionPort } from "../src/services/telegram/session";
import { TelegramStore } from "../src/services/telegram/store";
import type { AcceptedTelegramInput } from "../src/services/telegram/protocol";

const store = new TelegramStore(prisma);
const input: AcceptedTelegramInput = {
  updateId: 17, chatId: "42", userId: "7", messageId: 3, kind: "text", text: "status proyek",
};

type Born = { projectId: string; cwd: string; opts: Record<string, unknown> };
function fakePort(): TelegramSessionPort & { born: Born[]; sent: { id: string; text: string }[]; live: Map<string, { id: string; exited: boolean }> } {
  const born: Born[] = [];
  const sent: { id: string; text: string }[] = [];
  const live = new Map<string, { id: string; exited: boolean }>();
  return {
    born, sent, live,
    getSession: (id) => live.get(id),
    createSession: (projectId, cwd, opts) => {
      born.push({ projectId, cwd, opts });
      const session = { id: String(opts.id), exited: false };
      live.set(session.id, session);
      return session;
    },
    sendToPane: async (id, text) => { sent.push({ id, text }); return live.get(id)?.exited === false; },
    killSession: (id) => { live.delete(id); return true; },
  };
}

async function clean() {
  await prisma.$transaction([
    prisma.telegramMemory.deleteMany(), prisma.telegramChat.deleteMany(),
  ]);
}
beforeEach(clean);
afterAll(clean);

function coordinator(
  port: ReturnType<typeof fakePort>,
  defaults: { agent: Agent; model: string; effort: string } = { agent: "claude", model: "claude-opus-5", effort: "xhigh" },
) {
  return new TelegramSessionCoordinator({
    store,
    port,
    defaults: async () => defaults,
    engine: {
      read: async () => ({
        enabled: false,
        effective: defaults,
        claude: { model: "claude-opus-5", effort: "xhigh" },
        codex: { model: "gpt-5.6-sol", effort: "xhigh" },
      }),
      write: async () => {},
    },
    personality: async () => ({
      name: "operator-ringkas", description: "Lugas", instructions: "Gunakan Source of Truth.",
    }),
    ensureCodexTrust: () => {},
    home: "/tmp/hanoman-test",
    apiBase: "http://127.0.0.1:7777",
    agentToken: "hnm_agt_SECRET_SESSION",
    ensureDir: () => {},
  });
}

describe("TelegramSessionCoordinator (SPEC-476)", () => {
  it("creates one deterministic operator session with the first update in its prompt", async () => {
    const port = fakePort();
    const result = await coordinator(port).dispatch(input);
    expect(result).toEqual({ sessionId: telegramOperatorSessionId("42"), created: true });
    expect(port.born).toHaveLength(1);
    expect(port.born[0]).toMatchObject({ projectId: expect.stringMatching(/^telegram:/), cwd: expect.stringContaining("/telegram/") });
    expect(String(port.born[0]!.opts.prompt)).toContain("status proyek");
    expect(String(port.born[0]!.opts.prompt)).toContain("@operator-ringkas");
    expect(port.born[0]!.opts).toMatchObject({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    expect(port.born[0]!.opts.env).toEqual({
      HANOMAN_API_BASE: "http://127.0.0.1:7777",
      HANOMAN_TELEGRAM_AGENT_TOKEN: "hnm_agt_SECRET_SESSION",
      HANOMAN_TELEGRAM_CHAT_ID: "42",
    });
    expect(JSON.stringify(port.born[0]!.opts.env)).not.toMatch(/BOT_TOKEN/);
    expect((await store.chatContext("42"))?.sessionId).toBe(result.sessionId);
  });

  it("waits for asynchronous guarded birth before binding the chat", async () => {
    const port = fakePort();
    const create = port.createSession;
    port.createSession = async (...args) => create(...args);
    const result = await coordinator(port).dispatch(input);
    expect(result).toEqual({ sessionId: telegramOperatorSessionId("42"), created: true });
    expect((await store.chatContext("42"))?.sessionId).toBe(result.sessionId);
    expect(port.born[0]!.opts).not.toHaveProperty("force");
  });

  it("propagates admission rejection without binding a nonexistent pane", async () => {
    const port = fakePort();
    const denial = Object.assign(new Error("cap penuh"), { kind: "capacity" });
    port.createSession = async () => { throw denial; };
    await expect(coordinator(port).dispatch(input)).rejects.toBe(denial);
    expect((await store.chatContext("42"))?.sessionId).toBeNull();
    expect(port.born).toEqual([]);
  });

  it("steers the incoming message when another request created the pane during admission", async () => {
    const port = fakePort();
    const sessionId = telegramOperatorSessionId("42");
    port.createSession = async () => {
      const session = { id: sessionId, exited: false, reused: true as const };
      port.live.set(sessionId, session);
      return session;
    };
    expect(await coordinator(port).dispatch(input)).toEqual({ sessionId, created: false });
    expect(port.sent).toEqual([{ id: sessionId, text: "[Telegram update 17 · chat 42 · kind text]\nstatus proyek" }]);
    expect((await store.chatContext("42"))?.sessionId).toBe(sessionId);
  });

  it("awaits asynchronous pane lookup so an absent pane is created", async () => {
    const port = fakePort();
    const sessionId = telegramOperatorSessionId("42");
    port.getSession = async () => undefined;
    expect(await coordinator(port).dispatch(input)).toEqual({ sessionId, created: true });
    expect(port.born).toHaveLength(1);
    expect(port.sent).toEqual([]);
  });

  it("routes later natural messages and commands to the same live pane", async () => {
    const port = fakePort();
    const c = coordinator(port);
    const first = await c.dispatch(input);
    const second = await c.dispatch({ ...input, updateId: 18, kind: "command", text: "/status" });
    expect(second).toEqual({ sessionId: first.sessionId, created: false });
    expect(port.born).toHaveLength(1);
    expect(port.sent).toEqual([{ id: first.sessionId, text: "[Telegram update 18 · chat 42 · kind command]\n/status" }]);
  });

  it("recovers the durable binding after API restart without creating a second pane", async () => {
    const port = fakePort();
    const first = await coordinator(port).dispatch(input);
    const afterRestart = coordinator(port);
    expect(await afterRestart.dispatch({ ...input, updateId: 18 })).toEqual({ sessionId: first.sessionId, created: false });
    expect(port.born).toHaveLength(1);
  });

  it("recreates a missing pane with the same id and current summary/memory/personality", async () => {
    const port = fakePort();
    const c = coordinator(port);
    const first = await c.dispatch(input);
    await store.patchChat("42", { summary: "Ringkasan tahan restart." });
    await store.addMemory("42", "Jawab ringkas.");
    port.live.delete(first.sessionId);
    const recovered = await c.dispatch({ ...input, updateId: 19, text: "lanjut" });
    expect(recovered).toEqual({ sessionId: first.sessionId, created: true });
    expect(port.born).toHaveLength(2);
    expect(String(port.born[1]!.opts.prompt)).toContain("Ringkasan tahan restart.");
    expect(String(port.born[1]!.opts.prompt)).toContain("Jawab ringkas.");
  });

  it.each([
    [{ agent: "claude" as const, model: "claude-sonnet-5", effort: "medium" }],
    [{ agent: "codex" as const, model: "gpt-5.6-sol", effort: "xhigh" }],
  ])("preserves Settings agent/model parity for $agent", async (defaults) => {
    const port = fakePort();
    await coordinator(port, defaults).dispatch(input);
    expect(port.born[0]!.opts).toMatchObject(defaults);
  });
});
