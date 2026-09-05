import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "@hanoman/shared";
import { renderAgentsJson, type AgentDef } from "../src/custom-agents";
import { agentDefinitionHash } from "../src/agent-definition";
import { snapshotEvalEvidence } from "../src/custom-agent-eval-evidence";
import { AGENT_EVAL_CASES } from "../../evals/custom-agents/manifest";
import {
  runCustomAgentEvaluations,
  scoreAgentEvalCase,
  executeAgentEvaluation,
  validateAgentEvalManifest,
  type AgentEvalCase,
  type AgentEvalExecution,
} from "../src/custom-agent-eval";

const evalRoot = resolve(import.meta.dirname, "../../evals/custom-agents");

const basicCase = (overrides: Partial<AgentEvalCase> = {}): AgentEvalCase => ({
  ...AGENT_EVAL_CASES[0]!, ...overrides,
});
const frozen = (entry: AgentEvalCase): string => readFileSync(join(evalRoot, "frozen-output", `${entry.id}.txt`), "utf8");
const withEvidence = <T>(entry: AgentEvalCase, run: (context: { baseDir: string; candidateDir: string; artifactRoot: string }) => T): T => {
  const root = mkdtempSync(join(tmpdir(), "eval-evidence-test-"));
  const fixture = join(evalRoot, entry.fixtureDir);
  const candidateDir = join(root, "candidate");
  const artifactRoot = join(root, "child");
  try {
    cpSync(join(fixture, "base"), candidateDir, { recursive: true });
    cpSync(join(fixture, "change"), candidateDir, { recursive: true });
    cpSync(candidateDir, artifactRoot, { recursive: true });
    if (existsSync(join(fixture, "frozen-artifacts"))) cpSync(join(fixture, "frozen-artifacts"), artifactRoot, { recursive: true });
    return run({ baseDir: join(fixture, "base"), candidateDir, artifactRoot });
  } finally { rmSync(root, { recursive: true, force: true }); }
};

const publishChildResult = (execution: AgentEvalExecution, output: string): void => {
  writeFileSync(join(execution.eventDir, "01-start.json"), JSON.stringify({
    hook_event_name: "SubagentStart", agent_id: `child-${execution.caseId}`,
    agent_type: execution.agentName,
  }));
  writeFileSync(join(execution.eventDir, "02-stop.json"), JSON.stringify({
    hook_event_name: "SubagentStop", agent_id: `child-${execution.caseId}`,
    agent_type: execution.agentName, last_assistant_message: output,
  }));
};

