# Hanoman Illustration System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat 21 dokumen brief produksi yang memungkinkan illustrator manusia dan AI image generator menghasilkan 41 aset ilustrasi Hanoman secara konsisten, berakar pada wayang kulit purwa gaya Surakarta, dan siap untuk delivery static-first.

**Architecture:** `internal/docs/brand/illustration/README.md` menjadi router menuju sembilan dokumen sistem dan sebelas family briefs. Art direction, character model, mascot, serta references menetapkan identitas; asset catalog menetapkan inventory; production template, workflow, prompt library, dan delivery QA mengatur produksi; family briefs menerapkan seluruh aturan tanpa mendefinisikan ulang brand.

**Tech Stack:** Markdown, SVG/PNG/WebP/PDF delivery conventions, Figma/Illustrator/Affinity/PSD source conventions, AI image-generation prompt blocks, Hanoman docs CLI, Git.

## Global Constraints

- Gaya utama: **editorial wayang kontemporer**.
- Jangkar rupa: **wayang kulit purwa gaya Surakarta**; satu reference image tidak boleh diperlakukan sebagai seluruh variasi kanonik.
- Sistem karakter: satu Anoman dengan tier **Narrative**, **Editorial**, dan **Mascot**.
- Mascot adalah penyederhanaan karakter yang sama; bukan chibi, hewan realistis, atau generic monkey mascot.
- Paket inventory harus menghitung tepat **41 deliverable**.
- Sistem dokumentasi harus memuat tepat **21 file** di bawah `internal/docs/brand/illustration/`.
- Produksi hybrid: satu master brief melayani illustrator manusia dan AI-assisted workflow.
- AI dipakai untuk eksplorasi komposisi; core model sheet dan anatomi kanonik wajib dikurasi/redraw.
- Static-first dengan minimum layer `bg`, `environment`, `character-base`, `character-gesture`, `buntut-fx`, `foreground`, `text-safe`.
- Master artwork tidak membake text, logo, atau screenshot produk.
- Tidak ada literal warna baru; gunakan semantic roles dari design system.
- Nama produk **Hanoman**; nama lakon Jawa **Anoman Duta** dan **Anoman Obong**; **Hanuman** hanya ketika mengikuti sumber.
- Semua core docs bilingual Indonesia–Inggris; specification teknis identik tidak perlu diduplikasi.
- Setiap cultural claim mempunyai provenance dan setiap source image mempunyai license/status izin.
- Tidak ada artwork final, perubahan kode, token, komponen UI, dependency, atau skema pada scope ini.
- Verifikasi hanya scope docs: structure, field coverage, inventory count, local links, placeholder scan, index, coverage, diff, dan clean worktree.

---

### Task 1: Illustration Router, Art Direction, and References

**Files:**
- Create: `internal/docs/brand/illustration/README.md`
- Create: `internal/docs/brand/illustration/01-art-direction.md`
- Create: `internal/docs/brand/illustration/references.md`

**Interfaces:**
- Consumes: `internal/docs/brand/01-foundation.md`, `02-four-lakons.md`, `03-personality-voice.md`, `05-visual-identity.md`, `06-brand-in-practice.md`, `sources.md`, dan design spec.
- Produces: navigation, visual language, cultural/reference rules, dan shared vocabulary yang dikonsumsi semua task berikutnya.

- [ ] **Step 1: Create the illustration-system router**

Write `internal/docs/brand/illustration/README.md` with:

- exact purpose: production briefs, not finished artwork;
- audience routes for product owner, art director, illustrator, AI operator, cultural reviewer, and delivery reviewer;
- navigation in exact order: Art direction, Character model sheet, Mascot system, Asset catalog, Production brief template, Human/AI workflow, Prompt library, Delivery QA, References, Family briefs;
- quick facts: 3 tiers, 41 deliverables, 5 approval gates after product truth, hybrid production, static-first;
- Source of Truth hierarchy: product docs → brand foundation/lakons → visual identity → illustration system → asset brief → delivery manifest;
- start checklist that prevents production before product truth, tier, surface, reference, and owner are known.

- [ ] **Step 2: Write art direction**

Write `01-art-direction.md` with paired Indonesia/English sections:

