import { describe, it, expect, beforeEach } from "vitest";
import { PRESENCE_OFFLINE_MS, type PresenceSession } from "@hanoman/shared";
import {
  recordPresence, dropPresence, presenceEntries, __resetPresence,
} from "../src/services/presence/registry";

const T0 = Date.parse("2026-08-24T01:00:00.000Z");
const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T00:00:00.000Z", ...over,
});

beforeEach(__resetPresence);

describe("registry presence", () => {
  it("mencatat sesi sebuah device", () => {
    recordPresence("dev1", [s()], T0);
    const [e] = presenceEntries(T0);
    expect(e!.deviceId).toBe("dev1");
    expect(e!.sessions).toHaveLength(1);
  });

  // Ganti-penuh, bukan merge: sesi yang hilang dari frame memang sudah tak ada di mesin itu.
  it("frame berikutnya MENGGANTI seluruh daftar", () => {
    recordPresence("dev1", [s({ sessionId: "a" }), s({ sessionId: "b" })], T0);
    recordPresence("dev1", [s({ sessionId: "b" })], T0 + 1000);
    expect(presenceEntries(T0 + 1000)[0]!.sessions.map((x) => x.sessionId)).toEqual(["b"]);
  });

  it("statusAt dicap saat pertama terlihat", () => {
    recordPresence("dev1", [s()], T0);
    expect(presenceEntries(T0)[0]!.sessions[0]!.statusAt).toBe(new Date(T0).toISOString());
  });

  // Inti keputusan "statusAt dihitung hub": denyut yang isinya sama tak boleh menggeser stempel.
  it("statusAt TIDAK bergerak selama status tetap", () => {
    recordPresence("dev1", [s()], T0);
    recordPresence("dev1", [s()], T0 + 60_000);
    expect(presenceEntries(T0 + 60_000)[0]!.sessions[0]!.statusAt).toBe(new Date(T0).toISOString());
  });

  it("statusAt bergerak saat status berubah", () => {
    recordPresence("dev1", [s()], T0);
    recordPresence("dev1", [s({ status: "waiting" })], T0 + 60_000);
    expect(presenceEntries(T0 + 60_000)[0]!.sessions[0]!.statusAt)
      .toBe(new Date(T0 + 60_000).toISOString());
  });

  it("device yang berhenti berdenyut lewat ambang lenyap", () => {
    recordPresence("dev1", [s()], T0);
    expect(presenceEntries(T0 + PRESENCE_OFFLINE_MS - 1)).toHaveLength(1);
    expect(presenceEntries(T0 + PRESENCE_OFFLINE_MS)).toHaveLength(0);
  });

  it("dropPresence menghapus device seketika", () => {
    recordPresence("dev1", [s()], T0);
    dropPresence("dev1");
    expect(presenceEntries(T0)).toHaveLength(0);
  });

  it("device lain tak terpengaruh", () => {
    recordPresence("dev1", [s()], T0);
    recordPresence("dev2", [s()], T0);
    dropPresence("dev1");
    expect(presenceEntries(T0).map((e) => e.deviceId)).toEqual(["dev2"]);
  });

  it("stempel sesi yang sudah lenyap tak ikut terbawa saat sesi lahir lagi", () => {
    recordPresence("dev1", [s({ sessionId: "a" })], T0);
    recordPresence("dev1", [], T0 + 1_000);
    recordPresence("dev1", [s({ sessionId: "a" })], T0 + 2_000);
    expect(presenceEntries(T0 + 2_000)[0]!.sessions[0]!.statusAt)
      .toBe(new Date(T0 + 2_000).toISOString());
  });
});
