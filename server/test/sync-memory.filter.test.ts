import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { bootstrapSnapshot, publishLocal, pull } from "../src/services/sync";
import { __resetSyncHub, attachSync, broadcastSyncLog } from "../src/services/sync-hub";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "sf-p" } });
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "sf-p", name: "p", desc: "", kind: "existing" } });
  await publishLocal("project", "sf-p");
  const m = await prisma.projectMemory.create({ data: { projectId: "sf-p", kind: "fact", content: "c", scopePaths: [],
    anchors: [], status: "active", sourceRuntime: "human" } });
  await publishLocal("projectMemory", m.id);
  await prisma.project.update({ where: { id: "sf-p" }, data: { desc: "d2" } });
  await publishLocal("project", "sf-p");
});
afterAll(clean);

describe("pull menyaring entitas opsional", () => {
  it("client lama (tanpa entities) tak melihat memori, dan kursornya MAJU sampai ujung", async () => {
    const r = await pull("0");
    expect(r.records.map((x) => x.entity)).toEqual(["project", "project"]);
    const tip = await prisma.syncLog.findFirst({ orderBy: { seq: "desc" } });
    expect(r.cursor).toBe(String(tip!.seq));
    expect(r.entities).toEqual(["projectMemory", "memoryEvent"]);   // iklan hub
  });
  it("client baru menerima memori", async () => {
    const r = await pull("0", 500, undefined, { accept: new Set(["projectMemory", "memoryEvent"]) });
    expect(r.records.map((x) => x.entity)).toEqual(["project", "projectMemory", "project"]);
  });
  it("feed yang isinya HANYA baris tersaring tetap memajukan kursor", async () => {
    const before = (await prisma.syncLog.findFirst({ orderBy: { seq: "desc" } }))!.seq;
    const m = await prisma.projectMemory.findFirst();
    await publishLocal("projectMemory", m!.id);
    const r = await pull(String(before));
    expect(r.records).toEqual([]);
    expect(Number(r.cursor)).toBeGreaterThan(before);
  });
});

describe("bootstrap menyaring + only", () => {
  it("tanpa accept → tanpa memori; only → hanya entitas yang diminta", async () => {
    expect((await bootstrapSnapshot(null)).records.map((r) => r.entity)).not.toContain("projectMemory");
    const only = await bootstrapSnapshot(null, undefined, { accept: new Set(["projectMemory"]), only: new Set(["projectMemory"]) });
    expect(only.records.map((r) => r.entity)).toEqual(["projectMemory"]);
  });
});

describe("WS menyaring per klien", () => {
  it("klien tanpa accept tak menerima frame memori", () => {
    __resetSyncHub();
    const oldC: string[] = []; const newC: string[] = [];
    attachSync({ send: (m) => oldC.push(m), close: () => {} });
    attachSync({ send: (m) => newC.push(m), close: () => {}, accept: new Set(["projectMemory"]) });
    broadcastSyncLog({ entity: "projectMemory", recordId: "x", version: 1, data: {}, seq: "9" });
    expect(oldC).toEqual([]);
    expect(newC.length).toBe(1);
    __resetSyncHub();
  });
});
