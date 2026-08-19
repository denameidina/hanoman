import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { runRetention } from "../src/services/retention";

const old = new Date("2025-01-01T00:00:00Z");
const now = new Date("2026-08-14T00:00:00Z");

// Sapuan kini ikut merekonsiliasi direktori transkrip (SPEC-845 · ADR-0125); tanpa direktori
// terisolasi ia akan menyapu ~/.hanoman/transcripts milik instance sungguhan.
beforeEach(async () => {
  process.env.HANOMAN_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), "hanoman-ret-"));
  await prisma.sessionHistory.deleteMany();
  await resetDb();
});
afterAll(() => { delete process.env.HANOMAN_TRANSCRIPT_DIR; });

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

  // SPEC-845 · ADR-0125 · membalik kontrak lama ("baris ditahan bila berkas gagal dihapus"): berkas
  // kini dihapus SESUDAH barisnya commit, jadi kegagalan filesystem menyisakan yatim yang bisa
  // dipungut — bukan baris tertahan yang transkripnya sudah telanjur hancur.
  it("kegagalan hapus berkas menyisakan yatim, bukan baris yang tertahan", async () => {
    await history("fs-gagal");
    const remove = vi.fn().mockRejectedValue(new Error("disk busy"));
    expect(await runRetention({ now, dryRun: false, batchSize: 1 }, { deleteTranscript: remove }))
      .toMatchObject({ deleted: 1, failed: 0 });
    expect(await prisma.sessionHistory.findUnique({ where: { id: "fs-gagal" } })).toBeNull();
  });

  it("kegagalan penghapusan baris tak pernah menyentuh transkripnya", async () => {
    await history("db-gagal");
    const remove = vi.fn().mockResolvedValue(undefined);
    const asli = prisma.sessionHistory.delete;
    (prisma.sessionHistory as unknown as Record<string, unknown>).delete = async () => {
      throw new Error("SQLITE_BUSY");
    };
    try {
      expect(await runRetention({ now, dryRun: false, batchSize: 1 }, { deleteTranscript: remove }))
        .toMatchObject({ deleted: 0, failed: 1 });
    } finally {
      (prisma.sessionHistory as unknown as Record<string, unknown>).delete = asli;
    }
    expect(remove).not.toHaveBeenCalled();
    expect(await prisma.sessionHistory.findUnique({ where: { id: "db-gagal" } })).not.toBeNull();
  });

  it("sapuan memungut berkas yatim dan mengosongkan metadata transkrip yang menggantung", async () => {
    const yatim = join(process.env.HANOMAN_TRANSCRIPT_DIR!, "yatim.log");
    writeFileSync(yatim, "sampah");
    const dulu = Date.now() / 1000 - 7200;
    utimesSync(yatim, dulu, dulu);
    // Baris MUDA (belum jatuh tempo retensi) yang berkasnya sudah lenyap — hasTranscript berbohong.
    await prisma.sessionHistory.create({ data: {
      id: "muda", sessionId: "muda", projectId: "p", kind: "agent", agent: "claude", cwd: "/tmp",
      startedAt: now, endedAt: now, transcriptKey: "hilang.log", transcriptBytes: 9,
    } });

    expect(await runRetention({ now, dryRun: false, batchSize: 10 }))
      .toMatchObject({ orphans: 1, dangling: 1 });
    expect(existsSync(yatim)).toBe(false);
    expect((await prisma.sessionHistory.findUnique({ where: { id: "muda" } }))!.transcriptKey).toBeNull();
  });

  it("dryRun tak menyentuh berkas yatim", async () => {
    const yatim = join(process.env.HANOMAN_TRANSCRIPT_DIR!, "yatim.log");
    writeFileSync(yatim, "sampah");
    const dulu = Date.now() / 1000 - 7200;
    utimesSync(yatim, dulu, dulu);
    expect(await runRetention({ now, dryRun: true, batchSize: 10 })).toMatchObject({ orphans: 1 });
    expect(existsSync(yatim)).toBe(true);
  });
});
