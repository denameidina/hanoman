import { describe, expect, it } from "vitest";
import { agentEnvironment } from "../src/agent-env";

describe("agentEnvironment", () => {
  const source = { GEMINI_API_KEY: "fixture-key", GOOGLE_GEMINI_BASE_URL: "https://fixture.invalid",
    GOOGLE_CLOUD_PROJECT: "project-kept", PATH: "/bin", EMPTY: "", CLAUDE_CODE_OAUTH_TOKEN: "claude-fixture", ANTHROPIC_API_KEY: "anthropic-fixture" };
  it.each(["claude", "codex", null] as const)("%s menghapus env Antigravity dan mempertahankan env unrelated", (agent) => {
    const result = agentEnvironment(agent, source);
    expect(Object.hasOwn(result, "GEMINI_API_KEY")).toBe(false);
    expect(Object.hasOwn(result, "GOOGLE_GEMINI_BASE_URL")).toBe(false);
    expect(result.GOOGLE_CLOUD_PROJECT === source.GOOGLE_CLOUD_PROJECT).toBe(true);
    expect(result.PATH).toBe("/bin");
    expect(result.EMPTY).toBe("");
    expect(Object.hasOwn(source, "GEMINI_API_KEY")).toBe(true);
    expect(result).not.toBe(source);
  });
  it.each(["parent", "lead", "probe"])("Antigravity %s mempertahankan supplied env pada clone", () => {
    const result = agentEnvironment("antigravity", source);
    expect(result.GEMINI_API_KEY === source.GEMINI_API_KEY).toBe(true);
    expect(result.GOOGLE_GEMINI_BASE_URL === source.GOOGLE_GEMINI_BASE_URL).toBe(true);
    expect(Object.hasOwn(result, "CLAUDE_CODE_OAUTH_TOKEN")).toBe(false);
    expect(Object.hasOwn(result, "ANTHROPIC_API_KEY")).toBe(false);
    expect(result).not.toBe(source);
    expect(agentEnvironment("antigravity", {}).GEMINI_API_KEY).toBeUndefined();
  });
});
