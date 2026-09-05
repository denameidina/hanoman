import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type EvalAnchor = { revision: "base" | "candidate"; path: string; line: number; quote: string };
export type EvalCommandExpectation = {
  baseExit: number;
  candidateExit: number;
  mutantExit: number;
  requiredCases: unknown[];
  requiredScenario?: "duplicate-delivery";
};
export type AgentEvalFinding = {
  id: string;
  /** A bounded semantic verdict, never a bag of words to match across the report. */
  claim: string;
  anchors: EvalAnchor[];
  command?: EvalCommandExpectation;
};
export type EvalProbe = { kind: "normalize-email" | "deliveries"; mutantApp: string };
export type AgentEvalEvidenceContext = {
  baseDir: string;
  candidateDir: string;
  /** Only artifacts may be read here; executable bytes always come from immutable snapshots. */
  artifactRoot?: string;
  snapshots?: { base: Readonly<Record<string, string>>; candidate: Readonly<Record<string, string>> };
};
export type EvalCommandVerification = {
  findingId: string;
  artifactHash: string;
  baseExit: number;
  candidateExit: number;
  mutantExit: number;
  outputHashes: string[];
  authority: "harness-replay-of-declarative-artifact";
};

type EvidenceCase = { expected: AgentEvalFinding[]; forbidden: AgentEvalFinding[]; probe?: EvalProbe };
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: RecordValue, allowed: string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
const same = (left: unknown, right: unknown): boolean => {
  if (object(left) && object(right)) {
    return Object.keys(left).length === Object.keys(right).length
      && Object.keys(left).every((key) => Object.hasOwn(right, key) && same(left[key], right[key]));
  }
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => same(value, right[index]));
  return left === right;
};
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Every path component must be ordinary: realpath containment alone still accepts internal symlinks. */
export const evidencePath = (root: string, path: string): string => {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..") || path.includes("\\")) {
    throw new Error(`Unsafe evidence path: ${path}`);
  }
  const canonicalRoot = realpathSync(root);
  const target = resolve(canonicalRoot, path);
  const rel = relative(canonicalRoot, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Evidence escapes root");
  let cursor = canonicalRoot;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("Symlink evidence is forbidden");
  }
  if (realpathSync(target) !== target) throw new Error("Evidence realpath mismatch");
  return target;
};

const textFile = (root: string, path: string): string => {
  const target = evidencePath(root, path);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Evidence must be a bounded regular file");
  return readFileSync(target, "utf8");
};

/** Capture trusted bytes before invoking any runtime; children cannot replace replay executables. */
export const snapshotEvalEvidence = (context: AgentEvalEvidenceContext): AgentEvalEvidenceContext => {
  const capture = (root: string): Readonly<Record<string, string>> => {
    const files: Record<string, string> = Object.create(null);
    const visit = (dir: string): void => {
      for (const name of readdirSync(join(root, dir))) {
        const path = dir ? `${dir}/${name}` : name;
        const actual = evidencePath(root, path);
        if (lstatSync(actual).isDirectory()) visit(path);
        else files[path] = textFile(root, path);
      }
    };
    visit("");
    return Object.freeze(files);
  };
  return { ...context, snapshots: { base: capture(context.baseDir), candidate: capture(context.candidateDir) } };
};

const evidenceText = (context: AgentEvalEvidenceContext, revision: "base" | "candidate", path: string): string => {
  if (context.snapshots) {
    const files = context.snapshots[revision];
    if (!Object.hasOwn(files, path)) throw new Error("Path absent from trusted snapshot");
    return files[path]!;
  }
  return textFile(revision === "base" ? context.baseDir : context.candidateDir, path);
};

const anchorValid = (anchor: unknown, context: AgentEvalEvidenceContext): anchor is EvalAnchor => {
  if (!object(anchor) || !keys(anchor, ["revision", "path", "line", "quote"])
    || (anchor.revision !== "base" && anchor.revision !== "candidate")
    || typeof anchor.path !== "string" || typeof anchor.quote !== "string"
    || !Number.isInteger(anchor.line) || Number(anchor.line) < 1) return false;
  try {
    return evidenceText(context, anchor.revision, anchor.path)
      .split(/\r?\n/)[Number(anchor.line) - 1] === anchor.quote;
  } catch { return false; }
};

const validCases = (value: unknown, probe: EvalProbe): value is RecordValue[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return false;
  return value.every((sample) => {
    if (!object(sample)) return false;
    if (probe.kind === "normalize-email") {
      return keys(sample, ["input", "expected"]) && typeof sample.input === "string"
        && sample.input.length <= 1000 && typeof sample.expected === "string" && sample.expected.length <= 1000;
    }
    return keys(sample, ["deliveries", "expectedCount"]) && Array.isArray(sample.deliveries)
      && sample.deliveries.length <= 32 && sample.deliveries.every((id) => typeof id === "string" && id.length <= 100)
      && Number.isInteger(sample.expectedCount) && Number(sample.expectedCount) >= 0 && Number(sample.expectedCount) <= 32;
  });
};

/** Executes only trusted shipped app/runner bytes + validated JSON; model JS is never replayed. */
const runProbe = (app: string, runner: string, samples: unknown[]): { exit: number; outputHash: string } => {
  const root = mkdtempSync(join(tmpdir(), "hanoman-eval-probe-"));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "app.cjs"), app);
    writeFileSync(join(root, "test.cjs"), runner);
    writeFileSync(join(root, "cases.json"), JSON.stringify(samples));
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "test.cjs"], {
      cwd: root,
      // No inherited NODE_OPTIONS, runtime credentials, or host config pointers.
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, NODE_ENV: "test" },
      encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.signal || ![0, 1].includes(result.status ?? -1)
      || !/^# tests [1-9]\d*$/m.test(result.stdout)) throw new Error("Probe did not complete Node tests");
    return { exit: result.status!, outputHash: hash(result.stdout + result.stderr) };
  } finally { rmSync(root, { recursive: true, force: true }); }
};

