# Workspace QA — panduan pemakai

Workspace QA (menu **QA** di sidebar) menyimpan laporan QA per project: ringkasan hasil, test case,
temuan (bug) lengkap dengan langkah repro, dan lampiran (screenshot, log, PDF). Tujuannya satu: laporan
bisa **dibaca orang lain tanpa bertanya** dan kelak langsung dipakai sebagai bahan perbaikan project.
Keputusan desain: [ADR-0174](../adr/0174-workspace-qa.md).

## Alur singkat

1. **Laporan baru** → isi judul, build/versi, penguji, lingkungan (`os=macOS 15`, `browser=Chrome 130`, …),
   dan cakupan (apa yang diuji dan apa yang sengaja **tidak**).
2. Tab **Test case**: tambah langkah uji; catat hasil per case (`pass` / `fail` / `blocked` / `skipped`).
3. Tab **Temuan**: satu temuan = satu masalah. Isi repro bernomor (satu langkah per baris), Expected vs
   Actual, tautkan ke test case, lalu lampirkan screenshot.
4. Pilih **Keputusan** (`go` / `no-go` / `conditional`) dan tulis ringkasan alasannya, lalu **Submit**.
   `Submit`/`Close` ditolak bila keputusan belum diisi.
5. **Close** mengunci laporan (read-only). **Buka kembali** bila perlu merevisi.

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

## Template, ekspor, impor

- **Unduh template** → `qa-template.md`: front-matter + satu contoh test case dan temuan + panduan
  pengisian. Isi lalu **Impor**.
- **Ekspor ZIP** (di editor dan tab Pratinjau) → `report.md` + folder `attachments/` dengan tautan relatif;
  terbaca di editor Markdown mana pun, gambar tampil langsung. **Unduh .md** hanya dokumennya.
- **Impor** menerima `.zip` atau `.md`. Berkas hasil ekspor yang diimpor kembali ke project yang sama
  **memperbarui** laporan itu (tak menggandakan); ke project lain → laporan **baru**. Kesalahan format
  dilaporkan dengan nomor baris ("baris 42: …").
- Kolom **Ref** dan komentar `<!-- hanoman:… -->` di file adalah id internal untuk impor — biarkan apa
  adanya, kosongkan untuk entri baru.

## Nomor tampil

`QA-007`, `F-01`, `TC-03` dihitung dari urutan pembuatan, bukan disimpan. Setelah sinkronisasi antar
perangkat (menyusul), nomor bisa bergeser bila ada baris lebih tua yang masuk dari perangkat lain.
**Ekspor membekukan nomor pada saat ekspor**; gunakan ekspor bila nomor harus dirujuk di tempat lain.

## Agen (MCP)

Agen yang diberi capability `qa:read`/`qa:write` dapat membaca laporan dan menulis laporan, test case, dan
temuan lewat tool `hanoman_qa_*`. Menghapus dan lampiran/ZIP tetap tindakan manusia di dashboard.
