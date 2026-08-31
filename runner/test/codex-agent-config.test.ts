import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported,
  codexNativeVersionProbe, materializeCodexAgents, renderCodexAgentToml,
} from "../src/codex-agent-config";
import type { AgentDef } from "../src/custom-agents";

const def = (overrides: Partial<AgentDef> = {}): AgentDef => ({
  name: "scout", description: 'Cari "kode"', instructions: "baris 1\nbaris 2 \\",
  tools: ["Read", "Bash"], model: "gpt-5.6-terra", mentions: [],
  activation: "smart", effort: "low", workspacePolicy: "read-only",
  maxTurns: null, timeoutSeconds: null, ...overrides,
});

describe("renderCodexAgentToml", () => {
  it("encodes native role, model, effort, sandbox, and hook as valid TOML literals", () => {
    const out = renderCodexAgentToml(def(), [def()], { readOnlyHookCommand: "node '/tmp/a b.js'" });
    expect(out).toContain('name = "scout"');
    expect(out).toContain('model = "gpt-5.6-terra"');
    expect(out).toContain('model_reasoning_effort = "low"');
    expect(out).toContain('sandbox_mode = "read-only"');
    expect(out).toContain('[[hooks.PreToolUse]]');
    expect(out).toContain("baris 1\\nbaris 2");
  });
});

describe("materializeCodexAgents", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns no args, clause, files, or warnings for an empty roster", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-codex-agent-"));
    dirs.push(dir);
    expect(materializeCodexAgents([], dir)).toEqual({
      args: [], delegationClause: "", configPaths: [], warnings: [],
      liveDefs: [],
    });
  });

  it("does not fake native agents on an unsupported Codex client", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-codex-agent-"));
    dirs.push(dir);
    const result = materializeCodexAgents([def()], dir, { clientVersion: "0.150.0" });
    expect(result.args).toEqual([]);
    expect(result.configPaths).toEqual([]);
    expect(result.liveDefs).toEqual([]);
    expect(result.delegationClause).toBe("");
    expect(result.warnings[0]?.reason).toContain(CODEX_NATIVE_AGENTS_MIN_CLIENT);
  });

  it("writes 0600 configs and quoted dotted-key overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-codex-agent-"));
    dirs.push(dir);
    const result = materializeCodexAgents([def()], dir, {
      readOnlyHookCommand: "node /tmp/readonly.js",
    });
    expect(result.args.slice(0, 4)).toEqual([
      "-c", "agents.enabled=true",
      "-c", "agents.max_concurrent_threads_per_session=3",
    ]);
    expect(result.args).not.toContain("--dangerously-bypass-hook-trust");
    expect(result.args).toContain('agents."scout".description="Cari \\"kode\\""');
    expect(result.args.some((arg) => arg.startsWith('agents."scout".config_file='))).toBe(true);
    expect(result.configPaths).toHaveLength(1);
    expect(statSync(result.configPaths[0]!).mode & 0o777).toBe(0o600);
    expect(readFileSync(result.configPaths[0]!, "utf8")).toContain("developer_instructions");
    expect(result.delegationClause).toContain("spawn_agent");
    expect(result.delegationClause).not.toContain("baris 1");
  });

  it("skips one failed config and preserves the other agents", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-codex-agent-"));
    dirs.push(dir);
    const result = materializeCodexAgents([def({ name: "bad" }), def({ name: "good" })], dir, {
      writeFile(path, content) {
        if (path.includes("bad")) throw new Error("disk full");
        writeFileSync(path, content, { mode: 0o600 });
      },
    });
    expect(result.configPaths).toHaveLength(1);
    expect(result.args.some((arg) => arg.includes('agents."good"'))).toBe(true);
    expect(result.args.some((arg) => arg.includes('agents."bad"'))).toBe(false);
    expect(result.warnings).toEqual([{ agentName: "bad", reason: "disk full" }]);
  });
});

describe("codexNativeAgentsSupported", () => {
  it("requires a detected client at or above the measured minimum", () => {
    expect(codexNativeAgentsSupported("codex-cli 0.151.0")).toBe(true);
    expect(codexNativeAgentsSupported("0.150.9")).toBe(false);
    expect(codexNativeAgentsSupported(null)).toBe(false);
  });

  it("probes the sandbox image instead of the host binary when sessions use Podman", () => {
    expect(codexNativeVersionProbe({
      HANOMAN_SESSION_SANDBOX: "podman",
      HANOMAN_SESSION_IMAGE: "hanoman-agent:42",
    }, "/host/codex")).toEqual({
      bin: "podman",
      args: expect.arrayContaining([
        "run", "--rm", "--network", "none", "hanoman-agent:42",
        "/bin/sh", "-lc", "'/host/codex' --version",
      ]),
    });
  });
});
