import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { invalidateMemory, proposeMemory } from "../src/services/memory/store";
import { deleteSynced } from "../src/services/sync-delete";

let dir = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncTombstone.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "sw-p" } });
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-sw-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "a.ts"), "1\n"); g("add", "."); g("commit", "-qm", "1"); head = g("rev-parse", "HEAD");
});
beforeEach(async () => { await clean(); await prisma.project.create({ data: { id: "sw-p", name: "p", desc: "", kind: "existing", repoDir: dir } }); });
afterAll(clean);
const scope = () => ({ projectId: "sw-p", repoDir: dir, head, headVerified: true });
const actor = { kind: "user" as const, id: "u1" };

describe("store memori → feed sync (peran hub)", () => {
  it("propose aktif: memori + kedua event masuk SyncLog; versi dinaikkan HANYA oleh publishLocal", async () => {
    const r = await proposeMemory(scope(), actor, { kind: "fact", content: "a.ts ada", scopePaths: [], anchors: [{ path: "a.ts" }] });
    if (!r.ok) throw new Error("setup");
    const logs = await prisma.syncLog.findMany({ orderBy: { seq: "asc" } });
    expect(logs.map((l) => l.entity)).toEqual(["projectMemory", "memoryEvent", "memoryEvent"]);
    expect((await prisma.projectMemory.findUnique({ where: { id: r.memory.id } }))?.version).toBe(1);
    expect(r.memory.source.deviceId).toBe("local");
  });
  it("invalidate: status baru ikut feed, versi naik 1", async () => {
    const r = await proposeMemory(scope(), actor, { kind: "fact", content: "a.ts ada", scopePaths: [], anchors: [{ path: "a.ts" }] });
    if (!r.ok) throw new Error("setup");
    await invalidateMemory(scope(), actor, r.memory.id, "salah");
    expect((await prisma.projectMemory.findUnique({ where: { id: r.memory.id } }))?.version).toBe(2);
  });
  it("hapus permanen: tombstone, event ikut cascade", async () => {
    const r = await proposeMemory(scope(), actor, { kind: "fact", content: "a.ts ada", scopePaths: [], anchors: [{ path: "a.ts" }] });
    if (!r.ok) throw new Error("setup");
    await deleteSynced("projectMemory", r.memory.id);
    expect(await prisma.memoryEvent.count({ where: { memoryId: r.memory.id } })).toBe(0);
    expect(await prisma.syncTombstone.count({ where: { entity: "projectMemory", recordId: r.memory.id } })).toBe(1);
  });
});
