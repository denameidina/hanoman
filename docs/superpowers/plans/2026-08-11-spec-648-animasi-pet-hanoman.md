# SPEC-648 — Animasi Pet Hanoman Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memberi ketujuh pose Pet Hanoman identitas gerak yang berbeda, transisi pose/interaksi/panel/reveal yang hidup tetapi tenang, dan mematikan seluruh gerak secara eksak saat reduced-motion aktif.

**Architecture:** Empat layer compositor memisahkan pemilik `transform`: reveal, reaksi interaksi, idle per pose, dan pose enter/exit. Modul murni `pet-motion.ts` memilih shorthand animation dari `PetPose` tanpa mengubah `derivePetState()`. Panel keluar serta reaksi klik selesai lewat `animationend`, sehingga tidak ada interval, timeout animasi, atau render React per-frame.

**Tech Stack:** React 18 + TypeScript · CSS keyframes/custom properties · Vitest 2 + Testing Library/jsdom · Hanoman Design System.

## Global Constraints

- `src/src/screens/pet-state.ts`, `PetPose`, urutan prioritas, headline, target, endpoint, skema, dan realtime **tidak berubah**.
- Tidak menambah asset, library animasi, atau dependency runtime.
- Semua keyframe hanya boleh menulis `transform` dan/atau `opacity`; tidak ada animasi layout/paint maupun `requestAnimationFrame`/interval/render per-frame.
- `prefers-reduced-motion: reduce` mematikan **semua** animation dan transition, bukan memperlambatnya; ketiadaan `matchMedia` tetap berarti `false`.
- Struktur a11y tetap `role="status"` yang membungkus image informatif dan button overlay transparan; image tidak dipindah ke dalam button.
- Root tetap `z-index: 80` dan `pointer-events: none`; ukuran stage tetap 76 px.
- Durasi memakai token `--dur-*`, easing memakai `--ease-*`; tidak ada duration literal di katalog TypeScript/call site.
- Test web dijalankan dengan `env -u NODE_ENV`; tidak menjalankan suite penuh atau build penuh.
- SoT `internal/docs/design-system/design-system.md`, `internal/docs/frontend/frontend-implementation.md`, dan deskripsi link keduanya di `internal/docs/README.md` diperbarui bersama kode.
- Instruksi sesi mengharuskan satu commit akhir setelah Execute; task tidak membuat commit parsial.

---

### Task 1: Katalog motion murni dan token durasi

**Files:**
- Create: `src/src/screens/pet-motion.ts`
- Modify: `src/src/ds/tokens/effects.css:29-36`
- Test: `src/test/pet-motion.test.ts` (create)

**Interfaces:**
- Consumes: `PetPose` dari `src/src/screens/pet-state.ts`.
- Produces: `type PetMotionDefinition = { id: PetPose; keyframe: string; animation: string }` dan `motionForPose(pose: PetPose): PetMotionDefinition` untuk `HanomanPet`.

- [x] **Step 1: Tulis unit test tabel motion yang gagal**

Buat `src/test/pet-motion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { POSE_ART, type PetPose } from "../src/screens/pet-state";
import { motionForPose } from "../src/screens/pet-motion";

const poses = Object.keys(POSE_ART) as PetPose[];
const expected: Record<PetPose, string> = {
  ready: "hn-pet-idle-ready",
  working: "hn-pet-idle-working",
  waiting: "hn-pet-idle-waiting",
  blocked: "hn-pet-idle-blocked",
  review: "hn-pet-idle-review",
  shipped: "hn-pet-idle-shipped",
  "docs-updated": "hn-pet-idle-docs",
};

describe("motion Pet Hanoman (SPEC-648)", () => {
  it("memberi ketujuh pose identitas idle yang berbeda", () => {
    expect(Object.fromEntries(poses.map((pose) => [pose, motionForPose(pose).keyframe])))
      .toEqual(expected);
    expect(new Set(poses.map((pose) => motionForPose(pose).keyframe)).size).toBe(poses.length);
  });

  it("memakai token durasi/easing, bukan durasi literal", () => {
    for (const pose of poses) {
      const animation = motionForPose(pose).animation;
      expect(animation).toContain("var(--dur-");
      expect(animation).toContain("var(--ease-");
      expect(animation).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/);
    }
  });

  it("pose shipped flourish sekali lalu menenang", () => {
    expect(motionForPose("shipped").animation).toBe(
      "hn-pet-celebrate var(--dur-pet-flourish) var(--ease-out) 1 both, "
      + "hn-pet-idle-shipped var(--dur-pet-calm) var(--ease-inout) "
      + "var(--dur-pet-flourish) infinite",
    );
  });
});
```

