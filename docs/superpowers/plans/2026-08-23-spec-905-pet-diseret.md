# SPEC-905 — Pet hidup F: pet diseret (angkat · jatuh · pusing), berkeliaran lebih sering, lambaian menetap

> **For agentic workers:** REQUIRED SUB-SKILL: gunakan `superpowers:executing-plans` (atau
> `superpowers:subagent-driven-development`) untuk mengeksekusi plan ini task demi task. Langkah
> memakai checkbox (`- [ ]`) untuk pelacakan.

**Goal:** Pet dashboard bisa **diangkat dengan tangan** (Pointer Events, sumbu X **dan** Y),
dijatuhkan dengan percepatan, pusing sesaat, lalu melanjutkan berkeliaran dari tempat ia dilepas —
sambil berjalan **jauh lebih sering** daripada berdiri, dan melambai **terus-menerus** selama pointer
menempel.

**Architecture:** Mesin `src/src/screens/pet-walk.ts` tetap **murni** (tanpa timer, tanpa DOM) dan
memperoleh sumbu `y`, tiga mode (`held`/`falling`/`dizzy`), dan satu field `parkedX`. Keadaan seret
masuk sebagai masukan (`dragging`/`pointerX`/`pointerY`) dan keluar sebagai keadaan + baris +
perpindahan — pola yang sudah ada. `HanomanPet.tsx` tetap satu-satunya yang menyentuh DOM: ia
menerjemahkan gestur pointer menjadi koordinat jalur secara **selisih** (bukan
`getBoundingClientRect()`), melebarkan jalur **hanya selagi terangkat**, dan merender satu properti
`transform` untuk kedua sumbu.

**Tech Stack:** React 18 + TypeScript (paket `src`), Vitest 2 + @testing-library/react + jsdom 24.
Tanpa dependency baru, tanpa endpoint, tanpa skema.

Spec: `docs/superpowers/specs/2026-08-23-spec-905-pet-diseret-design.md`.

## Global Constraints

- `pet-walk.ts` tetap **murni**: tanpa `setTimeout`/`setInterval`, tanpa `window`/`document`, tanpa
  `Date.now()`. Komponen tetap satu-satunya yang menjadwalkan timeout.
- **Jangan** ubah `anchor.baseline`, `character.h`, `cell`, `columns`, `pet.json`, atlas, atau cara
  frame dipilih (`--row` + `steps(8)`). `held`/`falling`/`dizzy` **tetap bukan** `PetPose`:
  `POSE_ROW` dan `pet-state.ts` tak disentuh.
- Jalur pet boleh melebar **HANYA** selagi mode `held`/`falling`. `pointerEvents: "none"` di
  `pet-root` **tak boleh** hilang; yang `auto` tetap hanya tombol 44 px, tombol gelembung, dan panel.
- `prefers-reduced-motion`: seret **tetap boleh**, jatuh menjadi **seketika**, `dizzy` **dilewati**.
- Seret **nyala di semua tier termasuk mobile** (keputusan spec §5.2).
- Tanpa persistensi posisi antar-muat halaman — tanpa kunci storage baru.
- **jsdom 24 tak punya `PointerEvent` maupun `setPointerCapture`.** `fireEvent.pointerDown(el, {clientX})`
  memberi `clientX === null` (terukur). Test **wajib** memakai helper `pointer()` berbasis
  `MouseEvent` (Task 4 Step 1), dan komponen **wajib** memanggil capture secara opsional
  (`el.setPointerCapture?.(id)`).
- Perintah test dijalankan dari root worktree:
  `pnpm vitest --run --root src test/<berkas>` (paket `src` tak menyentuh DB server, jadi
  `--no-file-parallelism`/`TEST_DATABASE_URL` tak berlaku di sini).

---

### Task 1: Angka berkeliaran baru — jalan mayoritas, berdiri minoritas

**Files:**
- Modify: `src/src/screens/pet-walk.ts:10-11`
- Test: `src/test/pet-walk.test.ts:82-125`

**Interfaces:**
- Consumes: —
- Produces: `STAND_MS: readonly [1200, 4500]`, `WALK_MS: readonly [5000, 14000]` (nama & tipe tak
  berubah, hanya nilainya).

- [x] **Step 1: Perbarui test yang mengunci angkanya**

Di `src/test/pet-walk.test.ts`, ganti test "pose tenang…" (baris 82–98) dengan:

```ts
  it("pose tenang: berdiri 1,2–4,5 dtk, lalu jalan 5–14 dtk @ 40 px/s ke arah acak di dalam jalur", () => {
    // berdiri sampai `until`; rng pertama (0.5) → jalan 9,5 dtk = 380 px; rng kedua (0.9) → ke kanan
    const wait = stepWalk(standing(300, 100_500), input({ currentX: 300 }), seq(0.5, 0.9));
    expect(wait.move).toBeNull();
    expect(wait.row).toBe("idle");
    const go = stepWalk(standing(300, 100_000), input({ currentX: 300 }), seq(0.5, 0.9));
    expect(go.row).toBe("walk-right");
    expect(go.move).toEqual({ x: 680, y: 0, durationMs: 9500, ease: "linear" });
    expect(go.state).toEqual({ x: 680, y: 0, facing: "right", mode: "walk", until: 109_500, parkedX: null });
    // jalan sampai tiba, lalu berdiri STAND_MS[0]..[1] (rng 0 → 1,2 dtk)
    const onTheWay = stepWalk(go.state, input({ currentX: 500, now: 105_000 }), seq(0));
    expect(onTheWay.move).toBeNull();
    expect(onTheWay.row).toBe("walk-right");
    const arrived = stepWalk(go.state, input({ currentX: 680, now: 109_500 }), seq(0));
    expect(arrived.state).toEqual({ x: 680, y: 0, facing: "right", mode: "stand", until: 109_500 + STAND_MS[0], parkedX: null });
    expect(arrived.row).toBe("idle");
  });

  it("berjalan lebih sering daripada berdiri — itulah isi perubahan angkanya", () => {
    // Rata-rata satu siklus tenang: berdiri (1,2+4,5)/2 = 2,85 dtk, jalan (5+14)/2 = 9,5 dtk.
    const standAvg = (STAND_MS[0] + STAND_MS[1]) / 2;
    const walkAvg = (WALK_MS[0] + WALK_MS[1]) / 2;
    expect(walkAvg / (walkAvg + standAvg)).toBeGreaterThan(0.7);
  });
```

Ganti pula dua angka di test "di tepi jalur membalik arah…" (baris 100–111) dan
"durasi jalan mengikuti jarak sebenarnya…" (baris 119–125):

```ts
    // di rumah, rng arah 0.9 (kanan) → tak ada ruang → balik ke kiri sejauh 380 px
    const flip = stepWalk(standing(HOME, 100_000), input({ currentX: HOME }), seq(0.5, 0.9));
    expect(flip.row).toBe("walk-left");
    expect(flip.move).toEqual({ x: HOME - 380, y: 0, durationMs: 9500, ease: "linear" });
```

```ts
    // rng: jalan 14 dtk (0.999… → ~560 px) ke kanan dari 700 → clamp ke HOME (856): 156 px = 3900 ms
    const step = stepWalk(standing(700, 100_000), input({ currentX: 700 }), seq(1 - 1e-9, 0.9));
    expect(step.move!.x).toBe(HOME);
    expect(step.move!.durationMs).toBe(Math.round(((HOME - 700) / WALK_PX_PER_S) * 1000));
    expect(WALK_MS[1] * WALK_PX_PER_S / 1000).toBe(560);
```

> Catatan: bentuk `{ x, y, durationMs, ease }` dan field `parkedX` baru lahir di Task 2/3. Test ini
> karena itu **merah dua kali** — sekali karena angkanya, sekali karena bentuknya. Itu disengaja:
> Step 2 memastikan kegagalannya memang soal angka.

- [x] **Step 2: Jalankan test — pastikan MERAH karena angkanya**

```bash
pnpm vitest --run --root src test/pet-walk.test.ts -t "pose tenang"
```
Expected: FAIL — `expected { x: 300 + 160 … } to equal { x: 680 … }` (angka lama 160 px vs 380 px).

- [x] **Step 3: Ganti kedua konstanta**

Di `src/src/screens/pet-walk.ts` ganti baris 10–11 dengan:

