# SPEC-740 — State tampilan persisten per halaman · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap halaman dashboard mengingat state tampilannya (filter & pencarian, paginasi, posisi scroll, item terpilih/panel terbuka) dan memulihkannya saat pengguna kembali — baik lewat navigasi maupun refresh/buka-ulang browser.

**Architecture:** Satu modul bersama `src/src/ui-state/` menyediakan store murni di atas `localStorage` (kunci `hn.ui.v1.<screen>[@<scope>].<field>`), hook `usePersistedState`/`useScrollRestore`, dan komponen `ResetViewButton`. Tiap layar mengganti `React.useState` untuk field tampilannya dengan `usePersistedState`; App menyimpan `section`/`projectId`/`projectFilter`; `Shell` memulihkan scroll `<main>` per section. Tak ada perubahan skema, endpoint, atau kontrak API.

**Tech Stack:** React 18 + TypeScript (Vite), vitest + @testing-library/react + jsdom, design system internal (`src/src/ds`).

## Global Constraints

- Kunci storage **ber-namespace & berversi**: `hn.ui.v1.<screen>[@<scope>].<field>`. Versi hidup di dalam kunci.
- Nilai yang gagal di-parse atau salah bentuk **jatuh ke default, tak pernah melempar**. Semua akses `localStorage` dibungkus `try/catch` (mode privat melempar saat diakses).
- State per-project memakai scope (`scoped(screen, projectId)`) — filter project A tak boleh muncul di project B.
- **Jangan** menyimpan data sensitif atau payload besar: hanya nilai filter, angka halaman, offset scroll, id/path terpilih.
- Scroll dipulihkan **setelah** data dimuat & daftar ter-render.
- SPEC-523/ADR-0107 dihormati: yang dipulihkan `page`, **bukan** `limit` (`limit` tanpa `page` berperilaku sebagai PLAFON). `pageSize` tetap konstanta layar.
- Tanpa perubahan skema Prisma, endpoint, atau kontrak API — murni state klien.
- Tiap layar berfilter wajib punya aksi **"Reset tampilan"** dan lencana **"N filter aktif"**.
- Test web dijalankan `env -u NODE_ENV` (SPEC-293). Berkas test yang me-mock `api` **sebagian** wajib menyebut `getMethodStatus` (SPEC-739).
- Perintah test: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run <path>` — jalankan dari direktori `src`, pakai biner lokal (jebakan cwd drift).
- Docs yang tersentuh diperbarui **dalam commit yang sama** & ter-link di `internal/docs/README.md`.

---

### Task 1: Store murni `ui-state/store.ts` + isolasi test

**Files:**
- Create: `src/src/ui-state/store.ts`
- Modify: `src/test/setup.ts`
- Test: `src/test/ui-state.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `UI_PREFIX = "hn.ui"`, `UI_VERSION = "v1"`
  - `scoped(screen: string, scope?: string | null): string`
  - `uiKey(screen: string, field: string): string`
  - `uiScreenPrefix(screen: string): string`
  - `type Accept<T> = (v: unknown) => v is T`
  - `readUiState<T>(key: string, fallback: T, accept?: Accept<T>): T`
  - `writeUiState(key: string, value: unknown): void`
  - `resetUiState(screen: string): void`
  - `pruneUiState(): void`
  - `onUiReset(fn: (prefix: string) => void): () => void`
  - guard: `isStr`, `isNum`, `isBool`, `nullableStr`, `strList`, `oneOf<T extends string>(...opts: T[]): Accept<T>`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/ui-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  UI_PREFIX, UI_VERSION, scoped, uiKey, uiScreenPrefix,
  readUiState, writeUiState, resetUiState, pruneUiState, onUiReset,
  isNum, nullableStr, oneOf, strList,
} from "../src/ui-state/store";

beforeEach(() => localStorage.clear());

describe("bentuk kunci", () => {
  it("berversi & ber-namespace", () => {
    expect(uiKey("backlog", "q")).toBe("hn.ui.v1.backlog.q");
    expect(UI_PREFIX).toBe("hn.ui");
    expect(UI_VERSION).toBe("v1");
  });
  it("scope project menyisip sebelum field", () => {
    expect(uiKey(scoped("changelog", "erp"), "q")).toBe("hn.ui.v1.changelog@erp.q");
  });
  it("scope kosong tak mengubah screen", () => {
    expect(scoped("changelog", "")).toBe("changelog");
    expect(scoped("changelog", null)).toBe("changelog");
  });
  it("prefix layar mengunci pada titik pemisah field", () => {
    expect(uiScreenPrefix("backlog")).toBe("hn.ui.v1.backlog.");
  });
});

describe("baca/tulis", () => {
  it("round-trip", () => {
    writeUiState(uiKey("backlog", "q"), "invoice");
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("invoice");
  });
  it("kunci kosong → default", () => {
    expect(readUiState(uiKey("backlog", "page"), 1)).toBe(1);
  });
  it("JSON rusak → default, tanpa melempar", () => {
    localStorage.setItem(uiKey("backlog", "q"), "{bukan json");
    expect(() => readUiState(uiKey("backlog", "q"), "")).not.toThrow();
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("");
  });
  it("tipe tak cocok default → default", () => {
    writeUiState(uiKey("backlog", "page"), "abc");
    expect(readUiState(uiKey("backlog", "page"), 1)).toBe(1);
  });
  it("angka tak hingga ditolak", () => {
    localStorage.setItem(uiKey("backlog", "scroll"), "null");
    expect(readUiState(uiKey("backlog", "scroll"), 0)).toBe(0);
  });
  it("accept menolak nilai di luar union", () => {
    const view = oneOf("grid", "list", "board");
    writeUiState(uiKey("backlog", "view"), "kanban");
    expect(readUiState(uiKey("backlog", "view"), "grid", view)).toBe("grid");
    writeUiState(uiKey("backlog", "view"), "list");
    expect(readUiState(uiKey("backlog", "view"), "grid", view)).toBe("list");
  });
  it("nullableStr menerima null maupun string", () => {
    writeUiState(uiKey("backlog", "detailId"), null);
    expect(readUiState<string | null>(uiKey("backlog", "detailId"), null, nullableStr)).toBeNull();
    writeUiState(uiKey("backlog", "detailId"), "SPEC-1");
    expect(readUiState<string | null>(uiKey("backlog", "detailId"), null, nullableStr)).toBe("SPEC-1");
  });
  it("strList menolak array bercampur", () => {
    writeUiState(uiKey("triage", "picked"), ["a", 2]);
    expect(readUiState<string[]>(uiKey("triage", "picked"), [], strList)).toEqual([]);
  });
  it("isNum dipakai sebagai accept eksplisit", () => {
    writeUiState(uiKey("lead", "decPage"), 3);
    expect(readUiState(uiKey("lead", "decPage"), 1, isNum)).toBe(3);
  });
});

describe("versi", () => {
  it("nilai versi lama tak terbaca", () => {
    localStorage.setItem("hn.ui.v0.backlog.q", JSON.stringify("lama"));
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("");
  });
  it("prune membuang versi lain & menyisakan versi berjalan", () => {
    localStorage.setItem("hn.ui.v0.backlog.q", JSON.stringify("lama"));
    writeUiState(uiKey("backlog", "q"), "baru");
    pruneUiState();
    expect(localStorage.getItem("hn.ui.v0.backlog.q")).toBeNull();
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("baru");
  });
  it("prune tak menyentuh kunci di luar namespace", () => {
    localStorage.setItem("hanoman.terminal.workspace", "{}");
    pruneUiState();
    expect(localStorage.getItem("hanoman.terminal.workspace")).toBe("{}");
  });
});