1. Visual thesis
2. Form language
3. Editorial Surakarta lens
4. Composition
5. Color roles
6. Texture
7. Typography and product proof
8. Static-first layers
9. Responsive crops
10. Mythic intensity by surface
11. Accessibility
12. Cultural care
13. Do/Don't

Include the approved numerical production guidance: figure 35–55% of field, negative space at least one third, one focal action, one lakon/message, and 3200 px minimum long side for raster narrative masters. Link exact token values back to the design system instead of copying color values.

- [ ] **Step 3: Write the reference protocol**

Write `references.md` with:

- a source hierarchy: academic/museum/cultural institution → documented collection/craft source → secondary editorial source → visual inspiration only;
- the four Surakarta sources from the design spec and a support statement for each;
- existing Hanoman brand-source links;
- a reference-record template containing ID, title, creator, institution, tradition/style, date, URL, access date, supported claim, license/status, allowed use, and reviewer note;
- `Reference board acceptance`: one source for silhouette/classification, one for comparative form, one for wanda/function, and one approved visual object before Gate 1;
- rules against copying museum scans, mixing regional traditions, using unlicensed images in AI reference packs, or prompting in the style of a living artist.

- [ ] **Step 4: Verify shared foundation**

Run:

```bash
rg -n "T[B]D|T[O]DO|F[I]XME|lorem ipsum|fill in lat[e]r" internal/docs/brand/illustration
rg -n "Narrative|Editorial|Mascot|41|static-first|Surakarta" internal/docs/brand/illustration/README.md
rg -n "35–55|one third|3200|bg|character-base|buntut-fx|text-safe" internal/docs/brand/illustration/01-art-direction.md
rg -n "repository.um.ac.id|repository.isi-ska.ac.id|jurnal.isi-ska.ac.id|digilib.isi.ac.id" internal/docs/brand/illustration/references.md
git diff --check
```

Expected: placeholder scan has no output; all required concepts and sources are found; diff check exits 0.

- [ ] **Step 5: Commit foundation docs**

```bash
git add internal/docs/brand/illustration/README.md internal/docs/brand/illustration/01-art-direction.md internal/docs/brand/illustration/references.md
git commit -m "docs(illustration): define art direction and references"
```

### Task 2: Character Model, Mascot System, and 41-Asset Catalog

**Files:**
- Create: `internal/docs/brand/illustration/02-character-model-sheet.md`
- Create: `internal/docs/brand/illustration/03-mascot-system.md`
- Create: `internal/docs/brand/illustration/04-asset-catalog.md`

**Interfaces:**
- Consumes: art direction and reference protocol from Task 1.
- Produces: canonical character anchors, tier transformations, mascot construction, and stable asset IDs used by every brief and prompt.

- [ ] **Step 1: Write the character model-sheet specification**

Write `02-character-model-sheet.md` with:

- canonical anchors: white rewanda, one-eye profile, slightly lifted head, relatively flat rear shoulder, supit urang, ulur-ulur, long Buntut-linked tail, agile body, intelligent/dignified expression, semantic color roles;
- explicit note distinguishing source-backed Surakarta observations from Hanoman production decisions;
- adaptable details;
- tier comparison table for Narrative, Editorial, Mascot;
- required views: presentation profile, back silhouette, three-quarter adaptation, neutral/action line;
- 12 gesture IDs `GST-01`…`GST-12` with meaning and allowed tier;
- 8 expression IDs `EXP-01`…`EXP-08` designed for profile readability;
- 4 tail IDs `TAL-01`…`TAL-04` for neutral, guide, action, continuity;
- exploded costume view and detail-callout checklist;
- one-color, thumbnail, minimum-size, crop, and overlay tests;
- layer map and Gate 2 checklist.

- [ ] **Step 2: Write the mascot system**

Write `03-mascot-system.md` with:

