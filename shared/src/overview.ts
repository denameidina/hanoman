import { z } from "zod";

// ADR-0220 · Overview "Koran Pagi": agregat kinerja hari ini vs kemarin. Dihitung server
// (services/overview-metrics.ts) dan disiarkan sebagai grup snapshot global ke-12 `overview`.
// Setiap panel boleh `null`: sumbernya gagal dibaca, dan klien menulis kalimat datar, bukan angka.

export const zHeadlinePart = z.object({ text: z.string(), tone: z.enum(["bad", "good"]).optional() });
export type HeadlinePart = z.infer<typeof zHeadlinePart>;

export const zOverviewDay = z.object({ landed: z.number().int(), failed: z.number().int() });
export type OverviewDay = z.infer<typeof zOverviewDay>;

export const zOverviewRiver = z.object({
  created: z.number().int(), started: z.number().int(), landed: z.number().int(),
  // Median 7 hari terakhir atas spec yang selesai; null bila tak ada.
  leadTimeMedMs: z.number().nullable(), cycleTimeMedMs: z.number().nullable(),
});
export type OverviewRiver = z.infer<typeof zOverviewRiver>;

// Hanya AgentInvocation (subagen dan agen fase), BUKAN seluruh percakapan sesi utama: "token agen tercatat".
export const zOverviewTokens = z.object({
  input: z.number(), output: z.number(), cached: z.number(), total: z.number(),
  cacheHitPct: z.number().nullable(), perLanded: z.number().nullable(),
  topAgent: z.object({ name: z.string(), total: z.number() }).nullable(),
  yesterdayTotal: z.number(),
});
export type OverviewTokens = z.infer<typeof zOverviewTokens>;

export const zOverviewWait = z.object({
  todayMin: z.number(), yesterdayMin: z.number(), pctOfLive: z.number().nullable(),
});
export type OverviewWait = z.infer<typeof zOverviewWait>;

export const BENSIN_VERDICTS = ["habis", "aman", "stabil", "kurang-data"] as const;
export type BensinVerdict = (typeof BENSIN_VERDICTS)[number];
export const zOverviewBensin = z.object({
  source: z.enum(["claude", "codex"]), key: z.string(), label: z.string(),
  usedPct: z.number(), resetsAt: z.string().nullable(), exhaustAt: z.string().nullable(),
  verdict: z.enum(BENSIN_VERDICTS),
  samples: z.array(z.object({ at: z.string(), pct: z.number() })),
});
export type OverviewBensin = z.infer<typeof zOverviewBensin>;

export const zOverviewHeatmap = z.object({
  days: z.array(z.string()),               // YYYY-MM-DD lokal, terlama dulu
  minutes: z.array(z.array(z.number())),   // [hari][jam 0..23] = menit sesi agen hidup
});
export type OverviewHeatmap = z.infer<typeof zOverviewHeatmap>;

export const zOverviewRecords = z.object({
  streakDays: z.number().int(), bestStreak: z.number().int(),
  bestLandedDay: z.object({ date: z.string(), count: z.number().int() }).nullable(),
  landedRecordToday: z.boolean(),
});
export type OverviewRecords = z.infer<typeof zOverviewRecords>;

export const zOverview = z.object({
  generatedAt: z.string(),
  recordingSince: z.string(),   // awal perekam di memori (menunggu & bensin); restart mengulangnya
  today: zOverviewDay.nullable(), yesterday: zOverviewDay.nullable(),
  river: zOverviewRiver.nullable(), tokens: zOverviewTokens.nullable(), wait: zOverviewWait.nullable(),
  bensin: z.array(zOverviewBensin).nullable(), heatmap: zOverviewHeatmap.nullable(),
  records: zOverviewRecords.nullable(),
  headline: z.object({ text: z.string(), parts: z.array(zHeadlinePart) }),
});
export type OverviewDTO = z.infer<typeof zOverview>;
