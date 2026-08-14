import { describe, it, expect } from "vitest";
import { zSchedulerState, SCHEDULER_DEFAULTS } from "./index";

describe("zSchedulerState (SPEC-299)", () => {
  it("memparse respons state fondasi apa adanya (field ekstra diabaikan)", () => {
    const sample = {
      config: SCHEDULER_DEFAULTS,
      cap: 2, liveCount: 1,
      sources: [
        { id: "backlog", enabled: true, everyMin: 15, lastRunAt: "2026-07-22T00:00:00.000Z", nextRunAt: "2026-07-22T00:15:00.000Z" },
        { id: "triase", enabled: false, everyMin: 30, lastRunAt: null, nextRunAt: null },
      ],
      // SPEC-523 · antrean pindah ke GET /scheduler/queue; state membawa hitungannya saja.
      queueCounts: { queued: 1, launched: 0, done: 1, failed: 0, canceled: 0 },
      sessions: [
        { id: "spec-2", projectId: "a", specId: "SPEC-2", flow: "feature", branch: "hanoman/spec-2",
          decision: false, exited: false, cwd: "/tmp/wt" },   // cwd ekstra harus diabaikan
      ],
    };
    const parsed = zSchedulerState.parse(sample);
    expect(parsed.sources[0]!.id).toBe("backlog");
    expect(parsed.sources[1]!.id).toBe("triase");
    expect(parsed.queueCounts.done).toBe(1);
    expect(parsed.sessions[0]!.specId).toBe("SPEC-2");
  });
});
