import { describe, it, expect } from "vitest";
import {
  MAX_PRESENCE_SESSIONS, PRESENCE_HEARTBEAT_MS, PRESENCE_MAX_FRAMES_PER_MIN,
  PRESENCE_MAX_FRAME_BYTES, PRESENCE_OFFLINE_MS, PRESENCE_TICK_MS, presenceFrameJson,
  trimPresenceToBudget, zPresenceSession, type PresenceSession,
} from "./presence";

/* SPEC-919 · ADR-0147/0148 · konstanta ini bukan angka bebas: masing-masing memikul satu
   invariant yang ditulis di ADR-nya, dan seluruh test lain memakai SIMBOLNYA — jadi tanpa berkas
   ini nilainya bisa diubah sepuluh kali lipat tanpa satu pun test merah. */

describe("anggaran konstanta presence", () => {
  it("ambang offline = 3× denyut — satu denyut hilang tak boleh menghukum", () => {
    expect(PRESENCE_OFFLINE_MS).toBe(PRESENCE_HEARTBEAT_MS * 3);
  });

  it("denyut jauh lebih jarang daripada tick, supaya dedup signature yang mendominasi", () => {
    expect(PRESENCE_HEARTBEAT_MS).toBeGreaterThanOrEqual(PRESENCE_TICK_MS * 5);
  });

  it("tick cukup rapat untuk terasa hidup", () => {
    expect(PRESENCE_TICK_MS).toBeLessThanOrEqual(5_000);
  });

  it("jatah laju memberi ruang jauh di atas denyut normal, tapi tetap plafon", () => {
    const denyutPerMenit = 60_000 / PRESENCE_HEARTBEAT_MS;
    expect(PRESENCE_MAX_FRAMES_PER_MIN).toBeGreaterThan(denyutPerMenit * 10);
    expect(PRESENCE_MAX_FRAMES_PER_MIN).toBeLessThanOrEqual(120);
  });

  /* Frame terbesar yang sah harus muat dengan margin di bawah `maxPayload` 64 KiB milik plugin
     WebSocket — batas itu ditegakkan `ws` dengan close 1009 SEBELUM handler kita sempat
     mengabaikan apa pun, dan socket itu mengangkut changefeed sync (ADR-0147 §4). */
  it("frame penuh berisi sesi terpanjang yang sah dipotong sampai muat", () => {
    const terpanjang: PresenceSession = {
      sessionId: "s".repeat(200), projectId: "p".repeat(200), specId: "S".repeat(200),
      flow: "f".repeat(40), phase: "P".repeat(80), agent: "claude",
      status: "waiting", startedAt: "2026-08-24T00:00:00.000Z",
    };
    expect(zPresenceSession.safeParse(terpanjang).success).toBe(true);
    const penuh = Array.from({ length: MAX_PRESENCE_SESSIONS }, () => terpanjang);

    // Plafon JUMLAH sendirian tak cukup — inilah angka yang membuktikannya.
    expect(Buffer.byteLength(presenceFrameJson(penuh)))
      .toBeGreaterThan(64 * 1024);

    const dipotong = trimPresenceToBudget(penuh);
    expect(dipotong.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(presenceFrameJson(dipotong)))
      .toBeLessThanOrEqual(PRESENCE_MAX_FRAME_BYTES);
  });

  it("daftar wajar tak dipotong sama sekali", () => {
    const wajar: PresenceSession[] = Array.from({ length: 40 }, (_, i) => ({
      sessionId: `spec-${900 + i}`, projectId: "hanoman", specId: `SPEC-${900 + i}`,
      flow: "feature", phase: "Execute", agent: "claude",
      status: "working", startedAt: "2026-08-24T00:00:00.000Z",
    }));
    expect(trimPresenceToBudget(wajar)).toHaveLength(40);
  });

  it("anggaran byte lebih ketat daripada maxPayload plugin WebSocket", () => {
    expect(PRESENCE_MAX_FRAME_BYTES).toBeLessThanOrEqual(64 * 1024 / 2);
  });
});
