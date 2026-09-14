import { describe, it, expect } from "vitest";
import {
  FLOW_PHASES, ORCHESTRATION_FLOWS, PHASE_AGENT_PREFIX, isPhaseAgentName, phaseAgentName,
} from "./orchestration";
import { codexNativeAgentsSupported, resolvePhasePlan } from "./orchestration-plan";
import { ORCHESTRATION_DEFAULTS, zOrchestration, zSetting } from "./entities";
import { AGENT_NAME_RE } from "./custom-agent";

const orchestrator = { model: "claude-opus-5", effort: "xhigh" };

describe("FLOW_PHASES (ADR-0164)", () => {
  it("setiap flow orkestrasi punya daftar fase", () => {
    expect(Object.keys(FLOW_PHASES).sort()).toEqual([...ORCHESTRATION_FLOWS].sort());
    expect(FLOW_PHASES.feature).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
    expect(FLOW_PHASES.reverse).toEqual(["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"]);
  });
});

describe("phaseAgentName", () => {
  it("slug huruf kecil, non-alnum dirapatkan jadi satu tanda hubung", () => {
    expect(phaseAgentName("Doc index")).toBe("hanoman-fase-doc-index");
    expect(phaseAgentName("Konvensi & index")).toBe("hanoman-fase-konvensi-index");
    expect(phaseAgentName("Execute")).toBe("hanoman-fase-execute");
  });
  it("semua nama agen fase sah menurut AGENT_NAME_RE dan unik per flow", () => {
    for (const phases of Object.values(FLOW_PHASES)) {
      const names = phases.map(phaseAgentName);
      for (const n of names) expect(AGENT_NAME_RE.test(n), n).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it("isPhaseAgentName mengenali awalan yang dicadangkan", () => {
    expect(isPhaseAgentName(`${PHASE_AGENT_PREFIX}plan`)).toBe(true);
    expect(isPhaseAgentName("scout")).toBe(false);
  });
});

describe("Setting.orchestration", () => {
  it("default: setiap flow aktif dengan matriks kosong", () => {
    expect(Object.keys(ORCHESTRATION_DEFAULTS).sort()).toEqual([...ORCHESTRATION_FLOWS].sort());
    for (const flow of ORCHESTRATION_FLOWS)
      expect(ORCHESTRATION_DEFAULTS[flow]).toEqual({ enabled: true, claude: {}, codex: {} });
  });
  it("baris Setting lama tanpa blok ini tetap parse dengan default aktif", () => {
    const s = zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true });
    expect(s.orchestration.feature.enabled).toBe(true);
  });
  it("sel parsial diisi null, flow lain tetap default", () => {
    const o = zOrchestration.parse({ qa: { enabled: false, claude: { Plan: { model: "claude-sonnet-5" } } } });
    expect(o.qa).toEqual({ enabled: false, claude: { Plan: { model: "claude-sonnet-5", effort: null } }, codex: {} });
    expect(o.feature.enabled).toBe(true);
  });
});

describe("resolvePhasePlan", () => {
  const base = {
    flow: "feature" as const, runtime: "claude" as const,
    orchestration: ORCHESTRATION_DEFAULTS, orchestrator, nativeAgents: true,
  };
  it("flow mati → null", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS, feature: { enabled: false, claude: {}, codex: {} } };
    expect(resolvePhasePlan({ ...base, orchestration })).toBeNull();
  });
  it("runtime tanpa agen native → null", () => {
    expect(resolvePhasePlan({ ...base, nativeAgents: false })).toBeNull();
  });
  it("blok absen (respons Setting lama) → default aktif", () => {
    expect(resolvePhasePlan({ ...base, orchestration: undefined })?.phases).toHaveLength(5);
  });
  it("sel kosong mewarisi orchestrator di setiap fase", () => {
    const plan = resolvePhasePlan(base)!;
    expect(plan).toMatchObject({ flow: "feature", runtime: "claude" });
    expect(plan.phases.map((p) => p.phase)).toEqual(FLOW_PHASES.feature);
    expect(plan.phases[3]).toEqual({
      phase: "Plan", agentName: "hanoman-fase-plan", model: "claude-opus-5", effort: "xhigh",
    });
  });
  it("model sel dipakai; effort warisan dikoersi ke model hasil resolusi (claude)", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS,
      feature: { enabled: true, claude: { Plan: { model: "claude-fable-5-1", effort: null } }, codex: {} } };
    const plan = resolvePhasePlan({ ...base, orchestration, orchestrator: { model: "claude-opus-5", effort: "ultracode" } })!;
    expect(plan.phases.find((p) => p.phase === "Plan")).toMatchObject({ model: "claude-fable-5-1", effort: "xhigh" });
  });
  it("codex membaca kolom codex dan mengoreksi effort ke fallback model", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS, qa: { enabled: true,
      claude: { Execute: { model: "claude-sonnet-5", effort: "low" } },
      codex: { Execute: { model: "gpt-5.6-luna", effort: null } } } };
    const plan = resolvePhasePlan({ ...base, flow: "qa", runtime: "codex", orchestration,
      orchestrator: { model: "gpt-5.6-sol", effort: "ultra" } })!;
    expect(plan.phases.find((p) => p.phase === "Execute")).toMatchObject({ model: "gpt-5.6-luna", effort: "xhigh" });
    expect(plan.phases.find((p) => p.phase === "Audit")).toMatchObject({ model: "gpt-5.6-sol", effort: "ultra" });
  });
  it("kunci fase asing di matriks tak menambah fase", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS,
      goal: { enabled: true, claude: { Foo: { model: "x", effort: "low" } }, codex: {} } };
    expect(resolvePhasePlan({ ...base, flow: "goal", orchestration })!.phases.map((p) => p.phase))
      .toEqual(["Goal", "Verifikasi"]);
  });
});

describe("codexNativeAgentsSupported", () => {
  it("membaca versi dari keluaran --version", () => {
    expect(codexNativeAgentsSupported("codex-cli 0.154.0")).toBe(true);
    expect(codexNativeAgentsSupported("0.151.0")).toBe(true);
    expect(codexNativeAgentsSupported("0.150.9")).toBe(false);
    expect(codexNativeAgentsSupported(null)).toBe(false);
  });
});
