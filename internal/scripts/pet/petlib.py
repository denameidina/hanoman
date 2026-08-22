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
from PIL import Image, ImageFilter

CELL_W, CELL_H = 192, 208
COLUMNS = 8
ANCHOR_X = 0.62        # pusat kaki di 62 % lebar sel → ruang ekor di kiri
BASELINE = 202         # baris y (dari atas sel) tempat kaki berdiri
HEAD_MARGIN = 34       # ruang di atas frame 1: ayunan ekor/kepala + ketinggian lompat `shipped`
STAND_H = BASELINE - HEAD_MARGIN   # 168 — tinggi karakter berdiri; frontend menskalakan dari sini
# SPEC-904 · 1 MB tak bisa menampung 16 baris pada kualitas mana pun yang layak: q76 = 1 191 960 B,
# dan `quality` adalah tuas yang LEMAH di sini (q76 → q20 hanya −34 %) karena atlas ini didominasi
# kanal alpha lossless di atas seni datar berkontur tegas. Turun ke bawah 1 MB butuh ±q45 — dan
# atlas dirakit ulang dari rows/, jadi ketigabelas baris yang sudah lolos Gate 2 ikut turun.
# Premis plafon lama ("satu <img> di-decode di setiap halaman") juga tak dilayani `quality`: biaya
# decode adalah PIKSEL (19,5 MiB RGBA pada 16 baris), bukan byte. 1 300 000 = +30 % vs atlas v01
# (950 480 B) — di dalam batas +40 % SPEC-904 — dengan sisa ±108 KB untuk satu regenerasi rutin.
ATLAS_BUDGET = 1_300_000
SEARCH_PX = 24
SCALES = (0.92, 0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06, 1.08)
STATIC_FROM = 0.45     # stand: baris ≥ 45 % tinggi frame 1 = wilayah statis (kaki, kain, torso bawah)
UPPER_TO = 0.55        # walk/jump: baris ≤ 55 % = kepala + torso atas
PIN_FEATHER = 6
PIN_THIN = 3     # tepi bergoyang setipis ini dianggap goyangan, bukan gerak (dihapus erosi)
PIN_GROW = 10    # margin di sekeliling anggota badan yang bergerak — pin tak boleh menyentuhnya
FEET_MASS_RATIO = 0.3   # ambang massa run kaki vs run terbesar di pita terbawah (lihat feet_span)

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
    {"key": "wave",         "fps": 10, "loop": False, "mode": "stand", "then": "idle", "even": True},
    # SPEC-897 · ditambahkan di EKOR supaya indeks baris lama tak bergeser (atlas & pet.json
    # memakai urutan array sebagai indeks baris).
    {"key": "deciding",     "fps": 6,  "loop": True,  "mode": "stand"},
    {"key": "sleep",        "fps": 4,  "loop": True,  "mode": "stand"},
    # SPEC-898 · reaksi saat pet dielus (STK-007). Sekali-putar seperti `wave`, bukan pose mesin.
    {"key": "thanks",       "fps": 10, "loop": False, "mode": "stand", "then": "idle"},
    # SPEC-904 · tiga baris untuk pet yang DISERET, tetap di EKOR seperti preseden SPEC-897/898.
    # `held` & `falling` tak menapak tanah → mode `float`; keduanya diputar berulang selama seretan
    # berlangsung → `even: True`. `dizzy` berdiri (kaki tertanam, torso sempoyongan) dan sekali-putar
    # supaya pet BERDIRI LAGI sesudah mendarat, jadi frame 8-nya pose istirahat seperti `wave`.
    {"key": "held",         "fps": 8,  "loop": True,  "mode": "float", "even": True},
    {"key": "falling",      "fps": 8,  "loop": True,  "mode": "float", "even": True},
    {"key": "dizzy",        "fps": 8,  "loop": False, "mode": "stand", "then": "idle"},
]
ROW_KEYS = [r["key"] for r in ROWS]
# Gerbang residu PRA-pin; generasi rusak (frame tak sejajar / pose lain) mengukur ≥ 0,5. Angka
# di bawah dikalibrasi ulang atas kesepuluh baris nyata (2026-08-22), bukan atas `idle` saja:
#   stand  idle 0,069 · working 0,068 · blocked 0,029 · review 0,026 · docs-updated 0,101 ·
#          wave 0,113 · waiting 0,162 — yang tertinggi justru baris yang naskahnya MEMANG
#          mengangkat tangan setinggi pinggang, dan `residual_post`-nya 0,000: pin membuktikan
#          badannya beku, jadi 0,15 menghukum animasi yang benar.
#   walk   walk-right 0,040 · walk-left 0,037 — jauh di bawah gerbangnya.
#   jump   shipped 0,423 pada frame jongkok. Untuk `jump` residu wilayah atas nyaris tak bisa
#          membedakan apa pun: seluruh tubuh atas memang berubah total (jongkok → melayang →
#          mendarat). Yang benar-benar menjaga baris ini adalah tumpahan sel, jumlah sprite, dan
#          review Gate 2 atas `qa/shipped.gif` — bukan angka ini.
RESIDUAL_GATE = {"stand": 0.25, "walk": 0.30, "jump": 0.50, "float": 0.35}
# SPEC-904 · kerataan langkah untuk baris yang DIPUTAR BERULANG (`even: True`). Yang membuat sebuah
# loop tersendat bukan besar-kecilnya gerak, melainkan langkah besar yang bertetangga dengan langkah
# nyaris nol — `wave` v01 mengukur max 0,201 (tangan turun) di sebelah 0,028/0,031 (dua frame
# nyaris kembar di sambungan), rasio 7,07. Gerbang karena itu RASIO, bukan nilai mutlak, dan hanya
# berlaku saat geraknya memang terlihat: baris bernapas halus (`sleep` 21,3 · `blocked` 6,9) punya
# rasio besar tanpa pernah terbaca tersendat karena SELURUH langkahnya kecil. Dikalibrasi atas baris
# nyata yang sudah lolos Gate 2: walk-left 2,06 · walk-right 2,33 · waiting 3,18 · deciding 3,43.
STEP_VISIBLE = 0.10      # di bawah ini gerak baris dianggap terlalu halus untuk dinilai rata
STEP_RATIO_GATE = 3.5    # max(langkah) / min(langkah), termasuk sambungan 8→1
# SPEC-904 · gerbang SKALA KARAKTER. `build_strip` menskalakan bbox frame 1 menjadi STAND_H, jadi
# apa pun yang ikut memperpanjang bbox — ekor yang menjuntai lurus ke bawah pada baris `held` —
# MENGECILKAN badannya diam-diam: percobaan pertama `held` menggambar kepala 63 px vs 79 px milik
# `idle`, lolos setiap gerbang lain (residu 0,021, tumpahan 0, langkah rata 2,43) sambil melanggar
# "skala WAJIB identik dengan v01". Ukurannya: tinggi bbox SESUDAH erosi (ekor tipis lenyap, badan
# bertahan) dibagi tinggi bbox utuh. Ketigabelas baris v01 duduk rapat di 0,839–0,911 (terendah
# `blocked`); `held` percobaan 1 = 0,661.
BODY_ERODE = 5
BODY_RATIO_GATE = 0.80


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
    """Rentang-x kaki = gabungan run kolom BERISI di 8 % baris terbawah. Lekukan bawah ekor ikut
    menyentuh baris itu, jadi bbox polos tertarik ke ekor (jitter ±15 px terukur) — tapi ekor di
    sana hanya seutas garis: massanya < 0,3× run terbesar (terukur 82–98 px vs 289–594 px kaki),
    sedangkan kaki yang terbuka saat melangkah adalah DUA run yang sama-sama berisi. Menyaring
    lewat massa, bukan lewat "run paling kanan", karena `walk-left` digambar dengan ekor di sisi
    KANAN: aturan sisi akan menjangkar seluruh baris itu pada ekor."""
    h = m.shape[0]
    band = m[int(h * 0.92):]
    runs = _runs(band.any(axis=0), min_gap=3)
    if not runs:
        return 0, m.shape[1]
    mass = [int(band[:, a:b].sum()) for a, b in runs]
    keep = [r for r, w in zip(runs, mass) if w >= FEET_MASS_RATIO * max(mass)]
    return keep[0][0], keep[-1][1]


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

