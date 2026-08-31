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
    ["scout", { flow: "feature" }],
    ["blast-radius", { flow: "feature" }],
    ["spec-auditor", { flow: "feature" }],
    ["root-causer", { flow: "audit" }],
  ] as const)("selects %s for its matching flow", (name, overrides) => {
    expect(selectAgentRows([builtin(name)], context(overrides)).map((agent) => agent.name))
      .toEqual([name]);
  });

  it("selects scout for a project session with no diff", () => {
    expect(selectAgentRows([builtin("scout")], context()).map((agent) => agent.name))
      .toEqual(["scout"]);
  });

  it("selects dep-auditor only for an opted-in manifest or lockfile diff", () => {
    const row = builtin("dep-auditor");
    expect(selectAgentRows([row], context({ changedFiles: ["src/a.ts"] }))).toEqual([]);
    expect(selectAgentRows([row], context({ changedFiles: ["pnpm-lock.yaml"] })))
      .toHaveLength(1);
  });

  it("selects security-reviewer only when an Execute/Audit flow touches external input", () => {
    const row = builtin("security-reviewer");
    expect(selectAgentRows([row], context({ flow: "feature", prompt: "ubah warna tombol" })))
      .toEqual([]);
    expect(selectAgentRows([row], context({ flow: "feature", prompt: "tambah route auth callback" })))
      .toHaveLength(1);
    expect(selectAgentRows([row], context({ flow: "audit", changedFiles: ["server/src/routes/x.ts"] })))
      .toHaveLength(1);
  });

  it("makes QA available only for eligible Claude Execute work", () => {
    const row = builtin("qa-verifier");
    const eligible = { flow: "feature" as const, changedFiles: ["server/src/a.ts"] };
    expect(selectAgentRows([row], context(eligible))).toHaveLength(1);
    expect(selectAgentRows([row], context({ ...eligible, runtime: "codex" }))).toEqual([]);
    expect(selectAgentRows([row], context({ flow: "audit", changedFiles: ["server/src/a.ts"] })))
      .toEqual([]);
  });

  it("selects edge-case-hunter only inside a Claude isolated worktree", () => {
    const isolated = builtin("edge-case-hunter");
    expect(selectAgentRows([isolated], context({ flow: "feature" }))).toHaveLength(1);
    expect(selectAgentRows([isolated], context({ flow: "feature", runtime: "codex" }))).toEqual([]);
    expect(selectAgentRows([
      { ...isolated, workspacePolicy: "read-only" },
    ], context({ flow: "feature" }))).toEqual([]);
  });
});

describe("collectChangedFiles", () => {
  it("fails open to an empty diff when git cannot be read", () => {
    const run = () => { throw new Error("not a repository"); };
    expect(collectChangedFiles("/missing", "abc123", run)).toEqual([]);
  });
});
