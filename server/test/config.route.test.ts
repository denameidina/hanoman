import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { loadConfig } from "../src/config";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING } from "../src/services/settings";

const app = buildApp();
const clean = async () => {
  await prisma.runtimeConfig.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
};
beforeEach(async () => { await clean(); await loadConfig(); });
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
async function login() {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return cookieOf(r);
}

describe("config routes", () => {
  it("401 tanpa cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/config" })).statusCode).toBe(401);
  });
  it("GET: entri lengkap + sync status; secret termask tanpa value", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.sync).toMatchObject({ running: expect.any(Boolean), connected: expect.any(Boolean) });
    const token = body.entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN");
    expect(token.category).toBe("credential");
    expect(token).not.toHaveProperty("value");
    expect(token.hasValue).toBe(false);
    const bootstrap = body.entries.find((e: any) => e.key === "DATABASE_URL");
    expect(bootstrap.editable).toBe(false);
  });
  it("PUT knob valid → tersimpan + source db", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_TICK_MS", value: "3000" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ key: "SYNC_TICK_MS", value: "3000", source: "db" });
  });
  it("PUT int invalid → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_TICK_MS", value: "5" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT bootstrap → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "PORT", value: "9000" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT unknown key → 400", async () => {
    const cookie = await login();
    const put = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "NOPE", value: "x" } });
    expect(put.statusCode).toBe(400);
  });
  it("PUT secret; GET termask; blank pertahankan; DELETE clear", async () => {
    const cookie = await login();
    await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_DEVICE_TOKEN", value: "supersecret9999" } });
    let g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    let tok = g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN");
    expect(tok.hasValue).toBe(true);
    expect(tok.masked).toBe("••••9999");
    expect(tok).not.toHaveProperty("value");
    // blank = pertahankan
    await app.inject({ method: "PUT", url: "/api/config", headers: { cookie }, payload: { key: "SYNC_DEVICE_TOKEN", value: "" } });
    g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN").hasValue).toBe(true);
    // DELETE clear
    const del = await app.inject({ method: "DELETE", url: "/api/config/SYNC_DEVICE_TOKEN", headers: { cookie } });
    expect(del.statusCode).toBe(204);
    g = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(g.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN").hasValue).toBe(false);
  });
});

// SPEC-477 · ADR-0097 · AgentToken gateway Telegram WAJIB memegang `settings:write` (ADR-0096 §2),
// dan capabilityForRoute memetakan /config ke settings:write. Tanpa pagar ini sesi operator
// Telegram bisa menulis ulang bot token & AgentToken-nya SENDIRI lewat percakapan.
describe("SPEC-477 · kategori credential = cookie-only", () => {
  async function agentHeaders() {
    await prisma.setting.upsert({
      where: { id: 1 },
      update: { data: { ...DEFAULT_SETTING, agentAccessEnabled: true } },
      create: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true } },
    });
    const { token } = await issueAgentToken({ name: "tg", capabilities: ["settings:read", "settings:write"] });
    return { authorization: `Bearer ${token}` };
  }

  it("agent token ber-settings:write ditolak 403 untuk PUT key credential", async () => {
    const headers = await agentHeaders();
    const r = await app.inject({ method: "PUT", url: "/api/config", headers,
      payload: { key: "GITHUB_TOKEN", value: "ghp_dari_agen" } });
    expect(r.statusCode).toBe(403);
    expect(await prisma.runtimeConfig.findUnique({ where: { key: "GITHUB_TOKEN" } })).toBeNull();
  });

  it("agent token ditolak 403 untuk DELETE key credential", async () => {
    const headers = await agentHeaders();
    expect((await app.inject({ method: "DELETE", url: "/api/config/GITHUB_TOKEN", headers })).statusCode).toBe(403);
  });

  it("agent settings:write tidak dapat mengganti origin sync", async () => {
    const headers = await agentHeaders();
    const r = await app.inject({ method: "PUT", url: "/api/config", headers,
      payload: { key: "SYNC_SERVER_URL", value: "https://attacker.example" } });
    expect(r.statusCode).toBe(403);
    expect(await prisma.runtimeConfig.findUnique({ where: { key: "SYNC_SERVER_URL" } })).toBeNull();
  });

  it("cookie mengganti origin dan mencabut device token secara atomik", async () => {
    const cookie = await login();
    await app.inject({ method: "PUT", url: "/api/config", headers: { cookie },
      payload: { key: "SYNC_DEVICE_TOKEN", value: "old-device-token" } });
    const r = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie },
      payload: { key: "SYNC_SERVER_URL", value: "https://new-hub.example" } });
    expect(r.statusCode).toBe(200);
    const token = await prisma.runtimeConfig.findUnique({ where: { key: "SYNC_DEVICE_TOKEN" } });
    expect(token).not.toBeNull();
    expect(r.json()).toMatchObject({ key: "SYNC_SERVER_URL", value: "https://new-hub.example" });
    const config = await app.inject({ method: "GET", url: "/api/config", headers: { cookie } });
    expect(config.json().entries.find((e: any) => e.key === "SYNC_DEVICE_TOKEN").hasValue).toBe(false);
  });

  it("agent token TETAP boleh menulis key knob", async () => {
    const headers = await agentHeaders();
    const r = await app.inject({ method: "PUT", url: "/api/config", headers, payload: { key: "SYNC_TICK_MS", value: "5000" } });
    expect(r.statusCode).toBe(200);
  });

  it("cookie admin lolos untuk key credential", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "PUT", url: "/api/config", headers: { cookie },
      payload: { key: "GITHUB_TOKEN", value: "ghp_dari_admin" } });
    expect(r.statusCode).toBe(200);
  });
});