describe("reset", () => {
  it("hanya menghapus kunci layar itu", () => {
    writeUiState(uiKey("backlog", "q"), "a");
    writeUiState(uiKey("triage", "q"), "b");
    resetUiState("backlog");
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("");
    expect(readUiState(uiKey("triage", "q"), "")).toBe("b");
  });
  it("reset ber-scope tak menyentuh project lain", () => {
    writeUiState(uiKey(scoped("changelog", "a"), "q"), "qa");
    writeUiState(uiKey(scoped("changelog", "b"), "q"), "qb");
    resetUiState(scoped("changelog", "a"));
    expect(readUiState(uiKey(scoped("changelog", "a"), "q"), "")).toBe("");
    expect(readUiState(uiKey(scoped("changelog", "b"), "q"), "")).toBe("qb");
  });
  it("memancarkan prefix ke pendengar", () => {
    const seen: string[] = [];
    const off = onUiReset((p) => seen.push(p));
    resetUiState("backlog");
    off();
    resetUiState("triage");
    expect(seen).toEqual(["hn.ui.v1.backlog."]);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/ui-state.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ui-state/store"`.

- [ ] **Step 3: Tulis implementasi**

Create `src/src/ui-state/store.ts`:

```ts
// State tampilan tiap layar — filter, paginasi, scroll, seleksi — yang bertahan lintas
// navigasi & refresh (SPEC-740 · ADR-0115).
//
// Murni & bebas React: satu-satunya sentuhan platform adalah `localStorage`, yang SELALU
// dibungkus try/catch — di mode privat ia melempar saat DIAKSES, bukan hanya saat ditulis.
//
// Versi hidup DI DALAM kunci, bukan di dalam nilai: menaikkan UI_VERSION membuat seluruh
// state lama tak terlihat tanpa satu baris migrasi, dan `pruneUiState()` menyapu sisanya.

export const UI_PREFIX = "hn.ui";
export const UI_VERSION = "v1";

/** Screen key ber-scope project. Scope kosong = tak ber-scope (bukan "screen@"). */
export const scoped = (screen: string, scope?: string | null): string =>
  (scope ? `${screen}@${scope}` : screen);

/** `hn.ui.v1.backlog.q` · ber-scope: `hn.ui.v1.changelog@erp.q` */
export const uiKey = (screen: string, field: string): string =>
  `${UI_PREFIX}.${UI_VERSION}.${screen}.${field}`;

/** Prefix seluruh kunci milik satu screen key — berakhiran titik agar `backlog.` tak
    ikut mencocoki `backlogX.`. */
export const uiScreenPrefix = (screen: string): string =>
  `${UI_PREFIX}.${UI_VERSION}.${screen}.`;

export type Accept<T> = (v: unknown) => v is T;

export const isStr = (v: unknown): v is string => typeof v === "string";
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isBool = (v: unknown): v is boolean => typeof v === "boolean";
export const nullableStr = (v: unknown): v is string | null => v === null || typeof v === "string";
export const strList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
export const oneOf = <T extends string>(...opts: T[]): Accept<T> =>
  ((v: unknown): v is T => typeof v === "string" && (opts as string[]).includes(v));

// Guard bawaan: bentuk nilai tersimpan wajib sama dengan bentuk default. Tanpa ini
// `page: "abc"` yang tertinggal dari bentuk lama membuat Pager menghitung NaN. Field
// nullable tak punya informasi tipe di default-nya → pemanggilnya menyebut `nullableStr`.
function sameShape(v: unknown, fallback: unknown): boolean {
  if (fallback === null) return v === null;
  if (Array.isArray(fallback)) return Array.isArray(v);
  if (typeof fallback === "number") return isNum(v);
  if (v === null) return false;
  return typeof v === typeof fallback;
}

export function readUiState<T>(key: string, fallback: T, accept?: Accept<T>): T {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  if (raw === null) return fallback;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fallback; }
  const ok = accept ? accept(parsed) : sameShape(parsed, fallback);
  return ok ? (parsed as T) : fallback;
}

export function writeUiState(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* mode privat / kuota penuh */ }
}

function allKeys(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null) out.push(k);
    }
    return out;
  } catch { return []; }
}

function removeKeys(match: (k: string) => boolean): void {
  for (const k of allKeys()) {
    if (!match(k)) continue;
    try { localStorage.removeItem(k); } catch { /* mode privat */ }
  }
}

type ResetListener = (prefix: string) => void;
const resetListeners = new Set<ResetListener>();

/** Dengarkan reset layar. Mengembalikan fungsi pelepas (dipakai sebagai cleanup effect). */
export function onUiReset(fn: ResetListener): () => void {
  resetListeners.add(fn);
  return () => { resetListeners.delete(fn); };
}

// Menghapus kunci saja tak cukup: komponen yang sedang ter-mount memegang nilainya di
// useState. Peristiwa ini yang mengembalikannya ke nilai awal — tanpa prop drilling, dan
// layar baru ikut dapat perilakunya.
export function resetUiState(screen: string): void {
  const prefix = uiScreenPrefix(screen);
  removeKeys((k) => k.startsWith(prefix));
  for (const fn of [...resetListeners]) fn(prefix);
}

/** Buang state dari versi kunci yang sudah tak dibaca siapa pun. Dipanggil sekali saat App mount. */
export function pruneUiState(): void {
  const live = `${UI_PREFIX}.${UI_VERSION}.`;
  removeKeys((k) => k.startsWith(`${UI_PREFIX}.`) && !k.startsWith(live));
}
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/ui-state.test.ts`
Expected: PASS, 17 test.

- [ ] **Step 5: Isolasi test global**

Modify `src/test/setup.ts` menjadi:

```ts
import "@testing-library/jest-dom";
import { beforeEach } from "vitest";

// SPEC-740 · state tampilan kini persisten di localStorage, dan vitest memakai SATU jsdom
// per berkas test — tanpa ini test pertama yang menyetel filter mewariskannya ke test
// berikutnya di berkas yang sama, dan kegagalannya terbaca seperti regresi komponen.
// Hook setupFiles berjalan sebelum hook tingkat-berkas, jadi berkas yang menyemai
// localStorage di dalam beforeEach/test-nya sendiri tak terpengaruh.
beforeEach(() => {
  try { localStorage.clear(); } catch { /* mode privat */ }
});
```

- [ ] **Step 6: Verifikasi setup tak merusak test yang sudah memakai localStorage**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/terminal-workspace.test.ts test/terminal-screen.test.tsx test/hanoman-pet.test.tsx test/new-terminal-runtime.test.tsx`
Expected: PASS (semuanya, tanpa kegagalan baru).

- [ ] **Step 7: Commit**

```bash
git add src/src/ui-state/store.ts src/test/ui-state.test.ts src/test/setup.ts
git commit -m "feat(spec-740): store state tampilan berkunci hn.ui.v1 + isolasi localStorage test"
```

---

### Task 2: Hook `usePersistedState`

**Files:**
- Create: `src/src/ui-state/hooks.ts`
- Test: `src/test/ui-state-hooks.test.tsx`

**Interfaces:**
- Consumes: `uiKey`, `readUiState`, `writeUiState`, `onUiReset`, `Accept` dari `./store`
- Produces: `usePersistedState<T>(screen: string, field: string, initial: T, accept?: Accept<T>): [T, React.Dispatch<React.SetStateAction<T>>]`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/ui-state-hooks.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { usePersistedState } from "../src/ui-state/hooks";
import { uiKey, readUiState, resetUiState, writeUiState, oneOf } from "../src/ui-state/store";

beforeEach(() => localStorage.clear());

function Filter({ screenKey = "demo" }: { screenKey?: string }) {
  const [q, setQ] = usePersistedState(screenKey, "q", "");
  return (
    <div>
      <span data-testid="q">{q}</span>
      <button onClick={() => setQ("invoice")}>set</button>
      <button onClick={() => setQ((s) => s + "!")}>tambah</button>
    </div>
  );
}

describe("usePersistedState", () => {
  it("menulis ke storage saat berubah", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    expect(readUiState(uiKey("demo", "q"), "")).toBe("invoice");
  });

  it("bertahan lintas unmount/remount", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    cleanup();
    render(<Filter />);
    expect(screen.getByTestId("q").textContent).toBe("invoice");
  });

  it("menerima updater fungsi", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    fireEvent.click(screen.getByText("tambah"));
    expect(screen.getByTestId("q").textContent).toBe("invoice!");
  });

  it("nilai rusak di storage → nilai awal", () => {
    localStorage.setItem(uiKey("demo", "q"), "{rusak");
    render(<Filter />);
    expect(screen.getByTestId("q").textContent).toBe("");
  });

  it("reset mengembalikan komponen yang sedang ter-mount ke nilai awal", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    expect(screen.getByTestId("q").textContent).toBe("invoice");
    resetUiState("demo");
    expect(screen.getByTestId("q").textContent).toBe("");
  });

  it("reset layar lain tak menyentuh layar ini", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    resetUiState("layar-lain");
    expect(screen.getByTestId("q").textContent).toBe("invoice");
  });

  it("kunci berganti (scope project) → baca ulang, bukan bawa nilai lama", () => {
    writeUiState(uiKey("demo@a", "q"), "milik-a");
    writeUiState(uiKey("demo@b", "q"), "milik-b");
    const { rerender } = render(<Filter screenKey="demo@a" />);
    expect(screen.getByTestId("q").textContent).toBe("milik-a");
    rerender(<Filter screenKey="demo@b" />);
    expect(screen.getByTestId("q").textContent).toBe("milik-b");
    // nilai project A tetap utuh — bukan tertimpa nilai yang sedang tampil
    expect(readUiState(uiKey("demo@a", "q"), "")).toBe("milik-a");
  });

  it("accept menolak nilai di luar union", () => {
    writeUiState(uiKey("demo", "view"), "kanban");
    function View() {
      const [v] = usePersistedState("demo", "view", "grid", oneOf("grid", "list"));
      return <span data-testid="v">{v}</span>;
    }
    render(<View />);
    expect(screen.getByTestId("v").textContent).toBe("grid");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/ui-state-hooks.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/ui-state/hooks"`.

- [ ] **Step 3: Tulis implementasi**

Create `src/src/ui-state/hooks.ts`:

```ts
// Hook state tampilan persisten (SPEC-740 · ADR-0115). Pengganti langsung `React.useState`
// untuk field tampilan: tanda tangannya sama, hanya kuncinya yang ditambahkan di depan.
import React from "react";
import { onUiReset, readUiState, uiKey, writeUiState, type Accept } from "./store";

export function usePersistedState<T>(
  screen: string, field: string, initial: T, accept?: Accept<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const key = uiKey(screen, field);
  // `initial`/`accept` hampir selalu literal atau arrow inline di call site — memasukkannya
  // ke deps effect akan menulis ulang storage tiap render.
  const seed = React.useRef({ initial, accept });
  seed.current = { initial, accept };

  // Nilai DAN kunci pemiliknya disimpan bersama: tanpa itu, saat scope project berganti,
  // effect penulis sempat menyimpan nilai project LAMA di bawah kunci project BARU
  // sebelum effect pembaca menggantinya.
  const [snap, setSnap] = React.useState(() => ({ key, value: readUiState(key, initial, accept) }));
  if (snap.key !== key) setSnap({ key, value: readUiState(key, seed.current.initial, seed.current.accept) });

  React.useEffect(() => { writeUiState(snap.key, snap.value); }, [snap]);
  React.useEffect(() => onUiReset((prefix) => {
    if (key.startsWith(prefix)) setSnap({ key, value: seed.current.initial });
  }), [key]);

  const set = React.useCallback<React.Dispatch<React.SetStateAction<T>>>((next) => {
    setSnap((s) => ({
      key: s.key,
      value: typeof next === "function" ? (next as (prev: T) => T)(s.value) : next,
    }));
  }, []);

  return [snap.value, set];
}
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/ui-state-hooks.test.tsx`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add src/src/ui-state/hooks.ts src/test/ui-state-hooks.test.tsx
git commit -m "feat(spec-740): hook usePersistedState + pemulihan saat kunci scope berganti"
```

---

### Task 3: Hook `useScrollRestore`

**Files:**
- Modify: `src/src/ui-state/hooks.ts`
- Test: `src/test/ui-state-scroll.test.tsx`

**Interfaces:**
- Consumes: `uiKey`, `readUiState`, `writeUiState` dari `./store`
- Produces: `useScrollRestore<E extends HTMLElement = HTMLDivElement>(screen: string, field: string, ready?: boolean): (node: E | null) => void`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/ui-state-scroll.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useScrollRestore } from "../src/ui-state/hooks";
import { uiKey, readUiState, writeUiState } from "../src/ui-state/store";

beforeEach(() => localStorage.clear());

// jsdom tak melakukan layout: scrollTop selalu 0 dan scrollHeight/clientHeight selalu 0.
// Elemen palsu di bawah memberi ketiganya perilaku nyata supaya hook bisa diuji.
function fakeScroller(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(v, scrollHeight - clientHeight)); },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
}

function List({ ready, tall = 2000 }: { ready: boolean; tall?: number }) {
  const ref = useScrollRestore("demo", "scroll", ready);
  return (
    <div
      data-testid="list"
      ref={(node) => {
        if (node && !(node as any).__faked) { (node as any).__faked = true; fakeScroller(node, tall, 400); }
        ref(node);
      }}
    />
  );
}

const frame = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };

describe("useScrollRestore", () => {
  it("menyimpan posisi scroll", async () => {
    render(<List ready />);
    const el = screen.getByTestId("list");
    el.scrollTop = 640;
    fireEvent.scroll(el);
    await frame();
    expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(640);
  });

  it("memulihkan posisi setelah ready", async () => {
    writeUiState(uiKey("demo", "scroll"), 500);
    const { rerender } = render(<List ready={false} />);
    const el = screen.getByTestId("list");
    await frame();
    expect(el.scrollTop).toBe(0);          // belum ready → belum dipulihkan
    rerender(<List ready />);
    await frame();
    expect(el.scrollTop).toBe(500);
  });

  it("tak memulihkan saat tak ada posisi tersimpan", async () => {
    render(<List ready />);
    await frame();
    expect(screen.getByTestId("list").scrollTop).toBe(0);
  });

  it("posisi tersimpan tak rusak oleh konten yang masih pendek", async () => {
    writeUiState(uiKey("demo", "scroll"), 1500);
    render(<List ready tall={500} />);   // hanya bisa scroll sampai 100
    await frame();
    await frame();
    expect(readUiState(uiKey("demo", "scroll"), 0)).toBe(1500);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/ui-state-scroll.test.tsx`
Expected: FAIL — `useScrollRestore is not a function` / import tak ditemukan.

- [ ] **Step 3: Tulis implementasi**

Append ke `src/src/ui-state/hooks.ts` (di bawah `usePersistedState`):

```ts
// Berapa frame pemulihan boleh menunggu tinggi konten jadi final. Daftar yang datanya
// baru tiba tumbuh beberapa frame; daftar yang memang lebih pendek tak boleh membuat
// loop abadi.
const RESTORE_FRAMES = 20;

/** Ref callback untuk elemen bergulir: menyimpan `scrollTop` dan memulihkannya SETELAH
    `ready` (mis. data selesai dimuat). Ref callback, bukan RefObject — container daftar
    sering baru muncul sesudah state `loading` selesai. */
export function useScrollRestore<E extends HTMLElement = HTMLDivElement>(
  screen: string, field: string, ready = true,
): (node: E | null) => void {
  const key = uiKey(screen, field);
  const [el, setEl] = React.useState<E | null>(null);
  const ref = React.useCallback((node: E | null) => setEl(node), []);
  // Pemulihan menyetel scrollTop, yang memancarkan event scroll. Tanpa penanda ini,
  // percobaan pertama (saat konten masih pendek) menulis balik nilai TERPOTONG dan
  // posisi aslinya hilang sebelum konten sempat tumbuh.
  const restoring = React.useRef(false);

  React.useEffect(() => {
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (restoring.current || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; writeUiState(key, el.scrollTop); });
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [el, key]);

  React.useEffect(() => {
    if (!el || !ready) return;
    const saved = readUiState(key, 0);
    if (saved <= 0) return;
    let frames = 0;
    let raf = 0;
    restoring.current = true;
    const tick = () => {
      el.scrollTop = saved;
      const enough = el.scrollHeight - el.clientHeight >= saved;
      if (enough || ++frames >= RESTORE_FRAMES) { restoring.current = false; return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); restoring.current = false; };
  }, [el, key, ready]);

  return ref;
}
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/ui-state-scroll.test.tsx`
Expected: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add src/src/ui-state/hooks.ts src/test/ui-state-scroll.test.tsx
git commit -m "feat(spec-740): useScrollRestore — pulihkan scroll sesudah data ter-render"
```

---

### Task 4: `ResetViewButton` + barrel

**Files:**
- Create: `src/src/ui-state/ResetViewButton.tsx`
- Create: `src/src/ui-state/index.ts`
- Test: `src/test/reset-view-button.test.tsx`

**Interfaces:**
- Consumes: `resetUiState` dari `./store`, `Badge`/`Button` dari `../ds`
- Produces:
  - `ResetViewButton(props: { screen: string; active: number; onReset?: () => void; label?: string })`
  - barrel `src/src/ui-state/index.ts` yang me-re-export seluruh `store`, `hooks`, dan `ResetViewButton`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/reset-view-button.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResetViewButton, usePersistedState, uiKey, readUiState } from "../src/ui-state";

beforeEach(() => localStorage.clear());

function Screen() {
  const [q, setQ] = usePersistedState("demo", "q", "");
  return (
    <div>
      <button onClick={() => setQ("invoice")}>set</button>
      <span data-testid="q">{q}</span>
      <ResetViewButton screen="demo" active={q ? 1 : 0} />
    </div>
  );
}

describe("ResetViewButton", () => {
  it("lencana muncul hanya saat ada filter aktif", () => {
    render(<Screen />);
    expect(screen.queryByText("1 filter aktif")).toBeNull();
    fireEvent.click(screen.getByText("set"));
    expect(screen.getByText("1 filter aktif")).toBeTruthy();
  });

  it("tombol mati saat tak ada filter aktif", () => {
    render(<Screen />);
    expect(screen.getByRole("button", { name: "Reset tampilan" })).toBeDisabled();
  });

  it("mengembalikan filter ke default dan mengosongkan storage", () => {
    render(<Screen />);
    fireEvent.click(screen.getByText("set"));
    expect(readUiState(uiKey("demo", "q"), "")).toBe("invoice");
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect(screen.getByTestId("q").textContent).toBe("");
    expect(readUiState(uiKey("demo", "q"), "")).toBe("");
  });

  it("memanggil onReset untuk state yang hidup di luar layar", () => {
    const onReset = vi.fn();
    render(<ResetViewButton screen="demo" active={2} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/reset-view-button.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/ui-state"`.

- [ ] **Step 3: Tulis implementasi**

Create `src/src/ui-state/ResetViewButton.tsx`:

```tsx
import React from "react";
// Impor komponen DS langsung dari berkasnya, BUKAN dari barrel `../ds`: barrel itu
// mengekspor `Shell`, dan `Shell` mengimpor `useScrollRestore` dari modul ini — lewat
// barrel keduanya jadi lingkaran impor yang mati saat inisialisasi modul.
import { Badge } from "../ds/components/feedback";
import { Button } from "../ds/components/forms";
import { resetUiState } from "./store";

// SPEC-740 · ADR-0115 · dua syarat sekaligus dalam satu kontrol: filter yang DIPULIHKAN
// harus terlihat menyala (kalau tidak, daftar yang tampak kosong terbaca sebagai data
// kosong), dan pengguna harus punya jalan keluar dari filter lama yang tak ia sadari.
// `active` dihitung layar — hanya layar itu yang tahu default field-nya.
export function ResetViewButton({ screen, active, onReset, label = "Reset tampilan" }:
  { screen: string; active: number; onReset?: () => void; label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {active > 0 && <Badge tone="warn" size="sm" icon="filter">{active} filter aktif</Badge>}
      <Button size="sm" variant="ghost" leftIcon="rotate-ccw" disabled={active === 0}
        onClick={() => { resetUiState(screen); onReset?.(); }}>{label}</Button>
    </div>
  );
}
```

Create `src/src/ui-state/index.ts`:

```ts
// State tampilan persisten per layar (SPEC-740 · ADR-0115).
export {
  UI_PREFIX, UI_VERSION, scoped, uiKey, uiScreenPrefix,
  readUiState, writeUiState, resetUiState, pruneUiState, onUiReset,
  isStr, isNum, isBool, nullableStr, strList, oneOf,
} from "./store";
export type { Accept } from "./store";
export { usePersistedState, useScrollRestore } from "./hooks";
export { ResetViewButton } from "./ResetViewButton";
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/reset-view-button.test.tsx`
Expected: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add src/src/ui-state/ResetViewButton.tsx src/src/ui-state/index.ts src/test/reset-view-button.test.tsx
git commit -m "feat(spec-740): ResetViewButton + barrel ui-state"
```

---

### Task 5: App — section terakhir, project, filter project, pencarian Projects

**Files:**
- Modify: `src/src/App.tsx` (blok `useState` di `export default function App()`, sekitar baris 649–683)
- Modify: `src/src/ds/shell.tsx` (ekspor daftar key nav)
- Test: `src/test/app-state-persist.test.tsx`

**Interfaces:**
- Consumes: `usePersistedState`, `pruneUiState`, `oneOf` dari `../ui-state`; `HN_NAV` dari `./ds/shell`
- Produces: `NAV_KEYS: string[]` diekspor dari `src/src/ds/shell.tsx`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/app-state-persist.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { uiKey, writeUiState, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      authStatus: vi.fn().mockResolvedValue({ needsSetup: false, user: { id: "u1", email: "a@b.c", role: "admin" } }),
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listSpecs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listTerminals: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({}),
      // SPEC-739 · mock `api` parsial WAJIB menyebut getMethodStatus.
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
      getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0" }),
      listNotifications: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
    },
  };
});
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));

import App from "../src/App";

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

describe("state nav App", () => {
  it("memulihkan halaman terakhir yang dibuka", async () => {
    writeUiState(uiKey("app", "section"), "settings");
    render(<App />);
    await waitFor(() => expect(screen.getByText("Settings")).toBeTruthy());
  });

  it("nilai section tak dikenal jatuh ke overview", async () => {
    writeUiState(uiKey("app", "section"), "runs");
    render(<App />);
    await waitFor(() => expect(screen.getByText("Overview")).toBeTruthy());
  });

  it("deep-link hash menang atas section tersimpan", async () => {
    writeUiState(uiKey("app", "section"), "settings");
    window.location.hash = "#spec=SPEC-1";
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0));
  });

  it("membuang state dari versi kunci lama saat mount", async () => {
    localStorage.setItem("hn.ui.v0.backlog.q", JSON.stringify("lama"));
    render(<App />);
    await waitFor(() => expect(localStorage.getItem("hn.ui.v0.backlog.q")).toBeNull());
  });

  it("section yang dipilih tersimpan", async () => {
    render(<App />);
    await waitFor(() => expect(readUiState(uiKey("app", "section"), "")).toBe("overview"));
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/app-state-persist.test.tsx`
Expected: FAIL — test "memulihkan halaman terakhir" gagal (App selalu mulai di Overview).

- [ ] **Step 3: Ekspor daftar key nav**

Di `src/src/ds/shell.tsx`, tepat di bawah deklarasi `HN_NAV` (setelah baris `];`), tambahkan:

```tsx
// SPEC-740 · ADR-0115 · gerbang bagi `section` yang dipulihkan dari storage: hanya halaman
// bernavigasi yang boleh jadi titik mendarat. `project`/`review` bergantung pada state
// transien (`proj`/`review`) yang tak ikut dipulihkan — memulihkannya = mendarat di layar kosong.
export const NAV_KEYS: string[] = HN_NAV.map((n) => n.key);
```

Lalu tambahkan `NAV_KEYS` ke re-export `src/src/ds/index.ts` baris 11:

```ts
export { Shell, HN_NAV, NAV_KEYS } from "./shell";
```

Catatan: baris 11 saat ini berbunyi `export { Shell } from "./shell";` — ganti seluruhnya dengan baris di atas.

- [ ] **Step 4: Persist state App**

Di `src/src/App.tsx`, tambahkan impor (di dekat impor `deeplink` baris 20):

```tsx
import { usePersistedState, pruneUiState, oneOf, isStr } from "./ui-state";
```

`App.tsx:7` sudah mengimpor dari `"./ds"` — tambahkan `NAV_KEYS` ke daftar named import di
baris itu, jangan tulis baris impor kedua.

Ganti empat deklarasi state berikut:

```tsx
  const [section, setSection] = React.useState("overview");
```
menjadi:
```tsx
  // SPEC-740 · ADR-0115 · halaman terakhir yang dibuka ikut dipulihkan; refresh tak lagi
  // melempar balik ke Overview. Guard NAV_KEYS menutup section transien (project/review)
  // dan key yang sudah tak ada (`runs`/`triggers`, SPEC-162).
  const [section, setSection] = usePersistedState("app", "section", "overview", oneOf(...NAV_KEYS));
```

```tsx
  const [projectId, setProjectId] = React.useState("");
```
menjadi:
```tsx
  const [projectId, setProjectId] = usePersistedState("app", "projectId", "", isStr);
```

```tsx
  const [projectFilter, setProjectFilter] = React.useState("all");
```
menjadi:
```tsx
  const [projectFilter, setProjectFilter] = usePersistedState("app", "projectFilter", "all", isStr);
```

```tsx
  const [search, setSearch] = React.useState("");
```
menjadi:
```tsx
  // Kotak pencarian di topbar hanya dipakai layar Projects — kuncinya ikut layar itu,
  // meski state-nya hidup di App.
  const [search, setSearch] = usePersistedState("projects", "q", "", isStr);
```

Tambahkan prune sekali saat mount, tepat di bawah `React.useEffect(() => { api.authStatus()… }, []);`:

```tsx
  // State dari versi kunci lama tak pernah dibaca lagi (versi hidup di dalam kunci) —
  // disapu sekali di sini supaya storage tak tumbuh selamanya.
  React.useEffect(() => { pruneUiState(); }, []);
```

- [ ] **Step 5: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/app-state-persist.test.tsx`
Expected: PASS, 5 test.

- [ ] **Step 6: Test tetangga App tetap hijau**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/app-flows.test.tsx test/app-states.test.tsx test/changelog-nav.test.tsx test/backlog-deeplink.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/src/App.tsx src/src/ds/shell.tsx src/src/ds/index.ts src/test/app-state-persist.test.tsx
git commit -m "feat(spec-740): App mengingat halaman terakhir, project, dan filter project"
```

---

### Task 6: `Shell` memulihkan scroll `<main>` per halaman

**Files:**
- Modify: `src/src/ds/shell.tsx` (fungsi `Shell`, elemen `<main>` baris ±154)
- Test: `src/test/shell-scroll-restore.test.tsx`

**Interfaces:**
- Consumes: `useScrollRestore` dari `../ui-state`
- Produces: `<main data-testid="shell-main">` ber-ref pemulih scroll, berkunci `screen = "page@<active>"`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/shell-scroll-restore.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { Shell } from "../src/ds";
import { uiKey, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listNotifications: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
    },
  };
});
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));

