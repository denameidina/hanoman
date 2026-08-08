# Delivery and QA / Pengiriman dan QA

## Package and naming

```text
{ID}/
  source/
  interchange/
  export/{ratio}/
  proof/
  manifest.md
```

Name files `hnm-ill-{family}-{subject}-{ratio}-{variant}-vNN`; example:
`hnm-ill-hero-workflow-16x9-light-v03.svg`. Use lowercase ASCII and stable subject names.

## Formats and color

| Kind | Format | Requirement |
|---|---|---|
| Editable source | Figma/AI/Affinity/PSD/SVG | Named layers, linked assets packaged |
| Interchange | SVG | Clean paths, no baked copy/logo, inspectable |
| Raster | PNG/WebP | sRGB, transparent when required, 1× and 2× |
| Review/archive | PDF | Vector where possible, reference/approval notes |

Narrative raster masters have a minimum 3200 px long side. Do not upscale a smaller generated image
and call it a master. Preserve profiles and licenses; exports use sRGB.

## Layers

Required: `bg`, `environment`, `character-base`, `character-gesture`, `buntut-fx`, `foreground`,
`text-safe`. Optional motion-ready splits: `head`, `eye`, `hand`, `tail-segments`, `particles`,
`shadow`. Static artwork remains authoritative; splits must not deform the approved silhouette.

## Responsive crop matrix

| Ratio | Primary use | Must retain | Safe area |
|---|---|---|---|
| 16:9 | Hero/video card | eye, focal hand/prop, Buntut path | copy-side third |
| 4:5 | Social portrait | full gesture and primary motif | top/bottom copy bands |
| 1:1 | Spot/social | head, gesture, motif relation | 10% perimeter |
| 9:16 | Story/mobile | action axis, readable tail | UI-safe top/bottom |
| 4:3 | Product/editorial | state cue and calm field | central UI-safe region |

Create art-directed crops; do not accept blind center crops.

## Visual and technical tests

- Light field; dark field where specified; one-color silhouette; reduced-detail; thumbnail at target minimum; 200% zoom.
- Verify no clipping, stray paths, raster seams, embedded text/logo, watermark, fake UI, or unlicensed asset.
- Compare character against model overlay; inspect one eye, hands, costume, one tail, and tier detail.
- Confirm filenames, ratios, dimensions, color profile, transparency, layer names, and version alignment.

## Accessibility

Write contextual alt text that communicates purpose, not costume inventory. Decorative placements use
empty alt. Check adjacent text contrast and that the art does not carry unique instructions. If layers
are later animated, offer reduced motion and keep the static frame equivalent.

## Provenance and rights

Record cultural reference IDs and supported claims, source-image creator/institution/license,
permission for AI input, AI model/version/date/job where applicable, prompt record, manual changes,
human reviewers, output license, and attribution obligations. Unknown rights fail delivery.

## `manifest.md` template

```markdown
# {ID} delivery manifest
- Title / version / date / owner:
- Source and interchange files:
- Export matrix (ratio, dimensions, format, checksum):
- Layer check:
- Alt text / decorative decision:
- Reference IDs and rights:
- AI disclosure and prompt-record link:
- Manual changes:
- QA evidence:
- Gate 0–5 approvals:
- Known limitations:
```

## Gate 5 checklist

- [ ] Approved artwork matches the versioned source and all required ratios.
- [ ] Source is editable; required layers, 1×/2× exports, sRGB, and 3200 px rule pass.
- [ ] Thumbnail, crop, field, silhouette, zoom, accessibility, and cultural checks pass.
- [ ] Rights, AI disclosure, prompt record, alt text, manifest, and owners are complete.
- [ ] Delivery reviewer records date and evidence; old versions remain traceable.

Reject delivery when only a flattened JPEG exists, crops sever the gesture, layers are unnamed,
text/logo is baked, output contains fake UI or watermark, the model sheet is violated, or provenance,
rights, disclosure, alt text, or approval evidence is missing.
