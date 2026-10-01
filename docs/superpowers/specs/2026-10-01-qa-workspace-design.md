# Workspace QA — desain (bagian 1: fondasi)

Tanggal: 2026-10-01 · Status: disetujui di brainstorming, menunggu review spec.

## Tujuan

Workspace QA per project untuk menyusun laporan QA yang terstruktur dan dipakai memperbaiki project.
Dekomposisi (tiap bagian = siklus spec → plan → execute sendiri):

1. **Fondasi QA** (dokumen ini): model data, API/MCP, UI, template + ekspor/impor Markdown.
2. **Temuan → backlog**: kirim temuan ke backlog alur QA (ADR-0020), repro + lampiran jadi konteks agen (cermin ADR-0124).
3. **Sync + lampiran biner**: metadata ikut changefeed; byte lampiran diunggah terpisah per `sha256` (pendekatan A). Status lampiran `local-only → uploaded → available`. Batas 10 MB/file, kuota per laporan, tipe diizinkan.
4. **Ekspor tambahan**: `.docx`, `.xlsx`/CSV test-case, PDF.

Bagian 1 tetap **local-only**, tetapi skemanya disiapkan agar bagian 2–3 tak perlu migrasi ulang.

## Keputusan

- Alur fix: temuan → backlog agen (bagian 2). Tanpa siklus retest.
- Lampiran ikut sync, dibatasi (bagian 3). Di bagian 1 hanya disimpan lokal.
- Format template/ekspor: Markdown (bagian 1); docx, xlsx/CSV, PDF (bagian 4).
- **Penomoran**: `id` acak (`cuid`), **bukan** nomor berurut. Nomor tampilan (`QA-007`, `F-01`, `TC-03`) **dihitung saat render** dari urutan `createdAt` (seri → `id`) per project/laporan. Tak pernah bentrok antar perangkat setelah sync. Konsekuensi: nomor bisa bergeser bila ada baris dari perangkat lain yang lebih tua masuk; ekspor Markdown membekukan nomor pada saat ekspor dan menyertakan `id` di front-matter/komentar untuk impor.

## 1. Data (migration + ADR baru)

Mengikuti pola `Task` (SPEC-945). Semua di bawah `Project` (cascade).

- **QaReport**: `id`, `projectId`, `title`, `buildVersion`, `environment` (JSON: OS/browser/device/URL/branch), `scope`, `tester`, `status` (`draft|submitted|closed`), `verdict` (`go|no-go|conditional|null`), `summary`, `createdAt`, `updatedAt`, `version`.
- **QaCase**: `id`, `reportId`, `title`, `steps`, `expected`, `actual`, `status` (`todo|pass|fail|blocked|skipped`), `order`, `version`.
- **QaFinding**: `id`, `reportId`, `caseId?`, `title`, `severity` (`blocker|critical|major|minor|trivial`), `priority` (`P0..P3`, terpisah dari severity), `area`, `steps` (JSON array repro bernomor), `expected`, `actual`, `status` (`open|sent|wontfix`), `backlogId?` (disiapkan untuk bagian 2, tak diisi di bagian 1), `version`.
- **QaAttachment**: `id`, `projectId` (denormal untuk kuota/isolasi), `ownerType` (`report|case|finding`), `ownerId`, `filename`, `mimeType`, `size`, `sha256`, `storageKey`, `syncState` (`local-only` di bagian 1). Byte di disk `$HANOMAN_HOME`, memakai ulang pola `spec-attachment-dir` / `upload-pipeline`: validasi tipe, maks 10 MB/file, kuota per laporan, nama berkas disanitasi, tolak path traversal. Tanpa `version` (byte tak lewat changefeed).
- `version` pada tiga entitas pertama disiapkan; sync dihidupkan di bagian 3 lewat `FIELDS`.

## 2. API & MCP

- `/api/projects/:id/qa/reports` — CRUD; sub-resource `cases`, `findings`, `attachments`.
- `GET …/reports/:rid/export` (ZIP) · `POST …/reports/import` · `GET /api/qa/template.md`.
- Capability baru `qa:read`, `qa:write`; tool MCP `hanoman_qa_*`.
- Kesalahan: 400 validasi, 404 lintas-project, 413/415 lampiran; laporan `closed` menolak ubahan (409).

## 3. UI — `QaWorkspace`

Section "QA" per project di navigasi (pola `SkillsWorkspace`).

- **Daftar laporan**: filter status/verdict, pass-rate, hitung temuan per severity.
- **Editor**: header, tabel test-case inline, daftar temuan dengan form repro bernomor, drag-drop/paste screenshot ke temuan, galeri lampiran dengan pratinjau.
- **Pratinjau**: tampilan baca-saja sebagai dokumen.
- Design system editorial (bone paper, brass); responsif mobile/tablet/desktop.

## 4. Template & ekspor Markdown

- Berkas `.md` dengan front-matter YAML (project, build, environment, tester, verdict, `id`). Isi: ringkasan, tabel test-case, tiap temuan `### F-01 · [major/P1] Judul` berisi Repro, Expected, Actual, lampiran `![](attachments/F-01-1.png)`.
- Ekspor = ZIP `report.md` + `attachments/` dengan tautan relatif, terbaca di editor Markdown apa pun.
- Impor mem-parse ulang (round-trip); berkas tak valid ditolak dengan nomor baris. ID di berkas dipakai untuk upsert; tanpa ID → baris baru.
- Tombol "Unduh template" mengunduh template kosong.

## 5. Pengujian & docs

- Server: CRUD, nomor tampilan deterministik, isolasi antar project, penolakan tipe/ukuran, path traversal, laporan `closed` read-only, round-trip ekspor↔impor.
- Komponen UI: editor dan pratinjau.
- Uji nyata sekali di akhir: boot server, curl endpoint, ekspor ZIP, impor ulang.
- Docs di commit yang sama: `data-model.md`, `api-contract.md`, ADR baru, index `internal/docs/README.md`.
- Test dijalankan dengan `--no-file-parallelism` dan `TEST_DATABASE_URL` terisolasi (lihat AGENTS.md).

## Di luar bagian 1

Sync + byte lampiran (3), tombol kirim ke backlog (2), docx/xlsx/PDF (4).
