#!/usr/bin/env python3
"""raw/<key>.png (latar hijau polos dari Codex) → raw/<key>.keyed.png (RGBA)."""
from __future__ import annotations

import sys

from PIL import Image

from common import ASSETS, fail, load_petlib

petlib = load_petlib()


def main() -> None:
    if len(sys.argv) != 2:
        fail("pemakaian: key.py <key>")
    key = sys.argv[1]
    src = ASSETS / "raw" / f"{key}.png"
    if not src.exists():
        fail(f"{src} tak ada — jalankan gen.py {key} dulu")
    keyed = petlib.chroma_key(Image.open(src))
    dst = ASSETS / "raw" / f"{key}.keyed.png"
    keyed.save(dst)
    alpha = keyed.getchannel("A")
    hist = alpha.histogram()
    print(f"{dst.name}: transparan={hist[0]} opak={hist[255]} parsial={sum(hist[1:255])}")


if __name__ == "__main__":
    main()
