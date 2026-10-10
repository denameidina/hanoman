import { afterAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const app = buildApp({ requireAuth: false });
afterAll(() => app.close());

describe("penghapusan memori project dan changelog", () => {
  it("model terhapus dari Prisma dan urutan migrasi Postgres", () => {
    const models = Prisma.dmmf.datamodel.models;
    for (const name of ["ProjectMemory", "MemoryEvent", "MemoryLocalState", "Changelog"]) {
      expect(models.some((m) => m.name === name)).toBe(false);
      expect(PG_ORDER as readonly string[]).not.toContain(name);
    }
    expect(models.find((m) => m.name === "AgentToken")!.fields.map((f) => f.name))
      .not.toContain("projectIds");
    expect(models.some((m) => m.name === "TelegramMemory")).toBe(true);
  });

  it.each([
    ["GET", "/api/memories"], ["POST", "/api/memories"],
    ["GET", "/api/memories/m1"], ["DELETE", "/api/memories/m1"],
    ["POST", "/api/memories/m1/activate"],
    ["GET", "/api/projects/p1/changelog"], ["POST", "/api/projects/p1/changelog"],
    ["GET", "/api/projects/p1/changelog/sources"], ["DELETE", "/api/projects/p1/changelog/c1"],
  ] as const)("%s %s tidak lagi terdaftar", async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(404);
  });

  it("migration menghapus data fitur dan mempertahankan token/project/data sync lain", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hn-retire-features-"));
    const db = new PrismaClient({ datasources: { db: { url: `file:${join(dir, "old.db")}` } } });
    const sql = readFileSync(new URL("../prisma/migrations/20261010070000_remove_memory_changelog/migration.sql", import.meta.url), "utf8");
    const run = async (script: string) => {
      for (const statement of script.split(";").map((x) => x.trim()).filter(Boolean))
        await db.$executeRawUnsafe(statement);
    };
    try {
      await run(`
        CREATE TABLE Project (id TEXT PRIMARY KEY);
        INSERT INTO Project VALUES ('keep-project');
        CREATE TABLE ProjectMemory (id TEXT PRIMARY KEY, projectId TEXT REFERENCES Project(id));
        INSERT INTO ProjectMemory VALUES ('m1', 'keep-project');
        CREATE TABLE MemoryEvent (id TEXT PRIMARY KEY, memoryId TEXT REFERENCES ProjectMemory(id));
        INSERT INTO MemoryEvent VALUES ('e1', 'm1');
        CREATE TABLE MemoryLocalState (memoryId TEXT PRIMARY KEY);
        INSERT INTO MemoryLocalState VALUES ('m1');
        CREATE TABLE Changelog (id TEXT PRIMARY KEY, projectId TEXT REFERENCES Project(id));
        INSERT INTO Changelog VALUES ('c1', 'keep-project');
        CREATE TABLE AgentToken (id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
          tokenPrefix TEXT NOT NULL, capabilities JSONB NOT NULL, projectIds JSONB,
          enabled BOOLEAN NOT NULL DEFAULT true, createdBy TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          lastUsedAt DATETIME, revokedAt DATETIME);
        INSERT INTO AgentToken (id,name,tokenHash,tokenPrefix,capabilities,projectIds)
          VALUES ('t1','keep-token','hash','prefix','["docs:read","memory:read","memory:write"]','["keep-project"]');
        CREATE TABLE Setting (id INTEGER PRIMARY KEY, data JSONB NOT NULL);
        INSERT INTO Setting VALUES (1, '{"model":"opus","changelog":{"enabled":true}}');
        CREATE TABLE Notification (id TEXT PRIMARY KEY, type TEXT);
        INSERT INTO Notification VALUES ('n1','memory'), ('n2','done');
        CREATE TABLE SyncState (id INTEGER PRIMARY KEY, entities TEXT);
        INSERT INTO SyncState VALUES (1, 'projectMemory,memoryEvent,futureEntity');
      `);
      for (const name of ["SyncLog", "SyncOutbox", "SyncConflict", "SyncTombstone"]) {
        await run(`CREATE TABLE "${name}" (entity TEXT, recordId TEXT);
          INSERT INTO "${name}" VALUES ('projectMemory','m1'), ('memoryEvent','e1'), ('spec','s1');`);
      }
      await run(sql);
      const tables = await db.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table'");
      expect(tables.map((t) => t.name)).not.toEqual(expect.arrayContaining(["ProjectMemory", "Changelog"]));
      for (const name of ["ProjectMemory", "MemoryEvent", "MemoryLocalState", "Changelog"])
        expect(tables.map((t) => t.name)).not.toContain(name);
      expect(await db.$queryRawUnsafe("SELECT * FROM Project")).toEqual([{ id: "keep-project" }]);
      const token = await db.agentToken.findUniqueOrThrow({ where: { id: "t1" } });
      expect(token).toMatchObject({ name: "keep-token", tokenHash: "hash", capabilities: ["docs:read"], enabled: true });
      expect(await db.$queryRawUnsafe("SELECT data FROM Setting")).toEqual([{ data: { model: "opus" } }]);
      expect(await db.$queryRawUnsafe("SELECT * FROM Notification")).toEqual([{ id: "n2", type: "done" }]);
      expect(await db.$queryRawUnsafe("SELECT entities FROM SyncState")).toEqual([{ entities: "futureEntity" }]);
      for (const name of ["SyncLog", "SyncOutbox", "SyncConflict", "SyncTombstone"])
        expect(await db.$queryRawUnsafe(`SELECT * FROM "${name}"`)).toEqual([{ entity: "spec", recordId: "s1" }]);
    } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
  });
});