def _lift_fit(sprites: list[Sprite], work: list[Image.Image], ground: dict[int, int], f: float,
              lift_ref: float) -> float:
    """Faktor pengecil ketinggian lompat supaya tak ada frame yang menembus atap sel.

    `HEAD_MARGIN` menganggarkan ruang di atas frame 1 untuk lompatan `shipped`, tetapi model
    menggambar lompatan setinggi 27–32 % tinggi badan (terukur dua generasi berturut-turut) sementara
    anggarannya 20 %; meminta lompatan lebih rendah lewat prompt tak berhasil — tinggi bukan besaran
    yang ia ukur. Amplitudo karena itu DISKALakan di sini, bukan dipotong: profil arc (kapan naik,
    kapan puncak) dipertahankan, hanya puncaknya yang muat."""
    worst = 1.0
    for i, sp in enumerate(sprites):
        rise = lift_ref - (sp.bbox[3] - ground[sp.sheet_row]) * f
        if rise <= 0:
            continue
        room = BASELINE - work[i].size[1]
        if room <= 0:
            return 0.0
        worst = min(worst, room / rise)
    return worst


def _fit_dx(placed: list[tuple[int, int, float, float, Image.Image]], ref_x: float) -> int:
    """Geseran-x SERAGAM sekecil mungkin agar seluruh baris muat di selnya.

    Seragam, jadi registrasi antar-frame maupun pin tak tersentuh — yang bergeser hanya di mana
    baris itu duduk dalam selnya. Nol untuk baris yang sudah muat (mayoritas), sehingga strip yang
    sudah disetujui tak berubah satu byte pun."""
    xs = [ref_x + dx for dx, *_ in placed]
    left = min(xs)
    right = max(x + img.size[0] for x, (*_, img) in zip(xs, placed))
    if left < 0:
        return int(min(round(-left), max(0.0, CELL_W - right)))
    if right > CELL_W:
        return int(-min(round(right - CELL_W), max(0.0, left)))
    return 0


