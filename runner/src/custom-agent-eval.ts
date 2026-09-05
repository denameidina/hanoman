import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync,
  readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUILTIN_AGENTS } from "@hanoman/shared";
import {
  CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported, materializeCodexAgents,
} from "./codex-agent-config";
import { codexHookArgs } from "./codex-settings";
import { agentDelegationClause, renderAgentsJson, type AgentDef } from "./custom-agents";
import { guardSettings } from "./settings";
import { writeReadOnlyHook } from "./agent-readonly";
import { agentDefinitionHash } from "./agent-definition";
import {
  evidencePath, snapshotEvalEvidence, validateEvalEvidence, type AgentEvalEvidenceContext,
  type AgentEvalFinding, type EvalProbe, type EvalCommandVerification,
} from "./custom-agent-eval-evidence";
export type { AgentEvalEvidenceContext, AgentEvalFinding } from "./custom-agent-eval-evidence";

export type AgentEvalRuntime = "claude" | "codex";
export type AgentEvalCase = {
  id: string;
  agentName: string;
  task: string;
  expected: AgentEvalFinding[];
  forbidden: AgentEvalFinding[];
  fixtureDir: string;
  source: string;
  probe?: EvalProbe;
};

export type AgentEvalScore = {
  recall: number;
  forbiddenHitRate: number;
  matchedExpected: string[];
  missingExpected: string[];
  forbiddenHits: string[];
  passed: boolean;
  evidenceErrors: string[];
  commandVerifications: EvalCommandVerification[];
};

export type AgentEvalExecution = {
  runtime: AgentEvalRuntime;
  caseId: string;
  agentName: string;
  command: string;
  args: string[];
  cwd: string;
  task: string;
  eventDir: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
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
  model: string | null;
  /** Alias of evaluationDefinitionFingerprint: the actual config with its format protocol. */
  definitionFingerprint: string;
  productionDefinitionFingerprint: string;
  evaluationDefinitionFingerprint: string;
  /** SHA256 of the exact appended prompt suffix bytes. */
  protocolHash: string;
  baseSha: string;
  candidateSha: string;
};

export type AgentEvalSkippedCase = {
  id: string;
  agentName: string;
  runtime: AgentEvalRuntime;
  reason: string;
};

export type AgentEvalReport = {
  version: 2;
  runtime: AgentEvalRuntime;
  agentName: string | null;
  createdAt: string;
  sourceHashBefore: string;
  sourceHashAfter: string;
  passed: boolean;
  cases: AgentEvalCaseReport[];
  skipped: AgentEvalSkippedCase[];
};

export type RunCustomAgentEvaluationsOptions = {
  runtime: AgentEvalRuntime;
  agentName?: string;
  caseId?: string;
  outputPath?: string;
  runtimeBin?: string;
  clientVersion?: string | null;
  caseTimeoutMs?: number;
  evalRoot: string;
  cases: readonly AgentEvalCase[];
  execute?: AgentEvalExecutor;
};

const isInside = (parent: string, child: string): boolean => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