```ts
// SPEC-905 · pet berjalan LEBIH SERING daripada berdiri. Rasionya disengaja, bukan selera: satu
// siklus tenang rata-rata kini 2,85 dtk berdiri + 9,5 dtk jalan (±72 % berjalan), kebalikan dari
// ±33 % milik [4000,12000]/[2000,6000] milik ADR-0140 — yang membuat sprite berjalan jarang
// terlihat berjalan. `WALK_PX_PER_S` tak ikut naik: yang kurang adalah DURASInya, bukan lajunya.
export const STAND_MS: readonly [number, number] = [1200, 4500];
export const WALK_MS: readonly [number, number] = [5000, 14000];
```

- [x] **Step 4: Jalankan test — angkanya lulus, bentuknya masih merah**

```bash
pnpm vitest --run --root src test/pet-walk.test.ts -t "berjalan lebih sering"
```
Expected: PASS. Test "pose tenang" masih FAIL pada `y`/`ease`/`parkedX` — itu pekerjaan Task 2/3.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/pet-walk.ts src/test/pet-walk.test.ts
git commit -m "feat(pet): berkeliaran lebih sering — STAND_MS/WALK_MS dibalik rasionya (SPEC-905)"
```

---

### Task 2: Sumbu Y + tiga mode seret di mesin murni

**Files:**
- Modify: `src/src/screens/pet-walk.ts` (tipe, konstanta jatuh, `clampY`, `isHandled`, `stepWalk`)
- Test: `src/test/pet-walk.test.ts`

**Interfaces:**
- Consumes: `durationMs`, `POSE_ROW`, `PetRowKey` dari `./pet-sprite`.
- Produces:
  - `type PetWalkMode = "stand" | "walk" | "home" | "held" | "falling" | "dizzy"`
  - `type PetEase = "linear" | "fall"`
  - `type PetWalkState = { x: number; y: number; facing: PetFacing; mode: PetWalkMode; until: number; parkedX: number | null }`
  - `type PetMove = { x: number; y: number; durationMs: number; ease: PetEase }`
  - `PetWalkInput` bertambah `laneHeight: number; petHeight: number; dragging: boolean; pointerX: number; pointerY: number`
  - `clampY(y: number, laneHeight: number, petHeight: number): number`
  - `isHandled(mode: PetWalkMode): boolean`
  - `FALL_PX_PER_S = 240`, `FALL_MIN_MS = 220`

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/pet-walk.test.ts`, perbarui helper di kepala berkas:

```ts
import { describe, expect, it } from "vitest";
import { durationMs } from "../src/screens/pet-sprite";
import {
  FALL_MIN_MS, FALL_PX_PER_S, LANE_MARGIN, MIN_WALK_PX, STAND_MS, WALK_MS, WALK_PX_PER_S,
  anchored, clampX, clampY, homeX, initialWalkState, isHandled, stepWalk,
  type PetWalkInput, type PetWalkState,
} from "../src/screens/pet-walk";

const LANE = 1000;
const LANE_H = 800;
const PET = 128;
const PET_H = 139;
const HOME = LANE - PET - LANE_MARGIN;
const CEILING = LANE_H - PET_H;   // 661

function input(over: Partial<PetWalkInput> = {}): PetWalkInput {
  return {
    now: 100_000, currentX: HOME, laneWidth: LANE, laneHeight: LANE_H, petWidth: PET, petHeight: PET_H,
    pose: "ready", hovered: false, panelOpen: false, documentHidden: false, roam: true, reduced: false,
    tier: "desktop", dragging: false, pointerX: 0, pointerY: 0,
    ...over,
  };
}
const standing = (x: number, until = Infinity, facing: "right" | "left" = "right"): PetWalkState =>
  ({ x, y: 0, facing, mode: "stand", until, parkedX: null });
const walking = (x: number, until: number, facing: "right" | "left" = "left"): PetWalkState =>
  ({ x, y: 0, facing, mode: "walk", until, parkedX: null });
const held = (x: number, y: number): PetWalkState =>
  ({ x, y, facing: "right", mode: "held", until: Infinity, parkedX: null });
// rng deterministik: urutan nilai yang ditentukan test.
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };
```

Perbarui juga assertion `initialWalkState` (baris 30) dan setiap `toEqual({ x: …, durationMs: 0 })`
menjadi bentuk empat field:

```ts
    expect(initialWalkState(LANE, PET, 0)).toEqual({
      x: HOME, y: 0, facing: "right", mode: "stand", until: STAND_MS[0], parkedX: null,
    });
```
```ts
    expect(step.move).toEqual({ x: HOME, y: 0, durationMs: 0, ease: "linear" });   // cabang terjangkar
```
```ts
    expect(step.move).toEqual({ x: 412, y: 0, durationMs: 0, ease: "linear" });    // cabang jeda
```
```ts
    expect(away.move).toEqual({ x: HOME, y: 0, ease: "linear",
      durationMs: Math.round(((HOME - 300) / WALK_PX_PER_S) * 1000) });            // cabang perhatian
```
```ts
    expect(step.move).toEqual({ x: 350, y: 0, durationMs: 0, ease: "linear" });    // cabang shipped
```
```ts
    expect(step.move).toEqual({ x: 420, y: 0, durationMs: 0, ease: "linear" });    // SPEC-897 offline/sleeping
```

Lalu tambahkan blok baru di ekor berkas:

