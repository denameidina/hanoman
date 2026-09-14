import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { __resetEventLog } from "../src/services/logs/event-log";
import { getSetting } from "../src/services/settings";
import { makeSetting } from "./factory";

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.logEntry.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(async () => { await clean(); __resetEventLog(); });
afterAll(async () => { await app.close(); await clean(); });

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0]!;
const login = async () => cookieOf(await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));
const put = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: "PUT", url: "/api/remote-control", headers: { cookie }, payload });

describe("/api/remote-control (SPEC-1215 · ADR-0165 §4)", () => {
  it("tanpa cookie 401; view default mati", async () => {
    expect((await app.inject({ method: "GET", url: "/api/remote-control" })).statusCode).toBe(401);
    const cookie = await login();
    const res = await app.inject({ method: "GET", url: "/api/remote-control", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      control: { enabled: false, capabilities: [] },
      logs: { event: true, server: false, transcript: false },
      relay: { state: "off", since: null, hubOrigin: null, lastClose: null },
      audit: [],
    });
  });

  it("agent token ber-settings:write tetap 403 untuk GET dan PUT (AC-A3)", async () => {
    await makeSetting({ agentAccessEnabled: true });
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["settings:write", "sessions:write"] });
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "GET", url: "/api/remote-control", headers: h })).statusCode).toBe(403);
    const res = await app.inject({ method: "PUT", url: "/api/remote-control", headers: h, payload: { control: { enabled: true, capabilities: ["sessions:read"] } } });
    expect(res.statusCode).toBe(403);
    expect((await getSetting()).remoteControl.enabled).toBe(false);
  });

  it("400: capability asing, tulis tanpa sessions:read, field asing", async () => {
    const cookie = await login();
    expect((await put(cookie, { control: { enabled: true, capabilities: ["vps:exec"] } })).statusCode).toBe(400);
    expect((await put(cookie, { control: { enabled: true, capabilities: ["sessions:write"] } })).statusCode).toBe(400);
    expect((await put(cookie, { control: { enabled: true, capabilities: [] }, extra: 1 })).statusCode).toBe(400);
  });

  it("PUT sah menyimpan grant + grant.changed beraktor cookie; PUT identik tak menambah audit", async () => {
    const cookie = await login();
    const body = { control: { enabled: true, capabilities: ["sessions:read", "sessions:spawn"] } };
    const res = await put(cookie, body);
    expect(res.statusCode).toBe(200);
    expect(res.json().control).toEqual(body.control);
    expect((await getSetting()).remoteControl).toEqual(body.control);
    expect(res.json().audit).toEqual([expect.objectContaining({
      kind: "grant.changed", data: expect.objectContaining({ scope: "control", by: "a@b.co", to: body.control }),
    })]);
    await put(cookie, body);
    expect(await prisma.logEntry.count({ where: { kind: "grant.changed" } })).toBe(1);
  });
});