/** Resolve symlinks even when the final report file does not exist yet. */
const canonicalWritePath = (target: string): string => {
  let cursor = resolve(target);
  const missing: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`Ancestor output tidak ditemukan: ${target}`);
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(realpathSync(cursor), ...missing);
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
    if (!existsSync(fixturePath)
      || !isInside(realpathSync(evalRoot), realpathSync(fixturePath))) {
      throw new Error(`Fixture keluar eval root: ${entry.fixtureDir}`);
    }
    if (!existsSync(join(fixturePath, "base")) || !existsSync(join(fixturePath, "change"))) {
      throw new Error(`Fixture wajib memiliki base/ dan change/: ${entry.fixtureDir}`);
    }
    evidencePath(fixturePath, "base");
    evidencePath(fixturePath, "change");
    const findingIds = new Set<string>();
    for (const [kind, findings] of [["expected", entry.expected], ["forbidden", entry.forbidden]] as const) {
      if (!Array.isArray(findings)) throw new Error(`${entry.id}.${kind} wajib array`);
      for (const finding of findings) {
        assertString(finding?.id, `${entry.id}.${kind}.id`);
        if (findingIds.has(finding.id)) throw new Error(`ID finding duplikat: ${entry.id}/${finding.id}`);
        findingIds.add(finding.id);
        assertString(finding.claim, `${entry.id}/${finding.id}.claim`);
        if (!Array.isArray(finding.anchors) || (kind === "expected" && finding.anchors.length === 0)) {
          throw new Error(`${entry.id}/${finding.id} wajib punya anchor`);
        }
        for (const anchor of finding.anchors) {
          if (!["base", "candidate"].includes(anchor.revision) || !Number.isInteger(anchor.line) || anchor.line < 1) {
            throw new Error(`${entry.id}/${finding.id} anchor tidak valid`);
          }
          assertString(anchor.quote, "anchor.quote");
          const revision = anchor.revision === "base" ? "base" : "change";
          const revisionRoot = join(fixturePath, revision);
          const path = evidencePath(
            existsSync(join(revisionRoot, anchor.path)) ? revisionRoot : join(fixturePath, "base"), anchor.path,
          );
          if (readFileSync(path, "utf8").split(/\r?\n/)[anchor.line - 1] !== anchor.quote) {
            throw new Error(`${entry.id}/${finding.id} anchor tidak cocok dengan fixture`);
          }
        }
      }
    }
    if (entry.expected.length === 0) throw new Error(`${entry.id} wajib punya expected finding`);
  }
}

export function scoreAgentEvalCase(
  entry: AgentEvalCase, output: string, context?: AgentEvalEvidenceContext,
): AgentEvalScore {
  const evidence = validateEvalEvidence(entry, output, context);
  const missingExpected = entry.expected.filter((finding) => !evidence.matchedExpected.includes(finding.id)).map((f) => f.id);
  const recall = entry.expected.length === 0 ? 1 : evidence.matchedExpected.length / entry.expected.length;
  const forbiddenHitRate = entry.forbidden.length === 0 ? 0 : evidence.forbiddenHits.length / entry.forbidden.length;
  return {
    ...evidence, recall, forbiddenHitRate, missingExpected,
    passed: recall === 1 && evidence.forbiddenHits.length === 0 && evidence.evidenceErrors.length === 0,
  };
}

/** Hash every tracked and unignored source path in the checkout, not only eval fixtures. */
const hashGitCheckout = (root: string): string => {
  const hash = createHash("sha256");
  const result = spawnSync(
    "git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ls-files gagal: ${result.stderr}`);
  const paths = result.stdout.split("\0").filter(Boolean).sort();
  for (const rel of paths) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      hash.update(`missing:${rel}\0`);
      continue;
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) hash.update(`l:${rel}\0${readlinkSync(path)}\0`);
    else hash.update(`f:${stat.mode}:${rel}\0`).update(readFileSync(path));
  }
  return hash.digest("hex");
};

const copyContents = (source: string, destination: string): void => {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) {
    const path = evidencePath(source, name);
    if (lstatSync(path).isDirectory()) copyContents(path, join(destination, name));
    else cpSync(path, join(destination, name));
  }
};

const git = (cwd: string, args: string[]): void => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} gagal: ${result.stderr}`);
};

const gitTopLevel = (cwd: string): string => {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Source eval wajib berada di checkout git: ${result.stderr}`);
  }
  return realpathSync(resolve(result.stdout.trim()));
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
  if (runtime === "claude" && builtin.workspacePolicy === "isolated-worktree") {
    return "harness Claude restricted menghapus command tools dan penulisan child dalam plan mode belum didukung secara aman; replay artefak deklaratif offline tetap tersedia";
  }
  if (runtime === "codex" && builtin.workspacePolicy === "isolated-worktree") {
    return "isolated-worktree belum tersedia untuk subagent Codex";
  }
  return null;
};

export const executeAgentEvaluation: AgentEvalExecutor = (execution) => {
  const result = spawnSync(execution.command, execution.args, {
    cwd: execution.cwd,
    env: execution.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: execution.timeoutMs,
    killSignal: "SIGTERM",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.error ? `${result.stderr ?? ""}\n${result.error.message}` : (result.stderr ?? ""),
  };
};

const EVAL_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
  "TERM", "COLORTERM", "NO_COLOR", "CI", "SSH_AUTH_SOCK", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
]);
const EVAL_ENV_PREFIXES = [
  "ANTHROPIC_", "CLAUDE_", "OPENAI_", "CODEX_", "AZURE_OPENAI_", "AWS_", "GOOGLE_", "GCP_",
];

