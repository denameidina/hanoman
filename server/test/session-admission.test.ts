import { describe, expect, it } from "vitest";
import { zScheduler } from "@hanoman/shared";
import { createLaunchGate, launchStatus, type LaunchPane } from "../src/services/session-admission";

function fixture(options: { cap?: number; load?: number; platform?: string; enabled?: boolean } = {}) {
  const panes: LaunchPane[] = [];
  const cfg = zScheduler.parse({ maxConcurrent: options.cap ?? 1,
    launchGuard: { enabled: options.enabled ?? true, maxLoadPerCore: 2.5 } });
  const host = { platform: options.platform ?? "darwin", loadAverage: options.load ?? 8, cores: 8 };
  const gate = createLaunchGate({ listPanes: async () => panes.slice(), config: async () => cfg, host: () => host });
  const start = (id: string, force = false) => gate.run({ id, force }, async () => {
    const pane = { id, exited: false, launchClass: "agent" as const };
    panes.push(pane);
    return { id, reused: false };
  }, (p) => ({ id: p.id, reused: true }));
  return { panes, cfg, host, gate, start };
}

describe("SPEC-1108 · admission", () => {
  it("cap counts live operator terminals too, but excludes dead panes", async () => {
    const f = fixture();
    f.panes.push({ id: "shell", exited: false, launchClass: "terminal" },
      { id: "dead", exited: true, launchClass: "agent" });
    await expect(f.start("a")).rejects.toMatchObject({ kind: "capacity", admission: {
      liveCount: 1, liveAgentCount: 0, maxConcurrent: 1, loadPerCore: 1, maxLoadPerCore: 2.5,
    } });
    f.panes[0]!.exited = true;
    await expect(f.start("a")).resolves.toMatchObject({ id: "a" });
  });

  it("reattaches before cap and load checks", async () => {
    const f = fixture({ load: 40 });
    f.panes.push({ id: "a", exited: false, launchClass: "agent" });
    await expect(f.start("a")).resolves.toEqual({ id: "a", reused: true });
    expect(f.panes).toHaveLength(1);
  });

  it.each([[20, true], [20.01, false]])("load %s on 8 cores: allowed %s", async (load, allowed) => {
    const f = fixture({ load });
    if (allowed) await expect(f.start("a")).resolves.toMatchObject({ id: "a" });
    else await expect(f.start("a")).rejects.toMatchObject({ kind: "host-load", admission: {
      liveCount: 0, maxLoadPerCore: 2.5, loadStatus: "available",
    } });
  });

  it("Windows is explicitly unsupported, never an idle zero", async () => {
    const f = fixture({ platform: "win32", load: 0 });
    expect(launchStatus(f.panes, f.cfg, f.host)).toMatchObject({ loadPerCore: null, loadStatus: "unsupported" });
    await expect(f.start("a")).resolves.toMatchObject({ id: "a" });
  });

  it.each([0, NaN])("invalid core count %s is unavailable", (cores) => {
    const f = fixture();
    expect(launchStatus([], f.cfg, { ...f.host, cores })).toMatchObject({ loadPerCore: null, loadStatus: "unavailable" });
  });

  it.each(["force", "disabled"])("%s bypasses both gates", async (mode) => {
    const f = fixture({ load: 40, enabled: mode !== "disabled" });
    f.panes.push({ id: "existing", exited: false, launchClass: "agent" });
    await expect(f.start("a", mode === "force")).resolves.toMatchObject({ id: "a" });
  });

  it("two concurrent requests cannot consume the same final slot", async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.start("a"), f.start("b")]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.panes.map((p) => p.id)).toEqual(["a"]);
  });

  it("concurrent same-id launch reattaches to the first birth", async () => {
    const f = fixture();
    expect(await Promise.all([f.start("a"), f.start("a")])).toEqual([
      { id: "a", reused: false }, { id: "a", reused: true },
    ]);
  });

  it("failed preparation releases the mutex without consuming capacity", async () => {
    const f = fixture();
    await expect(f.gate.run({}, async () => { throw new Error("git failed"); }, () => "reuse")).rejects.toThrow("git failed");
    await expect(f.start("a")).resolves.toMatchObject({ id: "a" });
  });

  it("failed tmux read does not mean zero sessions and releases the mutex", async () => {
    const f = fixture();
    let reads = 0, births = 0;
    const gate = createLaunchGate({ listPanes: async () => {
      if (++reads === 1) throw new Error("tmux timeout");
      return [];
    }, config: async () => f.cfg, host: () => f.host });
    const start = () => gate.run({}, async () => ++births, () => -1);
    await expect(start()).rejects.toThrow("tmux timeout");
    expect(births).toBe(0);
    await expect(start()).resolves.toBe(1);
  });

  it("operator launches share the mutex and are never refused by cap/load", async () => {
    const f = fixture({ load: 40 });
    const operator = f.gate.run({ exempt: true }, async () => {
      f.panes.push({ id: "shell", exited: false, launchClass: "terminal" });
      return "shell";
    }, (pane) => pane.id);
    const agent = f.start("agent");
    const results = await Promise.allSettled([operator, agent]);
    expect(results[0]).toEqual({ status: "fulfilled", value: "shell" });
    expect(results[1]).toMatchObject({ status: "rejected", reason: { kind: "capacity", admission: { liveCount: 1 } } });
  });

  it("legacy Windows worktree panes contribute to structured-agent metrics", () => {
    const f = fixture();
    expect(launchStatus([{ id: "cron-a", cwd: String.raw`C:\repo\.worktrees\cron-a`, exited: false }],
      f.cfg, f.host)).toMatchObject({ liveCount: 1, liveAgentCount: 1 });
  });

  it("legacy classification never changes the all-pane cap", () => {
    const f = fixture();
    expect(launchStatus([
      { id: "spec-a", specId: "SPEC-A", exited: false },
      { id: "cron-a", cwd: "/repo/.worktrees/cron-a", exited: false },
      { id: "t", exited: false },
    ], f.cfg, f.host)).toMatchObject({ liveCount: 3, liveAgentCount: 2 });
  });
});
