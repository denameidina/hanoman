import { describe, expect, it } from "vitest";
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import {
  derivePetConditions, derivePetState, doneSpecIds, petPulse, sessionKind, KIND_NOUN,
  PET_OFFLINE_MS, PET_SLEEP_MS, PET_TRANSIENT_MS, PET_URGENT_MS, loadPetRoam, savePetRoam,
  waitingSessions,
  type PetConnection, type PetInput,
} from "../src/screens/pet-state";

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
    expect(view.recheckAt).toBeNull();
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
    expect(fresh.recheckAt).toBe(Date.parse(at) + PET_TRANSIENT_MS);

    const decayed = derivePetState({ ...input, now: Date.parse(at) + PET_TRANSIENT_MS + 1 });
    expect(decayed.pose).toBe("ready");
    expect(decayed.recheckAt).toBeNull();
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
    expect(view.pose).toBe("deciding");
    expect(view.kind).toBe("deciding");
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

describe("preferensi berkeliaran", () => {
  it("default berkeliaran; pilihan tersimpan di hanoman.pet.roam dan terbaca kembali", () => {
    localStorage.clear();
    expect(loadPetRoam()).toBe(true);
    savePetRoam(false);
    expect(localStorage.getItem("hanoman.pet.roam")).toBe("0");
    expect(loadPetRoam()).toBe(false);
    savePetRoam(true);
    expect(loadPetRoam()).toBe(true);
  });
});

const ONLINE: PetConnection = { connected: true, since: 0, paused: false };
const OFFLINE_AT = (since: number): PetConnection => ({ connected: false, since, paused: false });

describe("SPEC-897 — kondisi terputus", () => {
  it("menang atas segalanya setelah grace habis, dan kondisi lama tetap terdaftar", () => {
    const view = derivePetState({
      ...EMPTY,
      connection: OFFLINE_AT(NOW - PET_OFFLINE_MS),
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", decision: true })],
    });
    expect(view.pose).toBe("offline");
    expect(view.kind).toBe("offline");
    expect(view.headline).toContain("Tak terhubung sejak");
    expect(view.target).toBeNull();
    expect(view.conditions.map((c) => c.kind)).toEqual(["offline", "waiting"]);
  });

  it("tak menyala selama grace, dan menjadwalkan recheck tepat saat grace habis", () => {
    const since = NOW - 1_000;
    const view = derivePetState({
      ...EMPTY, connection: OFFLINE_AT(since),
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    });
    expect(view.pose).toBe("working");
    expect(view.recheckAt).toBe(since + PET_OFFLINE_MS);
  });

  it("tab hidden (paused) tak pernah dibaca sebagai terputus", () => {
    const view = derivePetState({
      ...EMPTY,
      connection: { connected: false, since: NOW - 60_000, paused: true },
      backlog: [spec({ id: "SPEC-1" })],
    });
    expect(view.pose).toBe("ready");
    expect(view.recheckAt).toBeNull();
  });
});

describe("SPEC-897 — pose deciding", () => {
  it("duduk di bawah `waiting` dan di atas keadaan mapan", () => {
    const view = derivePetState({
      ...EMPTY, connection: ONLINE,
      backlog: [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })],
      sessions: [
        session({ id: "spec-1", specId: "SPEC-1", decision: true }),
        session({ id: "spec-2", specId: "SPEC-2", deciding: true }),
      ],
    });
    expect(view.pose).toBe("waiting");
    expect(view.conditions.map((c) => c.kind)).toEqual(["waiting", "deciding"]);
  });

  it("sesi yang dilayani lead tak lagi menyamar jadi `working`", () => {
    const view = derivePetState({
      ...EMPTY, connection: ONLINE,
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", deciding: true })],
    });
    expect(view.pose).toBe("deciding");
    expect(view.conditions.map((c) => c.kind)).toEqual(["deciding"]);
    expect(view.target).toEqual({ section: "terminal", sessionId: "spec-1" });
  });
});

