import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { sessionEventToken } from "../src/services/session-event-token";
import { __resetAsks } from "../src/services/lead/ask";
import { __resetDetect } from "../src/services/lead/detect";
import { setLead } from "../src/services/lead/config";
import { checkAgentCapability } from "../src/services/agent-capabilities";

// SPEC-909 · ADR-0146 · pintu masuk event. tmux di-mock: route ini tak boleh butuh pane sungguhan.
// `getSession` (sinkron) ikut di-mock karena pagar AC-10 di `admitAsk` memakainya — route memakai
// kembaran asinkronnya supaya tak memblokir event loop, tapi keduanya harus melihat sesi yang sama.
const PANE: Record<string, unknown> = {
  s1: { id: "s1", projectId: "p1", specId: "SPEC-1", exited: false, agent: "claude",
        decisionFile: "/m", cwd: "/w" },
  dead: { id: "dead", projectId: "p1", exited: true, agent: "claude", cwd: "/w" },
};
vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  getSession: vi.fn((id: string) => PANE[id]),
  getSessionAsync: vi.fn(async (id: string) => PANE[id]),
  listSessions: vi.fn(() => Object.values(PANE)),
}));

const CLAUDE = {
  hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_1",
  tool_input: { questions: [{ question: "Basis?", header: "Basis", multiSelect: false,
    options: [{ label: "SQLite" }] }] },
};

const auth = (id: string) => ({
  authorization: `Bearer ${sessionEventToken(id)}`, "x-hanoman-session": id,
});

type App = ReturnType<typeof buildApp>;
const post = (app: App, body: object, headers: Record<string, string>): Promise<LightMyRequestResponse> =>
  app.inject({ method: "POST", url: "/api/session-events", payload: body, headers });

// Lead dinyalakan & project di-opt-in: tanpa itu setiap event dijawab `rejected` dan test
// idempotensi/batas laju hanya menguji pagar, bukan jalur yang dimaksudnya.
const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.leadFlow.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  __resetAsks(); __resetDetect();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web", leadOptIn: true } });
  await setLead({ ...LEAD_DEFAULTS, enabled: true });
});
afterAll(clean);

describe("POST /api/session-events", () => {
  it("menerima event bertoken sah", async () => {
    const app = buildApp();
    const r = await post(app, CLAUDE, auth("s1"));
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ accepted: true });
    await app.close();
  });

  it("401 tanpa Authorization — id sesi saja tak pernah cukup", async () => {
    const app = buildApp();
    expect((await post(app, CLAUDE, { "x-hanoman-session": "s1" })).statusCode).toBe(401);
    await app.close();
  });

  it("401 dengan token milik sesi LAIN", async () => {
    const app = buildApp();
    const r = await post(app, CLAUDE, {
      authorization: `Bearer ${sessionEventToken("s2")}`, "x-hanoman-session": "s1",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("404 untuk sesi yang tak hidup", async () => {
    const app = buildApp();
    expect((await post(app, CLAUDE, auth("dead"))).statusCode).toBe(404);
    expect((await post(app, CLAUDE, auth("entah"))).statusCode).toBe(404);
    await app.close();
  });

  it("202 ignored untuk event yang bukan pertanyaan", async () => {
    const app = buildApp();
    const r = await post(app, { ...CLAUDE, tool_name: "Bash" }, auth("s1"));
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ ignored: true });
    await app.close();
  });

  it("202 duplicate untuk tool_use_id yang sama", async () => {
    const app = buildApp();
    await post(app, CLAUDE, auth("s1"));
    expect((await post(app, CLAUDE, auth("s1"))).json()).toEqual({ duplicate: true });
    await app.close();
  });

  it("429 saat ember token per sesi habis", async () => {
    // Jam DIBEKUKAN, bukan diandalkan. Ember isi ulang 1 token per 10 detik, dan delapan `inject`
    // berurutan bisa memakan lebih dari itu saat suite penuh berjalan di mesin sibuk — test yang
    // memakai jam dinding karena itu hijau sendirian dan merah di bawah beban. Yang diuji di sini
    // adalah PEMETAAN 429-nya; perilaku embernya sendiri diuji ber-`now` suntikan di lead-ask.
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const app = buildApp();
      const codes: number[] = [];
      for (let i = 0; i < 8; i++)
        codes.push((await post(app, { ...CLAUDE, tool_use_id: `t${i}` }, auth("s1"))).statusCode);
      expect(codes.filter((c) => c === 202)).toHaveLength(5);   // kapasitas ember
      expect(codes.filter((c) => c === 429)).toHaveLength(3);
      await app.close();
    } finally {
      clock.mockRestore();
    }
  });

  it("403 untuk agent token — memalsukan pertanyaan bukan capability apa pun", () => {
    expect(checkAgentCapability(["lead:write", "sessions:write"], "POST", "/api/session-events"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
  });
});
