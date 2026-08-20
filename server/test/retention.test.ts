import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { runRetention } from "../src/services/retention";

const old = new Date("2025-01-01T00:00:00Z");
const now = new Date("2026-08-14T00:00:00Z");

// Sapuan kini ikut merekonsiliasi direktori transkrip (SPEC-845 · ADR-0126); tanpa direktori
// terisolasi ia akan menyapu ~/.hanoman/transcripts milik instance sungguhan.
beforeEach(async () => {
  process.env.HANOMAN_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), "hanoman-ret-"));
  await prisma.sessionHistory.deleteMany();
  // SPEC-857 · `resetDb()` sengaja tak menyentuh change-feed; tanpa baris ini `feedPruned`
  // membawa sisa berkas test lain dan angkanya tak bisa diperiksa.
  await prisma.syncLog.deleteMany();
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

  // SPEC-845 · ADR-0126 · membalik kontrak lama ("baris ditahan bila berkas gagal dihapus"): berkas
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

// SPEC-857 · ADR-0131 · change-feed `SyncLog` dulu tumbuh tanpa batas (121.222 baris `vps` =
// 213,6 MB dari DB hub 258 MB) sampai mencekik pembaca jadi `P1008 Socket timeout`.
describe("retensi change-feed sync", () => {
  const feed = (recordId: string, version: number, createdAt: Date, entity = "vps") =>
    prisma.syncLog.create({ data: { entity, recordId, version, op: "upsert", data: {}, createdAt } });

  const sisa = () =>
    prisma.syncLog.findMany({ orderBy: { seq: "asc" }, select: { recordId: true, version: true } });

  // INVARIAN INTI. Klien yang tertinggal jauh tetap konvergen HANYA selama versi terakhir tiap
  // record masih ada di feed — `pull()` membaca `seq > cursor` tanpa syarat kontiguitas, jadi
  // baris tersusul boleh hilang tapi puncaknya tak pernah boleh.
  it("memangkas baris tersusul yang tua, tapi TAK PERNAH puncak tiap record", async () => {
    await feed("vps-a", 1, old); await feed("vps-a", 2, old); await feed("vps-a", 3, old);
    await feed("vps-b", 7, old);                          // satu-satunya baris: itu puncaknya
    await feed("SPEC-1", 4, old, "spec"); await feed("SPEC-1", 5, old, "spec");

    expect(await runRetention({ now, batchSize: 10 })).toMatchObject({ feedPruned: 3 });
    expect(await sisa()).toEqual([
      { recordId: "vps-a", version: 3 },
      { recordId: "vps-b", version: 7 },
      { recordId: "SPEC-1", version: 5 },
    ]);
  });

  it("membiarkan baris tersusul yang masih di dalam jendela retensi", async () => {
    const baru = new Date(now.getTime() - 2 * 86_400_000);   // 2 hari — jendelanya 7 hari
    await feed("vps-a", 1, baru); await feed("vps-a", 2, baru);

    expect(await runRetention({ now, batchSize: 10 })).toMatchObject({ feedPruned: 0 });
    expect(await prisma.syncLog.count()).toBe(2);
  });

  // Jatah `batchSize` melindungi penghapusan yang menyentuh berkas; feed adalah hapus-baris murni
  // dan HARUS bisa mengejar tunggakan — kalau ia ikut dijatah, 121.222 baris butuh 1.210 hari.
  it("tak tunduk pada jatah batchSize", async () => {
    for (let v = 1; v <= 12; v++) await feed("vps-a", v, old);
    expect(await runRetention({ now, batchSize: 1 })).toMatchObject({ feedPruned: 11 });
    expect(await prisma.syncLog.count()).toBe(1);
  });

  it("dryRun menghitung tanpa menghapus", async () => {
    await feed("vps-a", 1, old); await feed("vps-a", 2, old);
    expect(await runRetention({ now, dryRun: true, batchSize: 10 })).toMatchObject({ feedPruned: 1 });
    expect(await prisma.syncLog.count()).toBe(2);
  });
});
