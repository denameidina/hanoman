import { describe, it, expect } from "vitest";
import { capacityFrameJson, capacitySignature, zCapacityFrame, zPresenceFrame } from "./presence";
import type { LaunchStatus } from "./session-admission";

const admission: LaunchStatus = {
  enabled: true, liveCount: 2, liveAgentCount: 1, maxConcurrent: 4,
  loadPerCore: 0.42, maxLoadPerCore: 1.5, loadStatus: "available",
  memAvailablePct: 50, minMemAvailablePct: 15, memStatus: "available",
};

describe("frame capacity (SPEC-1215 · ADR-0165 §9)", () => {
  it("frame yang dirakit lolos zCapacityFrame dan .strict()", () => {
    const parsed = JSON.parse(capacityFrameJson(admission));
    expect(zCapacityFrame.safeParse(parsed).success).toBe(true);
    expect(zCapacityFrame.safeParse({ ...parsed, extra: 1 }).success).toBe(false);
  });
  it("hub versi lama (zPresenceFrame) membuangnya senyap — gagal parse, bukan melempar", () => {
    expect(zPresenceFrame.safeParse(JSON.parse(capacityFrameJson(admission))).success).toBe(false);
  });
  it("signature membulatkan loadPerCore ke 1 desimal supaya denyut beban tak membanjiri frame", () => {
    expect(capacitySignature({ ...admission, loadPerCore: 0.41 })).toBe(capacitySignature({ ...admission, loadPerCore: 0.44 }));
    expect(capacitySignature({ ...admission, loadPerCore: 0.41 })).not.toBe(capacitySignature({ ...admission, loadPerCore: 0.49 }));
    expect(capacitySignature({ ...admission, liveCount: 3 })).not.toBe(capacitySignature(admission));
    expect(capacitySignature({ ...admission, loadPerCore: null })).toContain("null");
  });
});
