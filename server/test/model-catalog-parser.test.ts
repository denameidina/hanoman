import { describe, expect, it } from "vitest";
import { parseClaudeModels, parseCodexModels } from "../src/services/model-catalog-parser";

describe("CLI model discovery", () => {
  it("discovers future Codex IDs and efforts without a code allowlist; hides internal models", () => {
    expect(parseCodexModels({ models: [
      { slug: "gpt-future", display_name: "Future", visibility: "list",
        supported_reasoning_levels: [{ effort: "new-effort" }, { effort: "low" }],
        default_reasoning_level: "new-effort", minimal_client_version: "1.2.3" },
      { slug: "internal", visibility: "hide" },
    ] })).toEqual([{ id: "gpt-future", label: "Future", efforts: ["low", "new-effort"],
      fallback: "new-effort", minClient: "1.2.3" }]);
  });
  it("resolves Claude aliases and uses returned model capabilities", () => {
    const models = parseClaudeModels([
      { value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable",
        description: "Fable 5.1 · Most capable", supportedEffortLevels: ["low", "max"] },
      { value: "default", resolvedModel: "claude-fable-5-1", displayName: "Default" },
    ]);
    expect(models.find((m) => m.id === "claude-fable-5-1")).toEqual({
      id: "claude-fable-5-1", label: "Fable 5.1", efforts: ["max", "low"],
    });
    expect(models.some((m) => m.id === "fable")).toBe(true);
  });
  it("rejects empty, malformed or unbounded catalogs rather than erasing last-good models", () => {
    expect(() => parseCodexModels({ models: [] })).toThrow();
    expect(() => parseClaudeModels([{ value: "bad\nmodel" }])).toThrow();
    expect(() => parseCodexModels({ models: [{ slug: "gpt-x", visibility: "list" }] })).toThrow();
  });
});
