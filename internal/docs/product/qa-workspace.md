# Workspace QA — panduan pemakai

Workspace QA (menu **QA** di sidebar) menyimpan laporan QA per project: ringkasan hasil, test case,
temuan (bug) lengkap dengan langkah repro, dan lampiran (screenshot, log, PDF). Tujuannya satu: laporan
bisa **dibaca orang lain tanpa bertanya** dan kelak langsung dipakai sebagai bahan perbaikan project.
Keputusan desain: [ADR-0174](../adr/0174-workspace-qa.md).

## Alur singkat

1. **Laporan baru** → isi judul, versi, penguji, sistem operasi, browser, perangkat, alamat aplikasi,
   dan cakupan (apa yang diuji dan apa yang sengaja **tidak**).
2. Tab **Langkah uji** (test case): tambah langkah uji; catat hasil per case (`pass` / `fail` / `blocked` / `skipped`).
3. Tab **Temuan**: satu temuan = satu masalah. Isi repro bernomor (satu langkah per baris), Expected vs
   Actual, tautkan ke test case, lalu lampirkan screenshot.
4. Pilih **Keputusan** (`go` / `no-go` / `conditional`) dan tulis ringkasan alasannya, lalu **Ajukan laporan**.
   Mengajukan/menyelesaikan laporan ditolak bila keputusan belum diisi.
5. **Selesaikan dan kunci** mengunci laporan (read-only). **Buka kembali** bila perlu merevisi.

## Severity ≠ prioritas

| | Pertanyaan | Nilai |
|---|---|---|
| **Severity** | Seberapa parah dampak teknisnya? | `blocker` (sistem tak bisa dipakai) · `critical` · `major` · `minor` · `trivial` |
| **Prioritas** | Seberapa cepat harus diperbaiki? | `P0` (sekarang) · `P1` · `P2` · `P3` |

Keduanya sengaja terpisah: bug `minor` di halaman checkout bisa `P0`, sementara bug `major` di fitur yang
jarang dipakai bisa `P3`.

## Lampiran

Seret berkas ke area lampiran, pilih lewat tombol **Lampirkan**, atau **tempel screenshot** (Ctrl/Cmd+V) di
atas temuan/test case. Tipe: png, jpg, webp, pdf, md, txt, log, json, csv. Batas 10 MB per berkas, 30 berkas
dan 100 MB per laporan. Berkas yang ditolak dilaporkan per nama dengan alasannya; yang lain tetap masuk.

## Dari temuan ke perbaikan (backlog)

Tombol **Kirim ke backlog** di tiap temuan `open` membuat backlog item (jenis QA) berisi judul, langkah repro,
expected/actual, lingkungan, dan screenshot temuan sebagai konteks agen. **Kirim semua yang open** melakukannya
sekaligus (temuan `wontfix` dilewati). Temuan lalu berstatus `sent` dan menampilkan lencana `SPEC-n · stage`
yang membuka Backlog, jadi progres perbaikan terlihat dari laporan QA.

- Pemetaan sengaja kasar: severity blocker/critical → critical, minor/trivial → minor; P0/P1 → tinggi,
  P2 → sedang, P3 → rendah. Severity dan prioritas QA yang asli tetap tertulis di isi backlog.
- Mengirim dua kali tidak membuat backlog kedua. Bila backlognya dihapus, tombol muncul lagi (tautan putus).
- Boleh dilakukan dari laporan `closed` — alurnya wajar: submit → putuskan go/no-go → close → kirim temuan.
- Mengirim **tidak** menjalankan agen; peluncuran sesi tetap tindakan terpisah.

## Template, ekspor, impor

- **Unduh template** → `qa-template.xlsx`: sheet Panduan, Ringkasan, Test case, Temuan, Lampiran.
  Status, dampak, prioritas, dan keputusan memiliki dropdown. Teks panjang dibungkus dan baris dibuat lebih tinggi.
  Mulai dari Ringkasan, ganti/hapus contoh, lalu **Impor Excel / ZIP**. Judul laporan wajib; kolom lain boleh kosong.
  Formulir dashboard memisahkan informasi laporan, lingkungan, dan hasil akhir, dengan contoh dan label bahasa Indonesia.
  Sistem operasi/browser/perangkat memakai input biasa; metadata lain tersedia di bagian lingkungan tambahan.
- **DOCX** dan **PDF** (tab Pratinjau) untuk dibaca atau diserahkan: ringkasan angka, tabel test case berwarna
  per status, temuan lengkap, dan screenshot **tertanam** di dalam dokumen.
- **XLSX** berisi lima sheet seperti template, dapat diimpor kembali sebagai laporan lengkap; **CSV** hanya matriks test case. Untuk Excel gunakan
  XLSX — CSV berkoma dibuka Excel berlokal Indonesia dalam satu kolom (impor tetap menerima CSV bertitik-koma).
