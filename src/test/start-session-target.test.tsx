import { describe, it, expect } from "vitest";
import { LOCAL_DEVICE_ID, type PresenceView, type PresenceDeviceView, type HandledByEntry } from "@hanoman/shared";
import { startTargets } from "../src/api/start-targets";

const dev = (o: Partial<PresenceDeviceView> & { deviceId: string }): PresenceDeviceView => ({
  name: o.deviceId, local: o.deviceId === LOCAL_DEVICE_ID, online: true, lastSeenAt: null,
  sessions: [], control: { state: "available", protocol: 1, version: "v", capabilities: ["sessions:spawn"], since: "t" },
  capacity: { enabled: true, liveCount: 0, liveAgentCount: 0, maxConcurrent: 5, loadPerCore: 0.1, maxLoadPerCore: 1, loadStatus: "available" },
  ...o,
});
const handledBy = (deviceId: string, name = deviceId): HandledByEntry[] => [{ deviceId, name }];

describe("startTargets (SPEC-1216 · AC-B7/B8)", () => {
  it("urutan: hub ini dulu, lalu handledBy, lalu device lain", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: LOCAL_DEVICE_ID }), dev({ deviceId: "dB" }), dev({ deviceId: "dA" })] };
    const out = startTargets(view, handledBy("dA"));
    expect(out.map((t) => t.deviceId)).toEqual([LOCAL_DEVICE_ID, "dA", "dB"]);
  });
  it("eligible = online ∧ control available ∧ sessions:spawn ∧ kapasitas tak penuh", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA" })] };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: true });
  });
  it.each([
    ["offline", { online: false }, "offline"],
    ["control null", { control: null }, "control-off"],
    ["protocol-mismatch", { control: { state: "protocol-mismatch", protocol: 2, version: "v", capabilities: [], since: "t" } }, "protocol-mismatch"],
    ["tanpa sessions:spawn", { control: { state: "available", protocol: 1, version: "v", capabilities: ["sessions:read"], since: "t" } }, "no-spawn"],
    ["kapasitas penuh (liveAgentCount≥max)", { capacity: { enabled: true, liveCount: 5, liveAgentCount: 5, maxConcurrent: 5, loadPerCore: 0.1, maxLoadPerCore: 1, loadStatus: "available" } }, "capacity-full"],
    ["kapasitas penuh (load>ambang)", { capacity: { enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 5, loadPerCore: 2, maxLoadPerCore: 1, loadStatus: "available" } }, "capacity-full"],
  ] as const)("%s → reason %s", (_label, over, reason) => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", ...over })] };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: false, reason });
  });
  it("capacity === null bukan alasan menolak", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", capacity: null })] };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: true });
  });
});
