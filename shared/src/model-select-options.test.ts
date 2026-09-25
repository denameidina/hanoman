import { afterEach, describe, it, expect } from "vitest";
import {
  CODEX_MODELS, EFFORTS, MODELS, claudeEfforts, claudeSubagentEfforts, claudeModel, coerceClaudeEffort, modelSelectOptions,
  replaceModelCatalog, subagentClaudeModels,
} from "./entities";
import { effortsForRuntimeModel, modelsForRuntime } from "./agent-catalog";

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

  // Audit P1-12 · katalog CLI mencatat Haiku 4.5 tanpa `supportedEffortLevels`: effort no-op di sana.
  // Hanya definisi SUBAGENT yang ketat; picker UI tetap menawarkan EFFORTS (perilaku lama).
  it("subagent: model dikenal tanpa efforts → [] ; model tak dikenal → EFFORTS penuh", () => {
    replaceModelCatalog([...discovered, { id: "haiku", label: "Haiku 4.5", resolved: "claude-haiku-4-5" }], CODEX_MODELS);
    expect(claudeSubagentEfforts("haiku")).toEqual([]);
    expect(claudeSubagentEfforts("claude-haiku-4-5")).toEqual([]);
    expect(claudeSubagentEfforts("model-kustom-x")).toEqual(EFFORTS);
    expect(claudeEfforts("haiku")).toEqual(EFFORTS);
  });

  it("fallback offline: alias keluarga menawarkan EFFORTS penuh; haiku ketat hanya untuk subagent", () => {
    expect(claudeSubagentEfforts("sonnet")).toEqual(EFFORTS);
    expect(claudeSubagentEfforts("opus")).toEqual(EFFORTS);
    expect(claudeSubagentEfforts("haiku")).toEqual([]);
    expect(claudeEfforts("haiku")).toEqual(EFFORTS);
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
