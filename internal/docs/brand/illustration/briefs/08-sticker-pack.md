# Sticker pack

## Asset ID
`STK-001`–`STK-008` · text-free localized-ready stickers.

## Objective
Express common engineering-team moments with dignified, immediately readable mascot gestures.

## Product truth
Stickers are social reactions, not official workflow status, approval, or evidence.

## Character tier
Mascot · `MSC-001`; derive from approved pose vocabulary and simplify only after small-size testing.

## Locked anchors
Keep the mascot construction, profile, supit urang, ulur-ulur, one tail, dignified emotion, and shared outer-contour weight.

## Composition
Centered 1:1 subject, transparent background, bold outer contour, 12% platform-safe margin, no baked words.

| ID | Meaning | Gesture · expression · tail | Optional separate copy |
|---|---|---|---|
| `STK-001` | Ready | GST-01 · EXP-02 · TAL-01 | Siap / Ready |
| `STK-002` | Working | GST-06 · EXP-03 · TAL-02 | Dikerjakan / Working |
| `STK-003` | Waiting | GST-05 · EXP-01 · TAL-01 | Menunggu / Waiting |
| `STK-004` | Blocked | GST-08 · EXP-05 · TAL-03 | Terhambat / Blocked |
| `STK-005` | Shipped | GST-11 · EXP-07 · TAL-04 | Terkirim / Shipped |
| `STK-006` | Review | GST-04 · EXP-03 · TAL-02 | Tinjau / Review |
| `STK-007` | Thanks | GST-02 · EXP-08 · TAL-01 | Terima kasih / Thanks |
| `STK-008` | Docs updated | GST-12 · EXP-08 · TAL-04 | Docs diperbarui / Docs updated |

## Layer map
`outline / character-base / character-gesture / tail / prop / fx / optional-copy-id / optional-copy-en`; localized copy stays separate and off by default.

## Responsive outputs
SVG, transparent PNG 96/128/256/512 px, WebP where required, plus mandatory one-color silhouette and 96 px preview.

## Alt-text intent
Use the row meaning as the accessible name; avoid repeating adjacent reaction text.

## Human handoff
Start from MPS parts, redraw gesture for sticker energy, then inspect the eight-up grid. AI exploration is optional; final contour and text separation are human-made.

## Do
Prefer the text-free master, retain transparent margin, and distinguish blocked from angry or catastrophic.

## Don't
Don't bake localized words, use status colors as the only meaning, mirror the profile, or treat sticker reactions as product approval.

## Acceptance
Gates 2–4 require mascot consistency, distinct meanings, one-color and 96 px readability, and bilingual layer checks; Gate 5 delivers eight transparent masters with manifests.

## WhatsApp derivatives

Static delivery derivatives live in `internal/assets/illustration/whatsapp/`: one text-free pack and
one Indonesian-copy pack, each with eight transparent 512 px WebP stickers. Reproduce them from the
approved masters with `python3 internal/scripts/export-whatsapp-stickers.py --font <IBMPlexSans-Bold.ttf>`;
the script preserves the masters, enforces the 100 KB sticker limit, and emits 96 px QA previews.
