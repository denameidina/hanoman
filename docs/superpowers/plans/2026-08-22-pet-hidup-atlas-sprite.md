# SPEC-896 — Pet hidup (spec A): atlas sprite dari Codex, renderer frame, berkeliaran · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti pet sticker-digoyang-CSS dengan karakter beranimasi frame dari satu atlas WebP yang dibuat Codex lewat pipeline terregistrasi, berkeliaran di tepi bawah dashboard (desktop/tablet) dan diam di pojok (mobile), tanpa mengubah kontrak status SPEC-585.

**Architecture:** Sisi aset: `internal/assets/pet/` (prompt, model sheet, strip per baris, atlas + manifest) dirakit `internal/scripts/pet/` (Python + Pillow + numpy): `gen` men-spawn `codex exec`, `key` mengalpha-kan latar hijau tanpa menyentuh warna interior, `register` mendeteksi 8 sprite dari celah transparan lalu meregistrasi + mem-pin wilayah statis ke frame 1, `atlas`/`qa`/`verify` merakit dan menjaga. Sisi frontend: `pet-sprite.ts` (manifest + pose→baris), `pet-walk.ts` (mesin berkeliaran murni), `HanomanPet.tsx` (satu `<img>` atlas; baris via `--row`, frame via `steps(8)`; actor `translateX` + transisi linear; panel berjangkar). Spec: `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`.

**Tech Stack:** Python 3 + Pillow 12 + numpy 2 (pipeline, `unittest`) · Codex CLI ≥ 0.147 dengan image generation (hanya saat regenerasi) · React 18 + TypeScript strict · CSS keyframes/custom properties · Vitest 2 + Testing Library/jsdom · Hanoman Design System.

## Global Constraints

- Kontrak status **tidak berubah**: `derivePetState`, `PetPose`, prioritas, headline, target, `PET_TRANSIENT_MS`, `hanoman.pet.hidden`, pegangan buntut (spec §3.5).
- Sel atlas `192×208`, 8 kolom, 10 baris urutan `idle, walk-right, walk-left, working, waiting, blocked, review, shipped, docs-updated, wave`; tinggi karakter berdiri `168` (`character.h`), jangkar kaki `x 0.62`, baseline `202`; atlas ≤ **1 000 000 B** (spec §5.3, §10).
- Kunci warna latar generasi **hijau `#00FF00`**; Codex hanya menyimpan PNG mentah — penghapusan latar oleh pipeline (spec §4).
- `walk-left` digambar terpisah, **tidak pernah mirror** (brand "never mirror"; spec §3.4).
- Keyframe pet hanya menulis `transform`/`opacity`; tanpa rAF/interval/render per frame; satu `setTimeout` pada `until` + `transitionend` (spec §6–7).
- Skala tampilan: **112 px** desktop/tablet, **96 px** mobile; tier mobile **dipaksa diam di pojok**, toggle roam disembunyikan (spec §7–8).
- `prefers-reduced-motion`: `animation: none` + `transition: none` nilai persis, pet di rumah, tanpa `wave` (spec §9).
- Jalur `pointer-events: none`; yang `auto` hanya tombol 44 px di kaki, pegangan, panel (SPEC-763, spec §8).
- Test web dijalankan `env -u NODE_ENV pnpm vitest --run <path>` dari root repo; Python `python3 internal/scripts/pet/test-petlib.py`. Jangan suite penuh / `pnpm -r typecheck`; typecheck paket `src` saja bila menyentuh TS.
- Docs SoT yang tersentuh diperbarui dalam commit yang sama dan ter-link di `internal/docs/README.md` (Task 11).
- Kode di Task 1–3 dan 6–9 **sudah divalidasi** saat plan ditulis (10 test Python + 53 test Vitest hijau, `tsc` bersih) — salin apa adanya; bila ada penyimpangan, perbaiki dan catat alasannya di commit.
- Commit per task. Bila plan ini dijalankan sebagai sesi hanoman yang mewajibkan satu commit akhir, ganti langkah commit dengan `git add` saja dan commit sekali di akhir.
- Kerjakan di worktree `.claude/worktrees/pet-hidup` (branch `pet-hidup`, sudah `pnpm install`), bukan di working tree utama.

---

### Task 1: Pustaka pipeline `petlib.py` + `common.py` + test sintetis

**Files:**
- Create: `internal/scripts/pet/petlib.py`
- Create: `internal/scripts/pet/common.py`
- Test: `internal/scripts/pet/test-petlib.py`

**Interfaces:**
- Produces (dipakai Task 2–5): `petlib.ROWS` (urutan + `mode`), `petlib.chroma_key(im) -> Image`, `petlib.detect_sprites(im) -> list[Sprite]` (`Sprite(sheet_row, bbox, image)`), `petlib.touches_edge(sprite, size) -> bool`, `petlib.build_strip(sprites, mode, pin=None) -> (Image, report: list[dict])` dengan kunci laporan `frame, dx, dy, scale, residual_pre, clipped[, residual_post]`, `petlib.compose_atlas(rows_dir) -> Image`, `petlib.manifest(rows_dir) -> dict`, `petlib.write_json`, `petlib.onion_skin`, `petlib.save_gif`, `petlib.sha256`, konstanta `CELL_W, CELL_H, COLUMNS, ANCHOR_X, BASELINE, STAND_H, ATLAS_BUDGET, RESIDUAL_GATE, ROW_KEYS`; `common.ASSETS` (Path, `HANOMAN_PET_ASSETS` mengalihkan), `common.load_petlib()`, `common.fail(msg)`.

- [x] **Step 1: Tulis test sintetis yang gagal**

Buat `internal/scripts/pet/test-petlib.py`:

```python
#!/usr/bin/env python3
"""Test petlib atas lembar SINTETIS: karakter kotak+kepala+ekor digambar Pillow, ditaruh di grid
longgar dengan geseran/skala yang diketahui, supaya deteksi, registrasi, pin, dan gerbang bisa
dibuktikan tanpa aset nyata."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SCRIPT = Path(__file__).with_name("petlib.py")
SPEC = importlib.util.spec_from_file_location("petlib", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT}")
petlib = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = petlib
SPEC.loader.exec_module(petlib)

BODY = (240, 236, 220, 255)
GOLD = (184, 134, 59, 255)


def draw_character(size: tuple[int, int] = (260, 340), tail_lift: int = 0, lift: int = 0,
                   scale: float = 1.0) -> Image.Image:
    """Karakter menghadap kanan: kaki+torso (kotak di kanan), kepala (lingkaran), ekor di kiri yang
    ujungnya naik sebesar `tail_lift`. `lift` mengangkat seluruh tubuh (lompat)."""
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w, h = size
    base = h - 6 - lift
    # kaki + torso: kolom 150..230
    d.rectangle((150, base - 220, 230, base), fill=BODY)
    # kepala
    d.ellipse((140, base - 330, 250, base - 220), fill=BODY)
    d.ellipse((215, base - 300, 235, base - 280), fill=(20, 18, 12, 255))
    # ekor: dari pinggul (150, base-100) melengkung ke kiri lalu naik
    pts = [(150, base - 100), (90, base - 60), (40, base - 120 - tail_lift), (30, base - 200 - tail_lift)]
    d.line(pts, fill=GOLD, width=16, joint="curve")
    if scale != 1.0:
        im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return im


def sheet(frames: list[Image.Image], shifts: list[tuple[int, int]], bg=(0, 0, 0, 0)) -> Image.Image:
    """Lembar 4×2 longgar: frame ke-i ditempel di sel (i % 4, i // 4) ditambah geseran `shifts[i]`."""
    im = Image.new("RGBA", (1536, 1024), bg)
    for i, (fr, (sx, sy)) in enumerate(zip(frames, shifts)):
        cx, cy = (i % 4) * 384 + 60 + sx, (i // 4) * 512 + 80 + sy
        im.alpha_composite(fr, (cx, cy))
    return im


class ChromaKeyTest(unittest.TestCase):
    def test_green_background_becomes_alpha_and_interior_colour_is_untouched(self) -> None:
        im = Image.new("RGB", (120, 100), (0, 255, 0))
        d = ImageDraw.Draw(im)
        d.rectangle((30, 20, 90, 80), fill=(184, 134, 59))
        keyed = petlib.chroma_key(im)
        px = keyed.load()
        self.assertEqual(px[5, 5][3], 0)                  # latar → transparan
        self.assertEqual(px[60, 50], (184, 134, 59, 255))  # emas interior tak bergeser
        self.assertEqual(px[31, 21][3], 255)              # tepi tegas tetap opak


class DetectTest(unittest.TestCase):
    def test_detects_eight_sprites_from_loose_grid_with_sheet_rows(self) -> None:
        frames = [draw_character(tail_lift=i * 6) for i in range(8)]
        shifts = [(0, 0), (-25, 4), (-60, 0), (-90, 2), (10, 0), (-30, 0), (-70, 3), (-100, 0)]
        sprites = petlib.detect_sprites(sheet(frames, shifts))
        self.assertEqual(len(sprites), 8)
        self.assertEqual([s.sheet_row for s in sprites], [0, 0, 0, 0, 1, 1, 1, 1])
        self.assertFalse(any(petlib.touches_edge(s, (1536, 1024)) for s in sprites))

    def test_sprite_on_canvas_edge_is_flagged(self) -> None:
        frames = [draw_character() for _ in range(8)]
        frames[0] = frames[0].crop(frames[0].getbbox())   # isi frame 1 rapat ke tepinya sendiri
        shifts = [(-60, -80)] + [(0, 0)] * 7               # … lalu ditempel tepat di pojok (0, 0)
        sprites = petlib.detect_sprites(sheet(frames, shifts))
        self.assertTrue(petlib.touches_edge(sprites[0], (1536, 1024)))


class FeetTest(unittest.TestCase):
    def test_feet_span_ignores_tail_that_touches_the_bottom_rows(self) -> None:
        fr = draw_character(tail_lift=-110)   # ekor turun sampai baris terbawah
        m = petlib.mask_of(fr)
        x0, x1 = petlib.feet_span(m)
        self.assertGreaterEqual(x0, 145)       # kaki mulai di kolom 150, bukan di ekor (x≈30)
        self.assertLessEqual(x1, 235)


class BuildStripTest(unittest.TestCase):
    def sprites(self, frames, shifts):
        return petlib.detect_sprites(sheet(frames, shifts))

    def test_stand_registers_body_and_pins_static_region(self) -> None:
        frames = [draw_character(tail_lift=i * 8) for i in range(8)]
        shifts = [(0, 0), (-25, 4), (-60, 0), (-90, 2), (10, 0), (-30, 0), (-70, 3), (-100, 0)]
        strip, report = petlib.build_strip(self.sprites(frames, shifts), "stand")
        self.assertEqual(strip.size, (petlib.CELL_W * 8, petlib.CELL_H))
        for r in report[1:]:
            self.assertLessEqual(r["residual_pre"], 0.05, r)      # badan sama → residu kecil
            self.assertLessEqual(r["residual_post"], 0.01, r)     # pin membekukan tubuh bawah
            self.assertEqual(r["clipped"], 0, r)
        # kaki frame 1 berdiri di baseline pada kolom jangkar
        a = np.asarray(strip.getchannel("A")) > 64
        cell0 = a[:, :petlib.CELL_W]
        self.assertTrue(cell0[petlib.BASELINE - 1].any())
        self.assertFalse(cell0[petlib.BASELINE + 2:].any())
        # ekor frame 8 (naik 56 px) tetap berbeda dari frame 1 — pin tak menyentuh kolom ekor
        tail_cols = slice(0, int(petlib.ANCHOR_X * petlib.CELL_W) - 60)
        self.assertTrue((a[:, tail_cols] ^ a[:, 7 * petlib.CELL_W:7 * petlib.CELL_W + tail_cols.stop]).any())

    def test_scale_drift_is_recovered(self) -> None:
        frames = [draw_character(scale=s) for s in (1.0, 1.06, 0.95, 1.0, 1.03, 0.97, 1.0, 1.05)]
        shifts = [(0, 0)] * 8
        _, report = petlib.build_strip(self.sprites(frames, shifts), "stand")
        self.assertEqual(report[0]["scale"], 1.0)
        self.assertAlmostEqual(report[1]["scale"], 1 / 1.06, delta=0.025)   # mengecilkan yang membesar
        self.assertAlmostEqual(report[2]["scale"], 1 / 0.95, delta=0.025)   # membesarkan yang mengecil

    def test_walk_bottom_aligns_and_jump_keeps_lift(self) -> None:
        lifts = [0, 10, 30, 50, 40, 20, 5, 0]
        frames = [draw_character(lift=l) for l in lifts]
        shifts = [(0, 0)] * 8
        walk, _ = petlib.build_strip(self.sprites(frames, shifts), "walk")
        jump, _ = petlib.build_strip(self.sprites(frames, shifts), "jump")

        def bottom(strip, i):
            a = np.asarray(strip.crop((i * petlib.CELL_W, 0, (i + 1) * petlib.CELL_W, petlib.CELL_H)).getchannel("A")) > 64
            return int(np.where(a.any(axis=1))[0].max())

        self.assertEqual({bottom(walk, i) for i in range(8)}, {petlib.BASELINE - 1})
        self.assertEqual(bottom(jump, 0), petlib.BASELINE - 1)
        self.assertLess(bottom(jump, 3), bottom(jump, 0) - 20)   # frame 4 melayang (lift 50 px)

    def test_requires_exactly_eight_sprites(self) -> None:
        frames = [draw_character() for _ in range(7)]
        with self.assertRaises(ValueError):
            petlib.build_strip(self.sprites(frames, [(0, 0)] * 7), "stand")


class AtlasTest(unittest.TestCase):
    def test_compose_atlas_and_manifest_from_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rows = Path(tmp)
            for r in petlib.ROWS:
                Image.new("RGBA", (petlib.CELL_W * 8, petlib.CELL_H), (0, 0, 0, 0)).save(rows / f"{r['key']}.png")
            atlas = petlib.compose_atlas(rows)
            self.assertEqual(atlas.size, (1536, petlib.CELL_H * len(petlib.ROWS)))
            m = petlib.manifest(rows)
            self.assertEqual([r["key"] for r in m["rows"]], petlib.ROW_KEYS)
            self.assertNotIn("mode", m["rows"][0])
            self.assertEqual(m["rows"][7], {"key": "shipped", "fps": 10, "loop": False, "then": "idle"})
            self.assertEqual(set(m["sources"]), set(petlib.ROW_KEYS))
            self.assertEqual(m["character"], {"h": petlib.STAND_H})

    def test_compose_atlas_rejects_wrong_strip_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rows = Path(tmp)
            for r in petlib.ROWS:
                Image.new("RGBA", (petlib.CELL_W * 8, petlib.CELL_H), (0, 0, 0, 0)).save(rows / f"{r['key']}.png")
            Image.new("RGBA", (100, 100)).save(rows / "wave.png")
            with self.assertRaises(ValueError):
                petlib.compose_atlas(rows)


if __name__ == "__main__":
    unittest.main()
```

- [x] **Step 2: Jalankan, pastikan gagal karena pustaka belum ada**

Run: `python3 internal/scripts/pet/test-petlib.py`
Expected: `RuntimeError: cannot load .../petlib.py` (atau `FileNotFoundError`) — belum ada `petlib.py`.

- [x] **Step 3: Tulis `common.py` dan `petlib.py`**

`internal/scripts/pet/common.py`:

```python
"""Lokasi aset & pemuat petlib untuk semua CLI di direktori ini."""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = Path(os.environ.get("HANOMAN_PET_ASSETS") or HERE.parents[1] / "assets" / "pet")


def load_petlib():
    spec = importlib.util.spec_from_file_location("petlib", HERE / "petlib.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("petlib.py tak ketemu")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["petlib"] = mod
    spec.loader.exec_module(mod)
    return mod


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)
```

`internal/scripts/pet/petlib.py`:

```python
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
```

- [x] **Step 4: Jalankan test sampai hijau**

Run: `python3 internal/scripts/pet/test-petlib.py`
Expected: `Ran 10 tests in ~0.5s` … `OK`.

- [x] **Step 5: Commit**

