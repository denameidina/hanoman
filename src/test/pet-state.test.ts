import { describe, expect, it } from "vitest";
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import { derivePetState, PET_TRANSIENT_MS, POSE_ART, type PetInput } from "../src/screens/pet-state";

const NOW = Date.parse("2026-08-08T10:00:00.000Z");

function spec(over: Partial<Spec> & { id: string }): Spec {
  return {
    projectId: "hanoman", title: `judul ${over.id}`, source: "brief", stage: "spec-ready",
    priority: "sedang", author: "op", objective: "", payload: null, branchFrom: null,
    baseSha: null, createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
    dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], ...over,
  } as Spec;
}

function session(over: Partial<TerminalSession> & { id: string }): TerminalSession {
  return { projectId: "hanoman", cwd: "/tmp", exited: false, ...over };
}

// `type` sengaja longgar: server menulis `automerge`/`drift`/`spec-source` yang belum masuk enum
// `zNotification`, dan pet memang harus tahan terhadapnya.
function notif(over: Partial<Omit<Notification, "type">> & { id: string; type?: string }): Notification {
  return {
    type: "done", specId: null, sessionId: null, title: "selesai", projectId: "hanoman",
    createdAt: new Date(NOW - 1_000).toISOString(), readAt: null, ...over,
  } as Notification;
}

const EMPTY: PetInput = { sessions: [], backlog: [], notifications: [], now: NOW };

