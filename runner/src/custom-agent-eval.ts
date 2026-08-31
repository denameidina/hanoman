import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUILTIN_AGENTS } from "@hanoman/shared";
import { materializeCodexAgents } from "./codex-agent-config";
import { agentDelegationClause, renderAgentsJson, type AgentDef } from "./custom-agents";

export type AgentEvalRuntime = "claude" | "codex";
export type AgentEvalFinding = { id: string; patterns: string[] };
export type AgentEvalCase = {
  id: string;
  agentName: string;
  task: string;
  expected: AgentEvalFinding[];
  forbidden: AgentEvalFinding[];
  fixtureDir: string;
  source: string;
};

export type AgentEvalScore = {
  recall: number;
  forbiddenHitRate: number;
  matchedExpected: string[];
  missingExpected: string[];
  forbiddenHits: string[];
  passed: boolean;
};

export type AgentEvalExecution = {
  runtime: AgentEvalRuntime;
  caseId: string;
  agentName: string;
  command: string;
  args: string[];
  cwd: string;
  task: string;
};

export type AgentEvalExecutionResult = { status: number; stdout: string; stderr: string };
export type AgentEvalExecutor = (
  execution: AgentEvalExecution,
) => Promise<AgentEvalExecutionResult> | AgentEvalExecutionResult;

export type AgentEvalCaseReport = {
  id: string;
  agentName: string;
  runtime: AgentEvalRuntime;
  status: number;
  stderr: string;
  output: string;
  score: AgentEvalScore;
};

export type AgentEvalSkippedCase = {
  id: string;
  agentName: string;
  runtime: AgentEvalRuntime;
  reason: string;
};

export type AgentEvalReport = {
  version: 1;
  runtime: AgentEvalRuntime;
  agentName: string | null;
  createdAt: string;
  sourceHashBefore: string;
  sourceHashAfter: string;
  passed: boolean;
  cases: AgentEvalCaseReport[];
  skipped: AgentEvalSkippedCase[];
};

type RunOptions = {
  runtime: AgentEvalRuntime;
  agentName?: string;
  outputPath?: string;
  evalRoot: string;
  cases: readonly AgentEvalCase[];
  execute?: AgentEvalExecutor;
};