```bash
git add internal/scripts/pet/petlib.py internal/scripts/pet/common.py internal/scripts/pet/test-petlib.py
git commit -m "feat(pet): pustaka pipeline atlas — chroma key, deteksi celah, registrasi + pin, rakit atlas"
```

---

### Task 2: CLI `key.py`, `register.py`, `qa.py` dan regenerasi `rows/idle.png` ber-pin

**Files:**
- Create: `internal/scripts/pet/key.py`, `internal/scripts/pet/register.py`, `internal/scripts/pet/qa.py`
- Modify: `internal/assets/pet/rows/idle.png` (dirakit ulang), `internal/assets/pet/.gitignore`
- Create: `internal/assets/pet/rows/idle.report.json`, `internal/assets/pet/qa/idle-contact.png`, `internal/assets/pet/qa/idle-onion.png`, `internal/assets/pet/qa/idle.gif`
- Delete: `internal/assets/pet/prototype/register.py`, `internal/assets/pet/prototype/chroma_key.py`

**Interfaces:**
- Consumes: `petlib`, `common` (Task 1).
- Produces: `rows/<key>.png` (1536×208 RGBA), `rows/<key>.report.json` `{ key, mode, pinned, edge: bool[8], frames: [...] }`, artefak `qa/<key>-contact.png`, `qa/<key>-onion.png`, `qa/<key>.gif`; exit 1 pada gerbang gagal.

- [ ] **Step 1: Tulis ketiga CLI**

`internal/scripts/pet/key.py`:

```python
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
```

`internal/scripts/pet/register.py`:

```python
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
```

`internal/scripts/pet/qa.py`:

```python
#!/usr/bin/env python3
"""Gerbang kualitas satu baris + artefak review manusia di qa/ (contact sheet, onion-skin, GIF).
Keluar 1 bila gerbang gagal: sprite menyentuh tepi lembar, tumpahan sel, residu pra-pin di atas
petlib.RESIDUAL_GATE[mode], atau alpha hilang."""
from __future__ import annotations

import json
import sys

from PIL import Image

from common import ASSETS, fail, load_petlib

petlib = load_petlib()


def main() -> None:
    if len(sys.argv) != 2:
        fail("pemakaian: qa.py <key>")
    key = sys.argv[1]
    row = petlib.row_def(key)
    strip_path = ASSETS / "rows" / f"{key}.png"
    report_path = ASSETS / "rows" / f"{key}.report.json"
    if not strip_path.exists() or not report_path.exists():
        fail(f"rows/{key}.png / .report.json tak ada — jalankan register.py {key} dulu")
    strip = Image.open(strip_path)
    report = json.loads(report_path.read_text())
    problems: list[str] = []
    if strip.mode != "RGBA":
        problems.append(f"mode {strip.mode}, bukan RGBA")
    if strip.size != (petlib.CELL_W * 8, petlib.CELL_H):
        problems.append(f"ukuran {strip.size}")
    if any(report["edge"]):
        problems.append("sprite menyentuh tepi lembar: " + ", ".join(f"f{i + 1}" for i, e in enumerate(report["edge"]) if e))
    gate = petlib.RESIDUAL_GATE[row["mode"]]
    for fr in report["frames"]:
        if fr["clipped"]:
            problems.append(f"f{fr['frame']} tumpah {fr['clipped']} px ke luar sel")
        if fr["residual_pre"] > gate:
            problems.append(f"f{fr['frame']} residu pra-pin {fr['residual_pre']:.3f} > {gate}")
    qa = ASSETS / "qa"
    qa.mkdir(exist_ok=True)
    contact = Image.new("RGBA", (strip.size[0] // 2, strip.size[1] // 2), (250, 246, 236, 255))
    contact.alpha_composite(strip.convert("RGBA").resize(contact.size, Image.LANCZOS))
    contact.save(qa / f"{key}-contact.png")
    petlib.onion_skin(strip.convert("RGBA")).save(qa / f"{key}-onion.png")
    petlib.save_gif(strip.convert("RGBA"), qa / f"{key}.gif", row["fps"])
    print(f"qa/{key}-contact.png qa/{key}-onion.png qa/{key}.gif ditulis")
    if problems:
        fail(f"{key}: " + "; ".join(problems))
    print(f"OK {key}: 8 frame, residu maks {max(f['residual_pre'] for f in report['frames']):.3f} ≤ {gate}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Rakit ulang baris idle dari gambar mentah yang disetujui**

`raw/` di-gitignore; `raw/idle.magenta.png` (keluaran Codex 2026-08-22, latar magenta — `chroma_key` menyampel warna tepi, jadi tetap bekerja) ada di mesin ini dari sesi brainstorm. Bila hilang, jalankan Task 4 lalu `python3 internal/scripts/pet/gen.py idle` untuk membuatnya lagi (latar hijau).

Run:
```bash
cp internal/assets/pet/raw/idle.magenta.png internal/assets/pet/raw/idle.png
python3 internal/scripts/pet/key.py idle
python3 internal/scripts/pet/register.py idle
python3 internal/scripts/pet/qa.py idle
```
Expected (angka boleh bergeser ±0,01):
```
idle.keyed.png: transparan=1245282 opak=322819 parsial=4763
  f1: dx=+0 dy=+0 skala=1.00 residu=0.000
  f2: dx=+3 dy=+0 skala=1.00 residu=0.026→0.002
  ...
  f7: dx=-21 dy=-2 skala=1.08 residu=0.069→0.002
  f8: dx=-14 dy=-3 skala=1.06 residu=0.032→0.001
ditulis rows/idle.png + rows/idle.report.json
qa/idle-contact.png qa/idle-onion.png qa/idle.gif ditulis
OK idle: 8 frame, residu maks 0.069 ≤ 0.15
```
Tak boleh ada `TUMPAH=` pada baris mana pun.

- [ ] **Step 3: Periksa artefak dengan mata**

Buka `internal/assets/pet/qa/idle.gif` (mis. `open internal/assets/pet/qa/idle.gif`) dan `qa/idle-onion.png`: badan bawah harus padat hitam di onion-skin, hanya ekor & kepala yang berbayang; GIF bernapas, kedip di frame 4, ekor mengayun, tanpa sentakan badan.

- [ ] **Step 4: Hapus prototipe dan perbarui gitignore**

Run:
```bash
git rm -q internal/assets/pet/prototype/register.py internal/assets/pet/prototype/chroma_key.py
printf 'raw/\n' > internal/assets/pet/.gitignore
```

- [ ] **Step 5: Commit**

```bash
git add internal/scripts/pet/key.py internal/scripts/pet/register.py internal/scripts/pet/qa.py \
  internal/assets/pet/rows/idle.png internal/assets/pet/rows/idle.report.json internal/assets/pet/qa internal/assets/pet/.gitignore
git commit -m "feat(pet): CLI key/register/qa; baris idle dirakit ulang dengan registrasi + pin"
```

---

### Task 3: `atlas.py` dan `verify.py`

**Files:**
- Create: `internal/scripts/pet/atlas.py`, `internal/scripts/pet/verify.py`

**Interfaces:**
- Consumes: `petlib.compose_atlas`, `petlib.manifest`, `petlib.ATLAS_BUDGET`, `petlib.ROWS`.
- Produces: `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp` + `internal/assets/pet/pet.json` (Task 5 yang merakitnya); `atlas.py --check` dan `verify.py` keluar 1 bila basi/rusak.

- [ ] **Step 1: Tulis kedua skrip**

`internal/scripts/pet/atlas.py`:

```python
#!/usr/bin/env python3
"""rows/*.png (urutan petlib.ROWS) → hnm-pet-anoman-atlas-v01.webp + pet.json.
`--check`: tulis nihil; keluar 1 bila baris kurang, hash rows/ tak cocok manifest, atau atlas
melampaui anggaran."""
from __future__ import annotations

import io
import json
import sys

from PIL import Image

from common import ASSETS, fail, load_petlib

petlib = load_petlib()
ATLAS = ASSETS / "hnm-pet-anoman-atlas-v01.webp"
MANIFEST = ASSETS / "pet.json"


def encode(atlas: Image.Image) -> bytes:
    buf = io.BytesIO()
    atlas.save(buf, format="WEBP", quality=82, method=6, exact=False)
    return buf.getvalue()


def main() -> None:
    check = "--check" in sys.argv
    missing = [r["key"] for r in petlib.ROWS if not (ASSETS / "rows" / f"{r['key']}.png").exists()]
    if missing:
        fail("baris belum ada: " + ", ".join(missing))
    atlas = petlib.compose_atlas(ASSETS / "rows")
    manifest = petlib.manifest(ASSETS / "rows")
    data = encode(atlas)
    if len(data) > petlib.ATLAS_BUDGET:
        fail(f"atlas {len(data)} B > anggaran {petlib.ATLAS_BUDGET} B — turunkan quality atau detail baris")
    if check:
        if not ATLAS.exists() or not MANIFEST.exists():
            fail("atlas/manifest belum dirakit — jalankan atlas.py")
        current = json.loads(MANIFEST.read_text())
        if current.get("sources") != manifest["sources"]:
            fail("rows/ berubah sejak atlas dirakit — jalankan atlas.py lalu commit keduanya")
        print(f"OK atlas segar, {ATLAS.stat().st_size} B, {len(petlib.ROWS)} baris")
        return
    ATLAS.write_bytes(data)
    petlib.write_json(MANIFEST, manifest)
    print(f"ditulis {ATLAS.name} ({len(data)} B, {atlas.size[0]}×{atlas.size[1]}) + {MANIFEST.name}")


if __name__ == "__main__":
    main()
```

`internal/scripts/pet/verify.py`:

```python
#!/usr/bin/env python3
"""Cek struktural artefak yang DIKOMIT (pola internal/assets/illustration/verify.mjs): manifest
dan atlas ada, baris manifest = petlib.ROWS, dimensi atlas = 8 kolom × N baris sel, hash rows/
cocok dengan manifest, ukuran ≤ anggaran, alpha ada. Dipanggil test dan pra-rilis."""
from __future__ import annotations

import json

from PIL import Image

from common import ASSETS, fail, load_petlib

petlib = load_petlib()


def main() -> None:
    atlas_path = ASSETS / "hnm-pet-anoman-atlas-v01.webp"
    manifest_path = ASSETS / "pet.json"
    problems: list[str] = []
    if not atlas_path.exists():
        fail("atlas tak ada")
    if not manifest_path.exists():
        fail("pet.json tak ada")
    m = json.loads(manifest_path.read_text())
    keys = [r["key"] for r in m.get("rows", [])]
    if keys != petlib.ROW_KEYS:
        problems.append(f"baris manifest {keys} ≠ {petlib.ROW_KEYS}")
    if m.get("cell") != {"w": petlib.CELL_W, "h": petlib.CELL_H} or m.get("columns") != petlib.COLUMNS:
        problems.append("sel/kolom manifest tak sesuai petlib")
    if m.get("character") != {"h": petlib.STAND_H}:
        problems.append("character.h manifest tak sesuai petlib")
    im = Image.open(atlas_path)
    if im.size != (petlib.CELL_W * petlib.COLUMNS, petlib.CELL_H * len(petlib.ROW_KEYS)):
        problems.append(f"dimensi atlas {im.size}")
    if im.mode not in ("RGBA", "LA", "P") and "transparency" not in im.info:
        problems.append(f"atlas tanpa alpha (mode {im.mode})")
    size = atlas_path.stat().st_size
    if size > petlib.ATLAS_BUDGET:
        problems.append(f"atlas {size} B > {petlib.ATLAS_BUDGET} B")
    for key in petlib.ROW_KEYS:
        p = ASSETS / "rows" / f"{key}.png"
        if not p.exists():
            problems.append(f"rows/{key}.png tak ada")
        elif m.get("sources", {}).get(key) != petlib.sha256(p):
            problems.append(f"rows/{key}.png berubah sejak atlas dirakit")
    if problems:
        fail("; ".join(problems))
    print(f"OK PET-001: {len(keys)} baris, {im.size[0]}×{im.size[1]}, {size} B")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Pastikan keduanya menolak keadaan sekarang (baris belum lengkap)**

Run: `python3 internal/scripts/pet/atlas.py; echo "exit=$?"`
Expected: `FAIL: baris belum ada: walk-right, walk-left, working, waiting, blocked, review, shipped, docs-updated, wave` lalu `exit=1`.

Run: `python3 internal/scripts/pet/verify.py; echo "exit=$?"`
Expected: `FAIL: atlas tak ada` lalu `exit=1`.

- [ ] **Step 3: Uji rakit dengan baris tiruan di direktori sementara (tak menyentuh repo)**

Run:
```bash
T=$(mktemp -d) && mkdir -p "$T/rows" && for k in idle walk-right walk-left working waiting blocked review shipped docs-updated wave; do cp internal/assets/pet/rows/idle.png "$T/rows/$k.png"; done
HANOMAN_PET_ASSETS="$T" python3 internal/scripts/pet/atlas.py && HANOMAN_PET_ASSETS="$T" python3 internal/scripts/pet/atlas.py --check && HANOMAN_PET_ASSETS="$T" python3 internal/scripts/pet/verify.py
```
Expected:
```
ditulis hnm-pet-anoman-atlas-v01.webp (6xxxxx B, 1536×2080) + pet.json
OK atlas segar, 6xxxxx B, 10 baris
OK PET-001: 10 baris, 1536×2080, 6xxxxx B
```
(≈ 630 KB untuk 10× idle; di bawah anggaran 1 000 000 B.)

- [ ] **Step 4: Commit**

```bash
git add internal/scripts/pet/atlas.py internal/scripts/pet/verify.py
git commit -m "feat(pet): atlas.py merakit atlas + manifest ber-hash; verify.py menjaga artefak yang dikomit"
```

---

### Task 4: `gen.py`, naskah prompt, dan README aset

**Files:**
- Create: `internal/scripts/pet/gen.py`
- Create: `internal/assets/pet/prompts/common.md`, `walk-right.md`, `walk-left.md`, `working.md`, `waiting.md`, `blocked.md`, `review.md`, `shipped.md`, `docs-updated.md`, `wave.md`
- Modify: `internal/assets/pet/prompts/idle.md` (ganti isi: hanya deskripsi baris; blok umum pindah ke `common.md`)
- Create: `internal/assets/pet/README.md`

**Interfaces:**
- Consumes: `common.ASSETS`, `common.fail`.
- Produces: `raw/<key>.png` (mentah, latar hijau) + `raw/<key>.log`; `gen.py <key> --print` mencetak perintah + prompt tanpa memanggil Codex.

- [ ] **Step 1: Tulis `gen.py`**

