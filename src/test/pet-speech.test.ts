import { describe, expect, it } from "vitest";
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import { derivePetState, PET_URGENT_MS, type PetView } from "../src/screens/pet-state";
import {
  humanAge, isUrgent, petRecap, petSnapshot, PET_RECAP_MS, PET_SPEECH_MS, speechFor,
} from "../src/screens/pet-speech";

const NOW = Date.parse("2026-08-22T10:00:00.000Z");

function spec(over: Partial<Spec> & { id: string }): Spec {
  return {
    projectId: "hanoman", title: `judul ${over.id}`, source: "brief", stage: "spec-ready",
    priority: "sedang", author: "op", objective: "", payload: null, branchFrom: null,
    baseSha: null, createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
    dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], ...over,
  } as Spec;
}
const session = (over: Partial<TerminalSession> & { id: string }): TerminalSession =>
  ({ projectId: "hanoman", cwd: "/tmp", exited: false, ...over });

const view = (over: Partial<PetView>): PetView => ({
  kind: "ready", pose: "ready", headline: "h", detail: "d", count: 1,
  subject: null, since: null, target: null, recheckAt: null, conditions: [], ...over,
} as PetView);

describe("speechFor (SPEC-898)", () => {
  it("hanya kabar yang tak lewat Toast yang bergelembung", () => {
    for (const kind of ["working", "review", "blocked", "deciding", "ready"] as const)
      expect(speechFor(view({ kind }), NOW)).toBeNull();
  });

  it("shipped: satu baris, dengan hitungan saat lebih dari satu", () => {
    expect(speechFor(view({ kind: "shipped", subject: "SPEC-547" }), NOW))
      .toEqual({ kind: "pose", text: "SPEC-547 selesai", ttl: PET_SPEECH_MS });
    expect(speechFor(view({ kind: "shipped", subject: "SPEC-547", count: 2 }), NOW)!.text)
      .toBe("SPEC-547 selesai · 2 kabar");
  });

  it("docs-updated memakai kata kerjanya sendiri", () => {
    expect(speechFor(view({ kind: "docs-updated", subject: "SPEC-612" }), NOW)!.text)
      .toBe("SPEC-612 dokumen terbit");
  });

  it("waiting menyebut umur HANYA saat sudah mendesak", () => {
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-612", since: NOW - 60_000 }), NOW)!.text)
      .toBe("SPEC-612 butuh jawabanmu");
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-612", since: NOW - 12 * 60_000 }), NOW)!.text)
      .toBe("SPEC-612 butuh jawabanmu — 12 menit");
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-612", since: null }), NOW)!.text)
      .toBe("SPEC-612 butuh jawabanmu");
  });

  it("hitungan mendahului umur", () => {
    expect(speechFor(view({ kind: "waiting", subject: "SPEC-1", count: 3, since: NOW - 30 * 60_000 }), NOW)!.text)
      .toBe("SPEC-1 butuh jawabanmu · 3 sesi — 30 menit");
  });

  it("offline bicara tanpa pokok", () => {
    expect(speechFor(view({ kind: "offline", subject: null }), NOW)!.text).toBe("Aku kehilangan sambungan");
  });

  it("bekerja atas PetView nyata dari derivePetState", () => {
    const sessions = [session({
      id: "a", specId: "SPEC-1", decision: true,
      decisionAt: new Date(NOW - 15 * 60_000).toISOString(),
    })];
    const v = derivePetState({ sessions, backlog: [spec({ id: "SPEC-1", stage: "executing" })], notifications: [], now: NOW });
    expect(speechFor(v, NOW)!.text).toBe("SPEC-1 butuh jawabanmu — 15 menit");
  });
});

describe("humanAge & isUrgent (SPEC-898)", () => {
  it("detik, menit, jam", () => {
    expect(humanAge(9_000)).toBe("9 detik");
    expect(humanAge(12 * 60_000)).toBe("12 menit");
    expect(humanAge(60 * 60_000)).toBe("1 jam");
    expect(humanAge(65 * 60_000)).toBe("1 jam 5 menit");
  });
  it("mendesak hanya untuk waiting yang punya stempel dan sudah lewat ambang", () => {
    expect(isUrgent({ kind: "waiting", since: NOW - PET_URGENT_MS }, NOW)).toBe(true);
    expect(isUrgent({ kind: "waiting", since: NOW - PET_URGENT_MS + 1 }, NOW)).toBe(false);
    expect(isUrgent({ kind: "waiting", since: null }, NOW)).toBe(false);
    expect(isUrgent({ kind: "failed", since: NOW - 60 * 60_000 }, NOW)).toBe(false);
  });
});

// `type` sengaja longgar: server menulis `automerge` yang belum masuk enum `zNotification`.
const notif = (over: Partial<Omit<Notification, "type">> & { id: string; type?: string }): Notification => ({
  type: "done", title: "judul", specId: null, projectId: "hanoman", sessionId: null,
  readAt: null, createdAt: new Date(NOW).toISOString(), ...over,
} as Notification);

describe("rekap selama kamu pergi (SPEC-898)", () => {
  const bl = [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })];

  it("tanpa perubahan → null (tab sepi tak disambut '0 selesai')", () => {
    const input = { sessions: [], backlog: bl, notifications: [], now: NOW };
    expect(petRecap(petSnapshot(input), { ...input, now: NOW + 60_000 })).toBeNull();
  });

  it("menghitung selesai · menunggu · gagal", () => {
    const before = petSnapshot({ sessions: [session({ id: "a", specId: "SPEC-1" })], backlog: bl, notifications: [], now: NOW });
    const after = {
      sessions: [
        session({ id: "a", specId: "SPEC-1", decision: true }),        // working → waiting
        session({ id: "b", exited: true, exitCode: 1 }),               // gagal, baru
      ],
      backlog: bl,
      notifications: [
        notif({ id: "n1", type: "done", createdAt: new Date(NOW + 60_000).toISOString() }),
        notif({ id: "n2", type: "automerge", createdAt: new Date(NOW + 90_000).toISOString() }),
      ],
      now: NOW + 20 * 60_000,
    };
    expect(petRecap(before, after)).toEqual({ kind: "recap", text: "2 selesai · 1 menunggu · 1 gagal", ttl: PET_RECAP_MS });
  });

  it("kabar yang lahir SAAT pergi terhitung walau transient-nya sudah luruh", () => {
    const before = petSnapshot({ sessions: [], backlog: bl, notifications: [], now: NOW });
    const after = {
      sessions: [], backlog: bl,
      notifications: [notif({ id: "n1", createdAt: new Date(NOW + 60_000).toISOString() })],
      now: NOW + 40 * 60_000,     // jauh di luar PET_TRANSIENT_MS
    };
    expect(petRecap(before, after)!.text).toBe("1 selesai");
  });

  it("sesi yang SUDAH menunggu sebelum pergi tak dihitung ulang", () => {
    const waiting = [session({ id: "a", specId: "SPEC-1", decision: true })];
    const before = petSnapshot({ sessions: waiting, backlog: bl, notifications: [], now: NOW });
    expect(petRecap(before, { sessions: waiting, backlog: bl, notifications: [], now: NOW + 20 * 60_000 })).toBeNull();
  });

  it("notifikasi yang sudah ada sebelum pergi tak dihitung", () => {
    const notifications = [notif({ id: "n0", createdAt: new Date(NOW - 60_000).toISOString() })];
    const before = petSnapshot({ sessions: [], backlog: bl, notifications, now: NOW });
    expect(petRecap(before, { sessions: [], backlog: bl, notifications, now: NOW + 20 * 60_000 })).toBeNull();
  });
});
