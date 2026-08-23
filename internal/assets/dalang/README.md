# Aset dalang — figur orkestrator untuk DalangStage

Tiga aset transparan yang dipakai panel `DalangStage` di Overview (`src/src/screens/DalangStage.tsx`):

| berkas (display, dibundel) | master (tidak dibundel) | dipakai sebagai |
|---|---|---|
| `hnm-dalang-six-arms-v01.webp` (593×512) | `master/hnm-dalang-six-arms-master-v01.webp` | sang dalang — Anoman enam lengan, empat gapit KOSONG (wayang-nya kartu sesi di kelir), satu tangan di tumpukan docs, satu tangan terbuka |
| `hnm-wayang-project-v01.webp` (217×384) | `master/hnm-wayang-project-master-v01.webp` | satu wayang project di kartu sesi hidup |
| `hnm-blencong-v01.webp` (160×256) | `master/hnm-blencong-master-v01.webp` | lampu blencong di header panel — glow ditambahkan CSS saat ada sesi (`data-lit`), asetnya sengaja digambar TANPA glow |

Frontend mengimpor **versi display saja** (total ±134 KB) — pelajaran registry illustration: master
near-lossless dilarang masuk bundel (5,5 MB → 46,1 MB terukur di SPEC pack npm).

## Rekaman produksi (pola ADR-0140 + 07-prompt-library.md)

```yaml
model: "codex exec / GPT Image (imagegen)"
version: "codex-cli 0.146.0"
date: 2026-08-23
seed_or_job_id: "tidak diekspos codex — dinyatakan absen"
image_references:
  - "MOD-001 model character sheet (identity authority — dalang)"
  - "hnm-concept-dalang-orchestrating-v01 (pose enam lengan — dalang, wayang)"
  - "HRO-001 hero workflow (gaya — wayang)"
  - "hnm-concept-dalang-idle-v01 (bentuk lampu — blencong)"
prompt_blocks: [IDENTITY_CORE, STYLE flat pet-like, latar hijau #00FF00 pola ADR-0140]
negative_block: NEGATIVE_CORE (minus "extra limb" untuk dalang — pengecualian ikonografi
  yang sama dengan internal/assets/concepts/dalang/README.md)
selected_output: "generasi pertama tiap prompt, tanpa retry"
manual_changes: "chroma key hijau→alpha (petlib.chroma_key, key=median tepi), crop bbox+8px,
  resize display (512/384/256), WebP q82; master WebP q90 dari keyed penuh"
reviewer: "belum direview manusia (Gate 2 menyusul bila naik kelas jadi aset brand resmi)"
```

Prompt dikomit di `prompts/`. Regenerasi: gabungkan `prompts/<nama>.md` + `prompts/asset-common.md`
ke stdin `codex exec --skip-git-repo-check -s workspace-write -C <tmp> --add-dir
~/.codex/generated_images -i <referensi> -`, lalu key + resize dengan
`internal/scripts/pet/petlib.py::chroma_key` (butuh venv pillow+numpy — python Homebrew 3.14
tidak membawa keduanya).

Sisa jejak hijau kecil di sela ukiran (terlihat hanya pada zoom master) adalah residu chroma key;
bila aset naik kelas, bersihkan manual atau regenerate dengan margin lebih lebar.