```python
#!/usr/bin/env python3
"""Spawn Codex (GPT Image) untuk satu baris: prompts/common.md + prompts/<key>.md + referensi
ref/anoman-pet-model.png & rows/idle.png → raw/<key>.png (mentah, latar hijau).

Keluaran `image_gen` Codex selalu mendarat di ~/.codex/generated_images/<sesi>/exec-*.png;
skrip ini mengambil PNG terbaru yang lahir sesudah perintah dimulai — bukan salinan Codex, karena
Codex cenderung men-despill sendiri (merusak emas/merah, terukur 2026-08-22).

pemakaian: gen.py <key> [--note "instruksi tambahan"] [--print]
  --print  cetak perintah + prompt tanpa menjalankan Codex."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from common import ASSETS, fail

GENERATED = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "generated_images"


def build_prompt(key: str, note: str | None) -> str:
    common = (ASSETS / "prompts" / "common.md").read_text()
    row = (ASSETS / "prompts" / f"{key}.md").read_text()
    extra = f"\n\nEXTRA NOTE FROM REVIEWER: {note}\n" if note else ""
    return f"{row}\n\n{common}{extra}"


def references(key: str) -> list[Path]:
    refs = [ASSETS / "ref" / "anoman-pet-model.png"]
    if key != "idle" and (ASSETS / "rows" / "idle.png").exists():
        refs.append(ASSETS / "rows" / "idle.png")
    return refs


def newest_png(since: float) -> Path | None:
    cands = [p for p in GENERATED.glob("*/exec-*.png") if p.stat().st_mtime >= since]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def main() -> None:
    args = sys.argv[1:]
    note = None
    if "--note" in args:
        i = args.index("--note")
        note = args[i + 1]
        del args[i:i + 2]
    dry = "--print" in args
    args = [a for a in args if a != "--print"]
    if len(args) != 1:
        fail('pemakaian: gen.py <key> [--note "…"] [--print]')
    key = args[0]
    if not (ASSETS / "prompts" / f"{key}.md").exists():
        fail(f"prompts/{key}.md tak ada")
    prompt = build_prompt(key, note)
    refs = references(key)
    for r in refs:
        if not r.exists():
            fail(f"referensi {r} tak ada")
    if shutil.which("codex") is None:
        fail("`codex` tak ditemukan di PATH — pipeline gen butuh Codex CLI dengan image generation")
    work = Path(tempfile.mkdtemp(prefix=f"hanoman-pet-{key}-"))
    cmd = ["codex", "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", str(work),
           "--add-dir", str(GENERATED)]
    for r in refs:
        cmd += ["-i", str(r)]
    cmd.append("-")
    if dry:
        print(" ".join(cmd))
        print("---")
        print(prompt)
        return
    (ASSETS / "raw").mkdir(exist_ok=True)
    log = ASSETS / "raw" / f"{key}.log"
    start = time.time()
    print(f"[{key}] codex exec … (log: raw/{key}.log)")
    with log.open("w") as out:
        proc = subprocess.run(cmd, input=prompt, text=True, stdout=out, stderr=subprocess.STDOUT, timeout=900)
    png = newest_png(start)
    if proc.returncode != 0 or png is None:
        fail(f"[{key}] codex keluar {proc.returncode}, PNG baru: {png} — lihat raw/{key}.log")
    dst = ASSETS / "raw" / f"{key}.png"
    shutil.copyfile(png, dst)
    print(f"[{key}] {png} → raw/{key}.png ({dst.stat().st_size} B, {time.time() - start:.0f}s)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Tulis naskah prompt**

`internal/assets/pet/prompts/common.md`:

```
SUBJECT: the attached character — Anoman (Hanoman) as a compact "desktop pet": Javanese wayang monkey hero in PROFILE with ONE visible eye — facing RIGHT unless this row says he has turned around — about 2.5 head units tall: large head with the tall golden jamang/crown ornament, big expressive single eye, curly white hair at the back of the head, small compact white-furred body, gold necklace/armbands, red-and-gold kain (sarong), barefoot, short legs, and a LONG curling tail with a golden ornament at the tip — the tail is the most expressive part and stays large. Keep EXACTLY this character, costume, colours and proportions as in the attached model sheet and idle strip. Never mirror him: a left-facing version is a NEW drawing of his other side, not a flipped copy.

STYLE: flat illustration with bold dark outlines, flat colours, minimal shading, clean edges, no texture, no gradients — identical to the attached references. Dignified wayang Anoman, not a generic cartoon monkey: no emoji face, no slapstick.

LAYOUT: landscape canvas 1536x1024. A 4-column x 2-row grid of 8 equal cells (384 x 512 px each). ONE full-body pose per cell, reading left-to-right then top-to-bottom = frames 1..8 of a looping animation. Draw the character about 75% of the cell height, horizontally centred in its cell, feet on the same baseline in every cell. Leave clear empty space between cells; never let a tail, hand or ornament cross into a neighbouring cell. No grid lines, borders, numbers, labels, text, shadows, ground or props other than those named for this row.

REGISTRATION (critical): treat the character as a puppet on a fixed pin. Unless this row says otherwise, in ALL 8 frames the feet, legs, sarong hem and lower torso are drawn at EXACTLY the same position and size — trace them identically. Only the parts named for this row move. Nothing else changes between frames.

BACKGROUND: flat, pure, uniform green #00FF00 over the whole canvas — no halo, no anti-aliased fringe, no gradient, no shadow. Do NOT remove the background, do NOT post-process, do NOT crop or resize: the pipeline keys the green out itself.

OUTPUT: use your image generation tool to produce exactly ONE image. Do not write code or create any files. Your final message must be the absolute path of the generated PNG (it lives under ~/.codex/generated_images/) and its pixel size. If the first generation breaks the grid (merged frames, drifting scale, wrong facing), generate once more with a stricter prompt and report the better one.
```

`internal/assets/pet/prompts/idle.md` (timpa isi lama):

```
ROW "idle" (8 frames, loops): a calm standing breathing cycle, clearly readable at 96 px.
frame 1 rest pose; frame 2 inhale: chest rises, head lifts ~4% and tilts up slightly, tail tip starts rising; frame 3 peak: head at its highest, raised hand lifts a little, tail tip clearly higher than frame 1; frame 4 blink at the peak: visible eye fully CLOSED, everything else as frame 3; frame 5 eye open, head starts lowering, tail tip swings back down; frame 6 mid settle; frame 7 slight overshoot: head a touch LOWER than rest, tail tip at its lowest; frame 8 back to the rest pose (equal to frame 1).
```

`internal/assets/pet/prompts/walk-right.md`:

```
ROW "walk-right" (8 frames, loops): a walking cycle moving to the RIGHT (the direction he faces). This row is the exception to the fixed-feet rule: the legs and feet MOVE. Frames 1-4: right leg steps forward (contact, down, passing, up), frames 5-8: left leg steps forward the same way, so frame 8 flows back into frame 1. Body bobs up and down by 2-3% with the steps, arms swing gently opposite to the legs, tail trails behind and sways with each step. Head stays level and facing right. Keep the character's horizontal position in the cell identical in every frame — he walks in place.
```

`internal/assets/pet/prompts/walk-left.md`:

```
ROW "walk-left" (8 frames, loops): the same walking cycle but moving to the LEFT — the character has TURNED AROUND and now faces LEFT in profile, showing the OTHER side of his head: draw the left-facing profile properly (the jamang/crown, ear, curly hair and the tail now hang on the RIGHT side of the body behind him). This is a new drawing of the same character, NOT a mirrored copy. This row is the exception to the fixed-feet rule: the legs and feet MOVE. Frames 1-4: near leg steps forward, frames 5-8: far leg steps forward, so frame 8 flows back into frame 1. Body bobs 2-3% with the steps, arms swing gently, tail trails behind (to the right) and sways. Keep the horizontal position identical in every frame — he walks in place.
```

`internal/assets/pet/prompts/working.md`:

```
ROW "working" (8 frames, loops): focused work at an invisible desk at hip height — typing / scanning. Feet, legs and sarong fixed. Both hands come forward at waist height and "type": hands alternate up/down every frame (frame 1 left hand up, frame 2 right hand up, and so on), small quick movements. Head leans slightly forward and down, eye narrowed in concentration, eyebrow focused; the head gives a tiny nod on frames 4 and 8. Tail stands upright behind him with the tip ticking left-right every two frames, like a metronome.
```

`internal/assets/pet/prompts/waiting.md`:

```
ROW "waiting" (8 frames, loops): he is asking the viewer a question and waiting for the answer. Feet, legs and sarong fixed. Body turned a little toward the viewer, head tilted, eye wide open and looking straight OUT at the viewer, one hand raised palm-up as if asking "well?". Frames 1-3: hand raised and held; frame 4: blink; frames 5-6: hand raised a bit higher, head tilts the other way, eyebrow up; frame 7: eye open wide again; frame 8: back to frame 1. Tail curls up high like a question mark, its tip wagging gently across the frames.
```

`internal/assets/pet/prompts/blocked.md`:

```
ROW "blocked" (8 frames, loops): something failed and he is stuck — heavy and deflated, but dignified (no tears, no smoke, no stars). Feet, legs and sarong fixed. Shoulders slumped, head hanging low and forward, eye half-closed looking down, eyebrow dropped, both arms hanging straight down. The tail droops to the ground behind him, its tip resting low. Very slow heavy breathing: frames 1-4 the chest sinks lower and the head drops a little more, frames 5-8 it rises back; on frame 6 the eye closes briefly. Almost no other motion.
```

`internal/assets/pet/prompts/review.md`:

```
ROW "review" (8 frames, loops): the work is done and he is inspecting it, attentive and curious. Feet, legs and sarong fixed. Body leans forward toward the right, head tilted, eye wide and scanning: frames 1-2 looking right, frames 3-4 looking slightly up-right with the eyebrow raised, frames 5-6 looking down-right, frame 7 blink, frame 8 back to frame 1. One hand rests on the chin or is raised to the mouth in a thinking gesture and shifts slightly with the gaze. Tail held up in a gentle curve, its tip nodding along with the head.
```

`internal/assets/pet/prompts/shipped.md`:

```
ROW "shipped" (8 frames, plays ONCE then returns to idle): a celebratory jump — the work shipped. This row is the exception to the fixed-feet rule: the whole body leaves the ground. Frame 1: standing rest pose exactly like the idle frame 1 (feet on the baseline). Frame 2: crouch, knees bent, arms back. Frame 3: push-off, body rising, arms swinging up. Frame 4: top of the jump, clearly in the air (feet well above the baseline), arms up high, mouth open in joy, tail flung up in a big flourish. Frame 5: still in the air starting to fall, arms still up. Frame 6: landing, knees bent, tail swinging down. Frame 7: straightening up with a proud chest. Frame 8: back to the standing rest pose (equal to frame 1). Keep the horizontal position identical — he jumps straight up.
```

`internal/assets/pet/prompts/docs-updated.md`:

```
ROW "docs-updated" (8 frames, loops): new documents were published — he carries knowledge. Feet, legs and sarong fixed. He holds a rolled palm-leaf manuscript (lontar) or scroll with both hands in front of his chest — this scroll is the only allowed prop. Frames 1-2: holding it, looking at the viewer; frames 3-5: he raises it slightly and tilts his head, eye bright, as if presenting it; frame 6: blink; frames 7-8: lowers it back to the frame-1 position. Tail held up proudly, tip swaying a little.
```

`internal/assets/pet/prompts/wave.md`:

```
ROW "wave" (8 frames, plays ONCE): a friendly greeting to the viewer when they hover or click. Feet, legs and sarong fixed. Frame 1: rest pose like idle frame 1. Frames 2-3: the far hand rises up beside the head, palm open toward the viewer, head turning a little toward the viewer with a warm expression. Frames 4-6: the raised hand waves left-right (frame 4 left, frame 5 right, frame 6 left), eye bright and friendly. Frame 7: hand coming down. Frame 8: back to the rest pose (equal to frame 1). Tail tip gives one happy flick on frames 4-5.
```

- [ ] **Step 3: Tulis README aset**

`internal/assets/pet/README.md`:

```markdown
# Pet Hanoman — atlas sprite PET-001

Satu atlas WebP 8 kolom × 10 baris (sel 192×208, karakter berdiri 168 px) + `pet.json`. Frame dibuat
Codex (GPT Image) dari `prompts/`, dipisah dan diregistrasi `internal/scripts/pet/`, dikomit sebagai
turunan (runner CI tak punya Codex). Spec: `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`;
ADR-0140.

## Isi

| path | apa | dikomit |
|---|---|---|
| `prompts/common.md` + `prompts/<key>.md` | naskah generasi; `common` = subjek/gaya/layout/registrasi/latar, `<key>` = 8 frame baris itu | ya |
| `ref/anoman-pet-model.png` | model sheet (frame 1 idle yang disetujui) — dilampirkan ke setiap generasi | ya |
| `rows/<key>.png` + `rows/<key>.report.json` | strip 8 frame 1536×208 terregistrasi + laporan registrasi | ya (master) |
| `hnm-pet-anoman-atlas-v01.webp` + `pet.json` | turunan; `sources` = hash `rows/` | ya |
| `qa/` | contact sheet, onion-skin, GIF per baris — bukti review manusia | ya |
| `raw/` | keluaran mentah Codex + keyed + log | tidak (`.gitignore`) |

## Regenerasi satu baris

```bash
python3 internal/scripts/pet/gen.py <key> [--note "catatan reviewer"]   # Codex → raw/<key>.png (±3 menit)
python3 internal/scripts/pet/key.py <key>                                # → raw/<key>.keyed.png
python3 internal/scripts/pet/register.py <key>                           # → rows/<key>.png + report
python3 internal/scripts/pet/qa.py <key>                                 # gerbang + qa/<key>.gif
python3 internal/scripts/pet/atlas.py                                    # rakit atlas + pet.json (semua baris)
python3 internal/scripts/pet/verify.py                                   # cek artefak yang dikomit
```

Gerbang `qa.py`: 8 sprite terdeteksi, tak ada sprite menyentuh tepi lembar, tumpahan sel 0 px, residu
pra-pin ≤ 0,15 (`stand`) / 0,30 (`walk`/`jump`). Bila gagal, ulangi `gen.py` dengan `--note` (mis.
"keep the feet identical in every frame", "do not let the tail cross into the next cell").

## Yang dikunci pengukuran (2026-08-22)

- Model tak menaati grid sel → sprite dideteksi dari celah transparan, bukan dipotong per grid.
- Jangkar kaki tertarik ujung ekor → kaki = run kolom paling kanan; registrasi + pin wilayah statis.
- Latar magenta + despill memotong merah (emas → olive) → latar hijau; key di pipeline, bukan oleh Codex.
- Karakter 192 px menumpahkan ekor ke sel tetangga → karakter berdiri 168 px (`character.h`).

## Review manusia (Gate 2 brand)

Lihat `qa/<key>.gif` dan `qa/<key>-contact.png` untuk setiap baris sebelum commit: siluet profil satu
mata, jamang, kain, ekor besar; tak ada mirror; gerak sesuai naskah. Band "pet" 80–128 px adalah
pengecualian resmi atas "no chibi inflation" (`internal/docs/brand/illustration/03-mascot-system.md`).
```

- [ ] **Step 4: Dry-run prompt**

Run: `python3 internal/scripts/pet/gen.py walk-left --print | head -3`
Expected: baris pertama perintah `codex exec --skip-git-repo-check -s workspace-write -C /var/folders/.../hanoman-pet-walk-left-... --add-dir /Users/<user>/.codex/generated_images -i .../ref/anoman-pet-model.png -i .../rows/idle.png -`, lalu `---`, lalu `ROW "walk-left" (8 frames, loops): …`.

- [ ] **Step 5: Commit**

```bash
git add internal/scripts/pet/gen.py internal/assets/pet/prompts internal/assets/pet/README.md
git commit -m "feat(pet): gen.py men-spawn Codex per baris; naskah prompt 10 baris; README aset"
```

---

### Task 5: Generasi 9 baris lewat Codex, review manusia, rakit atlas

**Files:**
- Create: `internal/assets/pet/rows/<key>.png` + `.report.json` untuk 9 baris, `internal/assets/pet/qa/<key>-*.png|.gif`
- Create: `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp`, `internal/assets/pet/pet.json`

**Interfaces:**
- Consumes: Task 2–4.
- Produces: atlas + manifest yang di-import Task 6 (`pet.json` harus memuat 10 baris, `character.h = 168`).

Prasyarat: `codex --version` ≥ 0.147 dan image generation aktif (`ls ~/.codex/generated_images` berisi keluaran sebelumnya). Satu generasi ±2–3 menit; jalankan beberapa baris paralel di shell terpisah bila mau.

Catatan: `raw/wave.png` sudah ada di worktree (dibuat saat plan divalidasi, 191 dtk, lulus gerbang dengan residu maks 0,113) — untuk `wave` lewati `gen.py` dan mulai dari `key.py`; `raw/idle.magenta.png` adalah sumber baris idle (Task 2).

- [ ] **Step 1: Generasi + key + register + qa per baris**

Untuk setiap `key` dalam `walk-right walk-left working waiting blocked review shipped docs-updated wave`:

```bash
K=<key>
python3 internal/scripts/pet/gen.py "$K" && python3 internal/scripts/pet/key.py "$K" \
  && python3 internal/scripts/pet/register.py "$K" && python3 internal/scripts/pet/qa.py "$K"
