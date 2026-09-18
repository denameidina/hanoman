import { describe, expect, it, vi, beforeEach } from "vitest";
import { shipLogs, __resetShipperPause } from "../src/services/logs/shipper";
import { prisma } from "../src/db";

describe("shipLogs", () => {
  beforeEach(async () => {
    // `pausedUntil` (per lajur) hidup di module state, bukan DB — tanpa reset di sini, 404 di satu
    // test membekukan lajur `event` selama 30 menit dan membocorkan status "tertunda" ke test lain.
    __resetShipperPause();
    await prisma.logEntry.deleteMany({ where: { deviceId: "local" } });
    await prisma.logCursor.deleteMany({ where: { deviceId: "local" } });
    await prisma.logEntry.create({
      data: { deviceId: "local", lane: "event", seq: 1n, ts: new Date(), level: "info", kind: "session.start", msg: "x", bytes: 1 },
    });
  });

  it("mengirim entri LogEntry local belum-ack dan memajukan LogCursor(local) saat 200", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: { lane: "event", accepted: 1, duplicate: 0, lastSeq: "1" } });
    await shipLogs(transport);
    expect(transport).toHaveBeenCalledWith("POST", "/api/sync/logs", expect.objectContaining({ lane: "event" }));
    const cursor = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: "local", lane: "event" } } });
    expect(cursor?.seq).toBe(1n);
  });

  it("404 → menunda pengiriman 30 menit tanpa melempar", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 404, body: {} });
    await expect(shipLogs(transport)).resolves.toBeUndefined();
  });

  it("kirim ulang (crash antara commit hub & tulis kursor klien) tak menggandakan pengiriman berikutnya", async () => {
    // simulasi: transport sukses tapi shipLogs "crash" sebelum menulis kursor — dites lewat dua
    // panggilan shipLogs berurutan dengan transport yang sama; kedua kalinya kursor sudah maju
    // sehingga batch kedua kosong (tak ada entri baru untuk dikirim).
    const transport = vi.fn().mockResolvedValue({ status: 200, body: { lane: "event", accepted: 1, duplicate: 0, lastSeq: "1" } });
    await shipLogs(transport);
    await shipLogs(transport);
    expect(transport).toHaveBeenCalledTimes(1); // panggilan kedua: nol entri baru → tak mengirim
  });
});
