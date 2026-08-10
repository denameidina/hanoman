import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { tick } from "../src/services/scheduler/engine";
import { registerSchedulerSource, clearSources } from "../src/services/scheduler/registry";
import { setScheduler } from "../src/services/scheduler/config";
import { enqueue, listQueue } from "../src/services/scheduler/queue";
import { SCHEDULER_DEFAULTS, type Scheduler } from "@hanoman/shared";
import type { GovernorDeps } from "../src/services/scheduler/governor";

const clean = async () => { await prisma.schedulerQueueItem.deleteMany(); await prisma.setting.deleteMany(); };
beforeEach(async () => { await clean(); clearSources(); });
afterAll(clean);

const noLaunch: GovernorDeps = { drainCrons: async (s) => s, liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [], launch: async () => "s" };
const cfg = (over: Partial<Scheduler> = {}): Scheduler => ({ ...SCHEDULER_DEFAULTS, ...over });
const withBacklog = (enabled: boolean, everyMin = 15): Scheduler =>
  cfg({ enabled: true, sources: { ...SCHEDULER_DEFAULTS.sources, backlog: { enabled, everyMin } } });

describe("engine.tick gating", () => {
  it("does not call a disabled source's check", async () => {
    let checks = 0;
    registerSchedulerSource({ id: "backlog", check: async () => { checks++; } });
    await setScheduler(withBacklog(false));
    await tick(1_000_000, noLaunch);
    expect(checks).toBe(0);
  });
  it("calls an enabled source's check when due, and skips it before the window elapses", async () => {
    let checks = 0;
    registerSchedulerSource({ id: "backlog", check: async () => { checks++; } });
    await setScheduler(withBacklog(true, 15));
    const t0 = 1_000_000;
    await tick(t0, noLaunch);                 // belum pernah → due
    expect(checks).toBe(1);
    await tick(t0 + 14 * 60_000, noLaunch);   // 14 mnt < 15 → skip
    expect(checks).toBe(1);
    await tick(t0 + 15 * 60_000, noLaunch);   // 15 mnt → due lagi
    expect(checks).toBe(2);
  });
  it("master enabled=false makes the whole tick idle (no check, no drain)", async () => {
    let checks = 0;
    registerSchedulerSource({ id: "backlog", check: async () => { checks++; } });
    await setScheduler(cfg({ enabled: false, sources: { ...SCHEDULER_DEFAULTS.sources, backlog: { enabled: true, everyMin: 15 } } }));
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    await tick(1_000_000, { ...noLaunch, launch: async () => { launches++; return "s"; } });
    expect(checks).toBe(0);
    expect(launches).toBe(0);
  });
  it("Pause blocks launches within one tick (checkers may run, drain does not)", async () => {
    await setScheduler(cfg({ enabled: true, paused: true, maxConcurrent: 5 }));
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    await tick(1_000_000, { drainCrons: async (s) => s, liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [], launch: async () => { launches++; return "s"; } });
    expect(launches).toBe(0);                          // Pause → tak ada peluncuran
    expect((await listQueue("queued")).length).toBe(1); // item tetap di antrean
  });
  it("un-paused, the next tick drains the queued item", async () => {
    await setScheduler(cfg({ enabled: true, paused: false, maxConcurrent: 5 }));
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    await tick(1_000_000, { drainCrons: async (s) => s, liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [], launch: async () => { launches++; return "s1"; } });
    expect(launches).toBe(1);
  });
});

describe("engine.tick akhir sesi (SPEC-298)", () => {
  it("memanggil reconcile + scanDecisions tiap tick sebelum drain (kecuali master off)", async () => {
    await setScheduler(cfg({ enabled: true, paused: false, maxConcurrent: 5 }));
    let reconciled = 0, scanned = 0;
    await tick(1_000_000, noLaunch, { reconcile: async () => { reconciled++; }, scanDecisions: async () => { scanned++; } });
    expect(reconciled).toBe(1);
    expect(scanned).toBe(1);
  });
  it("Pause tetap menjalankan reconcile + scanDecisions (hanya drain yang diblok)", async () => {
    await setScheduler(cfg({ enabled: true, paused: true, maxConcurrent: 5 }));
    await enqueue({ specId: "SPEC-P", projectId: "p1", source: "backlog", priority: "tinggi" });
    let reconciled = 0, launches = 0;
    await tick(1_000_000, { ...noLaunch, launch: async () => { launches++; return "s"; } },
      { reconcile: async () => { reconciled++; }, scanDecisions: async () => {} });
    expect(reconciled).toBe(1);   // rekonsil jalan
    expect(launches).toBe(0);     // drain diblok Pause
  });
  it("master enabled=false → tick idle (reconcile tak dipanggil)", async () => {
    await setScheduler(cfg({ enabled: false }));
    let reconciled = 0;
    await tick(1_000_000, noLaunch, { reconcile: async () => { reconciled++; }, scanDecisions: async () => {} });
    expect(reconciled).toBe(0);
  });
});