beforeEach(() => localStorage.clear());

const frame = async () => { await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); }); };

function fake(el: HTMLElement) {
  let top = 0;
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = Math.max(0, Math.min(v, 1600)); } });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 2000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 400 });
}

describe("scroll halaman", () => {
  it("disimpan per section dan dipulihkan saat kembali", async () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const main = screen.getByTestId("shell-main");
    fake(main);
    main.scrollTop = 720;
    fireEvent.scroll(main);
    await frame();
    expect(readUiState(uiKey("page@backlog", "scroll"), 0)).toBe(720);

    cleanup();
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const again = screen.getByTestId("shell-main");
    fake(again);
    await frame();
    expect(again.scrollTop).toBe(720);
  });

  it("tiap section punya posisinya sendiri", async () => {
    render(<Shell active="backlog" title="Backlog">isi</Shell>);
    const main = screen.getByTestId("shell-main");
    fake(main);
    main.scrollTop = 300;
    fireEvent.scroll(main);
    await frame();
    cleanup();

    render(<Shell active="triage" title="Triase">isi</Shell>);
    const other = screen.getByTestId("shell-main");
    fake(other);
    await frame();
    expect(other.scrollTop).toBe(0);
    expect(readUiState(uiKey("page@backlog", "scroll"), 0)).toBe(300);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/shell-scroll-restore.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="shell-main"]`.

- [ ] **Step 3: Tulis implementasi**

Di `src/src/ds/shell.tsx`, tambahkan impor di bawah impor `AccountMenu`. Ambil dari
`../ui-state/hooks`, **bukan** dari barrel `../ui-state`: barrel itu memuat
`ResetViewButton` yang mengimpor komponen DS, dan lewat sana `ds → shell → ui-state → ds`
jadi lingkaran impor.

```tsx
import { useScrollRestore } from "../ui-state/hooks";
```

Di dalam `Shell`, sebelum `return (`, tambahkan:

```tsx
  // SPEC-740 · ADR-0115 · scroll tingkat-halaman dipulihkan dari SATU titik: tiap layar —
  // termasuk yang belum ada — ikut dapat perilakunya tanpa menyentuh kodenya. Kunci per
  // `active` supaya posisi Backlog tak terbawa ke Triase.
  const mainRef = useScrollRestore(`page@${active ?? "-"}`, "scroll");
```

Ganti pembuka elemen `<main>`:

```tsx
        <main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
```
menjadi:
```tsx
        <main ref={mainRef} data-testid="shell-main" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/shell-scroll-restore.test.tsx`
Expected: PASS, 2 test.

- [ ] **Step 5: Commit**

```bash
git add src/src/ds/shell.tsx src/test/shell-scroll-restore.test.tsx
git commit -m "feat(spec-740): Shell memulihkan scroll halaman per section"
```

---

### Task 7: Backlog — filter, paginasi, seleksi, scroll, reset

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (baris ±733–761 state; ±801–832 baris penyaring; ±848–867 container daftar)
- Test: `src/test/backlog-state-persist.test.tsx`

**Interfaces:**
- Consumes: `usePersistedState`, `useScrollRestore`, `ResetViewButton`, `oneOf`, `isStr`, `isNum`, `nullableStr` dari `../ui-state`
- Produces: kunci `hn.ui.v1.backlog.{tab,view,q,stage,prio,dateField,from,to,page,detailId,scroll}`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/backlog-state-persist.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listSpecs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
    },
  };
});

import { BacklogScreen } from "../src/screens/BacklogScreen";

const projects = [{ id: "erp", name: "ERP" }] as any[];
const props = {
  backlog: [] as any[], projects, pageSize: 20,
  projectFilter: "all", onProjectFilter: () => {},
};

beforeEach(() => localStorage.clear());

describe("state tampilan Backlog", () => {
  it("kata kunci, stage, dan prioritas bertahan lintas unmount/remount", async () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Cari backlog"), { target: { value: "invoice" } });
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "executing" } });
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    await waitFor(() => expect(readUiState(uiKey("backlog", "q"), "")).toBe("invoice"));

    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect((screen.getByLabelText("Cari backlog") as HTMLInputElement).value).toBe("invoice");
    expect((screen.getByLabelText("Filter stage") as HTMLSelectElement).value).toBe("executing");
    expect((screen.getByLabelText("Filter prioritas") as HTMLSelectElement).value).toBe("tinggi");
  });

  it("rentang tanggal bertahan", async () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Tanggal dari"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(readUiState(uiKey("backlog", "from"), "")).toBe("2026-08-01"));
    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect((screen.getByLabelText("Tanggal dari") as HTMLInputElement).value).toBe("2026-08-01");
  });

  it("lencana filter aktif menyala dan Reset tampilan mengembalikan default", async () => {
    render(<BacklogScreen {...(props as any)} />);
    expect(screen.queryByText(/filter aktif/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    expect(screen.getByText("1 filter aktif")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect((screen.getByLabelText("Filter prioritas") as HTMLSelectElement).value).toBe("all");
    expect(screen.queryByText(/filter aktif/)).toBeNull();
    expect(readUiState(uiKey("backlog", "prio"), "all")).toBe("all");
  });

  it("mode tampilan bertahan", () => {
    render(<BacklogScreen {...(props as any)} />);
    fireEvent.click(screen.getByText("List"));
    cleanup();
    render(<BacklogScreen {...(props as any)} />);
    expect(readUiState(uiKey("backlog", "view"), "grid")).toBe("list");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/backlog-state-persist.test.tsx`
Expected: FAIL — nilai tak bertahan sesudah remount; `Reset tampilan` tak ditemukan.

- [ ] **Step 3: Tulis implementasi**

Tambah impor di `src/src/screens/BacklogScreen.tsx` (di bawah impor `ChangeSourceDialog`):

```tsx
import {
  usePersistedState, useScrollRestore, ResetViewButton, oneOf, isStr, isNum, nullableStr,
} from "../ui-state";
```

Ganti blok state (baris ±733–761) — **`syncNonce` dan `data` tetap `React.useState`** (bukan state tampilan):

```tsx
  const [tab, setTab] = React.useState("all");
```
→
```tsx
  // SPEC-740 · ADR-0115 · seluruh state tampilan layar ini persisten berkunci `backlog`.
  const [tab, setTab] = usePersistedState("backlog", "tab", "all", isStr);
```

```tsx
  const [view, setView] = React.useState("grid");
```
→
```tsx
  const [view, setView] = usePersistedState("backlog", "view", "grid", oneOf("grid", "list", "board"));
```

```tsx
  const [q, setQ] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState("all");
  const [prioFilter, setPrioFilter] = React.useState("all");
```
→
```tsx
  const [q, setQ] = usePersistedState("backlog", "q", "", isStr);
  const [stageFilter, setStageFilter] = usePersistedState("backlog", "stage", "all", isStr);
  const [prioFilter, setPrioFilter] = usePersistedState("backlog", "prio", "all", isStr);
```

```tsx
  const [dateField, setDateField] = React.useState<"created" | "started">("created");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
```
→
```tsx
  const [dateField, setDateField] = usePersistedState<"created" | "started">(
    "backlog", "dateField", "created", oneOf("created", "started"));
  const [from, setFrom] = usePersistedState("backlog", "from", "", isStr);
  const [to, setTo] = usePersistedState("backlog", "to", "", isStr);
```

```tsx
  const [detailId, setDetailId] = React.useState<string | null>(null);
```
→
```tsx
  const [detailId, setDetailId] = usePersistedState<string | null>("backlog", "detailId", null, nullableStr);
```

```tsx
  const [page, setPage] = React.useState(1);
```
→
```tsx
  // Yang dipulihkan `page`, BUKAN `limit` — `limit` tanpa `page` berperilaku sebagai
  // PLAFON (SPEC-523 · ADR-0107). `pageSize` tetap prop konstanta.
  const [page, setPage] = usePersistedState("backlog", "page", 1, isNum);
```

Tepat di bawah `const [dq, setDq] = React.useState("");`, tambahkan penghitung filter aktif, ref scroll, dan reset:

```tsx
  // Filter yang dipulihkan wajib TERLIHAT menyala: daftar yang tampak kosong tak boleh
  // terbaca sebagai backlog kosong.
  const activeFilters = [
    tab !== "all", proj !== "all", q.trim() !== "", stageFilter !== "all",
    prioFilter !== "all", from !== "", to !== "",
  ].filter(Boolean).length;
  // Scroll dipulihkan sesudah potongan pertama dari server mendarat — sebelum itu tinggi
  // daftar belum final dan posisinya meleset.
  const listRef = useScrollRestore("backlog", "scroll", data.items.length > 0);
  // `proj` dimiliki App (SPEC-146) sehingga di luar jangkauan resetUiState("backlog").
  const resetView = () => setProj("all");
```

Sisipkan `<ResetViewButton>` di baris kanan-atas, di dalam `<div style={{ display: "flex", alignItems: "center", gap: 10 }}>` (baris ±801), tepat sebelum `<span className="hn-eyebrow">{data.total} spec</span>`:

```tsx
            <ResetViewButton screen="backlog" active={activeFilters} onReset={resetView} />
```

Pasang ref pada kedua container daftar. Ganti:

```tsx
            <div style={{
              ...LIST_SCROLL_STYLE, border: "1px solid var(--border-hair)",
              borderRadius: "var(--radius-lg)", overflowX: "hidden"
            }}>
```
→
```tsx
            <div ref={listRef} data-testid="backlog-scroll" style={{
              ...LIST_SCROLL_STYLE, border: "1px solid var(--border-hair)",
              borderRadius: "var(--radius-lg)", overflowX: "hidden"
            }}>
```

dan:

```tsx
            <div style={{
              ...LIST_SCROLL_STYLE, display: "grid", gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))"
            }}>
```
→
```tsx
            <div ref={listRef} data-testid="backlog-scroll" style={{
              ...LIST_SCROLL_STYLE, display: "grid", gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))"
            }}>
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/backlog-state-persist.test.tsx`
Expected: PASS, 4 test.

- [ ] **Step 5: Test Backlog yang sudah ada tetap hijau**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/backlog-board.test.tsx test/backlog-date-filter.test.tsx test/backlog-deeplink.test.tsx test/backlog-dependency.test.tsx test/backlog-goal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/test/backlog-state-persist.test.tsx
git commit -m "feat(spec-740): Backlog mengingat filter, paginasi, seleksi, dan scroll"
```

---

### Task 8: Triase — tab, filter, paginasi, tiket terbuka, scroll, reset

**Files:**
- Modify: `src/src/screens/TriageScreen.tsx` (baris ±329–341 state; ±376–391 baris penyaring; ±398 container daftar)
- Test: `src/test/triage-state-persist.test.tsx`

**Interfaces:**
- Consumes: `usePersistedState`, `useScrollRestore`, `ResetViewButton`, `oneOf`, `isStr`, `isNum`, `nullableStr` dari `../ui-state`
- Produces: kunci `hn.ui.v1.triage.{tab,project,status,q,page,openId,scroll}`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/triage-state-persist.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listTickets: vi.fn().mockResolvedValue({ items: [], total: 0, unreviewed: 0 }),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
    },
  };
});

import { TriageScreen } from "../src/screens/TriageScreen";

const projects = [{ id: "erp", name: "ERP" }] as any[];
const props = { projects, onAccepted: () => {}, onToast: () => {} };

beforeEach(() => localStorage.clear());

describe("state tampilan Triase", () => {
  it("filter status & project bertahan lintas unmount/remount", async () => {
    render(<TriageScreen {...(props as any)} />);
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "erp" } });
    fireEvent.change(selects[1]!, { target: { value: "accepted" } });
    await waitFor(() => expect(readUiState(uiKey("triage", "status"), "")).toBe("accepted"));

    cleanup();
    render(<TriageScreen {...(props as any)} />);
    const again = screen.getAllByRole("combobox");
    expect((again[0] as HTMLSelectElement).value).toBe("erp");
    expect((again[1] as HTMLSelectElement).value).toBe("accepted");
  });

  it("tab yang aktif bertahan", async () => {
    render(<TriageScreen {...(props as any)} />);
    fireEvent.click(screen.getByText("Issue GitHub"));
    await waitFor(() => expect(readUiState(uiKey("triage", "tab"), "tiket")).toBe("issue"));
    cleanup();
    render(<TriageScreen {...(props as any)} />);
    expect(screen.getByText("Pilih satu project")).toBeTruthy();
  });

  it("Reset tampilan mengembalikan penyaring ke default", async () => {
    render(<TriageScreen {...(props as any)} />);
    fireEvent.change(screen.getAllByRole("combobox")[1]!, { target: { value: "rejected" } });
    expect(screen.getByText("1 filter aktif")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("");
    expect(screen.queryByText(/filter aktif/)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/triage-state-persist.test.tsx`
Expected: FAIL — nilai tak bertahan; `Reset tampilan` tak ditemukan.

- [ ] **Step 3: Tulis implementasi**

Tambah impor di `src/src/screens/TriageScreen.tsx` (di bawah impor `SyncButton`):

```tsx
import {
  usePersistedState, useScrollRestore, ResetViewButton, oneOf, isStr, isNum, nullableStr,
} from "../ui-state";
```

Ganti state di `TriageScreen` (baris ±331–340):

```tsx
  const [page, setPage] = React.useState(1);
```
→
```tsx
  const [page, setPage] = usePersistedState("triage", "page", 1, isNum);
```

```tsx
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [project, setProject] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
```
→
```tsx
  // SPEC-740 · ADR-0115 · seluruh state tampilan layar ini persisten berkunci `triage`.
  const [openId, setOpenId] = usePersistedState<string | null>("triage", "openId", null, nullableStr);
  const [project, setProject] = usePersistedState("triage", "project", "", isStr);
  const [status, setStatus] = usePersistedState("triage", "status", "", isStr);
  const [q, setQ] = usePersistedState("triage", "q", "", isStr);
```

```tsx
  const [tab, setTab] = React.useState<"tiket" | "issue">("tiket");
```
→
```tsx
  const [tab, setTab] = usePersistedState<"tiket" | "issue">("triage", "tab", "tiket", oneOf("tiket", "issue"));
```

Tepat di bawah baris `const [tab, setTab] = …`, tambahkan:

```tsx
  const activeFilters = [project !== "", status !== "", q.trim() !== ""].filter(Boolean).length;
  // Daftar tiket baru punya tinggi final sesudah potongan pertama mendarat.
  const listRef = useScrollRestore("triage", "scroll", list.length > 0);
```

Sisipkan `<ResetViewButton>` di baris penyaring, di dalam blok `{tab === "tiket" && <>…</>}` tepat sesudah `<SyncButton … />`:

```tsx
          <ResetViewButton screen="triage" active={activeFilters} />
```

Pasang ref pada container daftar. Ganti:

```tsx
            <div style={{ overflowY: "auto", minHeight: 0 }}>
```
→
```tsx
            <div ref={listRef} data-testid="triage-scroll" style={{ overflowY: "auto", minHeight: 0 }}>
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/triage-state-persist.test.tsx`
Expected: PASS, 3 test.

- [ ] **Step 5: Test Triase yang sudah ada tetap hijau**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/triage-screen.test.tsx test/github-issues.test.tsx`
Expected: PASS. (Bila salah satu berkas tak ada, jalankan `ls src/test | grep -i -E "triage|issue"` dan pakai daftar yang benar-benar ada.)

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/TriageScreen.tsx src/test/triage-state-persist.test.tsx
git commit -m "feat(spec-740): Triase mengingat tab, filter, paginasi, tiket terbuka, scroll"
```

---

### Task 9: Projects, PRD, Changelog

**Files:**
- Modify: `src/src/screens/ProjectsScreen.tsx` (baris ±102 `page`; ±124 container daftar)
- Modify: `src/src/screens/PrdScreen.tsx` (baris ±256 `sel`, ±260 `statusFilter`; baris penyaring ±284)
- Modify: `src/src/screens/ChangelogScreen.tsx` (baris ±51–56)
- Test: `src/test/screens-state-persist.test.tsx`

**Interfaces:**
- Consumes: `usePersistedState`, `useScrollRestore`, `ResetViewButton`, `scoped`, `isStr`, `isNum`, `nullableStr` dari `../ui-state`
- Produces: kunci `hn.ui.v1.projects.{page,scroll}`, `hn.ui.v1.prd.{status,sel}`, `hn.ui.v1.changelog@<projectId>.{q,page,selectedId}`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/screens-state-persist.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, scoped, readUiState, writeUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listAllPrds: vi.fn().mockResolvedValue({ items: [] }),
      listPrds: vi.fn().mockResolvedValue({ items: [] }),
      listChangelog: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getChangelogSources: vi.fn().mockResolvedValue({ modes: [] }),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
    },
  };
});

