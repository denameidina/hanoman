# ADR-0186 — Mode tool transfer mengikuti efek di mesin klien, bukan hanya capability server

Tanggal: 2026-10-11 · Status: diterima

Melengkapi [ADR-0183](0183-transfer-berkas-lewat-tool-mcp.md); memperluas arti `mode`
([ADR-0155](0155-mcp-cakupan-penuh-capability-danger.md), `shared/src/mcp-catalog/types.ts`).

## Konteks

`mode` (`read|write|danger`) menentukan tool mana yang TERLIHAT: `--read-only` hanya memuat `read`.
Selama ini `read` ≈ "tak mengubah apa pun" dan selalu sejajar dengan capability `:read`. Tool unduh
memecahkan kesejajaran itu: `GET /specs/:id/attachments/:attId` hanya butuh `backlog:read`, tetapi
tool-nya MENULIS berkas ke disk klien.

## Keputusan

- Mode ditentukan oleh efek di **mesin klien** juga: tool yang menulis ke disk lokal (unduh-ke-berkas)
  atau membaca disk lokal untuk dikirim (unggah) bermode `write` walau capability server-nya `:read`.
  Dengan begitu `--read-only` tidak pernah menyentuh disk klien.
- Tool teks kecil yang dikembalikan **inline** (`hanoman_qa_template_md`,
  `hanoman_qa_report_export_text`: md/csv) tak menyentuh disk dan tetap `read`. Pasangannya yang
  menyimpan berkas (`hanoman_qa_template_xlsx`, `hanoman_qa_report_export_file`) bermode `write`.
  Dua tool per kebutuhan lebih jujur daripada satu tool yang kadang menulis disk.
- Inline yang kebesaran GAGAL dengan petunjuk memakai tool berkas, tidak diam-diam menulis disk
  dari tool bermode `read`.
- Tidak ada invarian uji "mode read ⇒ capability `:read`" sebelumnya, dan tidak ditambah invarian
  kebalikannya; yang dikunci: setiap tool dengan `download.mode === "file"` atau `multipart`
  tidak muncul di `read-only` (`shared/src/mcp-catalog.transfer.test.ts`).

## Dampak

Agen read-only tidak bisa mengunduh lampiran (hanya template Markdown dan ekspor md/csv inline).
Itu disengaja; manusia yang menginginkannya cukup memakai tingkat default.
