import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  bundledModelCatalog, codexEfforts, coerceCodexEffort, effortsForRuntimeModel,
  modelsForRuntime, replaceModelCatalog, MODELS, CODEX_MODELS, ANTIGRAVITY_MODELS, antigravityEfforts, modelSelectOptions,
} from "@hanoman/shared";
import { installModelCatalog } from "./model-catalog-state";
import { useModelCatalog } from "./model-catalog";
import { runtimeModels, runtimeEfforts } from "../screens/session-runtime";

vi.mock("./events", () => ({ subscribe: () => () => {} }));
const originalClaude = MODELS, originalCodex = CODEX_MODELS, originalAntigravity = ANTIGRAVITY_MODELS;
afterEach(() => { replaceModelCatalog(originalClaude, originalCodex, originalAntigravity); vi.unstubAllGlobals(); });
describe("live model catalog", () => {
  it("updates mounted pickers and all effort consumers without rebuilding or remounting", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    function Picker() {
      useModelCatalog();
      return <select aria-label="models">{runtimeModels("codex").map((m) =>
        <option key={m.id}>{m.id}</option>)}</select>;
    }
    render(<Picker />);
    const catalog = bundledModelCatalog();
    catalog.codex = [{ id: "gpt-future", label: "Future", efforts: ["new-effort"],
      fallback: "new-effort", minClient: "" }];
    catalog.claude = [{ id: "claude-future", label: "Future", efforts: ["low"] }];
    act(() => installModelCatalog(catalog));
    expect(screen.getByRole("option", { name: "gpt-future" })).toBeTruthy();
    expect(modelsForRuntime("codex").map((m) => m.id)).toContain("gpt-future");
    expect(codexEfforts("gpt-future")).toEqual(["new-effort"]);
    expect(coerceCodexEffort("gpt-future", "high")).toBe("new-effort");
    expect(effortsForRuntimeModel("codex", "gpt-future")).toEqual(["new-effort"]);
    expect(runtimeEfforts("claude", "claude-future")).toEqual(["low"]);
  });
});

describe("Antigravity live catalog", () => {
  it("updates a mounted picker while preserving unknown stored models and native child tiers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    function Picker() {
      useModelCatalog();
      return <select aria-label="antigravity-models">{modelSelectOptions(ANTIGRAVITY_MODELS, "stored-unknown").map((m) =>
        <option key={m.value}>{m.value}</option>)}</select>;
    }
    render(<Picker />);
    const catalog = bundledModelCatalog();
    catalog.antigravity = [{ id: "future-low", label: "Future", efforts: ["low"] }];
    act(() => installModelCatalog(catalog));
    expect(screen.getByRole("option", { name: "future-low" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "stored-unknown" })).toBeTruthy();
    expect(antigravityEfforts("future-low")).toEqual(["low"]);
    expect(modelsForRuntime("antigravity").map((m) => m.id)).toEqual(["inherit", "flash", "pro"]);
    const { antigravity: unused, ...legacy } = bundledModelCatalog();
    const { antigravity: unusedStatus, ...providers } = legacy.providers;
    act(() => installModelCatalog({ ...legacy, providers }));
    expect(screen.getByRole("option", { name: "gemini-3.8-flash-high" })).toBeTruthy();
  });
  it("does not overwrite a fresh WS snapshot with an older HTTP response", async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal("fetch", () => new Promise((resolve) => { finish = resolve; }));
    function Picker() { const models = useModelCatalog(); return <span>{models.antigravity[0]?.id}</span>; }
    render(<Picker />);
    await act(async () => { await Promise.resolve(); });
    const fresh = bundledModelCatalog();
    fresh.antigravity = [{ id: "ws-new-high", label: "New", efforts: ["high"] }];
    act(() => installModelCatalog(fresh));
    await act(async () => { finish({ ok: true, json: async () => bundledModelCatalog() }); });
    expect(screen.getByText("ws-new-high")).toBeTruthy();
  });
});
