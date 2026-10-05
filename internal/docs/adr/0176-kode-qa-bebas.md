# ADR-0176 — Workspace QA: kode test case & temuan bebas ketikan QA (unik per laporan)

- Status: Accepted
- Tanggal: 2026-10-05
- **Mengamandemen** [0174](0174-workspace-qa.md): nomor `TC-nn` / `F-nn` tak lagi selalu dihitung dari urutan `createdAt`.

## Konteks

QA punya skema penomoran sendiri (`LOGIN-01`, `REG-12`, nomor kasus dari tim lain). Format kaku `TC-nn`/`F-nn`
menolak impor Excel/Markdown mereka ("Kode harus unik dan berformat TC-01") dan tak bisa diubah di dashboard.

## Keputusan

- `QaCase.code` dan `QaFinding.code`: kolom `TEXT` **nullable** (migration `20261005120000_qa_free_code`, ikut changefeed).
  `null` = nomor otomatis seperti sebelumnya (data lama tak berubah); terisi = kode bebas ketikan QA.
- **Bebas format** (maks 40 karakter, tanpa baris baru dan `·`), **unik per laporan** lintas test case + temuan,
  **tak peka huruf besar/kecil** — karena Lampiran (kolom Pemilik) dan rujukan "Test case" pada temuan menemukan baris lewat
  kode. `Laporan` dicadangkan untuk lampiran laporan. Pelanggaran: API `409`, impor `400` dengan sheet+baris.
- **Nomor otomatis melewati kode bebas** (`assignCodes(..., taken)`): kode otomatis tak pernah bentrok, jadi keunikan
  hanya perlu dijaga di antara kode bebas. Kode bebas yang hilang (dihapus) membuat nomor otomatis menutup celahnya.
- Impor Excel/Markdown/matriks: sel Kode terisi → menjadi kode bebas (membekukan), kosong → otomatis. Impor matriks hanya
  menulis kode yang **berbeda** dari kode tampil sekarang, supaya ekspor→impor tak membekukan semua nomor.
- Sync: `code` masuk FIELDS `qaCase`/`qaFinding`. Dua mesin yang menulis kode sama bersamaan tidak ditolak di sisi
  penerima (changefeed tak punya gerbang keunikan); keduanya tampil, QA yang menyelesaikannya.

## Konsekuensi

- Perlu `prisma migrate deploy` (otomatis saat boot). Klien lama mengabaikan `code`.
- Ekspor Markdown tetap membekukan nomor otomatis saat ekspor; impornya kini menyimpannya sebagai kode bebas.
