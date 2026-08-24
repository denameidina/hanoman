import { describe, it, expect } from "vitest";
import { presenceIndex } from "../src/screens/presence-map";
import type { PresenceView } from "@hanoman/shared";

const view = (over: Partial<PresenceView> = {}): PresenceView => ({
  enabled: true,
  devices: [{
    deviceId: "local", name: "mac-dena", local: true, online: true, lastSeenAt: null,
    sessions: [{
      sessionId: "spec-1", projectId: "hanoman", specId: "SPEC-1", agent: "claude",
      status: "working", startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z",
    }],
  }, {
    deviceId: "d2", name: "laptop", local: false, online: true, lastSeenAt: null,
    sessions: [{
      sessionId: "spec-2", projectId: "tumbuh", specId: "SPEC-2", agent: "codex",
      status: "waiting", startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z",
    }, {
      sessionId: "spec-3", projectId: "hanoman", specId: "SPEC-3", agent: "claude",
      status: "exited", startedAt: "2026-08-24T00:00:00.000Z", statusAt: "2026-08-24T00:00:00.000Z",
    }],
  }],
  ...over,
});

describe("presenceIndex", () => {
  it("memetakan spec ke nama device", () => {
    const { bySpec } = presenceIndex(view());
    expect(bySpec.get("SPEC-1")).toEqual(["mac-dena"]);
    expect(bySpec.get("SPEC-2")).toEqual(["laptop"]);
  });

  it("sesi yang sudah berakhir tak menandai apa pun", () => {
    expect(presenceIndex(view()).bySpec.has("SPEC-3")).toBe(false);
  });

  it("memetakan project, tanpa nama ganda", () => {
    const { byProject } = presenceIndex(view());
    expect(byProject.get("hanoman")).toEqual(["mac-dena"]);
    expect(byProject.get("tumbuh")).toEqual(["laptop"]);
  });

  it("device offline tak menandai apa pun", () => {
    const v = view();
    v.devices[1]!.online = false;
    expect(presenceIndex(v).bySpec.has("SPEC-2")).toBe(false);
  });

  it("view yang dimatikan menghasilkan peta kosong", () => {
    const { bySpec, byProject } = presenceIndex(view({ enabled: false }));
    expect(bySpec.size).toBe(0);
    expect(byProject.size).toBe(0);
  });
});
