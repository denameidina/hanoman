import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";

const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.memoryLocalState.deleteMany();
  await prisma.project.deleteMany({ where: { id: "mem-schema" } });
};
beforeEach(clean);
afterAll(clean);

describe("skema memori (ADR-0178)", () => {
  it("memori + event tersimpan, dan ikut terhapus cascade bersama project", async () => {
    await prisma.project.create({ data: { id: "mem-schema", name: "m", desc: "", kind: "app" } });
    const m = await prisma.projectMemory.create({
      data: {
        projectId: "mem-schema", kind: "fact", content: "x", scopePaths: [], anchors: [],
        status: "proposed", sourceRuntime: "human",
        events: { create: { op: "propose", actorKind: "user", actorId: "u1" } },
      },
    });
    expect(await prisma.memoryEvent.count({ where: { memoryId: m.id } })).toBe(1);
    await prisma.project.delete({ where: { id: "mem-schema" } });
    expect(await prisma.projectMemory.count({ where: { id: m.id } })).toBe(0);
    expect(await prisma.memoryEvent.count({ where: { memoryId: m.id } })).toBe(0);
  });

  it("AgentToken.projectIds opsional (null default)", async () => {
    const t = await prisma.agentToken.create({
      data: { name: "t", tokenHash: "h-mem-schema", tokenPrefix: "p", capabilities: [] },
    });
    expect(t.projectIds).toBeNull();
    await prisma.agentToken.delete({ where: { id: t.id } });
  });
});
