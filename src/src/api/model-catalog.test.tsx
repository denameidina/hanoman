import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  bundledModelCatalog, codexEfforts, coerceCodexEffort, effortsForRuntimeModel,
  modelsForRuntime, replaceModelCatalog, MODELS, CODEX_MODELS,
} from "@hanoman/shared";
import { installModelCatalog } from "./model-catalog-state";
import { useModelCatalog } from "./model-catalog";
import { runtimeModels, runtimeEfforts } from "../screens/session-runtime";

vi.mock("./events", () => ({ subscribe: () => () => {} }));
const originalClaude = MODELS, originalCodex = CODEX_MODELS;
afterEach(() => { replaceModelCatalog(originalClaude, originalCodex); vi.unstubAllGlobals(); });
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
