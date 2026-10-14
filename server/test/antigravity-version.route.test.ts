import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { createSession } from "../src/services/auth";
import { issueAgentToken } from "../src/services/agent-token";
import { clearConfig, setConfig } from "../src/config";

const app = buildApp();
const dir = mkdtempSync(join(tmpdir(), "antigravity-version-route-"));
const bin = join(dir, "agy");
writeFileSync(bin, `#!${process.execPath}\nconsole.log("1.3.4");`, { mode: 0o700 });
const clean = async () => { await prisma.agentToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany(); await prisma.setting.deleteMany(); await clearConfig("HANOMAN_ANTIGRAVITY_BIN"); };
beforeEach(async () => { await clean(); vi.stubEnv("HANOMAN_ANTIGRAVITY_BIN", bin); });
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await clean(); await app.close(); rmSync(dir, { recursive: true, force: true }); });
const bearer = async () => {
  await prisma.setting.create({ data: { id: 1, data: { model: "sonnet", effort: "medium", autoDefault: true, autoScaffold: true,
    notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true,
    notifyDecisionSound: "alert", agentAccessEnabled: true } } });
  return { authorization: `Bearer ${(await issueAgentToken({ name: "version-observer", capabilities: [] })).token}` };
};

describe("GET /api/antigravity/version", () => {
  it("requires authentication", async () => {
    expect((await app.inject({ method: "GET", url: "/api/antigravity/version" })).statusCode).toBe(401);
  });
  it("accepts an admin cookie", async () => {
    const user = await prisma.user.create({ data: { email: "observer@example.com", passwordHash: "unused", role: "admin" } });
    const token = await createSession(user.id);
    const res = await app.inject({ method: "GET", url: "/api/antigravity/version", headers: { cookie: `hn_session=${token}` } });
    expect(res.statusCode).toBe(200); expect(res.json()).toEqual({ version: "1.3.4", error: null });
  });
  it("accepts an empty-capability agent token and retains the Codex DTO", async () => {
    const headers = await bearer();
    const res = await app.inject({ method: "GET", url: "/api/antigravity/version", headers });
    expect(res.statusCode).toBe(200); expect(res.json()).toEqual({ version: "1.3.4", error: null });
    vi.stubEnv("HANOMAN_CODEX_BIN", "/not-installed/codex");
    const codex = await app.inject({ method: "GET", url: "/api/codex/version", headers });
    expect(codex.statusCode).toBe(200); expect(codex.json()).toEqual({ version: null, minRequired: "0.144.0", ok: true });
  });
  it("observes DB binary changes immediately and never returns a missing-binary 500", async () => {
    const headers = await bearer();
    expect((await app.inject({ method: "GET", url: "/api/antigravity/version", headers })).json().version).toBe("1.3.4");
    await setConfig("HANOMAN_ANTIGRAVITY_BIN", "/private/home/token/no-agy");
    const res = await app.inject({ method: "GET", url: "/api/antigravity/version", headers });
    expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ version: null, error: expect.any(String) });
    expect(res.body).not.toMatch(/private|home|token/);
  });
  it("boundary changes invalidate host success with a safe unsupported reason", async () => {
    const headers = await bearer();
    expect((await app.inject({ method: "GET", url: "/api/antigravity/version", headers })).json().version).toBe("1.3.4");
    vi.stubEnv("HANOMAN_SESSION_SANDBOX", "podman");
    const res = await app.inject({ method: "GET", url: "/api/antigravity/version", headers });
    expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ version: null, error: expect.stringMatching(/sandbox/) });
  });
});
