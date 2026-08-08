# Hanoman illustration assets

This directory delivers one flattened WebP master for each of the 41 IDs in the authoritative
[asset catalog](../../brand/illustration/04-asset-catalog.md). The art direction, character rules,
family briefs, prompts, and review criteria remain authoritative in
[`internal/brand/illustration`](../../brand/illustration/README.md).

## Scope

- 41 catalog masters, one file per `inventory.json` record.
- Stable naming: `hnm-ill-{family}-{subject}-{ratio}-master-v01.webp`.
- Built-in image-generation path with model-first visual references; no restricted source image was
  supplied to the model.
- Transparent WebP for mascot poses and stickers; warm bone/kelir fields for the other families.
- Text, logos, screenshots, labels, dates, metrics, and UI remain outside the artwork.

This delivery intentionally does not include editable sources, SVG/PDF interchange, animation
layers, or all responsive crops. These are AI-produced flattened rasters and do not manufacture the
human cultural-review, rights-review, canonical redraw, or Gate 5 approvals required for a full
commissioned production package.

## Verification

Run:

```bash
node internal/assets/illustration/verify.mjs
```

The validator checks the complete 41-ID inventory, unique filenames, RIFF/WebP signatures, positive
dimensions, intended orientation, required alpha capability, and absence of PNG/JPEG deliveries.
Visual review evidence and family contact sheets live in `qa-report.md` and `qa/`.