/** Keep runtime auth/connectivity, but discard inherited project cwd and tool-config pointers. */
const evaluationEnvironment = (repoDir: string, eventDir: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (EVAL_ENV_KEYS.has(key)
      || key.startsWith("LC_") || EVAL_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
      env[key] = value;
    }
  }
  env.PWD = repoDir;
  env.OLDPWD = repoDir;
  env.INIT_CWD = repoDir;
  env.HANOMAN_EVENT_DIR = eventDir;
  delete env.RIPGREP_CONFIG_PATH;
  return env;
};

const EVAL_CLAIMS: Record<string, string[]> = {
  scout: ["mirror-stale", "mirror-synchronized"],
  "blast-radius": ["manual-list-stale", "manual-list-synchronized"],
  "security-reviewer": ["ownership-missing", "ownership-enforced"],
  "qa-verifier": ["new-behavior-test-irrelevant", "new-behavior-test-discriminates", "preservation-test-valid", "preservation-invalid-because-base-green"],
  "root-causer": ["zero-lost-by-or-static", "zero-preserved-static", "experiment-executed"],
  "edge-case-hunter": ["idempotency-fails", "idempotency-preserved"],
  "spec-auditor": ["criterion-missing", "criterion-met", "criterion-already-met"],
  "dep-auditor": ["short-id-purpose-valid-safety-unknown", "runtime-uuid-equivalent", "runtime-only", "dependency-added", "local-advisory-affected-license-disallowed", "local-advisory-license-unknown", "live-cve-safe"],
};

const evaluationPromptSuffix = (entry: AgentEvalCase): string => "\n\n" + [
  "## Protokol format evaluasi",
  "Protokol ini HANYA mengganti penyajian keluaran untuk evaluasi ini: format laporan/prosa dan narasi serah-terima di atas diganti amplop JSON di bawah. Prosedur penalaran, scope, standar bukti, policy tool/workspace, larangan delegasi, dan batas pekerjaan produk tetap berlaku. Jangan tambahkan temuan, kepastian, atau eksekusi yang tidak dibuktikan.",
  'Keluaran final HARUS tepat SATU objek JSON murni. Jangan tulis pembuka Status, markdown, code fence, penjelasan prosa, atau teks sesudah JSON. Bentuk: {"version":1,"status":"complete","findings":[{"id":"<verdict>","status":"confirmed","claim":"<verdict>","anchors":[{"revision":"candidate","path":"relative/file","line":1,"quote":"tepat satu baris asli"}]}]}.',
  "Kunci amplop yang diizinkan hanya version, status, findings. version=1; status complete|partial|blocked. Kunci finding hanya id, status, claim, anchors, serta command bila tugas memang membutuhkan artefak eksekusi. status finding confirmed|unknown. Jangan tambahkan passed, summary, confidence, atau field lain. Bila bukti tidak cukup, gunakan partial/blocked atau unknown dan jangan mengarang anchor.",
  "id dan claim HARUS identik dan keduanya HARUS berisi tepat SATU string kosakata verdict di bawah. claim BUKAN kalimat bebas atau penjelasan temuan; penjelasan berbukti direpresentasikan oleh anchors. Pilih verdict berdasarkan hasil pemeriksaan, bukan karena ada di daftar; daftar memuat alternatif yang saling bertentangan.",
  `Kosakata verdict untuk tugas ini: ${(EVAL_CLAIMS[entry.agentName] ?? []).join(", ")}.`,
  "Setiap anchor memiliki revision base|candidate, path relatif ke root repo, line integer positif, quote berupa tepat satu baris UTUH asli pada lokasi tersebut. Sertakan seluruh jangkar terkait simpulan: deklarasi sumber dan cermin/consumer, requirement, manifest/lockfile atau sumber primer bila relevan. Jangan kutip label path fiktif. Jangan gunakan field tambahan atau prosa sebagai pengganti jangkar.",
  ...(entry.probe ? [
    "Evidence command adalah {cwd,artifact:'cases.json',baseExit,candidateExit,mutantExit}. cwd relatif ke root repo parent fixture ('.' jika sama). Laporkan lokasi nyata worktree child; jangan hapus worktree sebelum harness memeriksa artefak. Command yang diuji: node --test test.cjs. Harness mereplay runner/app fixture immutable dengan artefak JSON tervalidasi pada base, kandidat, dan mutant; stdout yang diklaim tidak menjadi bukti. Replay mengevaluasi test berbasis data, bukan arbitrary kode test. Jangan edit app.cjs atau test.cjs; perbarui hanya cases.json. Mutant mengganti normalizer dengan return 'BROKEN', atau receiver dengan ledger array tanpa deduplikasi. Nilai exit Node: 0 lulus, 1 gagal.",
  ] : ["Jangan sertakan command/claim eksekusi: profil ini dinilai lewat inspeksi statis saja."]),
].join("\n\n");

