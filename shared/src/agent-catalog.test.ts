import { describe, it, expect } from "vitest";
import {
  AGENT_RUNTIMES, ALL_TOOLS, ALL_TOOLS_ENTRY, BUILTIN_AGENT_TOOLS, mcpToolEntry,
  modelsForRuntime, expandTools, DEFAULT_AGENT_TOOLS, resolveTools, MENTION_TOOL,
  effortsForRuntimeModel, antigravityEfforts, AGENT_RUNTIME_LABELS,
} from "./index";

describe("AGENT_RUNTIMES", () => {
  it("tiga mesin sesi, urut claude → codex → antigravity", () => {
    expect(AGENT_RUNTIMES).toEqual(["claude", "codex", "antigravity"]);
  });
});

describe("BUILTIN_AGENT_TOOLS", () => {
  // ADR-0101 keputusan 3 · katalog bawaan PERSIS DEFAULT_AGENT_TOOLS, bukan daftar kedua.
  // Nama yang belum diukur DIBUANG claude senyap (ADR-0094 M4) — menawarkannya berarti
  // menawarkan pilihan yang tidak melakukan apa-apa.
  it("persis DEFAULT_AGENT_TOOLS, tanpa Task", () => {
    expect(BUILTIN_AGENT_TOOLS.map((t) => t.id)).toEqual([...DEFAULT_AGENT_TOOLS]);
    expect(BUILTIN_AGENT_TOOLS.map((t) => t.id)).not.toContain(MENTION_TOOL);
  });
});

describe("mcpToolEntry", () => {
  it("membentuk id 'semua tool dari satu server'", () => {
    expect(mcpToolEntry("context7")).toEqual({
      id: "mcp__context7__*", label: "context7 — semua tool", group: "mcp",
    });
  });
});

describe("modelsForRuntime", () => {
  it("claude → hanya MODELS", () => {
    const m = modelsForRuntime("claude");
    expect(m.map((x) => x.id)).toContain("opus");
    expect(m.every((x) => x.runtime === "claude")).toBe(true);
  });
  it("codex → hanya CODEX_MODELS", () => {
    const m = modelsForRuntime("codex");
    expect(m.map((x) => x.id)).toContain("gpt-5.6-sol");
    expect(m.every((x) => x.runtime === "codex")).toBe(true);
  });
  it("null (warisi) → GABUNGAN keduanya", () => {
    const ids = modelsForRuntime(null).map((x) => x.id);
    expect(ids).toContain("opus");
    expect(ids).toContain("gpt-5.6-sol");
  });
});

describe("effortsForRuntimeModel", () => {
  it("Claude memakai katalog effort Claude", () => {
    expect(effortsForRuntimeModel("claude", null)).toContain("ultracode");
    expect(effortsForRuntimeModel("claude", null)).not.toContain("ultra");
  });

  it("Codex mengikuti model terpilih", () => {
    expect(effortsForRuntimeModel("codex", "gpt-5.6-sol")).toContain("ultra");
    expect(effortsForRuntimeModel("codex", "gpt-5.6-luna")).not.toContain("ultra");
  });

  it("runtime dan model warisan hanya menawarkan irisan yang aman", () => {
    expect(effortsForRuntimeModel(null, null)).toEqual(["xhigh", "high", "medium", "low"]);
  });
});

describe("expandTools", () => {
  const catalog = ["Read", "Bash", "mcp__context7__*"];
  it("['*'] → seluruh id katalog", () => {
    expect(expandTools([ALL_TOOLS], catalog)).toEqual(catalog);
  });
  it("null tetap null (= pakai DEFAULT_AGENT_TOOLS)", () => {
    expect(expandTools(null, catalog)).toBeNull();
  });
  it("[] tetap [] (= sengaja tanpa tool)", () => {
    expect(expandTools([], catalog)).toEqual([]);
  });
  it("daftar eksplisit diteruskan apa adanya", () => {
    expect(expandTools(["Read"], catalog)).toEqual(["Read"]);
  });
  it("idempoten — hasil ekspansi tak memuat '*' lagi", () => {
    const once = expandTools([ALL_TOOLS], catalog)!;
    expect(expandTools(once, catalog)).toEqual(once);
    expect(once).not.toContain(ALL_TOOLS);
  });
  // GOTCHA ADR-0101: `*` TIDAK boleh diterjemahkan jadi `tools: null`. Agen tanpa `tools`
  // mewarisi SELURUH tool termasuk `Task`, dan lapis 2 anti-loop lenyap tanpa jejak.
  it("sesudah ekspansi, resolveTools TETAP mencabut Task untuk agen daun", () => {
    const tools = expandTools([ALL_TOOLS], [...catalog, MENTION_TOOL])!;
    expect(resolveTools({ tools, mentions: [] })).not.toContain(MENTION_TOOL);
    expect(resolveTools({ tools, mentions: ["lain"] })).toContain(MENTION_TOOL);
  });
});

describe("ALL_TOOLS_ENTRY", () => {
  it("pintasan ber-group sendiri supaya bisa ditaruh paling atas di UI", () => {
    expect(ALL_TOOLS_ENTRY.id).toBe(ALL_TOOLS);
    expect(ALL_TOOLS_ENTRY.group).toBe("shortcut");
  });
});


it("Antigravity child catalog contains tiers rather than parent models or effort", () => {
  expect(modelsForRuntime("antigravity").map((entry) => entry.id)).toEqual(["inherit", "flash", "pro"]);
  expect(effortsForRuntimeModel("antigravity", "flash")).toEqual([]);
});


it("Antigravity parent effort uses verified slug levels and preserves unknowns", () => {
  expect(AGENT_RUNTIME_LABELS.antigravity).toBe("Antigravity CLI");
  expect(antigravityEfforts("gemini-3.8-flash-high")).toEqual(["high"]);
  expect(antigravityEfforts("gemini-future-low")).toEqual(["low"]);
  expect(antigravityEfforts("future-unspecified")).toEqual([]);
});
