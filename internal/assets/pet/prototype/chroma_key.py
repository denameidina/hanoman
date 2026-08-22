"""Chroma key yang mempertahankan warna interior.

Key disampel dari tepi kanvas (median piksel border). Jarak tiap piksel ke key di ruang RGB
dipetakan ke alpha dengan ramp [lo, hi]: <= lo transparan, >= hi opak. Hanya di pita parsial
warna di-"unmix" (kurangi kontribusi key sebesar 1-alpha) — interior TIDAK disentuh sama sekali,
jadi emas/merah tak bergeser seperti despill global.

pemakaian: chroma_key.py <in.png> <out.png> [lo=40] [hi=110]
"""
from __future__ import annotations

import sys

import numpy as np
from PIL import Image


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    lo = float(sys.argv[3]) if len(sys.argv) > 3 else 40.0
    hi = float(sys.argv[4]) if len(sys.argv) > 4 else 110.0
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    h, w, _ = im.shape
    border = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]])
    key = np.median(border, axis=0)
    d = np.sqrt(((im - key) ** 2).sum(axis=2))
    alpha = np.clip((d - lo) / (hi - lo), 0.0, 1.0)
    rgb = im.copy()
    band = (alpha > 0) & (alpha < 1)
    a3 = alpha[..., None]
    # unmix: observed = a*fg + (1-a)*key  →  fg = (observed - (1-a)*key) / a
    unmixed = np.clip((im - (1 - a3) * key) / np.maximum(a3, 1e-3), 0, 255)
    rgb[band] = unmixed[band]
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(dst)
    print(f"key={tuple(int(v) for v in key)} transparan={(alpha == 0).sum()} parsial={band.sum()} opak={(alpha == 1).sum()}")


if __name__ == "__main__":
    main()
