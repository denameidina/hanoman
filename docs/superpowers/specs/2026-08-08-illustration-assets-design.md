# Hanoman Illustration Assets Design

## Objective

Produce the complete 41-item master inventory defined by
`internal/brand/illustration/04-asset-catalog.md` as project-ready WebP files under
`internal/assets/illustration/`.

The request narrows delivery to one WebP per catalog ID. Editable sources, SVG/PDF interchange,
responsive crop matrices, per-asset manifests, and motion layers remain outside this delivery.

## Production approach

Use a model-first dependency chain:

1. Establish `MOD-001`, the three-tier Narrative–Editorial–Mascot character model.
2. Establish `MSC-001`, the compact mascot model derived from `MOD-001`.
3. Generate Narrative families (`HRO-001`, `LKN-001`–`LKN-004`).
4. Generate Editorial and product-state families (`SPT-001`–`SPT-006`,
   `PST-001`–`PST-006`).
5. Generate pose and sticker families (`MPS-001`–`MPS-008`, `STK-001`–`STK-008`).
6. Generate social and system kits (`SOC-001`–`SOC-004`, `DGM-001`, `MTF-001`).

Every derivative prompt carries the same identity anchors: white rewanda; one visible eye in
presentation profile; lifted head; relatively flat rear shoulder; supit urang; ulur-ulur; agile,
non-bodybuilder anatomy; one anatomically connected long Buntut tail; intelligent, dignified affect.

## Visual system

- Style: contemporary Indonesian editorial wayang with kelir-like fields, flat shapes, ink
  keylines, controlled tatahan rhythm, restrained paper/ink grain, and deliberate negative space.
- Palette roles: warm bone for workspace and documents, deep ink for structure, restrained brass
  for intent/action, wind blue for information, and leaf/amber/clay only for semantic states.
- Text policy: no baked words, labels, logos, screenshots, terminal text, code, signatures, or
  watermarks.
- Product proof: use abstract, truthful objects and relationships rather than invented UI.
- Cultural boundary: do not imitate a collection object or living artist and do not mix regional or
  generic pan-Asian ornament.
- Character boundary: no frontal two-eye face, extra limbs, extra tails, realistic fur, generic
  monkey mascot, chibi construction, superhero anatomy, hoodie/laptop shorthand, or slapstick.

## Composition and outputs

Each catalog ID receives one stable lowercase filename:

`hnm-ill-{family}-{subject}-{ratio}-master-v01.webp`

The ratio token follows the catalog (`16x9`, `4x3`, `1x1`, `4x5`, `9x16`, `sheet`, `modular`, or
`tile-strip`). Model sheets, technical kits, and motif kits use a wide board suitable for inspecting
all included views or primitives. Narrative assets preserve at least one-third quiet field and keep
the focal eye, hand/prop, and Buntut action uncropped. Mascot pose and sticker masters use a
transparent WebP canvas with 12% safe margin; other assets use a warm bone/kelir field unless their
brief calls for a dark terminal field.

The built-in image generation path determines native pixel dimensions. Files are not upscaled and
will be described as raster deliverables rather than claiming the illustration-system's 3200 px
editable-master gate when the generated native dimensions do not satisfy it.

## Family-specific intent

- `MOD-001`: profile, back silhouette, three-quarter adaptation, three tier comparison, gesture and
  costume callouts, with no textual labels baked into the art.
- `MSC-001`: compact 3.5–4-head-unit mascot construction and scale/pose comparison.
- `HRO-001`: documented intent travels through a visible isolated session path and returns evidence
  to grounded human control; right third remains copy-safe.
- `LKN-001`–`LKN-004`: respectively intact mandate and returned evidence, controlled ember resolving
  into a branch/diff, bounded context mountain plus human decision, and finite session-to-docs
  continuity that becomes ground for the next actor.
- `SPT-001`–`SPT-006`: context, visibility, isolation, human control, parallel work, and durable
  knowledge as distinct one-prop symbolic actions.
- `PST-001`–`PST-006`: literal-first onboarding, empty backlog, active session, awaiting decision,
  success, and recoverable error states with low mythic intensity.
- `MPS-001`–`MPS-008`: neutral, welcome, observe, work, ask, warn, celebrate, and carry-knowledge
  poses using their documented gesture/expression/tail mappings.
- `STK-001`–`STK-008`: ready, working, waiting, blocked, shipped, review, thanks, and docs-updated
  reactions, text-free with bold shared outer contour.
- `SOC-001`–`SOC-004`: four independently composed release fields with separate character,
  proof-object, and headline-safe zones.
- `DGM-001`: monochrome-readable human, agent, docs, backlog, session, terminal, branch, worktree,
  state, boundary, and directional connector primitives.
- `MTF-001`: modular Buntut connector plus Duta, Obong, Dronagiri, and Chiranjivi motifs without
  false loops.

## Validation

Create a machine-readable inventory alongside the images containing ID, family, subject, ratio,
filename, background requirement, and prompt intent. Validate all 41 IDs are present exactly once,
all outputs decode as WebP, dimensions match their intended aspect class within encoding tolerance,
transparent-required outputs have alpha, filenames follow the stable convention, and no extra
raster formats are shipped.

Generate contact sheets per phase and inspect every image at full view and thumbnail size. Record
pass/fail for identity, anatomy, one-tail construction, intended action, product truth, text-free
output, safe area, and obvious generation artifacts. Regenerate any failed asset with one targeted
repair prompt.

## Known delivery boundary

These WebPs are AI-produced flattened raster masters. They can satisfy the requested visual asset
delivery, but they cannot independently provide the human cultural-review approvals, editable layer
structure, licensed visual-reference record, or human-redrawn canonical anatomy required for a full
Gate 5 production package. The final handoff will state this boundary explicitly rather than
fabricating approvals or provenance.