describe("derivePetState — pose per keadaan", () => {
  it("jatuh ke `ready` saat tak ada apa pun yang berjalan", () => {
    const view = derivePetState({ ...EMPTY, backlog: [spec({ id: "SPEC-1" }), spec({ id: "SPEC-2" })] });
    expect(view.pose).toBe("ready");
    expect(view.headline).toContain("2 backlog siap");
    expect(view.target).toEqual({ section: "backlog" });
    expect(view.transientUntil).toBeNull();
  });

  it("`working` saat ada sesi hidup di atas backlog yang belum selesai", () => {
    const view = derivePetState({
      ...EMPTY,
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    });
    expect(view.pose).toBe("working");
    expect(view.headline).toContain("SPEC-1");
    expect(view.detail).toContain("judul SPEC-1");
    expect(view.target).toEqual({ section: "terminal", sessionId: "spec-1" });
  });

  it("`waiting` saat sesi hidup menyalakan marker keputusan", () => {
    const view = derivePetState({
      ...EMPTY,
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", decision: true })],
    });
    expect(view.pose).toBe("waiting");
    expect(view.target).toEqual({ section: "terminal", sessionId: "spec-1" });
  });

  it("`blocked` saat sebuah sesi keluar dengan exit code bukan nol", () => {
    const view = derivePetState({
      ...EMPTY,
      backlog: [spec({ id: "SPEC-1" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", exited: true, exitCode: 143 })],
    });
    expect(view.pose).toBe("blocked");
    expect(view.detail).toContain("143");
    expect(view.target).toEqual({ section: "terminal", sessionId: "spec-1" });
  });

  it("`review` saat sesi masih terdaftar di atas backlog yang sudah done", () => {
    const view = derivePetState({
      ...EMPTY,
      backlog: [spec({ id: "SPEC-1", stage: "done" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    });
    expect(view.pose).toBe("review");
    expect(view.target).toEqual({ section: "terminal", sessionId: "spec-1" });
  });

  it("`shipped` saat notifikasi selesai masih segar, lalu meluruh ke keadaan dasar", () => {
    const at = new Date(NOW - 1_000).toISOString();
    const input: PetInput = {
      ...EMPTY,
      backlog: [spec({ id: "SPEC-1", stage: "done" })],
      notifications: [notif({ id: "n1", specId: "SPEC-1", createdAt: at, title: "Pet Hanoman" })],
    };
    const fresh = derivePetState(input);
    expect(fresh.pose).toBe("shipped");
    expect(fresh.detail).toBe("Pet Hanoman");
    expect(fresh.transientUntil).toBe(Date.parse(at) + PET_TRANSIENT_MS);

    const decayed = derivePetState({ ...input, now: Date.parse(at) + PET_TRANSIENT_MS + 1 });
    expect(decayed.pose).toBe("ready");
    expect(decayed.transientUntil).toBeNull();
  });

  it("`shipped` juga menyala untuk auto-merge yang sukses", () => {
    const view = derivePetState({
      ...EMPTY,
      backlog: [spec({ id: "SPEC-1", stage: "done" })],
      notifications: [notif({ id: "n1", specId: "SPEC-1", type: "automerge" })],
    });
    expect(view.pose).toBe("shipped");
  });

  it("`docs-updated` saat backlog yang selesai itu bersumber audit", () => {
    const view = derivePetState({
      ...EMPTY,
      backlog: [spec({ id: "SPEC-9", source: "audit", stage: "done" })],
      notifications: [notif({ id: "n1", specId: "SPEC-9", title: "audit selesai" })],
    });
    expect(view.pose).toBe("docs-updated");
  });
});

describe("derivePetState — prioritas saat beberapa kondisi menyala bersamaan", () => {
  const failed = session({ id: "spec-4", specId: "SPEC-4", exited: true, exitCode: 1 });
  const waiting = session({ id: "spec-3", specId: "SPEC-3", decision: true });
  const live = session({ id: "spec-2", specId: "SPEC-2" });
  const reviewing = session({ id: "spec-1", specId: "SPEC-1" });
  const backlog = [
    spec({ id: "SPEC-1", stage: "done" }), spec({ id: "SPEC-2", stage: "executing" }),
    spec({ id: "SPEC-3", stage: "executing" }), spec({ id: "SPEC-4", stage: "executing" }),
  ];
  const shipped = notif({ id: "n1", specId: "SPEC-1" });

  const table: Array<[string, TerminalSession[], Notification[], string]> = [
    ["gagal menang atas semuanya", [failed, waiting, live, reviewing], [shipped], "blocked"],
    ["menunggu manusia menang atas kabar baik", [waiting, live, reviewing], [shipped], "waiting"],
    ["kabar baik menang atas kerja yang sedang jalan", [live, reviewing], [shipped], "shipped"],
    ["kerja yang jalan menang atas hasil yang menunggu review", [live, reviewing], [], "working"],
    ["review menang atas lantai `ready`", [reviewing], [], "review"],
  ];

  for (const [name, sessions, notifications, pose] of table) {
    it(name, () => {
      expect(derivePetState({ sessions, backlog, notifications, now: NOW }).pose).toBe(pose);
    });
  }

  it("lead yang sedang menyusun keputusan tidak dibaca sebagai menunggu manusia", () => {
    const view = derivePetState({
      ...EMPTY,
      backlog: [spec({ id: "SPEC-3", stage: "executing" })],
      sessions: [session({ id: "spec-3", specId: "SPEC-3", decision: true, deciding: true })],
    });
    expect(view.pose).toBe("working");
  });

  it("backlog tertahan dependency memblokir hanya saat tak ada sesi hidup", () => {
    const blocked = spec({ id: "SPEC-5", blockedBy: [{ id: "SPEC-4", reason: "unfinished" }] });
    expect(derivePetState({ ...EMPTY, backlog: [blocked] }).pose).toBe("blocked");
    expect(derivePetState({
      ...EMPTY,
      backlog: [blocked, spec({ id: "SPEC-2", stage: "executing" })],
      sessions: [session({ id: "spec-2", specId: "SPEC-2" })],
    }).pose).toBe("working");
  });

  it("memilih sesi secara deterministik meski urutan daftarnya berbeda", () => {
    const two = [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })];
    const a = session({ id: "spec-1", specId: "SPEC-1" });
    const b = session({ id: "spec-2", specId: "SPEC-2" });
    const one = derivePetState({ ...EMPTY, backlog: two, sessions: [a, b] });
    const other = derivePetState({ ...EMPTY, backlog: two, sessions: [b, a] });
    expect(one.headline).toBe(other.headline);
    expect(one.target).toEqual(other.target);
  });
});

describe("POSE_ART", () => {
  it("memetakan tiap pose ke satu ID sticker katalog yang unik", () => {
    const ids = Object.values(POSE_ART);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^STK-00[1-8]$/);
  });
});