- [x] **Step 2: Jalankan test dan buktikan RED**

Run:

```bash
env -u NODE_ENV pnpm vitest --run src/test/pet-motion.test.ts
```

Expected: FAIL karena `../src/screens/pet-motion` belum ada; output harus menyebut satu test file,
bukan `no test files`.

- [x] **Step 3: Tambahkan token durasi semantik pet**

Di `src/src/ds/tokens/effects.css`, tepat setelah `--dur-slow`, tambahkan:

```css
  /* Pet Hanoman: idle panjang + flourish semantik; interaksi/transisi memakai --dur-base/slow. */
  --dur-pet-active:    2240ms; /* @kind other */
  --dur-pet-attention: 5040ms; /* @kind other */
  --dur-pet-calm:      5600ms; /* @kind other */
  --dur-pet-heavy:     6720ms; /* @kind other */
  --dur-pet-flourish:   840ms; /* @kind other */
```

- [x] **Step 4: Implementasikan katalog murni**

Buat `src/src/screens/pet-motion.ts`:

```ts
import type { PetPose } from "./pet-state";

export type PetMotionDefinition = {
  id: PetPose;
  keyframe: string;
  animation: string;
};

const PET_MOTION: Record<PetPose, PetMotionDefinition> = {
  ready: {
    id: "ready", keyframe: "hn-pet-idle-ready",
    animation: "hn-pet-idle-ready var(--dur-pet-calm) var(--ease-inout) infinite",
  },
  working: {
    id: "working", keyframe: "hn-pet-idle-working",
    animation: "hn-pet-idle-working var(--dur-pet-active) var(--ease-inout) infinite",
  },
  waiting: {
    id: "waiting", keyframe: "hn-pet-idle-waiting",
    animation: "hn-pet-idle-waiting var(--dur-pet-attention) var(--ease-inout) infinite",
  },
  blocked: {
    id: "blocked", keyframe: "hn-pet-idle-blocked",
    animation: "hn-pet-idle-blocked var(--dur-pet-heavy) var(--ease-inout) infinite",
  },
  review: {
    id: "review", keyframe: "hn-pet-idle-review",
    animation: "hn-pet-idle-review var(--dur-pet-attention) var(--ease-inout) infinite",
  },
  shipped: {
    id: "shipped", keyframe: "hn-pet-idle-shipped",
    animation: "hn-pet-celebrate var(--dur-pet-flourish) var(--ease-out) 1 both, "
      + "hn-pet-idle-shipped var(--dur-pet-calm) var(--ease-inout) "
      + "var(--dur-pet-flourish) infinite",
  },
  "docs-updated": {
    id: "docs-updated", keyframe: "hn-pet-idle-docs",
    animation: "hn-pet-idle-docs var(--dur-pet-attention) var(--ease-inout) infinite",
  },
};

export function motionForPose(pose: PetPose): PetMotionDefinition {
  return PET_MOTION[pose];
}
```

- [x] **Step 5: Jalankan unit test sampai GREEN**

Run:

```bash
env -u NODE_ENV pnpm vitest --run src/test/pet-motion.test.ts
```

Expected: 1 file dan 3 test PASS.

---

### Task 2: Keyframe compositor dan kontrak CSSOM

**Files:**
- Modify: `src/src/app.css:83-89`
- Modify: `src/test/pet-motion.test.ts`

**Interfaces:**
- Consumes: nama keyframe yang diekspor lewat `motionForPose()` dan token Task 1.
- Produces: class `.hn-pet-stage`, `.hn-pet-reactor`, keyframe idle/pose/click/panel/reveal untuk `HanomanPet`.