def build_strip(sprites: list[Sprite], mode: str, pin: bool | None = None) -> tuple[Image.Image, list[dict]]:
    """8 sprite → strip 8 × (CELL_W×CELL_H) terregistrasi. Laporan per frame untuk gerbang QA.

    Empat mode: `stand` (registrasi wilayah BAWAH + pin), `walk` (wilayah ATAS, dasar dipaksa
    menapak baseline), `jump` (wilayah ATAS, ketinggian busur dipertahankan), dan `float` —
    SPEC-904, untuk baris yang tak menapak tanah sama sekali (`held` tergantung dari atas,
    `falling` meringkuk di udara). `float` meminjam wilayah ATAS seperti `walk` karena yang statis
    di sana adalah kepala/torso, tetapi `dy` diambil apa adanya dari registrasi: memaksa piksel
    terendah ke baseline akan mendorong seluruh badan naik-turun mengikuti kaki yang menjuntai.
    Tanpa pin — tak ada wilayah bawah yang statis untuk dibekukan."""
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
    lift_fit = _lift_fit(sprites, work, ground, f, lift_ref) if mode == "jump" else 1.0

    placed: list[tuple[int, int, float, float, Image.Image]] = []
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
            rise = (lift_ref - (sprites[i].bbox[3] - ground[sprites[i].sheet_row]) * f) * lift_fit
            dy = rh - img.size[1] - round(rise)                # ketinggian lompat dipertahankan
        placed.append((dx, dy, resid, sc, img))

    fit_dx = _fit_dx(placed, ref_x)

    strip = Image.new("RGBA", (CELL_W * 8, CELL_H), (0, 0, 0, 0))
    report: list[dict] = []
    for i, (dx, dy, resid, sc, img) in enumerate(placed):
        x = int(round(ref_x + fit_dx + dx))
        y = int(round(ref_y + dy))
        clipped = _paste_clipped(strip, img, i, x, y)
        report.append({"frame": i + 1, "dx": int(dx), "dy": int(dy), "scale": sc,
                       "residual_pre": round(float(resid), 4), "clipped": clipped,
                       "fit_dx": fit_dx, "lift_fit": round(lift_fit, 3)})

    if pin:
        _pin_static(strip, ref_x + fit_dx, ref_y, ref.shape, rows.start, col_from)
        for i in range(1, 8):
            report[i]["residual_post"] = _residual_post(strip, i, ref_y + rows.start, int(ref_x + fit_dx) + col_from)
    return strip, report