const requiredDelegation = (
  entry: AgentEvalCase, runtime: AgentEvalRuntime, baseSha: string, candidateSha: string,
): string => [
  entry.task,
  agentDelegationClause([builtinAgentDef(entry.agentName, runtime)], runtime),
  "## Kontrak evaluasi",
  `Base SHA: ${baseSha}. Kandidat SHA: ${candidateSha}. Harness mengabadikan SELURUH overlay dirty fixture ke commit temp kandidat; child worktree wajib mulai dari kandidat ini. Scope hanya repo fixture. Bukti sebelumnya: observasi/file fixture yang tersedia; tidak ada eksperimen model sebelumnya.`,
  evaluationPromptSuffix(entry),
  runtime === "codex"
    ? `WAJIB panggil subagent \`${entry.agentName}\` tepat satu kali lewat \`spawn_agent\`.`
    : `WAJIB panggil subagent \`${entry.agentName}\` tepat satu kali lewat tool Task.`,
  ...(runtime === "codex" ? [
    "Bila spawn_agent membalas error transient `no thread with id`, JANGAN spawn lagi: child mungkin sudah dijadwalkan. Gunakan `wait_agent` satu kali dengan timeout 30 detik; bila tidak ada child, laporkan kegagalan.",
  ] : []),
  "Jangan menyelesaikan tugas sendiri. Tunggu child selesai, lalu kembalikan hasil child tanpa mengubah substansinya.",
].join("\n\n");

type EvalLifecycle = {
  hook_event_name?: unknown;
  agent_id?: unknown;
  agent_type?: unknown;
  last_assistant_message?: unknown;
  result?: unknown;
};

const attributedChildOutput = (
  eventDir: string,
  agentName: string,
): { output: string; error: string | null } => {
  const events: EvalLifecycle[] = [];
  for (const name of readdirSync(eventDir).filter((entry) => entry.endsWith(".json")).sort()) {
    try {
      const path = evidencePath(eventDir, name);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        events.push(parsed as EvalLifecycle);
      }
    } catch { /* malformed hook output cannot establish attribution */ }
  }
  const starts = events.filter((event) => event.hook_event_name === "SubagentStart"
    && event.agent_type === agentName && typeof event.agent_id === "string");
  if (starts.length !== 1) {
    return { output: "", error: `lifecycle ${agentName}: butuh tepat satu SubagentStart, dapat ${starts.length}` };
  }
  const agentId = starts[0]!.agent_id;
  const stops = events.filter((event) => event.hook_event_name === "SubagentStop"
    && event.agent_id === agentId
    && (event.agent_type === undefined || event.agent_type === agentName));
  if (stops.length !== 1) {
    return { output: "", error: `lifecycle ${agentName}: butuh tepat satu SubagentStop berpasangan, dapat ${stops.length}` };
  }
  const raw = stops[0]!.last_assistant_message ?? stops[0]!.result;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { output: "", error: `lifecycle ${agentName}: SubagentStop tidak membawa hasil child` };
  }
  return { output: raw, error: null };
};

