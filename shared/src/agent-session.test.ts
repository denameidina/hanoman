import { describe, it, expect } from "vitest";
import { zAgent, zCodex, CODEX_DEFAULTS, CODEX_MODELS, CODEX_EFFORTS, zSetting } from "./entities";
import { zTerminalSession } from "./dto";

describe("SPEC-338 · agent sesi", () => {
  it.each([
    { project: "p1", flow: "reverse" },
    { project: "p1", flow: "scaffold" },
    { project: "p1", flow: "prd", brief: { title: "T", context: "c", outcome: "o" } },
    { project: "p1", flow: "breakdown", prdPath: "docs/prd/a.md" },
  ])("SPEC-1108 · preserves explicit human force in $flow and rejects invalid force", (input) => {
    expect(zTerminalSession.parse({ ...input, force: true })).toMatchObject({ force: true });
    expect(zTerminalSession.parse({ ...input, force: false })).toMatchObject({ force: false });
    expect(zTerminalSession.parse(input)).not.toHaveProperty("force");
    expect(zTerminalSession.safeParse({ ...input, force: "true" }).success).toBe(false);
  });

  it("zAgent hanya menerima claude|codex", () => {
    expect(zAgent.parse("claude")).toBe("claude");
    expect(zAgent.parse("codex")).toBe("codex");
    expect(zAgent.safeParse("gemini").success).toBe(false);
  });

  it("default codex = gpt-5.6-sol / xhigh", () => {
    expect(CODEX_DEFAULTS).toEqual({ model: "gpt-5.6-sol", effort: "xhigh" });
    expect(zCodex.parse({})).toEqual(CODEX_DEFAULTS);
  });

  it("katalog codex memuat slug & effort yang didukung CLI", () => {
    expect(CODEX_MODELS.map((m) => m.id)).toContain("gpt-5.6-sol");
    // SPEC-339 · CODEX_EFFORTS kini GABUNGAN semua effort; pilihan per model ada di codexEfforts().
    expect(CODEX_EFFORTS).toEqual(["ultra", "max", "xhigh", "high", "medium", "low"]);
  });

  // Baris Setting lama (tanpa blok codex/agent) HARUS tetap parse — tanpa migration.
  it("Setting lama tetap parse dengan default claude", () => {
    const old = {
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short",
      notifyDecision: true, notifyDecisionSound: "alert",
    };
    const parsed = zSetting.parse(old);
    expect(parsed.agent).toBe("claude");
    expect(parsed.codex).toEqual(CODEX_DEFAULTS);
  });

  it("POST /terminal/sessions varian spec menerima agent opsional", () => {
    // `agent` opsional: saat tak dikirim, zod tak memasang kuncinya sama sekali — server yang
    // jatuh ke Setting.agent. Dibaca lewat cast karena union-nya luas (varian project-level).
    const agentOf = (b: unknown): string | undefined => {
      const r = zTerminalSession.safeParse(b);
      if (!r.success) throw new Error("tak valid");
      return (r.data as { agent?: string }).agent;
    };
    expect(agentOf({ spec: "SPEC-338", flow: "feature", agent: "codex" })).toBe("codex");
    expect(agentOf({ spec: "SPEC-338", flow: "feature" })).toBe(undefined);
    expect(zTerminalSession.safeParse({ spec: "S", flow: "feature", agent: "gemini" }).success).toBe(false);
  });
});
