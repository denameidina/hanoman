#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT = Path(__file__).with_name("export-whatsapp-stickers.py")
SPEC = importlib.util.spec_from_file_location("export_whatsapp_stickers", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {SCRIPT}")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ExportWhatsappStickersTest(unittest.TestCase):
    def test_copy_map_matches_approved_indonesian_labels(self) -> None:
        self.assertEqual(
            {item.slug: item.label for item in MODULE.STICKERS},
            {
                "ready": "Siap",
                "working": "Dikerjakan",
                "waiting": "Menunggu",
                "blocked": "Terhambat",
                "shipped": "Terkirim",
                "review": "Tinjau",
                "thanks": "Terima kasih",
                "docs-updated": "Docs diperbarui",
            },
        )

    def test_crop_to_alpha_removes_only_transparent_padding(self) -> None:
        image = Image.new("RGBA", (80, 60), (0, 0, 0, 0))
        image.paste((23, 19, 12, 255), (20, 10, 61, 51))
        cropped = MODULE.crop_to_alpha(image)

        self.assertEqual(cropped.size, (41, 41))
        self.assertEqual(cropped.getpixel((0, 0)), (23, 19, 12, 255))

    def test_place_subject_preserves_transparent_corners_and_safe_bounds(self) -> None:
        subject = Image.new("RGBA", (100, 200), (184, 134, 59, 255))
        canvas = MODULE.place_subject(subject, (69, 69, 443, 443), outline_px=8)
        alpha = canvas.getchannel("A")

        self.assertEqual(canvas.size, (512, 512))
        self.assertEqual(alpha.getpixel((0, 0)), 0)
        self.assertIsNotNone(alpha.getbbox())
        left, top, right, bottom = alpha.getbbox() or (0, 0, 0, 0)
        self.assertGreaterEqual(left, 61)
        self.assertGreaterEqual(top, 61)
        self.assertLessEqual(right, 451)
        self.assertLessEqual(bottom, 451)

    def test_expected_inventory_has_two_complete_packs(self) -> None:
        names = MODULE.expected_sticker_paths(Path("out"))

        self.assertEqual(len(names), 16)
        self.assertEqual(len({path.name for path in names}), 8)
        self.assertEqual({path.parent.name for path in names}, {"text-free", "id-text"})


if __name__ == "__main__":
    unittest.main()