```ts
describe("SPEC-905 — pet diseret", () => {
  it("diseret menang atas SEMUA cabang lain: terjangkar, jeda hover, pose perhatian, tidur", () => {
    for (const over of [
      { roam: false }, { reduced: true }, { tier: "mobile" as const },
      { hovered: true }, { panelOpen: true }, { documentHidden: true },
      { pose: "waiting" as const }, { pose: "sleeping" as const },
    ]) {
      const step = stepWalk(standing(300), input({ ...over, dragging: true, pointerX: 420, pointerY: 260 }), seq(0.5));
      expect(step.row).toBe("held");
      expect(step.state.mode).toBe("held");
      expect(step.state.until).toBe(Infinity);
      expect(step.move).toEqual({ x: 420, y: 260, durationMs: 0, ease: "linear" });
    }
  });

  it("mengikuti pointer di dua sumbu, di-clamp jalur dan plafon angkat", () => {
    expect(clampY(-40, LANE_H, PET_H)).toBe(0);
    expect(clampY(5_000, LANE_H, PET_H)).toBe(CEILING);
    const high = stepWalk(held(300, 100), input({ dragging: true, pointerX: 5_000, pointerY: 5_000 }), seq(0.5));
    expect(high.state.x).toBe(HOME);
    expect(high.state.y).toBe(CEILING);
    const low = stepWalk(held(300, 100), input({ dragging: true, pointerX: -900, pointerY: -900 }), seq(0.5));
    expect(low.state.x).toBe(LANE_MARGIN);
    expect(low.state.y).toBe(0);
  });

  it("dilepas dari ketinggian: jatuh dengan easing percepatan, durasi dari jaraknya", () => {
    const drop = stepWalk(held(420, 480), input({ currentX: 420 }), seq(0.5));
    expect(drop.row).toBe("falling");
    expect(drop.state.mode).toBe("falling");
    expect(drop.state.y).toBe(0);
    expect(drop.state.until).toBe(100_000 + 2_000);
    expect(drop.move).toEqual({ x: 420, y: 0, durationMs: 2_000, ease: "fall" });
    expect(Math.round((480 / FALL_PX_PER_S) * 1000)).toBe(2_000);
    // jatuhan sependek 20 px tetap terbaca sebagai jatuh
    expect(stepWalk(held(420, 20), input({ currentX: 420 }), seq(0.5)).move!.durationMs).toBe(FALL_MIN_MS);
  });

  it("selagi jatuh tak ada perpindahan baru, dan pergantian pose tak memotongnya", () => {
    const falling: PetWalkState = { x: 420, y: 0, facing: "right", mode: "falling", until: 102_000, parkedX: 420 };
    for (const over of [{}, { pose: "waiting" as const }, { hovered: true }, { roam: false }]) {
      const step = stepWalk(falling, input({ ...over, currentX: 420, now: 101_000 }), seq(0.5));
      expect(step.state).toBe(falling);
      expect(step.row).toBe("falling");
      expect(step.move).toBeNull();
    }
  });

  it("mendarat → pusing sekali putar → pose mesin dengan jadwal berdiri baru, di x tempat dilepas", () => {
    const falling: PetWalkState = { x: 420, y: 0, facing: "right", mode: "falling", until: 102_000, parkedX: 420 };
    const landed = stepWalk(falling, input({ currentX: 420, now: 102_000 }), seq(0.5));
    expect(landed.row).toBe("dizzy");
    expect(landed.state.mode).toBe("dizzy");
    expect(landed.state.until).toBe(102_000 + durationMs("dizzy"));
    expect(landed.move).toEqual({ x: 420, y: 0, durationMs: 0, ease: "linear" });
    // selagi pusing: tetap pusing, tak ada perpindahan
    const mid = stepWalk(landed.state, input({ currentX: 420, now: 102_500 }), seq(0.5));
    expect(mid.state).toBe(landed.state);
    expect(mid.row).toBe("dizzy");
    // selesai: baris pose mesin, berdiri di 420 — BUKAN melompat ke pojok, BUKAN langsung jalan lagi
    const done = stepWalk(landed.state, input({ currentX: 420, now: 103_100, pose: "working" }), seq(0.5));
    expect(done.row).toBe("working");
    expect(done.state).toEqual({
      x: 420, y: 0, facing: "right", mode: "stand", until: 103_100 + 1200 + 0.5 * 3300, parkedX: 420,
    });
    expect(done.move).toBeNull();
  });

  it("reduced-motion: jatuh seketika dan pusing DILEWATI", () => {
    const drop = stepWalk(held(420, 480), input({ currentX: 420, reduced: true }), seq(0.5));
    expect(drop.row).toBe("idle");                 // baris pose, bukan falling/dizzy
    expect(drop.state.mode).toBe("stand");
    expect(drop.state.y).toBe(0);
    expect(drop.state.parkedX).toBe(420);
    expect(drop.move).toEqual({ x: 420, y: 0, durationMs: 0, ease: "linear" });
  });

  it("dilepas tanpa terangkat (y = 0) melewati jatuh dan langsung pusing", () => {
    const drop = stepWalk(held(420, 0), input({ currentX: 420 }), seq(0.5));
    expect(drop.row).toBe("dizzy");
    expect(drop.state.parkedX).toBe(420);
  });

  it("isHandled menamai tiga mode yang memegang panggung sendiri", () => {
    expect(["held", "falling", "dizzy"].every(isHandled)).toBe(true);
    expect(["stand", "walk", "home"].some(isHandled)).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

```bash
pnpm vitest --run --root src test/pet-walk.test.ts
```
Expected: FAIL — `clampY is not a function` / `isHandled is not a function`, dan seluruh test seret
gagal karena `dragging` belum dibaca `stepWalk`.

- [ ] **Step 3: Implementasikan mesin**

Ganti seluruh isi `src/src/screens/pet-walk.ts` mulai dari header komentar sampai akhir dengan:

```ts
// Pet hidup (spec A) · mesin berkeliaran di tepi bawah. Murni: `stepWalk` menerima keadaan +
// masukan + rng dan mengembalikan keadaan baru, baris yang harus diputar, dan perpindahan yang harus
// dijalankan komponen (`translate` + durasi transisi). Tak ada timer di sini — komponen menjadwalkan
// SATU timeout pada `state.until` dan memanggil ulang saat `transitionend`/masukan berubah.
// SPEC-905 · mesin ini juga memegang pet yang DISERET: keadaan seret masuk sebagai masukan
// (`dragging`/`pointerX`/`pointerY`), keluar sebagai mode `held` → `falling` → `dizzy`.
import type { ResponsiveTier } from "../ds/responsive";
import type { PetPose } from "./pet-state";
import { POSE_ROW, durationMs, type PetRowKey } from "./pet-sprite";

export const WALK_PX_PER_S = 40;
// SPEC-905 · pet berjalan LEBIH SERING daripada berdiri. Rasionya disengaja, bukan selera: satu
// siklus tenang rata-rata kini 2,85 dtk berdiri + 9,5 dtk jalan (±72 % berjalan), kebalikan dari
// ±33 % milik [4000,12000]/[2000,6000] milik ADR-0140 — yang membuat sprite berjalan jarang
// terlihat berjalan. `WALK_PX_PER_S` tak ikut naik: yang kurang adalah DURASInya, bukan lajunya.
export const STAND_MS: readonly [number, number] = [1200, 4500];
export const WALK_MS: readonly [number, number] = [5000, 14000];
export const LANE_MARGIN = 16;
// Perpindahan lebih pendek dari ini bukan "jalan-jalan", cuma geser — arah dibalik atau diam.
export const MIN_WALK_PX = 24;
// SPEC-905 · jatuh ringan, bukan batu: ±1,7 dtk dari plafon 400 px. Percepatannya datang dari
// easing `fall` di komponen; yang linear di sini hanyalah laju rata-ratanya.
export const FALL_PX_PER_S = 240;
// Jatuhan sependek 20 px tetap harus terbaca sebagai jatuh, bukan sebagai kedip.
export const FALL_MIN_MS = 220;

export type PetFacing = "right" | "left";
export type PetWalkMode = "stand" | "walk" | "home" | "held" | "falling" | "dizzy";
export type PetEase = "linear" | "fall";
export type PetWalkState = {
  x: number;            // posisi tujuan/tempat berdiri (px dari kiri jalur)
  y: number;            // px DI ATAS lantai jalur; 0 = menapak
  facing: PetFacing;
  mode: PetWalkMode;
  until: number;        // kapan keadaan ini selesai (ms epoch); Infinity = menunggu masukan
  parkedX: number | null;   // tempat manusia terakhir meletakkannya; null = belum pernah diseret
};
export type PetWalkInput = {
  now: number;
  currentX: number;     // posisi aktual (dibaca komponen saat transisi dipotong)
  laneWidth: number;
  laneHeight: number;   // tinggi jalur yang boleh dipakai; sudah menghormati safe-area
  petWidth: number;
  petHeight: number;
  pose: PetPose;
  hovered: boolean;     // pointer hover ∨ fokus keyboard pada tombol
  panelOpen: boolean;
  documentHidden: boolean;
  roam: boolean;
  reduced: boolean;
  tier: ResponsiveTier;
  dragging: boolean;
  // Posisi yang DIMINTA untuk sudut kiri-bawah sprite, dalam koordinat jalur — bukan posisi pointer
  // mentah. Pengurangan titik pegang adalah aritmetika DOM dan hidup di komponen; yang murni —
  // clamp ke jalur dan ke plafon angkat — hidup di sini.
  pointerX: number;
  pointerY: number;
};
export type PetMove = { x: number; y: number; durationMs: number; ease: PetEase };
export type PetWalkStep = { state: PetWalkState; row: PetRowKey; move: PetMove | null };
export type Rng = () => number;

const ATTENTION: ReadonlySet<PetPose> = new Set(["waiting", "blocked"]);
// SPEC-897 · terputus & tidur = berhenti di tempat. Pulang ke pojok adalah gestur "kabar penting
// selalu di tempat yang sama"; di dua keadaan ini justru ketiadaan kabar yang sedang dikatakan.
const STILL: ReadonlySet<PetPose> = new Set(["offline", "sleeping"]);
const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + rng() * (hi - lo);
const walkRow = (facing: PetFacing): PetRowKey => (facing === "right" ? "walk-right" : "walk-left");

export const homeX = (laneWidth: number, petWidth: number): number =>
  Math.max(LANE_MARGIN, laneWidth - petWidth - LANE_MARGIN);

export const clampX = (x: number, laneWidth: number, petWidth: number): number =>
  Math.min(Math.max(x, LANE_MARGIN), homeX(laneWidth, petWidth));

export const clampY = (y: number, laneHeight: number, petHeight: number): number =>
  Math.min(Math.max(y, 0), Math.max(0, laneHeight - petHeight));

// SPEC-905 · tiga mode yang memegang panggung sendiri: selama salah satunya berjalan, baris
// sekali-putar milik komponen (`wave`/`thanks`) tak boleh menumpang di atasnya.
export const isHandled = (mode: PetWalkMode): boolean =>
  mode === "held" || mode === "falling" || mode === "dizzy";

export const anchored = (input: Pick<PetWalkInput, "roam" | "reduced" | "tier">): boolean =>
  !input.roam || input.reduced || input.tier === "mobile";

