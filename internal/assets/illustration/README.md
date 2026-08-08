# Hanoman illustration assets

This directory delivers one flattened WebP master for each of the 41 IDs in the authoritative
[asset catalog](../../docs/brand/illustration/04-asset-catalog.md). The art direction, character rules,
family briefs, prompts, and review criteria remain authoritative in
[`internal/docs/brand/illustration`](../../docs/brand/illustration/README.md).

Delivery status: **41/41 catalog masters present and structurally verified**, with eight family
contact sheets recorded in `qa/` for visual review.

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

## Web derivatives (`web/`)

The masters are near-lossless (~1.5 MB each, 38.8 MB total) and **must not be bundled**. The
frontend registry globs `web/` instead — compressed derivatives capped at 768px on the long edge,
q78, metadata stripped, alpha preserved. Measured once: bundling the masters inflated the published
`hanoman` npm package from 5.5 MB to 46.1 MB; the derivatives (1.5 MB total) bring it back to 7.1 MB.

```bash
node internal/assets/illustration/build-web.mjs            # rebuild changed derivatives
node internal/assets/illustration/build-web.mjs --check    # report missing/stale, write nothing
```

Derivatives are **committed**, not generated at build time: the GitHub Actions runner that runs
`pnpm release` has no `cwebp`. Rerun the script whenever a master changes and commit both together.
Freshness is tracked by master hash in `web/manifest.json`, not mtime — git does not preserve mtimes,
so a fresh checkout would otherwise always read as stale.

## Verification

Run:

```bash
node internal/assets/illustration/verify.mjs
```

The validator checks the complete 41-ID inventory, unique filenames, RIFF/WebP signatures, positive
dimensions, intended orientation, required alpha capability, and absence of PNG/JPEG deliveries — and
for every master, that its web derivative exists, stays within 768px, keeps its alpha, and is
actually smaller. Visual review evidence and family contact sheets live in `qa-report.md` and `qa/`.
