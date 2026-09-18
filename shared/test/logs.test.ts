import { describe, expect, it } from "vitest";
import { LOG_BATCH_MAX_ENTRIES, LOG_INGEST_MAX_PER_HOUR, zLogBatch, zLogSearchQuery } from "../src/logs";

describe("zLogBatch", () => {
  it("menolak field asing (.strict())", () => {
    const r = zLogBatch.safeParse({
      lane: "event",
      entries: [{ seq: "1", ts: "2026-01-01T00:00:00.000Z", level: "info", kind: "x", msg: "y" }],
      extra: "tak-dikenal",
    });
    expect(r.success).toBe(false);
  });

  it("menolak batch melebihi LOG_BATCH_MAX_ENTRIES", () => {
    const entries = Array.from({ length: LOG_BATCH_MAX_ENTRIES + 1 }, (_, i) => ({
      seq: String(i + 1), ts: "2026-01-01T00:00:00.000Z", level: "info", kind: "x", msg: "y",
    }));
    expect(zLogBatch.safeParse({ lane: "event", entries }).success).toBe(false);
  });

  it("LOG_INGEST_MAX_PER_HOUR bernilai 20000", () => {
    expect(LOG_INGEST_MAX_PER_HOUR).toBe(20_000);
  });
});

describe("zLogSearchQuery", () => {
  it("mewajibkan from/to dan menolak rentang > 31 hari", () => {
    const ok = zLogSearchQuery.safeParse({ from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
    expect(ok.success).toBe(true);
    const tooLong = zLogSearchQuery.safeParse({ from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" });
    expect(tooLong.success).toBe(false);
  });
});
