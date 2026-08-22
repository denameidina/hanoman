# ADR-0140 — Pet dashboard sebagai sprite beranimasi: aset dibuat AI lewat Codex, pipeline registrasi, renderer frame, berkeliaran di tepi bawah

Tanggal: 2026-08-22 · Status: diterima · Sumber: spec `docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`
Menegakkan ADR-0039 (tanpa channel realtime baru); menjadikan konvensi SPEC-585/648 (pet tanpa ADR)
keputusan arsitektur karena kini ada keluarga aset, pipeline, dan skrip baru; mengamandemen sistem
maskot brand (band "pet").

## Konteks

Pet SPEC-585/648 hanya bisa menggoyang satu sticker raster; aset maskot adalah raster AI tanpa
layer animasi. Referensi produk (Codex Pets, `/buddy` Claude Code) memakai frame nyata.

## Keputusan

1. **Aset**: keluarga `internal/assets/pet/` — atlas WebP 8 kolom × 10 baris (sel 192×208, karakter
   berdiri 168 px) + `pet.json`; strip per baris `rows/` adalah master yang dikomit, `raw/` tidak.
2. **Generator**: frame dibuat Codex (GPT Image) lewat `internal/scripts/pet/gen.py` dari prompt yang
   dikomit + model sheet; Codex adalah alat pengembang (seperti `cwebp`), turunannya dikomit, runner
   CI tak memanggilnya.
3. **Pipeline** mengunci pengukuran 2026-08-22: latar hijau + key yang mempertahankan warna (despill
   magenta memotong merah); deteksi sprite dari celah transparan (model tak menaati grid); registrasi
   offset+skala di wilayah statis dengan kaki = run kolom paling kanan (ekor menipu bbox) lalu pin
   wilayah statis frame 1; clip per sel dengan tumpahan sebagai gerbang; gerbang residu 0,15/0,30.
4. **Renderer**: satu `<img>` atlas; baris lewat `--row` (persen tinggi sel), frame lewat `steps(8)`
   atas `translateX(-100%)`; grammar SPEC-648 (transform/opacity, tanpa rAF) dipertahankan.
5. **Perilaku**: mesin berkeliaran murni (`pet-walk.ts`): berdiri 4–12 s / jalan 2–6 s @ 40 px/s di
   jalur tepi bawah; pose perhatian pulang ke pojok kanan; jeda saat hover/panel/tab tersembunyi;
   tier mobile, reduced-motion, dan `hanoman.pet.roam=0` menjangkar ke pojok. `walk-left` digambar,
   tidak pernah mirror.
6. **A11y**: kalimat status pindah ke `span` visually-hidden di dalam `role="status"`; atlas `alt=""`.
7. **Brand**: band "pet" 80–128 px (±2,5 head unit) untuk pet dashboard — pengecualian eksplisit atas
   "no chibi inflation"; Gate 2 lewat `qa/`. Pengecualian kedua diputuskan pemilik produk di Gate 2:
   baris `working` memegang **laptop** (juga sebuah "don't") karena pose kerja tanpa benda kerja tak
   terbaca di 112 px; berlaku HANYA untuk baris itu, digambar polos tanpa logo/gambar layar.

## Konsekuensi

- +1 atlas ≤ 1 MB di bundle; sticker STK-* tetap di katalog (glob eager), tak lagi dipakai pet.
- Regenerasi butuh Codex lokal; tanpa Codex, aset yang dikomit tetap lengkap.
- Roadmap B (terputus/lencana/panel multi-kondisi), C (gelembung/rekap/urgensi), D (inbox keputusan)
  menumpang renderer ini; baris atlas baru lewat pipeline yang sama.
- Terukur saat execute di Chrome headless lewat CDP — 1280×800 jalur 1265 px: atlas termuat, `animation-name: hn-pet-frames`, transform frame −256 → −640 px dalam 400 ms, actor 1136 → 1027,4 px (`mode: walk`, baris `working` lalu `walk-left`), dan tombol di bawah jalur tetap dijawab `elementFromPoint`; 390×844: actor diam di rumah 264 px, `mode: stand`, tak satu pun baris walk muncul, frame tetap berjalan, tap tetap tembus. Atlas 818 326 B
  dari anggaran 1 000 000 B (1536×2080, 10 baris). Dua jebakan harness yang membuat SELURUH
  pengukuran salah-negatif sebelum diperbaiki, dicatat untuk pembaca berikutnya: `/json/list`
  mendahulukan target `browser_ui` 0×0 di profil ber-ekstensi (ambil `type === "page"`), dan
  `--window-size` tak menetapkan layout viewport di `headless=new` (pakai
  `Emulation.setDeviceMetricsOverride`; halaman uji juga wajib punya `<meta name="viewport">` yang
  sama dengan `src/index.html`, tanpa itu emulasi ponsel memberi layout 980 px).

## Amandemen 2026-08-23 — SPEC-904 (Pet hidup E): mode `float`, dua gerbang baru, plafon 1,3 MB, atlas v02

Keputusan 1 & 3 dan butir pertama Konsekuensi diamandemen; sisanya ditegakkan.