const executionFor = (
  runtime: AgentEvalRuntime,
  entry: AgentEvalCase,
  repoDir: string,
  configDir: string,
  eventDir: string,
  runtimeBin: string,
  timeoutMs: number,
  baseSha: string,
  candidateSha: string,
  clientVersion?: string | null,
): AgentEvalExecution => {
  const def = builtinAgentDef(entry.agentName, runtime);
  const promptSuffix = evaluationPromptSuffix(entry);
  const task = requiredDelegation(entry, runtime, baseSha, candidateSha);
  const readOnlyHookCommand = writeReadOnlyHook(configDir).command;
  const env = evaluationEnvironment(repoDir, eventDir);
  if (runtime === "claude") {
    const rendered = renderAgentsJson([def], { readOnlyHookCommand, promptSuffix });
    return {
      runtime, caseId: entry.id, agentName: entry.agentName, command: runtimeBin, cwd: repoDir, task,
      eventDir, env, timeoutMs,
      args: [
        "--print", "--agents", rendered,
        "--restricted", "--permission-mode", "plan",
        // --tools limits the native child registry too. Keep only delegation + static reads;
        // --allowedTools approves those tools but cannot restore removed availability.
        "--tools", "Task,Read,Glob,Grep", "--allowedTools", "Task,Read,Glob,Grep",
        "--settings", JSON.stringify(guardSettings(undefined, undefined, true)),
        task,
      ],
    };
  }
  const rendered = materializeCodexAgents([def], configDir, { clientVersion, readOnlyHookCommand, promptSuffix });
  if (rendered.liveDefs.length !== 1) {
    throw new Error(`Agent ${entry.agentName} tidak dapat dimaterialisasi untuk Codex`);
  }
  return {
    runtime, caseId: entry.id, agentName: entry.agentName, command: runtimeBin, cwd: repoDir, task,
    eventDir, env, timeoutMs,
    // Eval memanggil Codex langsung (bukan lewat agentFlags sesi), jadi trust untuk hook temp
    // milik Hanoman dipasang tepat sekali di sini.
    args: [
      "exec", ...rendered.args, ...codexHookArgs({ eventHook: true }),
      "--sandbox", "read-only", "--ignore-user-config", "--ignore-rules",
      "-c", 'approval_policy="never"', "--dangerously-bypass-hook-trust", task,
    ],
  };
};

