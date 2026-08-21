# SPEC-879 — IDE responsif di layar sempit: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keempat tab IDE (Explorer, Git Graph, Branches, Worktrees) terbaca dan seluruh kontrolnya terjangkau di 390px, 820px, dan ~1100px — tanpa label yang menimpa tetangga, tanpa elemen berlebar nol, tanpa halaman yang menggulir samping.

**Architecture:** Empat akar terukur, empat perbaikan yang tak saling bergantung: (1) baris kepala IDE mendapat pemilik sisa lebar lewat dua kelas baru di `app.css` (`.hn-ide-head`, `.hn-ide-toolbar`); (2) `<LocalOverflow>` Git Graph pindah dari luar `<Card>` ke dalam, membungkus hanya region baris, dengan anak ber-`min-width` supaya scroller-nya hidup; (3) baris Branches & Worktrees reflow (`hn-dense-row` + `flex-wrap: wrap`) alih-alih menggulir mendatar; (4) checkbox mentah Git Graph diganti `Checkbox` design system. Tak satu pun komponen bersama (`ResponsivePanels`, `Tabs`, `Card`) disentuh.

**Tech Stack:** React 18 + TypeScript (Vite), CSS di `src/src/app.css`, test Vitest + @testing-library/react (jsdom), harness bukti Chrome headless via CDP dari Node (nol dependensi baru).

**Spec:** `docs/superpowers/specs/2026-08-21-spec-879-ide-responsif-layar-sempit-design.md`

## Global Constraints

- Perubahan terbatas pada layar IDE (`src/src/screens/IdeScreen.tsx`, `GitGraph.tsx`, `BranchesPanel.tsx`, `WorktreesPanel.tsx`) dan `src/src/app.css`. **Jangan** ubah `src/src/ds/responsive.tsx`, `src/src/ds/components/ui.tsx` (`Tabs`), atau `src/src/ds/components/surfaces.tsx` (`Card`).
- Kontrak yang ditegakkan, bukan diubah: rantai flex Explorer (SPEC-363), `Card padding={0} fill` (SPEC-393), `<main>` menggulir untuk auto-load Git Graph (SPEC-351), label tujuan `→ <dirSel>` wajib terlihat (ADR-0121), `<main>` ber-`overflow-x: hidden` (SPEC-763).
- Pakai konvensi `app.css` yang sudah ada lebih dulu: `.hn-dense-row`, `.hn-tabs`, `.hn-local-overflow`, `--touch-target`. Kelas baru hanya `.hn-ide-head` dan `.hn-ide-toolbar`.
- **Jangan** memakai `all: "unset"` inline — ia menang atas `button { min-height: var(--touch-target) }` dan atas `flex-wrap` milik `.hn-dense-row`.
- Breakpoint tunggal SPEC-763: mobile `max-width: 767px`, tablet 768–1199px, desktop `min-width: 1200px`. Jangan memperkenalkan nilai breakpoint lain.
- Modal/dialog IDE (Remotes, nama berkas, konfirmasi hapus, preview .md) **di luar cakupan**.
- Jalankan vitest web dari direktori `src/` dengan `../node_modules/.bin/vitest` dan `env -u NODE_ENV` (shell sesi menunjuk production, dan cwd tool Bash bertahan antar-panggilan).
- Baseline test `src/` **bukan** hijau di HEAD: `placeholder-contract.test.ts` (3 `<Input type="number">` di `SettingsScreen`) dan berkas lain sudah merah tanpa perubahan apa pun. Bandingkan terhadap baseline, jangan laporkan itu sebagai regresi.
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama**.

## File Structure

| Berkas | Tanggung jawab | Aksi |
| --- | --- | --- |
| `src/src/app.css` | kosakata layout bersama; menerima `.hn-ide-head` + `.hn-ide-toolbar` beserta aturan mobile-nya | Modify |
| `src/src/screens/IdeScreen.tsx` | baris kepala (Tabs + toolbar), baris aksi berkas Explorer, editor berkas | Modify |
| `src/src/screens/GitGraph.tsx` | letak `<LocalOverflow>`, lebar minimum region baris, kontrol tampilan | Modify |
| `src/src/screens/BranchesPanel.tsx` | baris branch: reflow | Modify |
| `src/src/screens/WorktreesPanel.tsx` | baris worktree: reflow | Modify |
| `src/test/ide-responsive.test.tsx` | kontrak SPEC-879: satu berkas, satu `describe` per akar | Create |
| `internal/docs/frontend/frontend-implementation.md` | kontrak responsive frontend: keluarga IDE | Modify |
| `internal/docs/design-system/design-system.md` | kosakata layout: dua kelas baru | Modify |
| `internal/docs/research/audit-spec-879-ide-responsif-layar-sempit.md` | laporan audit terukur sebelum/sesudah | Create |
| `internal/docs/README.md` | tautan audit baru di kategori `research` | Modify |

