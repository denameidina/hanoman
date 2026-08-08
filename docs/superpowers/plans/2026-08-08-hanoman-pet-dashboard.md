# Pet Hanoman di dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan widget "Pet Hanoman" — maskot yang selalu hadir di sudut dashboard dan pose-nya cermin deterministik dari status sesi & backlog nyata.

**Architecture:** Satu fungsi murni `derivePetState()` memetakan tiga sumber data yang sudah didorong WS siar (`sessions`, `backlog`, `notifications`) ke satu dari tujuh pose lewat urutan prioritas total. Satu komponen `HanomanPet` merendernya sebagai overlay `position: fixed` yang dipasang **sekali** di `App`, memakai ID katalog ilustrasi `STK-*` yang sudah terdaftar di design system.

**Tech Stack:** React 18 + TypeScript (Vite), Vitest + @testing-library/react (jsdom), design-system tokens CSS.

## Global Constraints

- **Tanpa perubahan skema DB dan tanpa endpoint baru.** Semua sinyal diambil dari data yang sudah ada di `App`.
- **Tanpa mekanisme realtime baru.** Pet menumpang WS siar `/events/ws` yang sudah ada (ADR-0039); nol `setInterval`, nol channel baru, nol kenaikan frekuensi.
- **Murni frontend + aset.** Tak ada berkas di `server/`, `shared/`, `runner/`, atau `cli/` yang berubah. Kalau sebuah task menuntutnya, itu tanda scope salah baca — berhenti dan tanya.
- **Aset lewat ID katalog, tak pernah filename.** `STK-001…008` sudah terdaftar di `src/src/ds/illustration-registry.ts`; raw filename di luar registry adalah drift bug (`internal/docs/frontend/frontend-implementation.md`).
- **Tak ada warna/bayangan literal.** Hanya token semantik: `--surface-card`, `--border-hair`, `--brass-*`, `--text-*`, `--shadow-*`, `--radius-*`, `--dur-*`, `--ease-*`.
- **Semua animasi mati saat `prefers-reduced-motion: reduce`.**
- **Test dijalankan dengan `env -u NODE_ENV`** — `NODE_ENV=production` di env shell membuat RTL `act` gagal massal (bukan regresi).
- Perintah dijalankan dari **root worktree**, bukan dari `src/` — cwd Bash bertahan antar-panggilan dan `--changed` dari subdirektori paket memberi hijau palsu.
- Binary vitest dipanggil `./node_modules/.bin/vitest` (proxy `rtk` mematikan `pnpm vitest`).

---

### Task 1: Fungsi murni pemetaan status → pose

**Files:**
- Create: `src/src/screens/pet-state.ts`
- Test: `src/test/pet-state.test.ts`

**Interfaces:**
- Consumes: `Spec`, `Notification` dari `@hanoman/shared`; `TerminalSession` dari `../api/client`; `StickerIllustrationId` dari `../ds/illustration-registry`.
- Produces:
  - `type PetPose = "ready" | "working" | "waiting" | "blocked" | "review" | "shipped" | "docs-updated"`
  - `const POSE_ART: Record<PetPose, StickerIllustrationId>`
  - `const POSE_LABEL: Record<PetPose, string>`
  - `const PET_TRANSIENT_MS: number`
  - `const PET_HIDDEN_KEY: string`
  - `type PetTarget = { section: "terminal" | "backlog"; sessionId?: string }`
  - `type PetView = { pose: PetPose; headline: string; detail: string; target: PetTarget; transientUntil: number | null }`
  - `type PetInput = { sessions: TerminalSession[]; backlog: Spec[]; notifications: Notification[]; now: number }`
  - `function derivePetState(input: PetInput): PetView`
  - `function loadPetHidden(): boolean` / `function savePetHidden(hidden: boolean): void`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/pet-state.test.ts`:

```ts
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
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run pet-state`
Expected: FAIL — `Failed to resolve import "../src/screens/pet-state"`.

- [x] **Step 3: Tulis implementasinya**

Buat `src/src/screens/pet-state.ts`:

```ts
// SPEC-585 · pemetaan status sesi & backlog → pose maskot. Murni, tanpa React/DOM, supaya tabel
// prioritasnya bisa diuji langsung — pola yang sama dipakai terminal-layout.ts & source-meta.ts.
//
// Kosakata sesinya SENGAJA identik dengan sel Terminal (`TerminalScreen`): `awaiting` = hidup &&
// decision, `deciding` menang atasnya, `failed` = exited && exitCode bukan nol. Pet yang memakai
// rumus lain akan mengatakan hal yang berlawanan dengan sel di layar yang sama.
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";
import type { StickerIllustrationId } from "../ds/illustration-registry";

export type PetPose = "ready" | "working" | "waiting" | "blocked" | "review" | "shipped" | "docs-updated";

// STK-007 (`thanks`) sengaja tak dipakai: ia ungkapan terima kasih, bukan keadaan mesin.
export const POSE_ART: Record<PetPose, StickerIllustrationId> = {
  ready: "STK-001",
  working: "STK-002",
  waiting: "STK-003",
  blocked: "STK-004",
  shipped: "STK-005",
  review: "STK-006",
  "docs-updated": "STK-008",
};

export const POSE_LABEL: Record<PetPose, string> = {
  ready: "siap",
  working: "sedang bekerja",
  waiting: "menunggu jawabanmu",
  blocked: "tertahan",
  shipped: "baru saja selesai",
  review: "menunggu review",
  "docs-updated": "dokumen baru terbit",
};

