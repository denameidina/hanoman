import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db";

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: "att-proj", name: "Att", desc: "", kind: "existing" } });
});
afterAll(clean);

describe("SPEC-843 · SpecAttachment", () => {
  it("cascade ikut terhapus saat Spec dihapus", async () => {
    await prisma.spec.create({ data: {
      id: "SPEC-9001", projectId: "att-proj", title: "T", source: "brief",
      stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
    } });
    await prisma.specAttachment.create({ data: {
      specId: "SPEC-9001", projectId: "att-proj", filename: "a.png",
      mimeType: "image/png", size: 3, storageKey: "k1.png",
    } });
    await prisma.spec.delete({ where: { id: "SPEC-9001" } });
    expect(await prisma.specAttachment.count({ where: { specId: "SPEC-9001" } })).toBe(0);
  });

  it("specId wajib FK — lampiran tanpa induk ditolak", async () => {
    const row = await prisma.specAttachment.create({ data: {
      specId: "SPEC-TAK-ADA", projectId: "att-proj", filename: "x",
      mimeType: "text/plain", size: 1, storageKey: "k",
    } }).catch(() => null);
    expect(row).toBeNull();
  });
});