describe("custom-agent eval manifest and scorer", () => {
  it("has one positive and one control for every builtin plus preservation/source controls", () => {
    validateAgentEvalManifest(AGENT_EVAL_CASES, evalRoot);
    const agents = new Set(AGENT_EVAL_CASES.map((entry) => entry.agentName));
    expect(agents.size).toBe(8);
    for (const agent of agents) {
      expect(AGENT_EVAL_CASES.some((entry) => entry.id === `${agent}-positive`)).toBe(true);
      expect(AGENT_EVAL_CASES.some((entry) => entry.id === `${agent}-control`)).toBe(true);
    }
    expect(AGENT_EVAL_CASES.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "qa-verifier-preservation", "spec-auditor-already-met", "dep-auditor-advisory-license", "dep-auditor-advisory-unknown",
    ]));
  });

  it("rejects keyword-only, negated, and unknown passed=true evidence", () => {
    withEvidence(basicCase(), (context) => {
      for (const output of ["AccountWire is stale", "AccountWire is NOT stale", '{"status":"unknown","passed":true,"summary":"AccountWire is stale"}']) {
        expect(scoreAgentEvalCase(basicCase(), output, context).passed).toBe(false);
      }
      for (const patch of [{ status: "unknown" }, { claim: "mirror-not-stale" }, { summary: "AccountWire is NOT stale" }]) {
        const output = JSON.parse(frozen(basicCase()));
        Object.assign(output.findings[0], patch);
        expect(scoreAgentEvalCase(basicCase(), JSON.stringify(output), context).passed).toBe(false);
      }
    });
  });

  it("requires exact scoped anchors and actual file content, not matching keywords elsewhere", () => {
    withEvidence(basicCase(), (context) => {
      expect(scoreAgentEvalCase(basicCase(), frozen(basicCase()), context).passed).toBe(true);
      expect(scoreAgentEvalCase(basicCase(), frozen(basicCase())).passed).toBe(false);
      for (const patch of [{ path: "source.txt" }, { line: 99 }, { quote: "AccountWire locale stale" }, { revision: "base" }, { path: "../source.txt" }]) {
        const output = JSON.parse(frozen(basicCase()));
        Object.assign(output.findings[0].anchors[0], patch);
        expect(scoreAgentEvalCase(basicCase(), JSON.stringify(output), context).passed).toBe(false);
      }
      writeFileSync(join(context.candidateDir, "packages/web/source.txt"), "unrelated\n");
      expect(scoreAgentEvalCase(basicCase(), frozen(basicCase()), context).passed).toBe(false);
    });
  });

  it("rejects malformed findings, duplicate ids, and fixture escapes", () => {
    expect(() => validateAgentEvalManifest([
      basicCase({ expected: [{ id: "broken", claim: "broken", anchors: [] }] }),
    ], evalRoot)).toThrow(/anchor/i);
    expect(() => validateAgentEvalManifest([basicCase(), basicCase()], evalRoot)).toThrow(/duplikat/i);
    expect(() => validateAgentEvalManifest([basicCase({ fixtureDir: "../outside" })], evalRoot)).toThrow(/fixture/i);
  });

  it("scores every frozen structured output against real fixtures and executable artifacts", () => {
    for (const entry of AGENT_EVAL_CASES) {
      withEvidence(entry, (context) => {
        const score = scoreAgentEvalCase(entry, frozen(entry), context);
        expect(score, `${entry.id}: ${score.evidenceErrors.join(",")}`).toMatchObject({ recall: 1, forbiddenHitRate: 0, passed: true });
        if (entry.probe) expect(score.commandVerifications[0]?.authority).toBe("harness-replay-of-declarative-artifact");
      });
    }
  });

  it("keeps frozen failure controls for missing and forbidden findings", () => {
    expect(scoreAgentEvalCase(basicCase(), readFileSync(join(evalRoot, "frozen-output/failing-missing.txt"), "utf8")))
      .toMatchObject({ recall: 0, forbiddenHitRate: 0, passed: false });
    const entry = AGENT_EVAL_CASES.find((entry) => entry.id === "security-reviewer-positive")!;
    withEvidence(entry, (context) => expect(scoreAgentEvalCase(entry,
      readFileSync(join(evalRoot, "frozen-output/failing-forbidden.txt"), "utf8"), context))
      .toMatchObject({ recall: 1, forbiddenHitRate: 1, passed: false }));
  });

  it("verifies preservation green in base/candidate and red under a behavior-breaking mutation", () => {
    const entry = AGENT_EVAL_CASES.find((entry) => entry.id === "qa-verifier-preservation")!;
    withEvidence(entry, (context) => {
      expect(scoreAgentEvalCase(entry, frozen(entry), context).commandVerifications[0])
        .toMatchObject({ baseExit: 0, candidateExit: 0, mutantExit: 1 });
      const output = JSON.parse(frozen(entry));
      output.findings[0].command.baseExit = 1;
      expect(scoreAgentEvalCase(entry, JSON.stringify(output), context).passed).toBe(false);
      writeFileSync(join(context.artifactRoot, "cases.json"), '[{"input":"OTHER","expected":"other"}]');
      expect(scoreAgentEvalCase(entry, frozen(entry), context).passed).toBe(false);
    });
  });

  it("accepts any same-ID duplicate scenario and rejects distinct IDs", () => {
    const entry = AGENT_EVAL_CASES.find((entry) => entry.id === "edge-case-hunter-positive")!;
    withEvidence(entry, (context) => {
      writeFileSync(join(context.artifactRoot, "cases.json"), JSON.stringify([{ deliveries: ["evt-2", "evt-2"], expectedCount: 1 }]));
      expect(scoreAgentEvalCase(entry, frozen(entry), context).passed).toBe(true);
      writeFileSync(join(context.artifactRoot, "cases.json"), JSON.stringify([{ deliveries: ["evt-2", "evt-3"], expectedCount: 1 }]));
      expect(scoreAgentEvalCase(entry, frozen(entry), context).passed).toBe(false);
    });
  });

  it("rejects nonexistent/escaping/symlink artifacts and never executes supplied JavaScript", () => {
    const entry = AGENT_EVAL_CASES.find((entry) => entry.id === "qa-verifier-preservation")!;
    withEvidence(entry, (context) => {
      const marker = join(tmpdir(), `agent-eval-must-not-write-${process.pid}`);
      rmSync(marker, { force: true });
      const malicious = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe');`;
      writeFileSync(join(context.artifactRoot, "evil.cjs"), malicious);
      symlinkSync(join(context.artifactRoot, "cases.json"), join(context.artifactRoot, "linked.json"));
      for (const artifact of ["missing.json", "../candidate/cases.json", "linked.json", "evil.cjs"]) {
        const output = JSON.parse(frozen(entry));
        output.findings[0].command.artifact = artifact;
        expect(scoreAgentEvalCase(entry, JSON.stringify(output), context).passed).toBe(false);
      }
      writeFileSync(join(context.artifactRoot, "cases.json"), malicious);
      expect(scoreAgentEvalCase(entry, frozen(entry), context).passed).toBe(false);
      writeFileSync(join(context.artifactRoot, "cases.json"), JSON.stringify([{ input: "a@b.com", expected: "a@b.com", code: malicious }]));
      expect(scoreAgentEvalCase(entry, frozen(entry), context).passed).toBe(false);
      expect(existsSync(marker)).toBe(false);
    });
  });

  it("captures immutable replay bytes before the runtime can alter filesystem snapshots", () => {
    const entry = AGENT_EVAL_CASES.find((entry) => entry.id === "qa-verifier-preservation")!;
    withEvidence(entry, (context) => {
      const captured = snapshotEvalEvidence(context);
      const marker = join(tmpdir(), `eval-snapshot-marker-${process.pid}`);
      rmSync(marker, { force: true });
      const malicious = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe');`;
      writeFileSync(join(context.candidateDir, "test.cjs"), malicious);
      writeFileSync(join(context.candidateDir, "app.cjs"), malicious);
      expect(scoreAgentEvalCase(entry, frozen(entry), captured).passed).toBe(true);
      expect(existsSync(marker)).toBe(false);
    });
  });

  it("does not trust modified child runner/source or claimed stdout as execution evidence", () => {
    const entry = AGENT_EVAL_CASES.find((entry) => entry.id === "qa-verifier-control")!;
    withEvidence(entry, (context) => {
      writeFileSync(join(context.artifactRoot, "test.cjs"), 'throw new Error("DO NOT EXECUTE MODEL CODE")');
      // Replay takes executable bytes exclusively from trusted fixture snapshots.
      expect(scoreAgentEvalCase(entry, frozen(entry), context).passed).toBe(true);
      writeFileSync(join(context.artifactRoot, "app.cjs"), "exports.normalizeEmail = () => 'fake';");
      expect(scoreAgentEvalCase(entry, frozen(entry), context).passed).toBe(false);
    });
  });
});

