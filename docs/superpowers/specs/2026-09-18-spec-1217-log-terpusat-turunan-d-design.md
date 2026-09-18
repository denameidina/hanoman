# SPEC-1217 · SPEC-1215 turunan D — log terpusat: pengiriman, ingest, redaksi, pencarian & retensi

**Tanggal:** 2026-09-18 · **Flow:** feature · **Prioritas:** sedang · **Sumber:** brief
**Base:** `61bc006c` · **Fase penulis bagian ini:** Brainstorm (1/5), Objective (2/5)
**ADR:** [0166 — log terpusat, ingest satu arah](../../../internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md)
(mengunci kontrak; fase ini tidak membukanya kembali — lihat "Konteks & keputusan" di bawah)

## Objective

**Log dari klien opt-in — lajur `event` (default menyala), `server` (sadapan console, opt-in), dan
`transcript` (opt-in) — sampai utuh dan tanpa duplikat di hub lewat `POST /api/sync/logs`, tersaring
dan tercari kembali oleh operator lewat `GET /api/logs` (device/project/spec/lane/level/kind/kata
kunci, rentang ≤ 31 hari) tanpa satu pun rahasia bocor ke penyimpanan hub, dan tanpa regresi latensi
terukur pada `GET /specs` saat hub menerima beban ingest sintetis setara proyeksi ADR-0166 §7.**

Objective ini adalah irisan turunan D dari kriteria sukses #5 payung SPEC-1215 ("Log terpusat tercari
dan tanpa duplikat", `docs/superpowers/specs/2026-09-14-spec-1215-hub-orkestrasi-klien-design.md`
baris 39–43); turunan D mengeksekusinya, tidak mendefinisikan ulang.

### Kriteria sukses (terukur)

1. **Pengiriman aktif secara default, opt-in eksplisit untuk sisanya (AC-D1).** Klien yang terhubung
   hub mengirim lajur `event` tiap tick sync tanpa konfigurasi tambahan; lajur `server`/`transcript`
   tetap nol pengiriman sampai `Setting.data.logShipping` dinyalakan cookie lokal — dibuktikan test
   yang mengamati request `POST /api/sync/logs` sebelum/sesudah toggle.
2. **Nol duplikat pada kirim ulang, termasuk crash window (AC-D2).** Mengirim ulang batch identik
   (simulasi klien offline lalu retry, dan simulasi crash antara commit hub & tulis kursor klien)
   selalu menghasilkan 0 baris baru dan `duplicate` = jumlah entri di respons; unique index
   `(deviceId, lane, seq)` tidak pernah dilanggar di test.
3. **Spool offline berbatas dan tak pernah tumbuh tanpa batas (AC-D3).** Simulasi offline berkepanjangan
   menunjukkan spool `server` berhenti tumbuh pada ≤ 64 MiB (segmen 1 MiB) dan `event`/`transcript`
   pada ≤ 50 000 baris tertunda; saat penuh, buang mengikuti urutan server → transcript → event,
   masing-masing meninggalkan satu entri `log.gap`.
4. **Rahasia tak pernah mendarat di penyimpanan (AC-D4).** Korpus uji `redactText()` (klien dan hub,
   fungsi murni yang sama secara kontrak) membuktikan pola rahasia tersamar sebelum spool/kirim dan
   diulang saat ingest; kegagalan redaktor membuang entri dan menggantinya `log.gap
   reason:"redaction-failed"` (gagal-tertutup) — tidak pernah entri tak-terredaksi tersimpan.
5. **Pencarian operator terjawab dalam kontrak yang jelas (AC-D5, AC-D8).** `GET /api/logs` dengan
   `from`/`to` ≤ 31 hari dan kombinasi penyaring device/project/spec/lane/level/kind/`q` mengembalikan
   hasil terurut `ts desc, id desc`, kursor ≤ 200/halaman, mencakup baris `relay.*` (aktor hub) dan
   `remote.*` (aktor klien) dalam satu tabel; rentang absen atau > 31 hari → `400`.
