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
    steps = petlib.frame_steps(strip.convert("RGBA"))
    ratio = max(steps) / max(min(steps), 1e-6)
    if row.get("even") and max(steps) >= petlib.STEP_VISIBLE and ratio > petlib.STEP_RATIO_GATE:
        problems.append(f"langkah tak rata: max {max(steps):.3f} / min {min(steps):.3f} "
                        f"= {ratio:.2f} > {petlib.STEP_RATIO_GATE} — baris ini diputar berulang")
    qa = ASSETS / "qa"
    qa.mkdir(exist_ok=True)
    contact = Image.new("RGBA", (strip.size[0] // 2, strip.size[1] // 2), (250, 246, 236, 255))
    contact.alpha_composite(strip.convert("RGBA").resize(contact.size, Image.LANCZOS))
    contact.save(qa / f"{key}-contact.png")
    petlib.onion_skin(strip.convert("RGBA")).save(qa / f"{key}-onion.png")
    petlib.save_gif(strip.convert("RGBA"), qa / f"{key}.gif", row["fps"])
    print(f"qa/{key}-contact.png qa/{key}-onion.png qa/{key}.gif ditulis")
    # Sambungan 8→1 adalah elemen TERAKHIR — satu-satunya langkah yang tak terlihat di contact
    # sheet maupun onion-skin, dan yang menentukan apakah baris ini bisa diputar berulang.
    print("  langkah " + " ".join(f"{i + 1}→{(i + 1) % 8 + 1}:{s:.3f}" for i, s in enumerate(steps))
          + f"  rasio={ratio:.2f}")
    if problems:
        fail(f"{key}: " + "; ".join(problems))
    print(f"OK {key}: 8 frame, residu maks {max(f['residual_pre'] for f in report['frames']):.3f} ≤ {gate}")


if __name__ == "__main__":
    main()
