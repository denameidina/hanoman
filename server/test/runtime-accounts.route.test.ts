import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { refreshSnapshot } from "../src/services/runtime-accounts/registry";
import { loginArgv } from "../src/services/runtime-accounts/login";

const home = mkdtempSync(join(tmpdir(), "ra-route-"));
const prev = { h: process.env.HANOMAN_HOME, c: process.env.HANOMAN_CLAUDE_HOME, x: process.env.HANOMAN_CODEX_HOME };
process.env.HANOMAN_HOME = home;
process.env.HANOMAN_CLAUDE_HOME = join(home, "base-claude");
process.env.HANOMAN_CODEX_HOME = join(home, "base-codex");
const app = buildApp({ requireAuth: false });
afterAll(async () => {
  await app.close();
  for (const [k, v] of [["HANOMAN_HOME", prev.h], ["HANOMAN_CLAUDE_HOME", prev.c], ["HANOMAN_CODEX_HOME", prev.x]] as const)
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(home, { recursive: true, force: true });
});
beforeEach(async () => { await prisma.runtimeAccount.deleteMany(); await prisma.setting.deleteMany(); await refreshSnapshot(); });

describe("/api/runtime-accounts", () => {
  it("GET → 3 akun bawaan + flag sandbox", async () => {
    const res = await app.inject({ method: "GET", url: "/api/runtime-accounts" });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts.map((a: { id: string }) => a.id)).toEqual(["default:claude", "default:codex", "default:antigravity"]);
    expect(typeof res.json().sandbox).toBe("boolean");
  });

  it("POST → 201; body cacat → 400; label sama → 409", async () => {
    const ok = await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "codex", label: "Kantor" } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ runtime: "codex", label: "Kantor", status: "belum-login" });
    expect((await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "x", label: "" } })).statusCode).toBe(400);
    const dup = await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "codex", label: "Kantor" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "account-label-taken" });
  });

  it("PATCH/DELETE akun bawaan → 400; id asing → 404", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/runtime-accounts/default%3Aclaude" })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/runtime-accounts/default%3Aclaude", payload: { label: "X" } })).statusCode).toBe(400);
    const nf = await app.inject({ method: "DELETE", url: "/api/runtime-accounts/deadbeef" });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toMatchObject({ error: "account-not-found" });
  });

  it("PATCH ganti label, DELETE → 204", async () => {
    const id = (await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "claude", label: "A" } })).json().id;
    const p = await app.inject({ method: "PATCH", url: `/api/runtime-accounts/${id}`, payload: { label: "B" } });
    expect(p.json()).toMatchObject({ label: "B" });
    expect((await app.inject({ method: "DELETE", url: `/api/runtime-accounts/${id}` })).statusCode).toBe(204);
  });

  it("PUT default: akun bawaan selalu boleh; runtime salah → 409", async () => {
    const id = (await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "claude", label: "A" } })).json().id;
    const bad = await app.inject({ method: "PUT", url: "/api/runtime-accounts/default", payload: { runtime: "codex", accountId: id } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toMatchObject({ error: "account-runtime-mismatch" });
    const ok = await app.inject({ method: "PUT", url: "/api/runtime-accounts/default", payload: { runtime: "claude", accountId: "default:claude" } });
    expect(ok.statusCode).toBe(200);
  });

  it("capability: baca & set default terbuka untuk settings:*, sisanya COOKIE_ONLY", () => {
    expect(capabilityForRoute("GET", "/api/runtime-accounts")).toBe("settings:read");
    expect(capabilityForRoute("PUT", "/api/runtime-accounts/default")).toBe("settings:write");
    for (const [m, p] of [["POST", "/api/runtime-accounts"], ["PATCH", "/api/runtime-accounts/x"], ["DELETE", "/api/runtime-accounts/x"],
      ["POST", "/api/runtime-accounts/x/login"], ["POST", "/api/runtime-accounts/x/check"]] as const)
      expect(capabilityForRoute(m, p), `${m} ${p}`).toBe("COOKIE_ONLY");
  });
});

describe("loginArgv", () => {
  it("claude: auth login --claudeai; codex: login [+ --device-auth]", () => {
    expect(loginArgv("claude", {}).slice(1)).toEqual(["auth", "login", "--claudeai"]);
    expect(loginArgv("codex", {}).slice(1)).toEqual(["login"]);
    expect(loginArgv("codex", { deviceAuth: true }).slice(1)).toEqual(["login", "--device-auth"]);
  });
});