const isInside = (parent: string, child: string): boolean => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} wajib string non-kosong`);
}

export function validateAgentEvalManifest(
  cases: readonly AgentEvalCase[],
  evalRoot: string,
): void {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("Manifest eval wajib berisi kasus");
  const caseIds = new Set<string>();
  const knownAgents = new Set(BUILTIN_AGENTS.map((entry) => entry.name));
  for (const [index, entry] of cases.entries()) {
    assertString(entry?.id, `cases[${index}].id`);
    if (caseIds.has(entry.id)) throw new Error(`ID kasus duplikat: ${entry.id}`);
    caseIds.add(entry.id);
    assertString(entry.agentName, `${entry.id}.agentName`);
    if (!knownAgents.has(entry.agentName)) throw new Error(`Agent eval tidak dikenal: ${entry.agentName}`);
    assertString(entry.task, `${entry.id}.task`);
    assertString(entry.fixtureDir, `${entry.id}.fixtureDir`);
    assertString(entry.source, `${entry.id}.source`);
    const fixturePath = resolve(evalRoot, entry.fixtureDir);
    if (!isInside(evalRoot, fixturePath)) throw new Error(`Fixture keluar eval root: ${entry.fixtureDir}`);
    if (!existsSync(join(fixturePath, "base")) || !existsSync(join(fixturePath, "change"))) {
      throw new Error(`Fixture wajib memiliki base/ dan change/: ${entry.fixtureDir}`);
    }
    const findingIds = new Set<string>();
    for (const [kind, findings] of [["expected", entry.expected], ["forbidden", entry.forbidden]] as const) {
      if (!Array.isArray(findings)) throw new Error(`${entry.id}.${kind} wajib array`);
      for (const finding of findings) {
        assertString(finding?.id, `${entry.id}.${kind}.id`);
        if (findingIds.has(finding.id)) throw new Error(`ID finding duplikat: ${entry.id}/${finding.id}`);
        findingIds.add(finding.id);
        if (!Array.isArray(finding.patterns) || finding.patterns.length === 0) {
          throw new Error(`${entry.id}/${finding.id} wajib punya pattern`);
        }
        for (const pattern of finding.patterns) {
          assertString(pattern, `${entry.id}/${finding.id}.pattern`);
          try {
            new RegExp(pattern, "is");
          } catch {
            throw new Error(`Pattern tidak valid: ${entry.id}/${finding.id}: ${pattern}`);
          }
        }
      }
    }
    if (entry.expected.length === 0) throw new Error(`${entry.id} wajib punya expected finding`);
  }
}

const findingMatches = (finding: AgentEvalFinding, output: string): boolean =>
  finding.patterns.every((pattern) => new RegExp(pattern, "is").test(output));

export function scoreAgentEvalCase(entry: AgentEvalCase, output: string): AgentEvalScore {
  const matchedExpected = entry.expected.filter((finding) => findingMatches(finding, output)).map((f) => f.id);
  const missingExpected = entry.expected.filter((finding) => !findingMatches(finding, output)).map((f) => f.id);
  const forbiddenHits = entry.forbidden.filter((finding) => findingMatches(finding, output)).map((f) => f.id);
  const recall = entry.expected.length === 0 ? 1 : matchedExpected.length / entry.expected.length;
  const forbiddenHitRate = entry.forbidden.length === 0 ? 0 : forbiddenHits.length / entry.forbidden.length;
  return {
    recall,
    forbiddenHitRate,
    matchedExpected,
    missingExpected,
    forbiddenHits,
    passed: recall === 1 && forbiddenHits.length === 0,
  };
}

const hashTree = (root: string): string => {
  const hash = createHash("sha256");
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = relative(root, path);
      const stat = statSync(path);
      hash.update(`${stat.isDirectory() ? "d" : "f"}:${rel}\0`);
      if (stat.isDirectory()) visit(path);
      else hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest("hex");
};

const copyContents = (source: string, destination: string): void => {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) {
    cpSync(join(source, name), join(destination, name), { recursive: true });
  }
};

const git = (cwd: string, args: string[]): void => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} gagal: ${result.stderr}`);
};

const builtinAgentDef = (agentName: string, runtime: AgentEvalRuntime): AgentDef => {
  const builtin = BUILTIN_AGENTS.find((entry) => entry.name === agentName);
  if (!builtin) throw new Error(`Builtin agent tidak dikenal: ${agentName}`);
  return {
    name: builtin.name,
    description: builtin.description,
    instructions: builtin.instructions,
    tools: [...builtin.tools],
    model: builtin.models[runtime],
    mentions: [],
    activation: builtin.activation,
    effort: builtin.effort,
    workspacePolicy: builtin.workspacePolicy,
    maxTurns: builtin.maxTurns,
    timeoutSeconds: builtin.timeoutSeconds,
  };
};

const unsupportedReason = (entry: AgentEvalCase, runtime: AgentEvalRuntime): string | null => {
  const builtin = BUILTIN_AGENTS.find((candidate) => candidate.name === entry.agentName);
  if (!builtin) return `builtin ${entry.agentName} tidak dikenal`;
  if (runtime === "codex" && builtin.workspacePolicy === "isolated-worktree") {
    return "isolated-worktree belum tersedia untuk subagent Codex";
  }
  return null;
};

