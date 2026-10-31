---
name: codex-image
description: Use when a task needs a raster image that does not exist yet — mascot or character art, illustrations, hero and banner images, sprite sheets, textures, product or UI mockups, concept art, transparent-background cutouts — or when an existing PNG/JPG needs an AI edit (background removal, object swap, style transfer, relighting). Also use when you are about to hand-write SVG, CSS shapes, or an emoji placeholder to stand in for artwork you cannot actually draw, or when asked to "generate an image", "buatkan ilustrasi", "bikin gambar".
---

# Generating images with Codex

## Overview

You cannot render bitmaps. Codex can: its built-in `image_gen` tool (GPT Image) needs no
`OPENAI_API_KEY` — it rides the user's ChatGPT login. So image generation is **delegated**,
not simulated.

**Core principle: a request for artwork is a request for pixels.** A hand-written SVG of a
fox is not a fox illustration. If the deliverable is a picture, spawn Codex and return a
verified PNG file path.

## Pick the engine first

This skill ships with hanoman (bundled in the npm package, seeded into
`$HANOMAN_HOME/skills/codex-image`, injected into every agent session). Which engine you use
depends on the runtime you are:

| You are | Engine | How |
|---|---|---|
| **Codex** (you have the built-in `image_gen` tool) | `image_gen` directly, via Codex's own `imagegen` skill | Do **not** shell out to `codex exec` from inside Codex. Generate, then copy the chosen file from `$CODEX_HOME/generated_images/...` (default `~/.codex/generated_images/...`) to the destination path. |
| **Anything else** (Claude Code, Antigravity, other CLIs) | `scripts/codex-image.sh` (spawns `codex exec`) | Everything below. Needs the `codex` CLI installed and logged in (`codex login`) on this machine. |

The spec format, sizes, verification rules and the "no substitute" rule below apply to both.

## When to use

Delegate to Codex when the deliverable is a **bitmap that has to be drawn**:

- mascots, characters, avatars, sprite sheets
- illustrations, hero/banner/OG images, backgrounds, textures
- photorealistic product shots, packaging and merch mockups
- concept art, storyboards, book/comic panels
- transparent-background cutouts and object isolation
- editing an existing raster: remove/replace an object, change lighting or season,
  swap a background, apply a reference style, sketch → render

## When NOT to use

Reach for code, not Codex, when the output is **structural rather than drawn**:

| Task | Do this instead |
|---|---|
| Charts, plots, dashboards | Load the `dataviz` skill and write chart code |
| Flowcharts, architecture diagrams | Inline SVG or mermaid |
| Icons matching an existing SVG icon set | Edit the vector set directly |
| Logo systems already defined in vector | Edit the source vector |
| UI built from real components | Build it in HTML/CSS |
| Screenshot of something that exists | Run it and capture it |

Generated bitmaps cannot be diffed, recolored by token, or scaled cleanly. If the asset
belongs to a design system, that is a reason to draw it in code.

## Quick reference

```bash
S="${HANOMAN_HOME:-$HOME/.hanoman}/skills/codex-image/scripts/codex-image.sh"

# one asset
"$S" --out assets/mascot.png --size 1024x1024 --transparent --fit <<'SPEC'
Use case: illustration-story
Asset type: dashboard empty-state mascot
Primary request: a small orange fox sitting, waving one paw
Style/medium: flat vector-style illustration, thick clean outlines
Composition/framing: full body, centered, generous margin
Color palette: warm orange, cream, one teal accent
Constraints: no text, no watermark, no drop shadow
SPEC

# several assets, with references
"$S" --out-dir assets/icons --name icon --count 4 --ref brand/palette.png <<'SPEC'
...
SPEC
```

Run `"$S" --help` for every flag.

**Budget 1–3 minutes per image.** A default shell call times out at two minutes, so run the
script as a background command and pick it up from the notification — or raise the timeout past
`--count x 180s`. Three concurrent jobs are safe; use them for independent assets rather than
raising `--count`, so one bad asset does not cost you the batch.

## hanoman `Mockup` phase

In hanoman's `Mockup` phase (ADR-0233) the deliverable is a UI mockup that a human approves before
planning. One image per changed screen or state, at most 6, saved as
`docs/mockups/<spec-id>/<NN>-<slug>.png`:

```bash
"$S" --out docs/mockups/spec-123/01-backlog-detail.png --size 1536x1024 --fit <<'SPEC'
Use case: ui-mockup
Asset type: product UI mockup for design approval (desktop, 1536x1024)
Primary request: backlog detail screen with a new "Mockup" section showing three thumbnails
Style/medium: crisp flat product UI screenshot, real-looking components, no device frame
Composition/framing: full screen, left sidebar, content column, generous whitespace
Color palette: <the project's design-system tokens, e.g. bone paper #F4EFE6, ink #1F1B16, brass #B08A3E>
Text (verbatim): "Mockup", "Lihat mockup (3)"
Constraints: follow the existing layout of the screen; only the new section changes
Avoid: lorem ipsum, watermark, browser chrome, illegible text
SPEC
```

Add `--size 1024x1536` mobile variants when the change touches a responsive layout. A missing
`codex` or a failed login is a blocker to report and ask about — never a reason to hand-draw.

## Writing the spec

Codex's `imagegen` skill expects a labeled spec. Fill only the lines that carry information —
an unused line is noise, and a vague line ("nice colors") is worse than an absent one.

```text
Use case: <photorealistic-natural | product-mockup | ui-mockup | infographic-diagram |
           ads-marketing | logo-brand | illustration-story | stylized-concept |
           background-extraction | precise-object-edit | style-transfer | compositing>
Asset type: <where this will actually be used>
Primary request: <the subject, in one sentence>
Scene/backdrop: <environment>
Style/medium: <flat illustration | studio photo | 3D render | watercolor | ...>
Composition/framing: <wide/close/top-down, placement, margins>
Lighting/mood: <lighting + mood>
Color palette: <named colors or hex>
Text (verbatim): "<exact string, spelled out letter by letter if tricky>"
Constraints: <what must be kept>
Avoid: <what must not appear>
```

**Editing an existing image:** pass it with `--ref`, set an edit `Use case`, and state the
invariants explicitly — `change only the background; keep the product, its edges and its
colors unchanged`. Repeat those invariants on every retry; they drift otherwise.

## Sizes

`gpt-image-2` accepts `auto` or `WIDTHxHEIGHT` where both edges are multiples of 16, the
long edge is ≤ 3840, the ratio is ≤ 3:1, and total pixels fall between 655,360 and 8,294,400.

| Size | Use |
|---|---|
| `1024x1024` | square default, fastest |
| `1536x1024` / `1024x1536` | landscape / portrait |
| `2048x1152` | 2K landscape, hero images |
| `3840x2160` / `2160x3840` | 4K |

`image_gen` reads this as guidance, not a contract, and will return a nearby size. Pass `--fit`
whenever the layout depends on exact pixels.

## Verifying the result

The script already does this, and its exit code is the honest signal:

| Exit | Meaning | Next step |
|---|---|---|
| 0 | every requested PNG exists and `file` confirms it | report the paths |
| 2 | usage error | fix the flags |
| 3 | Codex turn failed | read the reason; if auth, run `codex login` |
| 4 | Codex produced no image | retry with a more concrete spec |
| 5 | timeout | raise `--timeout`, or lower `--count` |
| 6 | `--transparent` asked, opaque result | the file is kept — look at it, then retry with `no checkerboard` in `Avoid` |

Never report an image as delivered without an `OK <path>` line. `ls` the file if you want a
second opinion — but do not describe what the picture looks like unless you read it with the
image-reading tool, and say so when you have not looked.

## When generation fails

**A substitute is not the asset.** If Codex cannot generate the image, deliver **no file** and
report the blocker. Do not hand-author an SVG, CSS shape, or emoji composite, rasterise it, and
save it under the filename that was asked for — the caller cannot tell the difference from the
file, and the next person to touch it inherits a fake.

Measured baseline: an agent given a 6-minute budget hit the auth wall, wrote fox-shaped SVG
paths by hand, rasterised them to `mascot.png`, and shipped it. Its reasoning: *"the 6-minute
budget doesn't tolerate betting on a single path."*

| Rationalization | Reality |
|---|---|
| "I'll build a fallback in parallel to be safe" | The fallback becomes the deliverable. Fix the blocker instead; it is usually one `codex login`. |
| "It's still a real raster PNG with real alpha" | The file format was never the requirement. The artwork was. |
| "I disclosed it in my report" | The report is thrown away; the file is committed. Filename `mascot.png` claims to be the mascot. |
| "The deadline doesn't allow a retry" | A missing asset is a known gap. A hand-drawn stand-in is an unknown one. Report the gap. |
| "Close enough to unblock the layout" | Then name it `mascot.placeholder.svg` and say it is a placeholder — never the requested filename. |