- **Atlas naik ke `hnm-pet-anoman-atlas-v02.webp`, 16 baris** (`… thanks, held, falling, dizzy`),
  1536×3328, 1 165 556 B. v01 **dihapus, tidak disimpan berdampingan**: ia turunan murni dari
  `rows/` + `petlib.ROWS` dan tak bisa dirakit ulang dari state repo mana pun sesudah `ROWS`
  bertambah, jadi menyimpannya berarti menyimpan 950 KB yang tak punya pembaca dan tak bisa
  diverifikasi `verify.py`. Namanya ikut naik karena `pet.json` naik ke `version: 2` dan atlas
  di-`import` bundler dengan `?url` — nama yang berbeda membuat mustahil ada build yang memuat
  manifest v2 di atas piksel v1.
- **Mode registrasi keempat: `float`**, untuk baris yang tak menapak tanah (`held`, `falling`).
  Registrasi di wilayah ATAS seperti `walk`/`jump` (yang statis di sana adalah kepala/torso), tetapi
  `dy` diambil apa adanya dari registrasi seperti `stand`, dan tanpa pin. Memaksa piksel terendah ke
  baseline (`walk`) akan mendorong seluruh badan naik-turun mengikuti kaki yang menjuntai; busur
  `jump` diturunkan dari "tanah per baris lembar" yang di sini tak bermakna. Modenya lahir **tanpa
  cabang baru di alur**: `region_for` sudah mengembalikan wilayah atas untuk setiap mode non-`stand`,
  `build_strip` hanya menimpa `dy` di cabang `walk`/`jump`, dan `pin` default `mode == "stand"`.
  Terukur pada dua baris nyata: residu pra-pin `held` 0,025 dan `falling` 0,090, keduanya jauh di
  bawah gerbang `float` 0,35.
- **Gerbang kerataan langkah** untuk baris yang diputar berulang (`even: True` — `wave`, `held`,
  `falling`): `max/min` dari kedelapan langkah antar-frame — **termasuk sambungan 8→1, satu-satunya
  langkah yang tak terlihat di contact sheet maupun onion-skin** — harus ≤ 3,5 saat langkah
  terbesarnya ≥ 0,10. Gerbangnya **rasio, bukan nilai mutlak**: yang membuat loop tersendat adalah
  langkah besar yang bertetangga dengan langkah nyaris nol, bukan besar-kecilnya gerak. Dikalibrasi
  atas baris nyata yang sudah lolos Gate 2 — walk-left 2,06 · walk-right 2,33 · waiting 3,18 ·
  deciding 3,43 — dan menangkap `wave` v01 pada **7,08** (max 0,201 tangan turun di sebelah
  0,028/0,031, dua frame nyaris kembar di sambungan). Baris bernapas halus (`sleep` 21,3 · `blocked`
  6,9) dikecualikan ambang 0,10.
- **Gerbang skala karakter** (`body_ratio` ≥ 0,80, erosi r=5) untuk **setiap** baris. `build_strip`
  menskalakan **bbox** frame 1 menjadi `STAND_H`, jadi apa pun yang memperpanjang bbox mengecilkan
  badannya diam-diam. Terbukti mahal: `held` percobaan 1 **lolos setiap gerbang yang ada** — 8
  sprite, tumpahan 0, residu 0,021, rasio langkah 2,43 — sambil menggambar kepala 63 px vs 79 px
  milik `idle`, karena ekornya menjuntai lurus ke bawah dan ikut masuk bbox. Ketigabelas baris v01
  mengukur 0,839–0,911; `held` percobaan 1 mengukur 0,661.
- **`ATLAS_BUDGET` 1 000 000 → 1 300 000 B**, `quality` tetap 76. Butir Konsekuensi ADR ini dulu
  berbunyi "+1 atlas ≤ 1 MB di bundle"; 16 baris tak muat di sana pada kualitas mana pun yang layak.
  Terukur atas atlas 16 baris yang sebenarnya: q76 = 1 165 556 B · q60 = 1 058 832 · q40 = 929 558 ·
  q20 = 768 780 — **`quality` adalah tuas yang lemah** (q76 → q20 hanya −34 %) karena atlas ini
  didominasi kanal alpha lossless di atas seni datar berkontur tegas, dan atlas dirakit ulang dari
  `rows/` sehingga menurunkannya menurunkan ketigabelas baris yang sudah lolos Gate 2.
  `alpha_quality=60` (951 074 B) ditolak: alpha lossy di siluet potong, dan sisanya hanya 49 KB.
  Premis plafon lama ("satu `<img>` di-decode di setiap halaman") juga **tak dilayani `quality`**:
  biaya decode adalah **piksel** — 19,5 MiB RGBA pada 16 baris vs 15,8 MiB pada 13 — bukan byte.
  Atlas yang dikomit 1 165 556 B = **+22,6 %** vs v01, di dalam batas +40 % yang ditetapkan SPEC-904,
  menyisakan 134 444 B untuk satu regenerasi baris rutin.
- **Tak berubah:** sel 192×208, 8 kolom, `anchor.baseline` 202, `character.h` 168, renderer
  (`--row` + `steps(8)`), grammar SPEC-648, dan mesin berkeliaran. `held`/`falling`/`dizzy` **bukan
  pose**: `POSE_ROW`, `PetPose`, `HanomanPet.tsx`, dan `pet-walk.ts` tak disentuh SPEC-904 — baris
  itu dipakai backlog penerus yang membangun interaksi seretnya.