- the mascot thesis: compact Anoman, not a separate species/personality;
- 3.5–4 head-unit production target and head no more than approximately 28% of figure height, marked as adjustable production guidance;
- locked silhouette anchors and permitted simplifications;
- facial expression through visible eye, brow, muzzle angle, head tilt, hand gesture, and tail—not frontal emoji face;
- scale bands for avatar, sticker, product state, social spot;
- eight pose/expression IDs `MPS-01`…`MPS-08`: neutral, welcome, observe, work, ask, warn, celebrate, carry knowledge;
- eight sticker IDs `STK-01`…`STK-08`: ready, working, waiting, blocked, shipped, review, thanks, docs updated;
- reusable parts guidance without rigid puppet appearance;
- do/don't and Gate 2 mascot checklist.

- [ ] **Step 3: Create the exact 41-deliverable catalog**

Write `04-asset-catalog.md` with one row per deliverable using fields:

`ID | Family | Name | Qty unit | Tier | Priority | Surface | Master ratio | Executor | Dependency | Brief`

Use these IDs and counts:

- `MOD-001` character model; `MSC-001` mascot model; `HRO-001` homepage hero;
- `LKN-001` Duta, `LKN-002` Obong, `LKN-003` Dronagiri, `LKN-004` Chiranjivi;
- `SPT-001` context, `SPT-002` visibility, `SPT-003` isolation, `SPT-004` human control, `SPT-005` parallel work, `SPT-006` durable knowledge;
- `PST-001` onboarding, `PST-002` empty backlog, `PST-003` session active, `PST-004` awaiting decision, `PST-005` success, `PST-006` recoverable error;
- `MPS-001`…`MPS-008` in the mascot order from Step 2;
- `STK-001`…`STK-008` in the sticker order from Step 2;
- `SOC-001` 1:1, `SOC-002` 4:5, `SOC-003` 16:9, `SOC-004` 9:16;
- `DGM-001` technical diagram kit; `MTF-001` lakon/Buntut motif kit.

Add phase order: Phase A model/reference, Phase B hero/lakons, Phase C spot/product, Phase D mascot/sticker, Phase E social/diagram/motif. Include a machine-checkable summary table whose family quantities sum to 41.

- [ ] **Step 4: Verify model and inventory**

Run:

```bash
rg -n "GST-(01|12)|EXP-(01|08)|TAL-(01|04)|one-color|Gate 2" internal/docs/brand/illustration/02-character-model-sheet.md
rg -n "MPS-(01|08)|STK-(01|08)|3.5–4|28%|chibi" internal/docs/brand/illustration/03-mascot-system.md
node --input-type=module <<'NODE'
import fs from "node:fs";
const body = fs.readFileSync("internal/docs/brand/illustration/04-asset-catalog.md", "utf8");
const ids = [...body.matchAll(/`((?:MOD|MSC|HRO|LKN|SPT|PST|MPS|STK|SOC|DGM|MTF)-\d{3})`/g)].map((m) => m[1]);
const unique = new Set(ids);
if (unique.size !== 41) throw new Error(`expected 41 unique IDs, got ${unique.size}`);
console.log("asset catalog ok (41 unique IDs)");
NODE
git diff --check
```

Expected: required model ranges found; catalog script reports 41 unique IDs; diff check exits 0.

- [ ] **Step 5: Commit character and catalog docs**

```bash
git add internal/docs/brand/illustration/02-character-model-sheet.md internal/docs/brand/illustration/03-mascot-system.md internal/docs/brand/illustration/04-asset-catalog.md
git commit -m "docs(illustration): specify character mascot and asset catalog"
```

### Task 3: Production Template, Hybrid Workflow, Prompt Library, and Delivery QA

**Files:**
- Create: `internal/docs/brand/illustration/05-production-brief-template.md`
- Create: `internal/docs/brand/illustration/06-human-ai-workflow.md`
- Create: `internal/docs/brand/illustration/07-prompt-library.md`
- Create: `internal/docs/brand/illustration/08-delivery-qa.md`

**Interfaces:**
- Consumes: stable character/tier rules and catalog IDs from Tasks 1–2.
- Produces: repeatable brief fields, production gates, composable prompts, and delivery evidence used by all family briefs.

- [ ] **Step 1: Write the copy-ready master brief template**

Write `05-production-brief-template.md` as a copyable Markdown template with exact headings:

`Metadata`, `Objective`, `Audience and action`, `Product truth`, `Lakon/principle`, `Character tier`, `Scene and emotional beat`, `Locked anchors`, `Motifs and props`, `Composition`, `Color/detail`, `Layer map`, `Responsive outputs`, `Alt-text intent`, `References and rights`, `Executor path`, `Human handoff`, `AI prompt blocks`, `Do`, `Don't`, `Acceptance`, `Approval record`, `Delivery manifest`.

Every field includes a one-sentence instruction and one valid Hanoman example. Approval record contains Gate 0–5 owner/date/evidence rows.

- [ ] **Step 2: Write the hybrid workflow**

Write `06-human-ai-workflow.md` with:

- role/RACI table for product owner, art director, illustrator, AI operator, cultural reviewer, accessibility reviewer, delivery reviewer;
- intake and reference-board steps shared by both paths;
- the approved eight-step human workflow;
- the approved eight-step AI-assisted workflow;
- decision table for human-first, AI-assisted, and hybrid use;
- Gate 0–5 entry/exit/evidence/stop conditions;
- correction checklist for hands, eyes, costume, tail, tatahan, product props, text, watermark, fake UI, and mixed ornament;
- iteration/versioning, rejection, and escalation rules;
- disclosure and provenance requirements.

- [ ] **Step 3: Write a composable prompt library**

Write `07-prompt-library.md` with copy-ready blocks:

- `IDENTITY_CORE` containing canonical anchors and Surakarta reference language;
- `TIER_NARRATIVE`, `TIER_EDITORIAL`, `TIER_MASCOT`;
- `STYLE_EDITORIAL_WAYANG`;
- composition blocks for hero, spot, product state, sticker, social, and diagram;
- motif blocks for Duta, Obong, Dronagiri, Chiranjivi;
- one prompt for each asset family brief (11 prompts minimum);
- shared `NEGATIVE_CORE` rejecting frontal two-eyed face, extra limbs/tails, generic mascot, chibi, superhero anatomy, mixed Asian ornament, neon AI imagery, text, watermark, and fake UI;
- repair prompts for face/profile, hands, tail, costume, silhouette, and background simplification;
- reference-image instructions and a warning that prompt text cannot substitute for the approved model sheet;
- prompt record template: model, version, date, seed/job ID when available, image references, prompt blocks, negative block, selected output, manual changes, reviewer.

Do not claim deterministic reproduction across models.

- [ ] **Step 4: Write delivery and QA**

Write `08-delivery-qa.md` with:

- folder tree and naming `hnm-ill-{family}-{subject}-{ratio}-{variant}-vNN`;
- source/interchange/export table: editable source, SVG, PNG, WebP, PDF;
- sRGB and 2× output rules; 3200 px narrative raster rule;
- required layer names and optional motion-ready splits;
- responsive crop matrix;
- light field, dark field when needed, one-color, reduced-detail, thumbnail, and zoom tests;
- accessibility, alt text, contrast, and reduced-motion considerations;
- cultural provenance, AI disclosure, prompt/model record, source image rights, and license checks;
- `manifest.md` copy-ready template;
- final Gate 5 checklist and rejected-delivery examples.

- [ ] **Step 5: Verify production system**

Run:

```bash
rg -n '^## (Metadata|Objective|Audience and action|Product truth|Approval record|Delivery manifest)' internal/docs/brand/illustration/05-production-brief-template.md
rg -n "Gate (0|1|2|3|4|5)|RACI|human-first|AI-assisted|hybrid" internal/docs/brand/illustration/06-human-ai-workflow.md
rg -n "IDENTITY_CORE|TIER_NARRATIVE|TIER_EDITORIAL|TIER_MASCOT|NEGATIVE_CORE|repair|seed/job ID" internal/docs/brand/illustration/07-prompt-library.md
rg -n "hnm-ill-|SVG|PNG|WebP|PDF|sRGB|3200|manifest.md|Gate 5" internal/docs/brand/illustration/08-delivery-qa.md
git diff --check
```

Expected: every required field/gate/block/format is found; diff check exits 0.

- [ ] **Step 6: Commit production docs**

