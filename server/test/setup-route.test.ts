import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { configEnvPath } from "@hanoman/runner";
import { requestConfigRestart } from "../src/services/restart";

// Efek "jalankan ulang diri sendiri" di-mock: tanpa ini setiap apply yang disupervisi menjadwalkan
// `process.exit(76)` di dalam worker vitest — terukur sebagai dua unhandled error pada run yang
// tetap terlihat hijau.
vi.mock("../src/services/restart", () => ({ requestConfigRestart: vi.fn() }));

// SPEC-884 · ADR-0139 · HANOMAN_HOME WAJIB menunjuk tmpdir di setiap test ini: `applySetup`
// menulis berkas nyata, dan tanpa itu ia mendarat di ~/.hanoman milik instance sungguhan
// (pelajaran SPEC-880).
const home = () => mkdtempSync(join(tmpdir(), "hanoman-setup-"));
const clean = async () => { await prisma.session.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(async () => { vi.clearAllMocks(); await clean(); });
afterEach(clean);

describe("route setup (SPEC-884)", () => {
  it("instalasi polos: perlu setup, lokal, hardening mati, tak terkunci", async () => {
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: home(), HANOMAN_SUPERVISOR: "1" } });
    const r = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      needed: true, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: true, setupTokenRequired: false,
    });
    expect(r.json().prerequisites).toHaveLength(7);
    await app.close();
  });

  it("menyimpan pilihan lokal ke config.env dan minta restart sendiri", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir, HANOMAN_SUPERVISOR: "1" } });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "local", hardening: false } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ restart: "self" });
    expect(readFileSync(configEnvPath(dir), "utf8")).toContain("HANOMAN_DEPLOYMENT=local");
    expect(requestConfigRestart).toHaveBeenCalled();
    await app.close();
  });

  it("menolak hardening saat prasyarat merah, dan tak menulis apa pun", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir, HANOMAN_SUPERVISOR: "1" } });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "public", hardening: true } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("prerequisites-missing");
    expect(r.json().missing.length).toBeGreaterThan(0);
    expect(() => readFileSync(configEnvPath(dir), "utf8")).toThrow();
    await app.close();
  });

  it("hardening yang dipasang lewat env tak bisa dimatikan dari dashboard", async () => {
    const dir = home();
    const app = buildApp({ env: {
      NODE_ENV: "production", HANOMAN_HOME: dir, HANOMAN_SUPERVISOR: "1",
      HANOMAN_SESSION_SANDBOX: "podman",
    } });
    expect((await app.inject({ method: "GET", url: "/api/setup/status" })).json())
      .toMatchObject({ hardening: true, hardeningLocked: true, deployment: "public" });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "local", hardening: false } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("hardening-locked");
    await app.close();
  });

  // Tanpa penanda durable, wizard MUNCUL LAGI sesudah restart: belum ada user, jadi `needed`
  // masih benar — dan operator terjebak lingkaran wizard → restart → wizard.
  it("sesudah apply, wizard tak diminta lagi walau belum ada user", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir } });
    await app.inject({ method: "POST", url: "/api/setup", payload: { deployment: "local", hardening: false } });
    expect((await app.inject({ method: "GET", url: "/api/setup/status" })).json())
      .toMatchObject({ needed: false });
    await app.close();
  });

  it("tanpa supervisor: menyimpan, tapi restart manual", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir } });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "local", hardening: false } });
    expect(r.json()).toMatchObject({ restart: "manual" });
    expect(readFileSync(configEnvPath(dir), "utf8")).toContain("HANOMAN_DEPLOYMENT=local");
    // Keluar tanpa supervisor = instance MATI karena menekan tombol setup.
    expect(requestConfigRestart).not.toHaveBeenCalled();
    await app.close();
  });

  it("sesudah ada user, /api/setup/status tergerbang cookie", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir } });
    await app.inject({ method: "POST", url: "/api/auth/setup",
      payload: { email: "a@b.co", password: "password1" } });
    expect((await app.inject({ method: "GET", url: "/api/setup/status" })).statusCode).toBe(401);
    await app.close();
  });
});
