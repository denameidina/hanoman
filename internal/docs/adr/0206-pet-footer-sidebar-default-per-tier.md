# ADR-0206 — Pet di footer sidebar desktop, mati default di tablet dan ponsel, chip di viewport pendek

- Status: Diterima · **sebagian menggantikan ADR-0144** (keputusan 4 dan angka plafon di Konsekuensi) dan **menggantikan lokasi jalur** di ADR-0140 keputusan 5 ("berkeliaran di tepi bawah")
- Tanggal: 2026-10-11
- SPEC: Audit UI/UX 2026-10 · perbaikan QA Chrome (tanpa nomor SPEC)
- Terkait: menegakkan **0144** keputusan 1–3 dan 5–7 (mesin murni `pet-walk.ts`, `parkedX`, `--ease-fall`, `dizzy`, lambaian yang tak terpotong), **0140** keputusan 6 (a11y), **0115** (preferensi tampilan per browser di ui-state), **0039** (tanpa channel realtime baru), **0205** (sidebar 8 hub; footer pet di bawah daftar hub), **0202** (tak ada API baru, jadi tak ada keputusan MCP).

## Konteks

Pet hidup di jalur `position: fixed` setinggi satu sel di tepi bawah viewport, di atas konten (ADR-0140, lalu 0144).
Jalur itu tidak memesan ruang: layar harus menyediakan ruangnya sendiri, dan kontrol di bawah bisa tertutup.
Hasil QA Chrome nyata memperlihatkan dua masalah yang sama. Pertama, pet menutupi kontrol: commit `56eb30cd`
mencatat "lajur pet (maskot tak lagi menutupi kontrol)". Kedua, di viewport pendek desktop, sidebar dengan
delapan hub (ADR-0205) plus pet setinggi sprite (±147 px) tak muat tanpa gulir: commit `cfabc308` mencatat
"dock pet menciut jadi chip pada tinggi ≤760px agar 8 hub muat". Di tablet dan ponsel, pet tampil terus dan
memakan ruang tetap di layar yang sudah sempit.

