import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { deleteSynced } from "../src/services/sync-delete";
import { resetDb, makeProject } from "./factory";
import { prisma } from "../src/db";
import { setConfig, clearConfig } from "../src/config";

const app = buildApp({ requireAuth: false });
const guarded = buildApp();               // auth hidup — untuk membuktikan gerbangnya
const clean = async () => {
  await clearConfig("SYNC_SERVER_URL");
  await prisma.syncTombstone.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.syncLog.deleteMany();
  await resetDb();
};
beforeEach(clean); afterAll(clean);

describe("GET /api/sync/pending (SPEC-799 · ADR-0119)", () => {
  it("kosong saat tak ada apa pun tertunda", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sync/pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deletes: [], total: 0 });
  });

  it("melaporkan penghapusan yang menunggu push", async () => {
    await setConfig("SYNC_SERVER_URL", "http://hub.test");
    await makeProject({ id: "p1" });
    await deleteSynced("project", "p1");

    const res = await app.inject({ method: "GET", url: "/api/sync/pending" });
    expect(res.json().total).toBe(1);
    expect(res.json().deletes[0]).toMatchObject({ entity: "project", recordId: "p1" });
  });

  it("cookie-only: tanpa cookie ditolak, TIDAK jatuh ke bypass device-token /api/sync", async () => {
    expect((await guarded.inject({ method: "GET", url: "/api/sync/pending" })).statusCode).toBe(401);
  });
});