export function initialWalkState(laneWidth: number, petWidth: number, now: number): PetWalkState {
  return {
    x: homeX(laneWidth, petWidth), y: 0, facing: "right", mode: "stand",
    until: now + STAND_MS[0], parkedX: null,
  };
}

export function stepWalk(state: PetWalkState, input: PetWalkInput, rng: Rng): PetWalkStep {
  const { now, laneWidth, laneHeight, petWidth, petHeight, pose } = input;
  const home = homeX(laneWidth, petWidth);
  const poseRow = POSE_ROW[pose];
  const cur = clampX(input.currentX, laneWidth, petWidth);
  // Hanya jalan kaki yang punya transisi untuk DIPOTONG. Jatuh juga punya, tetapi memotongnya sama
  // dengan menghapus jatuhnya — cabang seret sudah `return` sebelum `cut` bisa terpanggil.
  const moving = state.mode === "walk" || state.mode === "home";
  const settled = state.mode === "dizzy";   // pusingnya baru saja habis (cabang 0d melewatkan yang belum)
  const stand = (x: number, until: number, facing: PetFacing = state.facing): PetWalkState =>
    ({ x, y: 0, facing, mode: "stand", until, parkedX: state.parkedX });
  const cut = (x: number): PetMove | null =>
    (moving || Math.abs(cur - x) > 0.5 ? { x, y: 0, durationMs: 0, ease: "linear" } : null);
  const walkTo = (to: number, mode: "walk" | "home"): PetWalkStep => {
    const durationMs = Math.round((Math.abs(to - cur) / WALK_PX_PER_S) * 1000);
    const facing: PetFacing = to >= cur ? "right" : "left";
    return {
      state: { x: to, y: 0, facing, mode, until: now + durationMs, parkedX: state.parkedX },
      row: walkRow(facing),
      move: { x: to, y: 0, durationMs, ease: "linear" },
    };
  };
  // Mendarat. Pusing sekali putar lalu kembali ke pose mesin lewat `until` — BUKAN lewat
  // `thenOf("dizzy")`: manifest menulis `then: "idle"`, dan rantai itu berbohong saat pose mesinnya
  // `working` (pet berdiri diam padahal ada sesi berjalan). Perpindahan `y → 0` selalu dipancarkan,
  // termasuk pada jalur reduced yang tak pernah melewati `falling` — tanpa itu sprite tertinggal
  // di udara karena komponen menyimpan `move` terakhir.
  const land = (x: number): PetWalkStep => {
    const move: PetMove = { x, y: 0, durationMs: 0, ease: "linear" };
    if (input.reduced) return { state: { ...stand(x, Infinity), parkedX: x }, row: poseRow, move };
    return {
      state: { x, y: 0, facing: state.facing, mode: "dizzy", until: now + durationMs("dizzy"), parkedX: x },
      row: "dizzy", move,
    };
  };

  // 0a · diseret. Menang atas SEMUA cabang lain: fisika tak boleh diinterupsi pergantian pose, dan
  // `anchored()` melarang gerak OTONOM — bukan manipulasi langsung yang diminta manusia. Karena itu
  // seret nyala di semua tier, termasuk mobile (keputusan spec SPEC-905 §5.2).
  if (input.dragging) {
    const x = clampX(input.pointerX, laneWidth, petWidth);
    const y = clampY(input.pointerY, laneHeight, petHeight);
    return {
      state: { x, y, facing: state.facing, mode: "held", until: Infinity, parkedX: state.parkedX },
      row: "held",
      move: { x, y, durationMs: 0, ease: "linear" },
    };
  }

  // 0b · dilepas. `parkedX` dicap di sini: tempat manusia meletakkannya adalah posisi baru pet.
  if (state.mode === "held") {
    if (input.reduced || state.y === 0) return land(state.x);
    const fallMs = Math.max(FALL_MIN_MS, Math.round((state.y / FALL_PX_PER_S) * 1000));
    return {
      state: { x: state.x, y: 0, facing: state.facing, mode: "falling", until: now + fallMs, parkedX: state.x },
      row: "falling",
      move: { x: state.x, y: 0, durationMs: fallMs, ease: "fall" },
    };
  }

  // 0c · sedang jatuh: tak ada perpindahan baru sampai mendarat.
  if (state.mode === "falling") {
    if (now < state.until) return { state, row: "falling", move: null };
    return land(state.x);
  }

  // 0d · sedang pusing.
  if (state.mode === "dizzy" && now < state.until) return { state, row: "dizzy", move: null };

  // 1 · terjangkar (mobile / reduced / roam mati): berdiri di tempat manusia meletakkannya, atau di
  // rumah bila belum pernah diseret. Predikat `anchored()` tak berubah — hanya TITIK jangkarnya.
  if (anchored(input)) {
    const at = clampX(state.parkedX ?? home, laneWidth, petWidth);
    return { state: stand(at, Infinity, "right"), row: poseRow, move: cut(at) };
  }

  // 2 · jeda: hover, panel terbuka, tab tersembunyi — berhenti di tempat.
  if (input.hovered || input.panelOpen || input.documentHidden)
    return { state: stand(cur, Infinity), row: poseRow, move: cut(cur) };

  // 3 · terputus / tidur: berhenti di tempat, baris pose diputar.
  if (STILL.has(pose))
    return { state: stand(cur, Infinity), row: poseRow, move: cut(cur) };

  // 4 · pose perhatian: pulang ke pojok kanan dulu, lalu berdiri memutar baris pose.
  if (ATTENTION.has(pose)) {
    if (Math.abs(cur - home) > 1) {
      if (state.mode === "home" && now < state.until) return { state, row: walkRow(state.facing), move: null };
      return walkTo(home, "home");
    }
    return { state: stand(home, Infinity, "right"), row: poseRow, move: cut(home) };
  }

  // 5 · shipped: berhenti di tempat; baris sekali-putarnya diurus komponen.
  if (pose === "shipped")
    return { state: stand(cur, Infinity), row: poseRow, move: cut(cur) };

  // 6 · pose tenang: bergantian berdiri / jalan.
  if (moving) {
    if (now < state.until) return { state, row: walkRow(state.facing), move: null };
    return { state: stand(state.x, now + between(rng, STAND_MS)), row: poseRow, move: null };   // tiba
  }
  // Baru selesai pusing mendapat jadwal BERDIRI, bukan langsung jalan lagi — sama seperti berdiri
  // tanpa batas yang jedanya berakhir.
  if (settled || state.until === Infinity)
    return { state: stand(cur, now + between(rng, STAND_MS)), row: poseRow, move: null };
  if (now < state.until) return { state, row: poseRow, move: null };

  const dist = (between(rng, WALK_MS) * WALK_PX_PER_S) / 1000;
  let dir = rng() < 0.5 ? -1 : 1;
  let target = clampX(cur + dir * dist, laneWidth, petWidth);
  if (Math.abs(target - cur) < MIN_WALK_PX) {
    dir = -dir;
    target = clampX(cur + dir * dist, laneWidth, petWidth);
  }
  if (Math.abs(target - cur) < MIN_WALK_PX)   // jalur terlalu sempit untuk jalan-jalan
    return { state: stand(cur, now + between(rng, STAND_MS)), row: poseRow, move: null };
  return walkTo(target, "walk");
}
```

> `cut()` menggantikan `moving ? {…} : null` di cabang 2/3/5 dan `moving ? {x: home, …} : null` di
> cabang 4. Bentuknya identik untuk kasus lama (`moving` → perpindahan, berdiri di tempat → `null`)
> dan **menambah** satu kasus yang sebelumnya tak ada: berdiri di tempat yang BUKAN posisi
> sekarang — persis yang terjadi sesudah dizzy pada mesin ini.

- [ ] **Step 4: Jalankan test — pastikan hijau**

```bash
pnpm vitest --run --root src test/pet-walk.test.ts
```
Expected: PASS, **kecuali** blok `parkedX` di jangkar (Task 3) yang belum ditulis. Semua test lama +
blok "SPEC-905 — pet diseret" lulus.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/pet-walk.ts src/test/pet-walk.test.ts
git commit -m "feat(pet): mesin memegang held/falling/dizzy + sumbu Y, tetap murni (SPEC-905)"
```

---

### Task 3: `parkedX` — tempat manusia meletakkannya menjadi jangkar

