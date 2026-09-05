import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "@hanoman/shared";
import { renderAgentsJson, type AgentDef } from "../src/custom-agents";
import { materializeCodexAgents } from "../src/codex-agent-config";

const names = ["product-designer", "feature-builder", "performance-engineer", "product-analyst",
  "solution-architect", "operations-engineer", "support-triager", "knowledge-maintainer"];
const readOnlyNames = ["product-analyst", "solution-architect", "support-triager"];
const definitions = (runtime: "claude" | "codex"): AgentDef[] => BUILTIN_AGENTS
  .filter((a) => names.includes(a.name))
  .map((a) => ({ ...a, tools: [...a.tools], model: a.models[runtime], mentions: [] }));

describe("app/support builtin native configuration (not a behavioral benchmark)", () => {
  it("renders all eight Claude leaves with five native worktrees and bounded read-only tools", () => {
    const defs = definitions("claude");
    expect(defs).toHaveLength(8);
    const rendered = JSON.parse(renderAgentsJson(defs, { readOnlyHookCommand: "node /tmp/read-only.cjs" }));
    expect(Object.keys(rendered)).toEqual(names);
    for (const def of defs) {
      const role = rendered[def.name];
      expect(role.model).toBe("sonnet");
      expect(role.effort).toBe(def.effort);
      expect(role.tools).not.toContain("Task");
      expect(role.prompt).toContain(`Policy efektif: ${def.workspacePolicy}`);
      expect(role.prompt).toContain("TIDAK boleh mendelegasikan");
      if (readOnlyNames.includes(def.name)) {
        expect(role.isolation).toBeUndefined();
        expect(role.permissionMode).toBe("plan");
        expect(role.maxTurns).toBe(30);
        expect(role.tools).toEqual(["Read", "Glob", "Grep", "WebFetch", "WebSearch"]);
        expect(role.hooks.PreToolUse[0].hooks[0].command).toBe("node /tmp/read-only.cjs");
      } else {
        expect(role.isolation).toBe("worktree");
        expect(role.maxTurns).toBe(40);
        expect(role.tools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "Bash", "Write", "Edit"]));
      }
    }
  });

  it("materializes only three Codex read-only roles and reports five unsupported worktrees", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-app-agent-test-"));
    try {
      const result = materializeCodexAgents(definitions("codex"), dir, {
        clientVersion: "0.151.0", readOnlyHookCommand: "node /tmp/read-only.cjs",
      });
      expect(result.liveDefs.map((a) => a.name)).toEqual(readOnlyNames);
      expect(result.configPaths).toHaveLength(3);
      expect(readdirSync(dir)).toHaveLength(3);
      expect(result.warnings.map((w) => w.agentName)).toEqual(names.filter((name) => !readOnlyNames.includes(name)));
      expect(result.warnings.every((w) => w.reason.includes("isolated-worktree"))).toBe(true);
      for (const [i, path] of result.configPaths.entries()) {
        const role = result.liveDefs[i]!;
        const content = readFileSync(path, "utf8");
        expect(content).toContain(`name = "${role.name}"`);
        expect(content).toContain('model = "gpt-5.6-terra"');
        expect(content).toContain(`model_reasoning_effort = "${role.effort}"`);
        expect(content).toContain('sandbox_mode = "read-only"');
        expect(content).toContain("[[hooks.PreToolUse.hooks]]");
        expect(content).toContain('command = "node /tmp/read-only.cjs"');
        expect(content).toContain("30 turn adalah batas instruksional");
        expect(content).toContain("TIDAK boleh mendelegasikan");
        expect(result.args).toContain(`agents."${role.name}".config_file=${JSON.stringify(path)}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