import { PrdScreen } from "../src/screens/PrdScreen";
import { ChangelogScreen } from "../src/screens/ChangelogScreen";

beforeEach(() => localStorage.clear());

const projects = [{ id: "erp", name: "ERP" }, { id: "crm", name: "CRM" }] as any[];

describe("state tampilan PRD", () => {
  it("filter status bertahan lintas unmount/remount", async () => {
    const props = { projects, projectFilter: "all", onProjectFilter: () => {},
      onNewPrd: () => {}, onTakeToBacklog: () => {}, onStartBreakdown: () => {}, onMaterialize: () => {} };
    render(<PrdScreen {...(props as any)} />);
    fireEvent.change(screen.getByLabelText("Status PRD"), { target: { value: "draft" } });
    await waitFor(() => expect(readUiState(uiKey("prd", "status"), "all")).toBe("draft"));
    cleanup();
    render(<PrdScreen {...(props as any)} />);
    expect((screen.getByLabelText("Status PRD") as HTMLSelectElement).value).toBe("draft");
  });
});

describe("state tampilan Changelog", () => {
  it("pencarian ber-scope project — project lain tak terkena", async () => {
    render(<ChangelogScreen p={projects[0]} onToast={() => {}} />);
    fireEvent.change(screen.getByLabelText("Cari rilis"), { target: { value: "rilis" } });
    await waitFor(() => expect(readUiState(uiKey(scoped("changelog", "erp"), "q"), "")).toBe("rilis"));
    expect(readUiState(uiKey(scoped("changelog", "crm"), "q"), "")).toBe("");
  });

  it("pencarian project lain dipulihkan saat project berganti", async () => {
    writeUiState(uiKey(scoped("changelog", "crm"), "q"), "milik-crm");
    const { rerender } = render(<ChangelogScreen p={projects[0]} onToast={() => {}} />);
    expect((screen.getByLabelText("Cari rilis") as HTMLInputElement).value).toBe("");
    rerender(<ChangelogScreen p={projects[1]} onToast={() => {}} />);
    expect((screen.getByLabelText("Cari rilis") as HTMLInputElement).value).toBe("milik-crm");
  });
});
```

Catatan: input pencarian Changelog sudah punya `aria-label="Cari rilis"` (`ChangelogScreen.tsx:105`) — tak perlu ditambahkan.

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/screens-state-persist.test.tsx`
Expected: FAIL — nilai tak bertahan sesudah remount.

