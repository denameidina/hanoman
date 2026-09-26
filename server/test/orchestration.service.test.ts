import { describe, it, expect, afterEach } from "vitest";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { sessionPhasePlan } from "../src/services/orchestration";
import { registerCodexNativeAgentSupport } from "../src/services/pty";
import { DEFAULT_SETTING } from "../src/services/settings";

afterEach(() => registerCodexNativeAgentSupport(() => ({ version: "0.151.0", ok: true })));

describe("sessionPhasePlan (ADR-0164)", () => {
  const orchestrator = { model: "claude-opus-5", effort: "high" };
  it("claude + flow aktif → rencana", () => {
    expect(sessionPhasePlan(DEFAULT_SETTING, "feature", "claude", orchestrator)?.phases).toHaveLength(5);
  });
  it("flow mati → null", () => {
    const setting = { ...DEFAULT_SETTING,
      orchestration: { ...ORCHESTRATION_DEFAULTS, qa: { enabled: false, executeMode: "inline" as const, claude: {}, codex: {} } } };
    expect(sessionPhasePlan(setting, "qa", "claude", orchestrator)).toBeNull();
  });
  it("codex tanpa dukungan agen native → null", () => {
    registerCodexNativeAgentSupport(() => ({ version: "0.150.0", ok: false }));
    expect(sessionPhasePlan(DEFAULT_SETTING, "feature", "codex", { model: "gpt-5.6-sol", effort: "high" })).toBeNull();
  });
});
