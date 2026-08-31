import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "../src/db";
import {
  __resetInvocationSnapshots, reconcileAgentInvocations, startAgentInvocation,
  stopAgentInvocation,
} from "../src/services/agent-invocations";

const base = {
  sessionId: "s1", projectId: "p1", specId: "SPEC-1", runtime: "claude" as const,
  runtimeInvocationId: "run-1", customAgentId: "global:scout", agentName: "scout",
  model: "haiku", cwd: "/worktree",
};

beforeEach(async () => {
  await prisma.agentInvocation.deleteMany();
  __resetInvocationSnapshots();
});
afterAll(async () => { await prisma.agentInvocation.deleteMany(); });

describe("lifecycle AgentInvocation", () => {
  it("start/stop idempoten dan menghitung durasi tanpa menimpa stop pertama", async () => {
    const startedAt = new Date("2026-08-31T01:00:00.000Z");
    const endedAt = new Date("2026-08-31T01:00:01.500Z");
    await startAgentInvocation({ ...base, startedAt }, { gitStatus: () => "clean" });
    await startAgentInvocation({ ...base, startedAt }, { gitStatus: () => "clean" });
    await stopAgentInvocation({ ...base, endedAt, result: "\u001b[31mtemuan\u001b[0m" }, {
      gitStatus: () => "clean",
    });
    await stopAgentInvocation({ ...base, endedAt: new Date(endedAt.getTime() + 9_000), result: "lain" });

    const rows = await prisma.agentInvocation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", durationMs: 1500, resultExcerpt: "temuan" });
  });

  it("stop tanpa start membuat baris sintetis yang tetap dapat diaudit", async () => {
    const endedAt = new Date("2026-08-31T02:00:00.000Z");
    await stopAgentInvocation({ ...base, runtimeInvocationId: "orphan", endedAt, status: "interrupted" });
    const row = await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "orphan" } });
    expect(row).toMatchObject({ status: "interrupted", durationMs: 0 });
    expect(row.startedAt).toEqual(endedAt);
    expect(row.endedAt).toEqual(endedAt);
  });

  it("strip ANSI, memotong excerpt aman UTF-8 di 4 KiB, dan hash hasil penuh", async () => {
    const full = `\u001b[32m${"😀".repeat(1_100)}akhir\u001b[0m`;
    await stopAgentInvocation({ ...base, result: full });
    const row = await prisma.agentInvocation.findFirstOrThrow();
    expect(Buffer.byteLength(row.resultExcerpt!, "utf8")).toBeLessThanOrEqual(4_096);
    expect(row.resultExcerpt!.endsWith("�")).toBe(false);
    expect(row.resultHash).toBe(createHash("sha256").update(`${"😀".repeat(1_100)}akhir`).digest("hex"));
  });

  it("membaca usage JSON hanya dari transcript allowlisted di bawah 10 MiB", async () => {
    const root = mkdtempSync(join(tmpdir(), "hanoman-inv-"));
    const nested = join(root, "sessions"); mkdirSync(nested);
    const transcript = join(nested, "a.jsonl");
    writeFileSync(transcript, [
      JSON.stringify({ type: "usage", usage: { input_tokens: 12, output_tokens: 5, cached_tokens: 3 } }),
      JSON.stringify({ unrelated: { tokens: 99 } }),
    ].join("\n"));
    await stopAgentInvocation({ ...base, transcriptPath: transcript }, { transcriptRoots: [root] });
    const known = await prisma.agentInvocation.findFirstOrThrow();
    expect(known).toMatchObject({ inputTokens: 12, outputTokens: 5, cachedTokens: 3 });

    await stopAgentInvocation({ ...base, runtimeInvocationId: "unknown", transcriptPath: "/etc/hosts" }, {
      transcriptRoots: [root],
    });
    const unknown = await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "unknown" } });
    expect(unknown).toMatchObject({ inputTokens: null, outputTokens: null, cachedTokens: null });
  });

  it("workspaceChanged membandingkan hash snapshot start dan stop", async () => {
    const states = [" M source.ts", " M source.ts\0?? probe.ts"];
    const gitStatus = () => states.shift()!;
    await startAgentInvocation(base, { gitStatus });
    await stopAgentInvocation(base, { gitStatus });
    expect(await prisma.agentInvocation.findFirstOrThrow()).toMatchObject({ workspaceChanged: true });
  });

  it("rekonsiliasi boot menandai running tanpa parent hidup sebagai abandoned", async () => {
    await startAgentInvocation(base);
    await startAgentInvocation({ ...base, sessionId: "live", runtimeInvocationId: "run-live" });
    expect(await reconcileAgentInvocations(["live"])).toBe(1);
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { sessionId: "s1" } }))
      .toMatchObject({ status: "abandoned", endedAt: expect.any(Date) });
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { sessionId: "live" } }))
      .toMatchObject({ status: "running", endedAt: null });
  });
});