```
Expected per baris: `[<key>] … → raw/<key>.png (…B, ~190s)`, laporan 8 frame tanpa `TUMPAH=`, `OK <key>: 8 frame, residu maks … ≤ 0.15` (atau `≤ 0.3` untuk walk/shipped). Bila `FAIL`, baca pesannya lalu ulangi dengan catatan, mis.:
`python3 internal/scripts/pet/gen.py "$K" --note "Frames 3 and 4 merged into one drawing — keep every frame fully inside its own cell with clear empty space between cells."`

- [ ] **Step 2: Review manusia (Gate 2)**

Buka semua `internal/assets/pet/qa/*.gif` dan `qa/*-contact.png` (mis. `open internal/assets/pet/qa/`). Periksa tiap baris terhadap naskahnya: `walk-left` benar-benar profil kiri (jamang & ekor di sisi kanan badan), `shipped` melayang di frame 4, `docs-updated` memegang lontar, `blocked` tanpa slapstick. **Minta pemilik produk melihatnya** sebelum lanjut; baris yang ditolak diulang lewat Step 1 dengan `--note`.

- [ ] **Step 3: Rakit atlas dan verifikasi**

Run:
```bash
python3 internal/scripts/pet/atlas.py && python3 internal/scripts/pet/atlas.py --check && python3 internal/scripts/pet/verify.py
ls -la internal/assets/pet/hnm-pet-anoman-atlas-v01.webp
```
Expected: `ditulis hnm-pet-anoman-atlas-v01.webp (<1000000 B, 1536×2080) + pet.json`, `OK atlas segar …`, `OK PET-001: 10 baris, 1536×2080, … B`. Bila `FAIL: atlas … > anggaran`, turunkan `quality=82` di `atlas.py` menjadi 78 dan catat di commit.

- [ ] **Step 4: Commit**

```bash
git add internal/assets/pet/rows internal/assets/pet/qa internal/assets/pet/hnm-pet-anoman-atlas-v01.webp internal/assets/pet/pet.json
git commit -m "feat(pet): 10 baris sprite Anoman (proporsi pet) dari Codex + atlas PET-001 & manifest"
```

---

### Task 6: `pet-sprite.ts` — manifest, pose → baris, durasi

**Files:**
- Create: `src/src/screens/pet-sprite.ts`
- Test: `src/test/pet-sprite.test.ts`

**Interfaces:**
- Consumes: `internal/assets/pet/pet.json`, `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp` (Task 5); `PetPose` dari `pet-state.ts`.
- Produces: `PET_ROW_KEYS`, `type PetRowKey`, `type PetRow`, `type PetManifest`, `parsePetManifest(raw: unknown): PetManifest`, `PET_MANIFEST`, `PET_ATLAS_URL`, `POSE_ROW: Record<PetPose, PetRowKey>`, `rowOf(key)`, `rowIndex(key): number`, `durationMs(key): number`, `thenOf(key): PetRowKey | null`.

- [ ] **Step 1: Tulis test yang gagal**

`src/test/pet-sprite.test.ts` (bagian kontrak CSS di bawah `describe("CSS sprite pet …")` baru hijau di Task 8 — tak apa, tulis sekarang):

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PET_ATLAS_URL, PET_MANIFEST, PET_ROW_KEYS, POSE_ROW, durationMs, parsePetManifest, rowIndex, thenOf,
} from "../src/screens/pet-sprite";
import type { PetPose } from "../src/screens/pet-state";

const POSES: PetPose[] = ["ready", "working", "waiting", "blocked", "review", "shipped", "docs-updated"];

describe("manifest atlas pet (PET-001)", () => {
  it("pet.json yang dikomit lolos validasi dan barisnya berurutan", () => {
    expect(PET_MANIFEST.id).toBe("PET-001");
    expect(PET_MANIFEST.rows.map((r) => r.key)).toEqual([...PET_ROW_KEYS]);
    expect(PET_MANIFEST.cell).toEqual({ w: 192, h: 208 });
    expect(PET_MANIFEST.columns).toBe(8);
    expect(PET_MANIFEST.character.h).toBeLessThanOrEqual(PET_MANIFEST.cell.h);
    expect(PET_ATLAS_URL).toMatch(/\.webp$/);
  });

  it("indeks baris, durasi satu putaran, dan rantai then", () => {
    expect(rowIndex("idle")).toBe(0);
    expect(rowIndex("wave")).toBe(9);
    expect(durationMs("idle")).toBe(Math.round(8 / 6 * 1000));
    expect(durationMs("walk-right")).toBe(800);
    expect(thenOf("shipped")).toBe("idle");
    expect(thenOf("wave")).toBe("idle");
    expect(thenOf("idle")).toBeNull();
  });

  it("ketujuh pose punya baris, dan hanya ready yang berganti nama", () => {
    for (const pose of POSES) expect(PET_ROW_KEYS).toContain(POSE_ROW[pose]);
    expect(POSE_ROW.ready).toBe("idle");
    expect(POSES.filter((p) => POSE_ROW[p] !== p)).toEqual(["ready"]);
  });

  it("menolak manifest yang barisnya kurang, salah urutan, atau then pada baris loop", () => {
    const ok = JSON.parse(JSON.stringify(PET_MANIFEST)) as { rows: Record<string, unknown>[] };
    expect(() => parsePetManifest({ ...ok, rows: ok.rows.slice(1) })).toThrow(/butuh 10 baris/);
    const swapped = { ...ok, rows: [ok.rows[1], ok.rows[0], ...ok.rows.slice(2)] };
    expect(() => parsePetManifest(swapped)).toThrow(/rows\[0\]/);
    const badThen = { ...ok, rows: ok.rows.map((r, i) => (i === 0 ? { ...r, then: "wave" } : r)) };
    expect(() => parsePetManifest(badThen)).toThrow(/then hanya untuk/);
    const noThen = { ...ok, rows: ok.rows.map((r) => (r.key === "wave" ? { key: "wave", fps: 10, loop: false } : r)) };
    expect(() => parsePetManifest(noThen)).toThrow(/tanpa then/);
  });
});

// `import.meta.url` di bawah transform Vite bukan URL ber-skema `file:`, jadi berkasnya dicari
// dari cwd — yang berbeda antara run tingkat-paket (`src/`) dan tingkat-root.
function read(relative: string): string {
  const found = [resolve(process.cwd(), relative), resolve(process.cwd(), "src", relative)]
    .find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${relative} tak ketemu dari ${process.cwd()}`);
  return readFileSync(found, "utf8");
}

describe("CSS sprite pet (kontrak rule terparse)", () => {
  const style = document.createElement("style");
  style.textContent = read("src/app.css");
  document.head.append(style);
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const keyframes = rules.filter((rule): rule is CSSKeyframesRule =>
    rule.type === CSSRule.KEYFRAMES_RULE && (rule as CSSKeyframesRule).name.startsWith("hn-pet-"));

  it("hanya keyframe interaksi + frame sprite yang tersisa; katalog idle/pose SPEC-648 dicabut", () => {
    expect(keyframes.map((rule) => rule.name)).toEqual([
      "hn-pet-frames", "hn-pet-click", "hn-pet-panel-in", "hn-pet-panel-out", "hn-pet-reveal",
    ]);
  });

  it("setiap keyframe pet hanya mengubah transform/opacity", () => {
    for (const rule of keyframes) {
      for (const frame of [...rule.cssRules] as CSSKeyframeRule[]) {
        const properties = Array.from({ length: frame.style.length }, (_, i) => frame.style[i]!);
        expect(properties.length, `${rule.name} ${frame.keyText}`).toBeGreaterThan(0);
        expect(properties.every((p) => p === "transform" || p === "opacity"), `${rule.name} ${frame.keyText}`).toBe(true);
      }
    }
  });

  it("baris dipilih lewat --row pada .hn-pet-rowshift dan hover dikecualikan saat reduced-motion", () => {
    const styleRules = rules.filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE);
    const rowshift = styleRules.find((rule) => rule.selectorText === ".hn-pet-rowshift");
    expect(rowshift?.style.transform).toBe("translateY(calc(var(--row, 0) * -100%))");
    expect(styleRules.map((rule) => rule.selectorText)).toContain(
      '.hn-pet-stage:not([data-reduced-motion="true"]):hover .hn-pet-reactor');
    expect(styleRules.some((rule) => rule.selectorText === ".hn-sr-only")).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-sprite.test.ts`
Expected: FAIL — `Failed to resolve import "../src/screens/pet-sprite"`.

- [ ] **Step 3: Tulis modul**

`src/src/screens/pet-sprite.ts`:

```ts
/// <reference types="vite/client" />
// Pet hidup (spec A) · manifest atlas PET-001 dan pemetaan pose → baris. Atlas satu berkas WebP
// 8 kolom × N baris (sel 192×208); frontend memilih baris lewat `--row` dan frame lewat
// `steps(8)` atas `translateX(-100%)`, jadi yang dibutuhkan dari sini hanya indeks, durasi, dan
// rantai `then` untuk baris sekali-putar. Validasi ditulis tangan: `zod` tak bisa di-resolve dari
// paket `src` (hanya dependency `shared`).
import manifestJson from "../../../internal/assets/pet/pet.json";
import atlasUrl from "../../../internal/assets/pet/hnm-pet-anoman-atlas-v01.webp?url";
import type { PetPose } from "./pet-state";

export const PET_ROW_KEYS = [
  "idle", "walk-right", "walk-left", "working", "waiting", "blocked", "review", "shipped",
  "docs-updated", "wave",
] as const;
export type PetRowKey = typeof PET_ROW_KEYS[number];

export type PetRow = {
  key: PetRowKey;
  fps: number;
  loop: boolean;
  then?: PetRowKey;
  dir?: "right" | "left";
};

export type PetManifest = {
  id: string;
  version: number;
  cell: { w: number; h: number };
  columns: number;
  anchor: { x: number; baseline: number };
  character: { h: number };
  rows: PetRow[];
  sources: Record<string, string>;
};

const isRowKey = (v: unknown): v is PetRowKey => typeof v === "string" && (PET_ROW_KEYS as readonly string[]).includes(v);
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parsePetManifest(raw: unknown): PetManifest {
  const fail = (why: string): never => { throw new Error(`pet.json tidak sah: ${why}`); };
  if (!rec(raw)) return fail("bukan objek");
  const { id, version, cell, columns, anchor, character, rows, sources } = raw;
  if (typeof id !== "string" || !id) return fail("id");
  if (!posInt(version)) return fail("version");
  if (!rec(cell) || !posInt(cell.w) || !posInt(cell.h)) return fail("cell");
  if (!posInt(columns)) return fail("columns");
  if (!rec(anchor) || typeof anchor.x !== "number" || !(anchor.x > 0 && anchor.x < 1)
    || !posInt(anchor.baseline) || anchor.baseline > cell.h) return fail("anchor");
  if (!rec(character) || !posInt(character.h) || character.h > cell.h) return fail("character");
  if (!Array.isArray(rows) || rows.length !== PET_ROW_KEYS.length) return fail(`rows: butuh ${PET_ROW_KEYS.length} baris`);
  const parsed: PetRow[] = rows.map((r, i) => {
    const key = PET_ROW_KEYS[i]!;
    if (!rec(r) || r.key !== key) return fail(`rows[${i}]: harus "${key}"`);
    if (!posInt(r.fps)) return fail(`rows[${i}].fps`);
    if (typeof r.loop !== "boolean") return fail(`rows[${i}].loop`);
    const row: PetRow = { key, fps: r.fps, loop: r.loop };
    if (r.then !== undefined) {
      if (!isRowKey(r.then) || r.loop) return fail(`rows[${i}].then hanya untuk baris loop:false`);
      row.then = r.then;
    } else if (!r.loop) return fail(`rows[${i}] loop:false tanpa then`);
    if (r.dir !== undefined) {
      if (r.dir !== "right" && r.dir !== "left") return fail(`rows[${i}].dir`);
      row.dir = r.dir;
    }
    return row;
  });
  if (!rec(sources) || PET_ROW_KEYS.some((k) => typeof sources[k] !== "string")) return fail("sources");
  return {
    id, version, cell: { w: cell.w, h: cell.h }, columns,
    anchor: { x: anchor.x, baseline: anchor.baseline }, character: { h: character.h },
    rows: parsed, sources: sources as Record<string, string>,
  };
}

export const PET_MANIFEST: PetManifest = parsePetManifest(manifestJson);
export const PET_ATLAS_URL: string = atlasUrl;

// `ready` adalah satu-satunya pose yang namanya berbeda dari barisnya: pose lantai memutar idle.
export const POSE_ROW: Record<PetPose, PetRowKey> = {
  ready: "idle",
  working: "working",
  waiting: "waiting",
  blocked: "blocked",
  review: "review",
  shipped: "shipped",
  "docs-updated": "docs-updated",
};

export function rowOf(key: PetRowKey, manifest: PetManifest = PET_MANIFEST): PetRow {
  const row = manifest.rows.find((r) => r.key === key);
  if (!row) throw new Error(`baris ${key} tak ada di manifest`);
  return row;
}

export const rowIndex = (key: PetRowKey, manifest: PetManifest = PET_MANIFEST): number =>
  manifest.rows.findIndex((r) => r.key === key);

// Satu putaran = `columns` frame; `steps(columns)` membagi durasi ini rata per frame.
export const durationMs = (key: PetRowKey, manifest: PetManifest = PET_MANIFEST): number =>
  Math.round((manifest.columns / rowOf(key, manifest).fps) * 1000);

export const thenOf = (key: PetRowKey, manifest: PetManifest = PET_MANIFEST): PetRowKey | null =>
  rowOf(key, manifest).then ?? null;
```

- [ ] **Step 4: Jalankan test**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-sprite.test.ts`
Expected: 4 test manifest lulus; 3 test `CSS sprite pet` **gagal** (keyframe lama masih ada) — diselesaikan Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/pet-sprite.ts src/test/pet-sprite.test.ts
git commit -m "feat(pet): pet-sprite.ts — manifest PET-001 tervalidasi, pose→baris, durasi & rantai then"
```

---

### Task 7: `pet-walk.ts` — mesin berkeliaran murni

**Files:**
- Create: `src/src/screens/pet-walk.ts`
- Test: `src/test/pet-walk.test.ts`

**Interfaces:**
- Consumes: `POSE_ROW`, `PetRowKey` (Task 6); `PetPose`; `ResponsiveTier` dari `../ds/responsive`.
- Produces: `WALK_PX_PER_S = 40`, `STAND_MS = [4000, 12000]`, `WALK_MS = [2000, 6000]`, `LANE_MARGIN = 16`, `MIN_WALK_PX = 24`, `type PetFacing`, `type PetWalkMode = "stand" | "walk" | "home"`, `type PetWalkState = { x, facing, mode, until }`, `type PetWalkInput = { now, currentX, laneWidth, petWidth, pose, hovered, panelOpen, documentHidden, roam, reduced, tier }`, `type PetMove = { x, durationMs }`, `type PetWalkStep = { state, row, move }`, `homeX(laneWidth, petWidth)`, `clampX(x, laneWidth, petWidth)`, `anchored(input)`, `initialWalkState(laneWidth, petWidth, now)`, `stepWalk(state, input, rng)`.

- [ ] **Step 1: Tulis test tabel yang gagal**

`src/test/pet-walk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  LANE_MARGIN, MIN_WALK_PX, STAND_MS, WALK_MS, WALK_PX_PER_S, anchored, clampX, homeX, initialWalkState,
  stepWalk, type PetWalkInput, type PetWalkState,
} from "../src/screens/pet-walk";

const LANE = 1000;
const PET = 128;
const HOME = LANE - PET - LANE_MARGIN;

function input(over: Partial<PetWalkInput> = {}): PetWalkInput {
  return {
    now: 100_000, currentX: HOME, laneWidth: LANE, petWidth: PET, pose: "ready",
    hovered: false, panelOpen: false, documentHidden: false, roam: true, reduced: false, tier: "desktop",
    ...over,
  };
}
const standing = (x: number, until = Infinity, facing: "right" | "left" = "right"): PetWalkState =>
  ({ x, facing, mode: "stand", until });
const walking = (x: number, until: number, facing: "right" | "left" = "left"): PetWalkState =>
  ({ x, facing, mode: "walk", until });
// rng deterministik: urutan nilai yang ditentukan test.
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };

describe("mesin berkeliaran pet", () => {
  it("rumah = pojok kanan dikurangi margin, dan x selalu di-clamp ke jalur", () => {
    expect(homeX(LANE, PET)).toBe(HOME);
    expect(clampX(-50, LANE, PET)).toBe(LANE_MARGIN);
    expect(clampX(5000, LANE, PET)).toBe(HOME);
    expect(initialWalkState(LANE, PET, 0)).toEqual({ x: HOME, facing: "right", mode: "stand", until: STAND_MS[0] });
  });

  it.each([
    ["roam mati", { roam: false }],
    ["reduced-motion", { reduced: true }],
    ["tier mobile", { tier: "mobile" as const }],
  ])("terjangkar saat %s: di rumah, menghadap kanan, tanpa transisi", (_label, over) => {
    expect(anchored(input(over))).toBe(true);
    const step = stepWalk(walking(300, 200_000), input({ ...over, currentX: 420 }), seq(0.5));
    expect(step.state).toEqual(standing(HOME));
    expect(step.row).toBe("idle");
    expect(step.move).toEqual({ x: HOME, durationMs: 0 });
    // sudah di rumah & berdiri → tak ada perpindahan
    expect(stepWalk(standing(HOME), input(over), seq(0.5)).move).toBeNull();
  });

  it("jeda saat hover/panel/tab tersembunyi: berhenti di posisi aktual, baris pose", () => {
    for (const over of [{ hovered: true }, { panelOpen: true }, { documentHidden: true }]) {
      const step = stepWalk(walking(300, 200_000), input({ ...over, currentX: 412, pose: "working" }), seq(0.5));
      expect(step.state).toEqual(standing(412, Infinity, "left"));   // arah jalan dipertahankan
      expect(step.row).toBe("working");
      expect(step.move).toEqual({ x: 412, durationMs: 0 });
    }
    // sudah berdiri → jeda tak memindahkan apa pun
    expect(stepWalk(standing(412), input({ hovered: true, currentX: 412 }), seq(0.5)).move).toBeNull();
  });

  it("pose perhatian: pulang ke pojok kanan dengan baris jalan, lalu berdiri memutar pose", () => {
    const away = stepWalk(standing(300), input({ pose: "waiting", currentX: 300 }), seq(0.5));
    expect(away.state.mode).toBe("home");
    expect(away.state.facing).toBe("right");
    expect(away.row).toBe("walk-right");
    expect(away.move).toEqual({ x: HOME, durationMs: Math.round(((HOME - 300) / WALK_PX_PER_S) * 1000) });
    expect(away.state.until).toBe(100_000 + away.move!.durationMs);
    // di tengah jalan pulang: lanjut, tanpa perpindahan baru
    const mid = stepWalk(away.state, input({ pose: "waiting", currentX: 500, now: 101_000 }), seq(0.5));
    expect(mid.state).toBe(away.state);
    expect(mid.move).toBeNull();
    // tiba: berdiri di rumah, baris waiting
    const arrived = stepWalk(away.state, input({ pose: "blocked", currentX: HOME, now: 200_000 }), seq(0.5));
    expect(arrived.state).toEqual(standing(HOME));
    expect(arrived.row).toBe("blocked");
  });

  it("shipped berhenti di tempat dan memutar baris shipped", () => {
    const step = stepWalk(walking(300, 200_000), input({ pose: "shipped", currentX: 350 }), seq(0.5));
    expect(step.state).toEqual(standing(350, Infinity, "left"));
    expect(step.row).toBe("shipped");
    expect(step.move).toEqual({ x: 350, durationMs: 0 });
  });

  it("pose tenang: berdiri 4–12 dtk, lalu jalan 2–6 dtk @ 40 px/s ke arah acak di dalam jalur", () => {
    // berdiri sampai `until`; rng pertama (0.5) → jalan 4 dtk = 160 px; rng kedua (0.9) → ke kanan
    const wait = stepWalk(standing(500, 100_500), input({ currentX: 500 }), seq(0.5, 0.9));
    expect(wait.move).toBeNull();
    expect(wait.row).toBe("idle");
    const go = stepWalk(standing(500, 100_000), input({ currentX: 500 }), seq(0.5, 0.9));
    expect(go.row).toBe("walk-right");
    expect(go.move).toEqual({ x: 660, durationMs: 4000 });
    expect(go.state).toEqual({ x: 660, facing: "right", mode: "walk", until: 104_000 });
    // jalan sampai tiba, lalu berdiri STAND_MS[0]..[1] (rng 0 → 4 dtk)
    const onTheWay = stepWalk(go.state, input({ currentX: 600, now: 102_000 }), seq(0));
    expect(onTheWay.move).toBeNull();
    expect(onTheWay.row).toBe("walk-right");
    const arrived = stepWalk(go.state, input({ currentX: 660, now: 104_000 }), seq(0));
    expect(arrived.state).toEqual({ x: 660, facing: "right", mode: "stand", until: 104_000 + STAND_MS[0] });
    expect(arrived.row).toBe("idle");
  });

  it("di tepi jalur membalik arah; jalur yang terlalu sempit membuatnya diam", () => {
    // di rumah, rng arah 0.9 (kanan) → tak ada ruang → balik ke kiri sejauh 160 px
    const flip = stepWalk(standing(HOME, 100_000), input({ currentX: HOME }), seq(0.5, 0.9));
    expect(flip.row).toBe("walk-left");
    expect(flip.move).toEqual({ x: HOME - 160, durationMs: 4000 });
    // jalur selebar pet + 2 margin + sedikit: tak ada arah yang memberi ≥ MIN_WALK_PX
    const narrow = LANE_MARGIN * 2 + PET + MIN_WALK_PX - 1;
    const stuck = stepWalk(standing(LANE_MARGIN, 100_000), input({ laneWidth: narrow, currentX: LANE_MARGIN }), seq(0.5, 0.9));
    expect(stuck.move).toBeNull();
    expect(stuck.state.mode).toBe("stand");
    expect(stuck.state.until).toBeGreaterThan(100_000);
  });

  it("berdiri tanpa batas (sehabis jeda) mendapat jadwal baru saat jeda berakhir", () => {
    const step = stepWalk(standing(420), input({ currentX: 420 }), seq(0.25));
    expect(step.state).toEqual({ x: 420, facing: "right", mode: "stand", until: 100_000 + STAND_MS[0] + 0.25 * (STAND_MS[1] - STAND_MS[0]) });
    expect(step.move).toBeNull();
  });

  it("durasi jalan mengikuti jarak sebenarnya setelah clamp, bukan angka acak", () => {
    // rng: jalan 6 dtk (0.999… → ~240 px) ke kanan dari 700 → clamp ke HOME (856): 156 px = 3900 ms
    const step = stepWalk(standing(700, 100_000), input({ currentX: 700 }), seq(1 - 1e-9, 0.9));
    expect(step.move!.x).toBe(HOME);
    expect(step.move!.durationMs).toBe(Math.round(((HOME - 700) / WALK_PX_PER_S) * 1000));
    expect(WALK_MS[1] * WALK_PX_PER_S / 1000).toBe(240);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-walk.test.ts`
Expected: FAIL — `Failed to resolve import "../src/screens/pet-walk"`.

- [ ] **Step 3: Tulis modul**

`src/src/screens/pet-walk.ts`:

```ts
// Pet hidup (spec A) · mesin berkeliaran di tepi bawah. Murni: `stepWalk` menerima keadaan +
// masukan + rng dan mengembalikan keadaan baru, baris yang harus diputar, dan perpindahan yang harus
// dijalankan komponen (`translateX` + durasi transisi). Tak ada timer di sini — komponen menjadwalkan
// SATU timeout pada `state.until` dan memanggil ulang saat `transitionend`/masukan berubah.
import type { ResponsiveTier } from "../ds/responsive";
import type { PetPose } from "./pet-state";
import { POSE_ROW, type PetRowKey } from "./pet-sprite";

export const WALK_PX_PER_S = 40;
export const STAND_MS: readonly [number, number] = [4000, 12000];
export const WALK_MS: readonly [number, number] = [2000, 6000];
export const LANE_MARGIN = 16;
// Perpindahan lebih pendek dari ini bukan "jalan-jalan", cuma geser — arah dibalik atau diam.
export const MIN_WALK_PX = 24;

export type PetFacing = "right" | "left";
export type PetWalkMode = "stand" | "walk" | "home";
export type PetWalkState = {
  x: number;            // posisi tujuan/tempat berdiri (px dari kiri jalur)
  facing: PetFacing;
  mode: PetWalkMode;
  until: number;        // kapan keadaan ini selesai (ms epoch); Infinity = menunggu masukan
};
export type PetWalkInput = {
  now: number;
  currentX: number;     // posisi aktual (dibaca komponen saat transisi dipotong)
  laneWidth: number;
  petWidth: number;
  pose: PetPose;
  hovered: boolean;     // pointer hover ∨ fokus keyboard pada tombol
  panelOpen: boolean;
  documentHidden: boolean;
  roam: boolean;
  reduced: boolean;
  tier: ResponsiveTier;
};
export type PetMove = { x: number; durationMs: number };
export type PetWalkStep = { state: PetWalkState; row: PetRowKey; move: PetMove | null };
export type Rng = () => number;

const ATTENTION: ReadonlySet<PetPose> = new Set(["waiting", "blocked"]);
const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + rng() * (hi - lo);
const walkRow = (facing: PetFacing): PetRowKey => (facing === "right" ? "walk-right" : "walk-left");

export const homeX = (laneWidth: number, petWidth: number): number =>
  Math.max(LANE_MARGIN, laneWidth - petWidth - LANE_MARGIN);

export const clampX = (x: number, laneWidth: number, petWidth: number): number =>
  Math.min(Math.max(x, LANE_MARGIN), homeX(laneWidth, petWidth));

export const anchored = (input: Pick<PetWalkInput, "roam" | "reduced" | "tier">): boolean =>
  !input.roam || input.reduced || input.tier === "mobile";

export function initialWalkState(laneWidth: number, petWidth: number, now: number): PetWalkState {
  return { x: homeX(laneWidth, petWidth), facing: "right", mode: "stand", until: now + STAND_MS[0] };
}

export function stepWalk(state: PetWalkState, input: PetWalkInput, rng: Rng): PetWalkStep {
  const { now, laneWidth, petWidth, pose } = input;
  const home = homeX(laneWidth, petWidth);
  const poseRow = POSE_ROW[pose];
  const cur = clampX(input.currentX, laneWidth, petWidth);
  const moving = state.mode !== "stand";
  const stand = (x: number, until: number, facing: PetFacing = state.facing): PetWalkState =>
    ({ x, facing, mode: "stand", until });
  const cut = (x: number): PetMove | null => (moving || Math.abs(cur - x) > 0.5 ? { x, durationMs: 0 } : null);
  const walkTo = (to: number, mode: "walk" | "home"): PetWalkStep => {
    const durationMs = Math.round((Math.abs(to - cur) / WALK_PX_PER_S) * 1000);
    const facing: PetFacing = to >= cur ? "right" : "left";
    return { state: { x: to, facing, mode, until: now + durationMs }, row: walkRow(facing), move: { x: to, durationMs } };
  };

  // 1 · terjangkar (mobile / reduced / roam mati): rumah, menghadap kanan, tanpa transisi.
  if (anchored(input)) return { state: stand(home, Infinity, "right"), row: poseRow, move: cut(home) };

  // 2 · jeda: hover, panel terbuka, tab tersembunyi — berhenti di tempat.
  if (input.hovered || input.panelOpen || input.documentHidden)
    return { state: stand(cur, Infinity), row: poseRow, move: moving ? { x: cur, durationMs: 0 } : null };

  // 3 · pose perhatian: pulang ke pojok kanan dulu, lalu berdiri memutar baris pose.
  if (ATTENTION.has(pose)) {
    if (Math.abs(cur - home) > 1) {
      if (state.mode === "home" && now < state.until) return { state, row: walkRow(state.facing), move: null };
      return walkTo(home, "home");
    }
    return { state: stand(home, Infinity, "right"), row: poseRow, move: moving ? { x: home, durationMs: 0 } : null };
  }

  // 4 · shipped: berhenti di tempat; baris sekali-putarnya diurus komponen.
  if (pose === "shipped")
    return { state: stand(cur, Infinity), row: poseRow, move: moving ? { x: cur, durationMs: 0 } : null };

  // 5 · pose tenang: bergantian berdiri / jalan.
  if (moving) {
    if (now < state.until) return { state, row: walkRow(state.facing), move: null };
    return { state: stand(state.x, now + between(rng, STAND_MS)), row: poseRow, move: null };   // tiba
  }
  if (state.until === Infinity) return { state: stand(cur, now + between(rng, STAND_MS)), row: poseRow, move: null };
  if (now < state.until) return { state, row: poseRow, move: null };

  const dist = (between(rng, WALK_MS) * WALK_PX_PER_S) / 1000;
  let dir = rng() < 0.5 ? -1 : 1;
  let target = clampX(cur + dir * dist, laneWidth, petWidth);
  if (Math.abs(target - cur) < MIN_WALK_PX) {
    dir = -dir;
    target = clampX(cur + dir * dist, laneWidth, petWidth);
  }
  if (Math.abs(target - cur) < MIN_WALK_PX)   // jalur terlalu sempit untuk jalan-jalan
    return { state: stand(cur, now + between(rng, STAND_MS)), row: poseRow, move: null };
  return walkTo(target, "walk");
}
```

- [ ] **Step 4: Jalankan test**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-walk.test.ts`
Expected: `Tests  11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/pet-walk.ts src/test/pet-walk.test.ts
git commit -m "feat(pet): pet-walk.ts — mesin berkeliaran murni: berdiri/jalan, pulang saat perhatian, jeda, jangkar"
```

---

### Task 8: Preferensi roam, CSS sprite, cabut katalog motion SPEC-648

**Files:**
- Modify: `src/src/screens/pet-state.ts` (cabut `POSE_ART`; + `PET_ROAM_KEY`, `loadPetRoam`, `savePetRoam`)
- Modify: `src/src/app.css:594-657` (cabut keyframe idle/pose/celebrate; + `.hn-pet-rowshift`, `@keyframes hn-pet-frames`, `.hn-sr-only`)
- Modify: `src/src/ds/tokens/effects.css:35-40` (cabut `--dur-pet-*`)
- Delete: `src/src/screens/pet-motion.ts`, `src/test/pet-motion.test.ts`
- Modify: `src/test/pet-state.test.ts`, `src/test/pet-mount.test.tsx`

**Interfaces:**
- Produces: `PET_ROAM_KEY = "hanoman.pet.roam"`, `loadPetRoam(): boolean` (default `true`), `savePetRoam(roam: boolean)`; kelas CSS `.hn-pet-rowshift`, `.hn-sr-only`; keyframe `hn-pet-frames`.

- [ ] **Step 1: Perbarui test `pet-state` dan `pet-mount` (gagal dulu)**

Di `src/test/pet-state.test.ts` ganti import baris 4 dan blok `describe("POSE_ART", …)` di akhir berkas:

```ts
import { derivePetState, PET_TRANSIENT_MS, loadPetRoam, savePetRoam, type PetInput } from "../src/screens/pet-state";
```

```ts
describe("preferensi berkeliaran", () => {
  it("default berkeliaran; pilihan tersimpan di hanoman.pet.roam dan terbaca kembali", () => {
    localStorage.clear();
    expect(loadPetRoam()).toBe(true);
    savePetRoam(false);
    expect(localStorage.getItem("hanoman.pet.roam")).toBe("0");
    expect(loadPetRoam()).toBe(false);
    savePetRoam(true);
    expect(loadPetRoam()).toBe(true);
  });
});
```

Di `src/test/pet-mount.test.tsx` ganti test `"memanggil artwork lewat ID katalog, bukan filename"` dengan:

```ts
  it("artwork pet datang dari atlas PET-001 lewat manifest, bukan sticker STK per pose", () => {
    const petState = read("src/screens/pet-state.ts");
    expect(petState).not.toContain(".webp");
    expect(petState).not.toMatch(/STK-00\d/);
    const sprite = read("src/screens/pet-sprite.ts");
    expect(sprite).toContain('from "../../../internal/assets/pet/pet.json"');
    expect(sprite).toContain('from "../../../internal/assets/pet/hnm-pet-anoman-atlas-v01.webp?url"');
    expect(read("src/screens/HanomanPet.tsx")).not.toContain("StickerIllustration");
  });
```

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-state.test.ts src/test/pet-mount.test.tsx`
Expected: FAIL — `loadPetRoam is not a function` / `expected … not to match /STK-00\d/`.

- [ ] **Step 2: Ubah `pet-state.ts`**

Hapus import `StickerIllustrationId` (baris 9) dan seluruh blok `POSE_ART` (baris 14–23), ganti dengan komentar:

```ts
// Artwork pose hidup di atlas sprite PET-001 (`pet-sprite.ts`, spec Pet hidup A); sticker STK-*
// tak lagi dipakai pet.
```

Setelah `export const PET_HIDDEN_KEY = "hanoman.pet.hidden";` tambahkan:

```ts
// Pet hidup A · berkeliaran di tepi bawah (desktop/tablet). "1" = berkeliaran (default), "0" = diam
// di pojok. Tier mobile mengabaikannya: selalu diam (SPEC-763, tap nyasar).
export const PET_ROAM_KEY = "hanoman.pet.roam";
```

Di akhir berkas tambahkan:

```ts
export function loadPetRoam(): boolean {
  try { return localStorage.getItem(PET_ROAM_KEY) !== "0"; } catch { return true; }
}

export function savePetRoam(roam: boolean): void {
  try { localStorage.setItem(PET_ROAM_KEY, roam ? "1" : "0"); } catch { /* mode privat / kuota penuh */ }
}
```

- [ ] **Step 3: Ubah CSS**

Di `src/src/app.css` ganti komentar blok SPEC-648 (baris 597–598) menjadi:

```css
/* SPEC-648 · tiap transform punya layer sendiri agar hover, click, reveal, dan frame sprite dapat
   berjalan bersamaan. Seluruh keyframe hanya transform/opacity → compositor. */