- [ ] **Step 3: Tulis implementasi**

**ProjectsScreen** — tambah impor:

```tsx
import { usePersistedState, useScrollRestore, isNum } from "../ui-state";
```

Ganti:
```tsx
  const [page, setPage] = React.useState(1);
```
→
```tsx
  // SPEC-740 · ADR-0115 · nomor halaman & posisi scroll bertahan; `pageSize` tetap prop.
  const [page, setPage] = usePersistedState("projects", "page", 1, isNum);
  const listRef = useScrollRestore("projects", "scroll", rows.length > 0);
```

Ganti container daftar:
```tsx
          <div style={LIST_SCROLL_STYLE}>
```
→
```tsx
          <div ref={listRef} data-testid="projects-scroll" style={LIST_SCROLL_STYLE}>
```

**PrdScreen** — tambah impor:

```tsx
import { usePersistedState, ResetViewButton, oneOf, nullableStr } from "../ui-state";
```

Ganti:
```tsx
  const [sel, setSel] = React.useState<PrdDoc | null>(null);
```
→
```tsx
  // Yang disimpan slug-nya saja, bukan dokumennya: storage hanya untuk parameter tampilan.
  const [selSlug, setSelSlug] = usePersistedState<string | null>("prd", "sel", null, nullableStr);
  const sel = React.useMemo(() => items.find((p) => p.slug === selSlug) ?? null, [items, selSlug]);
  const setSel = React.useCallback((p: PrdDoc | null) => setSelSlug(p ? p.slug : null), [setSelSlug]);
```

