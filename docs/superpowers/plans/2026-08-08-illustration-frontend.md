# Hanoman Illustration Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose all 41 authoritative Hanoman illustration masters through typed frontend components and use the six product-state illustrations in their matching dashboard states.

**Architecture:** A design-system registry combines an explicit catalog-ID union with authoritative inventory metadata and Vite's static asset glob. A universal image component and family-restricted wrappers own rendering semantics; `StateBlock` and selected product screens consume IDs instead of paths. Contract tests compare the frontend registry with `inventory.json`, while a production build proves Vite emits every WebP.

**Tech Stack:** React 18, TypeScript, Vite 5, Vitest, Testing Library, CSS-in-JS styles already used by the dashboard.

## Global Constraints

- `internal/assets/illustration/inventory.json` is authoritative and contains exactly 41 records at the start of this work.
- Product code must consume catalog IDs and must not contain raw illustration filenames outside the registry.
- Existing `StateBlock` callers without illustrations retain their icon-based rendering and ARIA behavior.
- Informative images have meaningful alt text; redundant/decorative images have `alt=""` and `aria-hidden="true"`.
- No server endpoint, schema, dependency, new navigation route, or copied public-assets directory is added.
- Run frontend tests with `NODE_ENV=test` because the host shell exports production mode.
- Keep test execution targeted and serial where applicable; do not run the repository-wide suite.

---

### Task 1: Complete typed illustration registry

**Files:**
- Create: `src/src/ds/illustration-registry.ts`
- Create: `src/test/illustration-registry.test.ts`

**Interfaces:**
- Produces: `ILLUSTRATION_IDS`, `IllustrationId`, `IllustrationFamily`, `IllustrationAsset`, `ILLUSTRATIONS`, `illustrationsByFamily`, and prefix-derived family ID types.
- Consumes: `internal/assets/illustration/inventory.json` and every top-level `*.webp` master through `import.meta.glob`.

- [ ] **Step 1: Write the failing completeness contract**

Create a test that imports the inventory and the not-yet-existing registry, then compares sorted IDs,
record count, filenames, family, subject, ratio, URL presence, and represented families:

```ts
import inventory from "../../internal/assets/illustration/inventory.json";
import { ILLUSTRATIONS, ILLUSTRATION_IDS, illustrationsByFamily } from "../src/ds/illustration-registry";

it("registers the authoritative 41/41 catalog", () => {
  expect([...ILLUSTRATION_IDS].sort()).toEqual(inventory.map((x) => x.id).sort());
  expect(Object.keys(ILLUSTRATIONS)).toHaveLength(41);
  for (const expected of inventory) {
    expect(ILLUSTRATIONS[expected.id as keyof typeof ILLUSTRATIONS]).toMatchObject({
      filename: expected.filename,
      family: expected.family,
      subject: expected.subject,
      ratio: expected.ratio,
    });
    expect(ILLUSTRATIONS[expected.id as keyof typeof ILLUSTRATIONS].src).toContain(".webp");
  }
  expect(illustrationsByFamily("product-state")).toHaveLength(6);
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `NODE_ENV=test pnpm --dir src exec vitest run test/illustration-registry.test.ts --no-file-parallelism`

Expected: FAIL because `illustration-registry` does not exist.

- [ ] **Step 3: Implement the registry**

Define the 41 catalog IDs as a readonly tuple. Load inventory metadata and Vite URLs, validate both
at module initialization, and create the typed record:

```ts
export const ILLUSTRATION_IDS = [
  "MOD-001", "MSC-001", "HRO-001",
  "LKN-001", "LKN-002", "LKN-003", "LKN-004",
  "SPT-001", "SPT-002", "SPT-003", "SPT-004", "SPT-005", "SPT-006",
  "PST-001", "PST-002", "PST-003", "PST-004", "PST-005", "PST-006",
  "MPS-001", "MPS-002", "MPS-003", "MPS-004", "MPS-005", "MPS-006", "MPS-007", "MPS-008",
  "STK-001", "STK-002", "STK-003", "STK-004", "STK-005", "STK-006", "STK-007", "STK-008",
  "SOC-001", "SOC-002", "SOC-003", "SOC-004", "DGM-001", "MTF-001",
] as const;
export type IllustrationId = typeof ILLUSTRATION_IDS[number];
export type ProductStateIllustrationId = Extract<IllustrationId, `PST-${string}`>;
export type MascotIllustrationId = Extract<IllustrationId, `MPS-${string}`>;
export type StickerIllustrationId = Extract<IllustrationId, `STK-${string}`>;
export type SpotIllustrationId = Extract<IllustrationId, `SPT-${string}`>;

