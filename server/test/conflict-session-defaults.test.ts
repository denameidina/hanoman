import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { conflictSessionDefaults, sessionAgentDefaults } from "../src/services/settings";
import { resetDb, makeSetting } from "./factory";

// SPEC-383 · ADR-0081 · sesi penyelesai konflik rebase/merge boleh punya default sendiri.
// Opt-in: selama `conflict.enabled` mati, ia HARUS identik dengan `sessionAgentDefaults()` —
// itulah jaminan "instalasi yang ada tak berubah perilakunya".
beforeAll(async () => { await resetDb(); });
afterAll(async () => { await resetDb(); });

describe("conflictSessionDefaults", () => {
  it("Antigravity inherits its own parent block or uses the explicit conflict block", async () => {
    await makeSetting({ agent: "antigravity", antigravity: { model: "custom-parent", effort: "high" } });
    expect(await conflictSessionDefaults()).toEqual({ agent: "antigravity", model: "custom-parent", effort: "high" });
    await makeSetting({ agent: "claude",
      conflict: { enabled: true, agent: "antigravity", model: "conflict-parent", effort: "low" } });
    expect(await conflictSessionDefaults()).toEqual({ agent: "antigravity", model: "conflict-parent", effort: "low" });
  });
  it("mati → mewarisi default global claude, sama persis dengan sessionAgentDefaults", async () => {
    await makeSetting({ agent: "claude", model: "claude-sonnet-5", effort: "medium",
      conflict: { enabled: false, agent: "codex", model: "gpt-5.6-terra", effort: "low" } });
    expect(await conflictSessionDefaults()).toEqual(await sessionAgentDefaults());
    expect(await conflictSessionDefaults())
      .toEqual({ agent: "claude", model: "claude-sonnet-5", effort: "medium" });
  });

  it("mati → mewarisi default global codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" },
      conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" } });
    expect(await conflictSessionDefaults())
      .toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  it("hidup → memakai bloknya sendiri, mengabaikan default global", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" },
      conflict: { enabled: true, agent: "claude", model: "claude-haiku-4-5", effort: "low" } });
    expect(await conflictSessionDefaults())
      .toEqual({ agent: "claude", model: "claude-haiku-4-5", effort: "low" });
  });

  it("hidup + agen codex → effort dikoersi ke yang didukung model itu", async () => {
    // Luna tak mendukung `ultra` (SPEC-339). Blok konflik harus lewat koersi yang sama dengan
    // blok codex global, kalau tidak sesi lahir dengan pasangan yang ditolak codex.
    await makeSetting({ agent: "claude",
      conflict: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "ultra" } });
    expect(await conflictSessionDefaults())
      .toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });

  it("baris Setting tanpa blok conflict (pra-SPEC-383) → mewarisi, tak melempar", async () => {
    const s = { model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, agent: "codex", codex: { model: "gpt-5.5", effort: "high" } };
    await makeSetting(s as never);
    expect(await conflictSessionDefaults())
      .toEqual({ agent: "codex", model: "gpt-5.5", effort: "high" });
  });
});