```bash
git add internal/docs/brand/illustration/05-production-brief-template.md internal/docs/brand/illustration/06-human-ai-workflow.md internal/docs/brand/illustration/07-prompt-library.md internal/docs/brand/illustration/08-delivery-qa.md
git commit -m "docs(illustration): add hybrid production and delivery workflow"
```

### Task 4: Hero and Four-Lakon Narrative Briefs

**Files:**
- Create: `internal/docs/brand/illustration/briefs/00-homepage-hero.md`
- Create: `internal/docs/brand/illustration/briefs/01-anoman-duta.md`
- Create: `internal/docs/brand/illustration/briefs/02-anoman-obong.md`
- Create: `internal/docs/brand/illustration/briefs/03-gunung-dronagiri.md`
- Create: `internal/docs/brand/illustration/briefs/04-chiranjivi.md`

**Interfaces:**
- Consumes: production template, model sheet, prompt blocks, catalog IDs, and four-lakon meanings.
- Produces: five approved Narrative-tier briefs that establish the style bar for all later assets.

- [ ] **Step 1: Write the homepage hero brief**

Use asset `HRO-001`, Narrative tier. Scene: Anoman crosses a kelir-like field, carries intent/docs into a visible session path, and returns evidence through Buntut toward a calm control-room proof area. The composition must reserve copy-safe space, show human control without a second heroic character, and support desktop/tablet/mobile plus social crops. Include human handoff, complete AI prompt, negative block reference, layer map, alt-text intent, and Gate 0–5 acceptance.

- [ ] **Step 2: Write Anoman Duta brief**

Use `LKN-001`. Canonical line: `Pahami dan bawa amanat dengan utuh / Understand the intent and carry it intact.` Scene: profile Anoman crosses a boundary carrying ring/mandate; the return path carries a result marker. Product proof: docs/objective/spec. Exclude random code glyphs and motion without sender/destination/return.

- [ ] **Step 3: Write Anoman Obong brief**

Use `LKN-002`. Canonical line: `Bertindak tegas sampai ada hasil / Act decisively until there is an outcome.` Scene: a calm Buntut line becomes controlled flame crossing a checklist-shaped obstacle and ends at branch/diff. Explicitly exclude burning cities, explosions, angry mascot expression, violence, and destructive product implication.

- [ ] **Step 4: Write Gunung Dronagiri brief**

Use `LKN-003`. Canonical line: `Utamakan kelengkapan daripada kepastian palsu / Choose sufficient context over false certainty.` Scene: Anoman supports a deliberate mountain of objective/docs/history/diff/questions; only relevant layers are labeled; a human operator holds the final decision. Exclude infinite data piles and agent-only decisions.

- [ ] **Step 5: Write Chiranjivi brief**

Use `LKN-004`. Canonical line: `Buat pengetahuan hidup lebih lama daripada pelakunya / Make knowledge outlive the actor.` Scene: Buntut passes through session/branch/merge/docs frames and exits as ground for the next actor. Exclude infinity-symbol shortcuts, eternal loading, and claims that docs never change.

- [ ] **Step 6: Verify narrative briefs**

Run:

```bash
for f in internal/docs/brand/illustration/briefs/{00-homepage-hero,01-anoman-duta,02-anoman-obong,03-gunung-dronagiri,04-chiranjivi}.md; do
  rg -q "Asset ID" "$f" && rg -q "Product truth" "$f" && rg -q "Character tier" "$f" && rg -q "Layer map" "$f" && rg -q "Alt-text intent" "$f" && rg -q "Acceptance" "$f" || exit 1
done
rg -n "HRO-001|LKN-001|LKN-002|LKN-003|LKN-004" internal/docs/brand/illustration/briefs
git diff --check
```

Expected: every brief contains mandatory sections and all five IDs are found; diff check exits 0.

- [ ] **Step 7: Commit narrative briefs**

```bash
git add internal/docs/brand/illustration/briefs/00-homepage-hero.md internal/docs/brand/illustration/briefs/01-anoman-duta.md internal/docs/brand/illustration/briefs/02-anoman-obong.md internal/docs/brand/illustration/briefs/03-gunung-dronagiri.md internal/docs/brand/illustration/briefs/04-chiranjivi.md
git commit -m "docs(illustration): add hero and four-lakon briefs"
```

