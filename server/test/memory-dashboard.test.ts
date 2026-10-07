import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import type { MemoryScope } from "../src/services/memory/resolve";
import { invalidateMemory, memoryRevision, proposeMemory, searchMemories } from "../src/services/memory/store";
import { pendingCounts } from "../src/services/pending-counts";

const clean = async () => {
  await prisma.notification.deleteMany({ where: { type: "memory" } });
  await prisma.memoryLocalState.deleteMany(); await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: { in: ["md-a", "md-b"] } } });
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "md-a", name: "a", desc: "", kind: "existing" } });
  await prisma.project.create({ data: { id: "md-b", name: "b", desc: "", kind: "existing" } });
});
afterAll(clean);

const scope = (projectId: string): MemoryScope => ({ projectId, repoDir: null, head: null, headVerified: false });
const actor = { kind: "user" as const, id: "u1" };
const DAY = 86_400_000;
const row = (o: { status?: string; createdAt?: Date } = {}) => prisma.projectMemory.create({ data: {
  projectId: "md-a", kind: "fact", content: `c-${Math.random()}`, scopePaths: [], anchors: [],
  status: o.status ?? "active", sourceRuntime: "human", ...(o.createdAt ? { createdAt: o.createdAt } : {}) } });

describe("daftar membawa keadaan mesin ini", () => {
  it("tanpa MemoryLocalState → verdict null; dengan → verdict + waktu", async () => {
    const a = await row(); const b = await row();
    await prisma.memoryLocalState.create({ data: { memoryId: b.id, verdict: "stale", lastVerifiedAt: new Date(), lastUsedAt: new Date() } });
    const items = (await searchMemories("md-a", {})).items;
    expect(items.find((i) => i.id === a.id)?.local).toMatchObject({ verdict: null, lastUsedAt: null, needsConfirm: false });
    expect(items.find((i) => i.id === b.id)?.local).toMatchObject({ verdict: "stale", needsConfirm: false });
  });

  it("needsConfirm: aktif & tak dipakai ≥ 90 hari (atau tak pernah dipakai sejak dibuat ≥ 90 hari)", async () => {
    const old = await row({ createdAt: new Date(Date.now() - 91 * DAY) });
    const usedLongAgo = await row();
    await prisma.memoryLocalState.create({ data: { memoryId: usedLongAgo.id, verdict: "valid", lastUsedAt: new Date(Date.now() - 91 * DAY) } });
    const proposedOld = await row({ status: "proposed", createdAt: new Date(Date.now() - 91 * DAY) });
    const items = [...(await searchMemories("md-a", {})).items, ...(await searchMemories("md-a", { status: "proposed" })).items];
    expect(items.find((i) => i.id === old.id)?.local.needsConfirm).toBe(true);
    expect(items.find((i) => i.id === usedLongAgo.id)?.local.needsConfirm).toBe(true);
    expect(items.find((i) => i.id === proposedOld.id)?.local.needsConfirm).toBe(false);
  });
});

describe("revision untuk topik langganan", () => {
  it("berubah setelah propose dan invalidate; stabil tanpa perubahan", async () => {
    const r0 = await memoryRevision("md-a");
    expect(await memoryRevision("md-a")).toBe(r0);
    const p = await proposeMemory(scope("md-a"), actor, { kind: "fact", content: "fakta revisi", scopePaths: [], anchors: [] });
    if (!p.ok) throw new Error("setup");
    const r1 = await memoryRevision("md-a");
    expect(r1).not.toBe(r0);
    await new Promise((r) => setTimeout(r, 5));
    await prisma.projectMemory.update({ where: { id: p.memory.id }, data: { status: "active" } });
    await invalidateMemory(scope("md-a"), actor, p.memory.id, "uji");
    expect(await memoryRevision("md-a")).not.toBe(r1);
    expect(await memoryRevision("md-b")).toBe("0:");
  });
});

describe("pending & notifikasi review", () => {
  it("pendingCounts.memory = proposed lintas project", async () => {
    await row({ status: "proposed" }); await row({ status: "active" });
    await prisma.projectMemory.create({ data: { projectId: "md-b", kind: "fact", content: "x", scopePaths: [], anchors: [], status: "proposed", sourceRuntime: "human" } });
    expect((await pendingCounts()).memory).toBe(2);
  });

  it("usulan yang masuk review → satu notifikasi memory; auto-aktif → tidak", async () => {
    const p = await proposeMemory(scope("md-a"), actor, { kind: "decision", content: "pakai sqlite saja", scopePaths: [], anchors: [] });
    if (!p.ok) throw new Error("setup");
    const n = await prisma.notification.findMany({ where: { type: "memory" } });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ key: `memory:${p.memory.id}`, projectId: "md-a" });
    expect(n[0]!.title).toContain("pakai sqlite saja");
  });
});
