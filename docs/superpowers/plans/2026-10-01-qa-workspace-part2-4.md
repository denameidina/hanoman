# Workspace QA — bagian 2–4 (rencana kerja)

Desain: [spec](../specs/2026-10-01-qa-workspace-part2-4-design.md). Berbeda dari rencana bagian 1 (3.700 baris kode di dalam plan),
rencana ini berupa checklist per task: kodenya ditulis sekali, langsung dengan TDD, bukan disalin dari dokumen.
Urutan: **2 → 4 → 3**. Test: serial dengan `TEST_DATABASE_URL` terisolasi dan env sesi dibersihkan.

## Bagian 2 — Temuan → backlog
- [x] Pemetaan `qaSeverityToSpec`/`qaPriorityToSpec` + tipe `QaBacklogResult`, `QaFindingView.spec` (shared, test dulu)
- [x] Renderer Markdown: baris `**Backlog:** SPEC-n · stage` (round-trip aman)
- [x] `copyUpload` (salin byte ke storageKey baru), cermin `spec` pada `reportDetail`
- [x] Service `qa-backlog.ts` + route `findings/:fid/backlog` & `reports/:rid/backlog` (11 test: pemetaan, idempoten, tautan putus, lampiran disalin & batas, closed boleh, massal)
- [x] Tool MCP `hanoman_qa_finding_to_backlog`, `hanoman_qa_report_to_backlog`; gerbang cakupan hijau
- [x] UI: Kirim ke backlog, Kirim semua yang open, lencana SPEC (3 test)
- [x] Docs: api-contract, panduan

## Bagian 4 — Ekspor tambahan + impor matriks
- [x] CSV (tulis + baca RFC 4180) dan matriks test case (shared, murni; kolom absen ≠ sel kosong)
- [x] XLSX writer + reader (tahan simpanan Excel; divalidasi terhadap xlsxwriter/openpyxl)
- [x] DOCX writer (OOXML, gambar tertanam; divalidasi python-docx)
- [x] PDF (pdfkit, gambar tertanam, webp→png)
- [x] Route `export?format=docx|pdf|xlsx|csv` + `cases/import`
- [x] UI: menu Ekspor, Impor matriks; docs

## Bagian 3 — Sync + lampiran biner
- [x] Migration `QaAttachment.version/updatedAt`; entitas masuk `SYNCED`/`FIELDS`/`PARENTS`/`BOOTSTRAP_ORDER`; guard test sync
- [x] `notifySynced`/`deleteSynced` di semua route QA, import, kirim-ke-backlog
- [x] Endpoint byte `GET|PUT /sync/qa-attachments/:id` (verifikasi sha256/ukuran/mime/magic)
- [x] `readQaAttachment` (fetch-through) + unggah byte client + `syncState` per mesin; ekspor memakainya
- [x] UI penanda status sync lampiran
- [x] Uji nyata dua instance (hub + client); ADR-0175; docs
