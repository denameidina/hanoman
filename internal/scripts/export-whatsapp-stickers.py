#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


CANVAS = 512
BONE = (255, 253, 248, 255)
INK = (23, 19, 12, 255)
BRASS = (184, 134, 59, 255)
MAX_STICKER_BYTES = 100_000
MAX_TRAY_BYTES = 50_000
SAFE_MARGIN = 60


@dataclass(frozen=True)
class Sticker:
    slug: str
    label: str
    source_name: str


STICKERS = (
    Sticker("ready", "Siap", "hnm-ill-sticker-ready-1x1-master-v01.webp"),
    Sticker("working", "Dikerjakan", "hnm-ill-sticker-working-1x1-master-v01.webp"),
    Sticker("waiting", "Menunggu", "hnm-ill-sticker-waiting-1x1-master-v01.webp"),
    Sticker("blocked", "Terhambat", "hnm-ill-sticker-blocked-1x1-master-v01.webp"),
    Sticker("shipped", "Terkirim", "hnm-ill-sticker-shipped-1x1-master-v01.webp"),
    Sticker("review", "Tinjau", "hnm-ill-sticker-review-1x1-master-v01.webp"),
    Sticker("thanks", "Terima kasih", "hnm-ill-sticker-thanks-1x1-master-v01.webp"),
    Sticker("docs-updated", "Docs diperbarui", "hnm-ill-sticker-docs-updated-1x1-master-v01.webp"),
)


