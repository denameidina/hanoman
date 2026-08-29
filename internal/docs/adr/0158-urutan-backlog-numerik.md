# ADR-0158 — Urutan backlog diturunkan dari NOMOR spec, bukan dari string id-nya

- Status: Accepted
- Tanggal: 2026-08-29
- SPEC: —
- Terkait: **menegakkan** [0107](0107-paginasi-seragam-daftar-dashboard.md) (paginasi di layer
  response; urutan adalah bagian dari kontrak yang sama — tanpa urutan yang benar, paginasi
  memindahkan item ke halaman yang salah), [0090](0090-stempel-waktu-backlog-created-started.md).
  Menyentuh permukaan tunggal `liveSpecs` yang dibagi GET /specs & grup siar WS `specs` (SPEC-199).
  **Tidak mencabut apa pun.** Tanpa migration, tanpa kolom, tanpa endpoint.

## Konteks

`Spec.id` adalah STRING (`"SPEC-1015"`), dan `liveSpecs` mengurutkannya `orderBy: { id: "desc" }`.
SQLite membandingkannya karakter per karakter, jadi begitu backlog tembus empat digit urutannya
terbalik justru pada item terbaru:

```
"SPEC-999" > "SPEC-140" > "SPEC-1015" > "SPEC-1000"
                          ^ posisi ke-7: '0' < '4'
```

Semua SPEC-1000+ jatuh ke EKOR daftar, sesudah SPEC-140. Karena list view backlog dipaginasi
20/halaman (`BacklogScreen`, ADR-0107), item paling baru mendarat di halaman TERAKHIR — terbaca
sebagai "spec 1000 ke atas tidak tampil", bukan sebagai salah urut. Terukur saat ditemukan: 16 spec
(`SPEC-1000`…`SPEC-1015`) di project dengan 376 spec → halaman 19 dari 19.

Nomor berikutnya tak pernah ikut salah: `nextSpecId` (`services/id.ts`) sudah menurunkan max lewat
`parseInt`, bukan lewat perbandingan string. Jadi bug ini murni urutan BACA — tak ada id yang
tercetak ulang, tak ada data yang hilang.

## Keputusan

1. **Urutan diturunkan dari nomornya**, bukan dari string id. `liveSpecs` mengurutkan hasil
   `findMany` secara numerik menurun sesudah query.
2. **Diurutkan di JS, bukan di SQL.** SQLite tak bisa mengurut numerik pada kolom itu tanpa kolom
   turunan atau ekspresi index — dan biayanya nol di sini: `findMany` memang memuat set penuh
   karena filter & paginasi ADR-0107 dijalankan di layer response (`routes/specs.ts`), bukan di DB.
   `orderBy` DB dibiarkan sebagai urutan awal yang deterministik sebelum sort.
3. **Id tanpa angka jatuh ke 0, bukan ke NaN.** Ia tetap terbawa dan duduk di belakang. `NaN` dalam
   komparator membuat urutan tak terdefinisi — sebuah item bisa hilang dari pandangan lagi, dengan
   sebab yang berbeda.
4. **Perbaikan di `liveSpecs`, bukan di klien.** Permukaan itu satu-satunya yang mengurutkan spec
   dan dipakai HTTP maupun siar WS (SPEC-199); menambal urutan di klien akan membuat halaman kedua
   dan seterusnya tetap salah, karena yang memotong halaman adalah server.

## Konsekuensi

- Urutan backlog (list DAN board) berubah untuk backlog yang sudah punya spec empat digit. Untuk
  backlog yang belum, urutannya identik dengan sebelumnya.
- Kelas bug ini akan berulang di setiap kelipatan sepuluh berikutnya kalau urutan pernah kembali
  bersandar pada string id. Penjaganya `server/test/live-specs-order.test.ts`, yang membandingkan
  empat digit vs tiga digit secara eksplisit.
- Permukaan lain yang menampilkan spec (`/prds`, scheduler, pemilih lead) tak punya `orderBy` id
  sama sekali dan tak tersentuh keputusan ini.
