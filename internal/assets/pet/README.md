# Pet Hanoman — atlas sprite PET-001

Satu atlas WebP 8 kolom × 13 baris (sel 192×208, karakter berdiri 168 px) + `pet.json`. Frame dibuat
Codex (GPT Image) dari `prompts/`, dipisah dan diregistrasi `internal/scripts/pet/`, dikomit sebagai
turunan (runner CI tak punya Codex). Spec: `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`;
ADR-0140. Spec B `docs/superpowers/specs/2026-08-22-spec-897-pet-jujur-lengkap-design.md` (SPEC-897,
tanpa ADR baru) menambahkan baris `deciding` dan `sleep`; spec C
`docs/superpowers/specs/2026-08-22-spec-898-pet-bicara-design.md` (SPEC-898, ADR-0141) menambahkan
`thanks`. Ketiganya di **ekor** array — indeks baris lama tak bergeser, jadi diff atlasnya minimal.
`thanks` BUKAN pose: ia baris reaksi sekali-putar (`then: idle`, seperti `wave`) yang hanya dipilih
saat pet dielus, jadi ia tak masuk `POSE_ROW`.

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
  (2026-08-22, SPEC-897). Ramalan "baris ke-13 tak akan muat" terbukti: **13 baris pada `quality=82`
  = 1 062 524 B**. Diukur ulang atas atlas 13 baris yang sama (2026-08-22, SPEC-898): `q78` =
  993 888 B (sisa **6 112 B**), `q76` = **952 452 B** (sisa 47 548 B), `q74` = 934 784 B. Dipilih
  **`q76`**, bukan q78 yang sebenarnya muat: sisa 6 KB berarti satu regenerasi baris rutin —
  operasi yang README ini sendiri dokumentasikan — akan menembus plafon dan menggagalkan
  `atlas.py`. Delta visual 76 vs 78 pada seni datar berkontur tegas dapat diabaikan. Atlas yang
  benar-benar dikomit (baris `thanks` percobaan 3) = **950 480 B** pada `q76`. Jangan menaikkan
  plafon — satu `<img>` yang di-decode di setiap halaman adalah anggaran, bukan preferensi.
- Ambang residu pra-pin `stand` (0,15) diturunkan dari baris **berdiri**; untuk baris **duduk**
  (`sleep`) heuristik "kaki = run kolom paling kanan di 8 % baris terbawah" memilih pangkuan/sarung
  yang memang ikut bernapas, jadi angkanya tak sebanding. Ukur ulang, jangan asumsikan.

## Review manusia (Gate 2 brand)

Lihat `qa/<key>.gif` dan `qa/<key>-contact.png` untuk setiap baris sebelum commit: siluet profil satu
mata, jamang, kain, ekor besar; tak ada mirror; gerak sesuai naskah. Gerbang numerik **tidak**
menangkap semuanya: `sleep` lolos `qa.py` pada percobaan pertama (residu 0,084) sambil memunculkan
ornamen ekor KEDUA yang berkedip di sebagian frame — cacat yang hanya terlihat mata. Yang harus
dibedakan secara sadar: `deciding` menengadah dengan ekor melengkung seperti tanda tanya (bukan
condong memindai ke kanan seperti `review`), `sleep` duduk dengan mata terpejam (bukan berdiri
lesu seperti `blocked`), dan `thanks` menyatukan **kedua** telapak di depan dada tanpa pernah
mengangkat tangan di atas bahu (bukan satu tangan setinggi kepala seperti `wave`). Band "pet"
80–128 px adalah pengecualian resmi atas "no chibi inflation"
(`internal/docs/brand/illustration/03-mascot-system.md`).

`thanks` butuh **tiga** generasi dan tiap kegagalannya berbeda kelas — dicatat karena polanya akan
terulang: percobaan 1 lolos `qa.py` (residu maks 0,144) tetapi memutar badan KELUAR dari profil di
frame 6–8 (dua mata terlihat) dan frame 8-nya bukan salinan frame 1, jadi baris sekali-putarnya tak
menyambung ke `idle` — dua cacat yang hanya terlihat mata. Percobaan 2 memperbaiki keduanya lalu
gagal gerbang numerik: karakter berubah ukuran & posisi antar-frame (tumpah 123 dan 305 px ke sel
tetangga, residu 0,259/0,296). Pelajarannya: koreksi komposisi yang diminta lewat `--note` membuat
model MELUPAKAN registrasi yang sebelumnya sudah benar, jadi `--note` percobaan berikutnya harus
mengulang **seluruh** batasan yang sudah dipenuhi, bukan hanya yang baru gagal.
