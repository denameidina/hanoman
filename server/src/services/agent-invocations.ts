import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  AGENT_DISPOSITIONS, type Agent, type AgentDisposition, type AgentInvocationView,
  type AgentMetricView, type AgentMetricsView,
} from "@hanoman/shared";
import { prisma } from "../db";

const MAX_EXCERPT_BYTES = 4_096;
const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;
const ANSI = /[\u001b\u009b](?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g;

type InvocationIdentity = {
  sessionId: string; projectId: string; specId?: string; runtime: Agent;
  runtimeInvocationId: string; customAgentId?: string; agentName: string; model?: string;
  cwd: string;
};
export type InvocationStart = InvocationIdentity & { startedAt?: Date };
export type InvocationStop = InvocationIdentity & {
  endedAt?: Date; status?: "completed" | "interrupted"; result?: string; transcriptPath?: string;
};

type Io = {
  gitStatus?: (cwd: string) => string | null;
  transcriptRoots?: string[];
};

const snapshotHashes = new Map<string, string>();
const keyOf = (x: Pick<InvocationIdentity, "sessionId" | "runtimeInvocationId">): string =>
  `${x.sessionId}\0${x.runtimeInvocationId}`;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

const defaultGitStatus = (cwd: string): string | null => {
  try {
    return execFileSync("git", ["-C", cwd, "status", "--porcelain=v1", "-z"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch { return null; }
};

function snapshot(cwd: string, run = defaultGitStatus): string | null {
  try {
    const value = run(cwd);
    return value === null ? null : hash(value);
  } catch { return null; }
}

const stripAnsi = (value: string): string => value.replace(ANSI, "");
const utf8Prefix = (value: string, maxBytes: number): string => {
  let out = "", bytes = 0;
  for (const char of value) {
    const next = Buffer.byteLength(char, "utf8");
    if (bytes + next > maxBytes) break;
    out += char; bytes += next;
  }
  return out;
};

const transcriptRoots = (): string[] => [
  resolve(process.env.CLAUDE_CONFIG_DIR ?? `${homedir()}/.claude`),
  resolve(process.env.CODEX_HOME ?? `${homedir()}/.codex`),
];

const inside = (path: string, root: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

type Usage = { inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null };
const EMPTY_USAGE: Usage = { inputTokens: null, outputTokens: null, cachedTokens: null };
const nonnegativeInt = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

function usageFromText(text: string): Usage {
  const found: number[][] = [];
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const usage = record.usage;
    if (usage && typeof usage === "object") {
      const u = usage as Record<string, unknown>;
      found.push([
        nonnegativeInt(u.input_tokens ?? u.inputTokens) ?? -1,
        nonnegativeInt(u.output_tokens ?? u.outputTokens) ?? -1,
        nonnegativeInt(u.cached_tokens ?? u.cachedTokens
          ?? u.cache_read_input_tokens ?? u.cacheReadInputTokens) ?? -1,
      ]);
    }
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { inspect(JSON.parse(line)); } catch { /* transcript campuran sah; bentuk asing diabaikan */ }
  }
  if (found.length === 0) return EMPTY_USAGE;
  const max = (index: number): number | null => {
    const values = found.map((entry) => entry[index]!).filter((n) => n >= 0);
    return values.length ? Math.max(...values) : null;
  };
  return { inputTokens: max(0), outputTokens: max(1), cachedTokens: max(2) };
}

function transcriptUsage(path: string | undefined, roots = transcriptRoots()): Usage {
  if (!path) return EMPTY_USAGE;
  try {
    const real = realpathSync(path);
    const safeRoots = roots.map((root) => realpathSync(root));
    if (!safeRoots.some((root) => inside(real, root))) return EMPTY_USAGE;
    const info = statSync(real);
    if (!info.isFile() || info.size > MAX_TRANSCRIPT_BYTES) return EMPTY_USAGE;
    return usageFromText(readFileSync(real, "utf8"));
  } catch { return EMPTY_USAGE; }
}

export async function startAgentInvocation(input: InvocationStart, io: Io = {}) {
  const startedAt = input.startedAt ?? new Date();
  const existing = await prisma.agentInvocation.findUnique({
    where: { sessionId_runtimeInvocationId: {
      sessionId: input.sessionId, runtimeInvocationId: input.runtimeInvocationId,
    } },
  });
  const row = await prisma.agentInvocation.upsert({
    where: { sessionId_runtimeInvocationId: {
      sessionId: input.sessionId, runtimeInvocationId: input.runtimeInvocationId,
    } },
    update: {},
    create: {
      id: randomUUID(), sessionId: input.sessionId, projectId: input.projectId,
      specId: input.specId ?? null, runtime: input.runtime,
      runtimeInvocationId: input.runtimeInvocationId,
      customAgentId: input.customAgentId ?? null, agentName: input.agentName,
      model: input.model ?? null, status: "running", startedAt,
    },
  });
  const before = snapshot(input.cwd, io.gitStatus);
  if (before !== null) snapshotHashes.set(keyOf(input), before);
  return { row, duplicate: existing !== null };
}

export async function stopAgentInvocation(input: InvocationStop, io: Io = {}) {
  const unique = { sessionId_runtimeInvocationId: {
    sessionId: input.sessionId, runtimeInvocationId: input.runtimeInvocationId,
  } };
  const existing = await prisma.agentInvocation.findUnique({ where: unique });
  if (existing?.endedAt) return { row: existing, duplicate: true };
  const endedAt = input.endedAt ?? new Date();
  const startedAt = existing?.startedAt ?? endedAt;
  const cleanResult = input.result === undefined ? null : stripAnsi(input.result);
  const usage = transcriptUsage(input.transcriptPath, io.transcriptRoots);
  const before = snapshotHashes.get(keyOf(input));
  const after = snapshot(input.cwd, io.gitStatus);
  snapshotHashes.delete(keyOf(input));
  const evidence = {
    // Stop tanpa start lazim setelah restart server di tengah invocation. Waktu start dan status
    // runtime sudah hilang; simpan baris sintetis yang dapat diaudit tanpa mengarang durasi 0 ms.
    status: existing ? (input.status ?? "completed") : "completed", endedAt,
    durationMs: existing ? Math.max(0, endedAt.getTime() - startedAt.getTime()) : null,
    ...usage,
    resultExcerpt: cleanResult === null ? null : utf8Prefix(cleanResult, MAX_EXCERPT_BYTES),
    resultHash: cleanResult === null ? null : hash(cleanResult),
    workspaceChanged: before !== undefined && after !== null && before !== after,
  };
  if (existing) {
    const row = await prisma.agentInvocation.update({ where: { id: existing.id }, data: evidence });
    return { row, duplicate: false };
  }
  const row = await prisma.agentInvocation.create({
    data: {
      id: randomUUID(), sessionId: input.sessionId, projectId: input.projectId,
      specId: input.specId ?? null, runtime: input.runtime,
      runtimeInvocationId: input.runtimeInvocationId,
      customAgentId: input.customAgentId ?? null, agentName: input.agentName,
      model: input.model ?? null, startedAt, ...evidence,
    },
  });
  return { row, duplicate: false };
}

export async function reconcileAgentInvocations(liveSessionIds: string[]): Promise<number> {
  const live = new Set(liveSessionIds);
  const open = await prisma.agentInvocation.findMany({ where: { status: "running" } });
  let changed = 0;
  const endedAt = new Date();
  for (const row of open) {
    if (live.has(row.sessionId)) continue;
    await prisma.agentInvocation.update({
      where: { id: row.id }, data: {
        status: "abandoned", endedAt,
        durationMs: Math.max(0, endedAt.getTime() - row.startedAt.getTime()),
      },
    });
    changed++;
  }
  return changed;
}

type Row = Awaited<ReturnType<typeof prisma.agentInvocation.findFirstOrThrow>>;
export const agentInvocationView = (row: Row): AgentInvocationView => ({
  id: row.id, sessionId: row.sessionId, projectId: row.projectId, specId: row.specId,
  runtime: row.runtime === "codex" ? "codex" : "claude",
  customAgentId: row.customAgentId, agentName: row.agentName, model: row.model,
  status: row.status, startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null, durationMs: row.durationMs,
  inputTokens: row.inputTokens, outputTokens: row.outputTokens, cachedTokens: row.cachedTokens,
  resultExcerpt: row.resultExcerpt, resultHash: row.resultHash,
  workspaceChanged: row.workspaceChanged,
  disposition: AGENT_DISPOSITIONS.includes(row.disposition as AgentDisposition)
    ? row.disposition as AgentDisposition : "pending",
  dispositionNote: row.dispositionNote, evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
});

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2;
};
const availableSum = (values: Array<number | null>): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

export async function agentMetrics(query: {
  projectId?: string; from?: Date; to?: Date;
}): Promise<AgentMetricsView> {
  const where = {
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.from || query.to ? { startedAt: {
      ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}),
    } } : {}),
  };
  const rows = await prisma.agentInvocation.findMany({ where, orderBy: { startedAt: "desc" } });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.agentName, [...(groups.get(row.agentName) ?? []), row]);
  const agents: AgentMetricView[] = [...groups.entries()].map(([agentName, invocations]) => {
    const dispositions = { pending: 0, accepted: 0, partial: 0, rejected: 0, falsePositive: 0 };
    for (const row of invocations) {
      if (row.disposition === "accepted") dispositions.accepted++;
      else if (row.disposition === "partial") dispositions.partial++;
      else if (row.disposition === "rejected") dispositions.rejected++;
      else if (row.disposition === "false-positive") dispositions.falsePositive++;
      else dispositions.pending++;
    }
    const evaluated = dispositions.accepted + dispositions.partial
      + dispositions.rejected + dispositions.falsePositive;
    return {
      agentName, invocationCount: invocations.length,
      medianDurationMs: median(invocations.flatMap((row) =>
        row.durationMs === null ? [] : [row.durationMs])),
      inputTokens: availableSum(invocations.map((row) => row.inputTokens)),
      outputTokens: availableSum(invocations.map((row) => row.outputTokens)),
      cachedTokens: availableSum(invocations.map((row) => row.cachedTokens)),
      dispositions,
      operationalPrecision: evaluated
        ? (dispositions.accepted + dispositions.partial) / evaluated : null,
      workspaceChanged: invocations.some((row) => row.workspaceChanged),
    };
  }).sort((a, b) => a.agentName.localeCompare(b.agentName));
  return { agents, recent: rows.slice(0, 100).map(agentInvocationView) };
}

export async function updateAgentInvocationDisposition(
  id: string,
  disposition: Exclude<AgentDisposition, "pending">,
  note?: string | null,
): Promise<AgentInvocationView | null> {
  const exists = await prisma.agentInvocation.findUnique({ where: { id } });
  if (!exists) return null;
  const row = await prisma.agentInvocation.update({
    where: { id }, data: {
      disposition, dispositionNote: note?.trim() || null, evaluatedAt: new Date(),
    },
  });
  return agentInvocationView(row);
}

export function __resetInvocationSnapshots(): void { snapshotHashes.clear(); }