- [x] **Step 1: Tambahkan test kontrak CSSOM yang gagal**

Tambahkan helper stylesheet berikut ke `src/test/pet-motion.test.ts`. Import CSS di mode test Vite
bernilai string kosong, jadi test membaca byte stylesheet nyata lalu elemen style memasukkannya ke
CSSOM jsdom; assertion tetap menjalankan parser CSS, bukan grep teks mentah:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relative: string): string {
  const found = [resolve(process.cwd(), relative), resolve(process.cwd(), "src", relative)]
    .find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${relative} tak ketemu dari ${process.cwd()}`);
  return readFileSync(found, "utf8");
}

const style = document.createElement("style");
style.textContent = read("src/app.css");
document.head.append(style);

function isKeyframeRule(rule: CSSRule): rule is CSSKeyframeRule {
  return "keyText" in rule && "style" in rule;
}
```

Lalu tambah suite:

```ts
describe("CSS motion Pet Hanoman (SPEC-648)", () => {
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const keyframes = rules.filter((rule): rule is CSSKeyframesRule =>
    rule.type === CSSRule.KEYFRAMES_RULE && (rule as CSSKeyframesRule).name.startsWith("hn-pet-"));

  it("mendefinisikan seluruh keyframe katalog dan interaksi", () => {
    expect(keyframes.map((rule) => rule.name)).toEqual([
      "hn-pet-idle-ready", "hn-pet-idle-working", "hn-pet-idle-waiting",
      "hn-pet-idle-blocked", "hn-pet-idle-review", "hn-pet-idle-shipped",
      "hn-pet-idle-docs", "hn-pet-celebrate", "hn-pet-pose-in", "hn-pet-pose-out",
      "hn-pet-click", "hn-pet-panel-in", "hn-pet-panel-out", "hn-pet-reveal",
    ]);
  });

  it("setiap keyframe pet hanya mengubah transform/opacity", () => {
    expect(keyframes).toHaveLength(14);
    for (const rule of keyframes) {
      for (const parsedRule of [...rule.cssRules]) {
        expect(isKeyframeRule(parsedRule), rule.name).toBe(true);
        if (!isKeyframeRule(parsedRule)) continue;
        const frame = parsedRule;
        const properties = Array.from(
          { length: frame.style.length },
          (_, index) => frame.style[index]!,
        );
        expect(properties.length, `${rule.name} ${frame.keyText}`).toBeGreaterThan(0);
        expect(properties.every((property) => property === "transform" || property === "opacity"),
          `${rule.name} ${frame.keyText}`).toBe(true);
      }
    }
  });

  it("hover dikecualikan saat reduced-motion", () => {
    const selectors = rules.filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
      .map((rule) => rule.selectorText);
    expect(selectors).toContain(
      '.hn-pet-stage:not([data-reduced-motion="true"]):hover .hn-pet-reactor');
  });
});
```

- [x] **Step 2: Jalankan test dan buktikan RED**

Run:

```bash
env -u NODE_ENV pnpm vitest --run src/test/pet-motion.test.ts
```

Expected: test katalog murni PASS, test CSS FAIL karena baru ada `hn-pet-breathe`.

- [x] **Step 3: Ganti keyframe napas tunggal dengan grammar motion SPEC-648**

Hapus blok `hn-pet-breathe` lama di akhir `src/src/app.css`, lalu tambahkan:

```css
/* SPEC-648 · tiap transform punya layer sendiri agar idle, hover, click, dan pergantian pose
   dapat berjalan bersamaan. Seluruh keyframe hanya transform/opacity → compositor. */
.hn-pet-reactor {
  transform-origin: 50% 86%;
}
.hn-pet-stage:not([data-reduced-motion="true"]):hover .hn-pet-reactor {
  transform: translateY(-2px) scale(1.035) rotate(-1deg);
}

@keyframes hn-pet-idle-ready {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-2px) scale(1.018); }
}
@keyframes hn-pet-idle-working {
  0%, 100% { transform: translateY(0) rotate(0) scale(1); }
  20% { transform: translateY(-2px) rotate(-0.8deg) scale(1.018); }
  40% { transform: translateY(0) rotate(0.6deg) scale(1); }
  60% { transform: translateY(-3px) rotate(-0.5deg) scale(1.022); }
  80% { transform: translateY(-1px) rotate(0.4deg) scale(1.008); }
}
@keyframes hn-pet-idle-waiting {
  0%, 64%, 100% { transform: translateY(0) rotate(0); }
  70% { transform: translateY(-1px) rotate(-2deg); }
  76% { transform: translateY(-2px) rotate(3deg); }
  82% { transform: translateY(-1px) rotate(-2deg); }
  88% { transform: translateY(0) rotate(0); }
}
@keyframes hn-pet-idle-blocked {
  0%, 100% { transform: translateY(1px) scale(1, 0.99); }
  50% { transform: translateY(3px) scale(0.99, 0.97); }
}
@keyframes hn-pet-idle-review {
  0%, 64%, 100% { transform: translateY(0) rotate(0) scale(1); }
  74% { transform: translateY(-1px) rotate(-1.6deg) scale(1.012); }
  84% { transform: translateY(-1px) rotate(0.8deg) scale(1.006); }
}
@keyframes hn-pet-idle-shipped {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-2px) scale(1.015); }
}
@keyframes hn-pet-idle-docs {
  0%, 66%, 100% { transform: translateY(0) rotate(0) scale(1); }
  72% { transform: translateY(-1px) rotate(-1.8deg) scale(1.01); }
  78% { transform: translateY(-1px) rotate(1.5deg) scale(1.012); }
  84% { transform: translateY(0) rotate(-0.7deg) scale(1); }
}
@keyframes hn-pet-celebrate {
  0% { transform: translateY(3px) scale(0.92) rotate(0); }
  38% { transform: translateY(-5px) scale(1.08) rotate(-3deg); }
  62% { transform: translateY(-2px) scale(1.03) rotate(3deg); }
  100% { transform: translateY(0) scale(1) rotate(0); }
}
@keyframes hn-pet-pose-in {
  0% { opacity: 0; transform: translateY(4px) scale(0.76, 0.92); }
  62% { opacity: 1; transform: translateY(-2px) scale(1.07, 0.97); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes hn-pet-pose-out {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(3px) scale(0.86, 1.04); }
}
@keyframes hn-pet-click {
  0%, 100% { transform: translateY(0) scale(1) rotate(0); }
  38% { transform: translateY(2px) scale(0.9, 1.06) rotate(-2deg); }
  72% { transform: translateY(-3px) scale(1.06, 0.96) rotate(1.5deg); }
}
@keyframes hn-pet-panel-in {
  0% { opacity: 0; transform: translateY(6px) scale(0.98); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes hn-pet-panel-out {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(5px) scale(0.985); }
}
@keyframes hn-pet-reveal {
  0% { opacity: 0; transform: translateY(7px) scale(0.86); }
  70% { opacity: 1; transform: translateY(-1px) scale(1.035); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
```

- [x] **Step 4: Jalankan unit + kontrak CSS sampai GREEN**

Run:

```bash
env -u NODE_ENV pnpm vitest --run src/test/pet-motion.test.ts
```

Expected: 1 file dan 6 test PASS; assertion jumlah block membuktikan scanner tidak hampa.

---

### Task 3: Layer pose, idle, dan reveal di komponen

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx:1-145`
- Modify: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `motionForPose(view.pose)` dari Task 1 dan class/keyframe Task 2.
- Produces: test id `pet-stage`, `pet-reactor`, `pet-idle`; pose image memakai enter/exit; reveal mount/unhide.

- [x] **Step 1: Ubah test render agar menuntut motion per pose dan transisi transform**

Import `motionForPose` di `src/test/hanoman-pet.test.tsx`, lalu ganti test animation lama dan
perluas test perpindahan pose:

```tsx
it("memilih idle working yang berbeda dari ready", () => {
  render(<HanomanPet backlog={[spec({ id: "SPEC-1", stage: "executing" })]}
    sessions={[session({ id: "spec-1", specId: "SPEC-1" })]} onOpen={vi.fn()} />);
  expect(screen.getByTestId("pet-idle")).toHaveStyle({
    animation: "hn-pet-idle-working var(--dur-pet-active) var(--ease-inout) infinite",
  });
  expect(styleOf(screen.getByTestId("pet-idle")))
    .not.toContain("hn-pet-idle-ready");
});
```

Di test perpindahan pose, tambahkan:

```tsx
expect(working).toHaveStyle({
  opacity: "1",
  animation: "hn-pet-pose-in var(--dur-slow) var(--ease-out) both",
});
expect(ready).toHaveStyle({
  opacity: "0",
  animation: "hn-pet-pose-out var(--dur-slow) var(--ease-out) both",
});
expect(styleOf(working)).not.toContain("transition: opacity");
```

Di test hide/unhide, setelah klik **Tampilkan pet Hanoman**, tambahkan:

```tsx
expect(screen.getByTestId("pet-stage")).toHaveStyle({
  animation: "hn-pet-reveal var(--dur-slow) var(--ease-out) both",
});
```

- [x] **Step 2: Jalankan test dan buktikan RED**

Run:

```bash
env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx
```

Expected: FAIL karena `pet-idle`/`pet-reactor` belum ada dan stage masih memakai
`hn-pet-breathe`.

- [x] **Step 3: Susun layer compositor di `HanomanPet`**

Tambahkan import:

```ts
import { motionForPose } from "./pet-motion";
```

Sesudah `view`, hitung:

```ts
const motion = motionForPose(view.pose);
const poseAnimation = (on: boolean) => reduced
  ? "none"
  : `hn-pet-pose-${on ? "in" : "out"} var(--dur-slow) var(--ease-out) both`;
```

Ganti isi visible stage dengan struktur berikut; panel tetap berada sebelum stage dan button
overlay tetap sibling image di dalam live region:

```tsx
<div data-testid="pet-stage" role="status" aria-live="polite"
  className="hn-pet-stage" data-reduced-motion={reduced ? "true" : undefined}
  style={{
    position: "relative", width: SIZE, height: SIZE,
    animation: reduced ? "none" : "hn-pet-reveal var(--dur-slow) var(--ease-out) both",
  }}>
  <div data-testid="pet-reactor" className="hn-pet-reactor" style={{
    position: "relative", width: "100%", height: "100%",
    transition: reduced ? "none" : "transform var(--dur-base) var(--ease-out)",
    animation: "none",
  }}>
    <div data-testid="pet-idle" data-motion={motion.id} style={{
      position: "relative", width: "100%", height: "100%",
      transformOrigin: "50% 86%",
      animation: reduced ? "none" : motion.animation,
    }}>
      {seen.map((pose) => {
        const on = pose === view.pose;
        return (
          <StickerIllustration key={pose} id={POSE_ART[pose]} decorative={!on}
            alt={on ? alt : undefined} style={{
              position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
              opacity: on ? 1 : 0, zIndex: on ? 2 : 1,
              animation: poseAnimation(on), transition: reduced ? "none" : undefined,
            }} />
        );
      })}
    </div>
  </div>
  <button aria-label="Ringkasan status Hanoman" title={`${view.headline} — ${view.detail}`}
    onClick={() => setOpen((o) => !o)} style={{
      pointerEvents: "auto", position: "absolute", zIndex: 3,
      left: 0, top: 0, width: "100%", height: "100%",
      padding: 0, border: "none", background: "transparent", cursor: "pointer",
    }} />
</div>
```

- [x] **Step 4: Jalankan test komponen sampai GREEN**

Run:

```bash
env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx src/test/pet-motion.test.ts
```

Expected: kedua file PASS. Test reduced-motion lama boleh disesuaikan di Task 4, tetapi tidak boleh
diterima hijau bila masih mencari `hn-pet-breathe`.

---

### Task 4: Reaksi klik, lifecycle panel, dan reduced-motion total

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx`
- Modify: `src/test/hanoman-pet.test.tsx`

**Interfaces:**
- Consumes: `hn-pet-click`, `hn-pet-panel-in/out`, serta layer Task 3.
- Produces: `data-testid="pet-panel"`; lifecycle panel tanpa timer; exact reduced-motion contract.

- [x] **Step 1: Tulis test interaksi/panel/reduced-motion yang gagal**

Tambahkan/ganti test berikut di `src/test/hanoman-pet.test.tsx`:

```tsx
it("bereaksi sekali saat diklik dan selesai lewat animationend", () => {
  render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
  fireEvent.click(hit());
  const reactor = screen.getByTestId("pet-reactor");
  expect(reactor).toHaveStyle({
    animation: "hn-pet-click var(--dur-slow) var(--ease-out) both",
  });
  fireEvent.animationEnd(reactor, { animationName: "hn-pet-click" });
  expect(reactor).toHaveStyle({ animation: "none" });
});

it("menganimasi panel masuk dan keluar sebelum unmount", () => {
  render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
  fireEvent.click(hit());
  const panel = screen.getByTestId("pet-panel");
  expect(panel).toHaveStyle({
    animation: "hn-pet-panel-in var(--dur-slow) var(--ease-out) both",
  });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(panel).toHaveAttribute("aria-hidden", "true");
  expect(panel).toHaveStyle({
    pointerEvents: "none",
    animation: "hn-pet-panel-out var(--dur-slow) var(--ease-out) both",
  });
  fireEvent.animationEnd(panel, { animationName: "hn-pet-panel-out" });
  expect(screen.queryByTestId("pet-panel")).toBeNull();
});

it("mematikan seluruh gerak saat prefers-reduced-motion: reduce", () => {
  mockMatchMedia(true);
  render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);

  expect(screen.getByTestId("pet-stage")).toHaveStyle({ animation: "none" });
  expect(screen.getByTestId("pet-reactor")).toHaveStyle({
    animation: "none", transition: "none",
  });
  expect(screen.getByTestId("pet-idle")).toHaveStyle({ animation: "none" });
  expect(screen.getByTestId("illustration-STK-001")).toHaveStyle({
    animation: "none", transition: "none", opacity: "1",
  });

  fireEvent.click(hit());
  expect(screen.getByTestId("pet-panel")).toHaveStyle({ animation: "none" });
  expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "none" });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByTestId("pet-panel")).toBeNull();
});
```

Ubah test Escape lama agar mengikuti lifecycle keluar di atas; jangan menyisakan assertion yang
mengharapkan unmount sinkron pada motion normal.

- [x] **Step 2: Jalankan test dan buktikan RED**

Run:

```bash
env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx
```

Expected: FAIL karena klik belum punya reaction, panel belum punya test id/lifecycle, dan
reduced-motion belum menulis `none` pada seluruh layer.

- [x] **Step 3: Implementasikan state diskret tanpa timer animasi**

Di `HanomanPet`, tambahkan state:

```ts
const [panelMounted, setPanelMounted] = React.useState(false);
const [reacting, setReacting] = React.useState(false);
```

Tambahkan helper berikut dan pakai `closePanel` di handler klik-luar/Escape:

```ts
function showPanel() {
  setPanelMounted(true);
  setOpen(true);
}

function closePanel() {
  setOpen(false);
  if (reduced) setPanelMounted(false);
}

function togglePanel() {
  if (open) closePanel();
  else showPanel();
}

function reactAndToggle() {
  if (!reduced) setReacting(true);
  togglePanel();
}

React.useEffect(() => {
  if (!reduced) return;
  setReacting(false);
  if (!open) setPanelMounted(false);
}, [reduced, open]);
```

Effect klik-luar/Escape yang sudah ada memanggil `closePanel()` dan dependency-nya menjadi
`[open, reduced]`, sehingga close reduced-motion tidak menunggu event.

Perbarui `setVisibility(true)` agar menutup dan melepas panel:

```ts
if (next) {
  setOpen(false);
  setPanelMounted(false);
}
```

Pada `pet-reactor`, ganti `animation: "none"` dengan:

```tsx
animation: reduced || !reacting
  ? "none"
  : "hn-pet-click var(--dur-slow) var(--ease-out) both",
```

dan pasang handler:

```tsx
onAnimationEnd={(event) => {
  if (event.animationName === "hn-pet-click") setReacting(false);
}}
```

Button overlay memakai `onClick={reactAndToggle}`.

- [x] **Step 4: Implementasikan panel masuk/keluar yang aksesibel**

Ganti conditional `{open && (...)}` menjadi `{panelMounted && (...)}`. Panel menerima:

```tsx
data-testid="pet-panel"
aria-hidden={!open || undefined}
inert={!open ? "" : undefined}
onAnimationEnd={(event) => {
  if (event.animationName === "hn-pet-panel-out" && !open) setPanelMounted(false);
}}
style={{
  pointerEvents: open ? "auto" : "none",
  width: 268,
  padding: 14,
  background: "var(--surface-card)",
  border: "1px solid var(--border-hair)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-lg)",
  transformOrigin: "right bottom",
  animation: reduced
    ? "none"
    : `${open ? "hn-pet-panel-in" : "hn-pet-panel-out"} var(--dur-slow) var(--ease-out) both`,
}}
```

Tombol `Buka Terminal/Backlog` memanggil `closePanel()` sebelum `onOpen`; tombol
`Sembunyikan` tetap memanggil `setVisibility(true)`.

- [x] **Step 5: Jalankan seluruh test pet sampai GREEN**

Run:

```bash
env -u NODE_ENV pnpm vitest --run \
  src/test/pet-motion.test.ts src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx
```

Expected: 3 file dijalankan dan seluruh test PASS.

- [x] **Step 6: Typecheck paket frontend**

Run:

```bash
env -u NODE_ENV pnpm --filter ./src typecheck
```

Expected: exit 0. Bila React 18 mengetik `inert` sebagai boolean, gunakan bentuk native yang
diterima tipenya (`inert={!open || undefined}`) tanpa mencabut semantik inert.

---

### Task 5: Perbarui Source of Truth dan index

**Files:**
- Modify: `internal/docs/design-system/design-system.md:27-36`
- Modify: `internal/docs/frontend/frontend-implementation.md:140-151`
- Modify: `internal/docs/README.md:179-183`
- Already created: `docs/superpowers/specs/2026-08-11-spec-648-animasi-pet-hanoman-design.md`

**Interfaces:**
- Consumes: perilaku nyata dan nama keyframe/token Task 1–4.
- Produces: SoT yang menjelaskan grammar motion, lifecycle, reduced-motion, dan link index yang tidak basi.

- [x] **Step 1: Perluas design system dengan grammar motion SPEC-648**

Sesudah paragraf penempatan family sticker, tambahkan subseksi yang menyatakan:

```markdown
### Motion Pet Hanoman (SPEC-648)

Gerak adalah kanal status kedua, bukan hiasan: tujuh pose memakai tujuh idle berbeda (`ready`
tenang, `working` berirama, `waiting` memanggil berkala, `blocked` berat, `review` memperhatikan,
`shipped` flourish sekali lalu tenang, `docs-updated` flutter ringan). Durasi idle/flourish memakai
token `--dur-pet-*`; one-shot interaksi/transisi memakai `--dur-base|slow`; easing memakai
`--ease-out|inout`.

Layer reveal → reaksi → idle → pose memisahkan kepemilikan `transform`. Seluruh keyframe hanya
`transform`/`opacity`. Saat `prefers-reduced-motion: reduce`, semua animation/transition mati dan
keadaan statis tetap sepenuhnya terbaca.
```

- [x] **Step 2: Ganti paragraf animation frontend dengan kontrak implementasi baru**

Di bagian Pet Hanoman `frontend-implementation.md`, pertahankan tabel status/penempatan/a11y lalu
ganti uraian napas/crossfade SPEC-585 dengan:

- katalog murni `pet-motion.ts` tanpa menyentuh `derivePetState()`;
- tabel tujuh pose → keyframe dari design spec;
- susunan empat layer dan alasan transform tidak digabung;
- pose enter/out, shipped flourish sekali, hover CSS, klik/panel via `animationend`, reveal unhide;
- reduced-motion exact `none` di seluruh layer dan close panel sinkron;
- test unit murni + render exact style; tanpa timer denyut/dependency/aset.

- [x] **Step 3: Perjelas link SoT di index**

Ubah dua entri menjadi deskriptif:

```markdown
## design-system
- [design-system](design-system/design-system.md) — editorial instrument-panel, ilustrasi, dan grammar motion Pet Hanoman (SPEC-648)

## frontend
- [frontend-implementation](frontend/frontend-implementation.md) — kontrak implementasi UI, termasuk state → pose dan motion Pet Hanoman
```

- [x] **Step 4: Verifikasi index dan coverage docs**

Run:

```bash
hanoman docs index --check
hanoman docs scan
```

Expected: index check exit 0; scan menghasilkan laporan coverage dan tidak melaporkan tiga dokumen
SoT yang disentuh sebagai unlinked.

---

### Task 6: Verifikasi scope berubah dan tutup checklist

**Files:**
- Modify: `docs/superpowers/plans/2026-08-11-spec-648-animasi-pet-hanoman.md` (centang semua task + catatan bukti)
- Inspect: seluruh file yang berubah terhadap `$HANOMAN_BASE_SHA`

**Interfaces:**
- Consumes: seluruh deliverable Task 1–5.
- Produces: bukti final yang cukup untuk menandai Execute selesai; tidak membuat perubahan runtime baru.

- [x] **Step 1: Enumerasi scope aktual**

Run:

```bash
git diff --name-only "$HANOMAN_BASE_SHA"...HEAD
git status --porcelain
```

Expected: hanya file SPEC-648; tidak ada file worktree sesi lain atau asset/dependency manifest.

- [x] **Step 2: Jalankan test pet yang benar-benar terkait**

Run:

```bash
env -u NODE_ENV pnpm vitest --run \
  src/test/pet-motion.test.ts src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx
```

Expected: 3 test file benar-benar dijalankan dan PASS; `no test files` bukan bukti.

- [x] **Step 3: Jalankan typecheck hanya paket frontend**

Run:

```bash
env -u NODE_ENV pnpm --filter ./src typecheck
```

Expected: exit 0. Tidak menjalankan `pnpm -r typecheck`.

- [x] **Step 4: Jalankan pemeriksaan diff/docs terakhir**

Run:

```bash
git diff --check
hanoman docs index --check
rg -n '^- \[ \]' docs/superpowers/plans/2026-08-11-spec-648-animasi-pet-hanoman.md
```

Expected: dua perintah pertama exit 0; `rg` tidak menghasilkan baris setelah seluruh step dicentang.

- [x] **Step 5: Catat bukti verifikasi di plan dan pastikan seluruh kotak selesai**

Tambahkan bagian `## Catatan verifikasi (SPEC-648)` berisi jumlah file/test yang benar-benar jalan,
hasil typecheck/index/diff check, serta penjelasan bahwa build penuh dan smoke endpoint dilewati
karena perubahan murni presentasi dan tidak menyentuh bundling/endpoint. Ubah setiap task selesai
dari `- [ ]` menjadi `- [x]` sebelum menulis `Execute done` ke phase file.

## Catatan verifikasi (SPEC-648)

- Scope aktual terdiri dari 11 berkas SPEC-648: empat implementasi presentasi, dua test, tiga SoT
  internal, serta design spec dan implementation plan. Tidak ada asset, dependency manifest,
  kontrak status, skema, atau berkas worktree sesi lain yang berubah.
- `env -u NODE_ENV pnpm vitest --run src/test/pet-motion.test.ts src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx`
  menjalankan tepat 3 file dan 20 test; seluruhnya lulus.
- `env -u NODE_ENV pnpm --filter ./src typecheck` lulus (`tsc --noEmit`, exit 0).
- `git diff --check` dan `hanoman docs index --check` lulus; `hanoman docs scan` melaporkan
  coverage 100% untuk seluruh kategori.
- Build penuh dilewati karena perubahan tidak menyentuh bundler, dependency, atau konfigurasi
  build. Smoke server/endpoint dilewati karena perubahan murni presentasi frontend dan tidak
  menyentuh endpoint maupun perilaku runtime server.
