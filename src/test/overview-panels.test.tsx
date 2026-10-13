import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { OverviewDTO } from "@hanoman/shared";
import { Bottleneck } from "../src/screens/overview/Bottleneck";
import { SungaiSpec } from "../src/screens/overview/SungaiSpec";
import { Rekor } from "../src/screens/overview/Rekor";
import { Bensin } from "../src/screens/overview/Bensin";
import { EkonomiToken } from "../src/screens/overview/EkonomiToken";
import { PetaPanas } from "../src/screens/overview/PetaPanas";
import { fmtTokens, fmtDuration, fmtMinutes } from "../src/screens/overview/format";

const NOW = new Date(2026, 9, 13, 14, 30).getTime();
const base = (over: Partial<OverviewDTO> = {}): OverviewDTO => ({
  generatedAt: new Date(NOW).toISOString(), recordingSince: new Date(2026, 9, 13, 9, 12).toISOString(),
  today: { landed: 3, failed: 1 }, yesterday: { landed: 2, failed: 0 },
  river: { created: 9, started: 5, landed: 3, leadTimeMedMs: 28 * 3_600_000, cycleTimeMedMs: 192 * 60_000 },
  tokens: { input: 600_000, output: 200_000, cached: 3_400_000, total: 4_200_000, cacheHitPct: 85,
    perLanded: 1_400_000, topAgent: { name: "implementer", total: 2_000_000 }, yesterdayTotal: 3_000_000 },
  wait: { todayMin: 47, yesterdayMin: 29, pctOfLive: 31 },
  bensin: [
    { source: "claude", key: "session", label: "Sesi 5 jam", usedPct: 68, resetsAt: new Date(2026, 9, 13, 18).toISOString(),
      exhaustAt: new Date(2026, 9, 13, 16, 40).toISOString(), verdict: "habis",
      samples: [{ at: new Date(2026, 9, 13, 14).toISOString(), pct: 50 }, { at: new Date(NOW).toISOString(), pct: 68 }] },
    { source: "codex", key: "primary", label: "Primer", usedPct: 20, resetsAt: null, exhaustAt: null, verdict: "stabil", samples: [] },
  ],
  heatmap: { days: ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"],
    minutes: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 6 && h === 14 ? 38 : 0))) },
  records: { streakDays: 6, bestStreak: 11, bestLandedDay: { date: "2026-10-12", count: 7 }, landedRecordToday: false },
  headline: { text: "x", parts: [{ text: "x" }] },
  ...over,
});

describe("format", () => {
  it("token, durasi, menit", () => {
    expect(fmtTokens(4_200_000)).toBe("4,2 jt");
    expect(fmtTokens(812_400)).toBe("812 rb");
    expect(fmtTokens(950)).toBe("950");
    expect(fmtDuration(28 * 3_600_000)).toBe("1 hari 4 jam");
    expect(fmtDuration(192 * 60_000)).toBe("3 jam 12 menit");
    expect(fmtMinutes(47)).toBe("47 menit");
  });
});

describe("Bottleneck", () => {
  it("menit menunggu, delta (naik = buruk), persentase, dan 'tercatat sejak' bila perekam mulai hari ini", () => {
    render(<Bottleneck overview={base()} now={NOW} />);
    expect(screen.getByText("47")).toBeTruthy();
    expect(screen.getByText("↑18 vs kemarin").className).toContain("hn-ovk-tone--bad");
    expect(screen.getByText("31% waktu agen hari ini menganggur menunggu jawaban")).toBeTruthy();
    expect(screen.getByText("tercatat sejak 09.12")).toBeTruthy();
  });
  it("panel null → kalimat datar", () => {
    render(<Bottleneck overview={base({ wait: null })} now={NOW} />);
    expect(screen.getByText("Belum ada data menunggu.")).toBeTruthy();
  });
});

describe("SungaiSpec", () => {
  it("tiga arus + lead/cycle time", () => {
    render(<SungaiSpec overview={base()} now={NOW} />);
    expect(screen.getByText("dibuat 9")).toBeTruthy();
    expect(screen.getByText("jalan 5")).toBeTruthy();
    expect(screen.getByText("selesai 3")).toBeTruthy();
    expect(screen.getByText("lead time 1 hari 4 jam · cycle 3 jam 12 menit")).toBeTruthy();
  });
});

describe("Rekor", () => {
  it("streak dan rekor", () => {
    render(<Rekor overview={base()} now={NOW} />);
    expect(screen.getByText("6 hari tanpa sesi tumbang")).toBeTruthy();
    expect(screen.getByText(/rekor 11 hari · terbanyak 7 spec \(12 Okt\)/)).toBeTruthy();
  });
});

describe("Bensin", () => {
  it("claude default: %, label habis ±jam; tab Codex menampilkan seri codex", () => {
    render(<Bensin overview={base()} now={NOW} />);
    expect(screen.getByText("68%")).toBeTruthy();
    expect(screen.getByText("habis ±16.40")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("laju stabil")).toBeTruthy();
  });
  it("hanya codex yang punya seri (limit claude tak terbaca) → tab Codex aktif sejak awal, bukan 'Belum ada data'", () => {
    render(<Bensin overview={base({ bensin: [base().bensin![1]!] })} now={NOW} />);
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.queryByText("Belum ada data limit.")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Claude" }));
    expect(screen.getByText("Belum ada data limit.")).toBeTruthy();
  });
  it("tanpa seri codex, tanpa tab; tanpa data sama sekali, kalimat datar", () => {
    const { unmount } = render(<Bensin overview={base({ bensin: [base().bensin![0]!] })} now={NOW} />);
    expect(screen.queryByRole("tab", { name: "Codex" })).toBeNull();
    unmount();
    render(<Bensin overview={base({ bensin: [] })} now={NOW} />);
    expect(screen.getByText("Belum ada data limit.")).toBeTruthy();
  });
});

describe("EkonomiToken", () => {
  it("total, cache, per spec, agen paling boros, label 'token agen tercatat'", () => {
    render(<EkonomiToken overview={base()} now={NOW} />);
    expect(screen.getByText("4,2 jt")).toBeTruthy();
    expect(screen.getByText("cache 85%")).toBeTruthy();
    expect(screen.getByText("1,4 jt per spec mendarat")).toBeTruthy();
    expect(screen.getByText("paling boros: implementer")).toBeTruthy();
    expect(screen.getByText("token agen tercatat")).toBeTruthy();
  });
  it("total 0 → kalimat datar", () => {
    render(<EkonomiToken overview={base({ tokens: { ...base().tokens!, total: 0, input: 0, output: 0, cached: 0,
      cacheHitPct: null, perLanded: null, topAgent: null } })} now={NOW} />);
    expect(screen.getByText("Belum ada agen tercatat hari ini.")).toBeTruthy();
  });
});

describe("PetaPanas", () => {
  it("168 sel, sel terisi punya tooltip, ringkasan aksesibel", () => {
    const { container } = render(<PetaPanas overview={base()} now={NOW} />);
    expect(container.querySelectorAll(".hn-ovk-heat-cell")).toHaveLength(168);
    expect(container.querySelector('[title="Sel 13 Okt 14.00 · 38 menit"]')).not.toBeNull();
    expect(screen.getByRole("img", { name: "Jam kerja agen 7 hari: total 38 menit" })).toBeTruthy();
  });
});
