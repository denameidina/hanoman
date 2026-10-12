# ADR-0219 — Dalang sinematik dipulihkan; perbaikan aman dari audit dipertahankan

- Status: Diterima · **mengamandemen ADR-0208** (keputusan 1 "papan senyap" dan keputusan 4 "komponen lama dicabut" diganti; § 2 jalan keluar, § 3 pengecualian gelap, dan § 5 jalan masuk dari 0208 tetap berlaku)
- Tanggal: 2026-10-12
- SPEC: Audit UI/UX 2026-10 · keputusan pemilik (tanpa nomor SPEC)
- Terkait: **0208** (diamandemen), **0205** (Dalang di luar sidebar; dibuka lewat palet "Buka panggung", `g d`, bantuan `?`), **0206** (pet tak punya slot di layar tanpa Shell), **0160** (rute `/dalang` tetap; `previous` dari `lastPageRef`), **0202** (tak ada API baru, jadi tak ada keputusan MCP). Aturan token di [design-system § Kontras](../design-system/design-system.md#kontras-konfirmasi-dan-error-audit-uiux-2026-10--fase-1) dan § Permukaan gelap Dalang.

## Konteks

ADR-0208 memangkas Dalang menjadi papan status senyap. Dasarnya audit 2026-10 yang menilai layar 4/10: mayoritas elemen dekoratif dan duplikat Overview, pet, serta Terminal. Teks "HANOMAN ONLINE / SEMUA SISTEM NORMAL" tertulis tetap, bukan status nyata.

Pemilik meninjau hasil pemangkasan itu dan menetapkan keputusan final: **tampilan sinematik lama dikembalikan** (commit `8380d3fa`). Empat temuan audit yang benar tetap berlaku dan dipertahankan sebagai perbaikan aman:

- ponsel terjebak: tombol ✕ tersembunyi di bawah 768 px;
- ticker (26 ms) dan jam (1 dtk) me-render ulang seluruh layar;
- footer dan label kecil berkontras di bawah 4,5:1;
- status "SEMUA SISTEM NORMAL" palsu.

Seksi "Menunggu jawabanmu" dengan tombol Jawab per sesi (versi audit) juga dipertahankan.

## Keputusan

### 1. Panggung sinematik kembali

Isi layar Dalang kembali seperti `8380d3fa`: HUD berputar, scan line, float, kursor berkedip, hitungan naik, ticker mengetik, footer slogan, jam, rig animasi wayang dan dalang (badan dan empat lengan berputar di pivot), donut distribusi backlog, grafik 7 hari, panel aktivitas, dan wayang per project (empat varian, dipilih dengan hash stabil dari id). Sumber datanya tetap nyata: `sessions` (siaran WS), `projects`, dan `backlog`.

### 2. Perbaikan aman yang dipertahankan

- **Jalan keluar 44×44 di semua ukuran layar.** Tombol `.hn-dlg-exit` berada di `.hn-dlg-bar` dan tak pernah `display: none`. Klik dan Esc kembali ke layar `previous` (layar nav terakhir yang bukan Dalang), atau ke Overview bila dibuka langsung dari URL.
- **Ticker dan jam terisolasi.** `BootTicker` (ketikan 26 ms) dan `DalangClock` (1 dtk) adalah komponen anak `React.memo` dengan state sendiri. Hitungan KPI ada di `Kpi`. Tik-tik itu tak me-render layar induk. Perbandingan memo `BootTicker` memakai isi baris, bukan referensi array.
- **Reduced-motion.** Ticker statis di baris pertama, hitungan KPI langsung ke nilai akhir, dan animasi CSS padam (blok `prefers-reduced-motion` di `dalang.css`, ditambah blok global di `app.css`). Preferensinya dibaca dengan `matchMedia` dan ikut berubah bila pengguna mengganti pengaturannya saat layar terbuka.
- **Kontras.** Teks hanya memakai `--term-fg`, `--term-dim`, `--brass-300`, `--brass-400`, dan `--amber-500`. Semuanya lolos 4,5:1 di `--term-bg` (diuji `ui-audit-tokens.test.ts`). Footer memakai `--term-dim` (4,77:1). Versi lama `--brass-700` hanya 2,62:1 dan tak dipakai lagi. Teks minimal 11 px. Latar `.hn-dlg` padat `--term-bg`, bukan gradien, karena gradien membuat axe tak bisa menentukan latar teks. Latar kartu dibiarkan transparan: tint 3% di atasnya menurunkan `--term-dim` ke 4,47:1.
- **Status jujur.** Baris status dan ticker diturunkan dari `useEventsStatus` (Terhubung · Jeda · Koneksi terputus) dan dari ada tidaknya sesi yang menunggu. "HANOMAN ONLINE" hanya tampil saat socket terhubung. "SEMUA SISTEM NORMAL" dicabut karena tak pernah diukur. Tanpa yang menunggu, ticker menulis "TIDAK ADA YANG MENUNGGU JAWABANMU".
- **Menunggu jawabanmu.** Seksi di atas, satu baris dan satu tombol Jawab per sesi yang `decision && !deciding`. Tombol itu membuka terminal sesi tersebut.
- **Gaya dan CSS.** Seluruh gaya Dalang ada di `src/src/screens/styles/dalang.css`. Blok `.hn-dlg*` di `app.css` dicabut tanpa menambah `!important` (tetap 8). Tak ada inline style statis; hanya CSS-var dinamis (`--d`, `--x`, `--y`, `--donut`).

### 3. Yang tidak dipulihkan

- **`DalangStage.tsx` (hero Overview) tidak dipulihkan.** Keputusan pemilik menyangkut layar Dalang, bukan hero Overview. ADR-0208 § 4 dan 3B (Overview "Hari ini" tanpa hero) tetap berlaku, dan `overview-screen.test.tsx` mengunci kontraknya. `isToday` yang dulu diimpor dari `DalangStage` dipindah ke `DalangHanomanScreen.tsx`. Bila pemilik ingin hero Overview kembali, itu keputusan terpisah.
- **Pet tetap tak tampil** di Dalang (ADR-0206 § 5).
- **Komponen `WayangSilhouette`** tetap dipakai sebagai glyph baris "Menunggu jawabanmu" (ADR-0208).

### 4. Yang tetap

Jalan masuk (palet "Buka panggung", `g d`, bantuan `?`, tak di sidebar; ADR-0205), rute `/dalang`, prop `previous`, dan `useEventsStatus`. Tak ada API baru.

## Alternatif yang ditolak

1. **Pertahankan papan senyap ADR-0208.** Ditolak pemilik. Layar kehilangan identitasnya, dan keputusan pemilik bersifat final.
2. **Pulihkan persis seperti `8380d3fa`.** Ditolak. Itu membawa kembali jebakan ponsel (✕ tersembunyi di bawah 768 px), ticker dan jam di induk, teks "SEMUA SISTEM NORMAL", dan teks di bawah 4,5:1. Pemilik meminta perbaikan aman dipertahankan.
3. **Hero Overview ikut dipulihkan.** Ditolak dalam ADR ini (lihat § 3).
4. **Ikon KPI berwarna lewat `color`.** Ditolak. `wind-500` dan `leaf-500` hanya 4,01:1 dan 4,05:1 sebagai teks di `--term-bg`. Warnanya diberikan lewat `stroke` dan `background`, yang diukur sebagai grafis (WCAG 1.4.11, 3:1).
5. **Donat dan grafik tetap SVG dengan label di atasnya.** Ditolak. Axe menganggap setiap `svg` sebagai gambar yang menghalangi pengukuran kontras, sehingga teks di atasnya dilaporkan `incomplete`. Donat dibuat dengan `conic-gradient` di atas disc padat. Label sumbu grafik dipindah ke HTML di luar kotak SVG.

## Konsekuensi & gotcha

- **Tes.** `src/test/dalang-hanoman.test.tsx` mengunci isolasi (penghitung render tombol keluar tetap saat 200 ketikan ticker dan 4 detik jam), reduced-motion, status jujur, jalan keluar, dan tanpa inline style statis. `src/test/ui-audit-tokens.test.ts` mengunci kontras teks `dalang.css` ≥ 4,5:1, ukuran ≥ 11 px, dan tombol keluar 44×44 di `dalang.css`. Mutasi yang menaruh timer 1 dtk di layar induk membuat tes isolasi gagal, jadi tes itu benar-benar menjaga kontrak.
- **Axe dan SVG.** Jangan mengembalikan teks yang menumpang di atas `svg` atau latar gradien ke layar ini. Axe akan melaporkan `color-contrast` berstatus `incomplete`, dan itu tak boleh terjadi di `/dalang`.
- **Nama ikon.** Hanya nama yang ada di `ds/icon-registry.ts` yang dirender. `calendar` dan `clock` tidak ada (ikonnya kosong tanpa galat), jadi dipakai `calendar-clock` dan `history`.
- **Visual terbukti di Chrome** (server QA di port 8800, worktree `dalang-restore`; 8799 dipakai sesi lain dan tak disentuh):
  - tombol keluar 44×44 di 390, 1024, dan 1280 px;
  - klik tanpa `previous` menuju `/overview`, dengan `previous` menuju `/projects`, dan Esc sama;
  - tidak ada overflow horizontal;
  - font minimum 11 px;
  - console bersih;
  - axe-core 4.13 (tag WCAG 2.2 A/AA dan best-practice): 0 pelanggaran dan 0 `incomplete` di 390, 1024, dan 1280;
  - saat ticker berjalan selama 5 dtk: 0 long task, skrip 27–35 ms per 5 dtk. Dengan reduced-motion: 8–11 ms per 5 dtk. Angka dari run final pada build terakhir.
- **Yang belum terverifikasi di Chrome.** Wayang hidup dan benang emas, kartu "menunggu jawabanmu", dan baris Jawab tidak terlihat di QA karena tak ada sesi tmux hidup. Glyph `WayangSilhouette` dengan `fill="var(--…)"` sudah dicek di Chrome, tetapi tidak di layar ini.

## Bukti

- Sumber pemulihan: `8380d3fa` (`src/src/screens/DalangHanomanScreen.tsx`, `src/src/app.css` blok `.hn-dlg*`, `src/test/dalang-hanoman.test.tsx`). Pembersihan `DalangStage` di `c81413cb`, tombol keluar 44×44 di `fce3210e`.
- Berkas: `src/src/screens/DalangHanomanScreen.tsx`, `src/src/screens/styles/dalang.css`, `src/src/app.css` (blok Dalang dicabut), `src/test/dalang-hanoman.test.tsx`, `src/test/ui-audit-tokens.test.ts`.
- Dokumen: [frontend-implementation § Dalang sinematik dipulihkan](../frontend/frontend-implementation.md), [design-system § Permukaan gelap Dalang](../design-system/design-system.md).