Ganti:
```tsx
  const [statusFilter, setStatusFilter] = React.useState<"all" | PrdStatus>("all");
```
→
```tsx
  // Guard ketat dari katalog yang sudah diimpor berkas ini — status yang sudah tak ada
  // di `PRD_STATUSES` jatuh ke "all", bukan menyaring daftar jadi kosong tanpa sebab.
  const [statusFilter, setStatusFilter] = usePersistedState<"all" | PrdStatus>(
    "prd", "status", "all", oneOf<"all" | PrdStatus>("all", ...PRD_STATUSES));
```

Sisipkan `<ResetViewButton>` di baris penyaring, tepat sesudah `<Select … aria-label="Status PRD" … />`:

```tsx
          <ResetViewButton screen="prd" active={statusFilter === "all" ? 0 : 1} />
```

**ChangelogScreen** — tambah impor:

```tsx
import { usePersistedState, scoped, isStr, isNum, nullableStr } from "../ui-state";
```

Ganti blok state (baris ±52–56):
```tsx
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState("");
```
→
```tsx
  // SPEC-740 · ADR-0115 · ber-scope project: pencarian project A tak boleh muncul di B.
  const ui = scoped("changelog", p.id);
  const [page, setPage] = usePersistedState(ui, "page", 1, isNum);
  const [q, setQ] = usePersistedState(ui, "q", "", isStr);
```

```tsx
  const [selected, setSelected] = React.useState<ChangelogView | null>(null);
```
→
```tsx
  const [selectedId, setSelectedId] = usePersistedState<string | null>(ui, "selectedId", null, nullableStr);
  const selected = React.useMemo(() => items.find((c) => c.id === selectedId) ?? null, [items, selectedId]);
  const setSelected = React.useCallback(
    (c: ChangelogView | null) => setSelectedId(c ? c.id : null), [setSelectedId]);
```

Input pencarian layar itu sudah ber-`aria-label="Cari rilis"` — biarkan apa adanya.

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/screens-state-persist.test.tsx`
Expected: PASS, 3 test.

- [ ] **Step 5: Test tetangga tetap hijau**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/changelog-screen.test.tsx test/changelog-panel.test.tsx test/prd-status.test.tsx test/projects-screen.test.tsx`
Expected: PASS. (Sesuaikan daftar dengan `ls src/test | grep -i -E "changelog|prd|project"`.)

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/ProjectsScreen.tsx src/src/screens/PrdScreen.tsx src/src/screens/ChangelogScreen.tsx src/test/screens-state-persist.test.tsx
git commit -m "feat(spec-740): Projects, PRD, dan Changelog mengingat state tampilannya"
```

---

### Task 10: Scheduler & Lead

**Files:**
- Modify: `src/src/screens/SchedulerScreen.tsx` (`QueueSection`, baris ±177)
- Modify: `src/src/screens/SchedulerCrons.tsx` (baris ±103, ±108; baris ±66)
- Modify: `src/src/screens/LeadScreen.tsx` (baris ±277–283; baris penyaring ±463)
- Test: `src/test/scheduler-lead-state-persist.test.tsx`

**Interfaces:**
- Consumes: `usePersistedState`, `ResetViewButton`, `isStr`, `isNum`, `nullableStr` dari `../ui-state`
- Produces: kunci `hn.ui.v1.scheduler.{queue-<status>-page,cronProject,cronRunsPage,cronOpenRuns}`, `hn.ui.v1.lead.{filter,decPage,flowPage}`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/scheduler-lead-state-persist.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      getLeadStatus: vi.fn().mockResolvedValue({ enabled: false, projects: [], config: {} }),
      getLeadDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getLeadFlows: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
    },
  };
});

import { LeadScreen } from "../src/screens/LeadScreen";

const projects = [{ id: "erp", name: "ERP" }] as any[];

beforeEach(() => localStorage.clear());

describe("state tampilan Lead", () => {
  it("penyaring project bertahan lintas unmount/remount", async () => {
    const props = { projects, onProjectChanged: () => {}, onToast: () => {}, onGotoTerminal: () => {} };
    render(<LeadScreen {...(props as any)} />);
    fireEvent.change(await screen.findByLabelText("saring project"), { target: { value: "erp" } });
    await waitFor(() => expect(readUiState(uiKey("lead", "filter"), "all")).toBe("erp"));
    cleanup();
    render(<LeadScreen {...(props as any)} />);
    expect(((await screen.findByLabelText("saring project")) as HTMLSelectElement).value).toBe("erp");
  });

  it("Reset tampilan mengembalikan penyaring ke semua project", async () => {
    const props = { projects, onProjectChanged: () => {}, onToast: () => {}, onGotoTerminal: () => {} };
    render(<LeadScreen {...(props as any)} />);
    fireEvent.change(await screen.findByLabelText("saring project"), { target: { value: "erp" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect(((await screen.findByLabelText("saring project")) as HTMLSelectElement).value).toBe("all");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/scheduler-lead-state-persist.test.tsx`