6. **Retensi otomatis, bukan tugas manual (AC-D6).** Sapuan retensi harian (langkah tambahan di
   `runRetention()` yang sudah ada, tanpa timer baru) menghapus entri melewati
   `Setting.logRetention.<lane>Days` dan, selama total `bytes` > `maxBytes`, entri terlama; berkas
   transkrip yatim terpungut sesudah baris DB-nya hilang — dibuktikan test yang menjalankan sapuan
   dan mengukur sisa baris/berkas.
7. **Kuota melindungi hub tanpa menghentikan sync (AC-D7, AC-D9).** Ingest > 20 000 entri/jam per
   device → `429 { retryAfterSec }` yang hanya menunda lajur bersangkutan; `POST /api/sync/logs` 404
   → klien menunda pengiriman 30 menit tanpa menghentikan tick sync yang lain; spool tetap berbatas
   selama penundaan.
8. **Operator melihatnya di dashboard (AC-D5, AC-D10, bagian UI §S4.9).** `LogsPanel` di layar Klien
   menampilkan hasil `GET /api/logs`/`GET /api/logs/:id/transcript` dan pengaturan
   `GET|PUT /api/logs/retention` (`COOKIE_ONLY`); sadapan `console` di boot hub meneruskan keluaran
   asli ke stdout/stderr tanpa perubahan, baris identik beruntun dalam 60 detik tergabung
   (`data.repeat`).
9. **Nol regresi latensi pada beban terukur, bukan proyeksi (ADR-0166 §7, §S10 SPEC-1215).**
   Pengukuran 10 device × batch 500 entri/15 dtk selama 10 menit menunjukkan p95 `GET /specs` naik
   ≤ 20% dibanding baseline tanpa ingest, dan nol error `P1008` (database lock) — dijalankan sebagai
   task eksplisit sebelum default `LOG_INGEST_MAX_PER_HOUR`/ukuran batch dikunci; gagal → jalur
   koreksinya amandemen ADR-0166, bukan keputusan baru di fase ini.

Kesepuluh AC-D1…AC-D10 (spec SPEC-1215 §S9) dan §K9–K10/§S4.7–S4.9/§S6/§S10 tetap kontrak final yang
mengikat fase Spec/Plan/Execute turunan D; kriteria di atas adalah proyeksi terukurnya untuk fase
Objective, bukan pembukaan ulang keputusan.

## Konteks & keputusan

### Status backlog & dependency

SPEC-1217 adalah **turunan D** dari payung SPEC-1215 (empat turunan A–D, urutan A → (B ∥ D) → C,
`docs/superpowers/specs/2026-09-14-spec-1215-hub-orkestrasi-klien-design.md` §S8). **Design-of-record
untuk fase ini bukan dokumen baru** — spec SPEC-1215 §K9–K10 (Konteks & keputusan), §S4.7–S4.9, §S6, §S9
(AC-D1…AC-D10), §S10 (rencana verifikasi) beserta [ADR-0166](../../../internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md)
sudah mengunci arsitektur dan kontrak lajur `server`/`transcript`/redaksi/ingest/pencarian/retensi.
Fase Brainstorm/Objective/Spec turunan D **merujuk dan mengunci** AC di atas; perubahan keputusan
substansi hanya lewat amandemen ADR-0166 (bukan lewat dokumen baru ini).

