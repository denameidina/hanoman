#!/usr/bin/env python3
"""raw/<key>.keyed.png → rows/<key>.png (strip 8×192×208 terregistrasi) + rows/<key>.report.json.
Mode (stand/walk/jump) dan pin mengikuti petlib.ROWS; `--no-pin` memaksa tanpa pin."""
from __future__ import annotations

import json
import sys

from PIL import Image

from common import ASSETS, fail, load_petlib

petlib = load_petlib()


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        fail("pemakaian: register.py <key> [--no-pin]")
    key = args[0]
    row = petlib.row_def(key)
    src = ASSETS / "raw" / f"{key}.keyed.png"
    if not src.exists():
        fail(f"{src} tak ada — jalankan key.py {key} dulu")
    sheet = Image.open(src).convert("RGBA")
    sprites = petlib.detect_sprites(sheet)
    if len(sprites) != 8:
        fail(f"{key}: terdeteksi {len(sprites)} sprite, butuh 8 — generasi rusak, ulangi gen.py {key} --retry")
    pin = None if "--no-pin" not in sys.argv else False
    strip, report = petlib.build_strip(sprites, row["mode"], pin=pin)
    (ASSETS / "rows").mkdir(exist_ok=True)
    strip.save(ASSETS / "rows" / f"{key}.png")
    out = {"key": key, "mode": row["mode"], "pinned": pin if pin is not None else row["mode"] == "stand",
           "edge": [petlib.touches_edge(s, sheet.size) for s in sprites], "frames": report}
    petlib.write_json(ASSETS / "rows" / f"{key}.report.json", out)
    for r in report:
        print(f"  f{r['frame']}: dx={r['dx']:+d} dy={r['dy']:+d} skala={r['scale']:.2f} "
              f"residu={r['residual_pre']:.3f}" + (f"→{r['residual_post']:.3f}" if "residual_post" in r else "")
              + (f" TUMPAH={r['clipped']}" if r["clipped"] else ""))
    print(f"ditulis rows/{key}.png + rows/{key}.report.json")


if __name__ == "__main__":
    main()
