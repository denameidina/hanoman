import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { clearConfig, setConfig } from "../src/config";
import { issueDeviceToken } from "../src/services/device-token";
import { hubGitToken, localGitToken, resolveGitToken } from "../src/services/git-token";
import type { Transport } from "../src/services/sync-client";

const app = buildApp();
const clean = async () => {
  await clearConfig("GITHUB_TOKEN");
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("GET /api/sync/git-credential", () => {
  it("401 tanpa device token", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sync/git-credential" });
    expect(r.statusCode).toBe(401);
  });

  it("200 dengan token hub, no-store", async () => {
    await setConfig("GITHUB_TOKEN", "ghp_hub");
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "vps");
    const r = await app.inject({ method: "GET", url: "/api/sync/git-credential", headers: { authorization: `Bearer ${t.token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ token: "ghp_hub" });
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("token: null bila hub tak punya GITHUB_TOKEN", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "vps");
    const r = await app.inject({ method: "GET", url: "/api/sync/git-credential", headers: { authorization: `Bearer ${t.token}` } });
    expect(r.json()).toEqual({ token: null });
  });
});

describe("resolveGitToken", () => {
  it("memakai GITHUB_TOKEN lokal lebih dulu tanpa menyentuh hub", async () => {
    await setConfig("GITHUB_TOKEN", "ghp_lokal");
    expect(localGitToken()).toBe("ghp_lokal");
    let called = false;
    const t = await resolveGitToken({ hub: async () => { called = true; return "ghp_hub"; } });
    expect(t).toBe("ghp_lokal");
    expect(called).toBe(false);
  });

  it("jatuh ke hub bila lokal kosong", async () => {
    expect(await resolveGitToken({ hub: async () => "ghp_hub" })).toBe("ghp_hub");
  });

  it("null bila keduanya kosong", async () => {
    expect(await resolveGitToken({ hub: async () => null })).toBeNull();
  });
});

describe("hubGitToken", () => {
  const ok = (body: unknown, status = 200): Transport => async () => ({ status, body });
  it("mengembalikan token dari balasan 200", async () => {
    expect(await hubGitToken(ok({ token: "ghp_x" }))).toBe("ghp_x");
  });
  it("null untuk status non-200, token kosong, atau transport yang melempar", async () => {
    expect(await hubGitToken(ok({ token: "ghp_x" }, 401))).toBeNull();
    expect(await hubGitToken(ok({ token: null }))).toBeNull();
    expect(await hubGitToken(async () => { throw new Error("hub offline"); })).toBeNull();
  });
});