Dependency turunan A (sesi SPEC-1215, `docs/superpowers/plans/2026-09-15-spec-1215-a-fondasi-kanal-relay.md`)
**terverifikasi selesai dan sudah ter-merge** di `main` (commit `c507df84` "fondasi kanal relay hub ↔
klien (SPEC-1215 A)", terlihat di `git log` sebelum rilis `0.5.0`/`0.6.0`). Diverifikasi lewat kode, bukan
klaim: skema `LogEntry`/`LogCursor` sudah di `server/prisma/schema.prisma:1015-1049` persis sesuai
§S4.10, migration `20260915120000_log_terpusat` ada, `appendEvent()` ber-seq HLC ada di
`server/src/services/logs/event-log.ts:43-65` (serial lewat `tail` promise, `nextSeq` dari
`shared/src/logs.ts:20-22`), `registerSessionHooks` sudah **aditif** (`server/src/services/pty.ts:535-545`,
memanggil setiap hook terdaftar dalam try/catch — bukan lagi satu slot), dan tap lokal
`session.start`/`session.end` terpasang di `installEventTap()` (`event-log.ts:92-109`). `PG_ORDER` di
`cli/src/commands/migrate-pg.ts:38` sudah mendaftarkan `LogEntry`/`LogCursor` sesuai koreksi §S13 P1
spec SPEC-1215, dan `Setting.data` sudah membawa default `logShipping`/`logRetention`
(`server/src/services/settings.ts:32-34`, `shared/src/logs.ts:32-46`). **Yang belum ada** — dikonfirmasi
lewat `grep` kode: tak ada route `/api/sync/logs`, `/api/logs`, `/api/logs/:id/transcript`, atau
`/api/logs/retention`; tak ada `redactText`/`redact.ts`; tak ada sadapan `console.*`; tak ada
`log-spool`; tak ada `LogsPanel`; hook sesi hanya punya `onBirth`/`onDeath` (belum `onPhase` untuk
`session.phase`); `recordSessionResult` (`server/src/services/session-result.ts:11`) dan
`LaunchAdmissionError`/`LaunchError` (`server/src/services/session-admission.ts`,
`session-launch.ts`, `server/src/app.ts`) belum menembak `appendEvent`. Ini persis cakupan turunan D
menurut §S8 tabel turunan: "shipper; spool + sadapan console; lajur transcript; redaksi; ingest +
kuota; pencarian + retensi + `LogsPanel`", dependensi **A** saja (B/C bukan prasyarat).

### Alternatif yang sudah diputuskan (ADR-0166 §Alternatif yang ditolak) — dirujuk, tidak diulang

Keputusan dedup/penyimpanan sudah final di ADR-0166 sejak fase Spec SPEC-1215; turunan D tidak
membuka ulang, hanya mengeksekusi:
- **`skipDuplicates` Prisma** ditolak — tak didukung SQLite (dikonfirmasi versi Prisma 6 dipakai
  proyek ini, `server/prisma`).
- **`upsert` per baris** ditolak — N round-trip dan lock tulis per entri; high-water mark satu
  transaksi (§S4.7 langkah 5) dipilih sebagai gantinya.
- **Autoincrement lokal sebagai seq** ditolak — reset saat instal ulang ber-token sama membuat hub
  menolak semua entri berikutnya sebagai duplikat senyap; HLC (`nextSeq`, sudah ada di `shared/src/logs.ts`)
  dipertahankan.
- **Epoch/streamId di kunci unik** ditolak — mengubah kontrak AC-D2 tanpa perlu.
- **Tulis SQLite per baris untuk lajur `server`** ditolak — kelas kegagalan ADR-0131 (lihat constraint
  "nol tulisan SQLite per baris"); spool NDJSON dipertahankan.
- **FTS5/raw SQL untuk pencarian** ditolak — dilarang guard `webhook-no-raw-writes`; `LIKE` pada `msg`
  dalam rentang waktu berindeks dipilih, dengan `GET /api/logs` sengaja **tanpa** `total` (pengecualian
  keempat ADR-0107, dikonfirmasi ADR-0166 §7).
- **Streaming transkrip selama sesi berjalan** ditolak — di luar lingkup §S8/§"Di luar lingkup"; mirror
  terminal (turunan C, ADR-0165) sudah melayani tontonan live.

### Keputusan yang dikunci untuk turunan D (AC-D1…AC-D10, spec SPEC-1215 §S9)

Sepuluh AC berikut adalah kontrak yang mengikat fase Spec/Plan/Execute turunan D; tidak ada
interpretasi lain yang dibuka fase ini:

1. **AC-D1** — lajur `event` terkirim tiap tick sync selama klien terhubung hub; `server`/`transcript`
   mati sampai dinyalakan cookie lokal (`Setting.data.logShipping`, `GET|PUT /api/remote-control` sudah
   ada dari turunan A).
2. **AC-D2** — kirim ulang batch yang sama → nol baris baru, `duplicate` = jumlah entri; unique
   `(deviceId, lane, seq)` (sudah terpasang §S4.10) tak pernah dilanggar termasuk simulasi crash
   antara commit hub dan tulis kursor klien.
3. **AC-D3** — offline: tampung dalam batas §S4.1 (spool `server` ≤ 64 MiB segmen 1 MiB; `event`/
   `transcript` belum-terkirim ≤ 50 000 baris); penuh → buang `server` terlama dulu, lalu `transcript`,
   `event` paling akhir, tiap buang meninggalkan `log.gap`.
4. **AC-D4** — redaksi `msg`/`data`/transkrip di klien **sebelum** spool/kirim, diulang di hub saat
   ingest (lapis kedua); redaktor melempar → entri dibuang, diganti `log.gap reason:"redaction-failed"`
   (gagal-tertutup, bukan gagal-terbuka).
5. **AC-D5** — `GET /api/logs` dengan `from`/`to` wajib ≤ 31 hari + penyaring
   device/project/spec/lane/level/kind/q → `ts desc, id desc`, kursor ≤ 200/halaman; rentang absen/>31
   hari → 400.
6. **AC-D6** — sapuan retensi harian menghapus entri melewati `logRetention.<lane>Days` dan, selama
   total `bytes` > `maxBytes`, entri terlama; baris dulu, berkas transkrip sesudahnya, yatim dipungut
   (`reconcileTranscripts`, pola sama dengan `runRetention()` yang ada di
   `server/src/services/retention.ts:29-42` — dipanggil sebagai langkah tambahan, **bukan** timer baru).
7. **AC-D7** — ingest > 20 000 entri/jam per device → `429 { retryAfterSec }`; klien menunda **lajur
   itu saja** tanpa menghentikan sync.
8. **AC-D8** — hub mencatat setiap aksi relay (`relay.request`/`relay.stream`) beraktor cookie hub;
   pencarian per SPEC menampilkannya bersama `remote.*` milik klien tujuan (satu tabel `LogEntry`, satu
   pencarian).
9. **AC-D9** — `POST /api/sync/logs` → 404 → klien menunda pengiriman 30 menit, spool tetap berbatas.
10. **AC-D10** — lajur `server` menyala → sadapan `console` meneruskan keluaran asli ke stdout/stderr
    tanpa perubahan; baris identik beruntun dalam 60 detik digabung (`data.repeat`).

Kind lajur `event` yang wajib ditambahkan turunan D (§S4.7, belum ada di kode hari ini):
`session.phase {from,to}`, `session.result {status, oldStage, newStage}`, `launch.rejected {kind,
admission?}`, `log.gap {lost, reason, fromSeq, toSeq}` — di atas `session.start`/`session.end`/
`remote.request`/`remote.link`/`grant.changed` yang sudah dicatat turunan A.

### Titik integrasi kode yang perlu diverifikasi fase Spec/Plan

- **Hook `onPhase`:** `registerSessionHooks`/`SessionHooks` (`server/src/services/pty.ts:525-545`) baru
  punya `onBirth`/`onDeath`. Turunan D butuh cara menembak `session.phase` — entah tambahan hook ketiga
  (aditif, sama polanya) atau tap terpisah di titik perubahan berkas fase yang disebut ADR-0166 §2
  ("tick snapshot sesi 3 dtk"/perubahan berkas fase). Spec harus memutuskan mekanismenya secara presisi
  (bukan keputusan arsitektural baru — ADR-0166 sudah bilang "hook sesi" sebagai sumber, tapi bentuk
  hook belum ada di kode).
- **`recordSessionResult`** (`server/src/services/session-result.ts:11`) dan **`LaunchAdmissionError`/
  `LaunchError`** (dipakai di `session-admission.ts`, `session-launch.ts`, `app.ts`,
  `scheduler/governor.ts`) belum memanggil `appendEvent`. Titik pemanggilan `appendEvent({kind:
  "session.result"|"launch.rejected", ...})` perlu ditambahkan tanpa mengubah alur gerbang yang ada.
- **Tick sync:** `syncTick`/`syncOnce` di `server/src/services/sync-client.ts:224,444` adalah titik
  kuras shipper turunan D (ADR-0166 "dikuras tick sync klien yang sudah ada" — **tanpa timer baru**);
  `startSyncClient` (baris ~458) sudah memanggil `startRelayClient` di titik yang sama, jadi shipper log
  mengikuti pola yang identik (dipanggil, fire-and-forget, tak menunggu).
- **`runRetention()`** (`server/src/services/retention.ts:29`) memanggil `deleteExpired` +
  `pruneSyncFeed` + `reconcileTranscripts` secara berurutan dalam satu fungsi; `pruneLogs` turunan D
  masuk sebagai langkah tambahan di fungsi yang sama, mengikuti pola `RetentionReport` yang sudah ada
  (field baru, bukan laporan terpisah).
- **`Setting.data.logShipping`/`logRetention`** sudah divalidasi zod dan dipertahankan `PUT /settings`
  (`server/src/services/settings.ts:32-34`, `server/src/routes/settings.ts:32`) — turunan D menambah
  route `GET|PUT /api/logs/retention` sebagai jalur **terpisah** (`COOKIE_ONLY`), sesuai §7 ADR-0166:
  retensi **tak** bisa dipendekkan lewat `PUT /settings` biasa karena itu berarti menghapus bukti audit.
- **Console interception:** belum ada sadapan `console.*` di `server/src/server.ts` atau tempat lain.
  Titik boot (`server.ts`) adalah kandidat pemasangan tap tunggal per ADR-0166 §2 ("satu sadapan
  `console` saat boot; keluaran asli tetap ke stdout/stderr").

### Pengukuran wajib sebelum default dikunci

ADR-0166 §7 secara eksplisit menyebut proyeksi volume (10 klien × lajur `server` 500 baris/hari ≈
35 000 baris pada retensi 7 hari) sebagai **proyeksi**, bukan angka terverifikasi, dan menuntut "Plan
wajib mengukur p95 `GET /specs` di bawah ingest sintetis sebelum default ini dikunci" — ini identik
dengan pengukuran §S10 spec SPEC-1215 (10 device × batch 500 entri/15 dtk selama 10 menit, lulus bila
p95 `GET /specs` naik ≤ 20% dan nol `P1008`). Fase Plan turunan D harus menjadikan pengukuran ini task
eksplisit, bukan verifikasi sisipan — jika gagal, koreksinya adalah amandemen ADR-0166 terhadap
`LOG_INGEST_MAX_PER_HOUR`/ukuran batch, bukan keputusan baru di sesi ini.

### Constraint yang mengikat implementasi (dikutip brief, dikonfirmasi konsisten dengan ADR-0166/kode)

- Bukan entitas `SYNCED` — dikonfirmasi: `LogEntry`/`LogCursor` tak muncul di daftar `SYNCED`/`FIELDS`
  manapun yang digrep di `server/src`/`shared/src`.
- Nol tulisan SQLite per baris untuk lajur `server` di klien — spool NDJSON, bukan `LogEntry` per baris
  console.
- Tanpa timer baru — shipper memakai tick sync (`sync-client.ts`), retensi memakai `runRetention()`
  (`retention.ts`) yang sudah dipanggil dari sapuan yang ada.
- Tanpa FTS/raw SQL — `GET /api/logs` memakai `LIKE` Prisma biasa dalam rentang waktu berindeks.
- Rahasia disaring sebelum spool/kirim (klien) **dan** diulang saat ingest (hub) — dua lapis independen,
  bukan satu lapis yang dipercaya dua kali.
- Klien tanpa hub tetap penuh mandiri; hub mati tak pernah memblokir pekerjaan lokal — pola yang sama
  dengan `startRelayClient` (fire-and-forget) yang sudah dibuktikan turunan A untuk kanal relay.

### Pertanyaan yang TIDAK dibuka ulang di sini

Bentuk kontrak persis (skema Zod `zLogBatch`, respons `LogEntryView`, rute `S4.7–S4.9`) sudah tertulis
literal di spec SPEC-1215; fase Spec turunan D mengutipnya sebagai kontrak final, hanya mengoreksi bila
ditemukan kontradiksi terhadap kode nyata turunan A (pola koreksi S1/S13 yang sudah dipraktikkan sesi
SPEC-1215). Tidak ditemukan kontradiksi semacam itu pada peninjauan kode di atas.