// Umur keadaan transient (`shipped`/`docs-updated`) sejak notifikasinya lahir.
export const PET_TRANSIENT_MS = 45_000;

export const PET_HIDDEN_KEY = "hanoman.pet.hidden";

export type PetTarget = { section: "terminal" | "backlog"; sessionId?: string };

export type PetView = {
  pose: PetPose;
  headline: string;
  detail: string;
  target: PetTarget;
  // Non-null HANYA saat pose-nya sendiri transient: itulah satu-satunya saat keadaan bisa berubah
  // tanpa data baru, jadi itu satu-satunya saat komponen perlu menjadwalkan hitung ulang.
  transientUntil: number | null;
};

export type PetInput = {
  sessions: TerminalSession[];
  backlog: Spec[];
  notifications: Notification[];
  now: number;
};

// `automerge` tak ada di enum `zNotification` walau server menulisnya, jadi perbandingannya lewat
// Set<string> — bukan penyempitan tipe yang justru akan menolak nilai yang benar-benar datang.
const SHIPPED_TYPES = new Set<string>(["done", "automerge"]);

// Urutan daftar sesi datang dari `tmux list-panes -a`; menstabilkannya di sini membuat headline
// tak berganti nama tiap frame siar hanya karena urutan pane bergeser.
const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));

const sessionName = (s: TerminalSession): string => s.specId ?? s.id;

const specOf = (backlog: Spec[], s: TerminalSession): Spec | undefined =>
  (s.specId ? backlog.find((x) => x.id === s.specId) : undefined);

const others = (count: number): string => (count > 1 ? ` · +${count - 1} lainnya` : "");

export function derivePetState({ sessions, backlog, notifications, now }: PetInput): PetView {
  const done = new Set(backlog.filter((s) => s.stage === "done").map((s) => s.id));
  const audit = new Set(backlog.filter((s) => s.source === "audit").map((s) => s.id));

  const live = byId(sessions.filter((s) => !s.exited));
  const failed = byId(sessions.filter((s) => s.exited && !!s.exitCode));
  const waiting = live.filter((s) => !!s.decision && !s.deciding);
  const reviewing = byId(sessions.filter((s) => !!s.specId && done.has(s.specId)));
  const working = live.filter((s) => !(s.specId && done.has(s.specId)));

  const blockedSpecs = byId(backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) > 0));
  const readySpecs = backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) === 0);

  const fresh = notifications.filter((n) => Date.parse(n.createdAt) + PET_TRANSIENT_MS > now);
  const newest = (rows: Notification[]): Notification | undefined =>
    [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const shipped = newest(fresh.filter((n) =>
    SHIPPED_TYPES.has(n.type) && !(n.specId && audit.has(n.specId))));
  const docs = newest(fresh.filter((n) => n.type === "done" && !!n.specId && audit.has(n.specId)));

  // 1 · sesi gagal selalu menang. Backlog yang tertahan dependency HANYA memblokir saat tak ada
  // sesi hidup: `blockedBy` adalah keadaan normal & berumur panjang di project ber-`dependsOn`
  // (ADR-0093), dan tanpa gerbang itu pet terkunci di satu pose selamanya lalu berhenti memberi
  // tahu apa pun. Backlog yang menunggu giliran tak sedang meminta apa-apa dari manusia.
  const dead = failed[0];
  if (dead) {
    return {
      pose: "blocked",
      headline: `${sessionName(dead)} · sesi gagal`,
      detail: `Keluar dengan exit ${dead.exitCode}${others(failed.length)}`,
      target: { section: "terminal", sessionId: dead.id },
      transientUntil: null,
    };
  }
  const stuck = blockedSpecs[0];
  if (live.length === 0 && stuck) {
    return {
      pose: "blocked",
      headline: `${stuck.id} · tertahan dependency`,
      detail: `Menunggu ${(stuck.blockedBy ?? []).map((b) => b.id).join(", ")}${others(blockedSpecs.length)}`,
      target: { section: "backlog" },
      transientUntil: null,
    };
  }

  // 2 · sesi yang memang menunggu manusia. `deciding` dikecualikan: sesi yang sedang disusunkan
  // keputusannya oleh hanoman-lead terlihat identik di layar (diam, marker terisi), dan membacanya
  // sebagai "butuh kamu" adalah alarm palsu.
  const asks = waiting[0];
  if (asks) {
    return {
      pose: "waiting",
      headline: `Menunggu jawabanmu · ${sessionName(asks)}`,
      detail: `${specOf(backlog, asks)?.title ?? "Sesi terminal"}${others(waiting.length)}`,
      target: { section: "terminal", sessionId: asks.id },
      transientUntil: null,
    };
  }

  // 3–4 · kabar yang meluruh. Menang atas keadaan mapan (kabar baru lebih informatif), kalah dari
  // gagal & menunggu — perayaan tak boleh menutupi permintaan tolong.
  if (shipped) {
    return {
      pose: "shipped",
      headline: `${shipped.specId ?? "Backlog"} · selesai`,
      detail: shipped.title,
      target: { section: "backlog" },
      transientUntil: Date.parse(shipped.createdAt) + PET_TRANSIENT_MS,
    };
  }
  if (docs) {
    return {
      pose: "docs-updated",
      headline: `${docs.specId ?? "Audit"} · dokumen terbit`,
      detail: docs.title,
      target: { section: "backlog" },
      transientUntil: Date.parse(docs.createdAt) + PET_TRANSIENT_MS,
    };
  }

  // 5 · sesi hidup yang backlog-nya BELUM done. Pengecualian itu yang membuat pintu `review` di
  // bawah bisa menyala sama sekali: pada jalur sukses pane agen tak pernah mati (SPEC-433), jadi
  // "selesai" hanya terbaca dari `Spec.stage` — yang diturunkan server dari bukti yang sama
  // (fase terminal + plan terceklist, ADR-0029).
  const busy = working[0];
  if (busy) {
    return {
      pose: "working",
      headline: `${sessionName(busy)} · sedang berjalan`,
      detail: `${specOf(backlog, busy)?.title ?? "Sesi terminal"}${others(working.length)}`,
      target: { section: "terminal", sessionId: busy.id },
      transientUntil: null,
    };
  }

  const ready = reviewing[0];
  if (ready) {
    return {
      pose: "review",
      headline: `${sessionName(ready)} · menunggu review`,
      detail: `${specOf(backlog, ready)?.title ?? "Sesi terminal"}${others(reviewing.length)}`,
      target: { section: "terminal", sessionId: ready.id },
      transientUntil: null,
    };
  }

  // 7 · lantai. Selalu benar, jadi pet tak pernah kehabisan pose.
  return {
    pose: "ready",
    headline: readySpecs.length > 0 ? `${readySpecs.length} backlog siap dikerjakan` : "Tidak ada pekerjaan siap",
    detail: "Tak ada sesi yang berjalan",
    target: { section: "backlog" },
    transientUntil: null,
  };
}

