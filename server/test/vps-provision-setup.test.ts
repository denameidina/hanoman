// SPEC-883 · serah-terima ke instance baru. Setup token transien: ia hanya lewat sekali di badan
// respons provision — tak pernah ke DB, tak pernah ke endpoint lain.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; process.env.FAKE_SSH_MODE = "hanoman-present"; });

const provisionBody = { items: ["node"], profile: "lab", confirm: true };

describe("SPEC-883 · serah-terima setup token", () => {
  it("hanoman ok + token hidup → tautan setup siap klik", async () => {
    const v = await makeVps({ name: "st1", host: "198.51.100.31" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { ...provisionBody, domain: "contoh.test" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().setup.url).toBe("https://contoh.test/setup?token=tok-baru");
    expect(Date.parse(res.json().setup.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("tanpa domain → tautan jatuh ke host:8787", async () => {
    const v = await makeVps({ name: "st2", host: "198.51.100.32" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    expect(res.json().setup.url).toBe("http://198.51.100.32:8787/setup?token=tok-baru");
  });

  it("token kedaluwarsa → setup null, bukan tautan mati", async () => {
    const v = await makeVps({ name: "st3", host: "198.51.100.33" });
    process.env.FAKE_SSH_MODE = "setup-expired";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    expect(res.json().setup).toBeNull();
  });

  it("token tak ada (admin sudah dibuat) → setup null", async () => {
    const v = await makeVps({ name: "st4", host: "198.51.100.34" });
    process.env.FAKE_SSH_MODE = "setup-absent";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    expect(res.json().setup).toBeNull();
  });

  it("token TIDAK PERNAH tersimpan ke DB", async () => {
    const v = await makeVps({ name: "st5", host: "198.51.100.35" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(JSON.stringify(row)).not.toContain("tok-baru");
  });
});
