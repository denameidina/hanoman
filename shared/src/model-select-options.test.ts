import { afterEach, describe, it, expect } from "vitest";
import {
  CODEX_MODELS, MODELS, claudeEfforts, claudeModel, coerceClaudeEffort, modelSelectOptions,
  replaceModelCatalog, subagentClaudeModels,
} from "./entities";
import { modelsForRuntime } from "./agent-catalog";

const catalog = [{ id: "a", label: "A" }, { id: "b", label: "B" }];

describe("modelSelectOptions", () => {
  it("hanya memetakan katalog apa adanya saat nilai tersimpan ada di dalamnya", () => {
    expect(modelSelectOptions(catalog, "a")).toEqual([
      { value: "a", label: "A" }, { value: "b", label: "B" },
    ]);
  });

  it("menambahkan nilai tersimpan di depan saat sudah tak ada di katalog (model pensiun)", () => {
    expect(modelSelectOptions(catalog, "retired")).toEqual([
      { value: "retired", label: "retired" }, { value: "a", label: "A" }, { value: "b", label: "B" },
    ]);
  });

  it("nilai kosong (belum ada default) tak menambah opsi semu", () => {
    expect(modelSelectOptions(catalog, "")).toEqual([
      { value: "a", label: "A" }, { value: "b", label: "B" },
    ]);
  });
});

describe("alias native diutamakan", () => {
  const discovered = [
    { id: "default", label: "Default · Opus 5.5", resolved: "claude-opus-5-5", efforts: ["max", "low"] },
    { id: "sonnet", label: "Sonnet 5", resolved: "claude-sonnet-5", efforts: ["high", "low"] },
  ];
  const before = MODELS;
  afterEach(() => replaceModelCatalog(before, CODEX_MODELS));

  it("fallback offline hanya berisi alias native, `default` lebih dulu", () => {
    expect(MODELS.map((m) => m.id)).toEqual(["default", "opus", "sonnet", "haiku", "fable"]);
  });

  it("setelan lama ber-id terpatok tetap dapat metadata alias yang menunjuknya", () => {
    replaceModelCatalog(discovered, CODEX_MODELS);
    expect(claudeModel("claude-sonnet-5")?.id).toBe("sonnet");
    expect(claudeEfforts("claude-sonnet-5")).toEqual(["high", "low"]);
    expect(coerceClaudeEffort("claude-sonnet-5", "max")).toBe("high");
  });

  it("id terpatok yang ditunjuk alias diberi label jelas, bukan tampil sebagai duplikat", () => {
    expect(modelSelectOptions(discovered, "claude-sonnet-5")[0]).toEqual(
      { value: "claude-sonnet-5", label: "Sonnet 5 (terpatok: claude-sonnet-5)" });
  });

  it("picker subagent tak menawarkan `default` (hanya sah untuk --model sesi)", () => {
    replaceModelCatalog(discovered, CODEX_MODELS);
    expect(subagentClaudeModels().map((m) => m.id)).toEqual(["sonnet"]);
    expect(modelsForRuntime("claude").map((m) => m.id)).toEqual(["sonnet"]);
  });
});