describe("SPEC-897 — tidur", () => {
  it("lantai menjadi `sleeping` setelah PET_SLEEP_MS tanpa kehidupan", () => {
    const view = derivePetState({ ...EMPTY, quietSince: NOW - PET_SLEEP_MS });
    expect(view.pose).toBe("sleeping");
    expect(view.kind).toBe("ready");
    expect(view.recheckAt).toBeNull();
  });

  it("menjadwalkan onset tidur lewat satu recheck, bukan denyut", () => {
    const quietSince = NOW - 60_000;
    const view = derivePetState({ ...EMPTY, quietSince });
    expect(view.pose).toBe("ready");
    expect(view.recheckAt).toBe(quietSince + PET_SLEEP_MS);
  });

  it("tak pernah tidur selama masih ada satu kondisi terdaftar", () => {
    const view = derivePetState({
      ...EMPTY, quietSince: NOW - PET_SLEEP_MS,
      backlog: [spec({ id: "SPEC-1" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1", exited: true, exitCode: 1 })],
    });
    expect(view.pose).toBe("blocked");
  });

  it("petPulse berubah saat sesi hidup atau notifikasi terbaru berubah", () => {
    const a = petPulse([session({ id: "s1" })], []);
    expect(petPulse([session({ id: "s1" })], [])).toBe(a);
    expect(petPulse([session({ id: "s1" }), session({ id: "s2" })], [])).not.toBe(a);
    expect(petPulse([session({ id: "s1" })], [notif({ id: "n1" })])).not.toBe(a);
    // sesi yang sudah mati bukan kehidupan
    expect(petPulse([session({ id: "s1" }), session({ id: "s9", exited: true })], [])).toBe(a);
    // urutan daftar dari `tmux list-panes -a` tak boleh membangunkan pet
    expect(petPulse([session({ id: "s2" }), session({ id: "s1" })], []))
      .toBe(petPulse([session({ id: "s1" }), session({ id: "s2" })], []));
  });
});

describe("SPEC-897 — daftar kondisi & hitungan", () => {
  it("mendaftar semua kondisi aktif dengan count per kind", () => {
    const view = derivePetState({
      ...EMPTY, connection: ONLINE,
      backlog: [
        spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" }),
        spec({ id: "SPEC-3", stage: "done" }),
      ],
      sessions: [
        session({ id: "a", specId: "SPEC-1", decision: true }),
        session({ id: "b", specId: "SPEC-2", decision: true }),
        session({ id: "c", specId: "SPEC-3" }),
      ],
    });
    expect(view.kind).toBe("waiting");
    expect(view.count).toBe(2);
    expect(view.conditions.map((c) => [c.kind, c.count])).toEqual([["waiting", 2], ["review", 1]]);
    expect(view.detail).not.toContain("lainnya");
  });

  it("backlog tertahan dependency naik jadi pose hanya saat tak ada sesi hidup", () => {
    const backlog = [
      spec({ id: "SPEC-2", stage: "spec-ready", blockedBy: [{ id: "SPEC-1", reason: "unfinished" }] }),
    ];
    const sepi = derivePetState({ ...EMPTY, backlog });
    expect(sepi.pose).toBe("blocked");
    expect(sepi.kind).toBe("blocked");

    const ramai = derivePetState({
      ...EMPTY, backlog: [...backlog, spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    });
    expect(ramai.pose).toBe("working");
    // tetap TERDAFTAR, di ekor — terlihat di panel, tak pernah memimpin.
    expect(ramai.conditions.map((c) => c.kind)).toEqual(["working", "blocked"]);
  });

  it("lantai punya count 1 supaya lencana tak menyala saat istirahat", () => {
    const view = derivePetState({ ...EMPTY, backlog: [spec({ id: "SPEC-1" }), spec({ id: "SPEC-2" })] });
    expect(view.count).toBe(1);
    expect(view.headline).toContain("2 backlog siap");
    // lantai TETAP masuk daftar supaya panel selalu punya satu baris + satu aksi.
    expect(view.conditions).toHaveLength(1);
    expect(view.conditions[0]!.kind).toBe("ready");
    expect(view.conditions[0]!.target).toEqual({ section: "backlog" });
  });

  it("satu sesi tepat satu kondisi — panel tak pernah menyebutnya dua kali", () => {
    const rows = derivePetConditions({
      ...EMPTY,
      backlog: [
        spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" }),
        spec({ id: "SPEC-3", stage: "done" }), spec({ id: "SPEC-4", stage: "executing" }),
      ],
      sessions: [
        session({ id: "a", specId: "SPEC-1", decision: true }),   // waiting, bukan juga working
        session({ id: "b", specId: "SPEC-2", deciding: true }),   // deciding, bukan juga working
        session({ id: "c", specId: "SPEC-3" }),                   // review, bukan juga working
        session({ id: "d", specId: "SPEC-4" }),                   // working
        session({ id: "e", specId: "SPEC-4", exited: true, exitCode: 1 }),
      ],
    });
    expect(rows.reduce((n, c) => n + c.count, 0)).toBe(5);
    expect(rows.map((c) => [c.kind, c.count]))
      .toEqual([["failed", 1], ["waiting", 1], ["deciding", 1], ["working", 1], ["review", 1]]);
  });

  it("setiap kind punya kata benda untuk lencana", () => {
    const rows = derivePetConditions({
      ...EMPTY, connection: OFFLINE_AT(NOW - PET_OFFLINE_MS),
      backlog: [spec({ id: "SPEC-1", stage: "executing" })],
      sessions: [session({ id: "spec-1", specId: "SPEC-1" })],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const c of rows) expect(KIND_NOUN[c.kind]).toBeTruthy();
  });

  it("recheckAt = yang paling awal di antara transient, grace, dan tidur", () => {
    const shippedAt = NOW - 1_000;
    const view = derivePetState({
      ...EMPTY, connection: OFFLINE_AT(NOW - 2_000),
      backlog: [spec({ id: "SPEC-1", stage: "done" })],
      notifications: [notif({ id: "n1", specId: "SPEC-1", createdAt: new Date(shippedAt).toISOString() })],
    });
    // grace terputus (NOW − 2 000 + 6 000) lebih awal dari luruh transient (NOW − 1 000 + 45 000)
    expect(view.pose).toBe("shipped");
    expect(view.recheckAt).toBe(NOW - 2_000 + PET_OFFLINE_MS);
  });
});

describe("umur menunggu (SPEC-898)", () => {
  const bl = [spec({ id: "SPEC-1", stage: "executing" }), spec({ id: "SPEC-2", stage: "executing" })];
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("since kondisi waiting = decisionAt TERTUA di antara sesi yang menunggu", () => {
    const sessions = [
      session({ id: "b", specId: "SPEC-2", decision: true, decisionAt: at(2 * 60_000) }),
      session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: at(20 * 60_000) }),
    ];
    const v = derivePetState({ sessions, backlog: bl, notifications: [], now: NOW });
    expect(v.kind).toBe("waiting");
    expect(v.since).toBe(NOW - 20 * 60_000);
  });

  it("tanpa decisionAt, since null — pet tak pernah mengeskalasi tanpa stempel", () => {
    const sessions = [session({ id: "a", specId: "SPEC-1", decision: true })];
    expect(derivePetState({ sessions, backlog: bl, notifications: [], now: NOW }).since).toBeNull();
  });

  it("recheckAt memuat onset urgensi selama belum mendesak, lalu berhenti", () => {
    const young = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: at(60_000) })];
    expect(derivePetState({ sessions: young, backlog: bl, notifications: [], now: NOW }).recheckAt)
      .toBe(NOW - 60_000 + PET_URGENT_MS);
    const old = [session({ id: "a", specId: "SPEC-1", decision: true, decisionAt: at(PET_URGENT_MS + 1) })];
    expect(derivePetState({ sessions: old, backlog: bl, notifications: [], now: NOW }).recheckAt).toBeNull();
  });

  it("subject memberi pokok kalimat tanpa memparsing headline", () => {
    const sessions = [session({ id: "a", specId: "SPEC-1", decision: true })];
    expect(derivePetState({ sessions, backlog: bl, notifications: [], now: NOW }).subject).toBe("SPEC-1");
    expect(derivePetState({ sessions: [], backlog: bl, notifications: [], now: NOW }).subject).toBeNull();
  });

  it("sessionKind adalah SATU klasifikasi sesi, dipakai daftar kondisi dan rekap", () => {
    const done = doneSpecIds([spec({ id: "SPEC-9", stage: "done" })]);
    expect(sessionKind(session({ id: "x", decision: true }), done)).toBe("waiting");
    expect(sessionKind(session({ id: "x", decision: true, deciding: true }), done)).toBe("deciding");
    expect(sessionKind(session({ id: "x", exited: true, exitCode: 1 }), done)).toBe("failed");
    expect(sessionKind(session({ id: "x", exited: true, exitCode: 0 }), done)).toBeNull();
    expect(sessionKind(session({ id: "x", specId: "SPEC-9" }), done)).toBe("review");
    expect(sessionKind(session({ id: "x" }), done)).toBe("working");
  });
});

// SPEC-899 · daftar sesi yang benar-benar meminta jawaban manusia — dipakai panel inbox keputusan.
describe("waitingSessions", () => {
  it("hanya sesi hidup ber-marker keputusan, dan sesi yang dipegang lead tak ikut", () => {
    const backlog = [spec({ id: "SPEC-1" })];
    const rows = waitingSessions([
      session({ id: "b", specId: "SPEC-1", decision: true }),
      session({ id: "a", specId: "SPEC-1", decision: true }),
      session({ id: "c", specId: "SPEC-1", decision: true, deciding: true }),
      session({ id: "d", specId: "SPEC-1" }),
      session({ id: "e", specId: "SPEC-1", decision: true, exited: true }),
    ], backlog);
    expect(rows.map((s) => s.id)).toEqual(["a", "b"]);   // stabil menurut id, bukan urutan tmux
  });
});