export function loadPetHidden(): boolean {
  try { return localStorage.getItem(PET_HIDDEN_KEY) === "1"; } catch { return false; }
}

export function savePetHidden(hidden: boolean): void {
  try { localStorage.setItem(PET_HIDDEN_KEY, hidden ? "1" : "0"); } catch { /* mode privat / kuota penuh */ }
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run pet-state`
Expected: PASS — 17 test lulus, 0 gagal.

- [x] **Step 5: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0, tanpa keluaran.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/pet-state.ts src/test/pet-state.test.ts
git commit -m "feat(spec-585): pemetaan murni status sesi & backlog ke pose maskot"
```

---

### Task 2: Komponen `HanomanPet` — render, animasi, a11y, sembunyikan

**Files:**
- Create: `src/src/screens/HanomanPet.tsx`
- Modify: `src/src/app.css` (satu keyframe baru di akhir berkas)
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `derivePetState`, `POSE_ART`, `POSE_LABEL`, `loadPetHidden`, `savePetHidden`, `PetPose`, `PetTarget` dari Task 1; `useNotifications` dari `../notifications/NotificationsContext`; `Button`, `Mark`, `StickerIllustration` dari `../ds`.
- Produces: `function HanomanPet(props: { sessions: TerminalSession[]; backlog: Spec[]; onOpen: (target: PetTarget) => void }): JSX.Element`

**Catatan struktur yang mengikat:** live region (`role="status"`) membungkus `<img>`-nya dan tombol
adalah **overlay transparan di dalamnya**, bukan sebaliknya. Menaruh gambar di dalam `<button>`
membuat sebagian screen reader memperlakukan isinya sebagai presentasional, sehingga perubahan alt
tak pernah diumumkan — persis yang diminta brief.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/hanoman-pet.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import { HanomanPet } from "../src/screens/HanomanPet";
import { PET_HIDDEN_KEY } from "../src/screens/pet-state";

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

function mockMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: reduced, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

const styleOf = (el: HTMLElement): string => el.getAttribute("style") ?? "";
const hit = () => screen.getByRole("button", { name: "Ringkasan status Hanoman" });

beforeEach(() => { localStorage.clear(); mockMatchMedia(false); });

describe("HanomanPet", () => {
  it("merender pose `ready` sebagai status yang terbaca screen reader", () => {
    render(<HanomanPet sessions={[]} backlog={[spec({ id: "SPEC-1" })]} onOpen={vi.fn()} />);

    const art = screen.getByTestId("illustration-STK-001");
    expect(art.getAttribute("alt")).toContain("Hanoman");
    expect(art.getAttribute("alt")).toContain("1 backlog siap dikerjakan");
    expect(art).not.toHaveAttribute("aria-hidden");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toContainElement(art);
  });

  it("berpindah pose saat sesi hidup muncul, pose lama tinggal sebagai lapisan bisu", () => {
    const backlog = [spec({ id: "SPEC-1", stage: "executing" })];
    const { rerender } = render(<HanomanPet sessions={[]} backlog={backlog} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "spec-1", specId: "SPEC-1" })]}
      backlog={backlog} onOpen={vi.fn()} />);

    const working = screen.getByTestId("illustration-STK-002");
    expect(working).toHaveStyle({ opacity: "1" });
    expect(working.getAttribute("alt")).toContain("sedang berjalan");

    const ready = screen.getByTestId("illustration-STK-001");
    expect(ready).toHaveStyle({ opacity: "0" });
    expect(ready).toHaveAttribute("aria-hidden", "true");
    expect(ready).toHaveAttribute("alt", "");
  });

  it("menganimasi napas & transisi pose secara default", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(styleOf(screen.getByTestId("pet-stage"))).toContain("hn-pet-breathe");
    expect(styleOf(screen.getByTestId("illustration-STK-001"))).toContain("transition: opacity");
  });

  it("mematikan seluruh animasi saat prefers-reduced-motion: reduce", () => {
    mockMatchMedia(true);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(styleOf(screen.getByTestId("pet-stage"))).toContain("animation: none");
    expect(styleOf(screen.getByTestId("pet-stage"))).not.toContain("hn-pet-breathe");
    expect(styleOf(screen.getByTestId("illustration-STK-001"))).toContain("transition: none");
  });

  it("membuka ringkasan berisi headline, detail, dan tautan ke tempat kejadian", () => {
    const onOpen = vi.fn();
    render(<HanomanPet backlog={[spec({ id: "SPEC-1", stage: "executing" })]}
      sessions={[session({ id: "spec-1", specId: "SPEC-1" })]} onOpen={onOpen} />);

    expect(hit()).toHaveAttribute("title", expect.stringContaining("SPEC-1") as unknown as string);
    fireEvent.click(hit());
    expect(screen.getByText("SPEC-1 · sedang berjalan")).toBeInTheDocument();
    expect(screen.getByText("judul SPEC-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buka Terminal" }));
    expect(onOpen).toHaveBeenCalledWith({ section: "terminal", sessionId: "spec-1" });
  });

  it("menutup ringkasan dengan Escape", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    expect(screen.getByText("Tidak ada pekerjaan siap")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Tidak ada pekerjaan siap")).toBeNull();
  });

  it("menyembunyikan pet, menyimpan pilihannya, dan tetap bisa dipanggil kembali", () => {
    const { unmount } = render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    fireEvent.click(screen.getByRole("button", { name: "Sembunyikan" }));

    expect(screen.queryByTestId("illustration-STK-001")).toBeNull();
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("1");
    unmount();

    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("illustration-STK-001")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan pet Hanoman" }));
    expect(screen.getByTestId("illustration-STK-001")).toBeInTheDocument();
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("0");
  });

  it("tidak menangkap klik di area kosong sekitarnya", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-root")).toHaveStyle({ pointerEvents: "none" });
    expect(hit()).toHaveStyle({ pointerEvents: "auto" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run hanoman-pet`
Expected: FAIL — `Failed to resolve import "../src/screens/HanomanPet"`.

- [x] **Step 3: Tambahkan keyframe napas**

Tambahkan di akhir `src/src/app.css` (setelah blok `@keyframes hn-toast-in`):

```css
/* SPEC-585 · napas pet Hanoman. Hanya `transform` — ia hidup di compositor, tak menyentuh main
   thread, dan tak memicu satu pun render React. Apakah ia dipasang diputuskan di JS
   (`prefers-reduced-motion`), sama seperti animasi kit lainnya yang juga inline. */
@keyframes hn-pet-breathe {
  from { transform: translateY(0) scale(1); }
  to   { transform: translateY(-3px) scale(1.025); }
}
```

- [x] **Step 4: Tulis komponennya**

Buat `src/src/screens/HanomanPet.tsx`:

```tsx
import React from "react";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";
import { Button, Mark, StickerIllustration } from "../ds";
import { useNotifications } from "../notifications/NotificationsContext";
import {
  derivePetState, loadPetHidden, savePetHidden,
  POSE_ART, POSE_LABEL, type PetPose, type PetTarget,
} from "./pet-state";

const SIZE = 76;

// jsdom tak punya matchMedia; ketiadaannya dibaca sebagai "tak ada preferensi", bukan "reduce".
function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = React.useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia(query).matches);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export function HanomanPet({ sessions, backlog, onOpen }:
  { sessions: TerminalSession[]; backlog: Spec[]; onOpen: (target: PetTarget) => void }) {
  const { items } = useNotifications();
  const [hidden, setHidden] = React.useState(loadPetHidden);
  const [open, setOpen] = React.useState(false);
  // Dinaikkan HANYA oleh peluruhan keadaan transient — satu-satunya perubahan pose yang tak
  // dibawa data baru. Bukan denyut: tak ada interval, hanya satu timeout tepat pada waktunya.
  const [decay, setDecay] = React.useState(0);
  const reduced = usePrefersReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);

  const view = React.useMemo(
    () => derivePetState({ sessions, backlog, notifications: items, now: Date.now() }),
    [sessions, backlog, items, decay]);

  React.useEffect(() => {
    if (view.transientUntil === null) return;
    const t = setTimeout(() => setDecay((n) => n + 1), Math.max(0, view.transientUntil - Date.now()));
    return () => clearTimeout(t);
  }, [view.transientUntil]);

  // Hanya pose yang PERNAH terjadi yang masuk DOM: crossfade-nya dikerjakan CSS tanpa timer, dan
  // byte yang diambil browser tumbuh mengikuti pemakaian alih-alih memuat kedelapannya di muka.
  const [seen, setSeen] = React.useState<PetPose[]>([view.pose]);
  React.useEffect(() => {
    setSeen((s) => (s.includes(view.pose) ? s : [...s, view.pose]));
  }, [view.pose]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function setVisibility(next: boolean) {
    setHidden(next);
    savePetHidden(next);
    if (next) setOpen(false);
  }

  // z 80: di bawah header (90), overlay terminal fullscreen (100), Modal (150), Toast (200) — jadi
  // pet secara struktural tak bisa menutupi kontrol mana pun. `pointerEvents: none` di pembungkus
  // menyerahkan kembali area kosong di sekitarnya ke konten di bawahnya.
  const root: React.CSSProperties = {
    position: "fixed", right: 22, bottom: 22, zIndex: 80,
    display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10,
    pointerEvents: "none",
  };

  if (hidden) {
    return (
      <div data-testid="pet-root" style={root}>
        <button aria-label="Tampilkan pet Hanoman" onClick={() => setVisibility(false)} style={{
          pointerEvents: "auto", width: 28, height: 28, padding: 0, display: "inline-flex",
          alignItems: "center", justifyContent: "center", cursor: "pointer",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
          background: "var(--surface-card)", opacity: 0.55, boxShadow: "var(--shadow-sm)",
        }}>
          <Mark id="buntut" size={15} />
        </button>
      </div>
    );
  }

  const alt = `Hanoman ${POSE_LABEL[view.pose]} · ${view.headline}`;
  return (
    <div data-testid="pet-root" ref={ref} style={root}>
      {open && (
        <div style={{
          pointerEvents: "auto", width: 268, padding: 14,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{POSE_LABEL[view.pose]}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600,
            color: "var(--text-strong)", lineHeight: 1.25 }}>{view.headline}</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-ui)", fontSize: 12.5,
            color: "var(--text-muted)", lineHeight: 1.45 }}>{view.detail}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button size="sm" leftIcon={view.target.section === "terminal" ? "terminal" : "list-checks"}
              onClick={() => { setOpen(false); onOpen(view.target); }}>
              {view.target.section === "terminal" ? "Buka Terminal" : "Buka Backlog"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setVisibility(true)}>Sembunyikan</Button>
          </div>
        </div>
      )}
      {/* Live region membungkus gambarnya dan tombol adalah overlay transparan DI DALAMNYA:
          gambar di dalam <button> diperlakukan sebagian screen reader sebagai presentasional,
          sehingga perubahan alt tak pernah diumumkan. */}
      <div data-testid="pet-stage" role="status" aria-live="polite" style={{
        position: "relative", width: SIZE, height: SIZE,
        animation: reduced ? "none" : "hn-pet-breathe 4.5s var(--ease-inout) infinite alternate",
      }}>
        {seen.map((pose) => {
          const on = pose === view.pose;
          return (
            <StickerIllustration key={pose} id={POSE_ART[pose]} decorative={!on} alt={on ? alt : undefined}
              style={{
                position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
                opacity: on ? 1 : 0,
                transition: reduced ? "none" : "opacity var(--dur-slow) var(--ease-out)",
              }} />
          );
        })}
        <button aria-label="Ringkasan status Hanoman" title={`${view.headline} — ${view.detail}`}
          onClick={() => setOpen((o) => !o)} style={{
            pointerEvents: "auto", position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
            padding: 0, border: "none", background: "transparent", cursor: "pointer",
          }} />
      </div>
    </div>
  );
}
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run hanoman-pet`
Expected: PASS — 8 test lulus, 0 gagal.

- [x] **Step 6: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/src/app.css src/test/hanoman-pet.test.tsx
git commit -m "feat(spec-585): komponen pet Hanoman — pose, napas, ringkasan, sembunyikan"
```

