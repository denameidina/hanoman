import { describe, it, expect, afterEach } from "vitest";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { sessionPhasePlan } from "../src/services/orchestration";
import { registerCodexNativeAgentSupport } from "../src/services/pty";
import { DEFAULT_SETTING } from "../src/services/settings";

afterEach(() => registerCodexNativeAgentSupport(() => ({ version: "0.151.0", ok: true })));

describe("sessionPhasePlan (ADR-0164)", () => {
  const orchestrator = { model: "claude-opus-5", effort: "high" };
  it("claude + flow aktif → rencana", () => {
    // ADR-0230 · feature = 5 fase + Review. ADR-0233 · + Mockup = 7.
    expect(sessionPhasePlan(DEFAULT_SETTING, "feature", "claude", orchestrator)?.phases).toHaveLength(7);
  });
  it("flow mati → null", () => {
    const setting = { ...DEFAULT_SETTING,
      orchestration: { ...ORCHESTRATION_DEFAULTS, qa: { enabled: false, executeMode: "inline" as const, claude: {}, codex: {}, antigravity: {} } } };
    expect(sessionPhasePlan(setting, "qa", "claude", orchestrator)).toBeNull();
  });
  it("codex tanpa dukungan agen native → null", () => {
    registerCodexNativeAgentSupport(() => ({ version: "0.150.0", ok: false }));
    expect(sessionPhasePlan(DEFAULT_SETTING, "feature", "codex", { model: "gpt-5.6-sol", effort: "high" })).toBeNull();
  });
});


it("Antigravity session phases never inherit parent model or effort", () => {
  const plan = sessionPhasePlan(DEFAULT_SETTING, "feature", "antigravity", { model: "gemini-3.8-flash-high", effort: "high" }, { Plan: { model: "pro", effort: null } })!;
  expect(plan.phases.find(p => p.phase === "Plan")).toMatchObject({ model: "pro", effort: null });
  expect(plan.phases[0]).toMatchObject({ model: "inherit", effort: null });
  expect(plan.phases.find(p => p.phase === "Review")).toMatchObject({ model: "inherit", effort: null });
});
it.each([{ model: "gemini-3.8-flash-high", effort: null }, { model: "flash", effort: "high" }])("rejects invalid native overrides before a session can be spawned: %j", cell => {
  expect(() => sessionPhasePlan(DEFAULT_SETTING, "feature", "antigravity", { model: "gemini-3.8-flash-high", effort: "high" }, { Plan: cell })).toThrow(/tier native/);
});
