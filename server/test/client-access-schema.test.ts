import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.user.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("skema portal klien (SPEC-617)", () => {
  // Default 'admin' adalah yang membuat migrasi aman untuk hub produksi: setiap baris User yang
  // sudah ada otomatis admin, nol akses terputus, nol backfill manual.
  it("User.role default 'admin' dan User.disabled default false", () => {
    const cols = new Map(models.get("User")!.fields.map((f) => [f.name, f]));
    expect(cols.get("role")!.default).toBe("admin");
    expect(cols.get("disabled")!.default).toBe(false);
  });

  it("baris User tanpa menyebut role lahir sebagai admin yang aktif", async () => {
    const u = await prisma.user.create({ data: { email: "a@b.co", passwordHash: "x:y" } });
    expect(u.role).toBe("admin");
    expect(u.disabled).toBe(false);
  });

  it("ClientProjectAccess unik per (userId, projectId)", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    const u = await prisma.user.create({ data: { email: "c@b.co", passwordHash: "x:y", role: "client" } });
    await prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p1" } });
    await expect(prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p1" } }))
      .rejects.toThrow();
  });

  it("akses ikut terhapus saat user maupun project dihapus (cascade)", async () => {
    await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
    const u = await prisma.user.create({ data: { email: "d@b.co", passwordHash: "x:y", role: "client" } });
    await prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p2" } });
    await prisma.project.delete({ where: { id: "p2" } });
    expect(await prisma.clientProjectAccess.count()).toBe(0);
  });

  // Model baru yang lupa masuk PG_ORDER = migrasi dari Postgres diam-diam melewatkan tabelnya.
  it("ClientProjectAccess ada di PG_ORDER sesudah User dan Project", () => {
    expect(PG_ORDER).toContain("ClientProjectAccess");
    expect(PG_ORDER.indexOf("ClientProjectAccess")).toBeGreaterThan(PG_ORDER.indexOf("User"));
    expect(PG_ORDER.indexOf("ClientProjectAccess")).toBeGreaterThan(PG_ORDER.indexOf("Project"));
  });
});
