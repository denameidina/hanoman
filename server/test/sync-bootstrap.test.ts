import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { bootstrapSnapshot } from "../src/services/sync";

const app = buildApp();
const clean = async () => {
  await prisma.syncLog.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function seed() {
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: "/lokal" } });
  await prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "planned",
    priority: "sedang", author: "a@b.co", objective: "o" } });
}

describe("SPEC-885 · bootstrapSnapshot (hub)", () => {
  it("mengirim keadaan TABEL dalam urutan dependensi: induk selalu mendahului anaknya", async () => {
    await seed();
    const page = await bootstrapSnapshot(null);
    const urutan = page.records.map((r) => `${r.entity}:${r.recordId}`);
    expect(urutan.indexOf("project:p1")).toBeLessThan(urutan.indexOf("spec:SPEC-1"));
    expect(page.hasMore).toBe(false);
    expect(page.next).toBeNull();
  });

  it("kursor = puncak feed, diambil SEBELUM tabel dibaca", async () => {
    await seed();
    await prisma.syncLog.create({ data: { entity: "project", recordId: "p1", version: 1, op: "upsert", data: {} } });
    const tip = await prisma.syncLog.findFirst({ orderBy: { seq: "desc" } });
    const page = await bootstrapSnapshot(null);
    expect(page.cursor).toBe(String(tip!.seq));
  });

  it("feed kosong → kursor 0 (client menarik seluruh feed sesudahnya, tetap konvergen)", async () => {
    await seed();
    const page = await bootstrapSnapshot(null);
    expect(page.cursor).toBe("0");
  });

  it("berhalaman per anggaran byte; `next` melanjutkan tepat sesudah record terakhir yang dikirim", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing" } });
    for (const id of ["SPEC-1", "SPEC-2", "SPEC-3"]) {
      await prisma.spec.create({ data: {
        id, projectId: "p1", title: "x".repeat(40_000), source: "brief", stage: "planned",
        priority: "sedang", author: "a@b.co", objective: "o" } });
    }
    const page1 = await bootstrapSnapshot(null, 90_000);
    expect(page1.hasMore).toBe(true);
    expect(page1.next).not.toBeNull();

    const page2 = await bootstrapSnapshot(page1.next, 90_000);
    const semua = [...page1.records, ...page2.records].map((r) => `${r.entity}:${r.recordId}`);
    expect(new Set(semua).size).toBe(semua.length);          // tak ada duplikat
    expect(semua).toContain("spec:SPEC-3");                   // tak ada yang terlompati
  });
});

describe("SPEC-885 · GET /api/sync/bootstrap", () => {
  it("butuh device token; menjawab bentuk yang sama dengan service", async () => {
    await seed();
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");

    const tanpa = await app.inject({ method: "GET", url: "/api/sync/bootstrap" });
    expect(tanpa.statusCode).toBe(401);

    const res = await app.inject({
      method: "GET", url: "/api/sync/bootstrap",
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("cursor");
    expect(body).toHaveProperty("hasMore");
    expect(body.records.map((r: { recordId: string }) => r.recordId)).toContain("p1");
  });
});