describe("custom-agent live harness isolation", () => {
  it("terminates a runtime case at its wall-clock limit", async () => {
    const result = await executeAgentEvaluation({
      runtime: "codex", caseId: "timeout", agentName: "scout",
      command: process.execPath, args: ["-e", "setTimeout(() => {}, 1000)"],
      cwd: tmpdir(), task: "timeout", eventDir: tmpdir(), env: process.env,
      timeoutMs: 50,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/timed out|ETIMEDOUT/i);
  });

  it("copies fixtures, initializes git, uses product renderers, filters, and preserves sources", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-test-report-"));
    const reportPath = join(reportDir, "report.json");
    const executions: AgentEvalExecution[] = [];
    const builtinBefore = JSON.stringify(BUILTIN_AGENTS);
    const builtin = BUILTIN_AGENTS.find((entry) => entry.name === "scout")!;
    const productDef: AgentDef = { ...builtin, tools: [...builtin.tools], model: builtin.models.claude, mentions: [] };
    let observedSuffix = "";
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
        expect(execution.args).toEqual(expect.arrayContaining([
          "--restricted", "--permission-mode", "plan", "--tools", "Task,Read,Glob,Grep",
          "--allowedTools", "Task,Read,Glob,Grep", "--settings",
        ]));
        expect(execution.args).not.toContain("--dangerously-skip-permissions");
        expect(execution.args[execution.args.indexOf("--tools") + 1]).toBe("Task,Read,Glob,Grep");
        expect(execution.args[execution.args.indexOf("--allowedTools") + 1]).toBe("Task,Read,Glob,Grep");
        expect(execution.env.HANOMAN_EVENT_DIR).toBe(execution.eventDir);
        expect(execution.env.PWD).toBe(execution.cwd);
        expect(execution.env.OLDPWD).toBe(execution.cwd);
        expect(execution.env.INIT_CWD).toBe(execution.cwd);
        expect(execution.env.RIPGREP_CONFIG_PATH).toBeUndefined();
        expect(execution.timeoutMs).toBe(180_000);
        expect(execution.task).toMatch(/tepat satu kali/);
        const baseSha = /Base SHA: ([a-f0-9]+)/.exec(execution.task)![1]!;
        const candidateSha = /Kandidat SHA: ([a-f0-9]+)/.exec(execution.task)![1]!;
        expect(candidateSha).not.toBe(baseSha);
        expect(spawnSync("git", ["status", "--porcelain"], { cwd: execution.cwd, encoding: "utf8" }).stdout).toBe("");
        const child = join(execution.cwd, ".claude/worktrees/snapshot-child");
        expect(spawnSync("git", ["worktree", "add", "--detach", child, "HEAD"], { cwd: execution.cwd }).status).toBe(0);
        expect(readFileSync(join(child, "packages/shared/source.txt"), "utf8")).toContain("locale");
        expect(spawnSync("git", ["show", `${baseSha}:packages/shared/source.txt`], { cwd: child, encoding: "utf8" }).stdout).not.toContain("locale");
        const agentsJson = execution.args[execution.args.indexOf("--agents") + 1] ?? "";
        const prompt = JSON.parse(agentsJson).scout.prompt as string;
        expect(prompt).toContain("## Protokol format evaluasi");
        expect(prompt.lastIndexOf("## Protokol format evaluasi")).toBeGreaterThan(prompt.lastIndexOf("Kontrak serah-terima"));
        expect(prompt).toContain("id dan claim HARUS identik");
        const suffix = prompt.slice(prompt.lastIndexOf("## Protokol format evaluasi"));
        expect(execution.task).toContain(suffix);
        observedSuffix = "\n\n" + suffix;
        const productPrompt = JSON.parse(renderAgentsJson([productDef])).scout.prompt;
        expect(prompt).toBe(productPrompt + observedSuffix);
        const hookCommand = JSON.parse(agentsJson).scout.hooks.PreToolUse[0].hooks[0].command as string;
        const hookPath = hookCommand.slice("node '".length, -1);
        expect(existsSync(hookPath)).toBe(true);
        const blocked = spawnSync(process.execPath, [hookPath], {
          input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "node --test test.cjs" } }),
          encoding: "utf8", cwd: execution.cwd,
        });
        expect(blocked.status).toBe(2);
        expect(blocked.stderr).toContain("tidak terbukti read-only");
        writeFileSync(join(execution.cwd, "executor-marker.txt"), "temp only");
        publishChildResult(
          execution,
          readFileSync(join(evalRoot, "frozen-output", `${execution.caseId}.txt`), "utf8"),
        );
        return {
          status: 0,
          stdout: "PARENT OUTPUT MUST NOT BE SCORED",
          stderr: "",
        };
      },
    });

    expect(executions).toHaveLength(2);
    expect(result.exitCode).toBe(0);
    expect(result.cases[0]?.definitionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(BUILTIN_AGENTS)).toBe(builtinBefore);
    expect(BUILTIN_AGENTS.find((entry) => entry.name === "scout")!.instructions).not.toContain("## Protokol format evaluasi");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.cases[0].definitionFingerprint).toBe(report.cases[0].evaluationDefinitionFingerprint);
    expect(report.cases[0].productionDefinitionFingerprint).not.toBe(report.cases[0].evaluationDefinitionFingerprint);
    expect(report.cases[0].protocolHash).toBe(createHash("sha256").update(observedSuffix).digest("hex"));
    expect(report.cases[0].productionDefinitionFingerprint).toBe(agentDefinitionHash(productDef, [productDef], "claude"));
    expect(report.cases[0].evaluationDefinitionFingerprint).toBe(agentDefinitionHash(productDef, [productDef], "claude", { promptSuffix: observedSuffix }));
    expect(result.reportPath).toBe(reportPath);
    expect(existsSync(reportPath)).toBe(true);
    expect(executions.every((entry) => !existsSync(entry.cwd))).toBe(true);
    expect(selected.map((entry) => readFileSync(
      join(evalRoot, entry.fixtureDir, "change", "source.txt"), "utf8",
    ))).toEqual(before);
  });

  it("independently replays declarative artifacts in a child worktree containing candidate changes", () => {
    const entry = AGENT_EVAL_CASES.find((entry) => entry.id === "qa-verifier-control")!;
    withEvidence(entry, (context) => {
      const repo = context.artifactRoot;
      const git = (args: string[]): string => {
        const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim();
      };
      cpSync(context.baseDir, repo, { recursive: true });
      git(["init", "--quiet"]);
      git(["config", "user.email", "agent-eval@hanoman.local"]);
      git(["config", "user.name", "Hanoman Agent Eval"]);
      git(["add", "--all"]);
      git(["commit", "--quiet", "-m", "base"]);
      const baseSha = git(["rev-parse", "HEAD"]);
      cpSync(context.candidateDir, repo, { recursive: true });
      git(["add", "--all"]);
      git(["commit", "--quiet", "-m", "candidate snapshot"]);
      const child = join(repo, ".claude/worktrees/eval-child");
      git(["worktree", "add", "--detach", child, "HEAD"]);
      expect(readFileSync(join(child, "app.cjs"), "utf8")).toContain("trim()");
      expect(git(["show", `${baseSha}:app.cjs`])).not.toContain("trim()");
      const output = JSON.parse(frozen(entry));
      output.findings[0].command.cwd = ".claude/worktrees/eval-child";
      const score = scoreAgentEvalCase(entry, JSON.stringify(output), context);
      expect(score.passed).toBe(true);
      expect(score.commandVerifications[0]).toMatchObject({ baseExit: 1, candidateExit: 0, mutantExit: 1 });
    });
  });

  it("fails closed with explicit skips for isolated live fixtures, including --case selection", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "eval-unsupported-cases-"));
    try {
      for (const runtime of ["claude", "codex"] as const) {
        const result = await runCustomAgentEvaluations({
          runtime, caseId: "qa-verifier-control", evalRoot, cases: AGENT_EVAL_CASES,
          outputPath: join(reportDir, `${runtime}.json`),
          execute: () => { throw new Error("Unsupported runtime must not execute"); },
        });
        expect(result.cases).toEqual([]);
        expect(result.skipped).toHaveLength(1);
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(readFileSync(result.reportPath, "utf8")).passed).toBe(false);
        expect(result.skipped[0]?.reason).toMatch(runtime === "claude" ? /restricted.*plan.*offline/ : /isolated-worktree/);
      }
    } finally { rmSync(reportDir, { recursive: true, force: true }); }
  });

  it("materializes Codex agents and returns nonzero when scoring fails", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-test-codex-"));
    const result = await runCustomAgentEvaluations({
      runtime: "codex",
      clientVersion: "0.151.0",
      agentName: "scout",
      outputPath: join(reportDir, "report.json"),
      evalRoot,
      cases: AGENT_EVAL_CASES,
      execute: async (execution) => {
        expect(execution.args).toContain("agents.enabled=true");
        expect(execution.args.filter((arg) => arg === "--dangerously-bypass-hook-trust")).toHaveLength(1);
        expect(execution.args).toEqual(expect.arrayContaining([
          "--sandbox", "read-only", "--ignore-user-config", "--ignore-rules",
        ]));
        expect(execution.args).not.toContain("--ephemeral");
        expect(execution.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
        expect(execution.task).toMatch(/no thread with id.*wait_agent.*30 detik/is);
        const configArg = execution.args.find((arg) => arg.includes(".config_file="));
        const configPath = JSON.parse(configArg?.split("=").slice(1).join("=") ?? "\"\"");
        expect(readFileSync(configPath, "utf8")).toContain("developer_instructions");
        expect(readFileSync(configPath, "utf8")).toContain("PreToolUse");
        const promptLine = readFileSync(configPath, "utf8").split("\n").find((line) => line.startsWith("developer_instructions = "))!;
        const prompt = JSON.parse(promptLine.slice("developer_instructions = ".length)) as string;
        expect(prompt).toContain("## Protokol format evaluasi");
        expect(prompt.lastIndexOf("## Protokol format evaluasi")).toBeGreaterThan(prompt.lastIndexOf("Kontrak serah-terima"));
        publishChildResult(execution, "temuan tidak lengkap");
        return { status: 0, stdout: "AccountWire is stale", stderr: "" };
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.cases.every((entry) => !entry.score.passed)).toBe(true);
    // Assertions inside an injected executor must not be mistaken for the expected score failure.
    expect(result.cases.map((entry) => entry.output)).toEqual(["temuan tidak lengkap", "temuan tidak lengkap"]);
  });

  it("skips Codex-incompatible builtins when running all cases", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-test-codex-all-"));
    const executions: AgentEvalExecution[] = [];
    const result = await runCustomAgentEvaluations({
      runtime: "codex",
      clientVersion: "0.151.0",
      outputPath: join(reportDir, "report.json"),
      evalRoot,
      cases: AGENT_EVAL_CASES,
      execute: async (execution) => {
        executions.push(execution);
        publishChildResult(
          execution,
          readFileSync(join(evalRoot, "frozen-output", `${execution.caseId}.txt`), "utf8"),
        );
        return {
          status: 0,
          stdout: "parent tidak dinilai",
          stderr: "",
        };
      },
    });

    expect(executions).toHaveLength(15);
    expect(result.exitCode).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: "qa-verifier-positive", agentName: "qa-verifier" }),
      expect.objectContaining({ id: "qa-verifier-control", agentName: "qa-verifier" }),
      expect.objectContaining({ id: "qa-verifier-preservation", agentName: "qa-verifier" }),
      expect.objectContaining({ id: "edge-case-hunter-positive", agentName: "edge-case-hunter" }),
      expect.objectContaining({ id: "edge-case-hunter-control", agentName: "edge-case-hunter" }),
    ]);
    expect(result.skipped.every((entry) => entry.reason.includes("isolated-worktree"))).toBe(true);
  });

  it("rejects an explicitly selected agent that its runtime cannot materialize", async () => {
    await expect(runCustomAgentEvaluations({
      runtime: "codex",
      clientVersion: "0.151.0",
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

  it("refuses to write reports anywhere inside the source checkout", async () => {
    await expect(runCustomAgentEvaluations({
      runtime: "claude",
      outputPath: resolve(evalRoot, "../report.json"),
      evalRoot,
      cases: [AGENT_EVAL_CASES[0]!],
      execute: async () => ({ status: 0, stdout: "", stderr: "" }),
    })).rejects.toThrow(/checkout/i);
  });

  it("refuses a report path that enters the checkout through a symlink", async () => {
    const outside = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-symlink-"));
    const checkout = resolve(evalRoot, "../..");
    const link = join(outside, "checkout");
    symlinkSync(checkout, link, "dir");
    try {
      await expect(runCustomAgentEvaluations({
        runtime: "claude",
        outputPath: join(link, "report.json"),
        evalRoot,
        cases: [AGENT_EVAL_CASES[0]!],
        execute: async () => ({ status: 0, stdout: "", stderr: "" }),
      })).rejects.toThrow(/checkout/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects Codex evals when the native-agent client gate is unknown or too old", async () => {
    for (const clientVersion of [null, "0.150.9"]) {
      await expect(runCustomAgentEvaluations({
        runtime: "codex",
        clientVersion,
        agentName: "scout",
        evalRoot,
        cases: AGENT_EVAL_CASES,
        execute: async () => ({ status: 0, stdout: "", stderr: "" }),
      })).rejects.toThrow(/0\.151\.0/i);
    }
  });

  it("fails attribution when the target child has no complete lifecycle", async () => {
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-attribution-"));
    try {
      const result = await runCustomAgentEvaluations({
        runtime: "claude",
        agentName: "scout",
        outputPath: join(reportDir, "report.json"),
        evalRoot,
        cases: [AGENT_EVAL_CASES.find((entry) => entry.id === "scout-positive")!],
        execute: async () => ({ status: 0, stdout: "AccountWire is stale", stderr: "" }),
      });
      expect(result.exitCode).toBe(1);
      expect(result.cases[0]).toMatchObject({ status: 1, output: "" });
      expect(result.cases[0]!.stderr).toMatch(/lifecycle.*scout/i);
    } finally {
      rmSync(reportDir, { recursive: true, force: true });
    }
  });

  it.each(["executor-throws", "event-directory-removed"])("detects source writes even when %s interrupts the harness", async (failure) => {
    const checkout = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-checkout-"));
    const isolatedEvalRoot = join(checkout, "eval");
    const fixture = join(isolatedEvalRoot, "fixture");
    const reportDir = mkdtempSync(join(tmpdir(), "hanoman-agent-eval-integrity-report-"));
    mkdirSync(join(fixture, "base"), { recursive: true });
    mkdirSync(join(fixture, "change"), { recursive: true });
    writeFileSync(join(fixture, "base", "source.txt"), "before\n");
    writeFileSync(join(fixture, "change", "source.txt"), "after\n");
    expect(spawnSync("git", ["init", "--quiet"], { cwd: checkout }).status).toBe(0);
    try {
      await expect(runCustomAgentEvaluations({
        runtime: "claude",
        outputPath: join(reportDir, "report.json"),
        evalRoot: isolatedEvalRoot,
        cases: [basicCase({ fixtureDir: "fixture", expected: [{ id: "changed", claim: "changed", anchors: [{ revision: "candidate", path: "source.txt", line: 1, quote: "after" }] }] })],
        execute: async (execution) => {
          writeFileSync(join(checkout, "outside-eval.txt"), "mutation\n");
          if (failure === "executor-throws") throw new Error("executor failed after source mutation");
          rmSync(execution.eventDir, { recursive: true, force: true });
          return { status: 0, stdout: "", stderr: "" };
        },
      })).rejects.toThrow(/source eval berubah/i);
    } finally {
      rmSync(checkout, { recursive: true, force: true });
      rmSync(reportDir, { recursive: true, force: true });
    }
  });
});