def crop_to_alpha(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("source has no visible pixels")
    return rgba.crop(bbox)


def _fit_size(size: tuple[int, int], box: tuple[int, int, int, int]) -> tuple[int, int]:
    width, height = size
    box_width = box[2] - box[0]
    box_height = box[3] - box[1]
    scale = min(box_width / width, box_height / height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def place_subject(
    subject: Image.Image,
    box: tuple[int, int, int, int],
    *,
    outline_px: int,
) -> Image.Image:
    subject = crop_to_alpha(subject)
    subject = subject.resize(_fit_size(subject.size, box), Image.Resampling.LANCZOS)
    x = box[0] + ((box[2] - box[0]) - subject.width) // 2
    y = box[1] + ((box[3] - box[1]) - subject.height) // 2

    alpha = Image.new("L", (CANVAS, CANVAS), 0)
    alpha.paste(subject.getchannel("A"), (x, y))
    outline_mask = alpha.filter(ImageFilter.MaxFilter(outline_px * 2 + 1))

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    outline = Image.new("RGBA", (CANVAS, CANVAS), BONE)
    outline.putalpha(outline_mask)
    canvas = Image.alpha_composite(canvas, outline)

    subject_layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    subject_layer.alpha_composite(subject, (x, y))
    return Image.alpha_composite(canvas, subject_layer)


def _fit_font(label: str, font_path: Path, max_width: int) -> ImageFont.FreeTypeFont:
    for size in range(50, 27, -1):
        font = ImageFont.truetype(str(font_path), size)
        bbox = font.getbbox(label, stroke_width=6)
        if bbox[2] - bbox[0] <= max_width:
            return font
    raise ValueError(f"label does not fit: {label}")


def render_sticker(source: Image.Image, label: str | None, font_path: Path) -> Image.Image:
    if label is None:
        return place_subject(source, (69, 69, 443, 443), outline_px=8)

    canvas = place_subject(source, (69, 69, 443, 376), outline_px=8)
    font = _fit_font(label, font_path, 390)
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (256, 415),
        label,
        font=font,
        fill=INK,
        stroke_width=6,
        stroke_fill=BONE,
        anchor="mm",
    )
    return canvas


def expected_sticker_paths(output_root: Path) -> list[Path]:
    return [
        output_root / variant / f"hanoman-{sticker.slug}.webp"
        for variant in ("text-free", "id-text")
        for sticker in STICKERS
    ]


def _encode_webp(image: Image.Image, destination: Path, cwebp: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hanoman-sticker-") as temp_dir:
        source_png = Path(temp_dir) / "source.png"
        image.save(source_png, format="PNG", optimize=True)
        for quality in (90, 86, 82, 78):
            command = [
                cwebp,
                "-quiet",
                "-q",
                str(quality),
                "-alpha_q",
                "100",
                "-m",
                "4",
                "-metadata",
                "none",
                str(source_png),
                "-o",
                str(destination),
            ]
            subprocess.run(command, check=True)
            if destination.stat().st_size < MAX_STICKER_BYTES:
                return
    raise ValueError(f"sticker exceeds {MAX_STICKER_BYTES} bytes: {destination}")


def _checkerboard(size: tuple[int, int], cell: int = 16) -> Image.Image:
    image = Image.new("RGBA", size, (250, 246, 236, 255))
    draw = ImageDraw.Draw(image)
    alternate = (232, 223, 204, 255)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=alternate)
    return image


def _make_proof(output_root: Path, variant: str, font_path: Path) -> Path:
    tile_width, tile_height = 288, 300
    proof = _checkerboard((tile_width * 4, tile_height * 2), cell=18)
    draw = ImageDraw.Draw(proof)
    label_font = ImageFont.truetype(str(font_path), 20)
    for index, sticker in enumerate(STICKERS):
        x = (index % 4) * tile_width
        y = (index // 4) * tile_height
        rendered = Image.open(output_root / variant / f"hanoman-{sticker.slug}.webp").convert("RGBA")
        rendered.thumbnail((244, 244), Image.Resampling.LANCZOS)
        proof.alpha_composite(rendered, (x + (tile_width - rendered.width) // 2, y + 6))
        draw.text(
            (x + tile_width // 2, y + 276),
            sticker.slug,
            font=label_font,
            fill=INK,
            stroke_width=3,
            stroke_fill=BONE,
            anchor="mm",
        )
    proof_path = output_root / "proof" / f"{variant}-contact-sheet.webp"
    proof_path.parent.mkdir(parents=True, exist_ok=True)
    proof.convert("RGB").save(proof_path, format="WEBP", quality=88, method=6)
    return proof_path


def _make_96_preview(output_root: Path, variant: str) -> Path:
    tile = 128
    proof = _checkerboard((tile * 4, tile * 2), cell=8)
    for index, sticker in enumerate(STICKERS):
        x = (index % 4) * tile
        y = (index // 4) * tile
        rendered = Image.open(output_root / variant / f"hanoman-{sticker.slug}.webp").convert("RGBA")
        rendered.thumbnail((96, 96), Image.Resampling.LANCZOS)
        proof.alpha_composite(rendered, (x + 16, y + 16))
    proof_path = output_root / "proof" / f"{variant}-96px-preview.webp"
    proof.convert("RGB").save(proof_path, format="WEBP", quality=90, method=6)
    return proof_path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_metadata(output_root: Path, sticker_paths: list[Path]) -> None:
    tray_path = output_root / "tray-icon.png"
    records = []
    for path in sticker_paths:
        variant = path.parent.name
        slug = path.stem.removeprefix("hanoman-")
        sticker = next(item for item in STICKERS if item.slug == slug)
        records.append(
            {
                "variant": variant,
                "slug": slug,
                "label": None if variant == "text-free" else sticker.label,
                "file": path.relative_to(output_root).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    manifest = {
        "name": "Hanoman",
        "publisher": "Nafanesia",
        "version": 1,
        "date": date.today().isoformat(),
        "format": {"type": "static-webp", "width": 512, "height": 512, "maxBytes": 100000},
        "trayIcon": {
            "file": tray_path.relative_to(output_root).as_posix(),
            "width": 96,
            "height": 96,
            "bytes": tray_path.stat().st_size,
            "sha256": _sha256(tray_path),
        },
        "stickers": records,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_root / "README.md").write_text(
        """# Hanoman WhatsApp stickers

Two packs derived from the approved Hanoman sticker masters:

- `text-free/` — eight reactions without baked copy.
- `id-text/` — the same reactions with Indonesian copy.

Every sticker is a transparent static WebP at 512×512 px and below 100 KB. `tray-icon.png` is the
shared 96×96 px pack icon. Raw files can be imported with a sticker-maker app; publishing a native
WhatsApp sticker app requires packaging them with the official Android or iOS sample integration.

The master artwork in the parent illustration directory remains authoritative and unchanged.

Indonesian labels use IBM Plex Sans Bold, licensed under the SIL Open Font License 1.1. The exporter
expects a local font file and does not bundle the font binary.
""",
        encoding="utf-8",
    )


def _write_zip(output_root: Path) -> Path:
    zip_path = output_root / "hanoman-whatsapp-stickers.zip"
    members = [
        *expected_sticker_paths(output_root),
        output_root / "tray-icon.png",
        output_root / "manifest.json",
        output_root / "README.md",
        output_root / "proof" / "text-free-contact-sheet.webp",
        output_root / "proof" / "id-text-contact-sheet.webp",
        output_root / "proof" / "text-free-96px-preview.webp",
        output_root / "proof" / "id-text-96px-preview.webp",
    ]
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in members:
            archive.write(path, path.relative_to(output_root))
    return zip_path


def verify_delivery(output_root: Path) -> None:
    paths = expected_sticker_paths(output_root)
    if len(paths) != 16 or any(not path.is_file() for path in paths):
        raise ValueError("delivery does not contain two complete eight-sticker packs")
    for path in paths:
        if path.stat().st_size >= MAX_STICKER_BYTES:
            raise ValueError(f"oversized sticker: {path}")
        image = Image.open(path).convert("RGBA")
        if image.size != (CANVAS, CANVAS):
            raise ValueError(f"invalid dimensions: {path} {image.size}")
        alpha = image.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            raise ValueError(f"empty sticker: {path}")
        if bbox[0] < SAFE_MARGIN or bbox[1] < SAFE_MARGIN or bbox[2] > CANVAS - SAFE_MARGIN or bbox[3] > CANVAS - SAFE_MARGIN:
            raise ValueError(f"unsafe content margin: {path} {bbox}")
        if any(alpha.getpixel(corner) != 0 for corner in ((0, 0), (511, 0), (0, 511), (511, 511))):
            raise ValueError(f"non-transparent corner: {path}")
    tray = output_root / "tray-icon.png"
    if not tray.is_file() or tray.stat().st_size >= MAX_TRAY_BYTES:
        raise ValueError("tray icon is missing or oversized")
    if Image.open(tray).size != (96, 96):
        raise ValueError("tray icon must be 96×96")
    with zipfile.ZipFile(output_root / "hanoman-whatsapp-stickers.zip") as archive:
        if len(archive.namelist()) != 23:
            raise ValueError("archive inventory is incomplete")


def export_pack(repo_root: Path, output_root: Path, font_path: Path) -> list[Path]:
    source_root = repo_root / "internal" / "assets" / "illustration"
    cwebp = shutil.which("cwebp")
    if cwebp is None:
        raise RuntimeError("cwebp is required")
    if not font_path.is_file():
        raise FileNotFoundError(font_path)

    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True)

    output_paths = []
    for variant in ("text-free", "id-text"):
        for sticker in STICKERS:
            source_path = source_root / sticker.source_name
            if not source_path.is_file():
                raise FileNotFoundError(source_path)
            source = Image.open(source_path).convert("RGBA")
            rendered = render_sticker(source, sticker.label if variant == "id-text" else None, font_path)
            destination = output_root / variant / f"hanoman-{sticker.slug}.webp"
            _encode_webp(rendered, destination, cwebp)
            output_paths.append(destination)

    ready = Image.open(output_root / "text-free" / "hanoman-ready.webp").convert("RGBA")
    ready.thumbnail((96, 96), Image.Resampling.LANCZOS)
    tray = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    tray.alpha_composite(ready, ((96 - ready.width) // 2, (96 - ready.height) // 2))
    tray.save(output_root / "tray-icon.png", format="PNG", optimize=True)

    _make_proof(output_root, "text-free", font_path)
    _make_proof(output_root, "id-text", font_path)
    _make_96_preview(output_root, "text-free")
    _make_96_preview(output_root, "id-text")
    _write_metadata(output_root, output_paths)
    _write_zip(output_root)
    verify_delivery(output_root)
    return output_paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Hanoman WhatsApp sticker packs")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("internal/assets/illustration/whatsapp"),
    )
    parser.add_argument("--font", type=Path, required=True)
    args = parser.parse_args()
    paths = export_pack(args.repo_root.resolve(), args.output.resolve(), args.font.resolve())
    print(f"exported {len(paths)} stickers to {args.output.resolve()}")


if __name__ == "__main__":
    main()
