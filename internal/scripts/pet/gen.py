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