def _dilate(m: np.ndarray, r: int) -> np.ndarray:
    im = Image.fromarray((m * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(2 * r + 1))
    return np.asarray(im) > 127


def _erode(m: np.ndarray, r: int) -> np.ndarray:
    im = Image.fromarray((m * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(2 * r + 1))
    return np.asarray(im) > 127


def _moving_parts(dis: np.ndarray) -> np.ndarray:
    """Dari peta ketidaksamaan antar-frame, ambil anggota badan yang BERGERAK saja.

    Dua hal tampak sama di peta itu: tepi yang bergoyang sub-piksel (pita TIPIS di sekeliling
    siluet, justru yang ingin dibekukan pin) dan tangan/prop yang memang menyapu. Tebal-tipis saja
    TAK cukup memisahkannya: lengan yang bergeser beberapa piksel meninggalkan sabit setipis
    goyangan, jadi erosi polos membuang lengannya sementara telapaknya bertahan — pin lalu
    mengembalikan lengan ke posisi frame 1 sementara telapak tinggal di posisi barunya, dan
    tangannya tampak PUTUS dari badan. Karena itu rekonstruksi morfologis: benih = bagian yang
    selamat dari erosi, lalu ditumbuhkan hanya DI DALAM peta itu sendiri sampai stabil, sehingga
    seluruh anggota badan yang tersambung ke benih ikut terjaga sementara pita goyangan yang tak
    menyentuh benih mana pun tetap dibuang."""
    seed = _erode(dis, PIN_THIN)
    while True:
        grown = _dilate(seed, 1) & dis
        if np.array_equal(grown, seed):
            break
        seed = grown
    return _dilate(seed, PIN_GROW)


def _pin_static(strip: Image.Image, ref_x: float, ref_y: float, ref_shape: tuple[int, int],
                static_from: int, col_from: int) -> None:
    """Tempel wilayah statis frame 1 ke frame 2–8 — KECUALI di mana anggota badan bergerak.

    Versi pertama membekukan kotaknya utuh dan karena itu MEMAKAN tangan pada baris yang naskahnya
    memang menggerakkan tangan setinggi pinggang (`waiting`, `wave`, `working`, `idle`): telapak
    terpotong garis pin, terbaca sebagai "glitch tangan" di GIF meski lembar mentahnya utuh."""
    arr = np.asarray(strip).astype(np.float32)
    ys = int(round(ref_y)) + static_from
    xs = max(0, int(round(ref_x)) + col_from)
    y0 = max(0, ys - PIN_FEATHER)
    a = np.asarray(strip.getchannel("A")) > 64
    ref_cell = a[y0:CELL_H, xs:CELL_W]
    dis = np.zeros(ref_cell.shape, bool)
    for i in range(1, 8):
        dis |= ref_cell ^ a[y0:CELL_H, i * CELL_W + xs:i * CELL_W + CELL_W]
    keep_out = _moving_parts(dis)
    weight = np.asarray(Image.fromarray(np.where(keep_out, 0, 255).astype(np.uint8), "L")
                        .filter(ImageFilter.GaussianBlur(PIN_FEATHER / 2))).astype(np.float32) / 255
    weight = weight[:, :, None]
    weight[:PIN_FEATHER] *= np.linspace(0.0, 1.0, PIN_FEATHER, endpoint=False)[:, None, None]
    src = arr[y0:CELL_H, xs:CELL_W]
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
        "id": "PET-001", "version": 2,
        "cell": {"w": CELL_W, "h": CELL_H}, "columns": COLUMNS,
        "anchor": {"x": ANCHOR_X, "baseline": BASELINE},
        "character": {"h": STAND_H},
        # `mode` dan `even` adalah kunci PIPELINE (registrasi & gerbang QA); frontend tak
        # memakainya, jadi keduanya tak pernah ikut ke pet.json.
        "rows": [{k: v for k, v in r.items() if k not in ("mode", "even")} for r in ROWS],
        "sources": {r["key"]: sha256(rows_dir / f"{r['key']}.png") for r in ROWS},
    }


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- QA artefak

def body_ratio(strip: Image.Image) -> float:
    """Berapa banyak tinggi frame 1 yang benar-benar BADAN, bukan anggota tipis yang menjuntai.

    `build_strip` menskalakan bbox frame 1 ke `STAND_H`; kalau bbox itu diperpanjang ekor yang
    menggantung, badannya mengecil tanpa satu pun gerbang lain menyadarinya. Erosi memisahkan
    keduanya: ekor selebar seutas garis lenyap, badan bertahan."""
    a = np.asarray(strip.crop((0, 0, CELL_W, CELL_H)).getchannel("A")) > 64
    ys = np.where(a.any(axis=1))[0]
    if len(ys) == 0:
        return 0.0
    body = _erode(a, BODY_ERODE)
    yb = np.where(body.any(axis=1))[0]
    return round(float(len(range(yb.min(), yb.max() + 1)) if len(yb) else 0)
                 / float(ys.max() - ys.min() + 1), 4)


def frame_steps(strip: Image.Image) -> list[float]:
    """Delapan langkah antar-frame sebuah strip, dinormalkan ke massa frame 1.

    Elemen TERAKHIR adalah sambungan 8→1 — justru langkah yang tak terlihat di contact sheet
    maupun onion-skin, dan satu-satunya yang menentukan apakah baris ini bisa diputar berulang."""
    masks = [np.asarray(strip.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H)).getchannel("A")) > 64
             for i in range(COLUMNS)]
    base = max(float(masks[0].sum()), 1.0)
    return [round(float(np.count_nonzero(masks[i] ^ masks[(i + 1) % COLUMNS])) / base, 4)
            for i in range(COLUMNS)]


