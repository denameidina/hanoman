# ADR-0121 — Operasi berkas dari IDE Explorer

Status: accepted · 2026-08-17

## Konteks

IDE Explorer lahir sebagai viewer diff (SPEC-182/234). Permukaan tulisnya tepat satu endpoint —
`PUT /projects/:id/file` — yang hanya bisa menimpa isi berkas yang path-nya sudah diketahui.
Memasukkan berkas dari mesin operator, membuat berkas/folder, mengganti nama, dan menghapus
tak punya jalur sama sekali; satu-satunya jalan adalah sesi agen atau shell di mesin server.
Untuk berkas biner jalan itu bahkan tak ada: isi berkas harus diketikkan lewat prompt.

## Keputusan

1. **Satu path untuk tiga operasi struktural.** `POST|PATCH|DELETE /projects/:id/entry`
   (buat · rename · hapus) plus `POST /projects/:id/upload` untuk unggahan multipart. Ketiga
   operasi struktural berbagi seluruh penjaga path yang sama; memecahnya jadi tiga endpoint
   berarti menyalin gerbang yang sama tiga kali — kelas bug SPEC-431/448/475.
2. **Logika di service murni `services/repo-fs.ts`**, di atas `safe-repo-path.ts` yang sudah
   ada. Penjaga path tak ditulis ulang. Konsekuensi yang diterima: komponen **symlink** ditolak,
   jadi berkas symlink tak bisa dihapus/di-rename lewat IDE.
3. **Otorisasi `ide:write`, bukan capability baru.** Capability itu sudah memberi hak menimpa
   isi berkas apa pun lewat `PUT /file`. Yang menjaga hapus/rename adalah **konfirmasi di UI**
   (folder menuntut namanya diketik ulang), bukan gerbang tambahan di server.
4. **Tanpa gerbang sesi aktif.** Alasan yang sama yang membebaskan `PUT /file` sejak awal: ini
   bukan operasi git dan tak memindahkan HEAD; sesi hidup di `.worktrees/<id>` yang terpisah.
   Memasangnya akan mematikan fitur ini persis pada project yang sedang dikerjakan.
5. **Folder kosong ditulis dengan `.gitkeep`.** Pohon Explorer dibangun dari `git ls-files`;
   tanpa `.gitkeep` folder baru adalah folder hantu yang hilang saat muat ulang.
6. **Unggahan di-stream, bentrok dilewati.** Part ditulis ke `.tmp` lalu di-`rename` (batas
   100 MB × 1000 berkas membuat `toBuffer` berbahaya di instance 8 GB). Berkas yang sudah ada
   dilewati kecuali `overwrite` diminta, dan dilaporkan di `skipped` pada respons 200 — pola
   `POST /branches/delete` (SPEC-360).
7. **Manifest, bukan `filename`.** Struktur folder dibawa field `manifest` (JSON array path
   relatif, urut sama dengan part berkas): nama berkas multipart yang mengandung `/` tak punya
   jaminan lintas implementasi.

## Konsekuensi

- Operator bisa merusak checkout project dari dashboard tanpa sesi agen. Itu memang maksudnya;
  pagarnya konfirmasi, dan git tetap memegang segala yang sudah ter-commit.
- Tak ada undo/trash di sisi hanoman, tak ada `git add` otomatis: berkas baru muncul sebagai
  untracked di Changed dan siapa yang meng-commit tetap urusan pintu git yang sudah ada.
- Batas unggah route ini terpisah dari registrasi multipart global; menaikkan salah satunya
  tak menaikkan yang lain, dan itu disengaja (lampiran gambar SPEC-816 tetap 5 MB).
- Gotcha implementasi yang mengikat: `saveUpload` memulangkan `exists` **tanpa membaca** stream
  part. Pemanggil multipart wajib `part.file.resume()`, kalau tidak busboy menunggu part yang
  tak pernah selesai dan seluruh request menggantung — ditemukan sebagai test yang timeout,
  bukan sebagai error.