Expected: FAIL — penyaring tak bertahan; `Reset tampilan` tak ditemukan.

- [ ] **Step 3: Tulis implementasi**

**LeadScreen** — tambah impor:

```tsx
import { usePersistedState, ResetViewButton, isStr, isNum } from "../ui-state";
```

Ganti:
```tsx
  const [decPage, setDecPage] = React.useState(1);
```
→
```tsx
  const [decPage, setDecPage] = usePersistedState("lead", "decPage", 1, isNum);
```

```tsx
  const [flowPage, setFlowPage] = React.useState(1);
```
→
```tsx
  const [flowPage, setFlowPage] = usePersistedState("lead", "flowPage", 1, isNum);
```

```tsx
  const [filter, setFilter] = React.useState("all");
```
→
```tsx
  // SPEC-740 · ADR-0115 · penyaring project & nomor halaman kedua daftar bertahan.
  const [filter, setFilter] = usePersistedState("lead", "filter", "all", isStr);
```

Sisipkan `<ResetViewButton>` tepat sesudah `<Select size="sm" value={filter} aria-label="saring project" … />`:

```tsx
          <ResetViewButton screen="lead" active={filter === "all" ? 0 : 1} />
```

**SchedulerScreen** — tambah impor:

```tsx
import { usePersistedState, isNum } from "../ui-state";
```

Di `QueueSection`, ganti:
```tsx
  const [page, setPage] = React.useState(1);
```
→
```tsx
  // Tiga seksi antrean memakai komponen yang SAMA — kuncinya wajib memuat `status`,
  // kalau tidak ketiganya berbagi satu nomor halaman.
  const [page, setPage] = usePersistedState("scheduler", `queue-${status}-page`, 1, isNum);
```

**SchedulerCrons** — tambah impor:

```tsx
import { usePersistedState, isNum, isStr, nullableStr } from "../ui-state";
```

Ganti (baris ±66, di komponen daftar riwayat run):
```tsx
  const [page, setPage] = React.useState(1);
```
→
```tsx
  const [page, setPage] = usePersistedState("scheduler", "cronRunsPage", 1, isNum);
```

Ganti (baris ±103):
```tsx
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
```
→
```tsx
  const [projectId, setProjectId] = usePersistedState("scheduler", "cronProject", projects[0]?.id ?? "", isStr);
```

Ganti (baris ±108):
```tsx
  const [openRuns, setOpenRuns] = React.useState<string | null>(null);
```
→
```tsx
  const [openRuns, setOpenRuns] = usePersistedState<string | null>("scheduler", "cronOpenRuns", null, nullableStr);
```

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/scheduler-lead-state-persist.test.tsx`
Expected: PASS, 2 test.

- [ ] **Step 5: Test tetangga tetap hijau**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/SchedulerCrons.test.tsx test/scheduler-panel.test.tsx test/lead-screen.test.tsx`
Expected: PASS. (Sesuaikan daftar dengan `ls src/test src/src/screens | grep -i -E "scheduler|lead"` — `SchedulerCrons.test.tsx` ada di `src/src/screens/`.)

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/SchedulerScreen.tsx src/src/screens/SchedulerCrons.tsx src/src/screens/LeadScreen.tsx src/test/scheduler-lead-state-persist.test.tsx
git commit -m "feat(spec-740): Scheduler & Lead mengingat penyaring dan paginasi"
```

---

### Task 11: IDE, Docs, Terminal, VPS, Settings

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx` (baris ±83–101)
- Modify: `src/src/screens/DocsWorkspace.tsx` (baris ±98)
- Modify: `src/src/screens/TerminalScreen.tsx` (baris ±28)
- Modify: `src/src/screens/VpsScreen.tsx` (baris ±83)
- Modify: `src/src/screens/SettingsScreen.tsx` (baris ±500)
- Test: `src/test/workspace-state-persist.test.tsx`

**Interfaces:**
- Consumes: `usePersistedState`, `scoped`, `isStr`, `oneOf`, `nullableStr` dari `../ui-state`
- Produces: kunci `hn.ui.v1.ide@<projectId>.{tab,viewRef,selected,selKind,mdView,stagedView,changedView,diffTab}`, `hn.ui.v1.docs@<projectId>.selected`, `hn.ui.v1.terminal.project`, `hn.ui.v1.vps.detailId`, `hn.ui.v1.settings.tab`

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/workspace-state-persist.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { uiKey, readUiState } from "../src/ui-state";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      getSettings: vi.fn().mockResolvedValue({}),
      getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0" }),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
      getTelegramStatus: vi.fn().mockResolvedValue(null),
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listUsers: vi.fn().mockResolvedValue([]),
      listDeviceTokens: vi.fn().mockResolvedValue([]),
      listAgentTokens: vi.fn().mockResolvedValue([]),
      getCapabilities: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ entries: [] }),
    },
  };
});
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));

import { SettingsScreen } from "../src/screens/SettingsScreen";

beforeEach(() => localStorage.clear());

describe("sub-tab Settings", () => {
  it("bertahan lintas unmount/remount", async () => {
    const me = { id: "u1", email: "a@b.c", role: "admin" } as any;
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    fireEvent.click(await screen.findByText("Sesi"));
    await waitFor(() => expect(readUiState(uiKey("settings", "tab"), "akun")).toBe("sesi"));
    cleanup();
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    await waitFor(() => expect(readUiState(uiKey("settings", "tab"), "akun")).toBe("sesi"));
  });
});
```

Catatan: label tab Settings dibaca dari sumbernya saat implementasi — bila label persisnya bukan `"Sesi"`, pakai label yang benar-benar dirender (`rg 'value: "sesi"' -n src/src/screens/SettingsScreen.tsx`).

- [ ] **Step 2: Jalankan test — pastikan GAGAL**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/workspace-state-persist.test.tsx`
Expected: FAIL — `readUiState(uiKey("settings","tab"))` tetap `"akun"`.

- [ ] **Step 3: Tulis implementasi**

**SettingsScreen** — tambah impor `import { usePersistedState, isStr } from "../ui-state";` lalu ganti:

```tsx
  const [tab, setTab] = React.useState<string>("akun");
```
→
```tsx
  // SPEC-740 · ADR-0115 · sub-tab aktif bertahan; refresh tak melempar balik ke Akun.
  const [tab, setTab] = usePersistedState<string>("settings", "tab", "akun", isStr);
```

**TerminalScreen** — tambah impor `import { usePersistedState, isStr } from "../ui-state";` lalu ganti:

```tsx
  const [project, setProject] = React.useState(projects[0]?.id ?? "");
```
→
```tsx
  const [project, setProject] = usePersistedState("terminal", "project", projects[0]?.id ?? "", isStr);
```

(Workspace grid **tidak** dipindahkan — ia sudah persisten di kunci `hanoman.terminal.workspace`; memindahkannya membuang state pengguna yang sudah ada.)

**VpsScreen** — tambah impor `import { usePersistedState, nullableStr } from "../ui-state";` lalu ganti:

```tsx
  const [detailVps, setDetailVps] = React.useState<VpsView | null>(null);
```
→
```tsx
  // Yang disimpan id-nya; barisnya diresolusi ulang dari daftar hidup supaya modal tak
  // pernah merender snapshot basi.
  const [detailId, setDetailId] = usePersistedState<string | null>("vps", "detailId", null, nullableStr);
  const detailVps = React.useMemo(() => list.find((v) => v.id === detailId) ?? null, [list, detailId]);
  const setDetailVps = React.useCallback((v: VpsView | null) => setDetailId(v ? v.id : null), [setDetailId]);
```

**DocsWorkspace** — tambah impor `import { usePersistedState, scoped, isStr } from "../ui-state";` lalu ganti:

```tsx
  const [selected, setSelected] = React.useState("");
```
→
```tsx
  // Ber-scope project: dokumen yang dibuka di project A tak boleh muncul di project B.
  const [selected, setSelected] = usePersistedState(scoped("docs", projectId), "selected", "", isStr);
```

**IdeScreen** — tambah impor:

```tsx
import { usePersistedState, scoped, isStr, oneOf } from "../ui-state";
```

Tepat di atas blok state layar, tambahkan:

```tsx
  // SPEC-740 · ADR-0115 · seluruh state tampilan IDE ber-scope project — tab, ref yang
  // dilihat, berkas terpilih, dan mode tiap pane.
  const ui = scoped("ide", projectId);
```

Lalu ganti:

```tsx
  const [tab, setTab] = React.useState("explorer");
  const [viewRef, setViewRef] = React.useState("");         // branch/ref yang dilihat (kosong = working tree)
```
→
```tsx
  const [tab, setTab] = usePersistedState(ui, "tab", "explorer", isStr);
  const [viewRef, setViewRef] = usePersistedState(ui, "viewRef", "", isStr);   // kosong = working tree
```

```tsx
  const [selected, setSelected] = React.useState("");
  const [selKind, setSelKind] = React.useState<"file" | "staged" | "unstaged">("file"); // sumber seleksi → viewer vs diff
```
→
```tsx
  const [selected, setSelected] = usePersistedState(ui, "selected", "", isStr);
  const [selKind, setSelKind] = usePersistedState<"file" | "staged" | "unstaged">(
    ui, "selKind", "file", oneOf("file", "staged", "unstaged"));   // sumber seleksi → viewer vs diff
```

```tsx
  const [mdView, setMdView] = React.useState<"preview" | "source">("preview"); // SPEC-240 · .md preview vs source
```
→
```tsx
  const [mdView, setMdView] = usePersistedState<"preview" | "source">(
    ui, "mdView", "preview", oneOf("preview", "source"));   // SPEC-240 · .md preview vs source
```

```tsx
  const [stagedView, setStagedView] = React.useState<"list" | "tree">("list");
  const [changedView, setChangedView] = React.useState<"list" | "tree">("list");
```
→
```tsx
  const [stagedView, setStagedView] = usePersistedState<"list" | "tree">(ui, "stagedView", "list", oneOf("list", "tree"));
  const [changedView, setChangedView] = usePersistedState<"list" | "tree">(ui, "changedView", "list", oneOf("list", "tree"));
```