def onion_skin(strip: Image.Image) -> Image.Image:
    acc = np.zeros((CELL_H, CELL_W), np.float32)
    for i in range(8):
        acc += np.asarray(strip.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H)).getchannel("A")).astype(np.float32) / 255
    acc /= 8
    return Image.fromarray((255 - acc * 255).astype(np.uint8)).resize((CELL_W * 2, CELL_H * 2), Image.NEAREST)


def save_gif(strip: Image.Image, path: Path, fps: int) -> None:
    """GIF review dengan SATU palet untuk kedelapan frame.

    Palet adaptif per frame membuat warna bergeser sedikit tiap frame; pada 6–10 fps itu terbaca
    sebagai kedip yang tak ada di stripnya — artefak review yang menuduh artworknya."""
    frames = [strip.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H)) for i in range(8)]
    bg = []
    for f in frames:
        b = Image.new("RGBA", f.size, (250, 246, 236, 255))
        b.alpha_composite(f)
        bg.append(b.convert("RGB"))
    montage = Image.new("RGB", (CELL_W * 8, CELL_H))
    for i, b in enumerate(bg):
        montage.paste(b, (i * CELL_W, 0))
    palette = montage.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    seq = [b.quantize(palette=palette, dither=Image.Dither.NONE) for b in bg]
    seq[0].save(path, save_all=True, append_images=seq[1:], duration=round(1000 / fps), loop=0,
                disposal=2, optimize=False)
