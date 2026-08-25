import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";
import { resetDb, makeProject } from "./factory";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const colsOf = (n: string) =>
  new Set(models.get(n)!.fields.filter((f) => f.kind !== "object").map((f) => f.name));

describe("SPEC-945 · ADR-0150 · model Member & Task", () => {
  it("Member punya kolom yang dijanjikan spec, termasuk `version` (ikut sync)", () => {
    expect(colsOf("Member")).toEqual(
      new Set(["id", "name", "email", "role", "active", "version", "createdAt", "updatedAt"]));
  });

  it("Task punya kolom yang dijanjikan spec, termasuk `version` (ikut sync)", () => {
    expect(colsOf("Task")).toEqual(new Set([
      "id", "projectId", "title", "detail", "status", "priority", "memberId",
      "startDate", "dueDate", "order", "specId", "version", "createdAt", "updatedAt"]));
  });

  // ADR-0090 · stage backlog TIDAK disimpan di Task — ia dihitung saat baca lewat join specId.
  // Kolom kedua hanya menciptakan dua kebenaran yang bisa drift.
  it("Task TIDAK punya kolom stage maupun doneAt", () => {
    const c = colsOf("Task");
    expect(c.has("stage")).toBe(false);
    expect(c.has("doneAt")).toBe(false);
  });

  // Cermin Ticket.specId (ADR-0062): changefeed bisa memancarkan Task sebelum Spec-nya mendarat
  // (kelas SPEC-382) dan FK akan menolaknya.
  it("Task.specId TANPA relasi FK", () => {
    const rel = models.get("Task")!.fields.filter((f) => f.kind === "object");
    const fks = rel.flatMap((f) => f.relationFromFields ?? []);
    expect(fks).toEqual(expect.arrayContaining(["projectId", "memberId"]));
    expect(fks).not.toContain("specId");
  });

  it("PG_ORDER memuat Member sebelum Task, keduanya sesudah Project", () => {
    expect(PG_ORDER).toContain("Member");
    expect(PG_ORDER).toContain("Task");
    expect(PG_ORDER.indexOf("Member")).toBeLessThan(PG_ORDER.indexOf("Task"));
    expect(PG_ORDER.indexOf("Task")).toBeGreaterThan(PG_ORDER.indexOf("Project"));
  });

  it("task ikut terhapus saat project-nya dihapus (cascade)", async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await prisma.task.create({ data: { id: "t1", projectId: "p1", title: "Desain", status: "backlog" } });
    await prisma.project.delete({ where: { id: "p1" } });
    expect(await prisma.task.count()).toBe(0);
  });

  // onDelete: SetNull — menghapus anggota TIDAK ikut menghapus pekerjaannya.
  it("task jadi belum-ditugaskan saat anggotanya dihapus (SetNull)", async () => {
    await resetDb();
    await prisma.member.create({ data: { id: "a@x.id", name: "A", email: "a@x.id" } });
    await prisma.task.create({ data: { id: "t1", title: "Nego", status: "doing", memberId: "a@x.id" } });
    await prisma.member.delete({ where: { id: "a@x.id" } });
    const t = await prisma.task.findUnique({ where: { id: "t1" } });
    expect(t).not.toBeNull();
    expect(t!.memberId).toBeNull();
  });

  // projectId nullable = tugas internal tim, tanpa project.
  it("task boleh tanpa project", async () => {
    await resetDb();
    const t = await prisma.task.create({ data: { id: "t9", title: "Rapat internal", status: "backlog" } });
    expect(t.projectId).toBeNull();
    expect(t.priority).toBe("sedang");
    expect(t.order).toBe(0);
  });
});