```

Hapus seluruh `@keyframes hn-pet-idle-ready` … `@keyframes hn-pet-pose-out` (baris 606–657, sembilan blok) dan ganti dengan:

```css
/* Pet hidup (spec A) · satu <img> atlas: baris dipilih --row pada pembungkus (persen dari
   tinggi satu sel), frame oleh steps(8) atas translateX(-100%) (lebar img = 8 sel). */
.hn-pet-rowshift { transform: translateY(calc(var(--row, 0) * -100%)); }
@keyframes hn-pet-frames { to { transform: translateX(-100%); } }
.hn-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
```

`hn-pet-click`, `hn-pet-panel-in`, `hn-pet-panel-out`, `hn-pet-reveal` dan `.hn-pet-reactor` + selector hover **tetap**.

Di `src/src/ds/tokens/effects.css` hapus enam baris `--dur-pet-*` beserta komentarnya (baris 35–40).

- [ ] **Step 4: Cabut katalog motion**

Run: `git rm -q src/src/screens/pet-motion.ts src/test/pet-motion.test.ts`

- [ ] **Step 5: Jalankan test**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-state.test.ts src/test/pet-mount.test.tsx src/test/pet-sprite.test.ts`
Expected: `pet-state` & `pet-sprite` (7/7, termasuk kontrak CSS) lulus; `pet-mount` masih gagal pada `HanomanPet.tsx … StickerIllustration` — diselesaikan Task 9. `grep -rn "dur-pet\|hn-pet-idle\|POSE_ART\|pet-motion" src/src src/test` harus kosong.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/pet-state.ts src/src/app.css src/src/ds/tokens/effects.css src/test/pet-state.test.ts src/test/pet-mount.test.tsx
git commit -m "refactor(pet): preferensi roam; CSS sprite (rowshift, hn-pet-frames, sr-only); cabut katalog motion SPEC-648"
```

---

### Task 9: `HanomanPet.tsx` — renderer sprite, actor, panel berjangkar, toggle roam

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx` (tulis ulang seluruh berkas)
- Test: `src/test/hanoman-pet.test.tsx` (tulis ulang seluruh berkas)

