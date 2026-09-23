import { describe, it, expect } from "vitest";
import {
  FLOW_PHASES, ORCHESTRATION_FLOWS, PHASE_AGENT_PREFIX, isPhaseAgentName, phaseAgentName,
} from "./orchestration";
import { codexNativeAgentsSupported, resolvePhasePlan } from "./orchestration-plan";
import { CODEX_MODELS, MODELS, ORCHESTRATION_DEFAULTS, replaceModelCatalog, zOrchestration, zSetting } from "./entities";
import { BUILTIN_ORCHESTRATION_DEFAULTS } from "./runtime-defaults";
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
	it("default bawaan memuat rekomendasi model/effort per flow dan fase", () => {
		expect(Object.keys(ORCHESTRATION_DEFAULTS).sort()).toEqual([...ORCHESTRATION_FLOWS].sort());
		expect(ORCHESTRATION_DEFAULTS.feature.claude.Spec).toEqual({ model: "opus", effort: "high" });
		expect(ORCHESTRATION_DEFAULTS.feature.codex.Spec).toEqual({ model: "gpt-5.6-sol", effort: "high" });
		expect(ORCHESTRATION_DEFAULTS.feature.claude.Plan).toEqual({ model: "opus", effort: "high" });
		expect(ORCHESTRATION_DEFAULTS.feature.claude.Execute).toEqual({ model: "sonnet", effort: "high" });
		expect(ORCHESTRATION_DEFAULTS.feature.claude.Brainstorm).toEqual({ model: "sonnet", effort: "medium" });
		expect(ORCHESTRATION_DEFAULTS.goal.claude.Verifikasi).toEqual({ model: "opus", effort: "medium" });
		expect(ORCHESTRATION_DEFAULTS.no_effort.enabled).toBe(false);
		expect(ORCHESTRATION_DEFAULTS).toEqual(BUILTIN_ORCHESTRATION_DEFAULTS);
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
  // S4a · sejak amandemen 2026-09-17 default = matriks bawaan (Spec Opus, no_effort MATI), bukan
  // "semua flow aktif dengan sel kosong". Blok absen harus jatuh ke ORCHESTRATION_DEFAULTS — persis
  // yang server pakai (`zSetting` .default) — supaya pratinjau tak menampilkan rencana palsu.
  it("S4a · blok absen (respons Setting lama) → ORCHESTRATION_DEFAULTS, bukan sel kosong", () => {
    expect(resolvePhasePlan({ ...base, orchestration: undefined }))
      .toEqual(resolvePhasePlan({ ...base, orchestration: ORCHESTRATION_DEFAULTS }));
    expect(resolvePhasePlan({ ...base, flow: "no_effort", orchestration: undefined })).toBeNull();
  });
	it("sel kosong mewarisi orchestrator di setiap fase", () => {
		const emptyOrchestration = zOrchestration.parse({});
		const plan = resolvePhasePlan({ ...base, orchestration: emptyOrchestration })!;
    expect(plan).toMatchObject({ flow: "feature", runtime: "claude" });
    expect(plan.phases.map((p) => p.phase)).toEqual(FLOW_PHASES.feature);
    expect(plan.phases[3]).toEqual({
      phase: "Plan", agentName: "hanoman-fase-plan", model: "claude-opus-5", effort: "xhigh",
		});
	});
	it("override per sesi menang atas sel Settings dan orchestrator", () => {
		const orchestration = { ...ORCHESTRATION_DEFAULTS,
			feature: { ...ORCHESTRATION_DEFAULTS.feature,
				claude: { ...ORCHESTRATION_DEFAULTS.feature.claude,
					Plan: { model: "claude-opus-5", effort: "high" },
				},
			},
		};
		const plan = resolvePhasePlan({ ...base, orchestration,
			phaseOverrides: { Plan: { model: "claude-haiku-4-5", effort: "low" } },
		})!;
		expect(plan.phases.find((p) => p.phase === "Plan")).toMatchObject({
			model: "claude-haiku-4-5", effort: "low",
		});
	});
  it("model sel dipakai; effort warisan dikoersi ke model hasil resolusi (claude)", () => {
    // Daftar effort per model datang dari discovery CLI, bukan dari fallback offline.
    const before = MODELS;
    replaceModelCatalog([...before.filter((m) => m.id !== "fable"), { id: "fable", label: "Fable 5.1", resolved: "claude-fable-5-1",
      efforts: ["max", "xhigh", "high", "medium", "low"] }], CODEX_MODELS);
    try {
      const orchestration = { ...ORCHESTRATION_DEFAULTS,
        feature: { enabled: true, claude: { Plan: { model: "fable", effort: null } }, codex: {} } };
      const plan = resolvePhasePlan({ ...base, orchestration, orchestrator: { model: "opus", effort: "ultracode" } })!;
      expect(plan.phases.find((p) => p.phase === "Plan")).toMatchObject({ model: "fable", effort: "xhigh" });
    } finally { replaceModelCatalog(before, CODEX_MODELS); }
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
  // `default` hanya sah untuk `--model` sesi; `--agents` claude menerima alias keluarga, id penuh,
  // atau `inherit`. Orchestrator ber-`default` yang diwarisi sel kosong harus jadi `inherit`.
  it("claude: `default` warisan orchestrator dirender `inherit`, bukan `default`", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS,
      feature: { enabled: true, claude: { Spec: { model: "opus", effort: null } }, codex: {} } };
    const plan = resolvePhasePlan({ ...base, orchestration,
      orchestrator: { model: "default", effort: "medium" },
      phaseOverrides: { Plan: { model: "default", effort: "low" } } })!;
    expect(plan.phases.find((p) => p.phase === "Brainstorm")).toMatchObject({ model: "inherit", effort: "medium" });
    expect(plan.phases.find((p) => p.phase === "Plan")).toMatchObject({ model: "inherit", effort: "low" });
    expect(plan.phases.find((p) => p.phase === "Spec")).toMatchObject({ model: "opus" });
    expect(plan.phases.map((p) => p.model)).not.toContain("default");
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