const verifyCommand = (
  finding: AgentEvalFinding, command: unknown, probe: EvalProbe | undefined, context: AgentEvalEvidenceContext,
): EvalCommandVerification | null => {
  const expected = finding.command;
  if (!expected || !probe || !context.artifactRoot || !object(command)
    || !keys(command, ["cwd", "artifact", "baseExit", "candidateExit", "mutantExit"])
    || typeof command.cwd !== "string" || typeof command.artifact !== "string"
    || !command.artifact.endsWith(".json")) return null;
  try {
    const cwd = evidencePath(context.artifactRoot, command.cwd);
    const artifact = textFile(cwd, command.artifact);
    const samples: unknown = JSON.parse(artifact);
    if (!validCases(samples, probe) || !expected.requiredCases.every((sample) => samples.some((actual) => same(actual, sample)))) return null;
    if (expected.requiredScenario === "duplicate-delivery" && !samples.some((sample) =>
      Array.isArray(sample.deliveries) && sample.deliveries.length >= 2
      && new Set(sample.deliveries).size === 1 && sample.expectedCount === 1)) return null;
    // Native worktree must actually contain the candidate, not an older base or an edited implementation.
    if (textFile(cwd, "app.cjs") !== evidenceText(context, "candidate", "app.cjs")) return null;
    const runner = evidenceText(context, "candidate", "test.cjs");
    const outputs = [
      runProbe(evidenceText(context, "base", "app.cjs"), runner, samples),
      runProbe(evidenceText(context, "candidate", "app.cjs"), runner, samples),
      runProbe(probe.mutantApp, runner, samples),
    ];
    const [base, candidate, mutant] = outputs;
    if (base!.exit !== expected.baseExit || candidate!.exit !== expected.candidateExit || mutant!.exit !== expected.mutantExit
      || command.baseExit !== base!.exit || command.candidateExit !== candidate!.exit || command.mutantExit !== mutant!.exit) return null;
    return {
      findingId: finding.id, artifactHash: hash(artifact), baseExit: base!.exit, candidateExit: candidate!.exit,
      mutantExit: mutant!.exit, outputHashes: outputs.map((result) => result.outputHash),
      authority: "harness-replay-of-declarative-artifact",
    };
  } catch { return null; }
};

export function validateEvalEvidence(entry: EvidenceCase, output: string, context?: AgentEvalEvidenceContext): {
  matchedExpected: string[]; forbiddenHits: string[]; evidenceErrors: string[]; commandVerifications: EvalCommandVerification[];
} {
  const matchedExpected: string[] = [];
  const forbiddenHits: string[] = [];
  const evidenceErrors: string[] = [];
  const commandVerifications: EvalCommandVerification[] = [];
  let envelope: unknown;
  try { envelope = JSON.parse(output); } catch { evidenceErrors.push("Output must be a JSON evidence envelope"); }
  if (!object(envelope) || !keys(envelope, ["version", "status", "findings"])
    || envelope.version !== 1 || envelope.status !== "complete" || !Array.isArray(envelope.findings)
    || envelope.findings.length > 12) {
    evidenceErrors.push("Invalid or incomplete evidence envelope");
    return { matchedExpected, forbiddenHits, evidenceErrors, commandVerifications };
  }
  if (!context) evidenceErrors.push("Fixture evidence context is required");
  const seen = new Set<string>();
  for (const raw of envelope.findings) {
    if (!object(raw) || !keys(raw, ["id", "status", "claim", "anchors", "command"])
      || typeof raw.id !== "string" || typeof raw.claim !== "string" || raw.status !== "confirmed"
      || !Array.isArray(raw.anchors) || seen.has(raw.id)) {
      evidenceErrors.push("Invalid, duplicated, or unconfirmed finding"); continue;
    }
    seen.add(raw.id);
    const forbidden = entry.forbidden.find((finding) => finding.claim === raw.claim);
    if (forbidden) { forbiddenHits.push(forbidden.id); continue; }
    const finding = entry.expected.find((candidate) => candidate.id === raw.id && candidate.claim === raw.claim);
    if (!finding || !context) { evidenceErrors.push(`Unknown or ungrounded claim: ${raw.id}`); continue; }
    const anchors = raw.anchors;
    if (!anchors.every((anchor) => anchorValid(anchor, context))
      || !finding.anchors.every((required) => anchors.some((actual: unknown) =>
        object(actual) && actual.revision === required.revision && actual.path === required.path
        && actual.line === required.line && actual.quote === required.quote))) {
      evidenceErrors.push(`Invalid/scopeless anchors: ${raw.id}`); continue;
    }
    if (finding.command) {
      const verified = verifyCommand(finding, raw.command, entry.probe, context);
      if (!verified) { evidenceErrors.push(`Command artifact could not be verified: ${raw.id}`); continue; }
      commandVerifications.push(verified);
    } else if (raw.command !== undefined) { evidenceErrors.push(`Unexpected execution claim: ${raw.id}`); continue; }
    matchedExpected.push(finding.id);
  }
  return { matchedExpected, forbiddenHits, evidenceErrors, commandVerifications };
}
