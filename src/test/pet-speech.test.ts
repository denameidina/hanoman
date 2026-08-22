import { describe, expect, it } from "vitest";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import { derivePetState, PET_URGENT_MS, type PetView } from "../src/screens/pet-state";
import { humanAge, isUrgent, PET_SPEECH_MS, speechFor } from "../src/screens/pet-speech";

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
