# Hanoman WhatsApp Sticker Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the eight approved Hanoman sticker masters as text-free and Indonesian-text WhatsApp packs.

**Architecture:** A deterministic Pillow script normalizes each source alpha bounding box, adds the
brand contour and optional label, then invokes `cwebp` for bounded-size delivery. A separate verifier
decodes the generated files and enforces the platform and pack constraints.

**Tech Stack:** Python 3, Pillow, `cwebp`, IBM Plex Sans Bold, ZIP, SHA-256.

## Global Constraints

- Preserve the eight existing raster masters; do not regenerate or overwrite them.
- Produce 512×512 transparent WebP stickers below 100 KB each.
- Produce a 96×96 PNG tray icon below 50 KB.
- Use the exact Indonesian copy defined in the design spec.
- Save all final deliverables under `internal/assets/illustration/whatsapp/`.

---

### Task 1: Reproducible exporter

**Files:**
- Create: `internal/scripts/export-whatsapp-stickers.py`
- Create: `internal/scripts/test-export-whatsapp-stickers.py`

**Interfaces:**
- Consumes: eight `hnm-ill-sticker-*-1x1-master-v01.webp` masters and an IBM Plex Sans Bold font.
- Produces: `export_pack(repo_root: Path, output_root: Path, font_path: Path) -> list[Path]`.

- [x] **Step 1: Write tests for the copy map, alpha normalization, contour, and output inventory.**
- [x] **Step 2: Run `python3 internal/scripts/test-export-whatsapp-stickers.py` and confirm it fails before the exporter exists.**
- [x] **Step 3: Implement the exporter with deterministic layout and bounded WebP compression.**
- [x] **Step 4: Run the script test and confirm it passes.**

### Task 2: Generate both packs and delivery metadata

**Files:**
- Create: `internal/assets/illustration/whatsapp/text-free/*.webp`
- Create: `internal/assets/illustration/whatsapp/id-text/*.webp`
- Create: `internal/assets/illustration/whatsapp/tray-icon.png`
- Create: `internal/assets/illustration/whatsapp/{manifest.json,README.md}`
- Create: `internal/assets/illustration/whatsapp/proof/*.webp`
- Create: `internal/assets/illustration/whatsapp/hanoman-whatsapp-stickers.zip`

**Interfaces:**
- Consumes: `export_pack(...)` from Task 1.
- Produces: two eight-item static sticker packs plus a shared tray icon and archive.

- [x] **Step 1: Run the exporter against the approved masters.**
- [x] **Step 2: Inspect the generated contact sheets and correct only deterministic layout parameters if needed.**
- [x] **Step 3: Generate the manifest, SHA-256 checksums, README, and ZIP archive.**

### Task 3: Delivery verification

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-hanoman-whatsapp-sticker-pack.md`

**Interfaces:**
- Consumes: all Task 2 deliverables.
- Produces: fresh evidence that the packs meet every delivery constraint.

- [x] **Step 1: Run the script test.**
- [x] **Step 2: Decode all 16 WebP files and verify size, alpha, transparent corners, and subject coverage.**
- [x] **Step 3: Verify manifest inventory, hashes, tray icon, proof sheets, and ZIP contents.**
- [x] **Step 4: Visually inspect both proof sheets at original resolution.**
- [x] **Step 5: Mark every completed plan item and review the final diff.**