**Interfaces:**
- Consumes: Task 6–8; `useResponsiveTier` dari `../ds`; `NotificationsContext` (test).
- Produces: komponen `HanomanPet({ sessions, backlog, onOpen })` dengan `data-testid` `pet-root, pet-actor (data-facing, data-mode), pet-stage, pet-status, pet-reactor, pet-viewport, pet-rowshift (data-row, --row), pet-atlas, pet-hit, pet-panel`; tombol panel `Buka Terminal|Buka Backlog`, `Diam di pojok|Berkeliaran` (bukan di mobile), `Sembunyikan`; pegangan `Tampilkan pet Hanoman`.

- [ ] **Step 1: Tulis ulang test komponen (gagal dulu)**

`src/test/hanoman-pet.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../src/api/client";
import { HanomanPet } from "../src/screens/HanomanPet";
import { NotificationsContext } from "../src/notifications/NotificationsContext";
import { PET_HIDDEN_KEY, PET_ROAM_KEY } from "../src/screens/pet-state";
import { PET_MANIFEST, durationMs, rowIndex } from "../src/screens/pet-sprite";
import { LANE_MARGIN, homeX } from "../src/screens/pet-walk";
import { MOBILE_QUERY } from "../src/ds/responsive";

function spec(over: Partial<Spec> & { id: string }): Spec {
  return {
    projectId: "hanoman", title: `judul ${over.id}`, source: "brief", stage: "spec-ready",
    priority: "sedang", author: "op", objective: "", payload: null, branchFrom: null,
    baseSha: null, createdAt: "2026-08-01T00:00:00.000Z", startedAt: null,
    dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [], ...over,
  } as Spec;
}

function session(over: Partial<TerminalSession> & { id: string }): TerminalSession {
  return { projectId: "hanoman", cwd: "/tmp", exited: false, ...over };
}

// `matches` per query: reduced-motion dan tier dibaca dari matchMedia yang sama.
function mockMatchMedia(matching: (query: string) => boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: matching(query), media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}
const REDUCED = "(prefers-reduced-motion: reduce)";

const styleOf = (el: HTMLElement): string => el.getAttribute("style") ?? "";
const hit = () => screen.getByRole("button", { name: "Ringkasan status Hanoman" });
const atlas = () => screen.getByTestId("pet-atlas");
const rowshift = () => screen.getByTestId("pet-rowshift");

function animationEnd(element: HTMLElement, animationName: string): void {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(element, event);
}

// Skala desktop: karakter 112 px dari character.h manifest.
const SCALE = 112 / PET_MANIFEST.character.h;
const CELL_W = Math.round(PET_MANIFEST.cell.w * SCALE);
const CELL_H = Math.round(PET_MANIFEST.cell.h * SCALE);
const HOME = homeX(window.innerWidth, CELL_W);

beforeEach(() => { localStorage.clear(); mockMatchMedia(() => false); });

describe("HanomanPet (sprite)", () => {
  it("merender satu img atlas di viewport sel, baris dipilih --row, frame oleh steps(8)", () => {
    render(<HanomanPet sessions={[]} backlog={[spec({ id: "SPEC-1" })]} onOpen={vi.fn()} />);

    expect(screen.getByTestId("pet-viewport")).toHaveStyle({ overflow: "hidden", width: `${CELL_W}px`, height: `${CELL_H}px` });
    expect(rowshift()).toHaveClass("hn-pet-rowshift");
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    expect(styleOf(rowshift())).toContain(`--row: ${rowIndex("idle")}`);
    const img = atlas();
    expect(img.getAttribute("src")).toMatch(/\.webp$/);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
    expect(img).toHaveStyle({
      width: `${CELL_W * PET_MANIFEST.columns}px`,
      height: `${CELL_H * PET_MANIFEST.rows.length}px`,
      animation: `hn-pet-frames ${durationMs("idle")}ms steps(8, end) infinite`,
    });
  });

  it("kalimat status hidup di span visually-hidden di dalam region status, bukan di alt", () => {
    render(<HanomanPet sessions={[]} backlog={[spec({ id: "SPEC-1" })]} onOpen={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    const text = screen.getByTestId("pet-status");
    expect(status).toContainElement(text);
    expect(text).toHaveClass("hn-sr-only");
    expect(text.textContent).toBe("Hanoman siap · 1 backlog siap dikerjakan");
  });

  it("berpindah baris saat sesi hidup muncul dan memperbarui kalimat status", () => {
    const backlog = [spec({ id: "SPEC-1", stage: "executing" })];
    const { rerender } = render(<HanomanPet sessions={[]} backlog={backlog} onOpen={vi.fn()} />);
    rerender(<HanomanPet sessions={[session({ id: "spec-1", specId: "SPEC-1" })]}
      backlog={backlog} onOpen={vi.fn()} />);

    expect(rowshift()).toHaveAttribute("data-row", "working");
    expect(styleOf(rowshift())).toContain(`--row: ${rowIndex("working")}`);
    expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("working")}ms steps(8, end) infinite` });
    expect(screen.getByTestId("pet-status").textContent).toContain("sedang berjalan");
  });

  it("klik memutar wave sekali lalu kembali ke baris pose lewat animationend", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());

    expect(rowshift()).toHaveAttribute("data-row", "wave");
    expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("wave")}ms steps(8, end) 1 forwards` });
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "hn-pet-click var(--dur-slow) var(--ease-out) both" });

    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    animationEnd(screen.getByTestId("pet-reactor"), "hn-pet-click");
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "none" });
  });

  it("shipped main sekali (1 forwards) lalu idle sampai pose berganti", () => {
    const backlog = [spec({ id: "SPEC-9", stage: "done" })];
    const fresh: Notification = {
      id: "n1", type: "done", specId: "SPEC-9", sessionId: null, title: "judul SPEC-9",
      projectId: "hanoman", createdAt: new Date().toISOString(), readAt: null,
    };
    render(
      <NotificationsContext.Provider value={{ items: [fresh], unread: 1, total: 1, markAllRead: () => {}, clear: () => {} }}>
        <HanomanPet sessions={[]} backlog={backlog} onOpen={vi.fn()} />
      </NotificationsContext.Provider>,
    );
    expect(rowshift()).toHaveAttribute("data-row", "shipped");
    expect(atlas()).toHaveStyle({ animation: `hn-pet-frames ${durationMs("shipped")}ms steps(8, end) 1 forwards` });
    animationEnd(atlas(), "hn-pet-frames");
    expect(rowshift()).toHaveAttribute("data-row", "idle");
    expect(screen.getByTestId("pet-status").textContent).toContain("baru saja selesai");   // pose tetap shipped
  });

  it("menganimasi panel masuk dan keluar, dijangkar & di-clamp di atas pet", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());

    const panel = screen.getByTestId("pet-panel");
    expect(panel).toHaveStyle({
      animation: "hn-pet-panel-in var(--dur-slow) var(--ease-out) both",
      bottom: `${CELL_H + 10}px`, width: "268px",
      maxWidth: "calc(100vw - var(--safe-left) - var(--safe-right) - 24px)",
      maxHeight: "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 120px)",
    });
    // jsdom: rect nol → pusat dari posisi keadaan (rumah) → di-clamp ke tepi kanan viewport
    const center = HOME + PET_MANIFEST.anchor.x * CELL_W;
    const expected = Math.round(Math.min(Math.max(center - 134, 12), window.innerWidth - 268 - 12));
    expect(panel).toHaveStyle({ left: `${expected}px` });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveStyle({ pointerEvents: "none", animation: "hn-pet-panel-out var(--dur-slow) var(--ease-out) both" });
    animationEnd(panel, "hn-pet-panel-out");
    expect(screen.queryByTestId("pet-panel")).toBeNull();
  });

  it("mematikan seluruh gerak saat prefers-reduced-motion: reduce dan diam di rumah", () => {
    mockMatchMedia((q) => q === REDUCED);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);

    expect(screen.getByTestId("pet-stage")).toHaveStyle({ animation: "none" });
    expect(screen.getByTestId("pet-reactor")).toHaveStyle({ animation: "none", transition: "none" });
    expect(atlas()).toHaveStyle({ animation: "none" });
    const actor = screen.getByTestId("pet-actor");
    expect(actor).toHaveStyle({ transition: "none", transform: `translateX(${HOME}px)` });
    expect(actor).toHaveAttribute("data-mode", "stand");

    fireEvent.click(hit());
    expect(rowshift()).toHaveAttribute("data-row", "idle");          // tanpa wave
    expect(screen.getByTestId("pet-panel")).toHaveStyle({ animation: "none" });
    expect(screen.getByRole("button", { name: "Buka Backlog" })).toHaveStyle({ transition: "none", transform: "none" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("pet-panel")).toBeNull();
  });

  it("membuka ringkasan berisi headline, detail, dan tautan ke tempat kejadian", () => {
    const onOpen = vi.fn();
    render(<HanomanPet backlog={[spec({ id: "SPEC-1", stage: "executing" })]}
      sessions={[session({ id: "spec-1", specId: "SPEC-1" })]} onOpen={onOpen} />);

    expect(hit().getAttribute("title")).toContain("SPEC-1 · sedang berjalan");
    fireEvent.click(hit());
    expect(screen.getByText("SPEC-1 · sedang berjalan")).toBeInTheDocument();
    expect(screen.getByText("judul SPEC-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buka Terminal" }));
    expect(onOpen).toHaveBeenCalledWith({ section: "terminal", sessionId: "spec-1" });
  });

  it("menyembunyikan pet, menyimpan pilihannya, dan tetap bisa dipanggil kembali", () => {
    const { unmount } = render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    fireEvent.click(screen.getByRole("button", { name: "Sembunyikan" }));

    expect(screen.queryByTestId("pet-atlas")).toBeNull();
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("1");
    expect(screen.getByRole("button", { name: "Tampilkan pet Hanoman" })).toHaveStyle({ width: "44px", height: "44px" });
    unmount();

    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("pet-atlas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan pet Hanoman" }));
    expect(atlas()).toBeInTheDocument();
    expect(screen.getByTestId("pet-stage")).toHaveStyle({ animation: "hn-pet-reveal var(--dur-slow) var(--ease-out) both" });
    expect(localStorage.getItem(PET_HIDDEN_KEY)).toBe("0");
  });

  it("toggle berkeliaran bertahan lintas remount dan menjangkarkan pet ke rumah", () => {
    const { unmount } = render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    fireEvent.click(screen.getByRole("button", { name: "Diam di pojok" }));
    expect(localStorage.getItem(PET_ROAM_KEY)).toBe("0");
    expect(screen.getByTestId("pet-actor")).toHaveStyle({ transform: `translateX(${HOME}px)` });
    unmount();

    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    fireEvent.click(hit());
    expect(screen.getByRole("button", { name: "Berkeliaran" })).toBeInTheDocument();
  });

  it("di tier mobile pet 96 px, selalu diam di pojok, dan toggle berkeliaran disembunyikan", () => {
    mockMatchMedia((q) => q === MOBILE_QUERY);
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    const scale = 96 / PET_MANIFEST.character.h;
    const cellW = Math.round(PET_MANIFEST.cell.w * scale);
    expect(screen.getByTestId("pet-viewport")).toHaveStyle({ width: `${cellW}px` });
    expect(screen.getByTestId("pet-actor")).toHaveStyle({ transform: `translateX(${homeX(window.innerWidth, cellW)}px)` });
    fireEvent.click(hit());
    expect(screen.queryByRole("button", { name: "Diam di pojok" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Berkeliaran" })).toBeNull();
  });

  it("berjalan di jalur saat jadwal berdiri habis: transisi transform linear ke target", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(0.5);   // jalan 4 dtk = 160 px; arah: 0.5 → kanan → balik kiri dari rumah
      render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
      const actor = screen.getByTestId("pet-actor");
      expect(actor).toHaveAttribute("data-mode", "stand");
      act(() => { vi.advanceTimersByTime(4_100); });     // STAND_MS[0] = 4 dtk
      expect(actor).toHaveAttribute("data-mode", "walk");
      expect(actor).toHaveAttribute("data-facing", "left");
      expect(actor).toHaveStyle({ transform: `translateX(${HOME - 160}px)`, transition: "transform 4000ms linear" });
      expect(rowshift()).toHaveAttribute("data-row", "walk-left");
      // tiba (transitionend) → berdiri di target, baris pose
      const end = new Event("transitionend", { bubbles: true });
      Object.defineProperty(end, "propertyName", { value: "transform" });
      act(() => { vi.advanceTimersByTime(4_000); fireEvent(actor, end); });
      expect(actor).toHaveAttribute("data-mode", "stand");
      expect(rowshift()).toHaveAttribute("data-row", "idle");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("tidak menangkap klik di area kosong jalur; hanya tombol 44 px di kaki", () => {
    render(<HanomanPet sessions={[]} backlog={[]} onOpen={vi.fn()} />);
    expect(screen.getByTestId("pet-root")).toHaveStyle({ pointerEvents: "none", left: "0px", right: "0px", bottom: "max(0px, var(--safe-bottom))" });
    expect(hit()).toHaveStyle({
      pointerEvents: "auto", width: "44px", height: "44px", bottom: "0px",
      left: `${Math.round(PET_MANIFEST.anchor.x * CELL_W - 22)}px`,
    });
    expect(LANE_MARGIN).toBe(16);
  });
});
```

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: FAIL (komponen lama masih merender `StickerIllustration`, tak ada `pet-atlas`).

