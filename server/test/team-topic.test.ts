import { describe, it, expect } from "vitest";
import { TOPICS, TOPIC_NAMES, isTopic, parseParams } from "../src/services/events-topics";
import { prisma } from "../src/db";
import { resetDb, makeProject } from "./factory";

describe("SPEC-945 · ADR-0150 · topik `tasks`", () => {
  it("terdaftar di TOPICS", () => {
    expect(TOPIC_NAMES).toContain("tasks");
    expect(isTopic("tasks")).toBe(true);
  });

  // Papan tim sedikit penonton & banyak parameter, jadi ia topik BERPARAMETER — bukan grup global
  // ke-11 di `GROUPS`, yang di-recompute untuk SETIAP klien yang terhubung tiap N detik.
  it("everyTicks 3 — kadens yang sama dengan tickets", () => {
    expect(TOPICS.tasks.everyTicks).toBe(3);
  });

  it("parameter dijepit plafon ADR-0107", () => {
    expect(parseParams("tasks", { page: 1, limit: 50 })).toEqual({ page: 1, limit: 50 });
    expect(parseParams("tasks", { page: 1, limit: 500 })).toBeUndefined();
    expect(parseParams("tasks", { page: 0, limit: 10 })).toBeUndefined();
    // `.strict()` — parameter asing menolak entri ITU, bukan seluruh frame.
    expect(parseParams("tasks", { page: 1, limit: 10, aneh: 1 })).toBeUndefined();
  });

  it("menerima filter opsional projectId/status/memberId", () => {
    expect(parseParams("tasks", { projectId: "p1", status: "doing", memberId: "a@x.id", page: 1, limit: 20 }))
      .toEqual({ projectId: "p1", status: "doing", memberId: "a@x.id", page: 1, limit: 20 });
  });

  it("build mengembalikan BADAN frame tanpa t/key", async () => {
    await resetDb();
    await makeProject({ id: "p1" });
    await prisma.task.create({ data: { id: "t1", projectId: "p1", title: "Desain", status: "backlog" } });
    const body = await TOPICS.tasks.build({ projectId: "p1", page: 1, limit: 10 });
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body.data.items.map((t) => t.id)).toEqual(["t1"]);
  });
});