**Files:**
- Modify: — (kodenya sudah ditulis di Task 2 cabang 1; task ini menguncinya dengan test)
- Test: `src/test/pet-walk.test.ts`

**Interfaces:**
- Consumes: `PetWalkState.parkedX`, `anchored`, `homeX`, `clampX` dari Task 2.
- Produces: —

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di dalam `describe("SPEC-905 — pet diseret", …)`:

```ts
  it("terjangkar berdiri di tempat manusia meletakkannya, bukan melompat balik ke pojok", () => {
    const parked: PetWalkState = { x: 240, y: 0, facing: "right", mode: "stand", until: Infinity, parkedX: 240 };
    for (const over of [{ roam: false }, { reduced: true }, { tier: "mobile" as const }]) {
      const step = stepWalk(parked, input({ ...over, currentX: 240 }), seq(0.5));
      expect(anchored(input(over))).toBe(true);
      expect(step.state.x).toBe(240);
      expect(step.move).toBeNull();          // sudah di sana → tak ada perpindahan
    }
    // belum pernah diseret → tetap rumah (perilaku ADR-0140, tak berubah)
    expect(stepWalk(standing(300), input({ roam: false, currentX: 300 }), seq(0.5)).state.x).toBe(HOME);
  });

  it("jangkar mengikuti seret walau terjangkar: seret → lepas → berdiri di sana", () => {
    const dragged = stepWalk(standing(HOME), input({ tier: "mobile", dragging: true, pointerX: 200, pointerY: 300 }), seq(0.5));
    expect(dragged.state.mode).toBe("held");
    const dropped = stepWalk(dragged.state, input({ tier: "mobile", currentX: 200 }), seq(0.5));
    expect(dropped.state.parkedX).toBe(200);
    const next = stepWalk({ ...dropped.state, mode: "stand", until: Infinity }, input({ tier: "mobile", currentX: 200 }), seq(0.5));
    expect(next.state.x).toBe(200);
    expect(next.move).toBeNull();
  });

  it("jangkar yang keluar jalur sesudah resize di-clamp, tidak menggantung", () => {
    const parked: PetWalkState = { x: 900, y: 0, facing: "right", mode: "stand", until: Infinity, parkedX: 900 };
    const step = stepWalk(parked, input({ roam: false, laneWidth: 400, currentX: 900 }), seq(0.5));
    expect(step.state.x).toBe(homeX(400, PET));
    expect(step.move).toEqual({ x: homeX(400, PET), y: 0, durationMs: 0, ease: "linear" });
  });
```

- [ ] **Step 2: Jalankan test — pastikan hasilnya sesuai**

```bash
pnpm vitest --run --root src test/pet-walk.test.ts -t "SPEC-905"
```
Expected: PASS (cabang 1 sudah ditulis di Task 2). Bila salah satu MERAH, cabang 1 belum memakai
`state.parkedX ?? home` — perbaiki di `pet-walk.ts`, bukan di test.

- [ ] **Step 3: Jalankan seluruh berkas test mesin**

```bash
pnpm vitest --run --root src test/pet-walk.test.ts
```
Expected: PASS, tanpa "no test files".

- [ ] **Step 4: Commit**

```bash
git add src/test/pet-walk.test.ts
git commit -m "test(pet): kunci parkedX sebagai jangkar sesudah pet diletakkan (SPEC-905)"
```

---

### Task 4: Komponen — koordinat selisih, jalur yang melebar, transform dua sumbu, gestur

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx`
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: seluruh permukaan Task 2 (`PetEase`, `PetMove`, `isHandled`, `stepWalk`).
- Produces: `DRAG_SLOP_PX = 6` (konstanta modul di `HanomanPet.tsx`); atribut DOM
  `[data-testid="pet-actor"]` ber-`transform: translate(<x>px, <-y>px)`; `[data-testid="pet-root"]`
  ber-`top` hanya selagi terangkat.

- [ ] **Step 1: Tulis helper + test yang gagal**

Tambahkan helper di kepala `src/test/hanoman-pet.test.tsx`, di bawah `animationEnd`:

```ts
// jsdom 24 tak punya `PointerEvent`, jadi `fireEvent.pointerDown(el, { clientX })` jatuh ke `Event`
// polos dan handler menerima `clientX === null` — test seret yang memakainya HIJAU PALSU. `MouseEvent`
// membawa koordinatnya, dan React memetakan tipe `pointer*` apa adanya.
function pointer(el: HTMLElement, type: string, clientX: number, clientY: number, pointerId = 1): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(el, event);
}
const actor = () => screen.getByTestId("pet-actor");
const laneOf = () => screen.getByTestId("pet-root");
```

Perbarui tiga assertion lama yang menyebut `translateX` menjadi bentuk dua sumbu
(baris 182, 230, 244):

```ts
    expect(actor).toHaveStyle({ transition: "none", transform: `translate(${HOME}px, 0px)` });
```
```ts
    expect(screen.getByTestId("pet-actor")).toHaveStyle({ transform: `translate(${HOME}px, 0px)` });
```
```ts
    expect(screen.getByTestId("pet-actor")).toHaveStyle({ transform: `translate(${homeX(window.innerWidth, cellW)}px, 0px)` });
