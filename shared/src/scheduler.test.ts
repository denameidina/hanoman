import { describe, it, expect } from "vitest";
import { zScheduler, SCHEDULER_DEFAULTS, zSetting } from "./entities";

describe("zScheduler", () => {
  it("automation defaults are OFF", () => {
    expect(SCHEDULER_DEFAULTS.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.paused).toBe(false);
    expect(SCHEDULER_DEFAULTS.maxConcurrent).toBe(2);
    expect(SCHEDULER_DEFAULTS.autonomy).toBe("butuh-keputusan");
    expect(SCHEDULER_DEFAULTS.sources.backlog.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.sources.triase.enabled).toBe(false);
    expect(SCHEDULER_DEFAULTS.sources.triase.everyMin).toBe(30);
    // SPEC-384 · source `errors` dicabut (ADR-0092) — blok setelannya tak boleh lahir kembali.
    expect(SCHEDULER_DEFAULTS.sources).not.toHaveProperty("errors");
  });
  it("parses {} to full defaults", () => {
    expect(zScheduler.parse({})).toEqual(SCHEDULER_DEFAULTS);
  });
  it("rejects maxConcurrent < 1", () => {
    expect(zScheduler.safeParse({ maxConcurrent: 0 }).success).toBe(false);
  });
});

describe("launch guard configuration (SPEC-1108)", () => {
  it("protects old settings even when the scheduler and its sources are disabled", () => {
    const required = { autoDefault: true, autoScaffold: true, notifyFail: true };
    const old = zSetting.parse({ ...required, scheduler: { enabled: false, maxConcurrent: 6 } });
    expect(old.scheduler.launchGuard).toEqual({ enabled: true, maxLoadPerCore: 2.5 });
    expect(zSetting.parse(required).scheduler.launchGuard).toEqual({ enabled: true, maxLoadPerCore: 2.5 });
  });

  it.each([0, -1, Infinity, -Infinity, NaN])("rejects invalid load threshold %s", (maxLoadPerCore) => {
    expect(zScheduler.safeParse({ launchGuard: { maxLoadPerCore } }).success).toBe(false);
  });

  it("preserves an explicit disable and a positive fractional threshold", () => {
    expect(zScheduler.parse({ launchGuard: { enabled: false, maxLoadPerCore: 0.75 } }).launchGuard)
      .toEqual({ enabled: false, maxLoadPerCore: 0.75 });
  });
});

describe("zSetting.scheduler backward-compat", () => {
  it("an old Setting row without a scheduler block still parses, filling defaults", () => {
    const old = {
      model: "claude-opus-5", effort: "xhigh",
      autoDefault: true, autoScaffold: true, notifyFail: true,
      notifyDone: true, notifySound: "short", notifyDecision: true,
      notifyDecisionSound: "alert", agentAccessEnabled: false,
    };
    const parsed = zSetting.parse(old);
    expect(parsed.scheduler).toEqual(SCHEDULER_DEFAULTS);
  });
});