Audit 2026-10 menilai pet sebagai dekorasi yang harus berfungsi (aturan minimalis 8: "pet/animasi hanya untuk
status"), dan mencatat responsif yang dilawan dengan `!important` (sistemik 8). Keputusan ini memindahkan pet
ke alur layout dan menetapkan default per tier.

## Keputusan

### 1. Pet duduk di alur layout, bukan overlay tetap

`HanomanPet` dibuat **sekali** di `App` (di dalam `PetDockContext.Provider` yang membungkus `{screen}`). `Shell`
menaruhnya di slot-nya:

- **Desktop (≥1200 px):** `.hn-shell-dock` di footer sidebar, di bawah daftar hub (`data-pet-slot="sidebar"`).
  Root setinggi sel pet (menciut ke chip saat viewport pendek, lihat § 3).
- **Tablet dan ponsel:** `.hn-shell-lane` di bawah `<main>` (`data-pet-slot="lane"`). Area gulir berakhir di
  atas lajur, sehingga tak ada kontrol yang tertutup. Lajur selalu setinggi **chip 56 px** (`LANE_CHIP_H`), rata
  kanan, dengan tombol 44 px.

Root pet tidak memakai `position: fixed`. Slot kosong (`:empty`) tak memesan ruang.

### 2. Default per tier; pilihan eksplisit menang

Preferensi `hn.ui.v1.pet.enabled` (`ui-state/pet-pref.ts`), dengan `null` berarti "belum dipilih":

```
petVisibleOn(enabled, tier) = enabled ?? tier === "desktop"
```

Desktop tampil; tablet dan ponsel mati sampai dinyalakan. Preferensi ditulis oleh palet ("Tampilkan Hanoman" /
"Sembunyikan Hanoman"), tombol Sembunyikan di panel pet, dan baris Pengaturan › Sesi harian "Tampilkan Hanoman
(pet)" (Default · Tampilkan · Sembunyikan). Preferensi per browser dan tak pernah dikirim ke server.

### 3. Desktop pendek: chip, bukan hilang

Viewport `(min-width: 1200px) and (max-height: 760px)` (`PET_COMPACT_QUERY` di `HanomanPet.tsx`, sama dengan
`@media` di `app.css` yang merapatkan jarak sidebar) menciutkan pet menjadi chip: hanya tombol bangkitkan 44 px,
berjarak 22 px dari tepi bawah. Chip tak merender sprite dan tak merender lencana hitungan (`pet-badge`). Pet yang dibangkitkan dari chip ini bersifat sementara (`peek`) dan tak dipersist, karena
tinggi layar bisa berubah.

### 4. Overlay hanya untuk yang sementara

Overlay yang disengaja: gelembung bicara, panel status, dan sprite yang dibangkitkan di tablet/ponsel. Semuanya
ditutup Esc atau klik di luar; Esc saat panel terbuka menutup panel dulu. Sprite yang diangkat tangan (`held`,
`falling`) boleh melayang di atas konten; **jalur tidak melebar**. Plafon angkat adalah tinggi viewport
(`laneHeight()` = `window.innerHeight`), dan `pointer-events: none` di root tetap berlaku.

### 5. Layar tanpa Shell tak punya slot

Dalang (ADR-0208) dirender di luar `Shell`. Pet tidak tampil di sana.

## Alternatif yang ditolak

1. **Jalur `position: fixed` di tepi bawah dengan ruang pemesan (ADR-0144 apa adanya).** Ditolak: pet menutupi
   kontrol di QA Chrome (`56eb30cd`), dan setiap layar harus memesan ruang bawah.
2. **Chip permanen di tablet dan ponsel (default menyala).** Ditolak: chip 56 px memakan baris tetap di layar
   sempit, sementara pet adalah dekorasi. Pengguna tetap bisa menyalakannya dalam satu langkah.
3. **Pet hilang sepenuhnya di desktop pendek.** Ditolak: chip 66 px tetap memungkinkan pet dibangkitkan, dan
   sidebar tetap termuat.
4. **Simpan preferensi pet di server.** Ditolak: ini state tampilan per browser (ADR-0115).

## Konsekuensi & gotcha

- **Menggantikan sebagian ADR-0144.** Keputusan 4 (jalur melebar ke `top: max(0px, var(--safe-top))` selagi
  `held`/`falling`, dengan `position: fixed`) dan angka plafon 661 px / 725 px di Konsekuensi tak lagi berlaku.
  Konteks 0144 tentang jalur fixed di tepi bawah juga digantikan. Keputusan 1–3 dan 5–7 tetap berlaku, dan
  `pet-walk.ts` tak berubah karenanya.
- **Perubahan default untuk tablet dan ponsel:** pengguna di kedua tier tak lagi melihat pet secara default. Ini
  tercatat di commit `82b5dee4` ("tablet/ponsel default mati").
- `--pet-h` hanya dipakai bar `position: fixed` di ponsel (aksi QA). `.hn-shell-main` tak lagi memesan ruang pet.
- Keterbatasan: uji layout di 320 / 390 / 768 / 1024 px per layar belum tercatat (audit, butir 15). Angka 661 px
  berasal dari dokumen desain, bukan dari pengukuran ulang.
- Tak ada API atau skema baru, sehingga tak ada keputusan MCP.

## Bukti

- Commit: `56eb30cd` (lajur tak menutupi kontrol), `82b5dee4` (footer sidebar; tablet/ponsel default mati),
  `cfabc308` (chip ≤760 px; toggle pet), `59aa000a` (chip 56 px di tablet dan ponsel).
- Berkas: `src/src/screens/HanomanPet.tsx` (`PET_COMPACT_QUERY`, `LANE_CHIP_H`, `laneHeight`, `dismiss`),
  `src/src/ds/shell.tsx` (`PetDockContext`, `data-pet-slot`), `src/src/ui-state/pet-pref.ts` (`petVisibleOn`),
  `src/src/App.tsx` (`petOn`, mount di `PetDockContext`), `src/src/app.css` (`@media (min-width: 1200px) and
  (max-height: 760px)`).
- Tes: `src/test/pet-dock-slot.test.tsx`, `src/test/pet-lane.test.tsx`, `src/test/pet-pref.test.tsx`,
  `src/test/settings-pet-toggle.test.tsx`.
- Dokumen: [design-system § Sistem responsif bersama](../design-system/design-system.md),
  [frontend-implementation § Pet Hanoman](../frontend/frontend-implementation.md).
