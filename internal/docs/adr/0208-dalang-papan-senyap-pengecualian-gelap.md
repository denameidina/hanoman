# ADR-0208 — Dalang sebagai papan senyap, dengan satu pengecualian gelap

- Status: Diterima · **Digantikan sebagian oleh [0219](0219-dalang-sinematik-dipulihkan.md)**: keputusan 1 (papan senyap) dan 4 (komponen lama dicabut) diganti; § 2 (jalan keluar), § 3 (pengecualian gelap), dan § 5 (jalan masuk) tetap berlaku
- Tanggal: 2026-10-11
- SPEC: Audit UI/UX 2026-10 · Fase 3B (tanpa nomor SPEC; keputusan dari audit)
- Terkait: **0205** (Dalang keluar dari sidebar; dibuka lewat palet "Buka panggung"), **0206** (pet tak punya slot di layar tanpa Shell), **0160** (rute `/dalang` tetap), **0202** (tak ada API baru, jadi tak ada keputusan MCP). Aturan token di [design-system § Kontras](../design-system/design-system.md) dan § Navigasi hub.

## Konteks

Dalang adalah takeover sinematik layar penuh tanpa Shell. Isinya: HUD berputar, scan line, float, kursor berkedip,
count-up, ticker mengetik, footer slogan, jam per detik, rig animasi, donut distribusi, grafik 7 hari, dan panel
aktivitas. Audit menilai layar ini 4/10. Mayoritasnya dekoratif dan duplikat Overview, pet, dan Terminal. Ticker dan
jam membuat seluruh layar me-render ulang (ticker tiap 26 ms, jam tiap 1 dtk). Teks "HANOMAN ONLINE / SEMUA SISTEM
NORMAL" tertulis tetap, bukan status nyata. Footer berkontras ±2,9:1. Audit mengusulkan "Dalang → aksi di Overview".

## Keputusan

### 1. Papan status senyap

Isi layar Dalang sekarang hanya:

- ringkasan satu baris dan status koneksi nyata dari `useEventsStatus` (Terhubung · Jeda · Koneksi terputus);
- seksi "Menunggu jawabanmu" di atas, dengan tombol Jawab per sesi;
- daftar project sebagai baris `<button>`: wayang `WayangSilhouette` 24 px, nama, fase, jumlah sesi, dan aksi.

Tanpa timer dan tanpa animasi.

### 2. Jalan keluar yang selalu terjangkau

Tombol keluar 44×44 ada di `.hn-dlg-actions` pada semua ukuran layar (`.hn-dlg-exit`). Sebelumnya tombol ✕ berada di
`.hn-dlg-chips` yang disembunyikan di bawah 768 px, sehingga layar Dalang tak punya jalan keluar di ponsel (audit,
P0). Layar dikembalikan ke layar terakhir yang dibuka (`previous`), dan Esc juga keluar.

### 3. Pengecualian gelap

Dalang adalah **satu-satunya layar gelap penuh**. Latarnya `var(--term-bg)`, teksnya `var(--term-fg)`, dan warna
hanya datang dari token terminal (`--term-*`) dan aksen brass/amber. Kontainernya `position: fixed; inset: 0;
z-index: 100` dan tanpa Shell. Di design system, "satu permukaan gelap: terminal log" menjadi dua: terminal log dan
panel Dalang. Angka kontras yang dipakai untuk fokus di panel itu (3,60:1 untuk `--border-focus` di `--term-bg`)
tercatat di design-system § Kontras.

Pengecualian ini hanya berlaku untuk Dalang. Layar lain yang ingin memakai latar gelap butuh keputusan baru.

### 4. Komponen lama dicabut

`DalangStage.tsx` dihapus di `c81413cb` (Fase 3 gelombang 2); dokumen Fase 2E mencatat pencabutan kelas CSS-nya.
`WayangSilhouette.tsx` tetap sebagai ikon project. Overview tak lagi
merender `DalangStage`, dan hero Overview dicabut.

### 5. Jalan masuk

Dalang tetap di luar sidebar (ADR-0205). Dibuka lewat palet "Buka panggung", pintasan `g d`, bantuan `?`, dan tombol
sekunder "Buka panggung" di Overview.

## Alternatif yang ditolak

1. **Pertahankan takeover sinematik dengan animasi yang dikurangi.** Ditolak: sebagian besar elemen tak punya makna
   status, dan ticker serta jam tetap membuat layar me-render ulang.
2. **Dalang dengan tema terang.** Ditolak: layar ini seluruhnya kerja aktif (sesi berjalan dan menunggu jawaban), dan
   token terminal sudah dipakai serta diukur kontrasnya. Memaksakan tema terang mengubah identitas layar tanpa manfaat
   yang terukur.
3. **Lebur Dalang menjadi aksi di Overview** (usulan audit). Tidak diambil dalam bentuk itu: Dalang tetap layar sendiri,
   dibuka dari Overview dan palet. Alasan pemilihan tidak tercatat di audit maupun di commit. ADR ini mengikuti
   implementasi yang ada.

## Konsekuensi & gotcha

- **Pet tidak tampil di Dalang.** Dokumen Fase 3B sebelumnya menyebut pet "tetap satu-satunya elemen yang bergerak" di
  Dalang. Kode tidak merendernya: di `App.tsx`, `section === "dalang"` dirender tanpa `Shell`, sehingga tak ada slot pet
  (lihat ADR-0206 § 5). Dokumen Fase 3B dikoreksi dalam commit yang sama.
- Dalang tanpa Shell tak punya topbar atau sidebar. Navigasi keluar hanya lewat ✕, Esc, dan tombol kembali.
- Test: `src/test/overview-screen.test.tsx` (kontrak Overview tanpa `DalangStage`), `src/test/dalang-hanoman.test.tsx`
  (papan senyap tanpa animasi dan timer, status koneksi, satu baris per project).

## Bukti

- Commit: `fce3210e` (tombol keluar 44×44, Fase 1), `e5d44eac` dan `c81413cb` (redesign Dalang, penghapusan
  `DalangStage.tsx` di `c81413cb`).
- Berkas: `src/src/screens/DalangHanomanScreen.tsx` (150 baris), `src/src/screens/styles/dalang.css`
  (`.hn-dlg { background: var(--term-bg) }`), `src/src/screens/WayangSilhouette.tsx`, `src/src/App.tsx` (cabang
  `section === "dalang"`).
- Dokumen: [frontend-implementation § Fase 3B](../frontend/frontend-implementation.md).
