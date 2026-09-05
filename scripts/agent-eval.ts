#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { AGENT_EVAL_CASES } from "../evals/custom-agents/manifest";
import {
  runCustomAgentEvaluations,
  type AgentEvalRuntime,
} from "../runner/src/custom-agent-eval";

const usage = [
  "Usage: pnpm agent:eval --runtime claude|codex [--agent name] [--case id] [--output path]",
  "",
  "Live dan opt-in: perintah ini menjalankan CLI model terhadap repo fixture sementara.",
].join("\n");

const values = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]!;
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(`${usage}\n`);
    process.exit(0);
  }
  if (!arg.startsWith("--")) throw new Error(`Argumen tidak dikenal: ${arg}\n${usage}`);
  const equal = arg.indexOf("=");
  const key = equal === -1 ? arg : arg.slice(0, equal);
  const value = equal === -1 ? process.argv[++index] : arg.slice(equal + 1);
  if (!value || value.startsWith("--")) throw new Error(`Nilai wajib untuk ${key}\n${usage}`);
  if (!new Set(["--runtime", "--agent", "--case", "--output"]).has(key)) {
    throw new Error(`Opsi tidak dikenal: ${key}\n${usage}`);
  }
  values.set(key, value);
}

const runtime = values.get("--runtime");
if (runtime !== "claude" && runtime !== "codex") throw new Error(`--runtime wajib claude|codex\n${usage}`);
const runtimeBin = runtime === "codex"
  ? process.env.HANOMAN_CODEX_BIN ?? "codex"
  : process.env.HANOMAN_CLAUDE_BIN ?? "claude";
let clientVersion: string | null | undefined;
if (runtime === "codex") {
  const probe = spawnSync(runtimeBin, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(`${probe.stdout ?? ""}\n${probe.stderr ?? ""}`);
  clientVersion = match?.[0] ?? null;
}

const evalRoot = resolve(import.meta.dirname, "../evals/custom-agents");
const result = await runCustomAgentEvaluations({
  runtime: runtime as AgentEvalRuntime,
  runtimeBin,
  clientVersion,
  agentName: values.get("--agent"),
  caseId: values.get("--case"),
  outputPath: values.get("--output") ? resolve(process.cwd(), values.get("--output")!) : undefined,
  evalRoot,
  cases: AGENT_EVAL_CASES,
});

for (const entry of result.cases) {
  const status = entry.score.passed && entry.status === 0 ? "PASS" : "FAIL";
  process.stdout.write(
    `${status} ${entry.id}: recall=${entry.score.recall.toFixed(2)} `
    + `forbidden=${entry.score.forbiddenHitRate.toFixed(2)} runtime_exit=${entry.status}\n`,
  );
  for (const error of entry.score.evidenceErrors) process.stdout.write(`  evidence: ${error}\n`);
}
for (const entry of result.skipped) {
  process.stdout.write(`SKIP ${entry.id}: ${entry.reason}\n`);
}
process.stdout.write(`Report: ${result.reportPath}\n`);
process.exitCode = result.exitCode;
