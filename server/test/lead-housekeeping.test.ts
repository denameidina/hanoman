import { describe, it, expect } from "vitest";
import { LEAD_DEFAULTS, type Lead } from "@hanoman/shared";
import { leadSessionHousekeeping, PANE_FAIL_LIMIT, type HousekeepingDeps } from "../src/services/lead/housekeeping";

// ADR-0228 · rumah tangga sesi lead.

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });
type Rec = { calls: string[] };
const deps = (over: Partial<HousekeepingDeps> = {}): HousekeepingDeps & Rec => {
  const calls: string[] = [];
  return {
    calls,
    sweep: async (_n, ms) => { calls.push(`sweep:${ms}`); },
    expire: async (_n, ms) => { calls.push(`expire:${ms}`); },
    projects: async () => ["a", "b"],
    hasOpen: async (p) => p === "a",
    stuck: async () => false,
    clearStuck: async (p) => { calls.push(`clear:${p}`); },
    ensure: async (p) => { calls.push(`ensure:${p}`); },
    failures: () => 0,
    pause: async (p) => { calls.push(`pause:${p}`); },
    rotate: async (p) => { calls.push(`rotate:${p}`); },
    deliver: async (ps) => { calls.push(`deliver:${ps.join(",")}`); },
    ...over,
  };
};

describe("leadSessionHousekeeping", () => {
  it("menyapu tenggat & izin dengan knob global, lalu menghidupkan pane yang punya pekerjaan", async () => {
    const d = deps();
    await leadSessionHousekeeping(0, cfg({ deliverTimeoutSec: 600, approvalTtlMin: 60 }), d);
    expect(d.calls).toEqual(["sweep:600000", "expire:3600000", "ensure:a", "deliver:a,b"]);
  });
  it("saat Pause tetap menyapu, tapi tak menghidupkan pane maupun mengantar", async () => {
    const d = deps();
    await leadSessionHousekeeping(0, cfg({ paused: true }), d);
    expect(d.calls).toEqual(["sweep:600000", "expire:86400000"]);
  });
  it("melewati proyek yang dijeda", async () => {
    const d = deps();
    await leadSessionHousekeeping(0, cfg({ pausedProjects: ["a"] }), d);
    expect(d.calls).not.toContain("ensure:a");
    expect(d.calls).toContain("deliver:b");
  });
  it(`pane gagal lahir ${PANE_FAIL_LIMIT}× → proyek dijeda dan tak diantari`, async () => {
    const d = deps({ failures: (p) => (p === "a" ? PANE_FAIL_LIMIT : 0) });
    await leadSessionHousekeeping(0, cfg(), d);
    expect(d.calls).toContain("pause:a");
    expect(d.calls).toContain("deliver:b");
  });
  it("pane macet (event dua kali dikembalikan) → reset penghitung lalu rotasi", async () => {
    const d = deps({ stuck: async (p) => p === "b" });
    await leadSessionHousekeeping(0, cfg(), d);
    expect(d.calls).toEqual(expect.arrayContaining(["clear:b", "rotate:b"]));
    expect(d.calls.indexOf("clear:b")).toBeLessThan(d.calls.indexOf("rotate:b"));
  });
  it("satu proyek yang melempar tak menghentikan proyek lain", async () => {
    const d = deps({ hasOpen: async (p) => { if (p === "a") throw new Error("db"); return false; } });
    await leadSessionHousekeeping(0, cfg(), d);
    expect(d.calls).toContain("deliver:b");
  });
});
