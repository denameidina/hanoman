# Prompt library / Pustaka prompt

Prompt blocks are composable exploration aids. They cannot substitute for the approved model sheet,
and identical prompts may produce different results across models, versions, and runs.

## Core blocks

`IDENTITY_CORE` — Anoman as a white rewanda rooted in wayang kulit purwa Surakarta references;
one-eye presentation profile, slightly lifted head, relatively flat rear shoulder, supit urang,
ulur-ulur, long single Buntut-linked tail, agile dignified body, intelligent expression; follow the
attached approved model sheet rather than inventing anatomy.

`TIER_NARRATIVE` — elongated wayang-led proportion, full costume rhythm and controlled tatahan,
dramatic but dignified gesture, readable silhouette.

`TIER_EDITORIAL` — moderately compact proportion, reduced interior detail, clear symbolic props,
legible at documentation and product-support scale.

`TIER_MASCOT` — same Anoman identity at 3.5–4 head units, head approximately ≤28% height, essential
contour and profile cues, warm but not childish.

`STYLE_EDITORIAL_WAYANG` — contemporary Indonesian editorial illustration using kelir-like fields,
cut-paper/tatahan rhythm, restrained texture, semantic bone/ink/brass/ember roles, strong negative
space, one focal action; interpretation, not a reproduction of a collection object.

`NEGATIVE_CORE` — no frontal two-eyed face, extra limb, extra tail, generic monkey mascot, chibi,
superhero anatomy, realistic fur, mixed Asian/regional ornament, neon AI imagery, baked text, logo,
watermark, signature, fake product UI, illegible fingers, or copied museum artifact.

## Composition blocks

- `COMP_HERO`: wide 16:9, figure 35–55%, at least one-third text-safe negative space, separable depth layers.
- `COMP_SPOT`: compact 1:1 symbolic action, one prop, reduced background, silhouette-first.
- `COMP_PRODUCT`: calm 4:3 product-support state, low mythic intensity, empty center for UI context; never fake UI.
- `COMP_STICKER`: centered single gesture, transparent margin, bold contour, readable at 96 px, text-free master.
- `COMP_SOCIAL`: modular subject and atmosphere, safe zones adaptable to 1:1, 4:5, 16:9, and 9:16.
- `COMP_DIAGRAM`: orthogonal information flow, Buntut connector, restrained character cameo, labels remain external.

## Motif blocks

- `MOTIF_DUTA`: mandate ring/folio travels outward and evidence returns; purpose before motion.
- `MOTIF_OBONG`: controlled ember passes through checklist steps and resolves as a clean branch/diff; no burning city.
- `MOTIF_DRONAGIRI`: lift a bounded context-mountain containing objective, docs, history, diff, and questions; human decides.
- `MOTIF_CHIRANJIVI`: continuous tail/path links session, branch, merge, and durable docs across time.

## Family prompts

1. Model: `IDENTITY_CORE + three-tier comparison sheet, profile/back/three-quarter/gesture callouts + NEGATIVE_CORE`.
2. Mascot: `IDENTITY_CORE + TIER_MASCOT + scale/pose sheet, transparent field + NEGATIVE_CORE`.
3. Hero: `IDENTITY_CORE + TIER_NARRATIVE + STYLE_EDITORIAL_WAYANG + COMP_HERO + MOTIF_DUTA + NEGATIVE_CORE`.
4. Lakon: `IDENTITY_CORE + TIER_NARRATIVE + STYLE_EDITORIAL_WAYANG + [one MOTIF_*] + one emotional beat + NEGATIVE_CORE`.
5. Spot: `IDENTITY_CORE + TIER_EDITORIAL + COMP_SPOT + one product principle as symbolic action + NEGATIVE_CORE`.
6. Product state: `IDENTITY_CORE + TIER_EDITORIAL + COMP_PRODUCT + one truthful state + NEGATIVE_CORE`.
7. Mascot pose: `IDENTITY_CORE + TIER_MASCOT + one GST/EXP/TAL mapping + transparent field + NEGATIVE_CORE`.
8. Sticker: `IDENTITY_CORE + TIER_MASCOT + COMP_STICKER + one status gesture + NEGATIVE_CORE`.
9. Social: `IDENTITY_CORE + TIER_EDITORIAL + STYLE_EDITORIAL_WAYANG + COMP_SOCIAL + release theme + NEGATIVE_CORE`.
10. Diagram: `TIER_EDITORIAL + COMP_DIAGRAM + technical system relation + NEGATIVE_CORE`.
11. Motif: `STYLE_EDITORIAL_WAYANG + four modular MOTIF_* symbols and Buntut connectors + NEGATIVE_CORE`.

## Repair prompts

- Face/profile: “Redraw to the approved single-eye presentation profile; retain lifted head and muzzle silhouette.”
- Hands: “Reconstruct the hand with plausible joints and readable fingers; preserve the intended gesture only.”
- Tail: “Use one continuous tail attached anatomically; shape it as the specified TAL gesture.”
- Costume: “Replace invented ornament with the approved supit urang, ulur-ulur, and model-sheet costume rhythm.”
- Silhouette: “Remove interior noise; preserve the canonical contour at 32 px and in one color.”
- Background: “Reduce to one kelir field and one supporting motif; restore at least one-third negative space.”

## Reference-image instructions

Attach only Gate 1-approved material whose record explicitly permits AI input. Label the model sheet as
identity authority and other images by the single claim they support. Never ask for imitation of a
living artist, upload restricted scans, or combine traditions. When rights are uncertain, describe the
documented feature in text and omit the image.

## Prompt record

Record the seed/job ID when the service exposes one; absence must be stated, not fabricated.

```yaml
model: "provider/model"
version: "version or unknown"
date: YYYY-MM-DD
seed_or_job_id: "when available"
image_references: ["REF-ID + permission"]
prompt_blocks: [IDENTITY_CORE, TIER_EDITORIAL]
negative_block: NEGATIVE_CORE
selected_output: "output identifier"
manual_changes: "redraw/crop/color corrections"
reviewer: "name/role/date"
```