```tsx
  const [diffTab, setDiffTab] = React.useState<"diff" | "source">("diff");
```
→
```tsx
  const [diffTab, setDiffTab] = usePersistedState<"diff" | "source">(ui, "diffTab", "diff", oneOf("diff", "source"));
```

`mode` (`view`/`edit`) dan `draft` **sengaja tidak** dipersist: draft editor bukan parameter tampilan, dan memulihkan mode edit tanpa draft-nya menyesatkan.

- [ ] **Step 4: Jalankan test — pastikan LULUS**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/workspace-state-persist.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Test tetangga tetap hijau**

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run test/SettingsScreen.test.tsx test/terminal-screen.test.tsx test/ide-screen.test.tsx test/docs-tree.test.ts test/vps-checklist.test.tsx`
Expected: PASS. (Sesuaikan daftar dengan `ls src/test src/src/screens | grep -i -E "settings|terminal|ide|docs|vps"`.)

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/src/screens/DocsWorkspace.tsx src/src/screens/TerminalScreen.tsx src/src/screens/VpsScreen.tsx src/src/screens/SettingsScreen.tsx src/test/workspace-state-persist.test.tsx
git commit -m "feat(spec-740): IDE, Docs, Terminal, VPS, dan Settings mengingat state tampilannya"
```

---

### Task 12: Docs Source of Truth — ADR-0115, index, frontend, SKILL

**Files:**
- Create: `internal/docs/adr/0115-state-tampilan-dashboard-persisten.md`
- Modify: `internal/docs/README.md` (daftar adr, baris 61)
- Modify: `internal/docs/adr/README.md` (narasi ADR)
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/skills/hanoman/SKILL.md` (butir baru di "Aturan Arsitektur")

**Interfaces:**
- Consumes: keputusan dari Task 1–11
- Produces: dokumentasi SoT yang menyebut kunci, guard, gerbang `NAV_KEYS`, dan gotcha

- [ ] **Step 1: Tulis ADR**

Create `internal/docs/adr/0115-state-tampilan-dashboard-persisten.md` dengan bagian:
`# ADR-0115 — State tampilan dashboard persisten di storage, berkunci per layar` ·
`## Status` (Diterima · 2026-08-13 · SPEC-740) ·
`## Konteks` (nav lewat `section` di App, bukan router; tiap layar unmount → seluruh `useState` hilang; keluhan nyata Backlog↔Triase; refresh selalu jatuh ke Overview; `localStorage` hari ini hanya dipakai dua tempat, keduanya menulis try/catch sendiri) ·
`## Keputusan` (satu modul `src/src/ui-state`; kunci `hn.ui.v1.<screen>[@<scope>].<field>`; **versi di dalam kunci**; guard bentuk default = bentuk `fallback`; reset lewat pub/sub karena menghapus kunci saja tak mengembalikan komponen ter-mount; `localStorage` bukan `sessionStorage` karena syaratnya buka-ulang browser; **bukan URL** — keputusan pengguna, link yang bisa dibagikan adalah backlog terpisah) ·
`## Alternatif yang ditolak` (router + query string · satu blob JSON per layar · state di server per user) ·
`## Konsekuensi & gotcha` (lima butir di Step 2) ·
`## Yang tidak berubah` (skema, endpoint, kontrak API, kunci `hanoman.terminal.workspace` & flag Pet).

- [ ] **Step 2: Tulis lima gotcha di ADR**

1. **`usePersistedState` menyimpan nilai BESERTA kuncinya.** Saat scope project berganti, effect penulis akan menyimpan nilai project **lama** di bawah kunci project **baru** bila nilai dan kunci disimpan terpisah — sinkronisasi dilakukan saat render (`if (snap.key !== key) setSnap(…)`), bukan di effect.
2. **Pemulihan scroll wajib membisukan penulisnya.** Menyetel `scrollTop` memancarkan event `scroll`; percobaan pertama (konten masih pendek) akan menulis balik nilai **terpotong** dan menghapus posisi aslinya sebelum konten sempat tumbuh. Karena itu ada penanda `restoring`, dan loop rAF **berbatas** (`RESTORE_FRAMES = 20`).
3. **`section` yang dipulihkan digerbangi `NAV_KEYS`.** `project`/`review` bergantung pada state transien yang tak ikut dipulihkan; key mati (`runs`/`triggers`, SPEC-162) akan membuat App merender kosong berikut sidebar-nya (gotcha SPEC-519).
4. **`limit` tak pernah dipulihkan.** Hanya `page`. `limit` tanpa `page` berperilaku sebagai **PLAFON** (SPEC-523 · ADR-0107), jadi memulihkannya diam-diam mengubah ukuran halaman.
5. **`src/test/setup.ts` wajib mengosongkan `localStorage` tiap test.** vitest memakai satu jsdom per berkas; tanpa itu test pertama yang menyetel filter mewariskannya ke test berikutnya dan kegagalannya terbaca seperti regresi komponen.

- [ ] **Step 3: Tautkan di index**

Di `internal/docs/README.md`, di bawah heading `## adr`, sisipkan **sebagai baris pertama** daftar (di atas baris `- [0114 …]`):

```markdown
- [0115 — State tampilan dashboard persisten: kunci `hn.ui.v1.<screen>.<field>`, satu hook bersama](adr/0115-state-tampilan-dashboard-persisten.md)
```

Di `internal/docs/adr/README.md`, tambahkan narasinya mengikuti format entri 0114 di berkas itu (apa yang diperluas/ditegakkan + gotcha ringkas).

- [ ] **Step 4: Perbarui doc frontend**

Di `internal/docs/frontend/frontend-implementation.md`, tambahkan seksi **"State tampilan persisten (SPEC-740 · ADR-0115)"** berisi: bentuk kunci, tabel screen→field (salin dari design doc `docs/superpowers/specs/2026-08-13-spec-740-state-tampilan-persisten-design.md`), aturan "layar baru wajib memakai `usePersistedState`, bukan `useState`, untuk field tampilan", dan aturan "field baru yang nullable wajib menyebut `nullableStr`".

- [ ] **Step 5: Perbarui SKILL project**

Di `internal/skills/hanoman/SKILL.md`, seksi **Aturan Arsitektur**, tambahkan satu butir setelah butir "Realtime: WebSocket hanya untuk terminal PTY…":

```markdown
- **State tampilan tiap halaman persisten di storage, berkunci per layar** (SPEC-740/**ADR-0115**):
  filter/pencarian, paginasi, posisi scroll, item terpilih & panel terbuka bertahan lintas navigasi
  **dan** refresh, lewat SATU modul `src/src/ui-state` — kunci `hn.ui.v1.<screen>[@<scope>].<field>`,
  versi hidup di dalam kunci, nilai rusak jatuh ke default, `@<scope>` untuk state per-project.
  App ikut menyimpan halaman terakhir (`app.section`), digerbangi `NAV_KEYS` supaya section transien
  (`project`/`review`) & key mati tak jadi titik mendarat. **Empat gotcha:** nilai disimpan BESERTA
  kuncinya (kalau tidak, ganti project menimpa state project lain); pemulihan scroll wajib membisukan
  penulisnya + loop rAF berbatas (kalau tidak, percobaan pertama menulis balik nilai terpotong);
  hanya `page` yang dipulihkan, **tak pernah** `limit` (PLAFON, ADR-0107); dan `src/test/setup.ts`
  wajib mengosongkan `localStorage` tiap test (satu jsdom per berkas → state bocor antar-test).
```

- [ ] **Step 6: Verifikasi integritas index**

Run: `node cli/dist/index.js docs index --check 2>/dev/null || npx tsx cli/src/index.ts docs index --check`
Expected: index konsisten (exit 0). Bila CLI belum ter-build di worktree ini, cukup pastikan tautan ADR ada di `internal/docs/README.md` **dan** `internal/docs/adr/README.md` (kelas kegagalan SPEC-386).

- [ ] **Step 7: Commit**

```bash
git add internal/docs/adr/0115-state-tampilan-dashboard-persisten.md internal/docs/README.md internal/docs/adr/README.md internal/docs/frontend/frontend-implementation.md internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-740): ADR-0115 state tampilan persisten + index, frontend, SKILL"
```

---

### Task 13: Verifikasi menyeluruh

**Files:**
- Modify: (hanya perbaikan yang muncul dari verifikasi)

**Interfaces:**
- Consumes: seluruh Task 1–12
- Produces: bukti hijau untuk test web, typecheck paket `src`, dan lint berkas yang berubah

- [ ] **Step 1: Jalankan seluruh test project `src`**

`src/test/setup.ts` dibaca **setiap** test web, jadi scope diperluas dari "berkas yang berubah" ke seluruh project `src` — alasannya disebutkan saat melapor.

Run: `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run`
Expected: PASS, nol berkas gagal. Bila ada yang merah karena state bocor antar-test, tambahkan `localStorage.clear()` di test itu **atau** perbaiki nilai default yang salah — jangan melemahkan guard.

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0, nol error.

- [ ] **Step 3: Lint berkas yang berubah**

Run: `cd src && ./node_modules/.bin/eslint $(cd .. && git diff --name-only "$HANOMAN_BASE_SHA" -- 'src/**/*.ts' 'src/**/*.tsx' | sed 's|^src/||')`
Expected: nol error. Bila project ini tak punya konfigurasi eslint, lewati langkah ini dan katakan demikian.

- [ ] **Step 4: Smoke di browser sungguhan**

Task ini tak menyentuh endpoint, jadi tak perlu boot server + curl. Sebagai gantinya, buktikan perilakunya sekali di aplikasi nyata: `pnpm dev`, buka dashboard, setel filter di Backlog, pindah ke Triase, kembali → filter masih menyala dan lencana "N filter aktif" tampil; refresh browser → mendarat di halaman yang sama dengan filter yang sama; tekan "Reset tampilan" → kembali ke default. Bila `pnpm dev` tak bisa dijalankan di lingkungan ini, katakan itu apa adanya alih-alih mengklaim sudah di-smoke.

- [ ] **Step 5: Centang plan & commit penutup**

```bash
git add docs/superpowers/plans/2026-08-13-spec-740-state-tampilan-persisten.md
git commit -m "chore(spec-740): centang plan + catat bukti verifikasi"
```

- [ ] **Step 6: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-740
```