### Task 5: Spot, Product, Mascot, Sticker, Social, Diagram, and Motif Briefs

**Files:**
- Create: `internal/docs/brand/illustration/briefs/05-spot-illustrations.md`
- Create: `internal/docs/brand/illustration/briefs/06-product-states.md`
- Create: `internal/docs/brand/illustration/briefs/07-mascot-pose-pack.md`
- Create: `internal/docs/brand/illustration/briefs/08-sticker-pack.md`
- Create: `internal/docs/brand/illustration/briefs/09-social-release-templates.md`
- Create: `internal/docs/brand/illustration/briefs/10-diagram-and-motif-kit.md`

**Interfaces:**
- Consumes: style bar from Task 4 and system docs from Tasks 1–3.
- Produces: actionable briefs for the remaining 34 deliverables.

- [ ] **Step 1: Write the six-spot family brief**

For `SPT-001`…`SPT-006`, provide one row and one mini-brief each with objective, Editorial-tier scene, motif, product proof, primary ratio, layer exceptions, alt-text intent, and do/don't. Use: context/Duta path; visibility/kelir-terminal; isolation/separate worktree fields; human control/hand steering Buntut; parallel work/multiple paths without collision; durable knowledge/Chiranjivi trace.

- [ ] **Step 2: Write the six-product-state brief**

For `PST-001`…`PST-006`, use Mascot tier and literal UI state first. Each mini-brief defines compact scene, emotional tone, no-metaphor fallback, empty-state copy relationship, one-color requirement, minimum-size test, and alt text. Recoverable error must never use mythic language instead of cause/recovery.

- [ ] **Step 3: Write the mascot pose pack**

For `MPS-001`…`MPS-008`, map neutral/welcome/observe/work/ask/warn/celebrate/carry knowledge to model-sheet gesture/expression/tail IDs. Include pose consistency grid, avatar/sticker/product-state scale, transparent background, mirrored-use restriction, and reusable-parts delivery.

- [ ] **Step 4: Write the sticker pack**

For `STK-001`…`STK-008`, define ready/working/waiting/blocked/shipped/review/thanks/docs updated. Each sticker specifies gesture, expression, tail, optional separate text layer, one-color silhouette, small-size test, platform-safe transparent margin, and an English/Indonesian text-free preference. Do not bake localized words into the master.

- [ ] **Step 5: Write social/release templates**

For `SOC-001`…`SOC-004`, define 1:1, 4:5, 16:9, 9:16 safe areas. Include character zone, product-proof zone, headline zone, logo exclusion/placement guide, crop inheritance, light/dark field behavior, and examples for feature release, changelog, community, and quote. Master illustration remains text-free.

- [ ] **Step 6: Write diagram and motif kit brief**

For `DGM-001`, define primitives for human, agent, docs, backlog, session, terminal, branch, worktree, arrows, state, and boundary; diagrams remain literal and accessible without wayang knowledge. For `MTF-001`, define Buntut plus Duta/Obong/Dronagiri/Chiranjivi motif primitives, approved joins, one-color behavior, and prohibition on using motifs as status icons without labels.

- [ ] **Step 7: Verify utility briefs**

Run:

```bash
rg -n "SPT-00[1-6]" internal/docs/brand/illustration/briefs/05-spot-illustrations.md
rg -n "PST-00[1-6]" internal/docs/brand/illustration/briefs/06-product-states.md
rg -n "MPS-00[1-8]" internal/docs/brand/illustration/briefs/07-mascot-pose-pack.md
rg -n "STK-00[1-8]" internal/docs/brand/illustration/briefs/08-sticker-pack.md
rg -n "SOC-00[1-4]" internal/docs/brand/illustration/briefs/09-social-release-templates.md
rg -n "DGM-001|MTF-001" internal/docs/brand/illustration/briefs/10-diagram-and-motif-kit.md
git diff --check
```

Expected: all remaining 34 IDs are found and diff check exits 0.

- [ ] **Step 8: Commit utility briefs**

```bash
git add internal/docs/brand/illustration/briefs
git commit -m "docs(illustration): add product mascot and campaign briefs"
```

### Task 6: Cross-Links, Structural Audit, and Final Verification

