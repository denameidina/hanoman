import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { runRetention } from "../src/services/retention";

const old = new Date("2025-01-01T00:00:00Z");
const now = new Date("2026-08-14T00:00:00Z");

beforeEach(async () => {
  await prisma.sessionHistory.deleteMany();
  await resetDb();
});

async function history(id: string) {
  return prisma.sessionHistory.create({ data: {
    id, sessionId: id, projectId: "p", kind: "agent", agent: "claude", cwd: "/tmp",
    startedAt: old, endedAt: old, transcriptKey: `${id}.log`, transcriptBytes: 12,
  } });
}

describe("bounded retention", () => {
  it("reports dry-run candidates without deleting and respects explicit holds", async () => {
    await history("delete-me"); await history("hold-me");
    const report = await runRetention({ now, dryRun: true, batchSize: 10, holds: new Set(["session:hold-me"]) });
    expect(report).toMatchObject({ candidates: 1, deleted: 0, bytes: 12 });
    expect(await prisma.sessionHistory.count()).toBe(2);
  });

  it("keeps the DB row when filesystem deletion fails so a later sweep can retry", async () => {
    await history("retry-me");
    const remove = vi.fn().mockRejectedValueOnce(new Error("disk busy")).mockResolvedValue(undefined);
    expect(await runRetention({ now, dryRun: false, batchSize: 1 }, { deleteTranscript: remove }))
      .toMatchObject({ deleted: 0, failed: 1 });
    expect(await prisma.sessionHistory.findUnique({ where: { id: "retry-me" } })).not.toBeNull();
    expect(await runRetention({ now, dryRun: false, batchSize: 1 }, { deleteTranscript: remove }))
      .toMatchObject({ deleted: 1, failed: 0 });
    expect(await prisma.sessionHistory.findUnique({ where: { id: "retry-me" } })).toBeNull();
  });
});
