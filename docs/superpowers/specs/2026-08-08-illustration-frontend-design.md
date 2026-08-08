# Hanoman Illustration Frontend Integration Design

## Context

`internal/assets/illustration/inventory.json` contains 41 completed WebP masters across ten
families. The dashboard currently has no frontend asset registry and no illustration component, so
screens can only refer to raw filenames and a production asset can silently remain unavailable to
the application.

The frontend must expose every catalog master through a stable component API while preserving the
dashboard's calm, operational character. Production-reference families such as model sheets and
social templates must be available to frontend code without being forced into unrelated dashboard
screens.

## Decision

Create one explicit, typed frontend registry and one universal design-system component. Every one of
the 41 inventory IDs is registered exactly once. Product screens consume semantic IDs, never paths or
filenames.

The implementation imports masters directly from `internal/assets/illustration`. Vite therefore
fingerprints and emits the files used by the application build. There is no second manually copied
asset directory that can drift from the authoritative delivery.

## Component architecture

### Registry

`src/src/ds/illustration-registry.ts` owns:

- the stable `IllustrationId` union;
- `IllustrationFamily`, ratio, subject, filename, default alt text, and imported URL metadata;
- `ILLUSTRATIONS`, the complete map keyed by catalog ID;
- family-specific ID types derived from the registry;
- `illustrationsByFamily`, for controlled catalog/family consumers.

The public ID is the catalog ID (`PST-002`), not a filename. Filenames remain implementation detail
and continue to follow the authoritative inventory.

### Universal component

`src/src/ds/Illustration.tsx` exports `<Illustration />` with these responsibilities:

- select an asset by typed `id`;
- apply the catalog aspect ratio unless the caller deliberately supplies layout dimensions;
- support `contain` and `cover` fit, responsive width, and caller styles/classes;
- default to lazy loading and async decoding, with an explicit eager/high-priority option;
- require meaningful catalog alt text for informative images;
- support `decorative`, which produces `alt=""` and hides the image from assistive technology;
- expose the catalog ID and family as data attributes for debugging and tests.

Small semantic wrappers restrict accepted IDs by family:

- `<ProductStateIllustration />`
- `<MascotIllustration />`
- `<StickerIllustration />`
- `<SpotIllustration />`

The base component remains available for hero, lakon, model, social, diagram, and motif families.

### StateBlock integration

`StateBlock` gains an optional `illustration` prop. When present, the illustration replaces the icon
tile while preserving the existing title, hint, action, loading semantics, and error alert role.
Compact blocks use a smaller bounded image; existing call sites without the prop remain byte-for-byte
equivalent in behavior.

Product screens opt in only where the image explains the state:

- first-use/auth entry: onboarding;
- backlog with no items: empty backlog;
- visible running-session summary: session active;
- human-decision state: awaiting decision;
- completed/healthy state: success;
- retryable application error: recoverable error.

No generic loading state receives an illustration because a spinner communicates transient progress
more efficiently.

## Family placement policy

All 41 masters are frontend-addressable, but not all are dashboard decoration:

| Family | Frontend treatment |
|---|---|
| Model (2) | Registered for reference/catalog consumers; not placed in operational screens. |
| Hero (1) | Available to entry/overview hero compositions. |
| Lakon (4) | Available for editorial product explanations and future onboarding sequences. |
| Spot (6) | Typed spot wrapper for docs/value explanations. |
| Product state (6) | Contextual state UI and `StateBlock` integration. |
| Mascot pose (8) | Typed mascot wrapper for compact guidance and prompts. |
| Sticker (8) | Typed sticker wrapper for acknowledgements and lightweight status reactions. |
| Social (4) | Registered for release/social composition tools; not placed in operations UI. |
| Diagram (1) | Registered for technical explanation surfaces. |
| Motif (1) | Registered for bounded decorative strips, always decorative when it carries no meaning. |

This policy proves implementation of the full catalog without filling the instrument panel with
irrelevant art.

## Completeness and drift prevention

A Vitest contract reads the authoritative `inventory.json` and proves:

1. registry IDs equal inventory IDs, with no missing or extra record;
2. each registry filename, family, subject, and ratio matches its inventory record;
3. all 41 imported URLs resolve to WebP build assets;
4. every family is represented;
5. the public component renders informative and decorative semantics correctly;
6. family wrappers accept and render their intended records;
7. `StateBlock` renders the selected product-state artwork without regressing its action or ARIA
   behavior.

The existing `internal/assets/illustration/verify.mjs` remains the byte/dimension/alpha validator;
the frontend test covers integration rather than duplicating image parsing.

## Packaging and runtime behavior

Static imports allow Vite/Rollup to include and fingerprint all registered images in `src/dist`.
The release packaging flow already copies the built web directory, so no server route or runtime
filesystem access is added. A production build is required verification because unit tests alone do
not prove that assets outside the Vite root are emitted correctly.

If an image fails to load in the browser, native broken-image behavior remains visible; the component
does not hide delivery failures behind a placeholder. The build and registry contract are the primary
failure prevention.

## Documentation

Update the Source of Truth in the same implementation series:

- `internal/docs/design-system/design-system.md` documents the component API, accessibility, and
  family policy;
- `internal/docs/frontend/frontend-implementation.md` documents registry ownership, state mapping,
  and Vite packaging;
- `internal/docs/README.md` remains the index entry point; its existing design-system and frontend
  links continue to cover the updated documents.

## Out of scope

- editing or regenerating artwork;
- responsive crops beyond the delivered masters;
- animation or layered source formats;
- a new public gallery/navigation screen;
- changing server endpoints or database models;
- forcing model sheets or social templates into operational dashboard screens.