**Files:**
- Modify: `internal/docs/brand/README.md`
- Modify: `internal/docs/brand/05-visual-identity.md`
- Modify: `internal/docs/brand/06-brand-in-practice.md`
- Modify: `internal/docs/brand/sources.md`
- Modify: `internal/docs/README.md`
- Modify if audit finds inconsistency: `internal/docs/brand/illustration/**/*.md`

**Interfaces:**
- Consumes: all 21 completed illustration docs.
- Produces: discoverable system and evidence that structure, IDs, fields, links, terminology, and coverage are correct.

- [ ] **Step 1: Add cross-links without duplicating guidance**

- Add `Illustration system` to `internal/docs/brand/README.md` after Visual identity.
- Add a production handoff paragraph to the Illustration section in `05-visual-identity.md` linking to `illustration/README.md`.
- Replace the four existing illustration-brief examples in `06-brand-in-practice.md` with a short note that they are concept examples and link to the detailed family briefs; retain existing examples.
- Add the Surakarta sources and production-reference protocol link to `sources.md`.
- Expand the existing `## brand` entry in `internal/docs/README.md` with a child link to `brand/illustration/README.md`.

- [ ] **Step 2: Verify exact structure**

Run:

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
const root = "internal/docs/brand/illustration";
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const files = walk(root).filter((file) => file.endsWith(".md"));
if (files.length !== 21) throw new Error(`expected 21 markdown files, got ${files.length}`);
console.log("illustration docs ok (21 files)");
NODE
```

- [ ] **Step 3: Verify unique 41-asset coverage across the catalog**

Run the unique-ID script from Task 2 and confirm 41. Then verify every catalog ID appears at least once under `briefs/` or in the two model-system docs. Print missing IDs and fail if any are absent.

- [ ] **Step 4: Check mandatory fields in all eleven family briefs**

Run a Node script that checks every file in `illustration/briefs/` contains: `Objective`, `Product truth`, `Character tier`, `Composition`, `Layer map`, `Responsive outputs`, `Alt-text intent`, `Do`, `Don't`, `Acceptance`. Family-pack briefs may provide these as shared sections plus per-item rows.

- [ ] **Step 5: Check every local Markdown link**

Run the repository's read-only link script pattern across `internal/docs/brand/illustration/**/*.md` and the five modified index/source docs. Ignore HTTP(S), mailto, and anchors; fail on missing local targets.

- [ ] **Step 6: Run terminology and placeholder audit**

```bash
rg -n "T[B]D|T[O]DO|F[I]XME|lorem ipsum|fill in lat[e]r|versi asli|one true" internal/docs/brand/illustration
rg -n "Hanuman Duta|Hanuman Obong|Hanoman Duta|Hanoman Obong" internal/docs/brand/illustration
rg -n "generic monkey mascot|chibi|extra limbs|mixed Asian ornament" internal/docs/brand/illustration
git diff --check
```

Expected: first two commands have no output; prohibited visual phrases appear only inside explicit Don't/negative/repair guidance; diff check exits 0.

- [ ] **Step 7: Run Hanoman docs verification**

```bash
pnpm --filter ./cli build
node cli/dist/hanoman.js docs index --check
node cli/dist/hanoman.js docs scan --json
git diff --check
git status --short
```

Expected: build succeeds; index reports `index ok`; coverage remains `100`; only Task 6 files are uncommitted.

- [ ] **Step 8: Review final diff against the design**

Confirm all 13 acceptance criteria in the design spec map to a file or verification result. Confirm no artwork binary, dependency, code, token, component, or unrelated file entered the diff.

- [ ] **Step 9: Commit integration and audit corrections**

```bash
git add internal/docs/brand/README.md internal/docs/brand/05-visual-identity.md internal/docs/brand/06-brand-in-practice.md internal/docs/brand/sources.md internal/docs/brand/illustration internal/docs/README.md
git commit -m "docs(illustration): link and verify production brief system"
```

- [ ] **Step 10: Confirm clean worktree**

```bash
git status --short --branch
git log -8 --oneline
```

Expected: branch `docs/illustration-brief`, no uncommitted files, and design, plan, plus six implementation commits visible.
