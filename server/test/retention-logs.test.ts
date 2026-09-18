import { describe, expect, it, beforeEach } from "vitest";
import { pruneLogs } from "../src/services/logs/prune";
import { prisma } from "../src/db";
import { LOG_RETENTION_DEFAULTS } from "@hanoman/shared";

describe("pruneLogs", () => {
  beforeEach(async () => { await prisma.logEntry.deleteMany({}); await prisma.logCursor.deleteMany({}); });

  it("menghapus entri melewati retention.<lane>Days", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.logEntry.create({
      data: { deviceId: "dev1", lane: "event", seq: 1n, ts: old, level: "info", kind: "x", msg: "y", bytes: 1 },
    });
    const report = await pruneLogs(new Date(), LOG_RETENTION_DEFAULTS);
    expect(report.logsPruned).toBe(1);
    expect(await prisma.logEntry.count()).toBe(0);
  });

  it("baris local belum-ack (seq > LogCursor local) TAK PERNAH dihapus sapuan umur (AC-S7)", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.logEntry.create({
      data: { deviceId: "local", lane: "event", seq: 5n, ts: old, level: "info", kind: "x", msg: "y", bytes: 1 },
    });
    await prisma.logCursor.create({ data: { deviceId: "local", lane: "event", seq: 3n } }); // belum ack seq 5
    await pruneLogs(new Date(), LOG_RETENTION_DEFAULTS);
    expect(await prisma.logEntry.count()).toBe(1);
  });

  it("baris local yang sudah di-ack dan melewati umur ikut tersapu", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.logEntry.create({
      data: { deviceId: "local", lane: "event", seq: 2n, ts: old, level: "info", kind: "x", msg: "y", bytes: 1 },
    });
    await prisma.logCursor.create({ data: { deviceId: "local", lane: "event", seq: 5n } }); // sudah ack
    await pruneLogs(new Date(), LOG_RETENTION_DEFAULTS);
    expect(await prisma.logEntry.count()).toBe(0);
  });

  it("total bytes > maxBytes menghapus entri terlama sampai di bawah plafon", async () => {
    const now = new Date();
    await prisma.logEntry.createMany({
      data: [
        { deviceId: "dev1", lane: "event", seq: 1n, ts: new Date(now.getTime() - 2000), level: "info", kind: "x", msg: "y", bytes: 10 * 1024 * 1024 },
        { deviceId: "dev1", lane: "event", seq: 2n, ts: new Date(now.getTime() - 1000), level: "info", kind: "x", msg: "y", bytes: 10 * 1024 * 1024 },
      ],
    });
    const report = await pruneLogs(now, { ...LOG_RETENTION_DEFAULTS, maxBytes: 12 * 1024 * 1024 });
    expect(report.logsPruned).toBeGreaterThanOrEqual(1);
    expect(await prisma.logEntry.count()).toBe(1); // yang terlama dihapus, sisa satu di bawah plafon
  });
});