---

## Task 1: Baris kepala IDE punya pemilik sisa lebar

Akar 1. Di ~1100px kepala jadi 1 atau 2 baris **tergantung tab mana yang aktif** (label aktif dirender `font-weight: 600`); di 390px toolbar membungkus sendiri jadi dua baris sehingga kepala jadi tiga baris.

**Files:**
- Modify: `src/src/app.css` (tambah blok `.hn-ide-head` sesudah blok `.hn-tabs`, dan aturan mobile di dalam `@media (max-width: 767px)` yang sudah ada di dekatnya)
- Modify: `src/src/screens/IdeScreen.tsx:301-323` (konstanta `toolbar` + baris kepala di `return`)
- Test: `src/test/ide-responsive.test.tsx`

**Interfaces:**
- Consumes: `.hn-tabs` (sudah ada: `max-width: 100%; overflow-x: auto; overflow-y: hidden`), token `--touch-target`.
- Produces: kelas `.hn-ide-head` dan `.hn-ide-toolbar`; Task 2 tidak memakainya, Task 5 mengujinya lewat berkas test yang sama.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/ide-responsive.test.tsx`:

```tsx
/* SPEC-879 · regresi layout IDE yang terukur di browser sungguhan (Chrome headless, 390/820/1100,
   instance hanoman terisolasi). jsdom tak punya layout engine, jadi yang diikat di sini adalah
   MEKANISME yang membuat pengukuran itu berubah, bukan pikselnya. */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");
const mobile = css.slice(css.indexOf("@media (max-width: 767px) {"));
const source = (file: string) =>
  readFileSync(resolve(import.meta.dirname, `../src/screens/${file}`), "utf8");

vi.mock("../src/api/client", () => ({
  api: {
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideFileDownloadUrl: () => "#",
  },
  ApiError: class extends Error {},
}));

import { IdeScreen } from "../src/screens/IdeScreen";

beforeEach(() => vi.clearAllMocks());

const renderIde = () => render(
  <IdeScreen projectId="p1" projects={[{ id: "p1", name: "P1" }] as never[]}
    onProject={() => {}} onToast={() => {}} />,
);

