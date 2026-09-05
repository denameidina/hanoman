import { describe, expect, it } from "vitest";
import type { AgentDef } from "../src/custom-agents";
import { agentDefinitionHash } from "../src/agent-definition";

const def: AgentDef = {
  name: "reader", description: "Find evidence", instructions: "Read the contract",
  tools: ["Read"], model: null, mentions: [], workspacePolicy: "read-only",
};

describe("executed agent definition identity", () => {
  it("changes for executable prompt, model, policy and runtime but not database identity", () => {
    const baseline = agentDefinitionHash(def, [def], "claude");
    expect(agentDefinitionHash({ ...def, id: "another:reader" }, [def], "claude")).toBe(baseline);
    for (const changed of [
      { ...def, instructions: "Read another contract" },
      { ...def, model: "sonnet" },
      { ...def, maxTurns: 10 },
      { ...def, activation: "smart" as const },
      { ...def, workspacePolicy: "inherit" as const },
    ]) expect(agentDefinitionHash(changed, [changed], "claude")).not.toBe(baseline);
    expect(agentDefinitionHash(def, [def], "codex")).not.toBe(baseline);
  });
  it("ignores tools that the native renderer cannot apply", () => {
    const extraWrite = { ...def, tools: ["Read", "Write"] };
    expect(agentDefinitionHash(extraWrite, [extraWrite], "claude"))
      .toBe(agentDefinitionHash(def, [def], "claude"));
    const changedTools = { ...def, tools: ["Bash"] };
    expect(agentDefinitionHash(changedTools, [changedTools], "codex"))
      .toBe(agentDefinitionHash(def, [def], "codex"));
    expect(agentDefinitionHash(changedTools, [changedTools], "claude"))
      .not.toBe(agentDefinitionHash(def, [def], "claude"));
  });
  it("separates inherited session profiles but ignores inheritance overridden by the child", () => {
    expect(agentDefinitionHash(def, [def], "claude", { model: "sonnet" }))
      .not.toBe(agentDefinitionHash(def, [def], "claude", { model: "opus" }));
    const explicit = { ...def, model: "haiku", effort: "low" };
    expect(agentDefinitionHash(explicit, [explicit], "claude", { model: "sonnet", effort: "high" }))
      .toBe(agentDefinitionHash(explicit, [explicit], "claude", { model: "opus", effort: "medium" }));
  });
  it("identifies evaluation presentation instructions separately from the production definition", () => {
    const production = agentDefinitionHash(def, [def], "claude");
    expect(agentDefinitionHash(def, [def], "claude", { promptSuffix: "\nReturn one JSON envelope." }))
      .not.toBe(production);
    expect(agentDefinitionHash(def, [def], "claude", { promptSuffix: "" })).toBe(production);
  });
});
