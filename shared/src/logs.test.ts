import { describe, it, expect } from "vitest";
import { LOG_RETENTION_DEFAULTS, nextSeq, zLogRetention, zLogShipping } from "./logs";

describe("nextSeq — jam logis hibrida (ADR-0166 §3)", () => {
  const T = 1_757_000_000_000;
  it("mengikuti jam dinding ×1000 saat jam maju", () => {
    expect(nextSeq(0, T)).toBe(T * 1000);
    expect(nextSeq(T * 1000, T + 1)).toBe((T + 1) * 1000);
  });
  it("tetap naik ketat pada milidetik yang sama", () => {
    const a = nextSeq(0, T);
    const b = nextSeq(a, T);
    const c = nextSeq(b, T);
    expect([b - a, c - b]).toEqual([1, 1]);
  });
  it("tak pernah mundur saat jam mundur (restart dengan last dari DB)", () => {
    const last = nextSeq(0, T + 60_000);
    expect(nextSeq(last, T)).toBe(last + 1);
  });
  it("tetap integer aman JS", () => {
    expect(Number.isSafeInteger(nextSeq(0, Date.now()))).toBe(true);
  });
});

describe("kunci Setting log", () => {
  it("default dan batas retensi", () => {
    expect(zLogRetention.parse({})).toEqual(LOG_RETENTION_DEFAULTS);
    expect(LOG_RETENTION_DEFAULTS).toEqual({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 268435456 });
    expect(zLogRetention.safeParse({ eventDays: 0 }).success).toBe(false);
    expect(zLogRetention.safeParse({ maxBytes: 1024 }).success).toBe(false);
    expect(zLogShipping.parse({})).toEqual({ event: true, server: false, transcript: false });
  });
});
