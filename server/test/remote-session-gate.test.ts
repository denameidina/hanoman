import { describe, it, expect, beforeEach } from "vitest";
import { LOCAL_DEVICE_ID, type PresenceDeviceView } from "@hanoman/shared";
import { remoteSessionVerdict } from "../src/services/presence/remote-session";
import { recordRecentlyOffline, recentlyOffline, __resetPresence } from "../src/services/presence/registry";

const dev = (id: string, over: Partial<PresenceDeviceView> = {}): PresenceDeviceView => ({
  deviceId: id, name: id, local: id === LOCAL_DEVICE_ID, online: true, lastSeenAt: null,
  sessions: [], control: null, capacity: null, ...over,
});

describe("remoteSessionVerdict (SPEC-1216 · AC-B5/B6)", () => {
  it("sesi working di device lain → remote-session", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, recentlyOffline: [], lastResultDeviceId: null,
      devices: [dev("dA", { sessions: [{ sessionId: "s1", projectId: "p", specId: "SPEC-1", agent: "claude", status: "working", startedAt: "t", statusAt: "t" }] })],
    });
    expect(v).toEqual({ kind: "remote-session", remote: { deviceId: "dA", name: "dA", sessionId: "s1" } });
  });
  it("tanpa sesi hidup, recentlyOffline ≤24 jam → confirm-required", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, devices: [], lastResultDeviceId: null,
      recentlyOffline: [{ deviceId: "dA", name: "dA", specId: "SPEC-1", sessionId: "s1", at: 1000 - 3600_000 }],
    });
    expect(v).toEqual({ kind: "confirm-required", remote: { deviceId: "dA", name: "dA", sessionId: "s1", offline: true } });
  });
  it("recentlyOffline >24 jam → diabaikan (jatuh ke lastResultDeviceId lalu ok)", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, devices: [], lastResultDeviceId: null,
      recentlyOffline: [{ deviceId: "dA", name: "dA", specId: "SPEC-1", sessionId: "s1", at: 1000 - 25 * 3600_000 }],
    });
    expect(v).toEqual({ kind: "ok" });
  });
  it("lastResultDeviceId offline → confirm-required sessionId null", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, devices: [], recentlyOffline: [],
      lastResultDeviceId: { deviceId: "dA", name: "dA" },
    });
    expect(v).toEqual({ kind: "confirm-required", remote: { deviceId: "dA", name: "dA", sessionId: null, offline: true } });
  });
  it("lastResultDeviceId online (ada di devices) → ok", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, recentlyOffline: [], lastResultDeviceId: { deviceId: "dA", name: "dA" },
      devices: [dev("dA")],
    });
    expect(v).toEqual({ kind: "ok" });
  });
  it("tak ada apa pun → ok", () => {
    expect(remoteSessionVerdict({ specId: "SPEC-1", now: 1000, devices: [], recentlyOffline: [], lastResultDeviceId: null }))
      .toEqual({ kind: "ok" });
  });
  it("device LOCAL_DEVICE_ID dengan sesi working diabaikan (bukan 'device lain')", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, recentlyOffline: [], lastResultDeviceId: null,
      devices: [dev(LOCAL_DEVICE_ID, { sessions: [{ sessionId: "s1", projectId: "p", specId: "SPEC-1", agent: "claude", status: "working", startedAt: "t", statusAt: "t" }] })],
    });
    expect(v).toEqual({ kind: "ok" });
  });
});

describe("recentlyOffline registry (SPEC-1216 · AC-B6)", () => {
  beforeEach(() => __resetPresence());
  it("diisi via recordRecentlyOffline, kedaluwarsa 24 jam saat dibaca", () => {
    recordRecentlyOffline({ deviceId: "dA", name: "laptop", specId: "SPEC-1", sessionId: "s1" }, 1000);
    expect(recentlyOffline("SPEC-1", 1000 + 3600_000)).toEqual([
      { deviceId: "dA", name: "laptop", specId: "SPEC-1", sessionId: "s1", at: 1000 },
    ]);
    expect(recentlyOffline("SPEC-1", 1000 + 25 * 3600_000)).toEqual([]);
  });
});