---

### Task 3: Pasang pet di `App` — satu mount, akses langsung ke navigasi

**Files:**
- Modify: `src/src/App.tsx` (import + satu elemen di dalam `NotificationsProvider`)
- Test: `src/test/pet-mount.test.tsx`

**Interfaces:**
- Consumes: `HanomanPet` dari Task 2.
- Produces: tak ada API baru — hanya wiring.

- [x] **Step 1: Tulis test kontrak yang gagal**

Buat `src/test/pet-mount.test.tsx`. Test ini membaca **sumber** dari cwd, pola yang sama dengan
`src/test/changelog-nav.test.tsx` — `import.meta.url` di bawah transform Vite bukan URL ber-skema
`file:`, jadi resolusi relatif-modul tak bisa dipakai.

```tsx
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `import.meta.url` di bawah transform Vite bukan URL ber-skema `file:`, jadi berkasnya dicari
// dari cwd — yang berbeda antara run tingkat-paket (`src/`) dan tingkat-root (cermin
// `changelog-nav.test.tsx`).
function read(relative: string): string {
  const found = [resolve(process.cwd(), relative), resolve(process.cwd(), "src", relative)]
    .find((c) => existsSync(c));
  if (!found) throw new Error(`${relative} tak ketemu dari ${process.cwd()}`);
  return readFileSync(found, "utf8");
}

const app = read("src/App.tsx");

describe("mount pet Hanoman di App", () => {
  it("dipasang tepat sekali", () => {
    expect(app.match(/<HanomanPet\b/g)).toHaveLength(1);
    expect(app).toContain('import { HanomanPet } from "./screens/HanomanPet"');
  });

  it("dipasang di App, bukan di dalam Shell — Shell ditulis ulang tiap cabang section", () => {
    expect(read("src/ds/shell.tsx")).not.toContain("HanomanPet");
  });

  it("diberi kedua sumber datanya dan callback navigasi", () => {
    const at = app.indexOf("<HanomanPet");
    const tag = app.slice(at, at + 400);
    expect(tag).toContain("sessions={sessions}");
    expect(tag).toContain("backlog={backlog}");
    expect(tag).toContain("onOpen=");
  });
});

describe("kontrak design system pet", () => {
  it("tak memperkenalkan warna atau bayangan di luar token", () => {
    const pet = read("src/screens/HanomanPet.tsx");
    expect(pet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(pet).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(pet).not.toMatch(/boxShadow:\s*["'](?!var\()/);
  });

  it("memanggil artwork lewat ID katalog, bukan filename", () => {
    const petState = read("src/screens/pet-state.ts");
    expect(petState).not.toContain(".webp");
    expect(petState).toMatch(/STK-00\d/);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run pet-mount`
