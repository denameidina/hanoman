import { describe, it, expect } from "vitest";
import { zLeadProject, LEAD_DEFAULTS } from "@hanoman/shared";
import { computeBudget, launchBudget } from "../src/services/lead/budget";
import { leadProjectConfig, authorityFor } from "../src/services/lead/project-config";

// ADR-0228 · jatah peluncuran. Kasus asal: 7 backlog crm diluncurkan dalam 30 dtk lalu 7/7 gagal.

const cfg = zLeadProject.parse({});
const base = {
  slotsFree: 3, hostOk: true, quota: { status: "ok" as const, maxUsedPct: 10 },
  inProbe: 0, failStreak: 0, cfg,
};

describe("computeBudget", () => {
  it("dibatasi ramp walau slot banyak", () => {
    expect(computeBudget(base).n).toBe(1);
  });
  it("nol saat masih ada sesi dalam probe", () => {
    const b = computeBudget({ ...base, inProbe: 1 });
    expect(b.n).toBe(0);
    expect(b.reasons.join(" ")).toContain("probe");
  });
  it("nol saat kuota ≥ quotaStopPct", () => {
    const b = computeBudget({ ...base, quota: { status: "ok", maxUsedPct: 85 } });
    expect(b.n).toBe(0);
    expect(b.reasons.join(" ")).toContain("kuota");
  });
  it("nol (gagal aman) saat data kuota tak terbaca", () => {
    expect(computeBudget({ ...base, quota: { status: "error", maxUsedPct: 0 } }).n).toBe(0);
  });
  it("nol saat host menolak atau slot habis", () => {
    expect(computeBudget({ ...base, hostOk: false }).n).toBe(0);
    expect(computeBudget({ ...base, slotsFree: 0 }).n).toBe(0);
    expect(computeBudget({ ...base, slotsFree: -2 }).n).toBe(0);
  });
  it("pemutus beruntun menyala pada failStreak", () => {
    const b = computeBudget({ ...base, failStreak: 2 });
    expect(b).toMatchObject({ n: 0, tripped: true });
  });
  it("rampStep lebih besar membuka lebih banyak, tetap ≤ slot", () => {
    const wide = zLeadProject.parse({ rampStep: 5 });
    expect(computeBudget({ ...base, cfg: wide }).n).toBe(3);
  });
});

describe("launchBudget", () => {
  const now = Date.parse("2026-10-20T07:00:00Z");
  const deps = (items: { status: string; launchedAt: Date | null }[]) => ({
    cfg: async () => LEAD_DEFAULTS,
    status: async () => ({ slotsFree: 4, hostOk: true }),
    quota: async () => ({ status: "ok" as const, maxUsedPct: 5 }),
    leadItems: async () => items,
    now: () => now,
  });

  it("deret gagal terbaru dari baris antrean source=lead menyalakan pemutus", async () => {
    const b = await launchBudget("p", deps([
      { status: "failed", launchedAt: new Date(now - 60 * 60_000) },
      { status: "failed", launchedAt: new Date(now - 61 * 60_000) },
      { status: "done", launchedAt: new Date(now - 90 * 60_000) },
    ]));
    expect(b).toMatchObject({ n: 0, tripped: true });
  });
  it("satu sukses memutus deret gagal", async () => {
    const b = await launchBudget("p", deps([
      { status: "failed", launchedAt: new Date(now - 60 * 60_000) },
      { status: "done", launchedAt: new Date(now - 61 * 60_000) },
      { status: "failed", launchedAt: new Date(now - 62 * 60_000) },
    ]));
    expect(b).toMatchObject({ n: 1, tripped: false });
  });
  it("sesi yang baru diluncurkan masih dalam probe → jatah 0", async () => {
    const b = await launchBudget("p", deps([{ status: "launched", launchedAt: new Date(now - 2 * 60_000) }]));
    expect(b.n).toBe(0);
  });
  it("sesi yang lolos probe tak menahan jatah dan tak dihitung gagal", async () => {
    const b = await launchBudget("p", deps([{ status: "launched", launchedAt: new Date(now - 30 * 60_000) }]));
    expect(b.n).toBe(1);
  });
});

describe("project-config", () => {
  it("menggabung default dengan override per proyek", () => {
    const l = { ...LEAD_DEFAULTS, projects: { p: { targetBranch: "develop", authority: { "integrate-main": "auto" as const } } } };
    expect(leadProjectConfig(l, "p").targetBranch).toBe("develop");
    expect(leadProjectConfig(l, "q").targetBranch).toBe("main");
    expect(authorityFor(l, "p", "integrate-main")).toBe("auto");
    expect(authorityFor(l, "q", "integrate-main")).toBe("ask");
    expect(authorityFor(l, "p", "answer-session")).toBe("auto");
  });
});
