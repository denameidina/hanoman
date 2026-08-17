import { describe, it, expect } from "vitest";
import { zProject, zSpec, zStage, zCreateSpec, zPatchSpec, zProjectView, zNotification, zSetting, zQaPayload, zGoalPayload, MODELS, EFFORTS } from "../src/index";

describe("zQaPayload fromAudit (SPEC-244)", () => {
  it("menerima fromAudit opsional", () => {
    const r = zQaPayload.parse({ severity: "major", steps: "", expected: "", actual: "", env: "", fromAudit: "SPEC-237" });
    expect(r.fromAudit).toBe("SPEC-237");
    const r2 = zQaPayload.parse({ severity: "major", steps: "", expected: "", actual: "", env: "" });
    expect(r2.fromAudit).toBeUndefined();
  });
});

describe("SPEC-826 · zQaPayload.constraints", () => {
  const legacy = { severity: "major", steps: "1. buka", expected: "e", actual: "a", env: "prod" };

  it("payload qa LAMA (tanpa constraints) tetap terbaca, ternormalkan ke string kosong", () => {
    const r = zQaPayload.parse(legacy);
    expect(r.constraints).toBe("");
  });

  it("constraints yang dikirim dipakai apa adanya", () => {
    expect(zQaPayload.parse({ ...legacy, constraints: "jangan ubah kontrak API" }).constraints)
      .toBe("jangan ubah kontrak API");
  });

  it("payload qa lama lolos boundary create & patch — bukan hanya skema payload-nya", () => {
    expect(zCreateSpec.safeParse({
      project: "p", source: "qa", title: "t", priority: "sedang", payload: legacy }).success).toBe(true);
    expect(zPatchSpec.safeParse({ payload: legacy }).success).toBe(true);
  });

  it("ketiga bentuk payload sama-sama punya constraints", () => {
    const qa = zQaPayload.parse(legacy);
    const goal = zGoalPayload.parse({ goal: "g", done: "", constraints: "", priority: "sedang" });
    expect("constraints" in qa && "constraints" in goal).toBe(true);
  });
});

