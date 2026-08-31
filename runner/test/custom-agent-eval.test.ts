import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_EVAL_CASES } from "../../evals/custom-agents/manifest";
import {
  runCustomAgentEvaluations,
  scoreAgentEvalCase,
  validateAgentEvalManifest,
  type AgentEvalCase,
  type AgentEvalExecution,
} from "../src/custom-agent-eval";

const evalRoot = resolve(import.meta.dirname, "../../evals/custom-agents");

const basicCase = (overrides: Partial<AgentEvalCase> = {}): AgentEvalCase => ({
  id: "scout-positive",
  agentName: "scout",
  task: "Temukan semua cermin payload.",
  expected: [{ id: "mirror", patterns: ["AccountWire", "stale"] }],
  forbidden: [{ id: "false-safe", patterns: ["tidak ada", "cermin"] }],
  fixtureDir: "fixtures/scout-positive",
  source: "SPEC-950",
  ...overrides,
});

describe("custom-agent eval manifest and scorer", () => {
  it("has one positive and one control for every builtin", () => {
    validateAgentEvalManifest(AGENT_EVAL_CASES, evalRoot);
    const agents = new Set(AGENT_EVAL_CASES.map((entry) => entry.agentName));
    expect(agents.size).toBe(8);
    for (const agent of agents) {
      expect(AGENT_EVAL_CASES.some((entry) => entry.id === `${agent}-positive`)).toBe(true);
      expect(AGENT_EVAL_CASES.some((entry) => entry.id === `${agent}-control`)).toBe(true);
    }
  });

  it("requires every expected finding and counts forbidden findings separately", () => {
    const pass = scoreAgentEvalCase(basicCase(), "AccountWire is stale");
    expect(pass).toMatchObject({ recall: 1, forbiddenHitRate: 0, passed: true });

    const missing = scoreAgentEvalCase(basicCase(), "AccountWire exists");
    expect(missing).toMatchObject({ recall: 0, forbiddenHitRate: 0, passed: false });

    const forbidden = scoreAgentEvalCase(basicCase(), "AccountWire is stale; tidak ada cermin");
    expect(forbidden).toMatchObject({ recall: 1, forbiddenHitRate: 1, passed: false });
  });

  it("rejects malformed findings, duplicate ids, and fixture escapes", () => {
    expect(() => validateAgentEvalManifest([
      basicCase({ expected: [{ id: "broken", patterns: ["["] }] }),
    ], evalRoot)).toThrow(/pattern/i);
    expect(() => validateAgentEvalManifest([
      basicCase(), basicCase(),
    ], evalRoot)).toThrow(/duplikat/i);
    expect(() => validateAgentEvalManifest([
      basicCase({ fixtureDir: "../outside" }),
    ], evalRoot)).toThrow(/fixture/i);
  });

  it("scores every frozen positive/control output at 100% without forbidden hits", () => {
    for (const entry of AGENT_EVAL_CASES) {
      const output = readFileSync(join(evalRoot, "frozen-output", `${entry.id}.txt`), "utf8");
      expect(scoreAgentEvalCase(entry, output), entry.id).toMatchObject({
        recall: 1,
        forbiddenHitRate: 0,
        passed: true,
      });
    }
  });

  it("keeps frozen failure controls for missing and forbidden findings", () => {
    expect(scoreAgentEvalCase(
      AGENT_EVAL_CASES.find((entry) => entry.id === "scout-positive")!,
      readFileSync(join(evalRoot, "frozen-output", "failing-missing.txt"), "utf8"),
    )).toMatchObject({ recall: 0, forbiddenHitRate: 0, passed: false });
    expect(scoreAgentEvalCase(
      AGENT_EVAL_CASES.find((entry) => entry.id === "security-reviewer-positive")!,
      readFileSync(join(evalRoot, "frozen-output", "failing-forbidden.txt"), "utf8"),
    )).toMatchObject({ recall: 1, forbiddenHitRate: 1, passed: false });
  });
});

