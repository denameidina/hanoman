import { describe, it, expect, beforeEach } from "vitest";
import { LOCAL_DEVICE_ID, type PresenceDeviceView } from "@hanoman/shared";
import { remoteSessionVerdict } from "../src/services/presence/remote-session";
import { recordRecentlyOffline, recentlyOffline, recordPresence, __resetPresence } from "../src/services/presence/registry";
import { startSpecSession, LaunchError } from "../src/services/session-launch";
import { DEFAULT_SETTING } from "../src/services/settings";
import { issueDeviceToken } from "../src/services/device-token";
import { prisma } from "../src/db";
import { makeSpec, makeProject, makeSetting, resetDb } from "./factory";

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

describe("startSpecSession gerbang presence (SPEC-1216 · AC-B5/B6)", () => {
  // Catatan penyimpangan (Task 5): mesin uji ini bisa punya sesi tmux tersisa dari sesi hanoman
  // lain (ADR-0161 launchGuard nyata), jadi tanpa mematikan launchGuard `withSessionAdmission`
  // (yang membungkus startSpecSession LEBIH LUAR dari gerbang presence) menolak duluan dengan
  // LaunchAdmissionError "capacity" — bukan LaunchError yang diuji. Pola sama terminal.route.test.ts.
  beforeEach(async () => {
    await resetDb(); __resetPresence();
    await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany();
    await makeSetting({ scheduler: { ...DEFAULT_SETTING.scheduler, launchGuard: { enabled: false, maxLoadPerCore: 2.5 } } });
  });

  it("sesi working di device lain untuk spec yang sama → LaunchError remote-session, TAK memanggil createSession", async () => {
    const project = await makeProject();
    const spec = await makeSpec({ projectId: project.id, launchApprovedAt: new Date(), launchApprovedBy: "user:a@b.co" });
    // Catatan penyimpangan (Task 5): `presenceView()` (server/src/services/presence/view.ts)
    // HANYA memuat device yang punya baris `DeviceToken` DB — `recordPresence` ke registry
    // in-memory saja (pola plan) tak cukup untuk device muncul di `view.devices`. Perlu token
    // sungguhan supaya deviceId-nya bisa "dilihat" jalur presenceView() yang sama dipakai gerbang.
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    recordPresence(t.id, [{ sessionId: "s1", projectId: project.id, specId: spec.id, agent: "claude", status: "working", startedAt: new Date().toISOString() }]);
    await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "remote-session" });
  });
});
