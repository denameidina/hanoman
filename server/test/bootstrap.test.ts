import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BootstrapError,
  consumeSetupToken,
  ensureSetupToken,
  verifySetupToken,
} from "../src/services/bootstrap";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";

// `resetDb()` sengaja TIDAK menyentuh User/Session (lihat test/factory.ts:149) — test yang
// bergantung pada "belum ada akun" wajib membersihkannya sendiri, seperti auth-routes.test.ts.
const clearUsers = async () => {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
};

const homes: string[] = [];
afterEach(() => { homes.length = 0; });

async function home(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "hanoman-bootstrap-"));
  homes.push(value);
  return value;
}

describe("one-time bootstrap token", () => {
  it("creates a private 15-minute proof and accepts it with constant-shape errors", async () => {
    const dir = await home();
    const created = await ensureSetupToken(dir, 1_000);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(created.path)).mode & 0o777).toBe(0o600);
    expect(created.expiresAt).toBe(1_000 + 15 * 60_000);
    const token = (await readFile(created.path, "utf8")).split("\n")[0]!;
    await expect(verifySetupToken(token, dir, 2_000)).resolves.toBeUndefined();
    await expect(verifySetupToken("wrong", dir, 2_000)).rejects.toBeInstanceOf(BootstrapError);
    await expect(verifySetupToken(token, dir, created.expiresAt + 1)).rejects.toBeInstanceOf(BootstrapError);
  });

  it("is idempotent until consumed and cannot be reused", async () => {
    const dir = await home();
    const first = await ensureSetupToken(dir, 1_000);
    const token = (await readFile(first.path, "utf8")).split("\n")[0]!;
    expect((await ensureSetupToken(dir, 2_000)).path).toBe(first.path);
    await consumeSetupToken(dir);
    await expect(verifySetupToken(token, dir, 2_001)).rejects.toBeInstanceOf(BootstrapError);
  });

  it("allows exactly one concurrent first-admin transaction and closes permanently", async () => {
    await resetDb();
    await clearUsers();
    const dir = await home();
    const proof = await ensureSetupToken(dir);
    const token = (await readFile(proof.path, "utf8")).split("\n")[0]!;
    // SPEC-884 · bukti setup token kini hidup di belakang hardening, bukan NODE_ENV — test ini
    // menguji mekanisme token-nya, jadi env-nya harus menyatakan hardening secara eksplisit.
    const app = buildApp({ requireAuth: false,
      env: { NODE_ENV: "production", HANOMAN_HARDENING: "1", HANOMAN_HOME: dir } });
    const setup = () => app.inject({
      method: "POST", url: "/api/auth/setup",
      payload: { email: "first@example.test", password: "password123", setupToken: token },
    });
    const responses = await Promise.all([setup(), setup()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    await expect(access(proof.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await setup()).statusCode).toBe(409);
    await app.close();
  });

  // SPEC-884 · ADR-0139 · di instalasi biasa, token justru menutup pintu terakhir: orang yang baru
  // `npm i -g hanoman` harus membaca berkas di HANOMAN_HOME lewat shell sebelum bisa memakai
  // dashboard-nya sendiri.
  it("tanpa hardening, akun pertama dibuat tanpa setup token (SPEC-884)", async () => {
    await resetDb();
    await clearUsers();
    const dir = await home();
    const app = buildApp({ requireAuth: false, env: { NODE_ENV: "production", HANOMAN_HOME: dir } });
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toMatchObject({ needsSetup: true, setupTokenRequired: false });
    expect(status.json().setupTokenPath).toBeUndefined();

    const r = await app.inject({ method: "POST", url: "/api/auth/setup",
      payload: { email: "a@b.co", password: "password1" } });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("hardening menyala tetap mewajibkan bukti setup token (SPEC-884)", async () => {
    await resetDb();
    await clearUsers();
    const dir = await home();
    const app = buildApp({ requireAuth: false,
      env: { NODE_ENV: "production", HANOMAN_HARDENING: "1", HANOMAN_HOME: dir } });
    expect((await app.inject({ method: "GET", url: "/api/auth/status" })).json())
      .toMatchObject({ setupTokenRequired: true });
    expect((await app.inject({ method: "POST", url: "/api/auth/setup",
      payload: { email: "a@b.co", password: "password1" } })).statusCode).toBe(400);
    await app.close();
  });
});
