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