Expected: FAIL — `expected null to have length 1`.

- [x] **Step 3: Tambahkan import di `App.tsx`**

Sisipkan tepat setelah baris `import { ChangelogScreen } from "./screens/ChangelogScreen";`:

```tsx
// SPEC-585 · pet maskot. Dipasang di App, BUKAN di dalam Shell: <Shell> ditulis ulang di tiap
// cabang `section`, jadi pet yang tinggal di sana lahir kembali tiap navigasi — animasi idle
// mulai dari nol dan keadaan transient hilang persis saat operator pindah layar untuk melihatnya.
import { HanomanPet } from "./screens/HanomanPet";
```

- [x] **Step 4: Pasang komponennya**

Di blok `return` `App`, sisipkan tepat setelah baris `{screen}` (baris pertama di dalam
`<NotificationsProvider …>`):

```tsx
        <HanomanPet sessions={sessions} backlog={backlog}
          onOpen={(t) => { if (t.sessionId) setFocusSession(t.sessionId); setSection(t.section); }} />
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run pet-mount`
Expected: PASS — 5 test lulus.

- [x] **Step 6: Jalankan test App yang sudah ada agar tak ada regresi**

Run: `env -u NODE_ENV ./node_modules/.bin/vitest run app-flows app-states smoke changelog-nav`
Expected: PASS, 0 gagal.