describe("schemas", () => {
  it("parses a valid project", () => {
    const p = zProject.parse({ id: "arta", name: "arta", desc: "x", kind: "existing",
      docStatus: "ok", coverage: 94, createdAt: new Date().toISOString() });
    expect(p.coverage).toBe(94);
  });
  it("rejects coverage over 100", () => {
    expect(() => zProject.parse({ id: "a", name: "a", desc: "", kind: "existing",
      docStatus: "ok", coverage: 101, createdAt: new Date().toISOString() })).toThrow();
  });
  it("stage enum has the six stages in order", () => {
    expect(zStage.options).toEqual(["brainstorming","objective","spec-ready","planned","executing","done"]);
  });
  it("create-spec brief payload validates", () => {
    const b = zCreateSpec.parse({ project: "arta", source: "brief", title: "T",
      priority: "sedang", payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } });
    expect(b.source).toBe("brief");
  });
  // SPEC-197 · source harus cocok dengan bentuk payload (qa↔severity), agar deriveSpecFields tak
  // menurunkan objective/priority dari bentuk yang salah.
  it("create-spec menolak source qa dengan brief payload (dan sebaliknya)", () => {
    const brief = { context: "c", outcome: "o", constraints: "", priority: "sedang" as const };
    const qa = { severity: "major" as const, steps: "s", expected: "e", actual: "a", env: "x" };
    expect(zCreateSpec.safeParse({ project: "arta", source: "qa", title: "T", priority: "sedang", payload: brief }).success).toBe(false);
    expect(zCreateSpec.safeParse({ project: "arta", source: "brief", title: "T", priority: "sedang", payload: qa }).success).toBe(false);
    expect(zCreateSpec.safeParse({ project: "arta", source: "qa", title: "T", priority: "sedang", payload: qa }).success).toBe(true);
  });
  // SPEC-143: branch sumber worktree adalah properti backlog item.
  it("spec carries a nullable branchFrom", () => {
    const base = { id: "SPEC-1", projectId: "p1", title: "t", source: "brief" as const,
      stage: "brainstorming" as const, priority: "sedang" as const, author: "a", objective: "o",
      // baseSha wajib (nullable) sejak SPEC-186; createdAt/startedAt wajib sejak SPEC-408/ADR-0090.
      payload: null, baseSha: null,
      createdAt: new Date().toISOString(), startedAt: null };
    expect(zSpec.parse({ ...base, branchFrom: null }).branchFrom).toBeNull();
    expect(zSpec.parse({ ...base, branchFrom: "release/v2" }).branchFrom).toBe("release/v2");
  });
  it("create-spec takes an optional branchFrom", () => {
    const b = { project: "arta", source: "brief" as const, title: "T", priority: "sedang" as const,
      payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" as const } };
    expect(zCreateSpec.parse(b).branchFrom).toBeUndefined();
    expect(zCreateSpec.parse({ ...b, branchFrom: "dev" }).branchFrom).toBe("dev");
  });
  // branchFrom: null = "kosongkan", undefined = "jangan sentuh". Sejak SPEC-167 branchFrom
  // opsional (patch bisa hanya menyentuh stage), jadi `{}` sah sebagai no-op.
  it("patch-spec: null clears the branch, empty string invalid, absent key is a no-op patch", () => {
    expect(zPatchSpec.parse({ branchFrom: null }).branchFrom).toBeNull();
    expect(zPatchSpec.safeParse({ branchFrom: "" }).success).toBe(false);
    expect(zPatchSpec.safeParse({}).success).toBe(true);
  });
  // SPEC-167 · stage revert: hanya nilai zStage yang valid; confirmDelete opsional.
  it("patch-spec: stage terbatas ke enum zStage; confirmDelete opsional", () => {
    expect(zPatchSpec.parse({ stage: "objective" }).stage).toBe("objective");
    expect(zPatchSpec.parse({ stage: "planned", confirmDelete: true }).confirmDelete).toBe(true);
    expect(zPatchSpec.safeParse({ stage: "hantu" }).success).toBe(false);
  });
  it("project view adds derived fields", () => {
    const v = zProjectView.parse({ id: "a", name: "a", desc: "", kind: "existing", docStatus: "ok",
      coverage: 94, createdAt: new Date().toISOString(), stack: "Go", backlog: 6, topStage: "execute",
      binding: null,   // SPEC-217 · field wajib (nullable) — sebelumnya terlewat, bikin test merah
      session: { status: "running", phase: "Execute", flow: "feature" }, activity: "x", commit: "y" });
    expect(v.backlog).toBe(6);
  });
  // SPEC-184 · notifikasi human decision
  it("zNotification decision: specId null, sessionId terisi, type decision", () => {
    const r = zNotification.safeParse({ id: "1", type: "decision", specId: null, sessionId: "s1",
      title: "x", projectId: "p1", createdAt: "2026-07-11T00:00:00.000Z", readAt: null });
    expect(r.success).toBe(true);
  });
  it("zNotification: type default done bila tak diberikan", () => {
    const r = zNotification.parse({ id: "1", specId: "SPEC-1", sessionId: null,
      title: "x", projectId: null, createdAt: "2026-07-11T00:00:00.000Z", readAt: null });
    expect(r.type).toBe("done");
  });
  it("zSetting mengisi default notifyDecision + notifyDecisionSound", () => {
    const s = zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true });
    expect(s.notifyDecision).toBe(true);
    expect(s.notifyDecisionSound).toBe("alert");
  });

  // SPEC-252 · ADR-0061 — model & effort per SESI; matrix per-fase (phaseModels) dicabut.
  describe("zSetting tanpa phaseModels", () => {
    const base = { autoDefault: true, autoScaffold: true, notifyFail: true };
    it("zSetting tak lagi punya field phaseModels", () => {
      expect("phaseModels" in zSetting.parse(base)).toBe(false);
    });
    it("baris lama yang masih memuat phaseModels tetap parse (field diabaikan)", () => {
      const s = zSetting.parse({ ...base, phaseModels: { feature: { Brainstorm: { model: "claude-sonnet-5" } } } });
      expect("phaseModels" in s).toBe(false);
      expect(s.model).toBe("claude-opus-5");
    });
    it("MODELS memuat Fable; EFFORTS memuat max & ultracode (dipakai picker Start)", () => {
      expect(MODELS.map((m) => m.id)).toContain("claude-fable-5");
      expect(EFFORTS).toContain("max");
      expect(EFFORTS).toContain("ultracode");
    });
  });
});

// SPEC-407 · bentuk payload KETIGA: backlog goal. Objective spec diturunkan dari `goal`.
describe("zGoalPayload (SPEC-407)", () => {
  const payload = { goal: "p95 < 200 ms", done: "benchmark", constraints: "tanpa cache", priority: "tinggi" };
  it("menerima bentuk goal utuh", () => {
    expect(zGoalPayload.safeParse(payload).success).toBe(true);
    expect(zGoalPayload.safeParse({ goal: "g", constraints: "", priority: "tinggi" }).success).toBe(false);
  });
  it("zSpec menyimpannya apa adanya", () => {
    const spec = zSpec.parse({
      id: "SPEC-407", projectId: "p1", title: "t", source: "goal", stage: "brainstorming",
      priority: "tinggi", author: "Goal · a@b.c", objective: "p95 < 200 ms", payload,
      branchFrom: null, baseSha: null,
      createdAt: new Date().toISOString(), startedAt: null,   // SPEC-408 · ADR-0090
    });
    expect(spec.payload).toEqual(payload);
  });
  it("zPatchSpec menerima payload goal", () => {
    expect(zPatchSpec.safeParse({ payload }).success).toBe(true);
  });
});
