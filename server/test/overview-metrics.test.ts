import { describe, it, expect } from "vitest";
import {
  startOfDay, addDays, dayKey, overlapMs, median, isFailed, dayStats, riverStats, tokenStats,
  waitStats, heatmapStats, recordStats, liveMs,
  type SessionRow, type SpecRow,
} from "../src/services/overview-metrics";

// Semua tanggal dibangun dengan konstruktor LOKAL supaya test lepas dari zona waktu mesin.
const at = (d: number, h = 0, m = 0) => new Date(2026, 9, d, h, m);   // Oktober 2026
const NOW = at(13, 14, 30).getTime();
const sess = (o: Partial<SessionRow>): SessionRow =>
  ({ kind: "spec", startedAt: at(13, 9), endedAt: null, exitCode: null, endedReason: "closed", ...o });
const spec = (o: Partial<SpecRow>): SpecRow => ({ createdAt: at(1), startedAt: null, doneAt: null, ...o });

describe("helper hari", () => {
  it("startOfDay/addDays/dayKey memakai kalender lokal", () => {
    expect(startOfDay(NOW)).toBe(at(13).getTime());
    expect(addDays(startOfDay(NOW), -1)).toBe(at(12).getTime());
    expect(dayKey(NOW)).toBe("2026-10-13");
  });
  it("overlapMs dan median", () => {
    expect(overlapMs(0, 10, 5, 20)).toBe(5);
    expect(overlapMs(0, 10, 10, 20)).toBe(0);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("isFailed", () => {
  it("exitCode ≠ 0 pada baris closed = tumbang; reconciled dan exit 0/null bukan", () => {
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: 1 }))).toBe(true);
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: 0 }))).toBe(false);
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: null }))).toBe(false);
    expect(isFailed(sess({ endedAt: at(13, 10), exitCode: 137, endedReason: "reconciled" }))).toBe(false);
    expect(isFailed(sess({ endedAt: null, exitCode: 1 }))).toBe(false);
  });
});

describe("dayStats", () => {
  it("menghitung spec mendarat dan sesi agen tumbang di hari itu saja; shell manual diabaikan", () => {
    const specs = [spec({ doneAt: at(13, 9) }), spec({ doneAt: at(13, 11) }), spec({ doneAt: at(12, 23) })];
    const sessions = [
      sess({ endedAt: at(13, 10), exitCode: 1 }),
      sess({ endedAt: at(12, 10), exitCode: 1 }),
      sess({ kind: "shell", endedAt: at(13, 10), exitCode: 1 }),
    ];
    expect(dayStats(startOfDay(NOW), specs, sessions)).toEqual({ landed: 2, failed: 1 });
    expect(dayStats(addDays(startOfDay(NOW), -1), specs, sessions)).toEqual({ landed: 1, failed: 1 });
  });
});

describe("riverStats", () => {
  it("dibuat/mulai/selesai hari ini + median lead & cycle 7 hari", () => {
    const specs = [
      spec({ createdAt: at(13, 8) }),
      spec({ createdAt: at(13, 8), startedAt: at(13, 9) }),
      spec({ createdAt: at(12, 10), startedAt: at(13, 10), doneAt: at(13, 12) }),   // lead 26j, cycle 2j
      spec({ createdAt: at(10, 12), startedAt: at(11, 12), doneAt: at(11, 16) }),   // lead 28j, cycle 4j
      spec({ createdAt: at(1), startedAt: at(1), doneAt: at(2) }),                  // di luar 7 hari
    ];
    const r = riverStats(NOW, specs);
    expect(r).toMatchObject({ created: 2, started: 2, landed: 1 });
    expect(r.leadTimeMedMs).toBe(27 * 3_600_000);
    expect(r.cycleTimeMedMs).toBe(3 * 3_600_000);
  });
  it("tanpa spec selesai 7 hari → median null", () => {
    expect(riverStats(NOW, [])).toEqual({ created: 0, started: 0, landed: 0, leadTimeMedMs: null, cycleTimeMedMs: null });
  });
});

