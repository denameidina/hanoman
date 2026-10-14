# ADR-0222 · Laporan run cron: entitas tersync `CronReport`, ditangkap dari hook `Stop`

Status: diterima · 2026-10-14 · Melengkapi ADR-0112 (cron per project) dan ADR-0146 (hook event sesi)

## Konteks

Cron scheduler (ADR-0112) membuka sesi agen interaktif. Hasilnya — mis. laporan biaya Cloudflare
harian — hanya hidup di pane tmux dan transkrip mentah `SessionHistory` (LOCAL-only, mentah dengan
escape terminal). Tak ada dokumen yang bisa dibaca atau dibandingkan antarhari, dan `SchedulerCron`
serta `SchedulerCronRun` LOCAL-ONLY, jadi mesin lain tak melihat apa pun.

## Keputusan

1. **Entitas baru `CronReport`, tersync** (`SYNCED`, induk `project` cascade). Satu baris = satu run;
   `id` = `SchedulerCronRun.id` (cuid, unik global) sehingga tulis ulang idempoten dan dua mesin
   tak bisa menerbitkan laporan ganda untuk run yang sama. Kolom: `projectId`, `cronId` (soft-link —
   cron-nya sendiri tidak disync), `cronName` (snapshot), `runDate` (`YYYY-MM-DD`, zona lokal mesin
   penjalan, dari `dueAt`), `dueAt`, `sessionId`, `body` (markdown), `bytes`, `createdAt`,
   `updatedAt`, `version`. Satu migration tulis tangan.
2. **"Berkas .md" = baris + nama berkas turunan**, bukan berkas di disk: hanya baris yang bisa
   menyeberang lewat change-feed. Nama berkas diturunkan murni: `<runDate>-<slug cronName>-<runId>.md`
   (`cronReportFilename`, `shared`). Format hanya markdown.
3. **Penangkapan dari hook `Stop`** yang sudah terpasang di setiap sesi agen (`eventHook`, ADR-0146):
   `POST /api/session-events` untuk sesi ber-id `cron-*` menulis `last_assistant_message` sebagai
   `body` laporan run `launched` TERBARU milik cron itu. **Giliran terakhir menang** (upsert): cron
   bisa berganti beberapa giliran (subagent latar), dan hanya `Stop` terakhir yang final. Tanpa run
   `launched` yang cocok, event diabaikan. Batas `body` 64 KiB (dipotong dengan penanda), karena baris
   ini menyeberang sebagai satu record sync. Jalur ini TIDAK mengubah jalur `intakeAsk` yang ada.
4. **Retensi 90 laporan terbaru per `cronId`**; yang lebih tua dihapus lewat `deleteSynced` (tombstone
   sehingga penghapusan menyeberang). Pemangkasan dijalankan sesudah tiap tulis.
5. **REST** (`/api/scheduler/reports`, capability `scheduler:read` — `seg[1] === "reports"` dipetakan
   `rw("scheduler")` di `capabilityForRoute`; bila tidak ia jatuh ke `settings`):
   `GET /scheduler/reports?projectId&cronId&page&limit` (tanpa `body`), `GET /scheduler/reports/latest?cronId&projectId`
   dan `GET /scheduler/reports/:id` (dengan `body`). **Tidak pernah 404 karena cron tak dikenal**:
   cron milik mesin lain tak ada di DB lokal, tetapi laporannya tetap tersync dan harus terbaca.
6. **MCP**: `hanoman_scheduler_reports` (daftar) dan `hanoman_scheduler_report_get` (`report` = id
   atau `latest`), keduanya `read`, `scheduler:read` (ADR-0202).
7. **Dashboard**: panel "Laporan" pada halaman cron, memuat daftar + isi sesuai permintaan pengguna
   (bukan polling; ADR-0039). Perubahan data tiba lewat sync, bukan kanal siar baru.
8. **Perbandingan versi lama klien**: `cronReport` masuk `OPTIONAL_ENTITIES` (ADR-0180) — klien lama
   melempar pada entitas tak dikenal dan kursornya berhenti selamanya.

## Konsekuensi

- Pesan chat operator di pane cron SETELAH giliran final akan menimpa laporan (giliran terakhir
  menang). Diterima: cron berjalan tanpa manusia di pane; operator yang mengobrol di pane itu
  sadar sedang mengubah "pesan terakhir".
- Hanya run yang meluncurkan sesi agen yang bisa menghasilkan laporan; run `skipped`/`failed` tidak.
- Migration + kolom `version`: wajib masuk `PG_ORDER` (`cli/src/commands/migrate-pg.ts`).