- **Matriks test case dua arah:** tab Langkah uji → *Unduh matriks (XLSX)*, isi hasil di spreadsheet (kolom Status,
  Aktual, dst.), lalu *Impor matriks*. Baris ber-`Ref` memperbarui test case yang ada; baris tanpa `Ref` menjadi
  test case baru. Kolom yang tidak ada dibiarkan; sel kosong pada kolom yang ada mengosongkan nilai. Status boleh
  berbahasa Indonesia (lulus, gagal, terblokir, dilewati, belum). Satu baris salah menggagalkan seluruh impor
  dengan pesan "baris N: …" — tidak ada yang tertulis setengah-setengah.
- **Ekspor ZIP** (di editor dan tab Pratinjau) → `report.xlsx` + `report.md` + folder `attachments/` dengan tautan relatif;
  terbaca di editor Markdown mana pun, gambar tampil langsung. **Unduh .md** hanya dokumennya.
- **Impor Excel / ZIP** menerima `.xlsx`, `.zip` atau `.md`. Excel mengimpor ringkasan, test case, temuan,
  tautan test case, dan pemetaan lampiran. Pilih screenshot/log bersama Excel dalam kolom Berkas lampiran;
  sheet Lampiran memakai Pemilik `Laporan`, `TC-01`, atau `F-01` dan Berkas sesuai nama file. Alternatifnya,
  ZIP berisi satu `report.xlsx` dan folder `attachments/`, dengan Berkas `attachments/nama.png`.
  Gambar yang hanya ditempel di sel Excel tidak diimpor; sertakan berkasnya.
  Berkas yang gagal/kurang ditampilkan per nama setelah laporan berhasil masuk.
  ZIP lama dengan Markdown masih didukung; bila ada Excel dan Markdown, Excel yang diimpor. Berkas hasil ekspor yang diimpor kembali ke project yang sama
  **memperbarui** laporan itu (tak menggandakan); ke project lain → laporan **baru**. Kesalahan format
  dilaporkan dengan nomor baris ("baris 42: …").
- Ref di Ringkasan = id laporan; Ref di Test case/Temuan = id entri. Kode TC/F harus unik dan tautan
  serta pemilik lampiran wajib dikenal. Excel rusak, enum tidak sah, sheet wajib hilang, atau nilai
  melebihi batas ditolak sebelum penulisan dengan pesan sheet/baris.
- Kolom **Ref** dan komentar `<!-- hanoman:… -->` di file adalah id internal untuk impor — biarkan apa
  adanya, kosongkan untuk entri baru.

## Sinkronisasi antar perangkat

Laporan QA ikut tersinkron antara hanoman lokal dan server (hub), dua arah: header laporan, test case, temuan, dan
lampiran. Dikerjakan di laptop, dibaca tim di server — dan sebaliknya.

- **Lampiran** (screenshot, log, PDF) disinkronkan terpisah dari data laporan. Penanda kecil di samping lampiran:
  *menunggu unggah* (baru ada di perangkat ini; diunggah pada sinkronisasi berikutnya), *di server · belum diunduh*
  (dibuat di perangkat lain; **diunduh otomatis saat dibuka atau diekspor**), *gagal diunggah* (server menolak isinya —
  hapus dan unggah ulang). Tanpa penanda = tersedia.
- Server memverifikasi ukuran, hash, dan tipe tiap berkas sebelum menyimpannya.
- Dua orang mengubah laporan yang sama bersamaan: konflik muncul di dialog rekonsiliasi sinkronisasi, seperti data lain.
- Menghapus laporan/temuan/lampiran di satu sisi menghapusnya di sisi lain. Berkas di perangkat lain tidak dibuang otomatis.
- **Urutan rilis:** naikkan versi server (hub) lebih dulu, baru perangkat. Perangkat baru yang mengirim laporan QA ke
  server lama ditolak per-record (aman, sembuh sendiri setelah server dinaikkan).

## Nomor tampil

`QA-007`, `F-01`, `TC-03` dihitung dari urutan pembuatan, bukan disimpan. Setelah sinkronisasi antar
perangkat, nomor bisa bergeser bila ada baris lebih tua yang masuk dari perangkat lain.
**Ekspor membekukan nomor pada saat ekspor**; gunakan ekspor bila nomor harus dirujuk di tempat lain.

## Agen (MCP)

Agen yang diberi capability `qa:read`/`qa:write` dapat membaca laporan dan menulis laporan, test case, dan
temuan lewat tool `hanoman_qa_*` — termasuk mengirim temuan ke backlog. Menghapus dan lampiran/ZIP tetap tindakan manusia di dashboard.