- [ ] **Step 2: Tulis ulang komponen**

`src/src/screens/HanomanPet.tsx`:

```tsx
import React from "react";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";
import { Button, Mark, useResponsiveTier } from "../ds";
import { useNotifications } from "../notifications/NotificationsContext";
import {
  derivePetState, loadPetHidden, loadPetRoam, savePetHidden, savePetRoam,
  POSE_LABEL, type PetTarget,
} from "./pet-state";
import {
  PET_ATLAS_URL, PET_MANIFEST, POSE_ROW, durationMs, rowIndex, rowOf, thenOf, type PetRowKey,
} from "./pet-sprite";
import { initialWalkState, stepWalk, type PetMove, type PetWalkState } from "./pet-walk";

// Tinggi karakter berdiri di layar (band "pet" 80–128 px, amandemen sistem maskot). Skala sel
// diturunkan dari `character.h` manifest, bukan dari tinggi sel — sel menyisakan ruang ekor/lompat.
const PET_HEIGHT: Record<"mobile" | "tablet" | "desktop", number> = { mobile: 96, tablet: 112, desktop: 112 };
// SPEC-763 · hanya 44×44 px di kaki yang menangkap tap; sisa panggung cuma seni.
const HIT = 44;
const PANEL_W = 268;
const PANEL_GAP = 10;
const PANEL_EDGE = 12;

// jsdom tak punya matchMedia; ketiadaannya dibaca sebagai "tak ada preferensi", bukan "reduce".
function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = React.useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia(query).matches);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = React.useState(() => typeof document !== "undefined" && document.hidden);
  React.useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

// Lebar jalur = lebar viewport; dibaca saat mount dan resize (debounce), bukan per frame.
function useLaneWidth(): number {
  const [width, setWidth] = React.useState(() => (typeof window !== "undefined" ? window.innerWidth : 1024));
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => { clearTimeout(t); t = setTimeout(() => setWidth(window.innerWidth), 150); };
    window.addEventListener("resize", on);
    return () => { clearTimeout(t); window.removeEventListener("resize", on); };
  }, []);
  return width;
}

export function HanomanPet({ sessions, backlog, onOpen }:
  { sessions: TerminalSession[]; backlog: Spec[]; onOpen: (target: PetTarget) => void }) {
  const { items } = useNotifications();
  const [hidden, setHidden] = React.useState(loadPetHidden);
  const [roam, setRoam] = React.useState(loadPetRoam);
  const [open, setOpen] = React.useState(false);
  const [panelMounted, setPanelMounted] = React.useState(false);
  const [panelLeft, setPanelLeft] = React.useState(PANEL_EDGE);
  const [reacting, setReacting] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  // Dinaikkan HANYA oleh peluruhan keadaan transient — satu-satunya perubahan pose yang tak dibawa
  // data baru. Bukan denyut: tak ada interval, hanya satu timeout tepat pada waktunya.
  const [decay, setDecay] = React.useState(0);
  const reduced = usePrefersReducedMotion();
  const tier = useResponsiveTier();
  const documentHidden = useDocumentHidden();
  const laneWidth = useLaneWidth();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const actorRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const view = React.useMemo(
    () => derivePetState({ sessions, backlog, notifications: items, now: Date.now() }),
    [sessions, backlog, items, decay]);

  React.useEffect(() => {
    if (view.transientUntil === null) return;
    const t = setTimeout(() => setDecay((n) => n + 1), Math.max(0, view.transientUntil - Date.now()));
    return () => clearTimeout(t);
  }, [view.transientUntil]);

  // ---- geometri sprite
  const { cell, columns, anchor, character, rows } = PET_MANIFEST;
  const scale = PET_HEIGHT[tier] / character.h;
  const cellW = Math.round(cell.w * scale);
  const cellH = Math.round(cell.h * scale);

  // ---- mesin berkeliaran: keadaan di ref (dibaca handler), cermin di state (memicu render).
  const walkRef = React.useRef<PetWalkState>(initialWalkState(laneWidth, cellW, Date.now()));
  const [walk, setWalk] = React.useState<PetWalkState>(walkRef.current);
  const [row, setRow] = React.useState<PetRowKey>(POSE_ROW[view.pose]);
  const [move, setMove] = React.useState<PetMove>({ x: walkRef.current.x, durationMs: 0 });

  // Posisi aktual hanya dibaca pada peristiwa (potong/jeda), bukan per frame; jsdom memberi rect
  // nol → pakai posisi keadaan.
  const currentX = React.useCallback((): number => {
    const actor = actorRef.current?.getBoundingClientRect();
    const root = rootRef.current?.getBoundingClientRect();
    return actor && root && actor.width > 0 ? actor.left - root.left : walkRef.current.x;
  }, []);

  const tick = React.useCallback(() => {
    const step = stepWalk(walkRef.current, {
      now: Date.now(), currentX: currentX(), laneWidth, petWidth: cellW, pose: view.pose,
      hovered, panelOpen: open, documentHidden, roam, reduced, tier,
    }, Math.random);
    walkRef.current = step.state;
    setWalk(step.state);
    setRow(step.row);
    if (step.move) setMove(step.move);
  }, [currentX, laneWidth, cellW, view.pose, hovered, open, documentHidden, roam, reduced, tier]);

  React.useEffect(() => { tick(); }, [tick]);                       // masukan berubah → langkah
  React.useEffect(() => {                                           // satu timeout pada `until`
    if (!Number.isFinite(walk.until)) return;
    const t = setTimeout(tick, Math.max(0, walk.until - Date.now()));
    return () => clearTimeout(t);
  }, [walk.until, tick]);

  // ---- baris sekali-putar: `wave` (hover/klik) menumpuk di atas baris mesin; `shipped` main
  // sekali lalu `then` sampai pose berganti.
  const [oneShot, setOneShot] = React.useState<{ row: PetRowKey; id: number } | null>(null);
  const [shippedDone, setShippedDone] = React.useState(false);
  React.useEffect(() => { setShippedDone(false); }, [view.pose]);
  const baseRow: PetRowKey = row === "shipped" && shippedDone ? (thenOf("shipped") ?? "idle") : row;
  const displayRow: PetRowKey = oneShot?.row ?? baseRow;
  const display = rowOf(displayRow);
  const playWave = React.useCallback(() => {
    if (reduced) return;
    setOneShot((o) => o ?? { row: "wave", id: Date.now() });
  }, [reduced]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, reduced]);

  React.useEffect(() => {
    if (!reduced) return;
    setReacting(false);
    setOneShot(null);
    if (!open) setPanelMounted(false);
  }, [reduced, open]);

  // React 18 belum mengetik atribut `inert` di HTMLAttributes stabilnya. Menulis atribut DOM
  // menjaga panel yang sedang keluar tetap tak bisa difokuskan tanpa cast prop yang rapuh.
  React.useEffect(() => {
    panelRef.current?.toggleAttribute("inert", !open);
  }, [open, panelMounted]);

  function showPanel() {
    // Dijangkar ke posisi pet SAAT buka; pet berhenti selama panel terbuka (mesin §7), jadi cukup
    // sekali. Di-clamp ke viewport supaya panel di pojok kiri tak terpotong.
    const vw = typeof window !== "undefined" ? window.innerWidth : laneWidth;
    const actor = actorRef.current?.getBoundingClientRect();
    const left = actor && actor.width > 0 ? actor.left : walkRef.current.x;
    const center = left + anchor.x * cellW;
    setPanelLeft(Math.round(Math.min(Math.max(center - PANEL_W / 2, PANEL_EDGE), Math.max(PANEL_EDGE, vw - PANEL_W - PANEL_EDGE))));
    setPanelMounted(true);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    if (reduced) setPanelMounted(false);
  }

  function togglePanel() {
    if (open) closePanel();
    else showPanel();
  }

  function reactAndToggle() {
    if (!reduced) setReacting(true);
    playWave();
    togglePanel();
  }

  function setVisibility(next: boolean) {
    setHidden(next);
    savePetHidden(next);
    if (next) {
      setOpen(false);
      setPanelMounted(false);
    }
  }

  function setRoaming(next: boolean) {
    setRoam(next);
    savePetRoam(next);
  }

  // Jalur: selebar viewport di tepi bawah, setinggi satu sel. z 80: di bawah header (90), overlay
  // terminal fullscreen (100), Modal (150), Toast (200). `pointerEvents: none` di seluruh jalur —
  // konten di bawah jalur tetap menerima tap; yang `auto` hanya tombol 44 px, pegangan, dan panel.
  const root: React.CSSProperties = {
    position: "fixed", left: 0, right: 0, bottom: "max(0px, var(--safe-bottom))", height: cellH,
    zIndex: 80, pointerEvents: "none",
  };

  if (hidden) {
    return (
      <div data-testid="pet-root" ref={rootRef} style={root}>
        <button aria-label="Tampilkan pet Hanoman" onClick={() => setVisibility(false)} style={{
          pointerEvents: "auto", position: "absolute", width: 44, height: 44, padding: 0,
          right: "max(22px, var(--safe-right))", bottom: 22,
          display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
          background: "var(--surface-card)", opacity: 0.55, boxShadow: "var(--shadow-sm)",
        }}>
          <Mark id="buntut" size={15} />
        </button>
      </div>
    );
  }

  const status = `Hanoman ${POSE_LABEL[view.pose]} · ${view.headline}`;
  const frames = reduced
    ? "none"
    : `hn-pet-frames ${durationMs(displayRow)}ms steps(${columns}, end) ${display.loop ? "infinite" : "1 forwards"}`;
  return (
    <div data-testid="pet-root" ref={rootRef} style={root}>
      {panelMounted && (
        <div ref={panelRef} data-testid="pet-panel" aria-hidden={!open || undefined}
          onAnimationEnd={(event) => {
            if (event.animationName === "hn-pet-panel-out" && !open) setPanelMounted(false);
          }} style={{
          pointerEvents: open ? "auto" : "none", position: "absolute", left: panelLeft,
          bottom: cellH + PANEL_GAP, width: PANEL_W,
          maxWidth: "calc(100vw - var(--safe-left) - var(--safe-right) - 24px)",
          maxHeight: "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 120px)",
          overflowY: "auto", boxSizing: "border-box", padding: 14,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
          transformOrigin: "center bottom",
          animation: reduced
            ? "none"
            : `${open ? "hn-pet-panel-in" : "hn-pet-panel-out"} var(--dur-slow) var(--ease-out) both`,
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{POSE_LABEL[view.pose]}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600,
            color: "var(--text-strong)", lineHeight: 1.25 }}>{view.headline}</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-ui)", fontSize: 12.5,
            color: "var(--text-muted)", lineHeight: 1.45 }}>{view.detail}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <Button size="sm" leftIcon={view.target.section === "terminal" ? "terminal" : "list-checks"}
              style={reduced ? { transition: "none", transform: "none" } : undefined}
              onClick={() => { closePanel(); onOpen(view.target); }}>
              {view.target.section === "terminal" ? "Buka Terminal" : "Buka Backlog"}
            </Button>
            {tier !== "mobile" && (
              <Button size="sm" variant="ghost"
                style={reduced ? { transition: "none", transform: "none" } : undefined}
                onClick={() => setRoaming(!roam)}>{roam ? "Diam di pojok" : "Berkeliaran"}</Button>
            )}
            <Button size="sm" variant="ghost"
              style={reduced ? { transition: "none", transform: "none" } : undefined}
              onClick={() => setVisibility(true)}>Sembunyikan</Button>
          </div>
        </div>
      )}
      <div data-testid="pet-actor" ref={actorRef} data-facing={walk.facing} data-mode={walk.mode}
        onTransitionEnd={(event) => { if (event.propertyName === "transform") tick(); }} style={{
          position: "absolute", left: 0, bottom: 0, width: cellW, height: cellH,
          transform: `translateX(${move.x}px)`,
          transition: reduced || move.durationMs === 0 ? "none" : `transform ${move.durationMs}ms linear`,
          willChange: "transform",
        }}>
        {/* Live region membungkus kalimat status + panggung; atlas berisi 80 frame sehingga tak bisa
            diberi alt bermakna — kalimatnya hidup di span visually-hidden, satu sumber. */}
        <div data-testid="pet-stage" role="status" aria-live="polite"
          className="hn-pet-stage" data-reduced-motion={reduced ? "true" : undefined} style={{
            position: "relative", width: cellW, height: cellH,
            animation: reduced ? "none" : "hn-pet-reveal var(--dur-slow) var(--ease-out) both",
          }}>
          <span className="hn-sr-only" data-testid="pet-status">{status}</span>
          <div data-testid="pet-reactor" className="hn-pet-reactor" style={{
            position: "relative", width: "100%", height: "100%",
            transition: reduced ? "none" : "transform var(--dur-base) var(--ease-out)",
            animation: reduced || !reacting
              ? "none"
              : "hn-pet-click var(--dur-slow) var(--ease-out) both",
          }} onAnimationEnd={(event) => {
            if (event.animationName === "hn-pet-click") setReacting(false);
          }}>
            <div data-testid="pet-viewport" style={{ position: "relative", overflow: "hidden", width: cellW, height: cellH }}>
              <div data-testid="pet-rowshift" className="hn-pet-rowshift" data-row={displayRow}
                style={{ width: cellW, height: cellH, ["--row" as string]: rowIndex(displayRow) } as React.CSSProperties}>
                <img data-testid="pet-atlas" key={`${displayRow}:${oneShot?.id ?? 0}`}
                  src={PET_ATLAS_URL} alt="" aria-hidden="true" draggable={false} decoding="async"
                  onAnimationEnd={(event) => {
                    if (event.animationName !== "hn-pet-frames") return;
                    if (oneShot) { setOneShot(null); return; }
                    if (displayRow === "shipped") setShippedDone(true);
                  }}
                  style={{
                    display: "block", width: cellW * columns, height: cellH * rows.length,
                    animation: frames, willChange: "transform",
                  }} />
              </div>
            </div>
          </div>
          <button data-testid="pet-hit" aria-label="Ringkasan status Hanoman" title={`${view.headline} — ${view.detail}`}
            onClick={reactAndToggle}
            onPointerEnter={() => { setHovered(true); playWave(); }}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            style={{
              pointerEvents: "auto", position: "absolute", zIndex: 3,
              left: Math.round(anchor.x * cellW - HIT / 2), bottom: 0, width: HIT, height: HIT,
              padding: 0, border: "none", background: "transparent", cursor: "pointer",
            }} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Jalankan semua test pet + typecheck `src`**

Run: `env -u NODE_ENV pnpm vitest --run src/test/hanoman-pet.test.tsx src/test/pet-mount.test.tsx src/test/pet-state.test.ts src/test/pet-sprite.test.ts src/test/pet-walk.test.ts`
Expected: `Test Files  5 passed (5)`, `Tests  53 passed (53)`.

Run: `pnpm --filter ./src exec tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"`
Expected: tanpa keluaran error, `tsc exit=0`.

