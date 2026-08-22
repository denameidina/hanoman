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
    atlas_path = ASSETS / "hnm-pet-anoman-atlas-v02.webp"
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
    # SPEC-904 · `version` dan `anchor` dulu tak pernah dibandingkan. `version` kini nilai yang
    # bergerak, dan `anchor` adalah jangkar yang dibagi SELURUH baris — menggesernya membuat setiap
    # pose lama melompat sesaat saat berganti baris, tanpa satu pun error.
    if m.get("id") != "PET-001" or m.get("version") != petlib.MANIFEST_VERSION:
        problems.append(f"id/version manifest {m.get('id')}/{m.get('version')} ≠ PET-001/{petlib.MANIFEST_VERSION}")
    if m.get("anchor") != {"x": petlib.ANCHOR_X, "baseline": petlib.BASELINE}:
        problems.append(f"anchor manifest {m.get('anchor')} tak sesuai petlib")
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