describe("SPEC-879 · baris kepala IDE punya pemilik sisa lebar", () => {
  it("memberi strip tab sisa lebar sehingga kekurangan dibayar gulir, bukan wrap", () => {
    const rule = css.slice(css.indexOf(".hn-ide-head {"), css.indexOf(".hn-ide-toolbar {"));
    expect(rule).toMatch(/\.hn-ide-head\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(rule).toMatch(/\.hn-ide-head > \.hn-tabs\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(rule).toMatch(/\.hn-ide-head > \.hn-tabs\s*\{[^}]*min-width:\s*0/s);
  });

  it("menjadikan toolbar satu baris yang MENGGULIR di mobile, bukan dua baris yang membungkus", () => {
    expect(mobile).toMatch(/\.hn-ide-head > \*\s*\{[^}]*flex:\s*1 1 100%/s);
    expect(mobile).toMatch(/\.hn-ide-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(mobile).toMatch(/\.hn-ide-toolbar\s*\{[^}]*overflow-x:\s*auto/s);
    // Scroller tanpa aturan ini adalah scroller MATI (akar SPEC-763): itemnya menyusut sampai
    // labelnya tumpah, dan strip-nya tak pernah punya konten lebih lebar untuk digulir.
    expect(mobile).toMatch(/\.hn-ide-toolbar > \*\s*\{[^}]*flex:\s*0 0 auto/s);
  });

  it("memasang kedua kelas itu di layar IDE, dengan strip tab sebagai anak langsung", async () => {
    renderIde();
    const tablist = await screen.findByRole("tablist", { name: "" }).catch(() => null)
      ?? document.querySelector('[role="tablist"]')!;
    const head = tablist.parentElement!;
    expect(head).toHaveClass("hn-ide-head");
    expect(head.querySelector(":scope > .hn-ide-toolbar")).not.toBeNull();
    expect(head.style.justifyContent).toBe("");
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx
```

Harapan: FAIL — `.hn-ide-head {` tak ada di `app.css` (`indexOf` mengembalikan −1 → slice kosong), dan `head` tak punya kelas `hn-ide-head`.

- [x] **Step 3: Tambahkan aturan CSS**

Di `src/src/app.css`, sesudah blok `.hn-tabs { … }` dan **sebelum** `@media (pointer: coarse), (max-width: 767px)`:

```css
/* SPEC-879 · baris kepala IDE = strip tab + toolbar. Keduanya dulu `flex: 0 1 auto`, jadi tak ada
   yang mengambil sisa lebar dan tak ada yang menyerap kekurangan: begitu jumlahnya melewati baris,
   SELURUH toolbar turun. Terukur di ~1100px pada viewport yang sama, tab Explorer memberi kepala
   satu baris sementara tab Worktrees memberi dua — semata karena label tab aktif dirender
   `font-weight: 600`. Strip tab yang menyerap sisa lebar (dan sudah punya `overflow-x: auto`
   sendiri) membuat kekurangan beberapa piksel dibayar dengan menggulir, bukan dengan wrap. */
.hn-ide-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}

.hn-ide-head > .hn-tabs { flex: 1 1 auto; min-width: 0; }

.hn-ide-toolbar {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 767px) {
  /* Toolbar (2 Select + 3 tombol ≈ 570px) membungkus sendiri jadi dua baris di 390px → kepala tiga
     baris. Di sini ia jadi SATU baris yang menggulir, cermin papan tombol terminal SPEC-800; item
     `flex: 0 0 auto` adalah yang membuat scroller-nya hidup. `overflow-y: hidden` mengunci sumbu-Y
     dengan alasan yang sama seperti `.hn-tabs`. */
  .hn-ide-head > * { flex: 1 1 100%; min-width: 0; }
  .hn-ide-toolbar {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
  }
  .hn-ide-toolbar > * { flex: 0 0 auto; }
}
```

- [x] **Step 4: Pasang kelasnya di `IdeScreen.tsx`**

Ganti konstanta `toolbar` (`src/src/screens/IdeScreen.tsx:301`):

```jsx
  const toolbar = (
    <div className="hn-ide-toolbar">
      <Select size="sm" value={projectId} onChange={(e) => onProject(e.target.value)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      <Select size="sm" value={viewRef} onChange={(e) => setViewRef(e.target.value)} options={refOptions} />
      <Button size="sm" variant="secondary" leftIcon="git-branch" onClick={checkout} disabled={!viewRef}>Checkout</Button>
      {/* SPEC-233 · fetch --all --prune; ref-only → tak digerbang sesi */}
      <Button size="sm" variant="ghost" leftIcon="download-cloud" onClick={() => { void runGit({ op: "fetch", prune: true }).then(() => api.listBranches(projectId).then(setBranches)).catch(() => {}); }}>Fetch</Button>
      <Button size="sm" variant="ghost" leftIcon="git-branch" onClick={() => setShowRemotes(true)}>Remotes</Button>
    </div>
  );
```

Ganti baris kepala di `return` (`src/src/screens/IdeScreen.tsx:318`):

```jsx
      <div className="hn-ide-head" style={{ flex: "0 0 auto" }}>
        <Tabs tabs={[{ value: "explorer", label: "Explorer" }, { value: "graph", label: "Git Graph" },
          { value: "branches", label: "Branches" }, { value: "worktrees", label: "Worktrees" }]}
          value={tab} onChange={setTab} />
        {toolbar}
      </div>
```

`flex: "0 0 auto"` tetap inline: ia milik rantai flex Explorer (SPEC-363), bukan milik kelas kepala.

- [x] **Step 5: Jalankan test sampai lulus**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx
```

Harapan: PASS (3 test).

- [x] **Step 6: Jalankan test IDE yang sudah ada**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-screen.test.tsx test/ide-file-ops.test.tsx test/ide-worktrees-tab.test.tsx test/scroll-chain.test.tsx test/responsive-no-squeeze.test.tsx
```

Harapan: PASS semua.

- [x] **Step 7: Commit**

```bash
git add src/src/app.css src/src/screens/IdeScreen.tsx src/test/ide-responsive.test.tsx
git commit -m "fix(ide): baris kepala punya pemilik sisa lebar (.hn-ide-head)"
```

---

## Task 2: Region baris Git Graph jadi scroller lokal yang hidup

Akar 2. `<LocalOverflow>` membungkus seluruh `<Card>`; anaknya blok, dan blok selalu selebar induk — terukur di 390px `content = 362 = box`, `canScroll: false`. Karena scroller-nya mati, 200 tombol subject runtuh ke `0×44` dan pill ref menimpa kolom author.

**Files:**
- Modify: `src/src/screens/GitGraph.tsx:11` (konstanta), `:392-394` (buka `<LocalOverflow>`), `:439-533` (region baris), `:546-548` (tutup)
- Test: `src/test/ide-responsive.test.tsx`

**Interfaces:**
- Consumes: `LANE_W = 14` (sudah ada di `GitGraph.tsx:11`), `maxLanes` (sudah dihitung di komponen), `.hn-local-overflow` (app.css).
- Produces: `data-testid="ide-graph-rows"` — dipakai test Task 2 dan harness bukti Task 6.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/ide-responsive.test.tsx` (mock `api` di berkas itu perlu diperluas dulu — ganti blok `vi.mock` yang ada dengan versi berikut, yang menambahkan endpoint Git Graph):

```tsx
vi.mock("../src/api/client", () => ({
  api: {
    ideTree: vi.fn(async () => ({ ref: "", files: ["README.md"] })),
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    ideWorkingStatus: vi.fn(async () => ({ branch: "main", staged: [], unstaged: [] })),
    ideFile: vi.fn(async () => ({ path: "README.md", content: "# hi", binary: false, truncated: false })),
    ideFileDownloadUrl: () => "#",
    getConfig: vi.fn(async () => ({ entries: [] })),
    ideGraph: vi.fn(async () => ({ current: "main", commits: [
      { sha: "aaaa111", parents: [], author: "Dena", at: "2026-01-02T00:00:00Z",
        subject: "feat(terminal): perekam diagnostik jalur ketik", refs: ["main"], tags: [] },
    ] })),
    ideStatus: vi.fn(async () => ({ branch: "main", clean: true, ahead: 0, behind: 0,
      staged: [], unstaged: [], untracked: [] })),
    ideStashes: vi.fn(async () => []),
  },
  ApiError: class extends Error {},
}));
```

dan tambahkan import + `describe` berikut:

```tsx
import { GitGraph } from "../src/screens/GitGraph";

describe("SPEC-879 · region baris Git Graph adalah scroller lokal yang HIDUP", () => {
  const renderGraph = () => render(
    <GitGraph projectId="p1" onRunGit={async () => ({ ok: true } as never)} onMerge={() => {}}
      onRebase={() => {}} onPull={() => {}} onDrop={() => {}} onOpenFile={() => {}} />,
  );

  it("membungkus baris commit — bukan seluruh kartu — dengan scroller lokal ber-lebar minimum", async () => {
    renderGraph();
    const rows = await screen.findByTestId("ide-graph-rows");
    expect(rows).toHaveClass("hn-local-overflow");
    // Anak blok selalu selebar induknya; tanpa `min-width` scroller ini tak pernah punya konten
    // lebih lebar untuk digulir — terukur 362 = 362 di 390px.
    const inner = rows.firstElementChild as HTMLElement;
    expect(Number.parseInt(inner.style.minWidth, 10)).toBeGreaterThanOrEqual(460);
    // Kartu TIDAK boleh lagi berada di dalam scroller mendatar.
    expect(rows.closest(".hn-local-overflow")).toBe(rows);
  });

  it("menaruh baris commit di dalam scroller dan baris penutup SPEC-351 di luarnya", async () => {
    renderGraph();
    const rows = await screen.findByTestId("ide-graph-rows");
    const subject = await screen.findByRole("button", { name: /Buka commit aaaa111/ });
    expect(rows.contains(subject)).toBe(true);
    const footer = screen.getByText(/commit dimuat|dari .* commit/);
    expect(rows.contains(footer)).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx -t "Git Graph"
```

Harapan: FAIL — `Unable to find an element by: [data-testid="ide-graph-rows"]`.

- [x] **Step 3: Tambahkan konstanta lebar minimum**

Di `src/src/screens/GitGraph.tsx:11`, sesudah `const LANE_W = 14, ROW_H = 30, DOT = 4;`:

```ts
// SPEC-879 · lebar minimum region baris: subject 238 + author 88 + tanggal 40 + aksi ⋮ 44 + gap &
// padding 50. Di bawah ini kolom subject yang `flex: 1` runtuh ke 0px dan pill ref (yang `flex:
// 0 0 auto`) meluber menimpa kolom author — terukur 200 tombol subject `0×44` di 390px.
const GRAPH_ROW_MIN = 460;
```

- [x] **Step 4: Pindahkan `<LocalOverflow>` ke dalam kartu**

Di `src/src/screens/GitGraph.tsx`, hapus `<LocalOverflow>` yang membungkus `<Card padding={0}>` (baris `392`) dan `</LocalOverflow>` penutupnya (baris `546`), sehingga `<Card padding={0}>` menjadi anak langsung `<section data-panel="graph">`.

Lalu bungkus **region baris** — dari komentar `{/* SPEC-233 · baris uncommitted changes … */}` sampai akhir `{rows.map(...)}`, yaitu tepat sebelum komentar `{/* SPEC-351 · baris penutup … */}` — dengan:

```jsx
        {/* SPEC-879 · baris commit tak bisa reflow: lane SVG-nya posisional dan kolomnya
            berlebar tetap. Ia karena itu memiliki scroller mendatarnya sendiri, dengan lebar
            minimum supaya barisnya tak pernah lebih sempit dari yang terbukti terbaca. Widget
            cari, kontrol tampilan, chip stash, dan baris penutup SENGAJA di luar: yang terakhir
            adalah sentinel IntersectionObserver SPEC-351 yang menempel pada `<main>`. */}
        <LocalOverflow data-testid="ide-graph-rows">
          <div style={{ minWidth: maxLanes * LANE_W + GRAPH_ROW_MIN }}>
            {/* … baris uncommitted + rows.map(...) apa adanya … */}
          </div>
        </LocalOverflow>
```

Chip stash tetap **di luar** `<LocalOverflow>` (ia sudah `flex-wrap: wrap` dan tak butuh lebar intrinsik). Urutan render tak berubah: cari → kontrol tampilan → chip stash → `<LocalOverflow>`(uncommitted + baris) → baris penutup.

- [x] **Step 5: Buat baris widget cari membungkus, bukan memotong**

Di baris widget cari (`src/src/screens/GitGraph.tsx:394`), tambahkan `flexWrap: "wrap"` dan ganti spacer hantu dengan `marginLeft`:

```jsx
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid var(--border-hair)" }}>
```

dan di cabang `!findOpen`, hapus `<span style={{ flex: 1 }} />` lalu beri teks pintasan `marginLeft: "auto"`:

```jsx
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-subtle)" }}>⌘F cari · ⌘H center HEAD</span>
```

- [x] **Step 6: Jalankan test sampai lulus**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx test/git-graph-view.test.tsx test/scroll-chain.test.tsx
```

Harapan: PASS semua. `scroll-chain.test.tsx` menguji modal berkas Git Graph — ia tak tersentuh perubahan ini, jadi ia wajib tetap hijau.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/GitGraph.tsx src/test/ide-responsive.test.tsx
git commit -m "fix(ide): region baris Git Graph jadi scroller lokal yang hidup"
```

---

## Task 3: Baris Branches & Worktrees reflow, bukan menggulir

Akar 3. Baris kedua panel adalah flex satu baris tanpa `flex-wrap`: di 390px tombol **Hapus** tiap baris terukur 145–363px di luar layar, dan di 820px Branches masih menyisakan 17px.

**Files:**
- Modify: `src/src/screens/BranchesPanel.tsx:170-196` (baris branch)
- Modify: `src/src/screens/WorktreesPanel.tsx:168-198` (baris worktree)
- Test: `src/test/ide-responsive.test.tsx`

**Interfaces:**
- Consumes: `.hn-dense-row` (app.css, sudah ada: `align-items: flex-start !important; flex-wrap: wrap` + `> [style*="flex: 1"] { min-width: min(220px, 100%) }` di blok mobile).
- Produces: tak ada API baru; hanya kelas & style pada baris yang sudah ada `data-testid="row-<name>"` (Worktrees) dan `data-testid="row-delete-<name>"` (keduanya).

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/ide-responsive.test.tsx`:

```tsx
describe("SPEC-879 · baris Branches & Worktrees membungkus sebelum memotong", () => {
  const rows = [
    ["BranchesPanel.tsx", "{visible.map((b) => ("],
    ["WorktreesPanel.tsx", "{rows.map((w) => ("],
  ] as const;

  it.each(rows)("%s: baris memakai hn-dense-row dan boleh membungkus di tier mana pun", (file, anchor) => {
    const src = source(file);
    const at = src.indexOf(anchor);
    expect(at).toBeGreaterThan(-1);
    const row = src.slice(at, at + 700);
    // `.hn-dense-row` memberi nama (anak ber-`flex: 1`) lebar minimum 220px di mobile; `flexWrap`
    // inline berlaku di SEMUA tier karena yang bocor di 820px cuma 17px — membungkus satu tombol
    // ke baris kedua jauh lebih baik daripada memotongnya.
    expect(row).toContain('className="hn-dense-row"');
    expect(row).toContain('flexWrap: "wrap"');
  });

  it.each(rows)("%s: kolom meta tetap rata kanan sesudah membungkus", (file, anchor) => {
    const src = source(file);
    const at = src.indexOf(anchor);
    const row = src.slice(at, at + 1600);
    expect(row).toMatch(/marginLeft:\s*"auto"[^}]*textAlign:\s*"right"|textAlign:\s*"right"[^}]*marginLeft:\s*"auto"/s);
  });

  it.each([["IdeScreen.tsx"], ["GitGraph.tsx"], ["BranchesPanel.tsx"], ["WorktreesPanel.tsx"]] as const)(
    "%s: tak memakai `all: unset` (ia menang atas min-height target sentuh DAN atas flex-wrap)",
    (file) => expect(source(file)).not.toContain('all: "unset"'));
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx -t "membungkus sebelum memotong"
```

Harapan: FAIL — `expect(row).toContain('className="hn-dense-row"')`.

- [x] **Step 3: Ubah baris Branches**

Di `src/src/screens/BranchesPanel.tsx:170`, ganti pembuka baris:

```jsx
              <div key={b.name} className="hn-dense-row"
                style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  padding: "8px 14px", borderBottom: "1px solid var(--border-hair)" }}>
```

dan kolom meta (`:191`):

```jsx
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 200,
                  marginLeft: "auto", textAlign: "right" }}>
```

- [x] **Step 4: Ubah baris Worktrees**

Di `src/src/screens/WorktreesPanel.tsx:169`, ganti pembuka baris:

```jsx
              <div key={w.name} data-testid={`row-${w.name}`} className="hn-dense-row"
                style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  padding: "8px 14px", borderBottom: "1px solid var(--border-hair)",
                  background: focus === w.name ? "var(--surface-sunken)" : undefined }}>
```

dan kolom meta (`:193`):

```jsx
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 130,
                  marginLeft: "auto", textAlign: "right" }}>
```

- [x] **Step 5: Jalankan test sampai lulus**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx test/branches-panel.test.tsx test/worktrees-panel.test.tsx test/ide-worktrees-tab.test.tsx
```

Harapan: PASS semua.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/BranchesPanel.tsx src/src/screens/WorktreesPanel.tsx src/test/ide-responsive.test.tsx
git commit -m "fix(ide): baris Branches & Worktrees membungkus sebelum memotong"
```

---

## Task 4: Kontrol Git Graph & Explorer memakai primitive yang benar

Akar 4 plus dua pembersihan kecil dari spec: label tujuan Explorer (ADR-0121) berdiri sendiri, dan editor berkas tak lagi memaksa 560px di ponsel.

**Files:**
- Modify: `src/src/screens/GitGraph.tsx:4` (import), `:419-428` (tiga checkbox)
- Modify: `src/src/screens/IdeScreen.tsx:358-361` (spacer + label tujuan), `:494-498` (`textarea`)
- Test: `src/test/ide-responsive.test.tsx`

**Interfaces:**
- Consumes: `Checkbox` dari `../ds` — `{ checked: boolean; onChange: (next: boolean) => void; label: React.ReactNode }`, merender `span[role="checkbox"][aria-checked]` di dalam `label.hn-choice-target`.
- Produces: `data-testid="ide-entry-dest"` pada label tujuan — dipakai test ini dan harness bukti Task 6.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/ide-responsive.test.tsx`:

```tsx
describe("SPEC-879 · kontrol IDE memakai primitive design system", () => {
  it("Git Graph tak lagi memakai <input type=checkbox> mentah", async () => {
    render(
      <GitGraph projectId="p1" onRunGit={async () => ({ ok: true } as never)} onMerge={() => {}}
        onRebase={() => {}} onPull={() => {}} onDrop={() => {}} onOpenFile={() => {}} />,
    );
    await screen.findByTestId("ide-graph-rows");
    // `input { min-width/min-height: var(--touch-target) }` merentangkan checkbox mentah jadi kotak
    // 44×44; `Checkbox` DS menaruh kotak 18×18 DI DALAM area sentuh itu.
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    for (const name of ["remote", "tag", "muted merge"]) {
      expect(screen.getByRole("checkbox", { name })).toBeInTheDocument();
    }
  });

  it("label tujuan Explorer menyerap sisa lebar alih-alih bergantung pada spacer yang boleh runtuh", async () => {
    renderIde();
    const dest = await screen.findByTestId("ide-entry-dest");
    expect(dest).toHaveTextContent("→ root");
    expect(dest).toHaveStyle({ flex: "1 1 auto" });
    const row = dest.parentElement!;
    const spacers = [...row.children].filter((c) => c !== dest
      && !c.textContent?.trim() && (c as HTMLElement).style.flex === "1");
    expect(spacers).toHaveLength(0);
  });

  it("editor berkas tak memaksa tinggi tetap yang melewati viewport ponsel", () => {
    const ide = source("IdeScreen.tsx");
    expect(ide).toContain('minHeight: "clamp(240px, 50dvh, 560px)"');
    expect(ide).not.toContain("minHeight: 560");
  });
});
```

- [x] **Step 2: Jalankan test untuk memastikan ia gagal**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx -t "primitive design system"
```

Harapan: FAIL — 3 checkbox mentah masih ada; `ide-entry-dest` belum ada; `minHeight: 560` masih ada.

- [x] **Step 3: Ganti checkbox Git Graph dengan `Checkbox` DS**

Di `src/src/screens/GitGraph.tsx:4`, tambahkan `Checkbox` ke daftar impor dari `"../ds"`.

Ganti tiga `<label>` pembungkus `<input type="checkbox">` (`:419-428`) dengan:

```jsx
          <Checkbox checked={gopts.showRemote} onChange={(next) => setView({ showRemote: next })} label="remote" />
          <Checkbox checked={gopts.showTags} onChange={(next) => setView({ showTags: next })} label="tag" />
          <Checkbox checked={muted} onChange={setMuted} label="muted merge" />
```

- [x] **Step 4: Ubah label tujuan Explorer**

Di `src/src/screens/IdeScreen.tsx`, hapus `<span style={{ flex: 1 }} />` (`:358`) dan ganti label tujuan:

```jsx
              {/* ADR-0121 · label tujuan MENYERAP sisa lebar di baris mana pun ia mendarat, jadi ia
                  terlihat secara konstruksi — bukan sebagai efek samping spacer yang boleh runtuh. */}
              <span data-testid="ide-entry-dest" style={{ flex: "1 1 auto", minWidth: 0,
                textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)" }}>
                → {dirSel || "root"}
              </span>
```

- [x] **Step 5: Ubah tinggi minimum editor**

Di `src/src/screens/IdeScreen.tsx:494`, ganti `minHeight: 560` pada `<textarea>` mode edit:

```jsx
                          width: "100%", minHeight: "clamp(240px, 50dvh, 560px)", boxSizing: "border-box",
```

- [x] **Step 6: Jalankan test sampai lulus**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/ide-responsive.test.tsx test/git-graph-view.test.tsx test/ide-screen.test.tsx test/ide-file-ops.test.tsx
```

Harapan: PASS semua. `ide-file-ops.test.tsx:42` mencari teks `→ root` — bentuk teksnya tak berubah.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/GitGraph.tsx src/src/screens/IdeScreen.tsx src/test/ide-responsive.test.tsx
git commit -m "fix(ide): checkbox DS di Git Graph, label tujuan & editor Explorer"
```

---

## Task 5: Verifikasi test yang tersentuh

**Files:** tak ada perubahan berkas — hanya menjalankan dan membaca hasilnya.

- [x] **Step 1: Jalankan seluruh test yang berkaitan dengan berkas yang berubah**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run \
  test/ide-responsive.test.tsx test/ide-screen.test.tsx test/ide-file-ops.test.tsx \
  test/ide-worktrees-tab.test.tsx test/git-graph-view.test.tsx test/git-graph-render.test.tsx \
  test/branches-panel.test.tsx test/worktrees-panel.test.tsx test/scroll-chain.test.tsx \
  test/responsive-no-squeeze.test.tsx test/responsive.test.tsx test/responsive-touch-targets.test.ts \
  test/preview-fill-height.test.tsx test/doc-download-screens.test.tsx
```

Harapan: PASS semua. Angka test yang berjalan **wajib > 0** — `--changed` menyalakan `passWithNoTests`, jadi nol test terlihat hijau; di sini path-nya disebut eksplisit supaya tak bisa terjadi.

- [x] **Step 2: Typecheck paket yang tersentuh**

```bash
cd src && env -u NODE_ENV ../node_modules/.bin/tsc --noEmit
```

Harapan: keluar tanpa error. **Jangan** jalankan `pnpm -r typecheck` (satu proses tsc per paket sekaligus).

- [x] **Step 3: Bandingkan berkas merah dengan baseline**

Bila ada berkas yang gagal, verifikasi ia sudah merah di `$HANOMAN_BASE_SHA` sebelum menyebutnya regresi:

```bash
git stash list   # pastikan tak menyentuh tumpukan stash milik sesi lain
cd src && env -u NODE_ENV ../node_modules/.bin/vitest run test/<berkas-yang-merah>
```

`placeholder-contract.test.ts` sudah merah di HEAD (3 `<Input type="number">` di `SettingsScreen`) — itu baseline, bukan regresi.

---

## Task 6: Bukti terukur sesudah perbaikan (12 tangkapan layar + report.json)

**Files:**
- Create: `internal/docs/research/audit-spec-879-ide-responsif-layar-sempit.md`
- Modify: `internal/docs/README.md` (kategori `research`)
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/docs/design-system/design-system.md`

**Interfaces:**
- Consumes: harness scratchpad `cdp.mjs` + `audit.mjs` + `probe-src.js` (sudah ditulis saat audit sebelum), `data-testid` `ide-graph-rows`, `ide-tree-scroll`, `doc-preview-scroll`, `ide-entry-dest`.
- Produces: `shots-after/report.json` + 12 PNG, dan tabel angka di dokumen audit.

- [x] **Step 1: Bangun ulang aset web dan boot instance terisolasi**

```bash
env -u NODE_ENV -u DATABASE_URL pnpm --filter ./src build
```

Server harness (`HANOMAN_HOME` + `DATABASE_URL` sendiri, `HANOMAN_WEB_DIR` menunjuk `src/dist`, tanpa `HANOMAN_CONTROL_ORIGINS` yang membuat setiap route 404) sudah berjalan dari fase audit; bila mati, jalankan ulang `scratchpad/boot.sh`.

- [x] **Step 2: Jalankan harness sesudah perbaikan**

```bash
cd <scratchpad> && node audit.mjs shots-after
```

Harapan: 16 baris `. <tab>@<viewport>` lalu `selesai → …/shots-after`.

- [x] **Step 3: Bandingkan angkanya dengan target**

```bash
python3 summarize.py shots-after/report.json
```

Target (spec, bagian "Bukti"):
- `overlap = 0`, `silentClip = 0`, `zeroBox = 0` di ke-12 kombinasi tab × viewport;
- baris kepala ≤ 2 di 390px dan = 1 di ~1100px pada **keempat** tab;
- `scrollWidth - clientWidth = 0` di semua kombinasi;
- `ide-graph-rows` `canScrollX: true` di 390px;
- target sentuh <44px = 0 di setiap viewport ber-pointer kasar (390, 820, 1100t).

Bila salah satu meleset, kembali ke task yang bersangkutan — **jangan** melonggarkan targetnya.

- [x] **Step 4: Lihat tangkapan layarnya**

Buka minimal `graph-390.png`, `branches-390.png`, `worktrees-390.png`, `explorer-390.png`, dan `worktrees-1100.png`. Angka tak menangkap "pill menimpa author"; gambar menangkapnya.

- [x] **Step 5: Tulis dokumen audit**

Buat `internal/docs/research/audit-spec-879-ide-responsif-layar-sempit.md` berisi: cara mengukur (empat kelas cacat + kenapa ellipsis milik sendiri bukan pelanggaran), tabel sebelum/sesudah per tab × viewport, empat akar beserta angkanya, kontrol negatif (Explorer, DiffView, target sentuh pointer halus), dan bentuk perbaikannya.

- [x] **Step 6: Tautkan di index Source of Truth**

Tambahkan satu baris di kategori `research` `internal/docs/README.md`, mengikuti bentuk baris audit yang sudah ada (judul + ringkasan satu paragraf yang memuat angka kuncinya).

- [x] **Step 7: Perbarui kontrak responsive & kosakata design system**

Di `internal/docs/frontend/frontend-implementation.md`, bagian "Kontrak responsive seluruh frontend (SPEC-763)" → daftar aturan sesudah "Invariant halaman tidak menjamin layar terbaca": tambahkan tiga aturan SPEC-879 (kepala wajib punya pemilik sisa lebar; scroller lokal wajib punya konten yang lebih lebar — anak blok tak pernah memberikannya; baris tabel reflow sebelum menggulir).

Di `internal/docs/design-system/design-system.md`, bagian sistem responsif bersama: tambahkan `.hn-ide-head` / `.hn-ide-toolbar` ke kosakata layout.

- [x] **Step 8: Verifikasi integritas index**

```bash
node cli/dist/hanoman.js docs index --check
```

Bila `cli/dist` belum ada: `env -u NODE_ENV pnpm build:cli` lebih dulu.

Harapan: index konsisten (tak ada doc tanpa tautan).

- [x] **Step 9: Commit**

```bash
git add internal/docs
git commit -m "docs(spec-879): audit responsif IDE + kontrak layout kepala & scroller lokal"
```

---

## Task 7: Laporan akhir

- [ ] **Step 1: Centang seluruh checklist plan ini**

Setiap `- [ ]` di berkas ini jadi `- [x]`. hanoman menahan backlog di `executing` selama masih ada kotak kosong.

- [ ] **Step 2: Rakit laporan berisi 12 tangkapan layar**

Terbitkan satu halaman laporan (Artifact) berisi tabel angka sebelum/sesudah **dan** 12 tangkapan layar sesudah perbaikan berdampingan dengan 12 sebelum, satu bagian per tab. Objektif menuntut gambar, bukan hanya tabel angka.

- [ ] **Step 3: Bersihkan proses harness**

```bash
lsof -ti:8791 | xargs -r kill      # server harness
lsof -ti:9333 | xargs -r kill      # chrome debugging
```

**Jangan** `pkill -f node` / `killall`: prompt tiap sesi hidup di ARGV proses agennya, jadi pola generik mematikan sesi tetangga di mesin ini.

- [ ] **Step 4: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-879
```
