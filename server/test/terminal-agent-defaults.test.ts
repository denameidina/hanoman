import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { terminalAgentDefaults, sessionAgentDefaults } from "../src/services/settings";
import { resetDb, makeSetting } from "./factory";

// SPEC-517 · terminal agen biasa boleh memilih runtime per sesi. Tanpa override ia HARUS
// identik dengan sessionAgentDefaults() — itulah jaminan "perilaku hari ini utuh".
beforeAll(async () => { await resetDb(); });
afterAll(async () => { await resetDb(); });

describe("terminalAgentDefaults", () => {
  it("tanpa override → identik dengan default global claude", async () => {
    await makeSetting({ agent: "claude", model: "claude-sonnet-5", effort: "medium" });
    expect(await terminalAgentDefaults({})).toEqual(await sessionAgentDefaults());
    expect(await terminalAgentDefaults({}))
      .toEqual({ agent: "claude", model: "claude-sonnet-5", effort: "medium" });
  });

  it("tanpa override → identik dengan default global codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    expect(await terminalAgentDefaults({}))
      .toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  // Inti SPEC-377: model WAJIB datang dari blok agen terpilih, bukan blok agen sebelumnya.
  it("override agen saja → model & effort dari blok agen ITU", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh",
      codex: { model: "gpt-5.6-terra", effort: "low" } });
    expect(await terminalAgentDefaults({ agent: "codex" }))
      .toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "low" });
  });

  it("override agen + model + effort dipakai apa adanya", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    expect(await terminalAgentDefaults({ agent: "codex", model: "gpt-5.6-sol", effort: "ultra" }))
      .toEqual({ agent: "codex", model: "gpt-5.6-sol", effort: "ultra" });
  });

  it("override model saja → agen tetap default global", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    expect(await terminalAgentDefaults({ model: "claude-haiku-4-5" }))
      .toEqual({ agent: "claude", model: "claude-haiku-4-5", effort: "xhigh" });
  });

  // SPEC-339 · Luna tak mendukung `ultra`. Koersi di sini supaya picker & argv tak berselisih.
  it("effort codex yang tak didukung model diturunkan ke fallback", async () => {
    await makeSetting({ agent: "claude" });
    expect(await terminalAgentDefaults({ agent: "codex", model: "gpt-5.6-luna", effort: "ultra" }))
      .toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });

  it("override claude tidak dikoersi katalog codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-sol", effort: "ultra" } });
    expect(await terminalAgentDefaults({ agent: "claude", model: "claude-fable-5", effort: "ultracode" }))
      .toEqual({ agent: "claude", model: "claude-fable-5", effort: "ultracode" });
  });

  it("Antigravity selection and overrides never take the Claude/Codex parent block", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh",
      antigravity: { model: "gemini-3.8-flash-high", effort: "high" } });
    expect(await terminalAgentDefaults({ agent: "antigravity" }))
      .toEqual({ agent: "antigravity", model: "gemini-3.8-flash-high", effort: "high" });
    expect(await terminalAgentDefaults({ agent: "antigravity", model: "future-model", effort: "low" }))
      .toEqual({ agent: "antigravity", model: "future-model", effort: "low" });
    await makeSetting({ agent: "antigravity", antigravity: { model: "custom-parent", effort: "medium" } });
    expect(await terminalAgentDefaults({})).toEqual(await sessionAgentDefaults());
    expect(await terminalAgentDefaults({})).toEqual({ agent: "antigravity", model: "custom-parent", effort: "medium" });
  });
});
