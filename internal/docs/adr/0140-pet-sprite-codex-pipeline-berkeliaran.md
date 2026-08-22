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