```

Perbarui test "berjalan di jalur saat jadwal berdiri habis…" (baris 250–272) ke angka baru:

```ts
  it("berjalan di jalur saat jadwal berdiri habis: transisi transform linear ke target", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(0.5);   // jalan 9,5 dtk = 380 px; arah kanan → balik kiri dari rumah
      render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
      expect(actor()).toHaveAttribute("data-mode", "stand");
      act(() => { vi.advanceTimersByTime(1_300); });     // STAND_MS[0] = 1,2 dtk
      expect(actor()).toHaveAttribute("data-mode", "walk");
      expect(actor()).toHaveAttribute("data-facing", "left");
      expect(actor()).toHaveStyle({ transform: `translate(${HOME - 380}px, 0px)`, transition: "transform 9500ms linear" });
      expect(rowshift()).toHaveAttribute("data-row", "walk-left");
      // tiba (transitionend) → berdiri di target, baris pose
      const end = new Event("transitionend", { bubbles: true });
      Object.defineProperty(end, "propertyName", { value: "transform" });
      act(() => { vi.advanceTimersByTime(9_500); fireEvent(actor(), end); });
      expect(actor()).toHaveAttribute("data-mode", "stand");
      expect(rowshift()).toHaveAttribute("data-row", "idle");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
```

Lalu tambahkan blok baru di ekor berkas:

```ts
describe("HanomanPet — pet diseret (SPEC-905)", () => {
  const CEILING = window.innerHeight - CELL_H;

  it("seret mengangkat pet di dua sumbu, memutar baris held, tanpa transisi menyusul", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(laneOf()).toHaveStyle({ height: `${CELL_H}px` });

    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 500);

    expect(rowshift()).toHaveAttribute("data-row", "held");
    expect(actor()).toHaveAttribute("data-mode", "held");
    // selisih: x −40, y +200 dari HOME/0
    expect(actor()).toHaveStyle({ transform: `translate(${HOME - 40}px, -200px)`, transition: "none" });
    // jalur melebar HANYA sekarang, dan tetap tak menangkap pointer
    expect(laneOf()).toHaveStyle({ top: "max(0px, var(--safe-top))", pointerEvents: "none" });
    expect(laneOf().style.height).toBe("");
  });

  it("plafon angkat menghormati tinggi jalur; jalur tak pernah dilewati ke bawah", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 500, -9_000);
    expect(actor()).toHaveStyle({ transform: `translate(${HOME}px, -${CEILING}px)` });
    pointer(hit(), "pointermove", 500, 9_000);
    expect(actor()).toHaveStyle({ transform: `translate(${HOME}px, 0px)` });
  });

  it("dilepas: jatuh dengan easing percepatan, lalu pusing, lalu baris pose — jalur menyusut lagi", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 460);          // terangkat 240 px
    pointer(hit(), "pointerup", 460, 460);

    expect(rowshift()).toHaveAttribute("data-row", "falling");
    expect(actor()).toHaveStyle({
      transform: `translate(${HOME - 40}px, 0px)`,
      transition: "transform 1000ms cubic-bezier(0.55, 0.085, 0.68, 0.53)",
    });

    const end = new Event("transitionend", { bubbles: true });
    Object.defineProperty(end, "propertyName", { value: "transform" });
    fireEvent(actor(), end);

    expect(rowshift()).toHaveAttribute("data-row", "dizzy");
    expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("dizzy")}ms steps(8, end) 1 forwards` });
    expect(laneOf()).toHaveStyle({ height: `${CELL_H}px` });   // menyusut kembali begitu mendarat
  });

  it("mesin berkeliaran melanjutkan dari x tempat pet dilepas, tidak melompat ke pojok", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
      pointer(hit(), "pointerdown", 500, 700);
      pointer(hit(), "pointermove", 300, 700);        // geser 200 px ke kiri, tetap di lantai
      pointer(hit(), "pointerup", 300, 700);
      act(() => { vi.advanceTimersByTime(durationMs("dizzy") + 50); });   // pusing selesai
      expect(actor()).toHaveStyle({ transform: `translate(${HOME - 200}px, 0px)` });
      expect(actor()).toHaveAttribute("data-mode", "stand");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("ambang 6 px memisahkan klik dari seret: di bawahnya panel terbuka, di atasnya tidak", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 504, 700);          // 4 px → masih klik
    pointer(hit(), "pointerup", 504, 700);
    fireEvent.click(hit());
    expect(screen.getByTestId("pet-panel")).toBeInTheDocument();
    expect(rowshift()).toHaveAttribute("data-row", "wave");
  });

  it("seret tidak membuka panel dan tidak memicu thanks walau tiga kali berturut-turut", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    for (let i = 0; i < 3; i++) {
      pointer(hit(), "pointerdown", 500, 700);
      pointer(hit(), "pointermove", 460, 660);
      pointer(hit(), "pointerup", 460, 660);
      fireEvent.click(hit());                        // `click` menyusul `pointerup` di elemen yang sama
    }
    expect(screen.queryByTestId("pet-panel")).toBeNull();
    expect(screen.queryByTestId("pet-hearts")).toBeNull();
  });

  it("pointercancel dilayani seperti pointerup: pet tidak tertinggal di udara", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 460);
    pointer(hit(), "pointercancel", 460, 460);
    expect(rowshift()).toHaveAttribute("data-row", "falling");
  });

  it("tombol pet menolak gulir & seleksi selama gestur seret", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(hit()).toHaveStyle({ touchAction: "none", userSelect: "none", cursor: "grab" });
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 500);
    expect(hit()).toHaveStyle({ cursor: "grabbing" });
  });

  it("reduced-motion: seret tetap boleh, jatuh seketika, pusing dilewati", () => {
    mockMatchMedia((q) => q === REDUCED);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 460);
    expect(rowshift()).toHaveAttribute("data-row", "held");
    pointer(hit(), "pointerup", 460, 460);
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    expect(actor()).toHaveStyle({ transform: `translate(${HOME - 40}px, 0px)`, transition: "none" });
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

```bash
pnpm vitest --run --root src test/hanoman-pet.test.tsx -t "pet diseret"
```
Expected: FAIL — `expected "translateX(880px)" to equal "translate(840px, -200px)"`; jalur tak pernah
memperoleh `top`.

- [ ] **Step 3: Implementasikan komponen**

Di `src/src/screens/HanomanPet.tsx`:

**3.1 — impor & konstanta.** Ganti baris 18 dan tambahkan dua konstanta setelah `PET_CLICK_BURST`:

```ts
import {
  initialWalkState, isHandled, stepWalk, type PetEase, type PetMove, type PetWalkState,
} from "./pet-walk";
```

dan setelah `const PET_CLICK_BURST = 3;`:

```ts
// SPEC-905 · di bawah ambang ini gestur masih KLIK (panel + elus SPEC-898); melewatinya ia seret,
// dan `click` yang menyusul `pointerup` ditelan supaya `thanks` tak ikut terpicu.
const DRAG_SLOP_PX = 6;
// Percepatan, bukan linear (easeInQuad). `linear` tetap untuk jalan kaki, yang lajunya memang tetap.
const PET_EASE_CSS: Record<PetEase, string> = {
  linear: "linear",
  fall: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
};
```

**3.2 — state seret.** Setelah `const [move, setMove] = …` (baris 186), ganti nilai awal `move` dan
tambahkan state seret:

```ts
  const [move, setMove] = React.useState<PetMove>({ x: walkRef.current.x, y: 0, durationMs: 0, ease: "linear" });
  // Posisi yang diminta pointer, dalam koordinat jalur; `null` = tidak sedang diseret.
  const [drag, setDrag] = React.useState<{ x: number; y: number } | null>(null);
  const dragRef = React.useRef<{ id: number; dx: number; dy: number; x0: number; y0: number; moved: boolean } | null>(null);
  const swallowClickRef = React.useRef(false);
```

**3.3 — plafon angkat.** Tepat setelah `currentX` (baris 190–194) tambahkan:

```ts
  // Plafon angkat = tinggi jalur yang SUDAH melebar; jalur itu sendiri dibatasi `var(--safe-top)` /
  // `var(--safe-bottom)`, jadi ia dibaca dari elemen yang memakainya alih-alih memparsing custom
  // property (yang mengembalikan token `env(...)` yang belum di-resolve). Sebelum jalur melebar —
  // dan di jsdom yang memberi rect nol — viewport dipakai apa adanya; di sana `y` masih 0 sehingga
  // clamp-nya memang tak berpengaruh.
  const laneHeight = React.useCallback((): number => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect && rect.height > cellH) return rect.height;
    return typeof window !== "undefined" ? window.innerHeight : cellH;
  }, [cellH]);
```

**3.4 — `tick` membawa masukan baru.** Ganti isi `tick` (baris 205–214):

```ts
  const tick = React.useCallback(() => {
    const step = stepWalk(walkRef.current, {
      now: Date.now(), currentX: currentX(), laneWidth, laneHeight: laneHeight(),
      petWidth: cellW, petHeight: cellH, pose: view.pose,
      hovered, panelOpen: open, documentHidden, roam, reduced, tier,
      dragging: drag !== null, pointerX: drag?.x ?? 0, pointerY: drag?.y ?? 0,
    }, Math.random);
    walkRef.current = step.state;
    setWalk(step.state);
    setRow(step.row);
    if (step.move) setMove(step.move);
  }, [currentX, laneHeight, laneWidth, cellW, cellH, view.pose, hovered, open, documentHidden,
      roam, reduced, tier, drag]);
```

**3.5 — handler gestur.** Setelah `function reactAndToggle()` (baris 303) tambahkan:

```ts
  // Titik pegang disimpan sebagai SELISIH, bukan rect: `getBoundingClientRect()` memberi nol di
  // jsdom, dan pada aritmetika selisih offset jalur (`root.left`/`root.bottom`) saling menghilangkan
  // — jadi rumus yang sama benar di browser dan bisa di-assert di test.
  function beginGesture(event: React.PointerEvent<HTMLButtonElement>) {
    // jsdom 24 tak punya pointer capture; tanpa penjaga ini SETIAP test seret melempar TypeError.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      id: event.pointerId, dx: event.clientX - currentX(), dy: event.clientY + walkRef.current.y,
      x0: event.clientX, y0: event.clientY, moved: false,
    };
  }

  function moveGesture(event: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.id !== event.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(event.clientX - d.x0, event.clientY - d.y0) <= DRAG_SLOP_PX) return;
      d.moved = true;
      // Panel dijangkar ke posisi pet saat dibuka; pet yang sedang pergi membuatnya berbohong.
      if (open) closePanel();
      setOneShot(null);   // `wave` yang menumpang akan menutupi baris `held`
    }
    setDrag({ x: event.clientX - d.dx, y: d.dy - event.clientY });
  }

  function endGesture(event: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.id !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!d.moved) return;
    swallowClickRef.current = true;   // `click` menyusul `pointerup` di elemen yang sama
    setDrag(null);
  }
