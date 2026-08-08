# Hanoman Illustration Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one validated WebP master for every one of the 41 illustration IDs defined in `internal/docs/brand/illustration/04-asset-catalog.md`.

**Architecture:** Build the character identity before derivatives, then generate each catalog asset with the matching family brief and the approved model image as a visual reference. Store a JSON inventory and QA report beside the outputs so catalog completeness, filenames, formats, ratios, alpha requirements, and human visual review remain auditable.

**Tech Stack:** Built-in `image_gen` (`gpt-image-2`), ImageMagick/libwebp for lossless WebP conversion and metadata checks, shell/Node.js for deterministic inventory validation.

## Global Constraints

- Output root is `internal/assets/illustration/`; final raster assets are WebP only.
- Deliver exactly one master per catalog ID: 41 WebP files total.
- Preserve the canonical one-eye presentation profile, lifted head, supit urang, ulur-ulur, agile dignified anatomy, and one long connected Buntut tail.
- Use contemporary Indonesian editorial wayang form, semantic bone/ink/brass color roles, restrained texture, and deliberate negative space.
- Never bake text, logo, screenshot, terminal text, code, watermark, or signature into an illustration.
- Never introduce a frontal two-eye face, extra limb/tail, generic monkey, chibi/bodybuilder construction, realistic fur, hoodie/laptop shorthand, copied artifact, or mixed regional ornament.
- `MPS-001`–`MPS-008` and `STK-001`–`STK-008` require transparent WebP canvases with 12% safe margin.
- Narrative assets use their documented focal action and preserve at least one-third quiet field.
- Generated files are never upscaled or described as satisfying the 3200 px editable-master gate unless their native dimensions actually do.
- No cultural-review, rights, or human-redraw approval may be fabricated.

---

### Task 1: Inventory and deterministic validation

**Files:**
- Create: `internal/assets/illustration/inventory.json`
- Create: `internal/assets/illustration/README.md`
- Create: `internal/assets/illustration/verify.mjs`

**Interfaces:**
- Consumes: the 41 catalog rows in `internal/docs/brand/illustration/04-asset-catalog.md`.
- Produces: an ordered array of `{id, family, subject, ratio, filename, transparent, promptIntent}` and a validator with exit code `0` only when all expected WebPs pass structural checks.

- [x] **Step 1: Encode every catalog row**

Create `inventory.json` with exactly the IDs and names from the catalog. Use these family slugs and ratio tokens: `model/*/sheet`, `hero/*/16x9`, `lakon/*/4x3`, `spot/*/1x1`, `product-state/*/4x3`, `mascot-pose/*/1x1`, `sticker/*/1x1`, `social/{square,portrait,landscape,story}/{1x1,4x5,16x9,9x16}`, `diagram/*/modular`, and `motif/*/tile-strip`.

- [x] **Step 2: Write the validator**

The validator must assert: 41 unique inventory IDs; 41 unique filenames; every referenced file exists; every file starts with a WebP `RIFF....WEBP` signature; dimensions are positive; expected landscape/portrait/square orientation is correct; transparent-required files contain an alpha-capable WebP chunk; no `.png`, `.jpg`, or `.jpeg` exists under the output root.

- [x] **Step 3: Confirm the empty delivery fails**

Run: `node internal/assets/illustration/verify.mjs`

Expected: non-zero exit listing all 41 missing WebPs.

- [x] **Step 4: Document scope**

Write `README.md` with the 41-master scope, naming convention, generation path, QA commands, known flattened-raster/human-review boundary, and links to the authoritative illustration docs.

- [x] **Step 5: Commit inventory scaffolding**

```bash
git add internal/assets/illustration
git commit -m "chore(illustration): define raster asset inventory"
```

### Task 2: Canonical model references

**Files:**
- Create: `internal/assets/illustration/hnm-ill-model-character-sheet-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-model-mascot-sheet-master-v01.webp`
- Create: `internal/assets/illustration/qa/model-contact-sheet.webp`
- Modify: `internal/assets/illustration/qa-report.md`

**Interfaces:**
- Consumes: identity, tier, gesture, expression, and tail definitions in `01-art-direction.md`, `02-character-model-sheet.md`, `03-mascot-system.md`, and `07-prompt-library.md`.
- Produces: `MOD-001` as the identity reference for Narrative/Editorial derivatives and `MSC-001` as the identity reference for Mascot derivatives.

- [x] **Step 1: Generate `MOD-001`**

Use one built-in image-generation call for a text-free wide model board containing presentation profile, back silhouette, three-quarter adaptation, Narrative/Editorial/Mascot tier comparison, neutral/action line, costume detail, and head/hand/foot/tail callouts. Use the complete identity and negative blocks; do not attach restricted cultural scans.

- [x] **Step 2: Inspect and repair `MOD-001`**

