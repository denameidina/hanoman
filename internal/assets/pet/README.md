# Pet Hanoman — atlas sprite PET-001

Satu atlas WebP 8 kolom × 16 baris (sel 192×208, karakter berdiri 168 px) + `pet.json`. Frame dibuat
Codex (GPT Image) dari `prompts/`, dipisah dan diregistrasi `internal/scripts/pet/`, dikomit sebagai
turunan (runner CI tak punya Codex). Spec: `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`;
ADR-0140. Spec B `docs/superpowers/specs/2026-08-22-spec-897-pet-jujur-lengkap-design.md` (SPEC-897,
tanpa ADR baru) menambahkan baris `deciding` dan `sleep`; spec C
`docs/superpowers/specs/2026-08-22-spec-898-pet-bicara-design.md` (SPEC-898, ADR-0141) menambahkan
`thanks`. Spec E `docs/superpowers/specs/2026-08-22-spec-904-pet-atlas-v02-diseret-design.md`
(SPEC-904, amandemen ADR-0140) menambahkan `held`, `falling`, dan `dizzy`, meregenerasi `wave`
supaya bisa diputar berulang, dan menaikkan atlas ke **v02** — v01 **dihapus**, bukan disimpan
berdampingan, karena ia turunan murni dari `rows/` + `petlib.ROWS` yang tak bisa dirakit ulang
sesudah `ROWS` bertambah. Semuanya di **ekor** array — indeks baris lama tak bergeser, jadi diff
atlasnya minimal. `thanks` BUKAN pose: ia baris reaksi sekali-putar (`then: idle`, seperti `wave`)
yang hanya dipilih saat pet dielus, jadi ia tak masuk `POSE_ROW`. `held`, `falling`, dan `dizzy`
juga bukan pose — ketiganya baris interaksi untuk pet yang **diseret**, dipakai backlog penerus.

## Isi

| path | apa | dikomit |
|---|---|---|
| `prompts/common.md` + `prompts/<key>.md` | naskah generasi; `common` = subjek/gaya/layout/registrasi/latar, `<key>` = 8 frame baris itu | ya |
| `ref/anoman-pet-model.png` | model sheet (frame 1 idle yang disetujui) — dilampirkan ke setiap generasi | ya |
| `rows/<key>.png` + `rows/<key>.report.json` | strip 8 frame 1536×208 terregistrasi + laporan registrasi | ya (master) |
| `hnm-pet-anoman-atlas-v02.webp` + `pet.json` | turunan; `sources` = hash `rows/` | ya |
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
pra-pin ≤ 0,25 (`stand`) / 0,30 (`walk`) / 0,35 (`float`) / 0,50 (`jump`), **kerataan langkah**
`max/min ≤ 3,5` untuk baris ber-`even` (SPEC-904), dan **skala karakter** `body_ratio ≥ 0,80`
(SPEC-904, berlaku untuk semua baris). Bila gagal, ulangi `gen.py` dengan `--note` (mis.
"keep the feet identical in every frame", "do not let the tail cross into the next cell").
`--note` wajib mengulang **seluruh** batasan yang sudah dipenuhi, bukan hanya yang baru gagal.

## Yang dikunci pengukuran (2026-08-22, diperluas 2026-08-23)

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
  `atlas.py`. Delta visual 76 vs 78 pada seni datar berkontur tegas dapat diabaikan. Atlas 13 baris
  yang dikomit (baris `thanks` percobaan 3) = **950 480 B** pada `q76`.
- **Plafonnya NAIK 1 MB → 1,3 MB pada SPEC-904**, `quality` tetap 76 — mencabut kalimat "jangan
  menaikkan plafon" di atas, dengan alasan terukur. 16 baris tak muat di 1 MB pada kualitas mana pun
  yang layak: q76 = **1 165 556 B** · q60 = 1 058 832 · q40 = 929 558 · q20 = 768 780. `quality`
  adalah **tuas yang lemah** di sini — q76 → q20 hanya −34 %, karena atlas ini didominasi kanal
  alpha lossless di atas seni datar berkontur tegas; bertahan di 1 MB butuh ±q48, dan karena atlas
  dirakit ulang dari `rows/`, itu menurunkan **ketigabelas** baris yang sudah lolos Gate 2.
  `alpha_quality=60` (951 074 B) ditolak: alpha lossy di siluet potong, dan sisanya hanya 49 KB —
  persis situasi "satu regenerasi rutin menembus plafon" yang dipakai menolak q78 dulu. Premis
  plafon lama ("satu `<img>` yang di-decode di setiap halaman") ternyata **tak dilayani `quality`**:
  biaya decode adalah **piksel** — 19,5 MiB RGBA pada 16 baris vs 15,8 MiB pada 13 — bukan byte.
  Atlas v02 yang dikomit = **1 165 556 B** (+22,6 % vs v01), sisa 134 444 B.