- [ ] **Step 4: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): HanomanPet sprite — atlas steps(8), actor berkeliaran, panel berjangkar, toggle roam, status sr-only"
```

---

### Task 10: Verifikasi browser nyata (CDP) — frame bergerak, pet berpindah, tap tak tercuri

**Files:**
- Create (sementara, tak dikomit): `src/harness/pet.html`, `src/harness/pet-main.tsx`, `<scratchpad>/pet-cdp.mjs`

**Interfaces:**
- Consumes: komponen Task 9, atlas Task 5.
- Produces: bukti terukur untuk §11 spec (dicatat di pesan commit Task 11).

- [ ] **Step 1: Harness Vite yang hanya me-mount komponen**

`src/harness/pet.html`:

```html
<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>harness pet</title>
</head>
<body style="margin:0;background:var(--surface-page,#faf6ec)">
<main style="padding:24px 24px 160px"><button id="under" style="position:fixed;left:40px;bottom:20px;height:40px">Kontrol di bawah jalur</button></main>
<div id="root"></div>
<script type="module" src="./pet-main.tsx"></script>
</body></html>
```

`src/harness/pet-main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/ds/styles.css";
import "../src/app.css";
import { HanomanPet } from "../src/screens/HanomanPet";

const backlog = [{ id: "SPEC-1", projectId: "hanoman", title: "judul", source: "brief", stage: "executing",
  priority: "sedang", author: "op", objective: "", payload: null, branchFrom: null, baseSha: null,
  createdAt: "2026-08-01T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [], autoMerge: null, sourceHistory: [] }];
const sessions = [{ id: "spec-1", projectId: "hanoman", specId: "SPEC-1", cwd: "/tmp", exited: false }];
(window as unknown as { __pet: unknown }).__pet = { backlog, sessions };
createRoot(document.getElementById("root")!).render(
  <HanomanPet sessions={sessions as never} backlog={backlog as never} onOpen={(t) => console.log("open", t)} />);
```

Run (latar): `cd src && pnpm exec vite --port 5199 --strictPort`
Expected: `Local: http://localhost:5199/`; buka `http://localhost:5199/harness/pet.html` — pet terlihat di tepi bawah.

- [ ] **Step 2: Skrip CDP**

`<scratchpad>/pet-cdp.mjs` (Node 24, tanpa dependency):

```js
const base = "http://127.0.0.1:9222";
const chrome = (await import("node:child_process")).spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9222", "--window-size=1280,800", "--user-data-dir=/tmp/pet-cdp", "about:blank"],
  { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));
const [tab] = await (await fetch(`${base}/json/list`)).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5199/harness/pet.html" });
await new Promise((r) => setTimeout(r, 2500));
const probe = () => evalJs(`(() => { const img = document.querySelector('[data-testid="pet-atlas"]'); const actor = document.querySelector('[data-testid="pet-actor"]');
  const cs = getComputedStyle(img); return { anim: cs.animationName, frame: cs.transform, actor: getComputedStyle(actor).transform, mode: actor.dataset.mode, row: document.querySelector('[data-testid="pet-rowshift"]').dataset.row, complete: img.complete && img.naturalWidth > 0 }; })()`);
const a = await probe(); await new Promise((r) => setTimeout(r, 400)); const b = await probe();
console.log("atlas termuat:", a.complete, "| animasi:", a.anim, "| baris:", a.row);
console.log("transform frame berubah antar 400 ms:", a.frame !== b.frame, a.frame, "→", b.frame);
await new Promise((r) => setTimeout(r, 6000)); const c = await probe();
console.log("actor berpindah sesudah 6 dtk:", c.actor !== a.actor, "| mode:", c.mode, "| baris:", c.row);
const under = await evalJs(`(() => { const b = document.getElementById("under"); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === b || b.contains(el); })()`);
console.log("kontrol di bawah jalur tetap menerima tap:", under);
ws.close(); chrome.kill();
```

Run: `node <scratchpad>/pet-cdp.mjs`
Expected:
```
atlas termuat: true | animasi: hn-pet-frames | baris: working
transform frame berubah antar 400 ms: true matrix(1, 0, 0, 1, -<x1>, 0) → matrix(1, 0, 0, 1, -<x2>, 0)
actor berpindah sesudah 6 dtk: true | mode: walk (atau stand bila sudah tiba) | baris: walk-left|walk-right|working
kontrol di bawah jalur tetap menerima tap: true
```
Bila `actor berpindah` `false`, tunggu 8 dtk lagi (berdiri pertama 4 dtk + transisi). Ulangi dengan `--window-size=390,844` dan pastikan `mode: stand` serta `actor` tetap `translateX(home)`.

- [ ] **Step 3: Bersihkan harness**

Run: `rm -rf src/harness; pkill -f "vite --port 5199" || true` (hanya proses vite port 5199 milik harness ini — jangan `pkill` pola lain, SPEC-402). Catat angka hasil CDP untuk pesan commit Task 11.

---

### Task 11: Docs, ADR-0140, amandemen brand, index

**Files:**
- Create: `internal/docs/adr/0140-pet-sprite-codex-pipeline-berkeliaran.md`
- Modify: `internal/docs/frontend/frontend-implementation.md` (seksi "Pet Hanoman", mulai baris ~283), `internal/docs/design-system/design-system.md` (grammar motion pet + band pet), `internal/docs/brand/illustration/03-mascot-system.md` (band "pet"), `internal/docs/adr/README.md`, `internal/docs/README.md`

- [ ] **Step 1: ADR-0140**

Verifikasi nomor: `ls internal/docs/adr | tail -3` — bila `0140-*` sudah ada (sesi lain), pakai nomor bebas berikutnya dan ganti semua rujukan `ADR-0140` di spec, README aset, dan docs di bawah.

`internal/docs/adr/0140-pet-sprite-codex-pipeline-berkeliaran.md`:

```markdown
# ADR-0140 — Pet dashboard sebagai sprite beranimasi: aset dibuat AI lewat Codex, pipeline registrasi, renderer frame, berkeliaran di tepi bawah

Tanggal: <tanggal execute> · Status: diterima · Sumber: spec `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`
Menegakkan ADR-0039 (tanpa channel realtime baru); menjadikan konvensi SPEC-585/648 (pet tanpa ADR)
keputusan arsitektur karena kini ada keluarga aset, pipeline, dan skrip baru; mengamandemen sistem
maskot brand (band "pet").

## Konteks

Pet SPEC-585/648 hanya bisa menggoyang satu sticker raster; aset maskot adalah raster AI tanpa
layer animasi. Referensi produk (Codex Pets, `/buddy` Claude Code) memakai frame nyata.

## Keputusan

1. **Aset**: keluarga `internal/assets/pet/` — atlas WebP 8 kolom × 10 baris (sel 192×208, karakter
   berdiri 168 px) + `pet.json`; strip per baris `rows/` adalah master yang dikomit, `raw/` tidak.
2. **Generator**: frame dibuat Codex (GPT Image) lewat `internal/scripts/pet/gen.py` dari prompt yang
   dikomit + model sheet; Codex adalah alat pengembang (seperti `cwebp`), turunannya dikomit, runner
   CI tak memanggilnya.
3. **Pipeline** mengunci pengukuran 2026-08-22: latar hijau + key yang mempertahankan warna (despill
   magenta memotong merah); deteksi sprite dari celah transparan (model tak menaati grid); registrasi
   offset+skala di wilayah statis dengan kaki = run kolom paling kanan (ekor menipu bbox) lalu pin
   wilayah statis frame 1; clip per sel dengan tumpahan sebagai gerbang; gerbang residu 0,15/0,30.
4. **Renderer**: satu `<img>` atlas; baris lewat `--row` (persen tinggi sel), frame lewat `steps(8)`
   atas `translateX(-100%)`; grammar SPEC-648 (transform/opacity, tanpa rAF) dipertahankan.
5. **Perilaku**: mesin berkeliaran murni (`pet-walk.ts`): berdiri 4–12 s / jalan 2–6 s @ 40 px/s di
   jalur tepi bawah; pose perhatian pulang ke pojok kanan; jeda saat hover/panel/tab tersembunyi;
   tier mobile, reduced-motion, dan `hanoman.pet.roam=0` menjangkar ke pojok. `walk-left` digambar,
   tidak pernah mirror.
6. **A11y**: kalimat status pindah ke `span` visually-hidden di dalam `role="status"`; atlas `alt=""`.
7. **Brand**: band "pet" 80–128 px (±2,5 head unit) untuk pet dashboard — pengecualian eksplisit atas
   "no chibi inflation"; Gate 2 lewat `qa/`.

## Konsekuensi

- +1 atlas ≤ 1 MB di bundle; sticker STK-* tetap di katalog (glob eager), tak lagi dipakai pet.
- Regenerasi butuh Codex lokal; tanpa Codex, aset yang dikomit tetap lengkap.
- Roadmap B (terputus/lencana/panel multi-kondisi), C (gelembung/rekap/urgensi), D (inbox keputusan)
  menumpang renderer ini; baris atlas baru lewat pipeline yang sama.
- Terukur saat execute: <isi dari Task 10: frame berubah per 400 ms, actor berpindah, tap di bawah
  jalur tetap sampai, ukuran atlas … B>.
```

- [ ] **Step 2: `frontend-implementation.md` — tulis ulang seksi Pet**

Ganti isi seksi `## Pet Hanoman: status sesi sebagai pose (SPEC-585)` sampai sebelum seksi berikutnya dengan struktur:

```markdown
## Pet Hanoman: status sesi sebagai sprite hidup (SPEC-585 · SPEC-648 · Pet hidup A, ADR-0140)

**Kontrak status** (tak berubah sejak SPEC-585): `derivePetState` di `pet-state.ts`, tujuh pose,
prioritas total — <salin tabel prioritas dari seksi lama apa adanya>.

**Atlas & manifest.** `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp` + `pet.json` (PET-001):
sel 192×208, 8 kolom, 10 baris (`idle, walk-right, walk-left, working, waiting, blocked, review,
shipped, docs-updated, wave`), karakter berdiri 168 px, jangkar kaki x 0,62 / baseline 202.
`pet-sprite.ts` memvalidasi manifest (validator tangan — zod tak bisa di-resolve dari `src`),
memetakan pose → baris (`POSE_ROW`; hanya `ready → idle` yang berganti nama), `durationMs = columns /
fps × 1000`, dan rantai `then` untuk baris sekali-putar (`shipped`, `wave` → `idle`). Pipeline
pembuatannya di `internal/assets/pet/README.md`.

**DOM & kepemilikan transform.** <salin diagram DOM spec §6>. Satu `<img>` atlas; frame oleh
`steps(8, end)` atas `translateX(-100%)`, baris oleh `--row` pada `.hn-pet-rowshift`. Pergantian
baris sekali-putar memakai `key` React pada img; `animationend` (`hn-pet-frames`) mengganti ke
`then` atau melepas `wave`. Skala: 112 px desktop/tablet, 96 px mobile, dari `character.h`.

**Mesin berkeliaran** (`pet-walk.ts`, murni, `stepWalk(state, input, rng)`): <salin tabel spec §7>.
Penjadwalan: satu `setTimeout` pada `until` + `transitionend` (`propertyName === "transform"`) +
`visibilitychange` + `resize` (debounce 150 ms). `currentX` dibaca dari `getBoundingClientRect()`
hanya pada peristiwa.

**Interaksi & preferensi.** Klik = panel + `wave` + berhenti; hover/fokus = berhenti + `wave`. Panel
dijangkar ke posisi pet saat buka (`left = clamp(pusat − 134, 12, vw − 268 − 12)`) dan duduk di atas
jalur. Tombol `Diam di pojok`/`Berkeliaran` → `hanoman.pet.roam` (default berkeliaran; mobile
dipaksa diam, tombol disembunyikan). `hanoman.pet.hidden` + pegangan buntut tak berubah.

**Aksesibilitas & reduced motion.** Atlas `alt=""` + `aria-hidden`; kalimat status (`Hanoman <label>
· <headline>`) di `span.hn-sr-only` di dalam `role="status" aria-live="polite"` — mengganti "alt di
gambar" SPEC-585. Reduced-motion: `animation: none`, `transition: none`, pet di rumah, tanpa `wave`.

**Gerbang tap (SPEC-763, diperluas).** Jalur `pointer-events: none` selebar viewport; hanya tombol
44 px di kaki (mengikuti pet), pegangan, dan panel yang `auto`. Terukur CDP: <angka Task 10>.

**Pengujian.** `pet-sprite.test.ts` (manifest + kontrak CSS), `pet-walk.test.ts` (tabel mesin),
`hanoman-pet.test.tsx` (render/interaksi/reduced/roam/mobile/jalan), `pet-mount.test.tsx`,
`internal/scripts/pet/test-petlib.py` (pipeline atas lembar sintetis).
```

Hapus paragraf SPEC-648 tentang `pet-motion.ts`, `hn-pet-idle-*`, `hn-pet-pose-*`, `--dur-pet-*`; sebutkan sekali bahwa katalog itu dicabut oleh Pet hidup A.

- [ ] **Step 3: `design-system.md`**

Di bagian motion pet: ganti tabel keyframe idle SPEC-648 dengan paragraf "grammar sprite": satu img, `steps`, token `--dur-base/slow` untuk interaksi, frame tak memakai token durasi (durasi = `columns/fps` dari manifest). Di bagian ilustrasi produk tambahkan band **pet** (80–128 px, ±2,5 head unit, hanya pet dashboard, ADR-0140) di samping family `sticker`.

- [ ] **Step 4: `03-mascot-system.md`**

Di `## Scale bands` tambahkan: `Pet (dashboard) 80–128 px — ±2,5 head unit, proporsi ringkas; satu-satunya pengecualian atas "don't use chibi inflation" (ADR-0140), ekspresi lewat mata/kepala/ekor, tanpa emoji face.` Di `## Parts, do/don't, Gate 2` tambahkan kalimat: `Atlas pet direview lewat internal/assets/pet/qa/ (GIF + contact sheet per baris); walk-left digambar, bukan mirror.`

- [ ] **Step 5: Index**

`internal/docs/adr/README.md`: tambah baris `- [0140 — Pet dashboard sebagai sprite beranimasi …](0140-pet-sprite-codex-pipeline-berkeliaran.md) — menegakkan 0039, mengamandemen konvensi SPEC-585/648 & sistem maskot (Pet hidup A)` di posisi teratas daftar.
`internal/docs/README.md`: perbarui deskripsi link `frontend-implementation.md`, `design-system.md`, `03-mascot-system.md` (sebut Pet hidup A/ADR-0140) dan tambah link ADR-0140 di daftar ADR.

Run: `hanoman docs index --check` (CLI produk, read-only; bila `hanoman` global lebih tua dari checkout ini: `pnpm build:cli && node cli/dist/hanoman.js docs index --check`)
Expected: laporan tanpa entri hilang / tak ter-link.

- [ ] **Step 6: Test tersentuh + commit**

Run: `env -u NODE_ENV pnpm vitest --run src/test/pet-mount.test.tsx src/test/pet-sprite.test.ts`
Expected: lulus (docs tak mengubah kode; ini pengaman terakhir).

```bash
git add internal/docs/adr/0140-pet-sprite-codex-pipeline-berkeliaran.md internal/docs/adr/README.md internal/docs/README.md \
  internal/docs/frontend/frontend-implementation.md internal/docs/design-system/design-system.md internal/docs/brand/illustration/03-mascot-system.md
git commit -m "docs(pet-hidup): ADR-0140, seksi pet ditulis ulang, grammar sprite, band pet pada sistem maskot"
```

---

## Self-review plan (sudah dijalankan saat menulis)

- Cakupan spec: §5.1–5.3 → Task 1–5; §6 → Task 6, 8, 9; §7 → Task 7, 9; §8–9 → Task 9; §10 → Task 5 (anggaran) + Task 9 (`decoding="async"`, `willChange`); §11 → test di tiap task + Task 10; §12 → Task 11; §13–14 di luar scope.
- Nama & tipe lintas task: `PET_ROW_KEYS/PetRowKey/PetRow/PetManifest/POSE_ROW/rowOf/rowIndex/durationMs/thenOf` (Task 6) dipakai Task 7 & 9 persis; `stepWalk/initialWalkState/homeX/clampX/anchored/PetWalkInput.currentX` (Task 7) dipakai Task 9; `loadPetRoam/savePetRoam/PET_ROAM_KEY` (Task 8) dipakai Task 9; `petlib.ROWS[*].mode` (Task 1) dipakai Task 2; laporan `clipped/residual_pre/residual_post/edge` (Task 1–2) dipakai `qa.py`.
- Tanpa placeholder: setiap langkah kode memuat kode; angka hasil CDP dan tanggal ADR diisi saat execute (ditandai `<…>` hanya untuk nilai yang memang belum ada).
