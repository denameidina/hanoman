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


def draw_character(size: tuple[int, int] = (260, 384), tail_lift: int = 0, lift: int = 0,
                   scale: float = 1.0, leg_drop: int = 0) -> Image.Image:
    """Karakter menghadap kanan: kaki+torso (kotak di kanan), kepala (lingkaran), ekor di kiri yang
    ujungnya naik sebesar `tail_lift`. `lift` mengangkat seluruh tubuh (lompat), `leg_drop`
    memanjangkan kaki ke bawah tanpa menggeser kepala — bentuk baris `held`/`falling` (mode
    `float`). Margin 30 px di bawah baseline karakter menyediakan ruang untuk `leg_drop`."""
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w, h = size
    base = h - 30 - lift
    # kaki + torso: kolom 150..230; `leg_drop` memanjangkan kaki KE BAWAH tanpa menyentuh kepala
    d.rectangle((150, base - 220, 230, base + leg_drop), fill=BODY)
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


class FrameStepsTest(unittest.TestCase):
    def strip_of(self, masks: list[np.ndarray]) -> Image.Image:
        strip = Image.new("RGBA", (petlib.CELL_W * 8, petlib.CELL_H), (0, 0, 0, 0))
        for i, m in enumerate(masks):
            cell = Image.fromarray(np.dstack([np.full(m.shape + (3,), 200, np.uint8),
                                              (m * 255).astype(np.uint8)]), "RGBA")
            strip.alpha_composite(cell, (i * petlib.CELL_W, 0))
        return strip

    def block(self, x0: int, w: int) -> np.ndarray:
        m = np.zeros((petlib.CELL_H, petlib.CELL_W), bool)
        m[40:180, x0:x0 + w] = True
        return m

    def test_returns_eight_steps_and_the_last_one_is_the_seam(self) -> None:
        # Frame 1..8 = balok yang bergeser 4 px per frame lalu kembali: langkah 8→1 sama besarnya
        # dengan langkah lain, sehingga rasio kerataannya 1.
        xs = [40, 44, 48, 52, 56, 52, 48, 44]
        steps = petlib.frame_steps(self.strip_of([self.block(x, 60) for x in xs]))
        self.assertEqual(len(steps), 8)
        for s in steps:
            self.assertAlmostEqual(s, steps[0], delta=0.01)

    def test_twin_frames_at_the_seam_make_the_ratio_explode(self) -> None:
        # Frame 7, 8 dan 1 nyaris kembar (langkah 0), frame 3..5 melompat jauh — persis bentuk
        # `wave` v01 (rasio terukur 7,07).
        xs = [40, 40, 90, 90, 40, 40, 40, 40]
        steps = petlib.frame_steps(self.strip_of([self.block(x, 60) for x in xs]))
        self.assertEqual(min(steps), 0.0)
        self.assertGreater(max(steps), petlib.STEP_VISIBLE)


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

    def test_float_registers_the_upper_body_and_never_forces_feet_to_the_baseline(self) -> None:
        # Kepala DIAM, kaki menjuntai berbeda panjang tiap frame — bentuk baris `held`/`falling`.
        drops = [0, 8, 16, 20, 16, 8, 0, 4]
        frames = [draw_character(leg_drop=d) for d in drops]
        shifts = [(0, 0)] * 8
        sprites = self.sprites(frames, shifts)
        walk, _ = petlib.build_strip(sprites, "walk")
        float_strip, report = petlib.build_strip(sprites, "float")

        def top(strip, i):
            a = np.asarray(strip.crop((i * petlib.CELL_W, 0, (i + 1) * petlib.CELL_W,
                                       petlib.CELL_H)).getchannel("A")) > 64
            return int(np.where(a.any(axis=1))[0].min())

        def bottom(strip, i):
            a = np.asarray(strip.crop((i * petlib.CELL_W, 0, (i + 1) * petlib.CELL_W,
                                       petlib.CELL_H)).getchannel("A")) > 64
            return int(np.where(a.any(axis=1))[0].max())

        # `walk` memaksa SETIAP dasar ke baseline → kepala ikut naik-turun.
        self.assertEqual({bottom(walk, i) for i in range(8)}, {petlib.BASELINE - 1})
        self.assertGreater(len({top(walk, i) for i in range(8)}), 3)
        # `float` menjangkarkan tubuh ATAS → kepala sejajar, dasar bebas mengikuti kaki.
        self.assertLessEqual(max(top(float_strip, i) for i in range(8))
                             - min(top(float_strip, i) for i in range(8)), 2)
        self.assertGreater(len({bottom(float_strip, i) for i in range(8)}), 3)
        # `float` tak di-pin: tak ada `residual_post` sama sekali.
        self.assertTrue(all("residual_post" not in r for r in report), report)
        self.assertIn("float", petlib.RESIDUAL_GATE)

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
            self.assertEqual(m["version"], 2)
            self.assertEqual([r["key"] for r in m["rows"]], petlib.ROW_KEYS)
            self.assertNotIn("mode", m["rows"][0])
            self.assertEqual(m["rows"][7], {"key": "shipped", "fps": 10, "loop": False, "then": "idle"})
            self.assertEqual(set(m["sources"]), set(petlib.ROW_KEYS))
            self.assertEqual(m["character"], {"h": petlib.STAND_H})
            # SPEC-904 · tiga baris baru DI EKOR; indeks baris lama tak bergeser.
            self.assertEqual(petlib.ROW_KEYS[:13], [
                "idle", "walk-right", "walk-left", "working", "waiting", "blocked", "review",
                "shipped", "docs-updated", "wave", "deciding", "sleep", "thanks"])
            self.assertEqual(petlib.ROW_KEYS[13:], ["held", "falling", "dizzy"])
            self.assertEqual(m["rows"][13], {"key": "held", "fps": 8, "loop": True})
            self.assertEqual(m["rows"][14], {"key": "falling", "fps": 8, "loop": True})
            self.assertEqual(m["rows"][15], {"key": "dizzy", "fps": 8, "loop": False, "then": "idle"})
            # `mode` dan `even` adalah kunci PIPELINE — keduanya tak boleh bocor ke pet.json.
            self.assertTrue(all("even" not in r for r in m["rows"]), m["rows"])
            self.assertEqual([r["key"] for r in petlib.ROWS if r.get("even")],
                             ["wave", "held", "falling"])
            self.assertEqual(petlib.ATLAS_BUDGET, 1_300_000)

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
