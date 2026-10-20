import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { sessionEventToken } from "../src/services/session-event-token";
import { openEvent, __resetInbox } from "../src/services/lead/inbox";
import { capabilityForRoute } from "../src/services/agent-capabilities";

// ADR-0228 · permukaan pane lead: token HMAC per sesi, proyek dari pane, bukan dari body.

const PANE: Record<string, unknown> = {
  "lead-demo": { id: "lead-demo", projectId: "demo", exited: false, agent: "claude", cwd: "/repo/.worktrees/lead-demo" },
  "lead-mati": { id: "lead-mati", projectId: "demo", exited: true, agent: "claude", cwd: "/w" },
  "spec-1": { id: "spec-1", projectId: "demo", specId: "SPEC-1", exited: false, agent: "claude", cwd: "/w" },
};
vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  getSession: vi.fn((id: string) => PANE[id]),
  getSessionAsync: vi.fn(async (id: string) => PANE[id]),
  listSessionsAsync: vi.fn(async () => Object.values(PANE)),
  listPanesAsync: vi.fn(async () => []),
}));

const app = buildApp();
const payload = { prompt: "p", gate: "pulse" as const, leadKind: "quality" as const, options: [], select: null };
const h = (id: string, token = sessionEventToken(id)) => ({ "x-hanoman-session": id, authorization: `Bearer ${token}` });

beforeEach(async () => {
  await prisma.leadEvent.deleteMany();
  await prisma.leadApproval.deleteMany();
  await prisma.project.deleteMany();
  __resetInbox();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
});
afterAll(async () => { await prisma.leadEvent.deleteMany(); await prisma.project.deleteMany(); });

describe("/api/lead-pane", () => {
  it("401 tanpa token sah atau dengan token sesi lain", async () => {
    expect((await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: h("lead-demo", "salah") })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: h("lead-demo", sessionEventToken("spec-1")) })).statusCode).toBe(401);
  });
  it("403 untuk pane yang bukan pane lead, 404 untuk pane lead yang mati", async () => {
    expect((await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: h("spec-1") })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: h("lead-mati") })).statusCode).toBe(404);
  });
  it("brief untuk pane lead yang hidup", async () => {
    await openEvent({ projectId: "demo", kind: "ask", question: "q", payload });
    const r = await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: h("lead-demo") });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.budget).toBeDefined();
    expect(body.data.inbox).toHaveLength(1);
    expect(body.data.live.map((s: { id: string }) => s.id)).toEqual(["spec-1"]);
    expect(body.text).toContain("Jatah peluncuran");
  });
  it("act: 400 bentuk salah; 200 untuk event proyeknya", async () => {
    expect((await app.inject({ method: "POST", url: "/api/lead-pane/act", headers: h("lead-demo"), payload: { verdict: {} } })).statusCode).toBe(400);
    const e = await openEvent({ projectId: "demo", kind: "rejected", question: "q", payload: { ...payload, mode: "post" } });
    const a = await app.inject({ method: "POST", url: "/api/lead-pane/act", headers: h("lead-demo"),
      payload: { eventId: e.id, verdict: { decision: "dicatat", reason: "r", action: "none" } } });
    expect(a.statusCode).toBe(200);
    expect(a.json().outcome).toBe("lolos");
  });
  it("act untuk event proyek lain ditolak", async () => {
    const e = await openEvent({ projectId: "lain", kind: "ask", question: "q", payload });
    const a = await app.inject({ method: "POST", url: "/api/lead-pane/act", headers: h("lead-demo"),
      payload: { eventId: e.id, verdict: { decision: "x", reason: "r", action: "none" } } });
    expect(a.json()).toMatchObject({ outcome: "ditolak", code: "event-closed" });
  });
  it("dipetakan COOKIE_ONLY untuk agent token", () => {
    expect(capabilityForRoute("POST", "/api/lead-pane/act")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/lead-pane/brief")).toBe("COOKIE_ONLY");
  });
});
