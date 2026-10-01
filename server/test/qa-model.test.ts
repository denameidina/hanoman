import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { makeProject, resetDb } from "./factory";

beforeEach(async () => { await resetDb(); await makeProject({ id: "p1" }); });

describe("model QA", () => {
  it("default kolom + cascade project → laporan → case/finding/lampiran", async () => {
    const r = await prisma.qaReport.create({ data: { projectId: "p1", title: "Smoke" } });
    expect(r).toMatchObject({ status: "draft", verdict: null, buildVersion: "", version: 0 });
    await prisma.qaCase.create({ data: { reportId: r.id, title: "Login" } });
    await prisma.qaFinding.create({ data: { reportId: r.id, title: "Bug", steps: ["a", "b"] } });
    await prisma.qaAttachment.create({ data: {
      reportId: r.id, projectId: "p1", ownerType: "report", ownerId: r.id,
      filename: "a.png", mimeType: "image/png", size: 1, sha256: "x", storageKey: "k",
    } });
    expect((await prisma.qaFinding.findFirstOrThrow()).steps).toEqual(["a", "b"]);
    const att = await prisma.qaAttachment.findFirstOrThrow();
    expect(att.syncState).toBe("local-only");
    expect(att).toMatchObject({ version: 0 });        // bagian 3: ikut changefeed seperti anak QA lain
    expect(att.updatedAt).toBeInstanceOf(Date);

    await prisma.project.delete({ where: { id: "p1" } });
    expect(await prisma.qaReport.count()).toBe(0);
    expect(await prisma.qaCase.count()).toBe(0);
    expect(await prisma.qaFinding.count()).toBe(0);
    expect(await prisma.qaAttachment.count()).toBe(0);
  });

  it("QaFinding.caseId bukan FK: boleh menunjuk case yang tak ada tanpa error", async () => {
    const r = await prisma.qaReport.create({ data: { projectId: "p1", title: "x" } });
    await expect(prisma.qaFinding.create({ data: { reportId: r.id, title: "y", caseId: "hantu" } })).resolves.toBeTruthy();
  });
});
