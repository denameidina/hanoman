import { describe, it, expect } from "vitest";
import {
  ORCHESTRATION_FLOWS, BUILTIN_ORCHESTRATION_DEFAULTS, BUILTIN_RUNTIME_DEFAULTS, zSetting,
} from "@hanoman/shared";
import { applyRuntimeDefaults, markRuntimeDefaultsUserEdited } from "./runtime-defaults";

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
    expect(result.data.antigravity).toEqual({ model: "gemini-3.8-flash-high", effort: "high" });
    expect(result.data.orchestration).toEqual(BUILTIN_ORCHESTRATION_DEFAULTS);
    expect(result.data.builtinRuntimeDefaults).toEqual(BUILTIN_RUNTIME_DEFAULTS);
    expect(applyRuntimeDefaults(result.data)!.changed).toBe(false);
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

describe("Antigravity additive defaults (SPEC-1442)", () => {
  const base = { autoDefault: true, autoScaffold: true, notifyFail: true };

  it("extends a current marker without reseeding Claude/Codex values or ownership", () => {
    const marker = structuredClone(BUILTIN_RUNTIME_DEFAULTS);
    const { antigravity: _antigravity, ...oldMarker } = marker;
    for (const key of Object.keys(oldMarker.orchestration)) {
      if (key.includes(".antigravity.")) delete oldMarker.orchestration[key];
    }
    oldMarker.claude.effort = "user";
    const raw = { ...base, agent: "codex", model: "pinned-claude", effort: "low",
      codex: { model: "pinned-codex", effort: "high" }, builtinRuntimeDefaults: oldMarker,
      orchestration: { feature: { enabled: false,
        claude: { Plan: { model: "pinned-phase", effort: "low" } }, codex: {} } } };
    const result = applyRuntimeDefaults(raw)!;
    expect(result.data.agent).toBe(raw.agent);
    expect(result.data.model).toBe(raw.model);
    expect(result.data.effort).toBe(raw.effort);
    expect(result.data.codex).toEqual(raw.codex);
    expect(result.data.builtinRuntimeDefaults.claude).toEqual(oldMarker.claude);
    expect(result.data.builtinRuntimeDefaults.codex).toEqual(oldMarker.codex);
    expect(result.data.orchestration.feature.claude.Plan).toEqual(raw.orchestration.feature.claude.Plan);
    expect(result.data.orchestration.feature.enabled).toBe(false);
    expect(result.data.orchestration.feature.antigravity.Plan).toEqual({ model: "inherit", effort: null });
    expect(result.data.builtinRuntimeDefaults.antigravity).toEqual({ model: "seeded", effort: "seeded" });
    expect(applyRuntimeDefaults(result.data)!.changed).toBe(false);
  });

  it("infers user ownership for unmarked Antigravity fields and preserves unknown parent slugs", () => {
    const result = applyRuntimeDefaults({ ...base, agent: "antigravity",
      antigravity: { model: "future-provider-model", effort: "low" } })!;
    expect(result.data.antigravity).toEqual({ model: "future-provider-model", effort: "low" });
    expect(result.data.builtinRuntimeDefaults.antigravity).toEqual({ model: "user", effort: "user" });
    expect(applyRuntimeDefaults(result.data)!.changed).toBe(false);
  });

  it("updates only seeded Antigravity values while preserving user fields", () => {
    const raw = zSetting.parse({ ...base, antigravity: { model: "old-seeded", effort: "low" },
      builtinRuntimeDefaults: { ...BUILTIN_RUNTIME_DEFAULTS,
        antigravity: { model: "seeded", effort: "user" } } });
    expect(applyRuntimeDefaults(raw)!.data.antigravity)
      .toEqual({ model: "gemini-3.8-flash-high", effort: "low" });
  });

  it("marks parent and phase edits as user without changing other runtime markers", () => {
    const before = applyRuntimeDefaults(undefined)!.data;
    const next = structuredClone(before);
    next.antigravity = { model: "future-parent", effort: "medium" };
    next.orchestration.feature.antigravity.Plan = { model: "pro", effort: null };
    const marker = markRuntimeDefaultsUserEdited(before, next);
    expect(marker.antigravity).toEqual({ model: "user", effort: "user" });
    expect(marker.orchestration["feature.antigravity.Plan.model"]).toBe("user");
    expect(marker.claude).toEqual(before.builtinRuntimeDefaults.claude);
    expect(marker.codex).toEqual(before.builtinRuntimeDefaults.codex);
    next.builtinRuntimeDefaults = marker;
    expect(applyRuntimeDefaults(next)!.data.antigravity).toEqual(next.antigravity);
    expect(applyRuntimeDefaults(next)!.data.orchestration.feature.antigravity.Plan)
      .toEqual({ model: "pro", effort: null });
  });

  it("infers ownership of native phase values added before their marker exists", () => {
    const { antigravity: _antigravity, ...oldMarker } = structuredClone(BUILTIN_RUNTIME_DEFAULTS);
    for (const key of Object.keys(oldMarker.orchestration)) {
      if (key.includes(".antigravity.")) delete oldMarker.orchestration[key];
    }
    const result = applyRuntimeDefaults({ ...base, builtinRuntimeDefaults: oldMarker,
      antigravity: { model: "future-parent", effort: "low" },
      orchestration: { feature: { antigravity: { Plan: { model: "pro", effort: null } } } },
    })!;
    expect(result.data.antigravity).toEqual({ model: "future-parent", effort: "low" });
    expect(result.data.builtinRuntimeDefaults.antigravity).toEqual({ model: "user", effort: "user" });
    expect(result.data.orchestration.feature.antigravity.Plan).toEqual({ model: "pro", effort: null });
    expect(result.data.builtinRuntimeDefaults.orchestration["feature.antigravity.Plan.model"]).toBe("user");
    expect(applyRuntimeDefaults(result.data)!.changed).toBe(false);
  });
});

describe("executeMode (amandemen ADR-0170 P2)", () => {
  const base = { autoDefault: true, autoScaffold: true, notifyFail: true };
  it("boot tidak menimpa pilihan subagent operator", () => {
    const r = applyRuntimeDefaults({ ...base, orchestration: { feature: { enabled: true, executeMode: "subagent", claude: {}, codex: {} } } });
    expect(r!.data.orchestration.feature.executeMode).toBe("subagent");
    expect(r!.data.orchestration.qa.executeMode).toBe("inline");
  });
  it("Setting lama tanpa field → inline di semua flow", () => {
    const r = applyRuntimeDefaults({ ...base, orchestration: { feature: { enabled: true, claude: {}, codex: {} } } });
    expect(r!.data.orchestration.feature.executeMode).toBe("inline");
  });
});
