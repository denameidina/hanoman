import { describe, expect, it, beforeEach, vi } from "vitest";
import { ingestBatch, __resetIngestQuota } from "../src/services/logs/ingest";
import { prisma } from "../src/db";
import { LOG_INGEST_MAX_PER_HOUR } from "@hanoman/shared";

const entry = (seq: number, msg = "y") => ({
  seq: String(seq), ts: new Date().toISOString(), level: "info" as const, kind: "x", msg,
});

describe("ingestBatch", () => {
  beforeEach(async () => {
    __resetIngestQuota();
    await prisma.logCursor.deleteMany({});
    await prisma.logEntry.deleteMany({});
  });

  it("menerima batch baru dan memajukan LogCursor dalam satu transaksi", async () => {
    const res = await ingestBatch("dev1", { lane: "event", entries: [entry(1), entry(2)] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ accepted: 2, duplicate: 0, lastSeq: "2" }));
    const cursor = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: "dev1", lane: "event" } } });
    expect(cursor?.seq).toBe(2n);
  });

  it("kirim ulang batch identik menghasilkan nol baris baru", async () => {
    await ingestBatch("dev1", { lane: "event", entries: [entry(1), entry(2)] });
    const res = await ingestBatch("dev1", { lane: "event", entries: [entry(1), entry(2)] });
    expect(res.body.accepted).toBe(0);
    expect(res.body.duplicate).toBe(2);
    const rows = await prisma.logEntry.findMany({ where: { deviceId: "dev1" } });
    expect(rows.length).toBe(2);
  });

  it("seq tak naik ketat dalam batch → 400", async () => {
    const res = await ingestBatch("dev2", { lane: "event", entries: [entry(2), entry(1)] });
    expect(res.status).toBe(400);
  });

  it("kuota > LOG_INGEST_MAX_PER_HOUR per device → 429 retryAfterSec", async () => {
    const entries = Array.from({ length: LOG_INGEST_MAX_PER_HOUR + 1 }, (_, i) => entry(i + 1));
    // batch dibatasi 500/entries oleh zLogBatch di route; di sini panggil ingestBatch langsung
    // per 500 supaya kuota diuji tanpa menabrak LOG_BATCH_MAX_ENTRIES.
    let last;
    for (let i = 0; i < entries.length; i += 500) {
      last = await ingestBatch("dev3", { lane: "event", entries: entries.slice(i, i + 500) });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.retryAfterSec).toBeGreaterThan(0);
  });

  it("redaksi lapis 2 menyamarkan rahasia sebelum tulis DB", async () => {
    await ingestBatch("dev4", { lane: "event", entries: [entry(1, "Bearer abc123XYZ")] });
    const row = await prisma.logEntry.findFirst({ where: { deviceId: "dev4" } });
    expect(row!.msg).not.toContain("abc123XYZ");
  });

  it("redaktor melempar → entri dibuang, diganti log.gap reason:redaction-failed", async () => {
    const { redactText } = await import("@hanoman/shared");
    vi.spyOn(await import("@hanoman/shared"), "redactText").mockImplementationOnce(() => { throw new Error("boom"); });
    await ingestBatch("dev5", { lane: "event", entries: [entry(1)] });
    const gap = await prisma.logEntry.findFirst({ where: { deviceId: "dev5", kind: "log.gap" } });
    expect(gap).toBeTruthy();
    expect((gap!.data as Record<string, unknown>).reason).toBe("redaction-failed");
    vi.restoreAllMocks();
  });
});