export async function runCustomAgentEvaluations(options: RunCustomAgentEvaluationsOptions): Promise<{
  reportPath: string;
  exitCode: 0 | 1;
  cases: AgentEvalCaseReport[];
  skipped: AgentEvalSkippedCase[];
}> {
  const evalRoot = resolve(options.evalRoot);
  validateAgentEvalManifest(options.cases, evalRoot);
  const requested = options.cases.filter((entry) => (!options.agentName || entry.agentName === options.agentName)
    && (!options.caseId || entry.id === options.caseId));
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
  if (selected.length > 0 && options.runtime === "codex" && !codexNativeAgentsSupported(options.clientVersion ?? null)) {
    throw new Error(
      `Codex ${options.clientVersion ?? "tak terdeteksi"} tidak mendukung custom agent native; `
      + `butuh >= ${CODEX_NATIVE_AGENTS_MIN_CLIENT}`,
    );
  }
  const caseTimeoutMs = options.caseTimeoutMs ?? 180_000;
  if (!Number.isInteger(caseTimeoutMs) || caseTimeoutMs < 1) {
    throw new Error("caseTimeoutMs wajib integer positif");
  }

  const reportPath = options.outputPath
    ? resolve(options.outputPath)
    : join(mkdtempSync(join(tmpdir(), "hanoman-agent-eval-report-")), "report.json");
  const safeReportPath = canonicalWritePath(reportPath);
  const checkoutRoot = gitTopLevel(evalRoot);
  if (isInside(checkoutRoot, safeReportPath)) {
    throw new Error("Output report tidak boleh berada di source checkout");
  }

  const sourceHashBefore = hashGitCheckout(checkoutRoot);
  const reports: AgentEvalCaseReport[] = [];
  let sourceHashAfter = sourceHashBefore;
  let interrupted: unknown;
  try {
    for (const entry of selected) {
      const tempRoot = mkdtempSync(join(tmpdir(), `hanoman-agent-eval-${entry.id}-`));
      const repoDir = join(tempRoot, "repo");
      const configDir = join(tempRoot, "agent-config");
      const eventDir = join(tempRoot, "events");
      try {
        mkdirSync(repoDir, { recursive: true });
        mkdirSync(configDir, { recursive: true });
        mkdirSync(eventDir, { recursive: true, mode: 0o700 });
        const fixtureRoot = resolve(evalRoot, entry.fixtureDir);
        copyContents(join(fixtureRoot, "base"), repoDir);
        git(repoDir, ["init", "--quiet"]);
        git(repoDir, ["config", "user.email", "agent-eval@hanoman.local"]);
        git(repoDir, ["config", "user.name", "Hanoman Agent Eval"]);
        git(repoDir, ["add", "--all"]);
        git(repoDir, ["commit", "--quiet", "-m", "eval base"]);
        const baseSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).stdout.trim();
        copyContents(join(fixtureRoot, "change"), repoDir);
        // Native isolation branches from HEAD; leaving the overlay dirty silently evaluates base instead.
        git(repoDir, ["add", "--all"]);
        git(repoDir, ["commit", "--quiet", "--allow-empty", "-m", "eval candidate including dirty overlay"]);
        const candidateSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).stdout.trim();
        const candidateDir = join(tempRoot, "candidate-evidence");
        copyContents(join(fixtureRoot, "base"), candidateDir);
        copyContents(join(fixtureRoot, "change"), candidateDir);
        const execution = executionFor(
          options.runtime, entry, repoDir, configDir,
          eventDir,
          options.runtimeBin ?? options.runtime,
          caseTimeoutMs,
          baseSha, candidateSha,
          options.clientVersion,
        );
        const evidenceContext = snapshotEvalEvidence({
          baseDir: join(fixtureRoot, "base"), candidateDir, artifactRoot: repoDir,
        });
        let result: AgentEvalExecutionResult;
        try { result = await (options.execute ?? executeAgentEvaluation)(execution); }
        catch (error) { result = { status: 1, stdout: "", stderr: String(error) }; }
        const attributed = attributedChildOutput(eventDir, entry.agentName);
        const status = attributed.error ? 1 : result.status;
        const score = scoreAgentEvalCase(entry, attributed.output, evidenceContext);
        const def = builtinAgentDef(entry.agentName, options.runtime);
        const promptSuffix = evaluationPromptSuffix(entry);
        const evaluationDefinitionFingerprint = agentDefinitionHash(def, [def], options.runtime, { promptSuffix });
        reports.push({
          id: entry.id,
          agentName: entry.agentName,
          runtime: options.runtime,
          model: def.model ?? null,
          definitionFingerprint: evaluationDefinitionFingerprint,
          productionDefinitionFingerprint: agentDefinitionHash(def, [def], options.runtime),
          evaluationDefinitionFingerprint,
          protocolHash: createHash("sha256").update(promptSuffix).digest("hex"),
          baseSha, candidateSha,
          status,
          stderr: [result.stderr, attributed.error].filter(Boolean).join("\n"),
          output: attributed.output,
          score: { ...score, passed: score.passed && status === 0 },
        });
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  } catch (error) {
    interrupted = error;
    throw error;
  } finally {
    // Runs after attribution, replay and cleanup failures too; never let them hide source damage.
    sourceHashAfter = hashGitCheckout(checkoutRoot);
    if (sourceHashBefore !== sourceHashAfter) {
      throw new Error("Source eval berubah selama harness berjalan", { cause: interrupted });
    }
  }
  const passed = reports.length > 0 && reports.every((entry) => entry.status === 0 && entry.score.passed);
  const report: AgentEvalReport = {
    version: 2,
    runtime: options.runtime,
    agentName: options.agentName ?? null,
    createdAt: new Date().toISOString(),
    sourceHashBefore,
    sourceHashAfter,
    passed,
    cases: reports,
    skipped,
  };
  mkdirSync(dirname(safeReportPath), { recursive: true });
  const tempReportPath = join(
    dirname(safeReportPath), `.${basename(safeReportPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(tempReportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    renameSync(tempReportPath, safeReportPath);
  } finally {
    rmSync(tempReportPath, { force: true });
  }
  return { reportPath, exitCode: passed ? 0 : 1, cases: reports, skipped };
}