- [x] **Step 7: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 8: Commit**

```bash
git add src/src/App.tsx src/test/pet-mount.test.tsx
git commit -m "feat(spec-585): pasang pet Hanoman sekali di App dengan navigasi ke tempat kejadian"
```

---

### Task 4: Perbarui Source of Truth

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/docs/design-system/design-system.md`
- Verify: `internal/docs/README.md`

- [x] **Step 1: Tambahkan subseksi "Pet Hanoman" di `frontend-implementation.md`**

Sisipkan tepat sebelum heading `## Tinggi & scrolling: rantai flex, bukan angka ajaib`:

```markdown
## Pet Hanoman: status sesi sebagai pose (SPEC-585)

Widget maskot di sudut kanan-bawah, hadir di semua halaman. Pose-nya **turunan** keadaan sesi &
backlog, bukan hiasan, dan seluruh sinyalnya sudah ada di klien — tak ada endpoint status, tak ada
skema, tak ada channel realtime baru (ADR-0024 & ADR-0039 utuh).

| sumber | frame WS | dipakai untuk |
|---|---|---|
| `sessions: TerminalSession[]` | `sessions` | `exited`, `exitCode`, `decision`, `deciding`, `specId` |
| `backlog: Spec[]` | `specs` | `stage`, `blockedBy`, `source`, `title` |
| `useNotifications().items` | `notifications` | `type` + `createdAt` keadaan transient |

Kosakata sesinya **identik** dengan sel Terminal (`awaiting` = hidup && `decision`, `deciding`
menang atasnya, `failed` = `exited` && `exitCode` bukan nol). Pet yang memakai rumus lain akan
mengatakan hal yang berlawanan dengan sel di layar yang sama.

Pemetaan pose hidup di `src/src/screens/pet-state.ts` (murni & bertest). Urutan tabel **adalah**
urutan prioritas: kandidat pertama yang menyala menang, dan itu satu-satunya mekanisme anti-kedip —
tak ada timer dwell.

| # | pose | ID katalog | menyala saat |
|---|---|---|---|
| 1 | `blocked` | `STK-004` | ada sesi gagal — atau tak ada sesi hidup **dan** ada backlog ber-`blockedBy` |
| 2 | `waiting` | `STK-003` | sesi hidup ber-`decision` yang **tidak** sedang dilayani lead |
| 3 | `shipped` | `STK-005` | notifikasi `done`/`automerge` non-audit, masih di dalam window transient |
| 4 | `docs-updated` | `STK-008` | notifikasi `done` untuk backlog ber-`source: "audit"`, masih transient |
| 5 | `working` | `STK-002` | sesi hidup yang backlog-nya belum `done` |
| 6 | `review` | `STK-006` | sesi terdaftar yang backlog-nya sudah `stage: "done"` |
| 7 | `ready` | `STK-001` | lantai — selalu benar |

Empat keputusan di dalam tabel itu yang tak terbaca dari kodenya:

- **`blocked` karena dependency digerbangi "tak ada sesi hidup".** `blockedBy` adalah keadaan normal
  & berumur panjang di project ber-`dependsOn` (ADR-0093). Tanpa gerbang itu pet terkunci di pose
  peringkat 1 selamanya lalu berhenti memberi tahu apa pun. Backlog yang menunggu giliran tak
  sedang meminta apa-apa dari manusia; sesi yang gagal meminta.
- **`waiting` mengecualikan `deciding`.** Sesi yang sedang disusunkan keputusannya oleh hanoman-lead
  terlihat identik dengan sesi mandek (diam, marker terisi) — membacanya sebagai "butuh kamu"
  adalah alarm palsu (`TerminalSession.deciding`, ADR-0091).
- **Transien menang atas keadaan mapan, kalah dari `blocked`/`waiting`.** Kabar baru lebih
  informatif daripada keadaan mapan, tetapi perayaan tak boleh menutupi permintaan tolong. Window
  `PET_TRANSIENT_MS` = 45 dtk sejak `createdAt` notifikasinya; komponen menjadwalkan **satu**
  `setTimeout` tepat pada saat luruhnya, bukan denyut.
- **`review` memakai `stage === "done"`, bukan `exited`.** Agen adalah TUI interaktif: pada jalur
  sukses pane **tak pernah** mati (SPEC-433), jadi `exited` sendirian adalah gerbang yang nyaris
  tak pernah menyala. `Spec.stage` diturunkan server dari bukti yang sama (fase terminal + plan
  terceklist, ADR-0029) dan memang bergerak. Karena itu pula `working` mengecualikan sesi ber-spec
  `done`: pane hidup di atas backlog selesai bukan sedang bekerja, ia menunggu dilihat.

`STK-007` (`thanks`) sengaja tak dipakai — ungkapan terima kasih, bukan keadaan mesin.

**Penempatan & mount.** `HanomanPet` dipasang **sekali** di `App.tsx` sebagai saudara `{screen}`,
bukan di dalam `Shell`: `<Shell>` ditulis ulang di tiap cabang `section`, jadi pet yang tinggal di
sana lahir kembali tiap navigasi (animasi mulai dari nol, keadaan transient hilang persis saat
operator pindah layar untuk melihatnya) — dan dari dalam `Shell` ia butuh prop baru di sembilan
call site untuk menjangkau `sessions`/`setSection`/`setFocusSession`. Overlay `position: fixed`
kanan-bawah, `z-index: 80` → di bawah header (90), terminal fullscreen (100), Modal (150), Toast
(200). Pembungkusnya `pointer-events: none` dan hanya tombolnya `auto`, jadi "tak menutupi kontrol"
ditegakkan struktur, bukan koordinat.

**Animasi.** Napas idle = satu keyframe `hn-pet-breathe` (`app.css`) yang hanya menyentuh
`transform` → compositor, nol render React. Perpindahan pose = crossfade CSS: pose yang **pernah**
terjadi dirender bertumpuk dan opasitasnya dipilih `pose === p`, sehingga byte yang diambil browser
tumbuh mengikuti pemakaian alih-alih memuat kedelapannya di muka. `prefers-reduced-motion: reduce`
dibaca di JS (`window.matchMedia`, ikut mendengarkan perubahan) dan `animation`/`transition` **tak
dipasang sama sekali** — bentuk yang bisa diuji, sejalan dengan animasi kit lain yang juga inline.

**Aksesibilitas.** `role="status" aria-live="polite"` membungkus gambarnya, dan tombolnya adalah
**overlay transparan di dalam** region itu — bukan sebaliknya: gambar di dalam `<button>`
diperlakukan sebagian screen reader sebagai presentasional sehingga perubahan alt tak pernah
diumumkan. Pose aktif membawa alt bermakna berisi kalimat statusnya; lapisan pose lain `alt=""` +
`aria-hidden`. Satu sumber kalimat, tanpa teks tersembunyi kembar. Hover memunculkan ringkasan yang
sama lewat `title`.

**Sembunyikan** disimpan di `localStorage` `hanoman.pet.hidden` (pola `hanoman.terminal.workspace`)
— preferensi per-browser, tanpa skema & tanpa endpoint. Disembunyikan berarti **menyusut** jadi
pegangan bundar 28 px ber-`Mark` buntut, bukan lenyap: tanpa itu operator tak punya jalan kembali
selain membersihkan `localStorage`.

Yang tak dikerjakan, berikut alasannya: fase sesi tak masuk headline karena
`ProjectView.session.phase` hanya dimuat sekali saat login (`projects` tak didorong WS) sehingga
bisa basi berjam-jam — `Spec.stage` menjawab pertanyaan yang sama dan hidup. Pet berskop workspace
dan sengaja **tak** mengikuti `projectFilter`: ia hadir juga di halaman yang tak punya filter itu.
```

