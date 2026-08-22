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
