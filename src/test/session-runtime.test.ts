import { describe, it, expect } from "vitest";
import { runtimeModels, runtimeEfforts, runtimeFor } from "../src/screens/session-runtime";

// SPEC-517 · satu definisi untuk dua picker (Start backlog & Sesi baru terminal). "Satu definisi,
// N call site" adalah kelas bug yang sudah dibayar hanoman di SPEC-431/448/475/481.
describe("session-runtime", () => {
  it("katalog model mengikuti agen", () => {
    expect(runtimeModels("claude").map((m) => m.id)).toContain("claude-opus-5");
    expect(runtimeModels("codex").map((m) => m.id)).toContain("gpt-5.6-luna");
    expect(runtimeModels("codex").map((m) => m.id)).not.toContain("claude-opus-5");
  });

  it("effort claude tak bergantung model", () => {
    expect(runtimeEfforts("claude", "claude-opus-5")).toContain("ultracode");
  });

  it("effort codex menyempit per model — Luna tanpa ultra", () => {
    expect(runtimeEfforts("codex", "gpt-5.6-sol")).toEqual(
      ["ultra", "max", "xhigh", "high", "medium", "low"]);
    expect(runtimeEfforts("codex", "gpt-5.6-luna")).toEqual(
      ["max", "xhigh", "high", "medium", "low"]);
  });

  it("runtimeFor mengambil blok agen terpilih", () => {
    const defs = {
      claude: { model: "claude-opus-5", effort: "xhigh" },
      codex: { model: "gpt-5.6-terra", effort: "low" },
    };
    expect(runtimeFor(defs, "claude")).toEqual({ model: "claude-opus-5", effort: "xhigh" });
    expect(runtimeFor(defs, "codex")).toEqual({ model: "gpt-5.6-terra", effort: "low" });
  });

  it("runtimeFor mengoreksi effort codex yang tak didukung modelnya", () => {
    const defs = {
      claude: { model: "claude-opus-5", effort: "xhigh" },
      codex: { model: "gpt-5.6-luna", effort: "ultra" },
    };
    expect(runtimeFor(defs, "codex")).toEqual({ model: "gpt-5.6-luna", effort: "xhigh" });
  });
});