- **Setiap baris diskalakan sehingga bbox frame 1 = `STAND_H` (168 px)**, termasuk baris yang tak
  berdiri — terukur, ketigabelas strip v01 semuanya `h=168`, `bottom=202`. Konsekuensinya apa pun
  yang memperpanjang bbox **mengecilkan badannya diam-diam**: `held` percobaan 1 lolos SEMUA gerbang
  yang ada (8 sprite, tumpahan 0, residu 0,021, kerataan 2,43) sambil menggambar kepala **63 px vs
  79 px** milik `idle`, karena ekornya menjuntai lurus ke bawah. Karena itu ada gerbang
  `body_ratio ≥ 0,80` (tinggi bbox sesudah erosi r=5 ÷ tinggi bbox utuh): v01 duduk rapat di
  0,839–0,911, `held` percobaan 1 di 0,661. Untuk pose **meringkuk** gerbang ini tak mengikat —
  ukur **massa badan** sebagai gantinya (`falling` 5 936 px vs `idle` 5 968 px, selisih 0,5 %,
  sementara tingginya memang 134 vs 150 karena tubuhnya ditekuk).
- **Sambungan 8→1 tak terlihat di contact sheet maupun onion-skin.** `qa.py` karena itu mencetak
  kedelapan langkah antar-frame untuk semua baris dan menggerbangi rasio `max/min ≤ 3,5` untuk baris
  ber-`even` (`wave`, `held`, `falling`) saat langkah terbesarnya ≥ 0,10. `wave` v01 mengukur
  **7,08** — max 0,201 (tangan turun) bertetangga dengan 0,028/0,031 (dua frame nyaris kembar) —
  dan diregenerasi SPEC-904 menjadi **2,27**, dengan frame 8 di **pinggul** (satu langkah sebelum
  frame 1), bukan salinan pose istirahat. Catatan jujur: sesudah regenerasi langkah terbesar `wave`
  turun ke 0,075, **di bawah ambang 0,10**, jadi gerbangnya lolos secara **hampa** — rasio 2,27
  dibuktikan pengukuran langsung, bukan oleh gerbang yang menyala. Amplitudo dan kerataan memang
  saling menukar di baris 8 frame yang harus mulai dan berakhir dekat pose istirahat.
- **`detect_sprites` membuang blob kecil yang terpisah tanpa suara** (celah ≥ 8 kolom memisahkan,
  bbox < 40×80 px dibuang). Ornamen yang melayang lepas — bintang pusing `dizzy` — karena itu wajib
  **menyentuh** siluet karakter; kalau tidak ia hilang dari strip, atau membuat jumlah sprite ≠ 8.
- Ambang residu pra-pin `stand` (kini **0,25** — dinaikkan SPEC-897 dari 0,15 saat dikalibrasi ulang
  atas sepuluh baris nyata; angka yang mengikat ada di `petlib.RESIDUAL_GATE`) diturunkan dari baris
  **berdiri**; untuk baris **duduk**
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

`held` butuh **tiga** generasi dan `dizzy` **dua**, masing-masing gagal di kelas yang berbeda —
dicatat karena polanya berulang. `held` (1) lolos setiap gerbang sambil mengecilkan karakternya
(lihat butir `body_ratio` di atas — inilah yang melahirkan gerbang itu); (2) skala benar tetapi
frame 6 & 7 nyaris kembar → kerataan 5,77; (3) hijau: badan 0,887 · kerataan 2,54 · residu 0,025.
`dizzy` (1) lolos gerbang tetapi frame 7 & 8 nyaris kembar (langkah **0,009** — jeda 250 ms sebelum
kembali ke `idle`) dan figurnya berubah ukuran antar-frame (registrasi harus mengoreksi skala
0,94–1,08, terlebar dari seluruh baris; residu pasca-pin 0,181); (2) hijau: skala 1,00–1,02, residu
0,093, langkah terkecil 0,110. Yang harus dibedakan secara sadar di antara baris baru: `held`
tergantung dengan **kepala & bahu benar-benar diam** dan mata membelalak di **semua** frame;
`falling` meringkuk **tegak** dengan ekor terangkat tinggi (bukan bola kecil); `dizzy` **berdiri**
dengan kaki tertanam dan bintang **menempel** pada jamang.

`thanks` butuh **tiga** generasi dan tiap kegagalannya berbeda kelas — dicatat karena polanya akan
terulang: percobaan 1 lolos `qa.py` (residu maks 0,144) tetapi memutar badan KELUAR dari profil di
frame 6–8 (dua mata terlihat) dan frame 8-nya bukan salinan frame 1, jadi baris sekali-putarnya tak
menyambung ke `idle` — dua cacat yang hanya terlihat mata. Percobaan 2 memperbaiki keduanya lalu
gagal gerbang numerik: karakter berubah ukuran & posisi antar-frame (tumpah 123 dan 305 px ke sel
tetangga, residu 0,259/0,296). Pelajarannya: koreksi komposisi yang diminta lewat `--note` membuat
model MELUPAKAN registrasi yang sebelumnya sudah benar, jadi `--note` percobaan berikutnya harus
mengulang **seluruh** batasan yang sudah dipenuhi, bukan hanya yang baru gagal.