describe("tokenStats", () => {
  const inv = (agentName: string, d: Date, i: number, o: number, c: number) =>
    ({ agentName, startedAt: d, inputTokens: i, outputTokens: o, cachedTokens: c });
  it("jumlah hari ini, cache hit, per spec, agen paling boros, total kemarin", () => {
    const t = tokenStats(NOW, [
      inv("implementer", at(13, 9), 100, 50, 300),
      inv("reviewer", at(13, 10), 100, 20, 100),
      inv("implementer", at(12, 9), 10, 10, 10),
    ], 2);
    expect(t).toEqual({ input: 200, output: 70, cached: 400, total: 670, cacheHitPct: 67, perLanded: 335,
      topAgent: { name: "implementer", total: 450 }, yesterdayTotal: 30 });
  });
  it("kosong → nol, cache & per-spec null, tanpa agen", () => {
    expect(tokenStats(NOW, [], 0)).toEqual({ input: 0, output: 0, cached: 0, total: 0, cacheHitPct: null,
      perLanded: null, topAgent: null, yesterdayTotal: 0 });
  });
});
describe("waitStats", () => {
  it("menjumlah menit menunggu per hari, memotong episode yang melewati tengah malam", () => {
    const waits = [
      { start: at(12, 23, 50).getTime(), end: at(13, 0, 20).getTime() },   // 10m kemarin + 20m hari ini
      { start: at(13, 14, 0).getTime(), end: null },                       // masih menunggu → sampai NOW (30m)
    ];
    const sessions = [sess({ startedAt: at(13, 13, 30), endedAt: null })]; // hidup 60m hari ini
    expect(waitStats(NOW, waits, sessions)).toEqual({ todayMin: 50, yesterdayMin: 10, pctOfLive: 83 });
  });
  it("tanpa sesi agen hidup → pctOfLive null; sumber sesi gagal (null) juga null", () => {
    expect(waitStats(NOW, [], []).pctOfLive).toBeNull();
    expect(waitStats(NOW, [{ start: at(13, 9).getTime(), end: at(13, 10).getTime() }], null))
      .toEqual({ todayMin: 60, yesterdayMin: 0, pctOfLive: null });
  });
  it("persentase dibatasi 100", () => {
    const sessions = [sess({ startedAt: at(13, 14, 0), endedAt: at(13, 14, 10) })];
    expect(waitStats(NOW, [{ start: at(13, 13).getTime(), end: at(13, 14).getTime() }], sessions).pctOfLive).toBe(100);
  });
});

describe("liveMs", () => {
  it("sesi yang masih hidup dihitung sampai now; shell manual diabaikan", () => {
    const t0 = startOfDay(NOW);
    expect(liveMs([sess({ startedAt: at(13, 14) }), sess({ kind: "shell", startedAt: at(13, 9) })], t0, addDays(t0, 1), NOW))
      .toBe(30 * 60_000);
  });
});

describe("heatmapStats", () => {
  it("7 hari × 24 jam, terlama dulu, menit per sel", () => {
    const h = heatmapStats(NOW, [
      sess({ startedAt: at(13, 9, 30), endedAt: at(13, 10, 15) }),   // 30m di jam 9, 15m di jam 10
      sess({ startedAt: at(7, 2, 0), endedAt: at(7, 2, 40) }),       // hari terlama
    ]);
    expect(h.days).toEqual(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
    expect(h.minutes).toHaveLength(7);
    expect(h.minutes[6]![9]).toBe(30);
    expect(h.minutes[6]![10]).toBe(15);
    expect(h.minutes[0]![2]).toBe(40);
    expect(h.minutes.every((row) => row.length === 24)).toBe(true);
  });
});

describe("recordStats", () => {
  it("streak hari tanpa sesi tumbang sampai hari ini, rekor streak, rekor spec per hari", () => {
    const sessions = [
      sess({ startedAt: at(1, 9), endedAt: at(1, 10), exitCode: 0 }),   // awal riwayat: 1 Okt
      sess({ startedAt: at(5, 9), endedAt: at(5, 10), exitCode: 2 }),   // tumbang 5 Okt
      sess({ startedAt: at(9, 9), endedAt: at(9, 10), exitCode: 1 }),   // tumbang 9 Okt
    ];
    const specs = [spec({ doneAt: at(12, 9) }), spec({ doneAt: at(12, 10) }), spec({ doneAt: at(13, 9) })];
    expect(recordStats(NOW, specs, sessions)).toEqual({
      streakDays: 4,                                     // 10, 11, 12, 13 Okt
      bestStreak: 4,                                     // 1–4 Okt juga 4; 6–8 Okt 3
      bestLandedDay: { date: "2026-10-12", count: 2 },
      landedRecordToday: false,
    });
  });
  it("tumbang hari ini → streak 0; rekor hari ini bila melampaui semua hari sebelumnya", () => {
    const r = recordStats(NOW, [spec({ doneAt: at(12, 9) }), spec({ doneAt: at(13, 9) }), spec({ doneAt: at(13, 10) })],
      [sess({ startedAt: at(13, 9), endedAt: at(13, 10), exitCode: 1 })]);
    expect(r.streakDays).toBe(0);
    expect(r.landedRecordToday).toBe(true);
    expect(r.bestLandedDay).toEqual({ date: "2026-10-13", count: 2 });
  });
  it("tanpa riwayat sesi sama sekali → streak 0, rekor 0, tanpa hari terbaik", () => {
    expect(recordStats(NOW, [], [])).toEqual({ streakDays: 0, bestStreak: 0, bestLandedDay: null, landedRecordToday: false });
  });
});