describe("custom-agent live harness isolation", () => {
  it("copies fixtures, initializes git, uses product renderers, filters, and preserves sources", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-test-report-"));
    const reportPath = join(reportDir, "report.json");
    const executions: AgentEvalExecution[] = [];
    const selected = AGENT_EVAL_CASES.filter((entry) => entry.agentName === "scout");
    const before = selected.map((entry) => readFileSync(
      join(evalRoot, entry.fixtureDir, "change", "source.txt"), "utf8",
    ));

    const result = await runCustomAgentEvaluations({
      runtime: "claude",
      agentName: "scout",
      outputPath: reportPath,
      evalRoot,
      cases: AGENT_EVAL_CASES,
      execute: async (execution) => {
        executions.push(execution);
        expect(execution.cwd.startsWith(evalRoot)).toBe(false);
        expect(existsSync(join(execution.cwd, ".git"))).toBe(true);
        expect(execution.args).toContain("--agents");
        const agentsJson = execution.args[execution.args.indexOf("--agents") + 1] ?? "";
        expect(JSON.parse(agentsJson).scout).toBeDefined();
        writeFileSync(join(execution.cwd, "executor-marker.txt"), "temp only");
        return {
          status: 0,
          stdout: readFileSync(join(evalRoot, "frozen-output", `${execution.caseId}.txt`), "utf8"),
          stderr: "",
        };
      },
    });

    expect(executions).toHaveLength(2);
    expect(result.exitCode).toBe(0);
    expect(result.reportPath).toBe(reportPath);
    expect(existsSync(reportPath)).toBe(true);
    expect(executions.every((entry) => !existsSync(entry.cwd))).toBe(true);
    expect(selected.map((entry) => readFileSync(
      join(evalRoot, entry.fixtureDir, "change", "source.txt"), "utf8",
    ))).toEqual(before);
  });

  it("materializes Codex agents and returns nonzero when scoring fails", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-test-codex-"));
    const result = await runCustomAgentEvaluations({
      runtime: "codex",
      agentName: "scout",
      outputPath: join(reportDir, "report.json"),
      evalRoot,
      cases: AGENT_EVAL_CASES,
      execute: async (execution) => {
        expect(execution.args).toContain("agents.enabled=true");
        expect(execution.args.filter((arg) => arg === "--dangerously-bypass-hook-trust")).toHaveLength(1);
        const configArg = execution.args.find((arg) => arg.includes(".config_file="));
        const configPath = JSON.parse(configArg?.split("=").slice(1).join("=") ?? "\"\"");
        expect(readFileSync(configPath, "utf8")).toContain("developer_instructions");
        return { status: 0, stdout: "temuan tidak lengkap", stderr: "" };
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.cases.every((entry) => !entry.score.passed)).toBe(true);
  });

  it("skips Codex-incompatible builtins when running all cases", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-test-codex-all-"));
    const executions: AgentEvalExecution[] = [];
    const result = await runCustomAgentEvaluations({
      runtime: "codex",
      outputPath: join(reportDir, "report.json"),
      evalRoot,
      cases: AGENT_EVAL_CASES,
      execute: async (execution) => {
        executions.push(execution);
        return {
          status: 0,
          stdout: readFileSync(join(evalRoot, "frozen-output", `${execution.caseId}.txt`), "utf8"),
          stderr: "",
        };
      },
    });

    expect(executions).toHaveLength(12);
    expect(result.exitCode).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: "qa-verifier-positive", agentName: "qa-verifier" }),
      expect.objectContaining({ id: "qa-verifier-control", agentName: "qa-verifier" }),
      expect.objectContaining({ id: "edge-case-hunter-positive", agentName: "edge-case-hunter" }),
      expect.objectContaining({ id: "edge-case-hunter-control", agentName: "edge-case-hunter" }),
    ]);
    expect(result.skipped.every((entry) => entry.reason.includes("isolated-worktree"))).toBe(true);
  });

  it("rejects an explicitly selected agent that its runtime cannot materialize", async () => {
    await expect(runCustomAgentEvaluations({
      runtime: "codex",
      agentName: "qa-verifier",
      evalRoot,
      cases: AGENT_EVAL_CASES,
      execute: async () => ({ status: 0, stdout: "", stderr: "" }),
    })).rejects.toThrow(/qa-verifier.*isolated-worktree/i);
  });

  it("refuses to write reports inside the eval source tree", async () => {
    await expect(runCustomAgentEvaluations({
      runtime: "claude",
      outputPath: join(evalRoot, "report.json"),
      evalRoot,
      cases: [AGENT_EVAL_CASES[0]!],
      execute: async () => ({ status: 0, stdout: "", stderr: "" }),
    })).rejects.toThrow(/output/i);
  });
});
