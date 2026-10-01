# Workspace QA — bagian 2–4 (temuan→backlog, ekspor tambahan, sync + lampiran biner)

Tanggal: 2026-10-01 · Status: disetujui di chat (tiga rekomendasi diterima). Lanjutan dari
[bagian 1](2026-10-01-qa-workspace-design.md) · [ADR-0174](../../../internal/docs/adr/0174-workspace-qa.md).
Urutan kerja: **2 → 4 → 3** (3 paling berisiko: menyentuh invarian mesin sync).

## Keputusan yang diterima
1. Kirim temuan ke backlog **diizinkan dari laporan `closed`** — pengecualian tunggal atas read-only: yang berubah hanya tautan (`status`/`backlogId`), bukan isi laporan.
2. Dokumen **tanpa dependensi baru**: OOXML (docx/xlsx) ditulis sendiri di atas `writeZip`/`readZip`; PDF lewat `pdfkit` + `sharp` yang sudah ada.
3. Urutan 2 → 4 → 3.

## Bagian 2 — Temuan → backlog
- `POST /projects/:pid/qa/reports/:rid/findings/:fid/backlog` `{ priority? }` → `201|200 { created, spec:{id,stage,priority}, attachments:{saved,rejected}, report }`. Cermin `escalateTask` (ADR-0152): idempoten lewat `backlogId`; tautan putus (Spec dihapus) → dibuat ulang; retry P2002 di sekitar `nextSpecId` (≤3); `launchApprovedAt` hanya bila token punya `sessions:write` (`launchPrincipal`).
- `POST /projects/:pid/qa/reports/:rid/backlog` → semua temuan `open` (bukan `wontfix`/`sent`) sekaligus, hasil per temuan; satu gagal tak menggagalkan yang lain.
- Backlog `source: "qa"`, payload `{ severity, steps, expected, actual, env, constraints }`. Pemetaan: severity `blocker|critical→critical`, `major→major`, `minor|trivial→minor`; prioritas `P0|P1→tinggi`, `P2→sedang`, `P3→rendah` (bisa ditimpa `priority`). Pemetaan lossy, jadi severity & prioritas QA asli, kode temuan, dan kode laporan ikut tertulis di `actual`/`objective`. `env` = lingkungan laporan + build. `author` = `QA · <pengguna|agent:id>`.
- Lampiran temuan disalin sebagai `SpecAttachment` (byte DISALIN ke `storageKey` baru — berbagi key membuat hapus satu sisi merusak sisi lain), mematuhi `SPEC_ATTACHMENT_LIMITS`; yang ditolak dilaporkan, tak menggagalkan pembuatan backlog. `syncSpecAttachmentsDir` dipanggil sesudahnya.
- Temuan jadi `status: "sent"`, `backlogId`. `QaFindingView.spec` = cermin `{id, stage, priority} | null` dihitung saat baca (cermin `TaskView.spec`); `backlogId` terisi dengan `spec` null = tautan putus. Tanpa siklus retest.
- Pengecualian `closed`: route ini lolos dari gerbang 409 (hanya menulis `status`/`backlogId`).
- Tool MCP `hanoman_qa_finding_to_backlog` (`qa:write`, mode write). Ekspor Markdown menambah baris `**Backlog:** SPEC-n`.
- UI: tombol **Kirim ke backlog** per temuan, **Kirim semua yang open**, lencana `SPEC-n · stage` → `/backlog/SPEC-n`.

## Bagian 4 — Ekspor tambahan + impor matriks test case
- `GET …/reports/:rid/export?format=docx|pdf|xlsx|csv` (sebelumnya zip|md).
- **DOCX** (OOXML ditulis sendiri): judul, ringkasan angka, tabel test case, temuan (heading, repro bernomor, expected/actual), screenshot tertanam (png/jpeg; webp→png via sharp), lampiran non-gambar dicantumkan namanya.
- **PDF** (pdfkit): tata letak sama, screenshot tertanam (webp→png), teks lewat `toWinAnsi` (aturan font standar yang sudah ada).
- **XLSX** (OOXML ditulis sendiri): sheet *Ringkasan*, *Test case* (kolom Kode · Judul · Langkah · Diharapkan · Aktual · Status · **Ref**), *Temuan*. **CSV** = sheet Test case (UTF-8 BOM, CRLF, kutip RFC 4180).
- **Impor matriks test case** `POST /projects/:pid/qa/reports/:rid/cases/import` (multipart `.xlsx|.csv`, laporan non-closed): baris ber-`Ref` yang ada → perbarui (judul, langkah, diharapkan, aktual, status); tanpa `Ref` → case baru. Header dikenali tak peka huruf/spasi. Pembaca XLSX tahan berkas simpanan Excel (sharedStrings, inlineStr, `t="str"`, angka, sel kosong berlompatan, sheet pertama). Status tak dikenal → galat berbaris ("baris N").
- DOCX/PDF read-only (tak ada impor). UI: menu **Ekspor** (ZIP · Markdown · DOCX · PDF · XLSX · CSV) dan **Impor matriks**.

## Bagian 3 — Sync + lampiran biner (dua arah)
- `qaReport`, `qaCase`, `qaFinding`, `qaAttachment` masuk `SYNCED`/`DELEGATE`/`FIELDS`/`DATE_FIELDS`/`PARENTS` (case/finding/attachment → report cascade; report → project cascade), `JSON_FIELDS` (`qaReport:environment`, `qaFinding:steps`), `FLOAT_FIELDS` (`qaCase:order`), `NUMBER_FIELDS` (`qaAttachment:size`), `BOOTSTRAP_ORDER` (setelah `project`, induk sebelum anak). `QaAttachment` mendapat `version` + `updatedAt` (migration additif). `syncState` LOCAL (tak ikut FIELDS) dan dipakai ulang maknanya: per mesin.
- Semua route QA memanggil `notifySynced` (tulis) / `deleteSynced` (hapus; anak ikut cascade DB di kedua sisi). Import & kirim-ke-backlog juga. Konflik memakai LWW + modal rekonsil yang ada (ADR-0067).
- Byte (device-token, di bawah `/api/sync`): `GET /sync/qa-attachments/:id` (hub → client) dan `PUT /sync/qa-attachments/:id` (client → hub). Hub memverifikasi `sha256(body) == QaAttachment.sha256`, `size`, ≤10 MB, mime milik baris, magic bytes/UTF-8 sesuai tipe, lalu menulis ke `storageKey` baris itu. Client menarik lazy lewat fetch-through (`readQaAttachment`: baca lokal → tarik dari hub → cache), batas respons 10 MB.
- `syncState` per mesin: `pending-upload` (asal di sini, belum dikonfirmasi hub), `remote` (metadata ada, byte belum diunduh), `available` (byte ada di sini dan, di client, terkonfirmasi di hub). Di hub baris asal-hub langsung `available`. Client mengunggah byte yang `pending-upload` setelah push metadata sukses (di dalam siklus sync, best-effort, backoff yang ada). UI: penanda kecil per lampiran.
- Ekspor/pratinjau memakai `readQaAttachment` supaya lampiran dari mesin lain ikut. Hapus lampiran/laporan membuang byte lokal saja (tanpa GC lintas mesin, ADR-0068).
- Guard test sync yang ada (`sync-parents-dmmf`, `sync-bootstrap`, `sync-exclusions`, `__FIELDS` kontrak) diperbarui sesuai.

## Pengujian
Tiap bagian TDD; uji nyata di akhir (server + klien sync sungguhan untuk bagian 3: dua instance, satu hub satu client, DB sekali-pakai) dan cek tampilan 390/768/1280 px.