- [x] **Step 2: Tandai family `sticker` sebagai family yang ditempatkan**

Di `internal/docs/design-system/design-system.md`, paragraf yang diawali "Penempatan mengikuti
kegunaan, bukan kewajiban memajang semuanya." saat ini berakhir dengan dua kalimat:

> Model sheet serta template sosial tetap frontend-addressable melalui registry tetapi tidak
> dipaksakan masuk instrument panel operasional. Motif tanpa makna status selalu dekoratif.

Sisipkan satu kalimat **sebelum** keduanya sehingga paragraf itu berakhir seperti ini:

```markdown
Family **sticker** (`STK-001…008`) ditempatkan sebagai **Pet Hanoman**: maskot persisten di sudut
dashboard yang pose-nya turunan status sesi & backlog, bukan hiasan — tabel status → pose beserta
urutan prioritasnya ada di
[frontend-implementation](../frontend/frontend-implementation.md#pet-hanoman-status-sesi-sebagai-pose-spec-585).
Model sheet serta template sosial tetap frontend-addressable melalui registry tetapi tidak
dipaksakan masuk instrument panel operasional. Motif tanpa makna status selalu dekoratif.
```

- [x] **Step 3: Verifikasi index Source of Truth tetap utuh**

Run: `grep -n "frontend-implementation\]\|design-system\]" internal/docs/README.md`
Expected: kedua dokumen sudah ter-link (bagian `## frontend` dan `## design-system`). Tak ada
berkas doc baru, jadi tak ada entri index yang perlu ditambahkan.

