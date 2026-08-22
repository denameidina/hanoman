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
