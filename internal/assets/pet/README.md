# Pet Hanoman — atlas sprite PET-001

Satu atlas WebP 8 kolom × 12 baris (sel 192×208, karakter berdiri 168 px) + `pet.json`. Frame dibuat
Codex (GPT Image) dari `prompts/`, dipisah dan diregistrasi `internal/scripts/pet/`, dikomit sebagai
turunan (runner CI tak punya Codex). Spec: `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`;
ADR-0140. Spec B `docs/superpowers/specs/2026-08-22-spec-897-pet-jujur-lengkap-design.md` (SPEC-897,
tanpa ADR baru) menambahkan baris `deciding` dan `sleep` di **ekor** array — indeks baris lama tak
bergeser, jadi diff atlasnya minimal.

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
- 12 baris pada `quality=82` = **975 484 B**, muat di plafon `ATLAS_BUDGET` 1 MB dengan sisa 24,5 KB
  (2026-08-22, SPEC-897). Baris ke-13 **tidak** akan muat pada quality itu: turunkan `quality` di
  `atlas.py` dan catat angkanya di sini. Jangan menaikkan plafon — satu `<img>` yang di-decode di
  setiap halaman adalah anggaran, bukan preferensi.
- Ambang residu pra-pin `stand` (0,15) diturunkan dari baris **berdiri**; untuk baris **duduk**
  (`sleep`) heuristik "kaki = run kolom paling kanan di 8 % baris terbawah" memilih pangkuan/sarung
  yang memang ikut bernapas, jadi angkanya tak sebanding. Ukur ulang, jangan asumsikan.

## Review manusia (Gate 2 brand)

Lihat `qa/<key>.gif` dan `qa/<key>-contact.png` untuk setiap baris sebelum commit: siluet profil satu
mata, jamang, kain, ekor besar; tak ada mirror; gerak sesuai naskah. Gerbang numerik **tidak**
menangkap semuanya: `sleep` lolos `qa.py` pada percobaan pertama (residu 0,084) sambil memunculkan
ornamen ekor KEDUA yang berkedip di sebagian frame — cacat yang hanya terlihat mata. Yang harus
dibedakan secara sadar: `deciding` menengadah dengan ekor melengkung seperti tanda tanya (bukan
condong memindai ke kanan seperti `review`), dan `sleep` duduk dengan mata terpejam (bukan berdiri
lesu seperti `blocked`). Band "pet" 80–128 px adalah
pengecualian resmi atas "no chibi inflation" (`internal/docs/brand/illustration/03-mascot-system.md`).
