#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
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

    def test_crop_to_alpha_ignores_nearly_transparent_edge_noise(self) -> None:
        image = Image.new("RGBA", (80, 60), (0, 0, 0, 0))
        image.putpixel((0, 59), (255, 255, 255, 1))
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

    def test_pet_copy_map_matches_approved_thirty_labels(self) -> None:
        self.assertTrue(hasattr(MODULE, "PET_STICKERS"), "pet sticker catalog is missing")

        self.assertEqual(
            {item.slug: item.label for item in MODULE.PET_STICKERS},
            {
                "pagi": "Pagi!",
                "halo": "Halo!",
                "siap": "Siap!",
                "oke": "Oke!",
                "gas": "Gas!",
                "otw": "OTW",
                "bentar-ya": "Bentar ya",
                "makasih": "Makasih!",
                "sama-sama": "Sama-sama",
                "maaf-ya": "Maaf ya",
                "baik-dipahami": "Baik, dipahami",
                "siap-dikerjakan": "Siap dikerjakan",
                "sedang-diproses": "Sedang diproses",
                "mohon-ditinjau": "Mohon ditinjau",
                "perlu-revisi": "Perlu revisi",
                "sudah-selesai": "Sudah selesai",
                "sudah-dikirim": "Sudah dikirim",
                "terima-kasih": "Terima kasih",
                "serius": "Serius.",
                "ini-penting": "Ini penting",
                "tolong-fokus": "Tolong fokus",
                "cek-lagi": "Cek lagi",
                "jangan-lupa": "Jangan lupa",
                "hah": "Hah?!",
                "serius-kaget": "Serius?!",
                "waduh": "Waduh...",
                "tenang": "Tenang...",
                "mantap": "Mantap!",
                "yes": "Yes!",
                "semangat": "Semangat!",
            },
        )

    def test_pet_inventory_is_one_complete_whatsapp_pack(self) -> None:
        self.assertTrue(
            hasattr(MODULE, "expected_pet_sticker_paths"),
            "pet sticker inventory builder is missing",
        )

        names = MODULE.expected_pet_sticker_paths(Path("out"))

        self.assertEqual(len(names), 30)
        self.assertEqual(len({path.name for path in names}), 30)
        self.assertEqual({path.parent.name for path in names}, {"id-text"})

    def test_export_pet_pack_delivers_thirty_valid_stickers_and_metadata(self) -> None:
        self.assertTrue(hasattr(MODULE, "export_pet_pack"), "pet pack exporter is missing")

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            masters = root / "internal" / "assets" / "pet" / "whatsapp" / "masters"
            masters.mkdir(parents=True)
            for index, sticker in enumerate(MODULE.PET_STICKERS):
                image = Image.new("RGBA", (160, 192), (0, 0, 0, 0))
                image.paste((184, 134, 59, 255), (24, 20, 136, 172))
                image.save(masters / sticker.source_name)

            output = root / "delivery"
            font = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
            paths = MODULE.export_pet_pack(root, output, font)

            self.assertEqual(len(paths), 30)
            self.assertTrue(all(path.stat().st_size < 100_000 for path in paths))
            sizes = []
            for path in paths:
                with Image.open(path) as image:
                    sizes.append(image.size)
            self.assertTrue(all(size == (512, 512) for size in sizes))

            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["name"], "Hanoman Pet — Sehari-hari")
            self.assertEqual(len(manifest["stickers"]), 30)
            self.assertEqual(
                [record["label"] for record in manifest["stickers"]],
                [sticker.label for sticker in MODULE.PET_STICKERS],
            )

            with zipfile.ZipFile(output / "hanoman-pet-sehari-hari.zip") as archive:
                self.assertEqual(len(archive.namelist()), 35)

    def test_export_pet_pack_preserves_masters_inside_default_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output = root / "internal" / "assets" / "pet" / "whatsapp"
            masters = output / "masters"
            masters.mkdir(parents=True)
            for sticker in MODULE.PET_STICKERS:
                image = Image.new("RGBA", (160, 192), (0, 0, 0, 0))
                image.paste((184, 134, 59, 255), (24, 20, 136, 172))
                image.save(masters / sticker.source_name)

            font = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
            paths = MODULE.export_pet_pack(root, output, font)

            self.assertEqual(len(paths), 30)
            self.assertEqual(len(list(masters.glob("*.png"))), 30)
            self.assertTrue(all((masters / item.source_name).is_file() for item in MODULE.PET_STICKERS))

    def test_cli_exports_pet_pack_when_selected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            masters = root / "internal" / "assets" / "pet" / "whatsapp" / "masters"
            masters.mkdir(parents=True)
            for sticker in MODULE.PET_STICKERS:
                image = Image.new("RGBA", (160, 192), (0, 0, 0, 0))
                image.paste((184, 134, 59, 255), (24, 20, 136, 172))
                image.save(masters / sticker.source_name)

            output = root / "delivery"
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--pack",
                    "pet",
                    "--repo-root",
                    str(root),
                    "--output",
                    str(output),
                    "--font",
                    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("exported 30 stickers", result.stdout)
            self.assertTrue((output / "hanoman-pet-sehari-hari.zip").is_file())


if __name__ == "__main__":
    unittest.main()
