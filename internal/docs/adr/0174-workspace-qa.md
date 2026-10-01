# ADR-0174 — Workspace QA: laporan QA per project (test case, temuan, lampiran)

- Status: Accepted
- Tanggal: 2026-10-01
- SPEC: — ([desain](../../../docs/superpowers/specs/2026-10-01-qa-workspace-design.md),
  [plan bagian 1](../../../docs/superpowers/plans/2026-10-01-qa-workspace-part1.md))

## Konteks

Hasil QA manusia (screenshot, langkah repro, keputusan go/no-go) tidak punya rumah di hanoman: ia
tersebar di chat dan dokumen lepas, sehingga tak bisa dipakai langsung untuk memperbaiki project.
Dibutuhkan workspace per project yang menyusun laporan terstruktur, terbaca mudah (termasuk lampirannya),
bisa diunduh sebagai template/ekspor, dan kelak tersinkron local ↔ server serta menjadi sumber backlog
alur QA ([ADR-0020](0020-fase-perencanaan-qa-dipangkas-keputusan-audit.md)). Pekerjaan dipecah empat bagian; ADR ini mengunci
**bagian 1 (fondasi)** dan menyiapkan skema untuk bagian 2–4.

## Keputusan

1. **Empat model** di bawah `Project` (cascade): `QaReport`, `QaCase`, `QaFinding`, `QaAttachment`.
2. **Nomor tampil (`QA-007`, `F-01`, `TC-03`) TIDAK disimpan** — dihitung saat render dari urutan
   `createdAt` (seri → `id`) lewat `assignCodes`. `id` acak (`cuid`) tak pernah bentrok antar perangkat
   sesudah sync; harganya, nomor bisa bergeser bila baris yang lebih tua dari perangkat lain masuk.
   Ekspor Markdown membekukan nomor pada saat ekspor dan menyertakan `id` untuk impor.
3. **LOCAL-only di bagian 1**, tetapi `version` sudah ada pada `QaReport`/`QaCase`/`QaFinding` agar
   bagian 3 (sync) cukup menambah entri `FIELDS` tanpa migrasi ulang. Tak satu pun tulisan QA memanggil
   `notifySynced`; test menjaganya.
4. **`QaFinding.caseId` soft-link tanpa FK** (cermin `Task.specId`, [ADR-0150](0150-fondasi-papan-tim-task-member.md)):
   changefeed bisa memancarkan temuan sebelum case-nya mendarat (kelas SPEC-382). `backlogId` disiapkan
   untuk bagian 2.
5. **Lampiran memakai ulang pipeline unggahan** (`upload-pipeline.ts`, [ADR-0124](0124-lampiran-backlog-konteks-agen.md)):
   magic bytes, normalisasi gambar, pemindaian. Limit milik QA: 10 MB/berkas, 30 berkas & 100 MB per
   laporan. `QaAttachment` punya `reportId` (FK cascade → kuota & hapus berantai), `sha256` byte
   TERSIMPAN (kunci dedup bagian 3), dan `syncState` (`local-only` sekarang). `ownerType/ownerId`
   polimorfik tanpa FK — service membuang lampiran pemilik sebelum pemiliknya.
6. **Laporan `closed` read-only (409)** kecuali dibuka kembali lewat `PATCH {status}`; `submitted`/`closed`
   mensyaratkan `verdict` (400).
7. **Capability baru `qa:read|write`**, dipetakan MENURUT METHOD untuk `/projects/:id/qa/**` dan `/qa/**`.
8. **Format pertukaran = Markdown** (front-matter + tabel + blok temuan) di dalam ZIP berlampiran; impor
   adalah upsert berbasis `id`. ZIP ditulis/dibaca sendiri (tanpa dependensi baru) dan dipagari terhadap
   zip-slip/zip-bomb.

## Konsekuensi

- Satu migration additif (empat tabel); tak ada perubahan pada tabel yang ada.
- Sync + byte lampiran (bagian 3), tombol kirim-ke-backlog (bagian 2), serta ekspor docx/xlsx/PDF
  (bagian 4) tidak membutuhkan migrasi ulang kolom yang disebut di atas.