Inspect full-size and thumbnail output. Regenerate once with a targeted prompt if the single-eye profile, costume anchors, anatomy, or one-tail rule fails.

- [x] **Step 3: Generate `MSC-001` from `MOD-001`**

Attach `MOD-001` as identity authority and generate a text-free compact mascot scale/pose sheet at 3.5–4 head units, head no more than approximately 28% of height, preserving the same profile and costume identity.

- [x] **Step 4: Convert and validate model assets**

Convert selected generated outputs losslessly to the two inventory filenames, inspect with `identify`, and create a two-up contact sheet. Record identity and artifact checks in `qa-report.md`.

- [x] **Step 5: Commit models**

```bash
git add internal/assets/illustration
git commit -m "feat(illustration): add canonical character models"
```

### Task 3: Narrative hero and four lakons

**Files:**
- Create: `internal/assets/illustration/hnm-ill-hero-workflow-16x9-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-lakon-anoman-duta-4x3-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-lakon-anoman-obong-4x3-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-lakon-gunung-dronagiri-4x3-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-lakon-chiranjivi-4x3-master-v01.webp`
- Create: `internal/assets/illustration/qa/narrative-contact-sheet.webp`
- Modify: `internal/assets/illustration/qa-report.md`

**Interfaces:**
- Consumes: `MOD-001` and briefs `00-homepage-hero.md` through `04-chiranjivi.md`.
- Produces: the five P0 Narrative masters for downstream family-style comparison.

- [x] **Step 1: Generate the hero**

Use the `HRO-001` brief verbatim for action order, human-control cue, and right-third text-safe field. Attach `MOD-001`; require 16:9 composition and no text/UI.

- [x] **Step 2: Generate the four lakons**

Issue one generation call per ID with `MOD-001` attached. Keep each documented motif distinct: mandate-return loop, controlled ember-to-diff, five bounded context strata plus human decision, and finite session-branch-merge-docs continuity.

- [x] **Step 3: Inspect and repair**

At thumbnail and full-size views, check canonical character anchors, one focal action, at least one-third quiet field, truthful product sequence, one tail, hands, and absence of text/UI. Regenerate each failed asset once with only the failing constraint emphasized.

- [x] **Step 4: Convert, contact-sheet, and record QA**

Convert all five selected outputs to their inventory WebP paths, create a five-up contact sheet, and add one QA row per ID.

- [x] **Step 5: Commit Narrative assets**

```bash
git add internal/assets/illustration
git commit -m "feat(illustration): add hero and four-lakon masters"
```

### Task 4: Editorial spots and product states

**Files:**
- Create: `internal/assets/illustration/hnm-ill-spot-{context,visibility,isolation,human-control,parallel-work,durable-knowledge}-1x1-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-product-state-{onboarding,empty-backlog,session-active,awaiting-decision,success,recoverable-error}-4x3-master-v01.webp`
- Create: `internal/assets/illustration/qa/spot-contact-sheet.webp`
- Create: `internal/assets/illustration/qa/product-state-contact-sheet.webp`
- Modify: `internal/assets/illustration/qa-report.md`

**Interfaces:**
- Consumes: `MOD-001`, `MSC-001`, and briefs `05-spot-illustrations.md` and `06-product-states.md`.
- Produces: 12 compact product-support masters.

- [x] **Step 1: Generate six spots**

Issue one call per spot with `MOD-001` attached. Enforce one gesture, one prop, one focal action, 1:1 field, and the exact row-specific product proof.

- [x] **Step 2: Generate six product states**

Issue one call per state with `MSC-001` attached. Start from the documented literal fallback, add one calm mascot gesture, preserve an empty center/copy region, and do not imitate controls.

- [x] **Step 3: Inspect and repair**

Verify the six spots are distinguishable without labels and the six product states communicate their literal state at thumbnail size. Repair character drift, extra objects, fake UI, or ambiguous state.

- [x] **Step 4: Convert, contact-sheet, and record QA**

Convert 12 selected outputs, create family contact sheets, and add 12 QA rows.

- [x] **Step 5: Commit product-support assets**

```bash
git add internal/assets/illustration
git commit -m "feat(illustration): add spot and product-state masters"
```

### Task 5: Mascot poses and stickers

**Files:**
- Create: `internal/assets/illustration/hnm-ill-mascot-pose-{neutral,welcome,observe,work,ask,warn,celebrate,carry-knowledge}-1x1-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-sticker-{ready,working,waiting,blocked,shipped,review,thanks,docs-updated}-1x1-master-v01.webp`
- Create: `internal/assets/illustration/qa/mascot-pose-contact-sheet.webp`
- Create: `internal/assets/illustration/qa/sticker-contact-sheet.webp`
- Modify: `internal/assets/illustration/qa-report.md`

**Interfaces:**
- Consumes: `MSC-001` and briefs `07-mascot-pose-pack.md` and `08-sticker-pack.md`.
- Produces: 16 transparent mascot assets.

