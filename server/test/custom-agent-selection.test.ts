import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS, customAgentId } from "@hanoman/shared";
import {
  collectChangedFiles, selectAgentRows, type AgentSelectionContext, type CustomAgentRow,
} from "../src/services/custom-agents";

const context = (overrides: Partial<AgentSelectionContext> = {}): AgentSelectionContext => ({
  projectId: "p1", runtime: "claude", cwd: "/repo", prompt: "kerjakan perubahan",
  changedFiles: [], ...overrides,
});

const builtin = (name: string, overrides: Partial<CustomAgentRow> = {}): CustomAgentRow => {
  const source = BUILTIN_AGENTS.find((agent) => agent.name === name)!;
  return {
    id: customAgentId(null, name), projectId: null, name,
    description: source.description, instructions: source.instructions, tools: [...source.tools],
    model: null, mentions: [], runtime: null, enabled: true,
    activation: source.activation, effort: source.effort,
    workspacePolicy: source.workspacePolicy, maxTurns: source.maxTurns,
    timeoutSeconds: source.timeoutSeconds, ...overrides,
  };
};

describe("selectAgentRows", () => {
  it("keeps an enabled custom agent with activation always", () => {
    const row = builtin("scout", {
      id: "p1:my-scout", projectId: "p1", name: "my-scout", activation: "always",
    });
    expect(selectAgentRows([row], context()).map((agent) => agent.name)).toEqual(["my-scout"]);
  });

  it("never selects a disabled agent", () => {
    expect(selectAgentRows([builtin("scout", { enabled: false })], context({ flow: "feature" })))
      .toEqual([]);
  });

  it.each([
    ["qa-verifier", { flow: "feature" }],
    ["dep-auditor", { flow: "feature" }],
    ["security-reviewer", { flow: "goal" }],
    ["security-reviewer", { flow: "no_effort" }],
    ["spec-auditor", { flow: "audit" }],
  ] as const)("keeps enabled %s in the lifetime registry", (name, overrides) => {
    expect(selectAgentRows([builtin(name)], context(overrides)).map((agent) => agent.name))
      .toEqual([name]);
  });

  it("keeps smart agents available when the birth diff does not match their trigger", () => {
    expect(selectAgentRows([
      builtin("scout"), builtin("root-causer"), builtin("blast-radius"),
    ], context({ flow: "goal", changedFiles: [] })).map((agent) => agent.name))
      .toEqual(["scout", "root-causer", "blast-radius"]);
  });

  it("still excludes a runtime-incompatible agent", () => {
    expect(selectAgentRows([
      builtin("scout", { runtime: "claude" }),
    ], context({ runtime: "codex" }))).toEqual([]);
  });

  it("still excludes isolated-worktree agents from Codex", () => {
    expect(selectAgentRows([
      builtin("edge-case-hunter"),
    ], context({ runtime: "codex" }))).toEqual([]);
  });
});

describe("collectChangedFiles", () => {
  it("fails open to an empty diff when git cannot be read", () => {
    const run = () => { throw new Error("not a repository"); };
    expect(collectChangedFiles("/missing", "abc123", run)).toEqual([]);
  });
});