const defaultExecutor: AgentEvalExecutor = (execution) => {
  const result = spawnSync(execution.command, execution.args, {
    cwd: execution.cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.error ? `${result.stderr ?? ""}\n${result.error.message}` : (result.stderr ?? ""),
  };
};

const executionFor = (
  runtime: AgentEvalRuntime,
  entry: AgentEvalCase,
  repoDir: string,
  configDir: string,
): AgentEvalExecution => {
  const def = builtinAgentDef(entry.agentName, runtime);
  if (runtime === "claude") {
    const rendered = renderAgentsJson([def]);
    const task = `${entry.task}${agentDelegationClause([def], "claude")}`;
    return {
      runtime, caseId: entry.id, agentName: entry.agentName, command: "claude", cwd: repoDir, task,
      args: ["--print", "--agents", rendered, "--dangerously-skip-permissions", task],
    };
  }
  const rendered = materializeCodexAgents([def], configDir);
  if (rendered.liveDefs.length !== 1) {
    throw new Error(`Agent ${entry.agentName} tidak dapat dimaterialisasi untuk Codex`);
  }
  const task = `${entry.task}${rendered.delegationClause}`;
  return {
    runtime, caseId: entry.id, agentName: entry.agentName, command: "codex", cwd: repoDir, task,
    // Eval memanggil Codex langsung (bukan lewat agentFlags sesi), jadi trust untuk hook temp
    // milik Hanoman dipasang tepat sekali di sini.
    args: [
      "exec", ...rendered.args,
      "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", task,
    ],
  };
};

export async function runCustomAgentEvaluations(options: RunOptions): Promise<{
  reportPath: string;
  exitCode: 0 | 1;
  cases: AgentEvalCaseReport[];
  skipped: AgentEvalSkippedCase[];
}> {
  const evalRoot = resolve(options.evalRoot);
  validateAgentEvalManifest(options.cases, evalRoot);
  const requested = options.cases.filter((entry) => !options.agentName || entry.agentName === options.agentName);
  if (requested.length === 0) throw new Error(`Tidak ada kasus untuk agent: ${options.agentName ?? "(semua)"}`);
  const skipped = requested.flatMap((entry): AgentEvalSkippedCase[] => {
    const reason = unsupportedReason(entry, options.runtime);
    return reason ? [{ id: entry.id, agentName: entry.agentName, runtime: options.runtime, reason }] : [];
  });
  if (options.agentName && skipped.length === requested.length) {
    throw new Error(`Agent ${options.agentName} tidak tersedia untuk ${options.runtime}: ${skipped[0]!.reason}`);
  }
  const skippedIds = new Set(skipped.map((entry) => entry.id));
  const selected = requested.filter((entry) => !skippedIds.has(entry.id));

  const reportPath = options.outputPath
    ? resolve(options.outputPath)
    : join(mkdtempSync(join(tmpdir(), "hanoman-agent-eval-report-")), "report.json");
  if (isInside(evalRoot, reportPath)) throw new Error("Output report tidak boleh berada di source eval");

  const sourceHashBefore = hashTree(evalRoot);
  const reports: AgentEvalCaseReport[] = [];
  for (const entry of selected) {
    const tempRoot = mkdtempSync(join(tmpdir(), `hanoman-agent-eval-${entry.id}-`));
    const repoDir = join(tempRoot, "repo");
    const configDir = join(tempRoot, "agent-config");
    try {
      mkdirSync(repoDir, { recursive: true });
      mkdirSync(configDir, { recursive: true });
      const fixtureRoot = resolve(evalRoot, entry.fixtureDir);
      copyContents(join(fixtureRoot, "base"), repoDir);
      git(repoDir, ["init", "--quiet"]);
      git(repoDir, ["config", "user.email", "agent-eval@hanoman.local"]);
      git(repoDir, ["config", "user.name", "Hanoman Agent Eval"]);
      git(repoDir, ["add", "--all"]);
      git(repoDir, ["commit", "--quiet", "-m", "eval base"]);
      copyContents(join(fixtureRoot, "change"), repoDir);
      const execution = executionFor(options.runtime, entry, repoDir, configDir);
      const result = await (options.execute ?? defaultExecutor)(execution);
      const score = scoreAgentEvalCase(entry, result.stdout);
      reports.push({
        id: entry.id,
        agentName: entry.agentName,
        runtime: options.runtime,
        status: result.status,
        stderr: result.stderr,
        output: result.stdout,
        score: { ...score, passed: score.passed && result.status === 0 },
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  const sourceHashAfter = hashTree(evalRoot);
  if (sourceHashBefore !== sourceHashAfter) throw new Error("Source eval berubah selama harness berjalan");
  const passed = reports.every((entry) => entry.status === 0 && entry.score.passed);
  const report: AgentEvalReport = {
    version: 1,
    runtime: options.runtime,
    agentName: options.agentName ?? null,
    createdAt: new Date().toISOString(),
    sourceHashBefore,
    sourceHashAfter,
    passed,
    cases: reports,
    skipped,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { reportPath, exitCode: passed ? 0 : 1, cases: reports, skipped };
}
