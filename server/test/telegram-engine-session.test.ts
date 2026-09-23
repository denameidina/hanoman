import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Agent, AgentEngine } from "@hanoman/shared";
import { prisma } from "../src/db";
import { TelegramSessionCoordinator, telegramOperatorSessionId, type TelegramSessionPort } from "../src/services/telegram/session";
import { TELEGRAM_CONTROL_KIND } from "../src/services/telegram/engine-command";
import { TelegramStore } from "../src/services/telegram/store";
import type { AcceptedTelegramInput } from "../src/services/telegram/protocol";

const store = new TelegramStore(prisma);
const msg = (over: Partial<AcceptedTelegramInput> = {}): AcceptedTelegramInput => ({
  updateId: 91, chatId: "42", userId: "7", messageId: 3, kind: "text", text: "status proyek", ...over,
});

type Born = { projectId: string; cwd: string; opts: Record<string, unknown> };
function fakePort() {
  const born: Born[] = [];
  const sent: { id: string; text: string }[] = [];
  const killed: string[] = [];
  const live = new Map<string, { id: string; exited: boolean }>();
  const port: TelegramSessionPort = {
    getSession: (id) => live.get(id),
    createSession: (projectId, cwd, opts) => {
      born.push({ projectId, cwd, opts });
      const s = { id: String(opts.id), exited: false };
      live.set(s.id, s);
      return s;
    },
    sendToPane: async (id, text) => { sent.push({ id, text }); return live.get(id)?.exited === false; },
    killSession: (id) => { killed.push(id); live.delete(id); return true; },
  };
  return Object.assign(port, { born, sent, killed, live });
}

function coordinator(port: ReturnType<typeof fakePort>, opts: {
  defaults?: { agent: Agent; model: string; effort: string };
  trusted?: string[];
  enabled?: boolean;
  written?: AgentEngine[];
} = {}) {
  const defaults = opts.defaults ?? { agent: "claude" as Agent, model: "claude-opus-5", effort: "xhigh" };
  return new TelegramSessionCoordinator({
    store, port,
    defaults: async () => defaults,
    engine: {
      read: async () => ({
        enabled: opts.enabled ?? false,
        effective: defaults,
        claude: { model: "claude-opus-5", effort: "xhigh" },
        codex: { model: "gpt-5.6-sol", effort: "xhigh" },
      }),
      write: async (next) => { opts.written?.push(next); },
    },
    personality: async () => null,
    ensureCodexTrust: (cwd) => { opts.trusted?.push(cwd); },
    home: "/tmp/hanoman-test",
    apiBase: "http://127.0.0.1:7777",
    agentToken: "hnm_agt_SECRET",
    ensureDir: () => {},
  });
}

// Outbox WAJIB ikut dibersihkan: `dedupeKey` outbox = `chat:update:kind`, jadi baris sisa test
// sebelumnya membuat `enqueueReply` mengembalikan baris LAMA (bukan mengantre yang baru) dan
// assertion `rows[0]` membaca teks test tetangga.
const clean = async () => {
  await prisma.$transaction([
    prisma.telegramOutbox.deleteMany(), prisma.telegramUpdate.deleteMany(),
    prisma.telegramMemory.deleteMany(), prisma.telegramChat.deleteMany(),
  ]);
};
beforeEach(clean);
afterAll(clean);

const outbox = (chatId: string) =>
  prisma.telegramOutbox.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });

describe("SPEC-492 · sesi operator lahir dari resolver segar", () => {
  // Inti temuan: baris chat membekukan nilai saat chat pertama menyapa dan TAK ADA penulis lain.
  it("baris chat lama tak lagi membekukan runtime sesi berikutnya", async () => {
    await store.ensureChat({ chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    const port = fakePort();
    await coordinator(port, { defaults: { agent: "claude", model: "claude-haiku-4-5", effort: "low" } }).dispatch(msg());
    expect(port.born).toHaveLength(1);
    expect(port.born[0]!.opts).toMatchObject({ agent: "claude", model: "claude-haiku-4-5", effort: "low" });
  });

  it("baris chat ikut diperbarui supaya GET context tak berbohong", async () => {
    await store.ensureChat({ chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    const port = fakePort();
    await coordinator(port, { defaults: { agent: "claude", model: "claude-fable-5", effort: "medium" } }).dispatch(msg());
    const ctx = await store.chatContext("42");
    expect(ctx).toMatchObject({ agent: "claude", model: "claude-fable-5", effort: "medium" });
  });

  // Gotcha SPEC-377/ADR-0081: trust WAJIB diturunkan dari agen HASIL resolver. Membacanya dari
  // baris chat yang beku membuat sesi codex mentok di layar trust tanpa manusia di pane.
  it("ensureCodexTrust memakai agen hasil resolver, bukan agen baris chat", async () => {
    await store.ensureChat({ chatId: "42", userId: "7", agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    const trusted: string[] = [];
    const port = fakePort();
    await coordinator(port, { defaults: { agent: "codex", model: "gpt-5.6-sol", effort: "high" }, trusted }).dispatch(msg());
    expect(trusted).toHaveLength(1);
    expect(port.born[0]!.opts).toMatchObject({ agent: "codex", model: "gpt-5.6-sol", effort: "high" });
  });

  it("agen claude tak pernah memanggil ensureCodexTrust", async () => {
    const trusted: string[] = [];
    await coordinator(fakePort(), { defaults: { agent: "claude", model: "claude-opus-5", effort: "xhigh" }, trusted }).dispatch(msg());
    expect(trusted).toEqual([]);
  });

  // AC-5 · ADR-0061 · sesi = satu proses, satu model seumur hidup. Steer ke pane hidup tak boleh
  // melahirkan sesi kedua maupun mengubah runtime sesi yang sedang jalan.
  it("steer ke pane hidup tak melahirkan sesi baru", async () => {
    const port = fakePort();
    const c = coordinator(port, { defaults: { agent: "claude", model: "claude-opus-5", effort: "xhigh" } });
    await c.dispatch(msg({ updateId: 1 }));
    await c.dispatch(msg({ updateId: 2, text: "lanjut" }));
    expect(port.born).toHaveLength(1);
    expect(port.sent).toHaveLength(1);
  });
});

describe("SPEC-492 · command runtime dicegat sebelum menyentuh pane", () => {
  it("/engine menjawab tanpa melahirkan sesi maupun mengetik ke pane", async () => {
    const port = fakePort();
    const res = await coordinator(port).dispatch(msg({ kind: "command", text: "/engine" }));
    expect(res).toMatchObject({ created: false, control: true });
    expect(port.born).toEqual([]);
    expect(port.sent).toEqual([]);
    const rows = await outbox("42");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe(TELEGRAM_CONTROL_KIND);
    expect(rows[0]!.text).toContain("claude-opus-5");
  });

  it("/model menulis engine dan membalas apa yang berubah", async () => {
    const port = fakePort();
    const written: AgentEngine[] = [];
    await coordinator(port, { written }).dispatch(msg({ kind: "command", text: "/model haiku" }));
    expect(written).toEqual([{ enabled: true, agent: "claude", model: "haiku", effort: "xhigh" }]);
    expect((await outbox("42"))[0]!.text).toContain("haiku");
    expect(port.born).toEqual([]);
  });

  it("/model asing menolak TANPA menulis apa pun", async () => {
    const written: AgentEngine[] = [];
    await coordinator(fakePort(), { written }).dispatch(msg({ kind: "command", text: "/model tidak-ada" }));
    expect(written).toEqual([]);
    expect((await outbox("42"))[0]!.text).toContain("opus");
  });

  it("/engine restart menutup pane hidup dan melepas binding sesi", async () => {
    const port = fakePort();
    const c = coordinator(port);
    await c.dispatch(msg({ updateId: 1 }));                 // lahirkan sesi dulu
    expect(port.born).toHaveLength(1);
    await c.dispatch(msg({ updateId: 2, kind: "command", text: "/engine restart" }));
    expect(port.killed).toEqual([telegramOperatorSessionId("42")]);
    expect((await store.chatContext("42"))?.sessionId).toBeNull();
  });

  it("/engine restart tanpa sesi hidup tetap menjawab, bukan diam", async () => {
    const port = fakePort();
    await coordinator(port).dispatch(msg({ kind: "command", text: "/engine restart" }));
    expect(port.killed).toEqual([]);
    expect((await outbox("42"))[0]!.text.length).toBeGreaterThan(0);
  });

  // Fail-closed: command yang bukan milik kita tetap diteruskan ke pane apa adanya.
  it("/status tetap diteruskan ke sesi operator", async () => {
    const port = fakePort();
    const c = coordinator(port);
    await c.dispatch(msg({ updateId: 1 }));
    const res = await c.dispatch(msg({ updateId: 2, kind: "command", text: "/status" }));
    expect(res.control).toBeUndefined();
    expect(port.sent).toHaveLength(1);
  });
});