const modules = import.meta.glob("../../../internal/assets/illustration/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
```

Use `promptIntent` as the default informative alt text. Throw a descriptive error for an ID missing
from inventory or a filename missing from the Vite module set, so a broken registry cannot boot
silently.

- [ ] **Step 4: Run the contract and verify GREEN**

Run: `NODE_ENV=test pnpm --dir src exec vitest run test/illustration-registry.test.ts --no-file-parallelism`

Expected: one test file passes and reports 41 records.

- [ ] **Step 5: Commit the registry**

```bash
git add src/src/ds/illustration-registry.ts src/test/illustration-registry.test.ts
git commit -m "feat(illustration): register all frontend assets"
```

---

### Task 2: Universal and semantic illustration components

**Files:**
- Create: `src/src/ds/Illustration.tsx`
- Modify: `src/src/ds/index.ts`
- Create: `src/test/illustration-component.test.tsx`

**Interfaces:**
- Consumes: `ILLUSTRATIONS` and family ID types from Task 1.
- Produces: `Illustration`, `ProductStateIllustration`, `MascotIllustration`, `StickerIllustration`, `SpotIllustration`, and their prop types through the DS barrel.

- [ ] **Step 1: Write failing rendering and accessibility tests**

Cover default informative rendering, decorative rendering, priority behavior, style merging, data
attributes, and one semantic wrapper:

```tsx
render(<Illustration id="HRO-001" />);
expect(screen.getByRole("img")).toHaveAttribute("data-illustration-id", "HRO-001");
expect(screen.getByRole("img")).toHaveAttribute("loading", "lazy");

render(<StickerIllustration id="STK-005" decorative />);
expect(screen.getByTestId("illustration-STK-005")).toHaveAttribute("alt", "");
expect(screen.getByTestId("illustration-STK-005")).toHaveAttribute("aria-hidden", "true");
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `NODE_ENV=test pnpm --dir src exec vitest run test/illustration-component.test.tsx --no-file-parallelism`

Expected: FAIL because the component exports do not exist.

- [ ] **Step 3: Implement the component family**

Render a native `<img>` with default `width: 100%`, `height: auto`, `objectFit: contain`, async
decoding, and a numeric aspect ratio for `1x1`, `4x3`, `4x5`, `16x9`, and `9x16`. The `priority`
prop changes loading to eager and sets `fetchPriority="high"`. Callers may override class, style,
sizes, fit, and alt; decorative mode always wins over alt.

Semantic wrappers forward props to the base component while narrowing `id` to their family type.
Export runtime values and public types from `src/src/ds/index.ts`.

- [ ] **Step 4: Run component tests and typecheck**

Run:

```bash
NODE_ENV=test pnpm --dir src exec vitest run test/illustration-component.test.tsx --no-file-parallelism
pnpm --filter @hanoman/app typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit components**

```bash
git add src/src/ds/Illustration.tsx src/src/ds/index.ts src/test/illustration-component.test.tsx
git commit -m "feat(ds): add typed illustration components"
```

---

### Task 3: Illustration-aware StateBlock

**Files:**
- Modify: `src/src/ds/components/state.tsx`
- Modify: `src/test/ds.test.tsx`

**Interfaces:**
- Consumes: `IllustrationId` and `Illustration` from Tasks 1–2.
- Produces: optional `illustration?: IllustrationId` and `illustrationDecorative?: boolean` props on `StateBlock`.

- [ ] **Step 1: Write failing StateBlock tests**

Add tests proving an illustration replaces the icon tile and that actions/error roles are retained:

```tsx
render(<StateBlock kind="error" illustration="PST-006" action={retry} />);
expect(screen.getByTestId("illustration-PST-006")).toBeInTheDocument();
expect(screen.getByRole("alert")).toBeInTheDocument();
screen.getByText("Coba lagi").click();
expect(retry).toHaveBeenCalledOnce();
```

Also render an existing icon-only block and assert it has no illustration.

- [ ] **Step 2: Run DS tests and verify RED**

Run: `NODE_ENV=test pnpm --dir src exec vitest run test/ds.test.tsx --no-file-parallelism`

Expected: FAIL because `StateBlockProps` lacks `illustration`.

- [ ] **Step 3: Implement bounded state artwork**

When `illustration` exists, render `Illustration` at a bounded width (132px compact, 240px regular)
and omit the icon tile. Preserve all current role, busy, title, hint, action, and spinner behavior.

- [ ] **Step 4: Run DS and component tests**

Run: `NODE_ENV=test pnpm --dir src exec vitest run test/ds.test.tsx test/illustration-component.test.tsx --no-file-parallelism`

Expected: both files pass.

- [ ] **Step 5: Commit StateBlock integration**

```bash
git add src/src/ds/components/state.tsx src/test/ds.test.tsx
git commit -m "feat(ds): support illustrated state blocks"
```

---

### Task 4: Place all six product-state illustrations contextually

**Files:**
- Modify: `src/src/screens/AuthScreen.tsx`
- Modify: `src/src/screens/BacklogScreen.tsx`
- Modify: `src/src/screens/OverviewScreen.tsx`
- Modify: `src/src/screens/TerminalScreen.tsx`
- Modify: `src/src/App.tsx`
- Create: `src/test/illustration-placement.test.tsx`
- Modify: `src/test/app-states.test.tsx`

**Interfaces:**
- Consumes: `StateBlock` illustration props and `ProductStateIllustration`.
- Produces: contextual placements for PST-001 through PST-006.

- [ ] **Step 1: Write failing placement tests**

Test at least these observable mappings:

- setup/login card contains `PST-001`;
- an unfiltered empty backlog contains `PST-002`;
- a running terminal cell contains decorative `PST-003`;
- an awaiting-decision terminal cell contains decorative `PST-004`;
- an exited-success terminal cell contains decorative `PST-005`;
- top-level recoverable load error contains `PST-006` and retry still succeeds.

Use existing screen fixtures and API mocks; select by `data-testid="illustration-PST-00N"` rather
than querying implementation styles.

- [ ] **Step 2: Run placement tests and verify RED**

Run:

```bash
NODE_ENV=test pnpm --dir src exec vitest run test/illustration-placement.test.tsx test/app-states.test.tsx --no-file-parallelism
```

Expected: assertions fail because the screens do not yet render illustrations.

- [ ] **Step 3: Add contextual placements**

- `AuthScreen`: place informative `PST-001` above first-use/login copy.
- `BacklogScreen`: pass `PST-002` only to the truly empty, unfiltered backlog state.
- `TerminalScreen.Cell`: render a small decorative state image selected by precedence:
  failed exit keeps its existing failure semantics and uses no success image; successful exit uses
  `PST-005`; awaiting human decision uses `PST-004`; otherwise a live session uses `PST-003`.
- `OverviewScreen`: use `PST-005` for the all-on-convention empty-attention state.
- `App`: use `PST-006` for the retryable initial server-load error.

Do not use artwork for filtered-empty results or transient loading.

- [ ] **Step 4: Run placement, terminal, app-state, and backlog tests**

Run:

```bash
NODE_ENV=test pnpm --dir src exec vitest run \
  test/illustration-placement.test.tsx test/app-states.test.tsx \
  test/terminal-screen.test.tsx test/backlog-board.test.tsx \
  --no-file-parallelism
```

Expected: all selected files pass.

- [ ] **Step 5: Commit product placements**

```bash
git add src/src/screens/AuthScreen.tsx src/src/screens/BacklogScreen.tsx src/src/screens/OverviewScreen.tsx \
  src/src/screens/TerminalScreen.tsx src/src/App.tsx src/test/illustration-placement.test.tsx \
  src/test/app-states.test.tsx
git commit -m "feat(illustration): place product states in dashboard"
```

---

### Task 5: Source of Truth and production verification

**Files:**
- Modify: `internal/docs/design-system/design-system.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/docs/README.md` only if a new index link is required after inspection.

**Interfaces:**
- Documents: registry ownership, component API, accessibility, family placement policy, state mapping, and Vite packaging.

- [ ] **Step 1: Update authoritative docs**

Add a focused illustration section to the design-system document and an implementation section to
the frontend document. State that inventory is authoritative, all 41 IDs are registered, product
code uses IDs, product-state mapping is contextual, and non-operational families remain available
without forced placement.

- [ ] **Step 2: Run docs integrity and asset validation**

Run:

```bash
node internal/assets/illustration/verify.mjs
pnpm --filter @hanoman/cli exec tsx src/hanoman.ts docs index --check
```

- [ ] **Step 3: Run fresh affected verification**

Run:

```bash
NODE_ENV=test pnpm --dir src exec vitest run \
  test/illustration-registry.test.ts test/illustration-component.test.tsx \
  test/ds.test.tsx test/illustration-placement.test.tsx test/app-states.test.tsx \
  --no-file-parallelism
pnpm --filter @hanoman/app typecheck
pnpm --filter @hanoman/app build
```

Expected: zero test failures, typecheck exit 0, and a successful Vite production build.

- [ ] **Step 4: Audit emitted assets and requirements**

Count emitted WebPs in `src/dist/assets`, verify all 41 registry IDs against inventory, inspect the
worktree diff, and confirm every design requirement has direct evidence. A successful build without
41 emitted illustration assets is not completion.

- [ ] **Step 5: Commit docs and final verification state**

```bash
git add internal/docs/design-system/design-system.md internal/docs/frontend/frontend-implementation.md internal/docs/README.md
git commit -m "docs(illustration): document frontend usage"
```
