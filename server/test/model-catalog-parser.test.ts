import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAntigravityModels, parseCachedCatalog, parseClaudeModels, parseCodexModels } from "../src/services/model-catalog-parser";

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
  // Bentuk nyata `initialize` claude 2.1.280 (2026-09-23), dipangkas.
  it("keeps native aliases as ids, puts `default` first, one row per resolved model", () => {
    const models = parseClaudeModels([
      { value: "default", resolvedModel: "claude-opus-5-5[1m]", displayName: "Default (recommended)",
        description: "Opus 5.5 with 1M context · Best for everyday", supportedEffortLevels: ["low", "max"] },
      { value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]", displayName: "Opus (1M context)",
        description: "Opus 5.5 with 1M context · Best for everyday", supportedEffortLevels: ["low", "max"] },
      { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet",
        description: "Sonnet 5 · Efficient" },
      { value: "claude-sonnet-5", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5" },
      { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku" },
    ]);
    expect(models).toEqual([
      { id: "default", label: "Default (recommended) · Opus 5.5 with 1M context",
        resolved: "claude-opus-5-5[1m]", efforts: ["max", "low"] },
      { id: "opus[1m]", label: "Opus 5.5 with 1M context", resolved: "claude-opus-5-5[1m]", efforts: ["max", "low"] },
      { id: "sonnet", label: "Sonnet 5", resolved: "claude-sonnet-5" },
      { id: "haiku", label: "Haiku", resolved: "claude-haiku-4-5-20251001" },
    ]);
  });
  // Bentuk nyata `initialize` claude 2.1.282 (2026-09-25): hanya baris `default` yang punya
  // "<Model> · <tagline>"; baris lain cuma tagline polos tanpa nama model. SPEC: label non-default
  // tak boleh jatuh ke tagline murni saat description tak mengandung " · ".
  it("falls back to displayName when a non-default row's description has no model-name prefix", () => {
    const models = parseClaudeModels([
      { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)",
        description: "Opus 5.5 · Best for everyday, complex tasks", supportedEffortLevels: ["low", "max"] },
      { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5",
        description: "Most capable for ambitious work", supportedEffortLevels: ["low", "max"] },
      { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5",
        description: "Most efficient for everyday tasks", supportedEffortLevels: ["low", "max"] },
      { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5",
        description: "Fastest for quick answers" },
    ]);
    expect(models).toEqual([
      { id: "default", label: "Default (recommended) · Opus 5.5",
        resolved: "claude-opus-5-5", efforts: ["max", "low"] },
      { id: "opus", label: "Opus 5.5", resolved: "claude-opus-5-5", efforts: ["max", "low"] },
      { id: "sonnet", label: "Sonnet 5", resolved: "claude-sonnet-5", efforts: ["max", "low"] },
      { id: "haiku", label: "Haiku 4.5", resolved: "claude-haiku-4-5-20251001" },
    ]);
  });
  it("prefers the alias row even when the pinned row comes first", () => {
    const models = parseClaudeModels([
      { value: "claude-sonnet-5", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5" },
      { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet" },
    ]);
    expect(models.map((m) => m.id)).toEqual(["sonnet"]);
  });
  it("rejects empty, malformed or unbounded catalogs rather than erasing last-good models", () => {
    expect(() => parseCodexModels({ models: [] })).toThrow();
    expect(() => parseClaudeModels([{ value: "bad\nmodel" }])).toThrow();
    expect(() => parseCodexModels({ models: [{ slug: "gpt-x", visibility: "list" }] })).toThrow();
  });
});

// `agy models` 1.3.4, host 2026-10-14: tab-separated stdout, fetch notice on stderr.
describe("Antigravity parent model parser", () => {
  it("normalizes only slug/label and conservative suffix effort from installed CLI output", () => {
    expect(parseAntigravityModels("gemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\nfuture-preview\tFuture Preview\n"))
      .toEqual([
        { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", efforts: ["high"] },
        { id: "claude-opus-5-5-low", label: "Claude Opus 5.5 (Low)", efforts: ["low"] },
        { id: "future-preview", label: "Future Preview", efforts: [] },
      ]);
  });
  it("parses all ten rows captured from the installed agy 1.3.4 non-inference command", () => {
    const raw = readFileSync(new URL("./fixtures/antigravity-models-1.3.4.tsv", import.meta.url), "utf8");
    const models = parseAntigravityModels(raw);
    expect(models).toHaveLength(10);
    expect(models[0]).toEqual({ id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", efforts: ["high"] });
    expect(models[9]).toEqual({ id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)", efforts: ["medium"] });
  });
  it("rejects empty, malformed, excessive or injection-shaped rows", () => {
    for (const raw of ["", "Fetching available models...", "bad slug\tLabel", "future\t", "future\tLabel\tsecret", [], "a\t" + "x".repeat(301), "a\tA\n".repeat(501)])
      expect(() => parseAntigravityModels(raw)).toThrow();
    expect(parseAntigravityModels("future-high\tFuture\nfuture-high\tFuture\n")).toHaveLength(1);
  });
  it("loads pre-Antigravity caches with bundled defaults and strips secrets/unknown effort", async () => {
    const { bundledModelCatalog } = await import("@hanoman/shared");
    const old = bundledModelCatalog();
    const { antigravity: unused, ...legacy } = old;
    const { antigravity: unusedStatus, ...providers } = old.providers;
    expect(parseCachedCatalog({ ...legacy, providers }).antigravity[0]?.id).toBe("gemini-3.8-flash-high");
    const sanitized = parseCachedCatalog({ ...old, secret: "secret", antigravity: [{
      id: "future-high", label: "Future", efforts: ["max", "high"], token: "secret",
    }] });
    expect(sanitized.antigravity).toEqual([{ id: "future-high", label: "Future", efforts: ["high"] }]);
    expect(JSON.stringify(sanitized)).not.toContain("secret");
  });
});
