import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { sessionEventToken } from "../src/services/session-event-token";
import { __resetAsks } from "../src/services/lead/ask";
import { __resetDetect } from "../src/services/lead/detect";
import { setLead } from "../src/services/lead/config";
import { checkAgentCapability } from "../src/services/agent-capabilities";
import { __resetInvocationSnapshots } from "../src/services/agent-invocations";
import { drainSessionEventSpool } from "../src/services/session-event-relay";

// SPEC-909 · ADR-0146 · pintu masuk event. tmux di-mock: route ini tak boleh butuh pane sungguhan.
// `getSession` (sinkron) ikut di-mock karena pagar AC-10 di `admitAsk` memakainya — route memakai
// kembaran asinkronnya supaya tak memblokir event loop, tapi keduanya harus melihat sesi yang sama.
const PANE: Record<string, unknown> = {
  s1: { id: "s1", projectId: "p1", specId: "SPEC-1", exited: false, agent: "claude",
        decisionFile: "/m", cwd: "/w",
        agentRoster: [
          { name: "scout", id: "global:scout", model: "haiku", definitionHash: "a".repeat(64) },
          { name: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low", definitionHash: "b".repeat(64) },
        ] },
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
  await prisma.agentInvocation.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  __resetAsks(); __resetDetect();
  __resetInvocationSnapshots();
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

  it("merekam start/stop subagent idempoten dari roster sesi", async () => {
    const app = buildApp();
    const start = {
      hook_event_name: "SubagentStart", agent_id: "sub-1", agent_type: "scout",
      session_id: "dead",
      definitionHash: "forged-from-agent", model: "forged-model",
    };
    expect((await post(app, start, auth("s1"))).json()).toEqual({ accepted: true });
    expect((await post(app, start, auth("s1"))).json()).toEqual({ duplicate: true });
    const stop = {
      hook_event_name: "SubagentStop", agent_id: "sub-1", agent_type: "scout",
      last_assistant_message: "hasil scout",
    };
    expect((await post(app, stop, auth("s1"))).json()).toEqual({ accepted: true });
    expect((await post(app, stop, auth("s1"))).json()).toEqual({ duplicate: true });
    const rows = await prisma.agentInvocation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sessionId: "s1", projectId: "p1", agentName: "scout", customAgentId: "global:scout",
      status: "completed", resultExcerpt: "hasil scout",
      definitionHash: "a".repeat(64), model: "haiku",
    });
    await app.close();
  });

  // S1 · test di atas tetap sah: Start/Stop KEMBAR adalah replay (spool mengirim ulang event yang
  // sama). Yang dulu ikut terkunci sebagai "duplikat" adalah Start SESUDAH Stop — itu lanjutan relay
  // ADR-0167 (P3: `agent_id` sama), bukan replay, dan kini membuka ulang baris.
  it("S1 · relay jawaban ke subagent yang sama: Start kedua membuka ulang, Stop akhir menang", async () => {
    const app = buildApp();
    const ev = (name: string, extra: object = {}) =>
      ({ hook_event_name: name, agent_id: "ag-relay", agent_type: "hanoman-fase-plan", ...extra });
    const at = (ms: number) => ({ ...auth("s1"), "x-hanoman-event-at": String(ms) });
    const t0 = Date.now() - 60_000;
    expect((await post(app, ev("SubagentStart"), at(t0))).json()).toEqual({ accepted: true });
    expect((await post(app, ev("SubagentStop", { last_assistant_message: "Status: menunggu-keputusan" }),
      at(t0 + 10_000))).json()).toEqual({ accepted: true });
    // replay Start pertama dari spool (lebih tua dari Stop) tetap duplikat
    expect((await post(app, ev("SubagentStart"), at(t0))).json()).toEqual({ duplicate: true });
    expect((await post(app, ev("SubagentStart"), at(t0 + 30_000))).json()).toEqual({ accepted: true });
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-relay" } }))
      .toMatchObject({ status: "running", endedAt: null, startedAt: new Date(t0) });
    expect((await post(app, ev("SubagentStop", { last_assistant_message: "Status: selesai" }),
      at(t0 + 50_000))).json()).toEqual({ accepted: true });
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-relay" } }))
      .toMatchObject({ status: "completed", durationMs: 50_000, resultExcerpt: "Status: selesai" });
    await app.close();
  });

  it("S1 · x-hanoman-event-at di luar rentang wajar diabaikan (jatuh ke waktu terima)", async () => {
    const app = buildApp();
    const before = Date.now();
    await post(app, { hook_event_name: "SubagentStart", agent_id: "ag-far", agent_type: "scout" },
      { ...auth("s1"), "x-hanoman-event-at": String(Date.now() + 86_400_000) });
    const row = await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-far" } });
    expect(row.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
    await app.close();
  });

  it("ADR-0164 · event agen fase menyimpan phase & effort; stop mengambil effort runtime", async () => {
    const app = buildApp();
    const start = await post(app, { hook_event_name: "SubagentStart", agent_id: "ag-1", agent_type: "hanoman-fase-plan" }, auth("s1"));
    expect(start.statusCode).toBe(202);
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-1" } }))
      .toMatchObject({ agentName: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low" });
    const stop = await post(app, { hook_event_name: "SubagentStop", agent_id: "ag-1", agent_type: "hanoman-fase-plan",
      effort: { level: "medium" }, last_assistant_message: "Status: selesai" }, auth("s1"));
    expect(stop.statusCode).toBe(202);
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-1" } }))
      .toMatchObject({ status: "completed", effort: "medium" });
    await app.close();
  });

  it("M-4 · effort.level raksasa dari hook diabaikan — effort roster dipertahankan (ADR-0164)", async () => {
    const app = buildApp();
    await post(app, { hook_event_name: "SubagentStart", agent_id: "ag-m4", agent_type: "hanoman-fase-plan" }, auth("s1"));
    const stop = await post(app, {
      hook_event_name: "SubagentStop", agent_id: "ag-m4", agent_type: "hanoman-fase-plan",
      effort: { level: "x".repeat(10_000) }, last_assistant_message: "Status: selesai",
    }, auth("s1"));
    expect(stop.statusCode).toBe(202);
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-m4" } }))
      .toMatchObject({ status: "completed", effort: "low" });
    await app.close();
  });

  it("review Task 9 · effort runtime SubagentStop hanya menang untuk agen fase, bukan custom agent", async () => {
    const app = buildApp();
    await post(app, { hook_event_name: "SubagentStart", agent_id: "scout-9", agent_type: "scout" }, auth("s1"));
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "scout-9" } }))
      .toMatchObject({ agentName: "scout", phase: null, effort: null });
    const stop = await post(app, { hook_event_name: "SubagentStop", agent_id: "scout-9", agent_type: "scout",
      effort: { level: "max" }, last_assistant_message: "hasil scout" }, auth("s1"));
    expect(stop.statusCode).toBe(202);
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "scout-9" } }))
      .toMatchObject({ status: "completed", effort: null });
    await app.close();
  });

  it("menerima lifecycle sandbox melalui spool relay dan route bertoken yang sama", async () => {
    const app = buildApp();
    const root = mkdtempSync(join(tmpdir(), "hanoman-route-relay-"));
    const dir = join(root, "s1");
    mkdirSync(dir);
    writeFileSync(join(dir, "start.json"), JSON.stringify({
      hook_event_name: "SubagentStart", agent_id: "spooled-1", agent_type: "scout",
    }));

    expect(await drainSessionEventSpool({ inject: (request) => app.inject(request) }, root)).toBe(1);
    expect(await prisma.agentInvocation.findFirst({
      where: { sessionId: "s1", runtimeInvocationId: "spooled-1" },
    })).toMatchObject({ agentName: "scout", status: "running" });
    await app.close();
  });

  it("mengabaikan agent_type di luar roster Hanoman dan lifecycle tanpa id", async () => {
    const app = buildApp();
    for (const body of [
      { hook_event_name: "SubagentStart", agent_id: "x", agent_type: "Explore" },
      { hook_event_name: "SubagentStart", agent_type: "scout" },
    ]) {
      expect((await post(app, body, auth("s1"))).json()).toEqual({ ignored: true });
    }
    expect(await prisma.agentInvocation.count()).toBe(0);
    await app.close();
  });

  it("202 duplicate untuk tool_use_id yang sama", async () => {
    const app = buildApp();
    await post(app, CLAUDE, auth("s1"));
    expect((await post(app, CLAUDE, auth("s1"))).json()).toEqual({ duplicate: true });
    await app.close();
  });

  it("429 saat ember token per sesi habis", async () => {
    // JANGAN membekukan `Date.now`: spy atas global itu bocor ke berkas test lain saat suite
    // berjalan berurutan (terukur — ia menabrak urutan `createdAt` di notifications.route).
    // Determinismenya dibuat dari VOLUME: ember kapasitas 5, isi ulang 1 per 10 detik, jadi 30
    // permintaan berurutan tak mungkin lolos semua kecuali test-nya memakan 250 detik.
    const app = buildApp();
    const codes: number[] = [];
    for (let i = 0; i < 30; i++)
      codes.push((await post(app, { ...CLAUDE, tool_use_id: `t${i}` }, auth("s1"))).statusCode);
    expect(codes.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);   // ember penuh saat mulai
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(10);
    await app.close();
  });

  it("403 untuk agent token — memalsukan pertanyaan bukan capability apa pun", () => {
    expect(checkAgentCapability(["lead:write", "sessions:write"], "POST", "/api/session-events"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
  });
});
