import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { beginSession, reconcileHistory } from "../src/services/session-history";
import { resumeReconciledSessions, type ResumeDeps } from "../src/services/session-boot-resume";
import { LaunchAdmissionError } from "../src/services/session-admission";
import { zLaunchStatus } from "@hanoman/shared";

const admissionFixture = zLaunchStatus.parse({
  enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 1, loadPerCore: 0.1,
  maxLoadPerCore: 2.5, loadStatus: "available", memAvailablePct: 50, minMemAvailablePct: 15,
  memStatus: "available",
});

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

const reconciledFor = async (specId: string, runtime: { agent?: "claude" | "codex"; model?: string; effort?: string } = {}) => {
  await beginSession({
    sessionId: specId.toLowerCase(), projectId: PROJECT_ID, specId, flow: "feature",
    kind: "spec", agent: runtime.agent ?? "claude", model: runtime.model, effort: runtime.effort,
    cwd: `/repo/.worktrees/${specId.toLowerCase()}`,
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
      recordDeferred: async () => { throw new Error("tak boleh dipanggil"); },
    };
    const report = await resumeReconciledSessions(cutoff, deps);
    expect(report).toEqual({ resumed: ["SPEC-9101"], failed: [], deferred: [] });
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
      recordDeferred: async () => { throw new Error("tak boleh dipanggil"); },
    };
    const report = await resumeReconciledSessions(cutoff, deps);
    expect(report.resumed).toEqual(["SPEC-9103"]);
    expect(report.failed).toEqual(["SPEC-9101"]);
    expect(report.deferred).toEqual([]);
    expect(failedReasons).toHaveLength(1);
    expect(failedReasons[0]).toContain("worktree rusak");
  });

  // ADR-0170 · mengamandemen ADR-0169 keputusan #4: kandidat yang ditolak gerbang kapasitas/beban
  // host TIDAK dianggap gagal — dicatat terpisah (`deferred`) supaya operator tahu ia menunggu slot,
  // bukan rusak, dan sisa kandidat tetap dicoba (tunduk cap, bukan berhenti di kandidat pertama).
  it("ditolak gerbang kapasitas/beban host → deferred, bukan failed; kandidat lain tetap dicoba", async () => {
    await seedSpec({ id: "SPEC-9101", stage: "executing" });
    await seedSpec({ id: "SPEC-9103", stage: "spec-ready" });
    await reconciledFor("SPEC-9101");
    await reconciledFor("SPEC-9103");
    const cutoff = new Date();
    await reconcileHistory([]);

    const deferredReasons: string[] = [];
    const deps: ResumeDeps = {
      startSpec: async (spec) => {
        if (spec.id === "SPEC-9101") throw new LaunchAdmissionError("capacity", admissionFixture);
        return { id: spec.id };
      },
      recordFail: async () => { throw new Error("tak boleh dipanggil"); },
      recordDeferred: async (specId, _title, _projectId, reason) => {
        deferredReasons.push(`${specId}:${reason}`);
      },
    };
    const report = await resumeReconciledSessions(cutoff, deps);
    expect(report.resumed).toEqual(["SPEC-9103"]);
    expect(report.failed).toEqual([]);
    expect(report.deferred).toEqual(["SPEC-9101"]);
    expect(deferredReasons).toHaveLength(1);
    expect(deferredReasons[0]).toContain("ditunda");
  });

  // S4c · resume = MELANJUTKAN sesi yang sama (ADR-0084): runtime saat lahir (SessionHistory) ikut,
  // bukan Setting global — sesi codex tak boleh lanjut sebagai claude.
  it("S4c · meneruskan agen/model/effort sesi asal dari SessionHistory", async () => {
    await seedSpec({ id: "SPEC-9104", stage: "executing" });
    await seedSpec({ id: "SPEC-9105", stage: "executing" });
    await reconciledFor("SPEC-9104", { agent: "codex", model: "gpt-5.6-terra", effort: "low" });
    await reconciledFor("SPEC-9105");
    const cutoff = new Date();
    await reconcileHistory([]);
    const seen: Record<string, unknown> = {};
    const deps: ResumeDeps = {
      startSpec: async (spec, runtime) => { seen[spec.id] = runtime; return { id: spec.id }; },
      recordFail: async () => { throw new Error("tak boleh dipanggil"); },
      recordDeferred: async () => { throw new Error("tak boleh dipanggil"); },
    };
    await resumeReconciledSessions(cutoff, deps);
    expect(seen["SPEC-9104"]).toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "low" });
    expect(seen["SPEC-9105"]).toEqual({ agent: "claude" });
  });

  it("tak ada kandidat → deps sama sekali tak dipanggil", async () => {
    const cutoff = new Date();
    const startSpec = vi.fn();
    const recordFail = vi.fn();
    const recordDeferred = vi.fn();
    const report = await resumeReconciledSessions(cutoff, { startSpec, recordFail, recordDeferred });
    expect(report).toEqual({ resumed: [], failed: [], deferred: [] });
    expect(startSpec).not.toHaveBeenCalled();
    expect(recordFail).not.toHaveBeenCalled();
    expect(recordDeferred).not.toHaveBeenCalled();
  });
});