- [x] **Step 4: Commit**

```bash
git add internal/docs/frontend/frontend-implementation.md internal/docs/design-system/design-system.md
git commit -m "docs(spec-585): pemetaan status sesi ke pose pet sebagai konvensi"
```

---

### Task 5: Verifikasi akhir & bukti terukur

**Files:** tak ada yang diubah kecuali perbaikan yang ditemukan.

- [x] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

Run:
```bash
env -u NODE_ENV ./node_modules/.bin/vitest run \
  pet-state hanoman-pet pet-mount \
  illustration-component illustration-registry illustration-placement \
  changelog-nav app-flows app-states smoke
```

Filter vitest adalah **substring path**, bukan pasangan `--project <nama> <path>` — bentuk terakhir
memulangkan "No test files found" dan exit 1, yang mudah terbaca sebagai "belum ditulis". Jaga
substring-nya tetap sempit: `ds.test` misalnya juga cocok dengan `uploads.test.ts` di server, yang
lalu gagal menuntut `prisma generate` padahal task ini tak menyentuh server sama sekali.
Expected: 11 berkas, **44 test**, 0 gagal. **Baca angka berkas & test-nya** — `--changed` menyalakan
`passWithNoTests` sehingga nol test terlihat hijau; di sini path disebut eksplisit supaya itu tak
bisa terjadi, tapi angkanya tetap harus dibaca.

- [x] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0, tanpa keluaran. **Jangan** `pnpm -r typecheck`.

- [x] **Step 3: Buktikan bundle tak membengkak**

Run:
```bash
env -u NODE_ENV pnpm --filter ./src build 2>&1 | tail -15
ls src/dist/assets/ | grep -c sticker
du -sh src/dist/assets
```
Expected: build sukses; **8** berkas sticker di `dist/assets` — jumlah yang sama seperti sebelum
perubahan ini, karena `import.meta.glob` di registry sudah eager atas seluruh
`internal/assets/illustration/web/` jauh sebelum SPEC-585. Catat angka `du -sh` di laporan akhir
sebagai bukti terukur bahwa pet menambah **0 byte** aset.

- [x] **Step 4: Jangan boot server**

Task ini tak menyentuh satu pun endpoint (nol berkas di `server/`), jadi smoke boot + curl **tidak**
dijalankan. Bila sebuah langkah menuntutnya, itu tanda scope salah baca.

- [x] **Step 5: Pastikan plan ini seluruhnya terceklist**

Run: `grep -c '^\s*- \[ \]' docs/superpowers/plans/2026-08-08-hanoman-pet-dashboard.md`
Expected: `0`. `Execute done` tak sah selama masih ada kotak kosong (ADR-0029).

- [x] **Step 6: Commit sisa perubahan & push**

```bash
git add -A docs/superpowers/plans
git commit -m "chore(spec-585): centang plan pet Hanoman"
git push origin HEAD:refs/heads/hanoman/spec-585
```

---

## Bukti terukur (diisi saat eksekusi, 2026-08-08)

| klaim | bukti |
|---|---|
| pet menambah **0 byte** aset | `src/dist/assets` memuat **41** `.webp` — sama persis dengan **41** berkas di `internal/assets/illustration/web/`. Emisi digerakkan glob eager registry, bukan pemakaian, jadi kedelapan sticker (376 KB) sudah terangkut sebelum SPEC-585. |
| test yang tersentuh | 11 berkas · **44 test** lulus, 0 gagal (`pet-state` 17 · `hanoman-pet` 8 · `pet-mount` 5 · illustration ×3 · `changelog-nav` · `app-flows` · `app-states` · `smoke`). |
| typecheck | `pnpm --filter ./src typecheck` exit 0. |
| bukan regresi | Peringatan `act(...)` pada `app-states`/`app-flows` **sudah ada di HEAD sebelum** perubahan ini — diverifikasi dengan `git stash` lalu run ulang: 1 peringatan di kedua keadaan. |

**Smoke visual** (Chrome headless via CDP, viewport 1280×713, harness `vite` sekali-pakai yang
me-mount **hanya** `HanomanPet` — tanpa server, tanpa DB; berkasnya dihapus sesudahnya). Ini
diperlukan karena jsdom tak melakukan layout: "merender tapi tak terlihat / salah tempat" adalah
mode gagal yang tak bisa ditangkap test render.

- kotak pet `{x: 1182, y: 613, w: 77, h: 77}` — menempel kanan-bawah, tak memotong viewport.
- `getComputedStyle(stage).animationName === "hn-pet-breathe"` — keyframe benar-benar terpasang di browser sungguhan.
- `img.complete === true`, `naturalWidth 768` — pipeline aset teresolusi lewat registry.
- `getComputedStyle(root).pointerEvents === "none"`, dan `elementFromPoint` di titik tengah pet mengembalikan **`Ringkasan status Hanoman`** — hit area persis milik tombolnya, bukan lebih.
- popover terbuka: `{x: 990, y: 470, w: 268, h: 135}`, `insideViewport: true`, teks `SEDANG BEKERJA / SPEC-585 · sedang berjalan / Pet maskot Hanoman di dashboard / Buka Terminal / Sembunyikan`.
- terbaca di **kedua** permukaan: di atas `--term-bg` (garis tinta + brass) maupun di atas bone paper (aset transparan, tanpa latar yang dipanggang).
