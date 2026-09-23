import { describe, it, expect } from "vitest";
import {
  ORCHESTRATION_FLOWS, BUILTIN_ORCHESTRATION_DEFAULTS, BUILTIN_RUNTIME_DEFAULTS,
} from "@hanoman/shared";
import { applyRuntimeDefaults } from "./runtime-defaults";

const legacyFlow = { enabled: true, claude: {}, codex: {} };
const legacyOrchestration = Object.fromEntries(
  ORCHESTRATION_FLOWS.map((flow) => [flow, legacyFlow]),
);

describe("runtime defaults", () => {
  it("first install seeds global and per-phase recommendations", () => {
    const result = applyRuntimeDefaults(undefined)!;

    expect(result.changed).toBe(true);
    expect(result.data.model).toBe("sonnet");
    expect(result.data.effort).toBe("medium");
    expect(result.data.codex).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
    expect(result.data.orchestration).toEqual(BUILTIN_ORCHESTRATION_DEFAULTS);
    expect(result.data.builtinRuntimeDefaults).toEqual(BUILTIN_RUNTIME_DEFAULTS);
  });

  it("upgrade memperbarui legacy yang belum disentuh", () => {
    const result = applyRuntimeDefaults({
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
      codex: { model: "gpt-5.6-sol", effort: "xhigh" }, orchestration: legacyOrchestration,
    })!;

    expect(result.data.model).toBe("sonnet");
    expect(result.data.effort).toBe("medium");
    expect(result.data.codex).toEqual({ model: "gpt-5.6-terra", effort: "medium" });
    expect(result.data.orchestration).toEqual(BUILTIN_ORCHESTRATION_DEFAULTS);
  });

  // Seed versi sebelumnya menulis id terpatok; seed alias native harus menggantinya selama nilai
  // itu masih `seeded`, dan membiarkan id terpatok yang DIPILIH operator (`user`).
  it("upgrade memindah default seeded ber-id terpatok ke alias native", () => {
    const base = { autoDefault: true, autoScaffold: true, notifyFail: true, effort: "medium" };
    const marker = (state: "seeded" | "user") => ({ ...BUILTIN_RUNTIME_DEFAULTS, version: "2026-09-17-v1",
      claude: { model: state, effort: "seeded" } });
    const seeded = applyRuntimeDefaults({ ...base, model: "claude-sonnet-5", builtinRuntimeDefaults: marker("seeded") })!;
    expect(seeded.data.model).toBe("sonnet");
    expect(seeded.data.orchestration.feature.claude.Spec).toEqual({ model: "opus", effort: "high" });
    const pinned = applyRuntimeDefaults({ ...base, model: "claude-sonnet-5", builtinRuntimeDefaults: marker("user") })!;
    expect(pinned.data.model).toBe("claude-sonnet-5");
  });

  it("upgrade menjaga global dan flow yang sudah diedit user", () => {
    const feature = { enabled: true, claude: { Plan: { model: "custom-claude", effort: "high" } }, codex: {} };
    const result = applyRuntimeDefaults({
      model: "custom-claude", effort: "low", autoDefault: true, autoScaffold: true, notifyFail: true,
      codex: { model: "custom-codex", effort: "high" },
      orchestration: { ...legacyOrchestration, feature },
    })!;

    expect(result.data.model).toBe("custom-claude");
    expect(result.data.effort).toBe("low");
    expect(result.data.codex).toEqual({ model: "custom-codex", effort: "high" });
    expect(result.data.orchestration.feature.claude.Plan).toEqual(feature.claude.Plan);
    expect(result.data.orchestration.feature.claude.Execute).toEqual(
      BUILTIN_ORCHESTRATION_DEFAULTS.feature.claude.Execute,
    );
    expect(result.data.orchestration.qa).toEqual(BUILTIN_ORCHESTRATION_DEFAULTS.qa);
    expect(result.data.builtinRuntimeDefaults.claude.model).toBe("user");
    expect(result.data.builtinRuntimeDefaults.codex.model).toBe("user");
    expect(result.data.builtinRuntimeDefaults.orchestration["feature.claude.Plan.model"]).toBe("user");
    expect(result.data.builtinRuntimeDefaults.orchestration["feature.claude.Execute.model"]).toBe("seeded");
    expect(result.data.builtinRuntimeDefaults.orchestration["qa.enabled"]).toBe("seeded");
  });
});
