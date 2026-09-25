import { describe, expect, it, vi, beforeEach } from "vitest";
import * as eventLog from "../src/services/logs/event-log";
import { LaunchAdmissionError } from "../src/services/session-admission";

describe("launch.rejected di titik lempar", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("LaunchAdmissionError menulis launch.rejected level warn", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    const admission = {
      enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 1, loadPerCore: 0.1,
      maxLoadPerCore: 1, loadStatus: "available" as const,
      memAvailablePct: 50, minMemAvailablePct: 15, memStatus: "available" as const,
    };
    expect(() => { throw new LaunchAdmissionError("capacity", admission); }).toThrow();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      kind: "launch.rejected", level: "warn", data: expect.objectContaining({ kind: "capacity" }),
    }));
  });
});
