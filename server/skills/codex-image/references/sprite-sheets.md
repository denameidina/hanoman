# Sprite sheets and animation strips

Generating an animated character is not "generate 8 images". It is one sheet, then a
cutting-and-registration pipeline you own. These traps were each paid for once.

## Generating the sheet

Ask for **one sheet** (e.g. `1536x1024`, one row of 8 frames) rather than 8 separate images —
separate calls give you 8 different characters. Then:

- **Ask for the raw sheet only.** Codex's imagegen skill will otherwise run
  `remove_chroma_key.py --soft-matte --despill` on its own. Despill against magenta **subtracts
  red from red pixels**: gold turns olive, red cloth turns dull. Do the keying yourself.
- **Key on green `#00FF00`, not magenta**, for the same reason.
- Keep the standing character well under the cell height (a 192px character in a 192px cell
  spills its tail into the neighbour; ~168px inside 192px is safe) and clip per cell. Treat
  spill as a gate failure, not a rounding error.
- Floating ornaments (stars, sparkles) must **touch the character silhouette**. A detached blob
  smaller than ~40×80px and ≥8 columns away gets dropped silently by blob detection.
- "16-bit pixel art" in the prompt yields a high-resolution illustration that looks pixelated.
  Real pixels come from `resize(NEAREST)` to the logical size afterwards.

## Cutting

**The model does not obey your grid.** Bounding boxes drift up to ~97px along a row and sprites
cross cell borders. Detect sprites from transparent gutters, never by slicing at fixed offsets.

## Registration

Anchoring on the feet alone jitters ±15px, because the tail tip enters the foot bounding box.

- **Find feet by mass, not by side.** In the bottom band, a grazing tail is a thin line
  (~80–100px of mass) next to real feet (~300–600px). A "rightmost run" rule is exactly wrong
  for a walk-left row drawn with the tail on the right, and mid-stride feet are two runs.
- Register with an XOR-mask over the static region (rows ≥45%, columns ≥ feet−12) plus a ±8%
  scale search. That gets residual to 0.01–0.07; the remainder is shape difference.
- **Pinning the static region freezes a rectangle** and will amputate a hand that moves through
  it. Plain erosion cuts the arm while the palm survives — the hand reads as severed. Use
  morphological reconstruction: grow the eroded seed inside the difference map until stable.
- Do not normalise the frame-1 bbox to a fixed height — anything that lengthens the bbox (a
  dangling tail) silently shrinks the character. Gate on `body_ratio` (eroded bbox height ÷ full
  bbox height); healthy rows sit at 0.84–0.91. For curled poses gate on body **mass** instead.

## Reviewing

- Onion-skin (mean alpha across frames, pixel ratio 0.2–0.8) is the cheapest jitter measure.
- A QA GIF with a **per-frame adaptive palette** shifts colours every frame and reads as a
  flicker that is not in the strip. Use one global palette.
- The **8→1 loop seam is invisible** in both contact sheets and onion-skins. Gate it as a
  ratio of largest to smallest inter-frame step (threshold ~3.5), not an absolute value, and
  guard it with "visible motion ≥ 0.10" — otherwise a barely-moving row passes vacuously.
- Calibrate residual gates across all rows, not on the idle row. A gate tuned to idle punishes
  correct animation.

## Retrying

Restate the **entire** constraint set on every retry, including the constraints already
satisfied. A partial correction makes the model forget what it had got right.

Cost of record: 1–3 attempts per row; ~1–3 minutes per sheet; 3 concurrent jobs are safe.
