# Hanoman WhatsApp Sticker Pack Design

## Objective

Produce two WhatsApp-ready derivatives from the eight approved Hanoman sticker masters without
redrawing or changing the mascot:

1. `text-free` — the official text-free reactions.
2. `id-text` — the same reactions with concise Indonesian labels.

## Source and invariants

- Source: `internal/assets/illustration/hnm-ill-sticker-*-1x1-master-v01.webp`.
- Preserve the approved character, profile, costume, gesture, prop, colors, and one-tail silhouette.
- Do not mirror, regenerate, inpaint, recolor, or overwrite a master.
- Keep every output centered on a transparent 1:1 canvas with a readable white sticker contour.

## Pack contents

| Slug | Meaning | Indonesian label |
|---|---|---|
| `ready` | Ready | `Siap` |
| `working` | Working | `Dikerjakan` |
| `waiting` | Waiting | `Menunggu` |
| `blocked` | Blocked | `Terhambat` |
| `shipped` | Shipped | `Terkirim` |
| `review` | Review | `Tinjau` |
| `thanks` | Thanks | `Terima kasih` |
| `docs-updated` | Docs updated | `Docs diperbarui` |

The copy follows the optional Indonesian copy in the sticker brief and carries no punctuation so the
pack remains calm and reusable.

## Visual treatment

- Canvas: 512×512 px, transparent RGBA.
- Character contour: warm white (`bone-000`, `#fffdf8`), sized for legibility on light and dark chat.
- Text: IBM Plex Sans Bold, centered at the bottom, `ink-900` (`#17130c`) with a warm-white stroke.
- The text-free pack uses the full safe field. The text pack scales the mascot only as much as needed
  to reserve a distinct label band.
- No status-color coding, speech bubble, background tile, watermark, or added prop.

## Delivery

- Static WebP sticker files, exactly 512×512 px and below 100 KB each.
- Shared 96×96 px PNG tray icon below 50 KB.
- Contact sheet for each variant, a JSON manifest, checksums, and a ZIP archive containing both packs.
- Files live under `internal/assets/illustration/whatsapp/`; masters remain untouched.

## Verification

- Assert the expected 16 stickers exist.
- Decode every output; verify dimensions, alpha channel, transparent corners, and non-empty subject.
- Verify every sticker is below 100 KB and the tray icon below 50 KB.
- Visually inspect both contact sheets for clipping, text spelling, contour artifacts, and consistency.