```

**3.6 — jalur yang melebar.** Ganti blok `const root` (baris 319–325):

```ts
  // Jalur: selebar viewport di tepi bawah, setinggi satu sel. z 80: di bawah header (90), overlay
  // terminal fullscreen (100), Modal (150), Toast (200). `pointerEvents: none` di seluruh jalur —
  // konten di bawah jalur tetap menerima tap; yang `auto` hanya tombol 44 px, pegangan, dan panel.
  // SPEC-905 · selagi pet terangkat jalur memanjang ke atas sampai `var(--safe-top)`, dan HANYA
  // selagi itu. Tepi BAWAHnya tak bergerak, jadi sprite, panel, dan gelembung tak bergeser satu
  // piksel pun saat ia melebar. Bukan soal clipping (`pet-root` tak punya `overflow`): yang dibeli
  // adalah plafon angkat yang bisa DIUKUR dari CSS-nya sendiri, plus hit-test yang tetap benar bila
  // kelak sebuah ancestor memperoleh `transform`/`contain`.
  const lifted = isHandled(walk.mode) && walk.mode !== "dizzy";
  const root: React.CSSProperties = {
    position: "fixed", left: 0, right: 0, bottom: "max(0px, var(--safe-bottom))",
    ...(lifted ? { top: "max(0px, var(--safe-top))" } : { height: cellH }),
    zIndex: 80, pointerEvents: "none",
  };
```

**3.7 — transform dua sumbu.** Ganti dua baris di `pet-actor` (baris 431–432):

```ts
          // Satu properti untuk kedua sumbu, JUGA saat y = 0: daftar properti yang di-transisi tak
          // boleh berganti di tengah rantai berjalan → diangkat → jatuh → mendarat.
          transform: `translate(${move.x}px, ${-move.y}px)`,
          transition: reduced || move.durationMs === 0
            ? "none"
            : `transform ${move.durationMs}ms ${PET_EASE_CSS[move.ease]}`,
```

**3.8 — tombol pet.** Ganti blok `<button data-testid="pet-hit" …>` (baris 538–548):

```tsx
          <button data-testid="pet-hit" aria-label="Ringkasan status Hanoman" title={`${view.headline} — ${view.detail}`}
            onClick={() => {
              if (swallowClickRef.current) { swallowClickRef.current = false; return; }
              reactAndToggle();
            }}
            onPointerDown={beginGesture}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onPointerEnter={() => { setHovered(true); playWave(); }}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            style={{
              pointerEvents: "auto", position: "absolute", zIndex: 3,
              left: Math.round(anchor.x * cellW - HIT / 2), bottom: 0, width: HIT, height: HIT,
              padding: 0, border: "none", background: "transparent",
              // Seret tak boleh menggulir halaman maupun menyeleksi teks; `grab`/`grabbing` adalah
              // afordansinya. Permukaannya tetap 44×44 px (SPEC-763) — tak ada pelebaran badan pet.
              cursor: lifted ? "grabbing" : "grab",
              touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
            }} />
```

- [ ] **Step 4: Jalankan test — pastikan hijau**

```bash
pnpm vitest --run --root src test/hanoman-pet.test.tsx
```
Expected: PASS untuk seluruh berkas (blok lama + blok "pet diseret"). Jika
`expect(hit()).toHaveStyle({ userSelect: "none" })` merah, periksa bahwa **kedua** properti
(`userSelect` dan `WebkitUserSelect`) ditulis — jsdom hanya memantulkan yang pertama.

- [ ] **Step 5: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./src typecheck
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): pet bisa diseret — Pointer Events, sumbu Y, jalur melebar sesaat (SPEC-905)"
```

---

### Task 5: Lambaian yang menetap selama pointer menempel

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx` (`playWave`, `playThanks`, `onAnimationEnd` atlas)
- Test: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `isHandled` (Task 2), `oneShot` state yang sudah ada.
- Produces: `oneShot.id` menjadi **penghitung naik** (bukan `Date.now()`).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di dalam `describe("HanomanPet — pet diseret (SPEC-905)", …)`:

```ts
  it("hover memutar wave BERULANG; lepas hover menyelesaikan putaran lalu berhenti", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "wave");
    const first = atlas();

    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "wave");   // putaran ke-2
    expect(atlas()).not.toBe(first);                          // `key` baru → animasi restart
    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "wave");   // putaran ke-3

    fireEvent.pointerLeave(hit());
    expect(rowshift()).toHaveAttribute("data-row", "wave");   // TIDAK dipotong di tengah
    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "idle");   // baru berhenti di batas putaran
  });

  it("tidak melambai selagi diangkat, jatuh, atau pusing", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    pointer(hit(), "pointerdown", 500, 700);
    pointer(hit(), "pointermove", 460, 460);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "held");
    pointer(hit(), "pointerup", 460, 460);
    fireEvent.pointerEnter(hit());
    expect(rowshift()).toHaveAttribute("data-row", "falling");
  });
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

```bash
pnpm vitest --run --root src test/hanoman-pet.test.tsx -t "wave BERULANG"
```
Expected: FAIL — `expected data-row "idle" to be "wave"` pada putaran ke-2.

- [ ] **Step 3: Implementasikan**

Di `src/src/screens/HanomanPet.tsx`:

**3.1** — ganti blok `playWave`/`playThanks` (baris 225–243) dengan:

```ts
  const [oneShot, setOneShot] = React.useState<{ row: PetRowKey; id: number } | null>(null);
  // `key` React pada <img> adalah `${displayRow}:${id}`. Dua putaran `wave` yang selesai di
  // milidetik yang sama memberi `key` identik sehingga animasinya TAK restart — lambaian berhenti
  // diam-diam. Penghitung naik tak bisa bertabrakan; `Date.now()` bisa.
  const oneShotSeq = React.useRef(0);
  const clicksRef = React.useRef<number[]>([]);
  const [hearts, setHearts] = React.useState(0);
  const [shippedDone, setShippedDone] = React.useState(false);
  React.useEffect(() => { setShippedDone(false); }, [view.pose]);
  const baseRow: PetRowKey = row === "shipped" && shippedDone ? (thenOf("shipped") ?? "idle") : row;
  const displayRow: PetRowKey = oneShot?.row ?? baseRow;
  const display = rowOf(displayRow);
  // Melambai atas data basi, atau melambai sambil tidur, keduanya berbohong — dan sejak SPEC-905
  // melambai sambil diangkat/jatuh/pusing juga: tiga baris itu memegang panggung sendiri.
  const canWave = React.useCallback((): boolean =>
    !reduced && view.pose !== "offline" && view.pose !== "sleeping"
    && drag === null && !isHandled(walkRef.current.mode), [reduced, view.pose, drag]);
  const playWave = React.useCallback(() => {
    if (!canWave()) return;
    setOneShot((o) => o ?? { row: "wave", id: ++oneShotSeq.current });
  }, [canWave]);

  const playThanks = React.useCallback(() => {
    if (reduced) return;
    setOneShot({ row: "thanks", id: ++oneShotSeq.current });   // menggantikan `wave` yang mungkin sedang main
    setHearts((n) => n + 1);
  }, [reduced]);
```

**3.2** — ganti `onAnimationEnd` pada `<img data-testid="pet-atlas">` (baris 526–530):

```tsx
                  onAnimationEnd={(event) => {
                    if (event.animationName !== "hn-pet-frames") return;
                    if (oneShot) {
                      // Hover yang masih menempel memulai putaran BERIKUTNYA di batas putaran, jadi
                      // lambaian tak pernah terpotong di tengah — dan lepas hover pun tak memotongnya.
                      if (oneShot.row === "wave" && hovered && canWave())
                        setOneShot({ row: "wave", id: ++oneShotSeq.current });
                      else setOneShot(null);
                      return;
                    }
                    if (displayRow === "shipped") setShippedDone(true);
                  }}
```

- [ ] **Step 4: Jalankan test — pastikan hijau**

```bash
pnpm vitest --run --root src test/hanoman-pet.test.tsx
```
Expected: PASS untuk seluruh berkas, termasuk test lama "klik memutar wave sekali lalu kembali ke
baris pose lewat animationend" (klik tak menyalakan `hovered`, jadi ia tetap sekali putar).

- [ ] **Step 5: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
pnpm vitest --run --root src test/pet-walk.test.ts test/hanoman-pet.test.tsx test/pet-mount.test.tsx test/pet-state.test.ts test/pet-sprite.test.ts test/pet-speech.test.ts
```
Expected: PASS, dan jumlah test yang berjalan **bukan nol** (jangan terima "no test files").

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): lambaian menetap selama pointer menempel, berhenti di batas putaran (SPEC-905)"
```

---

### Task 6: Docs Source of Truth, ADR-0144, dan verifikasi nyata di browser

