"""v2 — pisahkan lembar sprite AI menjadi strip 8 frame yang TEREGISTRASI.

Beda dari v1: frame 2..8 tidak dijangkar ke kaki saja, tetapi dicari offset piksel (dx, dy)
yang meminimalkan selisih mask alpha terhadap frame 1 di WILAYAH STATIS — 55% bawah tinggi
frame 1 (kaki, kain, torso bawah). Kepala/dada/buntut yang memang bergerak dikeluarkan dari
penilaian sehingga tak "menarik" registrasi. Residu per frame dilaporkan: itulah ukuran jitter
yang tersisa setelah registrasi, dan calon gerbang QA atlas.

pemakaian: split_strip2.py <sheet.png> <strip.png> <cell_w> <cell_h> [--pixel <logical_h>]
  --pixel N : kuantisasi ke N piksel logis (downscale NEAREST) lalu upscale NEAREST ke sel —
              untuk gaya pixel-art sungguhan.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image


def runs(mask: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start = None
    gap = 0
    for i, filled in enumerate(mask.tolist()):
        if filled:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                out.append((start, i - gap + 1))
                start = None
                gap = 0
    if start is not None:
        out.append((start, len(mask)))
    return out


def detect_sprites(im: Image.Image) -> list[Image.Image]:
    a = np.asarray(im.getchannel("A")) > 16
    sprites: list[Image.Image] = []
    for y0, y1 in runs(a.any(axis=1), min_gap=12):
        band = a[y0:y1]
        for x0, x1 in runs(band.any(axis=0), min_gap=8):
            sub = band[:, x0:x1]
            ys, xs = np.where(sub)
            if len(ys) == 0:
                continue
            bb = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)
            if (bb[2] - bb[0]) > 40 and (bb[3] - bb[1]) > 80:
                sprites.append(im.crop(bb))
    return sprites


def mask_of(sp: Image.Image) -> np.ndarray:
    return np.asarray(sp.getchannel("A")) > 64


def feet_anchor(m: np.ndarray) -> tuple[float, int]:
    h = m.shape[0]
    foot = m[int(h * 0.92):]
    xs = np.where(foot.any(axis=0))[0]
    cx = (xs.min() + xs.max()) / 2 if len(xs) else m.shape[1] / 2
    return cx, h


def register(ref: np.ndarray, cur: np.ndarray, static_from: int, search: int = 24,
             col_from: int = 0) -> tuple[int, int, float]:
    """Offset (dx, dy) untuk `cur` agar wilayah statisnya paling cocok dengan `ref`.

    Kedua mask ditempel ke kanvas bersama; skor = jumlah XOR di baris >= static_from (koordinat
    kanvas ref). Pencarian kasar langkah 4 lalu halus ±3."""
    H = max(ref.shape[0], cur.shape[0]) + 2 * search
    W = max(ref.shape[1], cur.shape[1]) + 2 * search
    R = np.zeros((H, W), bool)
    R[search:search + ref.shape[0], search:search + ref.shape[1]] = ref
    # Jangkar awal: kaki (seperti v1), supaya pencarian ±24 cukup.
    rcx, rh = feet_anchor(ref)
    ccx, ch = feet_anchor(cur)
    bx = int(round(search + rcx - ccx))
    by = search + rh - ch
    rows = slice(search + static_from, search + ref.shape[0])
    cols = slice(search + col_from, search + ref.shape[1])

    def score(dx: int, dy: int) -> float:
        C = np.zeros((H, W), bool)
        y, x = by + dy, bx + dx
        if y < 0 or x < 0 or y + cur.shape[0] > H or x + cur.shape[1] > W:
            return float("inf")
        C[y:y + cur.shape[0], x:x + cur.shape[1]] = cur
        return float(np.count_nonzero(R[rows, cols] ^ C[rows, cols]))

    best = (0, 0, score(0, 0))
    for dy in range(-search, search + 1, 4):
        for dx in range(-search, search + 1, 4):
            s = score(dx, dy)
            if s < best[2]:
                best = (dx, dy, s)
    cdx, cdy = best[0], best[1]
    for dy in range(cdy - 3, cdy + 4):
        for dx in range(cdx - 3, cdx + 4):
            s = score(dx, dy)
            if s < best[2]:
                best = (dx, dy, s)
    area = float(np.count_nonzero(R[rows, cols]))
    # offset relatif terhadap jangkar kaki; residu = rasio XOR terhadap luas wilayah statis ref.
    return best[0] + bx - search, best[1] + by - search, best[2] / max(area, 1.0)


def quantize(sp: Image.Image, logical_h: int) -> Image.Image:
    w, h = sp.size
    lw = max(1, round(w * logical_h / h))
    return sp.resize((lw, logical_h), Image.NEAREST)


def main() -> None:
    args = sys.argv[1:]
    pixel = None
    if "--pixel" in args:
        i = args.index("--pixel")
        pixel = int(args[i + 1])
        del args[i:i + 2]
    src, dst = Path(args[0]), Path(args[1])
    cell_w, cell_h = int(args[2]), int(args[3])
    im = Image.open(src).convert("RGBA")
    sprites = detect_sprites(im)
    print(f"{src.name}: {len(sprites)} sprite", [s.size for s in sprites])
    if len(sprites) != 8:
        sys.exit(f"FAIL: butuh 8 sprite, terdeteksi {len(sprites)}")

    bottom, head = 6, 10
    if pixel:
        # Kuantisasi dulu di resolusi logis, registrasi di ruang logis, lalu upscale NEAREST.
        ref_h = sprites[0].size[1]
        lsprites = [quantize(s, round(pixel * s.size[1] / ref_h)) for s in sprites]
        scale = (cell_h - bottom - head) // pixel  # faktor bulat agar piksel tetap kotak
        up = lambda s: s.resize((s.size[0] * scale, s.size[1] * scale), Image.NEAREST)
        work = lsprites
    else:
        ref_h = sprites[0].size[1]
        scale_f = (cell_h - bottom - head) / ref_h
        work = [s.resize((max(1, round(s.size[0] * scale_f)), max(1, round(s.size[1] * scale_f))), Image.LANCZOS)
                for s in sprites]
        scale = 1
        up = lambda s: s

    masks = [mask_of(s) for s in work]
    ref = masks[0]
    static_from = int(ref.shape[0] * 0.45)  # baris di bawah 45% = wilayah statis
    rcx, rh = feet_anchor(ref)
    # Kolom kaki frame 1 (8% baris terbawah) — ekor yang menjuntai di kiri dikecualikan.
    fxs = np.where(ref[int(ref.shape[0] * 0.92):].any(axis=0))[0]
    col_from = max(0, int(fxs.min()) - 12) if len(fxs) else 0

    strip = Image.new("RGBA", (cell_w * 8, cell_h), (0, 0, 0, 0))
    anchor_x = cell_w * 0.62
    report = []
    for i, sp in enumerate(work):
        if i == 0:
            ox, oy, resid, sp_best = 0, 0, 0.0, sp
        else:
            best = None
            factors = (1.0,) if pixel else (0.92, 0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06, 1.08)
            for f in factors:
                cand = sp if f == 1.0 else sp.resize((max(1, round(sp.size[0] * f)), max(1, round(sp.size[1] * f))), Image.LANCZOS)
                m = masks[i] if f == 1.0 else mask_of(cand)
                r = register(ref, m, static_from, search=24 // scale if pixel else 24, col_from=col_from)
                if best is None or r[2] < best[0][2]:
                    best = (r, cand, f)
            (ox, oy, resid), sp_best, f = best
            if f != 1.0:
                print(f"  f{i + 1}: skala {f:.2f}")
        # posisi frame: jangkar kaki frame 1 + offset registrasi (dalam piksel kerja)
        x = anchor_x - rcx * scale + ox * scale + i * cell_w
        y = cell_h - bottom - rh * scale + oy * scale
        strip.alpha_composite(up(sp_best), (int(round(x)), int(round(y))))
        report.append((i + 1, ox, oy, resid))
    strip.save(dst)
    print("ditulis", dst, strip.size)
    print("registrasi (frame, dx, dy, residu-statis):")
    for r in report:
        print(f"  f{r[0]}: dx={r[1]:+d} dy={r[2]:+d} residu={r[3]:.3f}")


if __name__ == "__main__":
    main()
