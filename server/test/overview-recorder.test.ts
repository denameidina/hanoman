import { describe, it, expect, beforeEach } from "vitest";
import {
  observeSessions, observeLimits, waitSpans, limitSeries, recordingSince, __resetRecorder,
} from "../src/services/overview-recorder";

const T = Date.parse("2026-10-13T07:00:00.000Z");
const min = (n: number) => T + n * 60_000;
const s = (id: string, o: { decision?: boolean; deciding?: boolean; exited?: boolean; decisionAt?: string } = {}) =>
  ({ id, exited: false, ...o });
const win = (pct: number) => ({ key: "session", label: "Sesi 5 jam", usedPct: pct,
  resetsAt: "2026-10-13T11:00:00.000Z", severity: "normal" as const, isActive: true });

beforeEach(() => __resetRecorder(T));

describe("episode menunggu", () => {
  it("dibuka saat sesi menunggu (awal = decisionAt), ditutup saat tak lagi menunggu", () => {
    observeSessions([s("a", { decision: true, decisionAt: new Date(min(-5)).toISOString() })], min(0));
    expect(waitSpans()).toEqual([{ start: min(-5), end: null }]);
    observeSessions([s("a", { decision: true, decisionAt: new Date(min(1)).toISOString() })], min(2));
    expect(waitSpans()).toEqual([{ start: min(-5), end: null }]);   // decisionAt yang bergeser tak memindah awal
    observeSessions([s("a")], min(10));
    expect(waitSpans()).toEqual([{ start: min(-5), end: min(10) }]);
  });
  it("sesi yang dilayani lead (deciding) atau sudah exited bukan menunggu", () => {
    observeSessions([s("a", { decision: true, deciding: true }), s("b", { decision: true, exited: true })], min(0));
    expect(waitSpans()).toEqual([]);
  });
  it("sesi yang lenyap dari snapshot menutup episodenya", () => {
    observeSessions([s("a", { decision: true })], min(0));
    observeSessions([], min(3));
    expect(waitSpans()).toEqual([{ start: min(0), end: min(3) }]);
  });
  it("tanpa decisionAt atau decisionAt di masa depan → awal = now", () => {
    observeSessions([s("a", { decision: true, decisionAt: new Date(min(9)).toISOString() })], min(1));
    expect(waitSpans()[0]!.start).toBe(min(1));
  });
  it("episode tertutup dipangkas ke 2000 terakhir", () => {
    for (let i = 0; i < 2005; i++) {
      observeSessions([s(`x${i}`, { decision: true })], T + i * 2);
      observeSessions([], T + i * 2 + 1);
    }
    expect(waitSpans()).toHaveLength(2000);
    expect(waitSpans()[0]!.start).toBe(T + 5 * 2);
  });
});

describe("sampel limit", () => {
  it("menyimpan sampel berjarak ≥25 dtk per window, memangkas >2 jam, mengosongkan saat window reset", () => {
    observeLimits("claude", [win(10)], min(0));
    observeLimits("claude", [win(11)], min(0) + 10_000);           // terlalu rapat → diabaikan
    observeLimits("claude", [win(12)], min(1));
    expect(limitSeries()[0]!.samples.map((p) => p.pct)).toEqual([10, 12]);
    observeLimits("claude", [win(30)], min(130));                   // dua sampel awal > 2 jam → dipangkas
    expect(limitSeries()[0]!.samples.map((p) => p.pct)).toEqual([30]);
    observeLimits("claude", [win(2)], min(131));                    // pct turun = window baru
    expect(limitSeries()[0]!.samples.map((p) => p.pct)).toEqual([2]);
    expect(limitSeries()[0]).toMatchObject({ source: "claude", key: "session", label: "Sesi 5 jam" });
  });
  it("claude dan codex adalah seri terpisah", () => {
    observeLimits("claude", [win(10)], min(0));
    observeLimits("codex", [win(40)], min(0));
    expect(limitSeries().map((x) => x.source).sort()).toEqual(["claude", "codex"]);
  });
});

it("recordingSince = awal perekam", () => {
  expect(recordingSince()).toBe(T);
});
