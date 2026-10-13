import { describe, it, expect } from "vitest";
import { zOverview, type OverviewDTO } from "./overview";
import { paths } from "./api";

export const sampleOverview = (): OverviewDTO => ({
  generatedAt: "2026-10-13T07:32:00.000Z", recordingSince: "2026-10-13T02:12:00.000Z",
  today: { landed: 3, failed: 1 }, yesterday: { landed: 2, failed: 0 },
  river: { created: 9, started: 5, landed: 3, leadTimeMedMs: 3_600_000, cycleTimeMedMs: 1_200_000 },
  tokens: { input: 100, output: 50, cached: 400, total: 550, cacheHitPct: 80, perLanded: 183,
    topAgent: { name: "implementer", total: 300 }, yesterdayTotal: 200 },
  wait: { todayMin: 47, yesterdayMin: 29, pctOfLive: 31 },
  bensin: [{ source: "claude", key: "session", label: "Sesi 5 jam", usedPct: 68,
    resetsAt: "2026-10-13T11:00:00.000Z", exhaustAt: "2026-10-13T09:40:00.000Z", verdict: "habis",
    samples: [{ at: "2026-10-13T07:00:00.000Z", pct: 60 }] }],
  heatmap: { days: ["2026-10-07"], minutes: [Array.from({ length: 24 }, () => 0)] },
  records: { streakDays: 6, bestStreak: 11, bestLandedDay: { date: "2026-10-12", count: 7 }, landedRecordToday: false },
  headline: { text: "1 sesi tumbang.", parts: [{ text: "1 sesi tumbang", tone: "bad" }, { text: "." }] },
});

describe("zOverview", () => {
  it("menerima DTO lengkap", () => {
    expect(zOverview.parse(sampleOverview())).toEqual(sampleOverview());
  });
  it("menerima setiap panel null (sumber gagal), tapi headline wajib", () => {
    const o = { ...sampleOverview(), today: null, yesterday: null, river: null, tokens: null,
      wait: null, bensin: null, heatmap: null, records: null };
    expect(zOverview.safeParse(o).success).toBe(true);
    const { headline: _h, ...noHeadline } = o;
    expect(zOverview.safeParse(noHeadline).success).toBe(false);
  });
  it("menolak verdict bensin di luar kosakata", () => {
    const o = sampleOverview();
    o.bensin![0]!.verdict = "kosong" as never;
    expect(zOverview.safeParse(o).success).toBe(false);
  });
  it("paths.overview = /api/overview", () => {
    expect(paths.overview).toBe("/api/overview");
  });
});
