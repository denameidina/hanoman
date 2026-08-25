import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";
import { resetDb, makeProject } from "./factory";
import { SYNCED, PARENTS, BOOTSTRAP_ORDER, __FIELDS, __DATE_FIELDS } from "../src/services/sync";

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

// Kolom bermakna — `id` (PK, di where) & `version` (stempel mekanisme sync) dikecualikan.
// Dibandingkan dengan `toEqual` atas himpunan DMMF, bukan `toContain` per kolom: yang terakhir
// lolos untuk kolom yang belum pernah terpikirkan, dan kolom yang terlewat di FIELDS mendarat
// sebagai null palsu di tiap client TANPA satu pun error (kelas ADR-0090/0093/0105).
const meaningful = (model: string): string[] =>
  [...colsOf(model)].filter((c) => c !== "id" && c !== "version").sort();

describe("SPEC-945 · member & task ikut record-sync", () => {
  it("keduanya terdaftar di SYNCED", () => {
    expect(SYNCED as readonly string[]).toContain("member");
    expect(SYNCED as readonly string[]).toContain("task");
  });

  it("FIELDS.member = SETIAP kolom bermakna Member, tak lebih tak kurang", () => {
    expect([...__FIELDS.member].sort()).toEqual(meaningful("Member"));
  });

  it("FIELDS.task = SETIAP kolom bermakna Task, tak lebih tak kurang", () => {
    expect([...__FIELDS.task].sort()).toEqual(meaningful("Task"));
  });

  it("DATE_FIELDS memuat setiap kolom DateTime kedua model", () => {
    expect([...__DATE_FIELDS.member].sort()).toEqual(["createdAt", "updatedAt"]);
    expect([...__DATE_FIELDS.task].sort()).toEqual(["createdAt", "dueDate", "startDate", "updatedAt"]);
  });

  // `onDelete` bukan hiasan: `cascade` MEMBUANG record anak yang datang untuk induk bertombstone,
  // `setNull` justru menerapkannya dengan kolom itu dikosongkan. Menyalinnya salah membuat kartu
  // yang assignee-nya pernah dihapus lenyap senyap di mesin lain.
  it("PARENTS.task memuat KEDUA induknya, berikut perilaku hapusnya", () => {
    expect(PARENTS.task).toEqual(expect.arrayContaining([
      { field: "projectId", entity: "project", onDelete: "cascade" },
      { field: "memberId", entity: "member", onDelete: "setNull" },
    ]));
  });

  // Ditulis lewat `Object.keys`, bukan `PARENTS.member === undefined`: yang terakhir juga lulus di
  // pohon tempat `member` belum terdaftar sama sekali, jadi ia tak membuktikan apa pun. Menuntut
  // `task` HADIR di keping yang sama mengikat assertion ini pada perubahan yang benar.
  it("task punya induk, member tidak — direktori orang global tanpa satu pun FK keluar", () => {
    expect(Object.keys(PARENTS)).toContain("task");
    expect(Object.keys(PARENTS)).not.toContain("member");
  });

  // Kelas SPEC-885 "lupa vps": urutan yang salah bootstrap SUKSES tanpa error, tapi assignee kosong.
  it("BOOTSTRAP_ORDER menaruh member SEBELUM task", () => {
    expect(BOOTSTRAP_ORDER.indexOf("member")).toBeGreaterThanOrEqual(0);
    expect(BOOTSTRAP_ORDER.indexOf("member")).toBeLessThan(BOOTSTRAP_ORDER.indexOf("task"));
  });
});
