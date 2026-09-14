import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { hostname } from "node:os";
import { LOCAL_DEVICE_ID, type LaunchStatus, type PresenceSession } from "@hanoman/shared";
import { prisma } from "../src/db";
import { recordPresence, recordCapacity, __resetPresence } from "../src/services/presence/registry";
import { presenceView } from "../src/services/presence/view";
import { __resetRelayHub, attachRelaySocket } from "../src/services/relay/hub";
import { __resetDeviceSockets } from "../src/services/device-sockets";

const T0 = Date.parse("2026-08-24T01:00:00.000Z");
const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T00:00:00.000Z", ...over,
});
const none = async () => [];

const clean = async () => {
  await prisma.deviceToken.deleteMany();
  await prisma.user.deleteMany();
};
const device = async (name: string, over: { revokedAt?: Date; lastSeenAt?: Date } = {}) => {
  const u = await prisma.user.create({ data: { email: `${name}@d.co`, passwordHash: "x:y" } });
  return prisma.deviceToken.create({
    data: { userId: u.id, name, tokenHash: `h-${name}`, ...over },
  });
};

beforeEach(async () => { __resetPresence(); __resetRelayHub(); __resetDeviceSockets(); await clean(); });
afterAll(clean);

describe("presenceView", () => {
  // SPEC-1215 · ADR-0165 §9 · kapasitas & ketersediaan kendali untuk routing target Start (SPEC-1216).
  const adm = (over: Partial<LaunchStatus> = {}): LaunchStatus => ({
    enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 4,
    loadPerCore: 0.3, maxLoadPerCore: 1.5, loadStatus: "available", ...over,
  });

  it("device online membawa capacity dan control; mesin lokal membawa capacity sendiri", async () => {
    const d = await device("laptop");
    recordPresence(d.id, [s()], T0);
    recordCapacity(d.id, adm(), T0);
    const link = attachRelaySocket(d.id, { readyState: 1, send: () => {}, close: () => {} });
    link.onMessage(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read", "sessions:spawn"] }));
    const v = await presenceView({ local: none, localCapacity: async () => adm({ liveCount: 9 }), now: T0 });
    expect(v.devices[0]).toMatchObject({ local: true, control: null, capacity: { liveCount: 9 } });
    const found = v.devices.find((x) => x.deviceId === d.id)!;
    expect(found.capacity).toEqual(adm());
    expect(found.control).toMatchObject({ state: "available", capabilities: ["sessions:read", "sessions:spawn"] });
  });

  it("device offline: capacity dan control null", async () => {
    const d = await device("laptop");
    recordCapacity(d.id, adm(), T0);
    const v = await presenceView({ local: none, localCapacity: async () => adm(), now: T0 });
    expect(v.devices.find((x) => x.deviceId === d.id)).toMatchObject({ online: false, capacity: null, control: null });
  });
  it("enabled false tanpa satu pun device token", async () => {
    expect((await presenceView({ local: none, now: T0 })).enabled).toBe(false);
  });

  it("enabled true begitu ada device token yang belum dicabut", async () => {
    await device("laptop");
    expect((await presenceView({ local: none, now: T0 })).enabled).toBe(true);
  });

  it("device yang dicabut tak dihitung dan tak ditampilkan", async () => {
    await device("lama", { revokedAt: new Date(T0) });
    const v = await presenceView({ local: none, now: T0 });
    expect(v.enabled).toBe(false);
    expect(v.devices.map((d) => d.name)).not.toContain("lama");
  });

  it("device terdaftar tanpa frame tampil offline berikut lastSeenAt", async () => {
    await device("laptop", { lastSeenAt: new Date(T0 - 3_600_000) });
    const [d] = (await presenceView({ local: none, now: T0 })).devices
      .filter((x) => x.deviceId !== LOCAL_DEVICE_ID);
    expect(d!.online).toBe(false);
    expect(d!.lastSeenAt).toBe(new Date(T0 - 3_600_000).toISOString());
    expect(d!.sessions).toEqual([]);
  });

  it("device yang berdenyut tampil online berikut sesinya", async () => {
    const d = await device("laptop");
    recordPresence(d.id, [s()], T0);
    const found = (await presenceView({ local: none, now: T0 })).devices.find((x) => x.deviceId === d.id);
    expect(found!.online).toBe(true);
    expect(found!.sessions[0]!.sessionId).toBe("spec-919");
  });

  // Requirement 5: sesi hub sendiri lewat pintu yang SAMA — tak ada sumber kebenaran kedua.
  it("mesin lokal selalu ada, bernama hostname, dan ditandai local", async () => {
    await device("laptop");
    const v = await presenceView({ local: async () => [s({ sessionId: "lokal" })], now: T0 });
    const me = v.devices.find((d) => d.deviceId === LOCAL_DEVICE_ID);
    expect(me).toMatchObject({ local: true, online: true, name: hostname() });
    expect(me!.sessions[0]!.sessionId).toBe("lokal");
  });

  it("mesin lokal didahulukan di daftar", async () => {
    await device("laptop");
    const v = await presenceView({ local: none, now: T0 });
    expect(v.devices[0]!.deviceId).toBe(LOCAL_DEVICE_ID);
  });

  it("registry tanpa baris DeviceToken padanan diabaikan (token dihapus saat socket masih hidup)", async () => {
    recordPresence("hantu", [s()], T0);
    const v = await presenceView({ local: none, now: T0 });
    expect(v.devices.map((d) => d.deviceId)).not.toContain("hantu");
  });

  it("snapshot lokal yang melempar tidak menjatuhkan view", async () => {
    const v = await presenceView({ local: async () => { throw new Error("tmux mati"); }, now: T0 });
    expect(v.devices[0]!.sessions).toEqual([]);
  });
});
