# SPEC-744 — Ubah status backlog dari halaman detail

## Objective

Di halaman detail backlog, operator dapat memundurkan stage ke target yang sah, memahami
konsekuensinya sebelum menyimpan, mengonfirmasi penghapusan artefak fase bila diperlukan, lalu
melihat stage terbaru dan umpan balik sukses atau gagal tanpa meninggalkan detail backlog.

## Konteks terukur

`SpecDetail` sudah mempunyai dropdown **Kembalikan stage**, dan server sudah menegakkan kontrak
backward-only melalui `PATCH /specs/:id { stage, confirmDelete? }` (SPEC-167/ADR-0027). Namun
dropdown itu langsung mengirim request saat pilihan berubah. Operator tidak memperoleh jeda untuk
menilai konsekuensi atau membatalkan pilihan sebelum request, dan jalur konfirmasi menutup seluruh
detail setelah sukses. Kontrol juga belum mengunci interaksi selama request, sehingga pemilihan atau
konfirmasi berulang dapat mengirim submit ganda.

Kontrak server yang ada sudah cukup:

- target maju, sama dengan stage aktif, atau tak dikenal ditolak server;
- request mundur tanpa artefak langsung mengubah stage;
- request mundur yang akan menghapus artefak membalas
  `{ pending: true, stage, wouldDelete[] }` tanpa mutasi;
- request kedua dengan `confirmDelete: true` menghapus artefak lalu mengubah stage;
- kode, commit, dan sesi hidup tidak dihapus oleh revert stage.

## Keputusan

Kontrol status tetap hidup di `SpecDetail`, tepat di bawah stage bar. Kontrol menampilkan stage
aktif sebagai konteks dan hanya memasukkan target yang lebih awal ke dalam pilihan. Teks bantu
menjelaskan mengapa stage aktif atau stage lebih maju tidak tersedia: kemajuan berasal dari fase
sesi, sedangkan perubahan manual hanya boleh mundur.

Memilih target tidak memanggil API. Pilihan disimpan sebagai draft lokal, lalu panel konsekuensi
menjelaskan:

- perubahan `stage aktif → target`;
- fase sesi yang sudah berjalan tidak dibatalkan;
- dokumen Spec/Plan di atas target mungkin perlu dihapus setelah konfirmasi;
- kode dan commit tidak disentuh.

Tombol **Simpan status** baru aktif setelah target sah dipilih. Submit pertama memakai
`PATCH /specs/:id { stage }`. Bila tidak ada artefak, respons `Spec` mengganti item yang sama di
state backlog; detail tetap terbuka dan karena ia membaca item dari state itu, stage bar serta
kontrol langsung menampilkan nilai baru. Toast existing melaporkan sukses.

Bila respons `pending`, dialog `confirmDelete` existing tetap menjadi langkah kedua. Dialog
menampilkan daftar `wouldDelete`, lalu tombol **Hapus & kembalikan** mengirim request yang sama
dengan `confirmDelete: true`. Setelah sukses hanya dialog konfirmasi yang ditutup; detail induk
tetap terbuka dan tersinkron. Batal menutup dialog tanpa mutasi dan mempertahankan detail.

Satu state `busy` mencakup submit awal dan submit konfirmasi. Selama `busy`, select, Simpan,
Batal, dan Hapus & kembalikan tidak dapat mengirim operasi lain; tombol aktif menampilkan loading.
Kegagalan mempertahankan detail dan draft target agar operator dapat membaca toast gagal lalu
mencoba lagi. Sumber sinkronisasi tetap state backlog milik `App` dan siaran specs existing;
tidak ada fetch atau endpoint baru.

## Alternatif yang ditolak

1. **Tetap auto-submit saat memilih.** Lebih ringkas, tetapi tak memenuhi kebutuhan melihat
   konsekuensi sebelum menyimpan dan tetap rentan submit berulang.
2. **Memanggil PATCH saat memilih sebagai preview.** Kontrak saat ini hanya dry-run bila ada
   artefak; target tanpa artefak langsung bermutasi. Memakainya sebagai preview akan berbohong.
3. **Endpoint preview baru.** Dapat mengembalikan daftar artefak sebelum tombol Simpan, tetapi
   menambah kontrak server untuk informasi yang baru dibutuhkan saat submit. Brief secara eksplisit
   meminta reuse stage dan PATCH yang ada.

## Acceptance criteria

- WHEN detail backlog dibuka, THE SYSTEM SHALL menampilkan stage aktif dan hanya menawarkan stage
  yang lebih awal sebagai target perubahan manual.
- WHILE stage belum mempunyai target mundur yang sah, THE SYSTEM SHALL menjelaskan bahwa kemajuan
  stage hanya berasal dari fase sesi dan SHALL menonaktifkan penyimpanan status.
- WHEN operator memilih target sah, THE SYSTEM SHALL menampilkan transisi dan konsekuensi perubahan
  sebelum request dikirim.
- WHEN operator menekan **Simpan status**, THE SYSTEM SHALL mengirim tepat satu
  `PATCH /specs/:id { stage }` dan SHALL mengunci kontrol sampai request selesai.
- IF PATCH membalas `pending`, THEN THE SYSTEM SHALL menampilkan daftar artefak dari `wouldDelete`
  dan SHALL tidak mengubah stage sebelum operator mengonfirmasi.
- WHEN operator mengonfirmasi penghapusan, THE SYSTEM SHALL mengirim tepat satu PATCH dengan
  `confirmDelete: true` dan SHALL mengunci kedua dialog sampai request selesai.
- WHEN perubahan berhasil, THE SYSTEM SHALL mempertahankan detail backlog terbuka, menyegarkan
  stage bar dan pilihan berdasarkan `Spec` terbaru, serta menampilkan toast sukses.
- IF perubahan gagal, THEN THE SYSTEM SHALL mempertahankan detail backlog terbuka dan menampilkan
  toast gagal tanpa menganggap stage berubah.
- THE SYSTEM SHALL tidak menambah endpoint, status, skema, atau aturan kemajuan stage baru.

## Rencana bukti

Test komponen `revert-stage.test.tsx` mengikat empat perilaku: target yang ditawarkan hanya lebih
awal; memilih target belum memanggil callback dan menampilkan konsekuensi; submit biasa memperbarui
detail serta kartu daftar tanpa menutup modal; alur `pending → confirmDelete` tetap dua langkah dan
terkunci terhadap submit ganda maupun penutupan lewat ×/Escape saat request berjalan. Test juga
mencakup kegagalan agar detail/draft tetap hidup.

Perubahan murni frontend dan memakai endpoint existing, sehingga tidak membutuhkan boot server,
migration, perubahan API contract server, atau ADR baru. Verifikasi terarah mencakup test web yang
berhubungan, typecheck paket `src`, lint hanya berkas berubah bila script lint terarah tersedia, dan
test route existing hanya bila implementasi ternyata menyentuh kontrak server.
