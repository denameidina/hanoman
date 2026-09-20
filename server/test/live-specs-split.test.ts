import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import { liveOverlayTick, listSpecsSlim, specsDigest, liveSignature, liveSpecs } from "../src/services/live-specs";
import { sessionPhasesBySpecAsync } from "../src/services/live-phases";
import { resetDb, makeProject, makeSpec } from "./factory";

vi.mock("../src/services/live-phases", () => ({ sessionPhasesBySpecAsync: vi.fn(async () => new Map()) }));

beforeEach(async () => {
  await resetDb();
  await makeProject();
  vi.mocked(sessionPhasesBySpecAsync).mockResolvedValue(new Map());
});
afterAll(resetDb);

describe("specsDigest", () => {
  it("berubah saat update/tambah/hapus, tetap saat diam", async () => {
    await makeSpec({ id: "SPEC-1" });
    await makeSpec({ id: "SPEC-2" });
    const d0 = await specsDigest();
    expect(await specsDigest()).toBe(d0);

    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "x", version: { increment: 1 } } });
    const d1 = await specsDigest();
    expect(d1).not.toBe(d0);

    await makeSpec({ id: "SPEC-9" });
    const d2 = await specsDigest();
    expect(d2).not.toBe(d1);

    await prisma.spec.delete({ where: { id: "SPEC-9" } });
    expect(await specsDigest()).not.toBe(d2);
  });
});

describe("listSpecsSlim", () => {
  it("tak memuat payload/objective/sourceHistory", async () => {
    await makeSpec({ id: "SPEC-1", objective: "panjang" });
    const rows = await listSpecsSlim();
    expect(rows).toHaveLength(1);
    for (const k of ["payload", "objective", "sourceHistory"]) expect(k in rows[0]!).toBe(false);
    expect(rows[0]!.id).toBe("SPEC-1");
  });

  it("stage live tersaji tanpa menulis DB", async () => {
    await makeSpec({ id: "SPEC-1", stage: "brainstorming" });
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValueOnce(
      new Map([["SPEC-1", { phases: [{ name: "Plan", state: "done" }], cwd: "/tmp/none" }]]) as never);
    expect((await listSpecsSlim())[0]!.stage).toBe("planned");
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.stage).toBe("brainstorming");
  });
});

describe("liveOverlayTick", () => {
  it("memajukan stage dan mem-persist walau tak ada yang memanggil listSpecs", async () => {
    await makeSpec({ id: "SPEC-1", stage: "brainstorming" });
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValueOnce(
      new Map([["SPEC-1", { phases: [{ name: "Plan", state: "done" }], cwd: "/tmp/none" }]]) as never);
    await liveOverlayTick();
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.stage).toBe("planned");
  });

  it("liveSpecs = overlay lalu penyajian", async () => {
    await makeSpec({ id: "SPEC-1", stage: "brainstorming" });
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValueOnce(
      new Map([["SPEC-1", { phases: [{ name: "Plan", state: "done" }], cwd: "/tmp/none" }]]) as never);
    expect((await liveSpecs())[0]!.stage).toBe("planned");
  });
});

describe("liveSignature", () => {
  it("berubah saat plan berhenti memuat '- [ ]' (gerbang SPEC-173)", async () => {
    const wt = mkdtempSync(join(tmpdir(), "ls-"));
    const dir = join(wt, "docs/superpowers/plans");
    mkdirSync(dir, { recursive: true });
    const plan = join(dir, "2026-spec-77-x-plan.md");
    writeFileSync(plan, "- [ ] a\n");
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValue(
      new Map([["SPEC-77", { phases: [{ name: "Execute", state: "done" }], cwd: wt }]]) as never);
    const before = await liveSignature();
    writeFileSync(plan, "- [x] a\n");
    expect(await liveSignature()).not.toBe(before);
  });
});
