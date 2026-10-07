import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { applyPush, publishLocal, snapshot } from "../src/services/sync";
import { mergeMemoryRecord } from "../src/services/memory/sync-merge";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "mm-p" } });
};
let id = "";
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "mm-p", name: "p", desc: "", kind: "existing" } });
  const m = await prisma.projectMemory.create({ data: { projectId: "mm-p", kind: "fact", content: "c", scopePaths: [],
    anchors: [], status: "proposed", sourceRuntime: "human" } });
  id = m.id;
  await publishLocal("projectMemory", id);            // hub v1
  await prisma.projectMemory.update({ where: { id }, data: { status: "active" } });
  await publishLocal("projectMemory", id);            // hub v2 (diaktifkan di hub)
});
afterAll(clean);

describe("mergeMemoryRecord (murni)", () => {
  const base = { content: "c", kind: "fact", status: "active" };
  it("immutable sama → status lattice", () => {
    expect(mergeMemoryRecord({ ...base, status: "active" }, { ...base, status: "invalidated" }))
      .toEqual({ kind: "merged", data: { ...base, status: "invalidated" } });
    expect(mergeMemoryRecord({ ...base, status: "invalidated" }, { ...base, status: "active" })).toEqual({ kind: "same" });
  });
  it("immutable beda → conflict", () => {
    expect(mergeMemoryRecord(base, { ...base, content: "lain" })).toEqual({ kind: "conflict" });
  });
});

describe("applyPush projectMemory", () => {
  it("client basi (base v1) meng-invalidate → hub menggabung, bukan konflik", async () => {
    const snap = (await snapshot("projectMemory", id))!;
    const r = await applyPush("projectMemory", id, 1, { ...snap.data, status: "invalidated" });
    expect(r).toMatchObject({ ok: true, version: 3 });
    expect((await prisma.projectMemory.findUnique({ where: { id } }))?.status).toBe("invalidated");
  });
  it("client basi dengan status lebih rendah → ok tanpa menulis (hub sudah lebih maju)", async () => {
    const snap = (await snapshot("projectMemory", id))!;
    const r = await applyPush("projectMemory", id, 1, { ...snap.data, status: "proposed" });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await prisma.projectMemory.findUnique({ where: { id } }))?.status).toBe("active");
  });
  it("isi immutable beda → konflik biasa", async () => {
    const snap = (await snapshot("projectMemory", id))!;
    const r = await applyPush("projectMemory", id, 1, { ...snap.data, content: "diubah" });
    expect(r).toMatchObject({ ok: false, conflict: true });
  });
});

describe("applyPush memoryEvent idempoten", () => {
  it("event yang sudah ada dengan base basi → ok versi sekarang", async () => {
    const e = await prisma.memoryEvent.create({ data: { memoryId: id, op: "propose", actorKind: "user" } });
    await publishLocal("memoryEvent", e.id);
    const snap = (await snapshot("memoryEvent", e.id))!;
    expect(await applyPush("memoryEvent", e.id, 0, snap.data)).toMatchObject({ ok: true, version: snap.version });
  });
});
