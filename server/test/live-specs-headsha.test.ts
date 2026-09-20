import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { liveSpecs } from "../src/services/live-specs";
import { sessionPhasesBySpecAsync } from "../src/services/live-phases";
import { makeRepoWithBranches } from "./factory";
import { spawnSync } from "node:child_process";

// Overlay stage-live membaca tmux nyata; di test tak ada pane. Mock hanya sessionPhasesBySpecAsync
// (sisanya asli) — pola yang sama dengan specs.route.test.ts.
vi.mock("../src/services/live-phases", () => ({ sessionPhasesBySpecAsync: vi.fn(async () => new Map()) }));

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

const seed = async (id: string, stage = "executing") => {
  await prisma.project.upsert({ where: { id: "plh" }, update: {}, create: { id: "plh", name: "PLH", desc: "", kind: "existing" } });
  return prisma.spec.create({ data: { id, projectId: "plh", title: id, source: "brief", stage, priority: "sedang", author: "a", objective: "", baseSha: "base0" } });
};

// SPEC-475 · `live-specs` adalah jalur persist `stage = done` untuk sesi yang di-Start MANUAL —
// item seperti itu tak punya baris antrean sama sekali, jadi reconcile tak pernah menyentuhnya.
// Terukur di DB hidup: SPEC-453 (dependency yang jadi biang keluhan) persis berbentuk begitu.
describe("liveSpecs · merekam headSha saat stage maju ke done (SPEC-475)", () => {
  it("stage maju ke done → ujung kerja worktree tercatat di Spec.headSha", async () => {
    await seed("SPEC-LH1");
    const wt = makeRepoWithBranches();
    const expected = spawnSync("git", ["rev-parse", "HEAD"], { cwd: wt, encoding: "utf8" }).stdout.trim();
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValueOnce(
      new Map([["SPEC-LH1", { phases: [{ name: "Execute", state: "done" }], cwd: wt }]]) as never);
    await liveSpecs({ project: "plh" });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-LH1" } });
    expect(row!.stage).toBe("done");
    expect(row!.headSha).toBe(expected);
  });

  // Kemajuan yang BELUM done tak boleh menstempel ujung kerja: rentang review (ADR-0030) berakhir
  // saat item selesai, bukan saat fase perencanaannya lewat.
  it("kemajuan ke stage non-done tak menyentuh headSha", async () => {
    await seed("SPEC-LH2", "brainstorming");
    const wt = makeRepoWithBranches();
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValueOnce(
      new Map([["SPEC-LH2", { phases: [{ name: "Plan", state: "done" }], cwd: wt }]]) as never);
    await liveSpecs({ project: "plh" });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-LH2" } });
    expect(row!.stage).toBe("planned");
    expect(row!.headSha).toBeNull();
  });
});