**Files:**
- Create: `internal/docs/adr/0144-pet-diseret-sumbu-y-jalur-melebar.md`
- Modify: `internal/docs/frontend/frontend-implementation.md` (§Pet)
- Modify: `internal/docs/README.md` (daftar ADR + baris `frontend-implementation`)
- Modify: `internal/docs/adr/README.md` (narasi ADR)

**Interfaces:**
- Consumes: seluruh perilaku Task 1–5.
- Produces: —

- [ ] **Step 1: Verifikasi nyata di browser (CDP), sebelum menulis docs**

Docs menuliskan angka; angkanya harus datang dari pengukuran, bukan dari plan ini. Jalankan
dashboard dev dan ukur di Chrome headless lewat CDP (memori `hanoman-browser-smoke-via-cdp`;
`/json/list` mendahulukan target `browser_ui` 0×0 — ambil `type === "page"`; `--window-size` tak
menetapkan layout viewport di `headless=new` — pakai `Emulation.setDeviceMetricsOverride`).

Yang **wajib** diukur dan dicatat angkanya:
1. `data-row` berturut-turut selama satu seret penuh: `idle`/`walk-*` → `held` → `falling` → `dizzy`
   → baris pose. Tak boleh ada baris lain menyelip.
2. `getComputedStyle(actor).transform` pada tiga titik (terangkat, tengah jatuh, mendarat) — matriks
   translasi Y harus **monoton menurun** dan **tidak** kembali ke nilai sebelumnya (tak ada menyusul).
3. Tinggi `pet-root` sebelum, selagi, dan sesudah seret.
4. `document.elementFromPoint(innerWidth/2, innerHeight/2)` **selagi jalur melebar** — harus tetap
   mengembalikan konten dashboard, bukan `pet-root`.
5. Apakah `pet-root` benar-benar meng-clip sprite yang diangkat bila jalur TIDAK dilebarkan
   (premis brief §2 spec) — catat hasilnya apa adanya.
6. Ulangi (1)–(4) pada emulasi 390×844 dengan `<meta name="viewport">` yang sama dengan
   `src/index.html`.

- [ ] **Step 2: Tulis ADR-0144**

Buat `internal/docs/adr/0144-pet-diseret-sumbu-y-jalur-melebar.md` dengan bagian:
judul + `Tanggal: 2026-08-23 · Status: diterima · Sumber: spec docs/superpowers/specs/2026-08-23-spec-905-pet-diseret-design.md`;
baris "Mengamandemen ADR-0140 keputusan 5 (mesin berkeliaran) dan butir DOM-nya; menegakkan ADR-0039,
ADR-0024, ADR-0037, dan grammar SPEC-648"; `## Konteks`; `## Keputusan` berisi **tujuh** butir —
(1) sumbu Y + tiga mode di mesin murni, keadaan seret masuk sebagai masukan;
(2) `parkedX` sebagai titik jangkar, predikat `anchored()` tak berubah, dan **seret nyala di semua
tier termasuk mobile** beserta alasannya;
(3) rasio berkeliaran dibalik (angka lama → baru, dengan persentasenya);
(4) jalur melebar **hanya** selagi terangkat, tepi bawah tak bergerak, `pointer-events: none` utuh;
(5) satu properti `transform` untuk kedua sumbu + easing `fall` = easeInQuad, `move.durationMs === 0`
sebagai jalur "potong";
(6) `dizzy` dikembalikan ke pose lewat `until` mesin, **bukan** `thenOf` — beserta alasan
"`then: "idle"` berbohong saat pose `working`";
(7) lambaian menetap: keputusan lanjut/berhenti hanya di `animationend`, dan `oneShot.id` wajib
penghitung naik.
`## Konsekuensi` memuat **angka hasil Step 1** apa adanya (termasuk hasil butir 5, walau ia
membantah premis brief), plus dua jebakan jsdom §3 spec sebagai catatan untuk pembaca berikutnya.

- [ ] **Step 3: Perbarui §Pet di `frontend-implementation.md`**

Di `internal/docs/frontend/frontend-implementation.md`:
- Judul §Pet (baris 283): tambahkan `· Pet hidup F SPEC-905 ADR-0144`.
- Blok pohon DOM (baris ±404–417): `pet-root` memperoleh catatan "`top: max(0px, var(--safe-top))`
  HANYA selagi `held`/`falling`"; `pet-actor` menjadi
  `transform: translate(var(--x), calc(-1 * var(--y))) · transition: transform <segmen> <linear|fall>`.
- Tabel **Mesin berkeliaran** (baris ±434–441): angka `4–12`/`2–6` → `1,2–4,5`/`5–14` dtk, dan
  **tiga baris baru** di kepala tabel untuk `dragging`, `dilepas`, dan `mendarat`; baris
  `tier === "mobile" ∨ reduced ∨ !roam` diberi klausa "di `parkedX` bila pernah diseret".
- Paragraf **Penjadwalan**: catat bahwa `transitionend` kini juga yang menutup fase `falling`.
- Paragraf baru **Pet diseret (SPEC-905)** setelah "Mesin berkeliaran": gestur & ambang 6 px,
  koordinat selisih (dan mengapa bukan `getBoundingClientRect`), plafon angkat yang dibaca dari jalur
  yang melebar, `reduced-motion` melewati `dizzy`, keputusan mobile, dan tak ada persistensi posisi.
- Paragraf `wave` (baris ±509–516): ganti "sekali" menjadi "berulang selama pointer menempel,
  berhenti di batas putaran", dan sebutkan `oneShot.id` sebagai penghitung naik.

- [ ] **Step 4: Tautkan di index**

Di `internal/docs/README.md`:
- Tambahkan baris ADR baru **di atas** baris 0143:
  `- [0144 — Pet yang diseret: sumbu Y di jalur pet, tiga mode fisika di mesin murni, jalur yang melebar hanya selagi terangkat](adr/0144-pet-diseret-sumbu-y-jalur-melebar.md) — mengamandemen 0140 pada mesin berkeliaran & bentuk jalur; menegakkan 0039, 0024 & 0037 (SPEC-905)`
- Perbarui ekor baris `frontend-implementation` (baris 247) dengan
  `· Pet hidup F SPEC-905 ADR-0144 pet diseret + berkeliaran mayoritas + lambaian menetap`.

Di `internal/docs/adr/README.md`: tambahkan narasi ADR-0144 mengikuti bentuk entri 0140–0143.

- [ ] **Step 5: Periksa integritas index**

```bash
node cli/dist/index.js docs index --check || pnpm --filter ./cli build && node cli/dist/index.js docs index --check
```
Expected: index konsisten (tak ada doc tak tertaut). Bila CLI belum terbangun di worktree ini,
verifikasi manual bahwa berkas ADR baru muncul di `internal/docs/README.md`.

- [ ] **Step 6: Jalankan ulang test yang tersentuh**

```bash
pnpm vitest --run --changed "$HANOMAN_BASE_SHA"
```
Expected: PASS. Pastikan berkas test pet memang **berjalan** — `--changed` menyalakan
`passWithNoTests`, jadi nol test terlihat hijau.

- [ ] **Step 7: Commit**

```bash
git add internal/docs docs/superpowers/plans/2026-08-23-spec-905-pet-diseret.md
git commit -m "docs(pet): §Pet + ADR-0144 untuk pet yang diseret (SPEC-905)"
```

---

## Self-review

- **Cakupan spec:** (a) Task 1 · (b) Task 2+4 · (c) Task 2+4 · (d) Task 2 (`cut` menyempit,
  `land` selalu memancarkan `y → 0`) + Task 4 (satu properti transform, tepi bawah jalur diam) ·
  (e) Task 5 · (f) Task 4 (ambang + `swallowClickRef`) · (g) Task 1–5 · (h) Task 6.
- **Konsistensi tipe:** `PetMove` empat field dipakai identik di Task 1 (test), Task 2
  (implementasi), Task 3 (test), Task 4 (`PET_EASE_CSS[move.ease]`). `isHandled` lahir di Task 2 dan
  dipakai Task 4 (`lifted`) & Task 5 (`canWave`). `parkedX` lahir di Task 2 dan diuji di Task 3.
- **Yang sengaja TIDAK ada:** modul drag terpisah (constraint mewajibkan `pet-walk.ts` tetap
  memegang keadaannya), perubahan `pet.json`/atlas, dan persistensi posisi.