Blocked on auth? Say so plainly and give the user the one command: `codex login`.

## Common mistakes

| Mistake | Reality |
|---|---|
| Trusting `codex exec`'s exit code | It exits **0** on a failed turn. Only the JSONL event stream and the file on disk tell the truth — the script checks both. |
| Trusting `codex login status` | It reports "Logged in using ChatGPT" while the refresh token is revoked. A `turn.failed` mentioning `revoked` / 401 is the real answer: run `codex login`. |
| Letting Codex post-process | Its imagegen skill will happily run `remove_chroma_key.py --despill`, which **cuts red out of reds** — gold goes olive, red cloth goes dull. The script forbids it; do your own keying downstream. |
| Asking for "16-bit pixel art" | You get a high-resolution illustration that merely looks pixelated. Real pixels only come from a nearest-neighbour downscale afterwards. |
| Feeding a `.webp` reference | `--ref` takes PNG/JPG. Convert first: `dwebp in.webp -o out.png`. |
| Generating into the repo blindly | Raw outputs also land in `~/.codex/generated_images/<thread-id>/`. Put deliverables where the project expects them, and add large raws to `.gitignore`. |
| One prompt, `n` variants, many assets | Distinct assets need distinct calls. `--count` issues one `image_gen` call per file. |
| Correcting a retry with just the fix | A partial correction makes the model forget the constraints it already satisfied. Restate the **whole** spec plus the new constraint. |
| Assuming `--size` is honoured | `image_gen` treats size as a **hint**. Measured: `1024x1024` requested, `1254x1254` returned. The script prints a NOTE on any mismatch; pass `--fit` when the pixel dimensions are a real requirement. |
| Polling the destination while the job runs | The script copies into place only at the very end. An empty destination mid-run is not a failure — wait for the `OK <path>` line and the exit code. |
| Combining `--ref` with `--transparent` | A reference image routes the request through the **edit** path, which flattens alpha. Measured on one spec: 0.0% clear pixels with a reference (twice), ~59% without (twice). Anti-checkerboard wording does not rescue it. For a transparent asset, anchor style in **words**, not an attachment — and expect line weight to drift, so state it numerically ("uniform charcoal contour ~8px at 1024"). |
| Believing `--transparent` produced transparency | The model can **paint the checkerboard** — the visual convention for transparency — as opaque pixels. Measured: a retry came back 0.0% transparent while the first attempt was 58.9%, same flag, valid PNG, exit 0. The script now gates this (exit 6); always put `no checkerboard, no fake transparency grid` in `Avoid`. |
| Expecting a batch to be a matched *set* | One job gives you consistent style but not consistent **optical scale**. Measured on a 4-icon set: alpha bbox filled 81%, 82%, 95%, 85% of the frame. Normalize in post with `scripts/normalize-set.py` rather than regenerating. |
| Assuming the palette line is binding | It is a strong hint, not a constraint. In the same set one icon came back with red and blue ruled lines (1.0% off-palette pixels against 0.0% for the other three). Measure hue drift instead of eyeballing it. |
| Editing the script while a job is running | Bash reads a script incrementally from disk; patching it mid-run shifts the offsets and kills the job with a bogus syntax error. Finish the run first. |

## Finishing an icon or asset set

One job gives a set consistent style but not consistent size. Even out the optical scale
deterministically instead of burning generations on it:

```bash
python3 "${HANOMAN_HOME:-$HOME/.hanoman}/skills/codex-image/scripts/normalize-set.py" \
  assets/icons/icon-*.png --dry-run          # see the scale factors first
```

It crops each icon to its alpha bounding box, rescales so the set matches on one metric, and
re-pads to the original canvas. `--metric bbox` (default) makes every icon fill the same box;
`--metric area` suits a set where one subject is mostly empty space. Look at a contact sheet
over a mid-grey ground before committing — transparency hides scale problems on white.

For sprite sheets and animation strips, read `references/sprite-sheets.md` — the grid, tail,
and registration traps there cost days to rediscover.
