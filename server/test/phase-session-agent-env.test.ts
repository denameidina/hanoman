import { describe, expect, it } from "vitest";
import { phaseSessionAgentEnv, SUBAGENT_CONCURRENCY_CAP } from "../src/services/pty";

// ADR-0170 · subagent foreground hanya untuk sesi claude ber-fase (backlog/project). Terminal agen
// biasa (tanpa berkas fase) dan codex (mekanisme sendiri, ADR-0164 P5) tak berubah.
describe("phaseSessionAgentEnv", () => {
  it("sesi claude ber-fase: subagent foreground + batas konkurensi", () => {
    expect(phaseSessionAgentEnv("claude", "/tmp/x/phases")).toEqual({
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
      CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(SUBAGENT_CONCURRENCY_CAP),
    });
  });

  it("terminal claude tanpa berkas fase tak disentuh", () => {
    expect(phaseSessionAgentEnv("claude")).toEqual({});
  });

  it("codex tak disentuh", () => {
    expect(phaseSessionAgentEnv("codex", "/tmp/x/phases")).toEqual({});
  });
});
