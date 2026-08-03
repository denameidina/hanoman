import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";
import { resetDb, makeProject } from "./factory";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

describe("model Changelog (SPEC-516 · ADR-0105)", () => {
  it("TAK punya kolom `version` — LOCAL-only, tak pernah masuk changefeed sync", () => {
    const cols = models.get("Changelog")!.fields.map((f) => f.name);
    expect(cols).not.toContain("version");
  });

  it("PG_ORDER memuat Changelog sesudah Project (FK projectId)", () => {
    expect(PG_ORDER).toContain("Changelog");
    expect(PG_ORDER.indexOf("Changelog")).toBeGreaterThan(PG_ORDER.indexOf("Project"));
  });

  it("baris ikut terhapus saat project-nya dihapus (cascade)", async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await prisma.changelog.create({ data: {
      projectId: "p1", mode: "backlog", title: "Juli", params: {} as Prisma.InputJsonValue,
      body: "# Juli", generator: "fallback", itemCount: 1 } });
    await prisma.project.delete({ where: { id: "p1" } });
    expect(await prisma.changelog.count()).toBe(0);
  });
});
