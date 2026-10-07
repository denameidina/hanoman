import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TOPICS, TOPIC_NAMES, isTopic, parseParams } from "../src/services/events-topics";
import { prisma } from "../src/db";

const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: "mt-p" } });
};
beforeEach(async () => { await clean(); await prisma.project.create({ data: { id: "mt-p", name: "p", desc: "", kind: "existing" } }); });
afterAll(clean);

describe("ADR-0181 · topik `memory`", () => {
  it("terdaftar, projectId wajib, parameter asing ditolak", () => {
    expect(TOPIC_NAMES).toContain("memory");
    expect(isTopic("memory")).toBe(true);
    expect(parseParams("memory", { projectId: "mt-p" })).toEqual({ projectId: "mt-p" });
    expect(parseParams("memory", {})).toBeUndefined();
    expect(parseParams("memory", { projectId: "mt-p", aneh: 1 })).toBeUndefined();
  });

  it("frame membawa revision yang berubah saat memori berubah", async () => {
    const a = await TOPICS.memory.build({ projectId: "mt-p" });
    expect(a).toEqual({ revision: "0:" });
    await prisma.projectMemory.create({ data: { projectId: "mt-p", kind: "fact", content: "c", scopePaths: [], anchors: [], status: "active", sourceRuntime: "human" } });
    expect((await TOPICS.memory.build({ projectId: "mt-p" })).revision).not.toBe(a.revision);
  });
});
