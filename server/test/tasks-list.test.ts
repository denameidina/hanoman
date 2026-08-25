import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { buildTasksPage } from "../src/services/tasks-list";
import { resetDb, makeProject, makeSpec } from "./factory";

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "executing", priority: "tinggi" });
  await prisma.member.create({ data: { id: "a@x.id", name: "A", email: "a@x.id" } });
  await prisma.task.create({ data: { id: "t1", projectId: "p1", title: "Desain", status: "backlog", order: 2 } });
  await prisma.task.create({ data: { id: "t2", projectId: "p1", title: "Deploy", status: "doing", order: 1, memberId: "a@x.id", specId: "SPEC-1" } });
  await prisma.task.create({ data: { id: "t3", title: "Rapat", status: "backlog", order: 0 } });
});

describe("buildTasksPage", () => {
  it("mengurutkan menaik menurut `order`, seri dipecah id", async () => {
    const p = await buildTasksPage({});
    expect(p.items.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
    expect(p.total).toBe(3);
  });

  it("filter projectId; tugas tanpa project tidak ikut", async () => {
    const p = await buildTasksPage({ projectId: "p1" });
    expect(p.items.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("filter status & memberId", async () => {
    expect((await buildTasksPage({ status: "doing" })).items.map((t) => t.id)).toEqual(["t2"]);
    expect((await buildTasksPage({ memberId: "a@x.id" })).items.map((t) => t.id)).toEqual(["t2"]);
  });

  // Cermin backlog dihitung saat baca — tak ada kolom `stage` di Task (ADR-0090).
  it("menyertakan cermin spec hasil join specId", async () => {
    const t2 = (await buildTasksPage({ status: "doing" })).items[0]!;
    expect(t2.specId).toBe("SPEC-1");
    expect(t2.spec).toEqual({ id: "SPEC-1", stage: "executing", priority: "tinggi" });
  });

  it("task tanpa specId punya spec null", async () => {
    const t1 = (await buildTasksPage({ status: "backlog", projectId: "p1" })).items[0]!;
    expect(t1.specId).toBeNull();
    expect(t1.spec).toBeNull();
  });

  // Tautan putus: specId TETAP terisi, spec null. Bedanya itulah yang membuat UI bisa merender
  // "tautan putus" alih-alih diam.
  it("specId yang menunjuk Spec terhapus → spec null, specId tetap terisi", async () => {
    await prisma.spec.delete({ where: { id: "SPEC-1" } });
    const t2 = (await buildTasksPage({ status: "doing" })).items[0]!;
    expect(t2.specId).toBe("SPEC-1");
    expect(t2.spec).toBeNull();
  });

  it("paginasi ADR-0107: tanpa limit → seluruh item satu halaman", async () => {
    const all = await buildTasksPage({});
    expect(all).toMatchObject({ page: 1, pageSize: 3, total: 3 });
    const p2 = await buildTasksPage({ page: 2, limit: 2 });
    expect(p2.items.map((t) => t.id)).toEqual(["t1"]);
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: 3 });
  });

  it("tanggal disajikan ISO string, bukan Date", async () => {
    await prisma.task.update({ where: { id: "t1" }, data: { dueDate: new Date("2026-09-01T00:00:00.000Z") } });
    const t1 = (await buildTasksPage({ projectId: "p1", status: "backlog" })).items[0]!;
    expect(t1.dueDate).toBe("2026-09-01T00:00:00.000Z");
    expect(t1.startDate).toBeNull();
  });
});
