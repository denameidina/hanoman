# QA: formulir ramah pemula dan laporan Excel

Tujuan: orang awam dapat menulis laporan QA tanpa memahami istilah teknis atau format Markdown.

- Pertahankan design system, pisahkan identitas, lingkungan, dan hasil akhir; label tetap terlihat, contoh konkret, status dan keputusan dijelaskan dalam bahasa Indonesia.
- Lingkungan umum memakai input biasa; metadata tambahan tetap dipertahankan.
- Template utama berupa XLSX: Panduan, Ringkasan, Test case, Temuan, Lampiran. Ringkasan wajib memiliki Judul; nilai enum valid dan batas schema dicek sebelum penulisan DB.
- Impor XLSX mencakup seluruh laporan; Ref mempertahankan upsert dalam project asal, project lain membuat entri baru. Laporan closed menolak impor.
- Lampiran diunggah bersama XLSX sebagai berkas terpisah atau ZIP berisi report.xlsx + attachments/. Sheet Lampiran menentukan pemilik (Laporan / TC-nn / F-nn) dan nama/path berkas. Gunakan pipeline validasi lampiran yang ada; kegagalan per berkas ditampilkan jelas.
- ZIP ekspor membawa Excel dan Markdown serta byte lampiran. Format Markdown lama dan matriks XLSX/CSV tetap didukung.
- Sel kosong dan baris contoh diberi petunjuk eksplisit. Tidak menambahkan kolom DB atau dependensi.

Verifikasi: template dapat diimpor, Excel lengkap round-trip antar-project dan upsert, pemilik lampiran benar, error baris/enum/pemilik tidak menulis laporan separuh; test UI dan typecheck paket tersentuh; smoke HTTP lokal.
