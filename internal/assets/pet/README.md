# Pet Hanoman — atlas sprite PET-001

Satu atlas WebP 8 kolom × 10 baris (sel 192×208, karakter berdiri 168 px) + `pet.json`. Frame dibuat
Codex (GPT Image) dari `prompts/`, dipisah dan diregistrasi `internal/scripts/pet/`, dikomit sebagai
turunan (runner CI tak punya Codex). Spec: `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`;
ADR-0140.

## Isi

| path | apa | dikomit |
|---|---|---|
| `prompts/common.md` + `prompts/<key>.md` | naskah generasi; `common` = subjek/gaya/layout/registrasi/latar, `<key>` = 8 frame baris itu | ya |
| `ref/anoman-pet-model.png` | model sheet (frame 1 idle yang disetujui) — dilampirkan ke setiap generasi | ya |
| `rows/<key>.png` + `rows/<key>.report.json` | strip 8 frame 1536×208 terregistrasi + laporan registrasi | ya (master) |
| `hnm-pet-anoman-atlas-v01.webp` + `pet.json` | turunan; `sources` = hash `rows/` | ya |
| `qa/` | contact sheet, onion-skin, GIF per baris — bukti review manusia | ya |
| `raw/` | keluaran mentah Codex + keyed + log | tidak (`.gitignore`) |

## Regenerasi satu baris

```bash
python3 internal/scripts/pet/gen.py <key> [--note "catatan reviewer"]   # Codex → raw/<key>.png (±3 menit)
python3 internal/scripts/pet/key.py <key>                                # → raw/<key>.keyed.png
python3 internal/scripts/pet/register.py <key>                           # → rows/<key>.png + report
python3 internal/scripts/pet/qa.py <key>                                 # gerbang + qa/<key>.gif
python3 internal/scripts/pet/atlas.py                                    # rakit atlas + pet.json (semua baris)
python3 internal/scripts/pet/verify.py                                   # cek artefak yang dikomit
```

Gerbang `qa.py`: 8 sprite terdeteksi, tak ada sprite menyentuh tepi lembar, tumpahan sel 0 px, residu
pra-pin ≤ 0,15 (`stand`) / 0,30 (`walk`/`jump`). Bila gagal, ulangi `gen.py` dengan `--note` (mis.
"keep the feet identical in every frame", "do not let the tail cross into the next cell").

## Yang dikunci pengukuran (2026-08-22)

- Model tak menaati grid sel → sprite dideteksi dari celah transparan, bukan dipotong per grid.
- Jangkar kaki tertarik ujung ekor → kaki = run kolom paling kanan; registrasi + pin wilayah statis.
- Latar magenta + despill memotong merah (emas → olive) → latar hijau; key di pipeline, bukan oleh Codex.
- Karakter 192 px menumpahkan ekor ke sel tetangga → karakter berdiri 168 px (`character.h`).

## Review manusia (Gate 2 brand)

Lihat `qa/<key>.gif` dan `qa/<key>-contact.png` untuk setiap baris sebelum commit: siluet profil satu
mata, jamang, kain, ekor besar; tak ada mirror; gerak sesuai naskah. Band "pet" 80–128 px adalah
pengecualian resmi atas "no chibi inflation" (`internal/docs/brand/illustration/03-mascot-system.md`).
