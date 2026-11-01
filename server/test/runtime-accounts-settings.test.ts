import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// ADR-0234 · `Setting.accounts` hanya ditulis PUT /runtime-accounts/default. Simpan form Settings
// (PUT /settings membawa blok utuh) tak boleh menimpa pilihan akun — pola remoteControl.
describe("Setting.accounts", () => {
  const app = buildApp({ requireAuth: false });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await prisma.setting.deleteMany(); });

  it("default {} saat belum pernah diset", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual({});
  });

  it("PUT /settings mempertahankan nilai tersimpan", async () => {
    const base = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    await prisma.setting.upsert({ where: { id: 1 }, update: { data: { ...base, accounts: { claude: "a1b2c3d4" } } },
      create: { id: 1, data: { ...base, accounts: { claude: "a1b2c3d4" } } } });
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { ...base, accounts: { claude: "ffffffff" } } });
    expect(put.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(after.accounts).toEqual({ claude: "a1b2c3d4" });
  });
});
