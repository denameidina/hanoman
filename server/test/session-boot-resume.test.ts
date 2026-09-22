import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { beginSession, reconcileHistory } from "../src/services/session-history";
import { resumeReconciledSessions, type ResumeDeps } from "../src/services/session-boot-resume";

const PROJECT_ID = "boot-resume-proj";

const seedSpec = (over: { id: string; stage: string }) =>
  prisma.spec.create({
    data: {
      projectId: PROJECT_ID, title: "Judul", source: "brief",
      priority: "sedang", author: "t", objective: "o", ...over,
    },
  });

const clean = async () => {
  await prisma.notification.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.sessionHistory.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.spec.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
};

beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: PROJECT_ID, name: "Boot resume", desc: "", kind: "existing" } });
});
afterAll(clean);

const reconciledFor = async (specId: string) => {
  await beginSession({
    sessionId: specId.toLowerCase(), projectId: PROJECT_ID, specId, flow: "feature",
    kind: "spec", agent: "claude", cwd: `/repo/.worktrees/${specId.toLowerCase()}`,
  });
};

describe("resumeReconciledSessions (ADR-0169)", () => {
  it("melanjutkan kandidat yang stage-nya belum done, melewati yang sudah done", async () => {
    await seedSpec({ id: "SPEC-9101", stage: "executing" });
    await seedSpec({ id: "SPEC-9102", stage: "done" });
    await reconciledFor("SPEC-9101");
    await reconciledFor("SPEC-9102");
    const cutoff = new Date();
    expect(await reconcileHistory([])).toBe(2);

    const started: string[] = [];
    const deps: ResumeDeps = {
      startSpec: async (spec) => { started.push(spec.id); return { id: spec.id }; },
      recordFail: async () => { throw new Error("tak boleh dipanggil"); },
    };
    const report = await resumeReconciledSessions(cutoff, deps);
    expect(report).toEqual({ resumed: ["SPEC-9101"], failed: [] });
    expect(started).toEqual(["SPEC-9101"]);
  });

  it("kegagalan satu kandidat tak menghentikan yang lain, tercatat sebagai gagal", async () => {
    await seedSpec({ id: "SPEC-9101", stage: "executing" });
    await seedSpec({ id: "SPEC-9103", stage: "spec-ready" });
    await reconciledFor("SPEC-9101");
    await reconciledFor("SPEC-9103");
    const cutoff = new Date();
    await reconcileHistory([]);

    const failedReasons: string[] = [];
    const deps: ResumeDeps = {
      startSpec: async (spec) => {
        if (spec.id === "SPEC-9101") throw new Error("worktree rusak");
        return { id: spec.id };
      },
      recordFail: async (specId, _title, _projectId, reason) => { failedReasons.push(`${specId}:${reason}`); },
    };
    const report = await resumeReconciledSessions(cutoff, deps);
    expect(report.resumed).toEqual(["SPEC-9103"]);
    expect(report.failed).toEqual(["SPEC-9101"]);
    expect(failedReasons).toHaveLength(1);
    expect(failedReasons[0]).toContain("worktree rusak");
  });

  it("tak ada kandidat → deps sama sekali tak dipanggil", async () => {
    const cutoff = new Date();
    const startSpec = vi.fn();
    const recordFail = vi.fn();
    const report = await resumeReconciledSessions(cutoff, { startSpec, recordFail });
    expect(report).toEqual({ resumed: [], failed: [] });
    expect(startSpec).not.toHaveBeenCalled();
    expect(recordFail).not.toHaveBeenCalled();
  });
});
