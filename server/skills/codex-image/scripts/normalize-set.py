#!/usr/bin/env python3
"""Normalize a set of transparent PNG icons to one optical scale.

One generation job gives consistent style but not consistent size: subjects come back
filling anywhere from 80% to 95% of the frame, so the set looks ragged in a row.

Scaling by bounding box is wrong for mixed shapes — a pocket watch on a chain is tall,
so bbox-matching shrinks its face next to a wide open book. This matches *ink area*
(sqrt of opaque pixel count), which is what the eye actually reads as "the same size",
then clamps anything that would overflow the frame.

Three metrics, because no single one is right for mixed shapes:

  bbox    match the longest edge, so every icon fills the same box (default). This is
          what icon systems usually specify, and it won a side-by-side on a measured
          4-icon set: area and hybrid both shrank a dense solid object (a monitor, to
          73% and 79% of frame) until it read as weaker than its neighbours.
  area    match sqrt(opaque pixel count). Reach for it when one icon is mostly empty
          space — a long thin antenna or tail — and bbox would shrink the real subject.
  hybrid  geometric mean of the two.

Always check with --dry-run and a contact sheet before committing; the right metric is a
property of the particular set, not a rule.

  normalize-set.py icon-*.png [--metric hybrid] [--margin 0.08] [--out-dir DIR] [--dry-run]
"""
import argparse, sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("normalize-set: needs Pillow — pip install pillow")

ALPHA_FLOOR = 8  # ignore near-transparent halo pixels


def measure(path):
    im = Image.open(path).convert("RGBA")
    mask = im.getchannel("A").point(lambda v: 255 if v > ALPHA_FLOOR else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError(f"{path.name} is fully transparent")
    area = mask.crop(bbox).histogram()[255]
    return im, bbox, area


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--metric", choices=("bbox", "area", "hybrid"), default="bbox",
                    help="what to equalize across the set (default: bbox)")
    ap.add_argument("--margin", type=float, default=0.08,
                    help="fraction of the canvas kept clear on the long edge (default 0.08)")
    ap.add_argument("--out-dir", type=Path, default=None,
                    help="write here instead of overwriting the inputs")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    items = []
    for f in a.files:
        im, bbox, area = measure(f)
        items.append({"path": f, "im": im, "bbox": bbox, "area": area})

    canvas = items[0]["im"].size
    for it in items:
        if it["im"].size != canvas:
            sys.exit(f"normalize-set: {it['path'].name} is {it['im'].size}, expected {canvas} "
                     "— resize the set to one canvas first")

    limit = min(canvas) * (1 - a.margin)
    target_area = sum(it["area"] for it in items) / len(items)
    target_edge = sum(max(it["bbox"][2] - it["bbox"][0],
                          it["bbox"][3] - it["bbox"][1]) for it in items) / len(items)

    print(f"{'file':<22}{'fill before':>12}{'scale':>8}{'fill after':>12}")
    for it in items:
        w, h = it["bbox"][2] - it["bbox"][0], it["bbox"][3] - it["bbox"][1]
        before = max(w, h) / max(canvas)
        s_area = (target_area / it["area"]) ** 0.5
        s_bbox = target_edge / max(w, h)
        scale = {"area": s_area, "bbox": s_bbox,
                 "hybrid": (s_area * s_bbox) ** 0.5}[a.metric]
        if max(w, h) * scale > limit:          # clamp: never overflow the frame
            scale = limit / max(w, h)
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))

        out = Image.new("RGBA", canvas, (0, 0, 0, 0))
        out.alpha_composite(it["im"].crop(it["bbox"]).resize((nw, nh), Image.LANCZOS),
                            ((canvas[0] - nw) // 2, (canvas[1] - nh) // 2))

        dst = it["path"] if a.out_dir is None else a.out_dir / it["path"].name
        if not a.dry_run:
            if a.out_dir:
                a.out_dir.mkdir(parents=True, exist_ok=True)
            out.save(dst)
        print(f"{it['path'].name:<22}{before:>11.1%}{scale:>8.3f}{max(nw, nh)/max(canvas):>11.1%}")

    if a.dry_run:
        print("\n(dry run — nothing written)")


if __name__ == "__main__":
    main()
