#!/usr/bin/env python3
"""Pipeline atlas Pet Hanoman — pustaka bersama untuk key/register/atlas/qa/verify.

Semua keputusan di sini lahir dari pengukuran 2026-08-22 (lihat spec §4):
- sprite DIDETEKSI dari celah transparan, bukan dipotong per grid (model tak menaati sel);
- frame DIREGISTRASI ke frame 1 lewat pencarian offset+skala di wilayah statis (ekor dikecualikan),
  lalu wilayah statis frame 1 DI-PIN ke frame lain — jangkar kaki saja memberi jitter ±15 px;
- chroma key MEMPERTAHANKAN warna interior — despill global memotong merah pada emas/kain.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

CELL_W, CELL_H = 192, 208
COLUMNS = 8
ANCHOR_X = 0.62        # pusat kaki di 62 % lebar sel → ruang ekor di kiri
BASELINE = 202         # baris y (dari atas sel) tempat kaki berdiri
HEAD_MARGIN = 34       # ruang di atas frame 1: ayunan ekor/kepala + ketinggian lompat `shipped`
STAND_H = BASELINE - HEAD_MARGIN   # 168 — tinggi karakter berdiri; frontend menskalakan dari sini
ATLAS_BUDGET = 1_000_000
SEARCH_PX = 24
SCALES = (0.92, 0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06, 1.08)
STATIC_FROM = 0.45     # stand: baris ≥ 45 % tinggi frame 1 = wilayah statis (kaki, kain, torso bawah)
UPPER_TO = 0.55        # walk/jump: baris ≤ 55 % = kepala + torso atas
PIN_FEATHER = 6

# Urutan = indeks baris atlas. `mode` menentukan cara registrasi (§5.2 spec).
ROWS: list[dict] = [
    {"key": "idle",         "fps": 6,  "loop": True,  "mode": "stand"},
    {"key": "walk-right",   "fps": 10, "loop": True,  "mode": "walk", "dir": "right"},
    {"key": "walk-left",    "fps": 10, "loop": True,  "mode": "walk", "dir": "left"},
    {"key": "working",      "fps": 8,  "loop": True,  "mode": "stand"},
    {"key": "waiting",      "fps": 6,  "loop": True,  "mode": "stand"},
    {"key": "blocked",      "fps": 4,  "loop": True,  "mode": "stand"},
    {"key": "review",       "fps": 6,  "loop": True,  "mode": "stand"},
    {"key": "shipped",      "fps": 10, "loop": False, "mode": "jump", "then": "idle"},
    {"key": "docs-updated", "fps": 6,  "loop": True,  "mode": "stand"},
    {"key": "wave",         "fps": 10, "loop": False, "mode": "stand", "then": "idle"},
]
ROW_KEYS = [r["key"] for r in ROWS]
# Gerbang residu PRA-pin: strip idle yang disetujui mengukur 0,03–0,07 (stand) begitu ekor
# dikeluarkan dari wilayah; generasi rusak (frame tak sejajar / pose lain) ≥ 0,5. Walk/jump
# dinilai di wilayah atas yang memang lebih bervariasi.
RESIDUAL_GATE = {"stand": 0.15, "walk": 0.30, "jump": 0.30}


def row_def(key: str) -> dict:
    for r in ROWS:
        if r["key"] == key:
            return r
    raise KeyError(f"baris tak dikenal: {key}")


# ---------------------------------------------------------------- chroma key

def chroma_key(im: Image.Image, lo: float = 40.0, hi: float = 110.0) -> Image.Image:
    """Latar polos → alpha. Key = median piksel tepi kanvas. Interior tak disentuh; warna hanya
    di-unmix di pita parsial (lo < jarak < hi)."""
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    key = np.median(border, axis=0)
    dist = np.sqrt(((rgb - key) ** 2).sum(axis=2))
    alpha = np.clip((dist - lo) / (hi - lo), 0.0, 1.0)
    a3 = alpha[..., None]
    band = (alpha > 0) & (alpha < 1)
    unmixed = np.clip((rgb - (1 - a3) * key) / np.maximum(a3, 1e-3), 0, 255)
    out = rgb.copy()
    out[band] = unmixed[band]
    rgba = np.dstack([out, alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


# ---------------------------------------------------------------- deteksi

@dataclass
class Sprite:
    sheet_row: int
    bbox: tuple[int, int, int, int]   # koordinat lembar
    image: Image.Image                # RGBA, sudah di-crop ke bbox


def _runs(filled: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start = None
    gap = 0
    for i, f in enumerate(filled.tolist()):
        if f:
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
        out.append((start, len(filled)))
    return out


def detect_sprites(im: Image.Image, min_w: int = 40, min_h: int = 80) -> list[Sprite]:
    """Pisahkan lembar menjadi sprite lewat celah transparan: pita baris dulu, lalu kolom."""
    a = np.asarray(im.getchannel("A")) > 16
    sprites: list[Sprite] = []
    for r, (y0, y1) in enumerate(_runs(a.any(axis=1), min_gap=12)):
        band = a[y0:y1]
        for x0, x1 in _runs(band.any(axis=0), min_gap=8):
            ys, xs = np.where(band[:, x0:x1])
            if len(ys) == 0:
                continue
            bb = (int(x0 + xs.min()), int(y0 + ys.min()), int(x0 + xs.max() + 1), int(y0 + ys.max() + 1))
            if bb[2] - bb[0] >= min_w and bb[3] - bb[1] >= min_h:
                sprites.append(Sprite(r, bb, im.crop(bb)))
    return sprites


def touches_edge(sp: Sprite, size: tuple[int, int]) -> bool:
    x0, y0, x1, y1 = sp.bbox
    return x0 == 0 or y0 == 0 or x1 == size[0] or y1 == size[1]


# ---------------------------------------------------------------- registrasi

def mask_of(im: Image.Image) -> np.ndarray:
    return np.asarray(im.getchannel("A")) > 64


def feet_span(m: np.ndarray) -> tuple[int, int]:
    """Rentang-x kaki = run kolom PALING KANAN di 8 % baris terbawah. Karakter menghadap kanan,
    ekor selalu di kiri — dan lekukan bawah ekor bisa ikut menyentuh baris terbawah, jadi bbox
    polos akan tertarik ke ekor (jitter ±15 px terukur)."""
    h = m.shape[0]
    runs = _runs(m[int(h * 0.92):].any(axis=0), min_gap=3)
    if not runs:
        return 0, m.shape[1]
    return runs[-1]


def feet_anchor(m: np.ndarray) -> tuple[float, int]:
    """(pusat-x kaki, tinggi)."""
    x0, x1 = feet_span(m)
    return (x0 + x1) / 2, m.shape[0]


def left_of(m: np.ndarray, rows: slice) -> int:
    xs = np.where(m[rows].any(axis=0))[0]
    return int(xs.min()) if len(xs) else 0


def region_for(ref: np.ndarray, mode: str) -> tuple[slice, int]:
    """(baris, kolom-awal) wilayah penilaian registrasi — dan batas kolom pin — pada frame acuan.
    Kolom di kiri batas (ekor) tak dinilai dan tak di-pin."""
    h = ref.shape[0]
    if mode == "stand":
        return slice(int(h * STATIC_FROM), h), max(0, feet_span(ref)[0] - 12)
    return slice(0, int(h * UPPER_TO)), max(0, left_of(ref, slice(0, int(h * 0.3))) - 12)


def register(ref: np.ndarray, cur: np.ndarray, rows: slice, col_from: int,
             search: int = SEARCH_PX) -> tuple[int, int, float]:
    """Offset (dx, dy) asal `cur` relatif asal `ref` yang meminimalkan XOR mask di wilayah.
    Mulai dari jangkar kaki, cari kasar langkah 4 lalu halus ±3. Residu = XOR / luas wilayah ref."""
    H = max(ref.shape[0], cur.shape[0]) + 2 * search
    W = max(ref.shape[1], cur.shape[1]) + 2 * search
    R = np.zeros((H, W), bool)
    R[search:search + ref.shape[0], search:search + ref.shape[1]] = ref
    rcx, rh = feet_anchor(ref)
    ccx, ch = feet_anchor(cur)
    bx = int(round(search + rcx - ccx))
    by = search + rh - ch
    rs = slice(search + rows.start, search + rows.stop)
    cs = slice(search + col_from, search + ref.shape[1])
    area = max(float(np.count_nonzero(R[rs, cs])), 1.0)

    def score(dx: int, dy: int) -> float:
        y, x = by + dy, bx + dx
        if y < 0 or x < 0 or y + cur.shape[0] > H or x + cur.shape[1] > W:
            return float("inf")
        C = np.zeros((H, W), bool)
        C[y:y + cur.shape[0], x:x + cur.shape[1]] = cur
        return float(np.count_nonzero(R[rs, cs] ^ C[rs, cs]))

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
    return best[0] + bx - search, best[1] + by - search, best[2] / area


def _resize(im: Image.Image, f: float) -> Image.Image:
    return im.resize((max(1, round(im.size[0] * f)), max(1, round(im.size[1] * f))), Image.LANCZOS)


def _paste_clipped(strip: Image.Image, img: Image.Image, cell: int, x: int, y: int) -> int:
    """Tempel `img` ke sel ke-`cell` pada (x, y) relatif sel; bagian di luar sel dibuang.
    Mengembalikan jumlah piksel terisi (alpha > 64) yang terbuang — tumpahan ke sel tetangga
    adalah cacat, bukan dekorasi."""
    w, h = img.size
    sx0, sy0 = max(0, -x), max(0, -y)
    sx1, sy1 = min(w, CELL_W - x), min(h, CELL_H - y)
    total = int(np.count_nonzero(mask_of(img)))
    if sx1 <= sx0 or sy1 <= sy0:
        return total
    part = img.crop((sx0, sy0, sx1, sy1))
    strip.alpha_composite(part, (cell * CELL_W + x + sx0, y + sy0))
    return total - int(np.count_nonzero(mask_of(part)))


# ---------------------------------------------------------------- strip

def build_strip(sprites: list[Sprite], mode: str, pin: bool | None = None) -> tuple[Image.Image, list[dict]]:
    """8 sprite → strip 8 × (CELL_W×CELL_H) terregistrasi. Laporan per frame untuk gerbang QA."""
    if len(sprites) != 8:
        raise ValueError(f"butuh 8 sprite, terdeteksi {len(sprites)}")
    if pin is None:
        pin = mode == "stand"
    ref_h = sprites[0].image.size[1]
    f = STAND_H / ref_h
    work = [_resize(s.image, f) for s in sprites]
    masks = [mask_of(w) for w in work]
    ref = masks[0]
    rows, col_from = region_for(ref, mode)
    rcx, rh = feet_anchor(ref)
    ref_x = ANCHOR_X * CELL_W - rcx
    ref_y = BASELINE - rh
    # Tanah per baris lembar = bbox paling bawah di baris itu (frame yang menapak).
    ground = {}
    for s in sprites:
        ground[s.sheet_row] = max(ground.get(s.sheet_row, 0), s.bbox[3])
    lift_ref = (sprites[0].bbox[3] - ground[sprites[0].sheet_row]) * f

    strip = Image.new("RGBA", (CELL_W * 8, CELL_H), (0, 0, 0, 0))
    report: list[dict] = []
    for i, sp in enumerate(work):
        if i == 0:
            best = (0, 0, 0.0, 1.0, sp)
        else:
            best = None
            for sc in SCALES:
                cand = sp if sc == 1.0 else _resize(sp, sc)
                dx, dy, resid = register(ref, mask_of(cand), rows, col_from)
                if best is None or resid < best[2]:
                    best = (dx, dy, resid, sc, cand)
        dx, dy, resid, sc, img = best
        if mode == "walk":
            dy = rh - img.size[1]                               # kaki terendah menapak tanah
        elif mode == "jump":
            lift = (sprites[i].bbox[3] - ground[sprites[i].sheet_row]) * f
            dy = rh - img.size[1] + round(lift - lift_ref)     # ketinggian lompat dipertahankan
        x = int(round(ref_x + dx))
        y = int(round(ref_y + dy))
        clipped = _paste_clipped(strip, img, i, x, y)
        report.append({"frame": i + 1, "dx": int(dx), "dy": int(dy), "scale": sc,
                       "residual_pre": round(float(resid), 4), "clipped": clipped})

    if pin:
        _pin_static(strip, ref_x, ref_y, ref.shape, rows.start, col_from)
        for i in range(1, 8):
            report[i]["residual_post"] = _residual_post(strip, i, ref_y + rows.start, int(ref_x) + col_from)
    return strip, report


def _pin_static(strip: Image.Image, ref_x: float, ref_y: float, ref_shape: tuple[int, int],
                static_from: int, col_from: int) -> None:
    """Tempel wilayah statis frame 1 ke frame 2–8 (feather PIN_FEATHER px di tepi atasnya)."""
    arr = np.asarray(strip).astype(np.float32)
    ys = int(round(ref_y)) + static_from
    xs = int(round(ref_x)) + col_from
    y0 = max(0, ys - PIN_FEATHER)
    src = arr[y0:CELL_H, xs:CELL_W]
    weight = np.ones((CELL_H - y0, 1, 1), np.float32)
    weight[:PIN_FEATHER, 0, 0] = np.linspace(0.0, 1.0, PIN_FEATHER, endpoint=False)
    for i in range(1, 8):
        xi = i * CELL_W + xs
        dst = arr[y0:CELL_H, xi:xi + (CELL_W - xs)]
        dst[:] = src * weight + dst * (1 - weight)
    strip.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA"))


def _residual_post(strip: Image.Image, i: int, ys: int, xs: int) -> float:
    a = np.asarray(strip.getchannel("A")) > 64
    ref = a[ys:CELL_H, xs:CELL_W]
    cur = a[ys:CELL_H, i * CELL_W + xs:(i + 1) * CELL_W]
    return round(float(np.count_nonzero(ref ^ cur)) / max(float(np.count_nonzero(ref)), 1.0), 4)


# ---------------------------------------------------------------- atlas & manifest

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compose_atlas(rows_dir: Path) -> Image.Image:
    atlas = Image.new("RGBA", (CELL_W * COLUMNS, CELL_H * len(ROWS)), (0, 0, 0, 0))
    for idx, r in enumerate(ROWS):
        strip = Image.open(rows_dir / f"{r['key']}.png").convert("RGBA")
        if strip.size != (CELL_W * COLUMNS, CELL_H):
            raise ValueError(f"{r['key']}: ukuran strip {strip.size}, harus {(CELL_W * COLUMNS, CELL_H)}")
        atlas.alpha_composite(strip, (0, idx * CELL_H))
    return atlas


def manifest(rows_dir: Path) -> dict:
    return {
        "id": "PET-001", "version": 1,
        "cell": {"w": CELL_W, "h": CELL_H}, "columns": COLUMNS,
        "anchor": {"x": ANCHOR_X, "baseline": BASELINE},
        "character": {"h": STAND_H},
        "rows": [{k: v for k, v in r.items() if k != "mode"} for r in ROWS],
        "sources": {r["key"]: sha256(rows_dir / f"{r['key']}.png") for r in ROWS},
    }


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- QA artefak

def onion_skin(strip: Image.Image) -> Image.Image:
    acc = np.zeros((CELL_H, CELL_W), np.float32)
    for i in range(8):
        acc += np.asarray(strip.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H)).getchannel("A")).astype(np.float32) / 255
    acc /= 8
    return Image.fromarray((255 - acc * 255).astype(np.uint8)).resize((CELL_W * 2, CELL_H * 2), Image.NEAREST)


def save_gif(strip: Image.Image, path: Path, fps: int) -> None:
    frames = [strip.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H)) for i in range(8)]
    bg = [Image.new("RGBA", f.size, (250, 246, 236, 255)) for f in frames]
    for b, f in zip(bg, frames):
        b.alpha_composite(f)
    bg[0].save(path, save_all=True, append_images=bg[1:], duration=int(1000 / fps), loop=0)