- [x] **Step 1: Generate eight chroma-key poses**

Issue one call per pose with `MSC-001` attached and the exact GST/EXP/TAL mapping. Use a flat chroma-key background excluded from the subject palette, 12% margin, no floor/shadow, and no text.

- [x] **Step 2: Remove chroma key and validate alpha**

Run the installed `remove_chroma_key.py` helper to produce transparent WebP files. Validate transparent corners, subject coverage, and absence of key-color fringe; retry once with edge contraction if required.

- [x] **Step 3: Generate and extract eight stickers**

Issue one call per sticker with `MSC-001` attached, text-free bold contour, and documented reaction mapping. Remove chroma key and validate alpha exactly as for poses.

- [x] **Step 4: Inspect consistency and repair**

Compare all 16 at equal optical height. Reject mirror/profile drift, chibi inflation, inconsistent costume or contour, extra tail/limb, unclear reactions, clipped contours, or baked copy.

- [x] **Step 5: Contact-sheet, record QA, and commit**

```bash
git add internal/assets/illustration
git commit -m "feat(illustration): add mascot pose and sticker masters"
```

### Task 6: Social templates, technical diagram, and motif kit

**Files:**
- Create: `internal/assets/illustration/hnm-ill-social-{square,portrait,landscape,story}-{1x1,4x5,16x9,9x16}-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-diagram-technical-kit-modular-master-v01.webp`
- Create: `internal/assets/illustration/hnm-ill-motif-lakon-buntut-tile-strip-master-v01.webp`
- Create: `internal/assets/illustration/qa/social-contact-sheet.webp`
- Create: `internal/assets/illustration/qa/system-kit-contact-sheet.webp`
- Modify: `internal/assets/illustration/qa-report.md`

**Interfaces:**
- Consumes: `MOD-001` and briefs `09-social-release-templates.md` and `10-diagram-and-motif-kit.md`.
- Produces: the final six catalog masters.

- [x] **Step 1: Generate four social masters**

Issue one call per documented ratio, attach `MOD-001`, and preserve independent character, proof-object, and headline-safe zones. Keep all copy/logo/date/metrics outside the image.

- [x] **Step 2: Generate `DGM-001`**

Generate a text-free wide primitive board with distinct human, agent, docs, backlog, session, terminal, branch, worktree, arrow, state, and boundary symbols. Require orthogonal direction, monochrome readability, and no motif-dependent semantics.

- [x] **Step 3: Generate `MTF-001`**

Generate a wide modular strip/tile board with Buntut connector and the four distinct lakon motifs. Require clean joins, no infinity loop, and decoration subordinate to information.

- [x] **Step 4: Inspect, repair, convert, and record QA**

Check ratio-specific safe zones, diagram symbol distinction, connector direction, motif joins, and text-free output. Convert selected outputs, create two contact sheets, and add six QA rows.

- [x] **Step 5: Commit final family assets**

```bash
git add internal/assets/illustration
git commit -m "feat(illustration): add social and system-kit masters"
```

### Task 7: Completion audit and documentation

**Files:**
- Modify: `internal/assets/illustration/qa-report.md`
- Modify: `internal/assets/illustration/README.md`
- Modify: `internal/docs/README.md` only if a new internal Source-of-Truth document is introduced.

**Interfaces:**
- Consumes: all 41 inventory records and outputs.
- Produces: evidence that every requested catalog ID has a valid, inspected WebP and a clear statement of delivery limitations.

- [x] **Step 1: Run structural verification**

Run: `node internal/assets/illustration/verify.mjs`

Expected: `PASS: 41/41 catalog masters are valid WebP files` and no missing, duplicate, wrong-format, orientation, or alpha errors.

- [x] **Step 2: Inspect all contact sheets**

Inspect model, Narrative, spot, product-state, mascot-pose, sticker, social, and system-kit contact sheets. Confirm every image has a completed QA row and no family-level identity drift is visible.

- [x] **Step 3: Verify repository diff**

Run:

```bash
git diff --check main...HEAD
git status --short
find internal/assets/illustration -type f -name '*.webp' | sort
```

Expected: clean whitespace check; exactly 41 master WebPs plus named QA contact sheets; no unexpected raster format.

- [x] **Step 4: Run docs checks**

Run: `hanoman docs index --check && hanoman docs scan`

Expected: index integrity passes; coverage output is recorded without introducing a new failure.

- [x] **Step 5: Final commit**

```bash
git add internal/assets/illustration docs/superpowers
git commit -m "docs(illustration): record delivery QA"
```

- [x] **Step 6: Re-run completion evidence**

Re-run the structural validator, inspect `git status --short --branch`, and compare the inventory ID set directly against the catalog. Do not declare completion while any ID, QA row, or required visual repair is missing.
