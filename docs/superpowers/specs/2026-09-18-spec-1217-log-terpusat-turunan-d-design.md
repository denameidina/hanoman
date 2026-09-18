# SPEC-1217 · SPEC-1215 turunan D — log terpusat: pengiriman, ingest, redaksi, pencarian & retensi

**Tanggal:** 2026-09-18 · **Flow:** feature · **Prioritas:** sedang · **Sumber:** brief
**Base:** `61bc006c` · **Fase penulis bagian ini:** Brainstorm (1/5), Objective (2/5), Spec (3/5)
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

## Spec teknis (fase Spec 3/5)

**Design-of-record tetap spec SPEC-1215 §S4.7–S4.9/§S6/§S9/§S10 + ADR-0166.** Bagian ini **tidak**
membuka ulang keputusan itu; ia (a) mengutip kontrak yang mengikat, (b) **menutup enam titik
mekanisme** yang tertulis di ADR sebagai maksud tetapi belum punya bentuk di kode, dan (c) menurunkan
acceptance criteria EARS yang bisa diuji. Bila bagian ini berselisih dengan §S4–§S10 SPEC-1215, yang
berlaku adalah SPEC-1215 — kecuali pada enam butir §D di bawah, yang justru mengisinya.

### D. Mekanisme yang ditutup fase ini (bentuk, bukan keputusan baru)

**D1 · `session.phase` ditembakkan dari `buildLocalPresence()`, bukan hook pty ketiga.**
ADR-0166 §2 menyebut sumbernya "tick snapshot sesi 3 dtk". Kode nyata: `SessionHooks` hanya
`onBirth`/`onDeath` (`server/src/services/pty.ts:530`), dan `pty.ts` **sengaja nol dependensi DB**
(komentar `pty.ts:520-524`) — menambah `onPhase` di sana berarti memindahkan pembacaan berkas fase ke
modul yang justru dijaga bebas I/O DB. Sebaliknya, `buildLocalPresence()`
(`server/src/services/presence/snapshot.ts:51-54`) **sudah** menghitung `activePhase(p)` tiap tick 3
dtk lewat `readPhases()`, dan ia satu-satunya pembangun snapshot untuk klien (`presence/sender.ts:75`,
tick 3 dtk) maupun hub (`presence/view.ts:24`). Karena itu:

```ts
// server/src/services/logs/phase-tap.ts (baru)
export function observePhases(rows: { sessionId: string; projectId: string; specId?: string; phase?: string }[]): void
// diff murni terhadap Map<sessionId, phase|null> di memori →
//   appendEvent({ kind:"session.phase", msg:`sesi <id> fase <from> → <to>`, data:{from,to} })
// sesi yang hilang dari snapshot dibuang dari Map (tak ada event; `session.end` sudah melaporkannya)
export function __resetPhaseTap(): void
```

`buildLocalPresence()` memanggilnya satu baris sesudah `.map(paneToPresence…)`, fire-and-forget.
**Residu yang diterima:** instance tanpa sync **dan** tanpa layar Presence terbuka tak pernah
membangun snapshot, jadi tak menghasilkan `session.phase`. Itu konsisten dengan ADR-0166 (sumbernya
memang tick snapshot) dan tak melanggar K11: fitur lokal tak berubah.

**D2 · `launch.rejected` ditembakkan di titik LEMPAR, bukan di lima titik tangkap.**
`LaunchAdmissionError` dilempar dua kali di satu berkas (`session-admission.ts:59,61`) dan
`LaunchError` tiga kali (`session-launch.ts:92,105,173`), sementara penangkapnya lima
(`app.ts:110`, `routes/terminal.ts:117`, `governor.ts:93,150`). Tap dipasang di titik lempar →
peluncuran manual, scheduler, **dan** relay tercakup tanpa satu pun call site tambahan:
`appendEvent({ kind:"launch.rejected", level:"warn", data:{ kind, admission? , blockers? } })`.

**D3 · `session.result` ditap di `recordSessionResult()`** (`session-result.ts:11-20`), **sesudah**
`prisma.sessionResult.create` dan **sebelum** `notifySynced`, memakai field yang sudah lolos WHITELIST
(`status`, `oldStage`, `newStage`, `projectId`, `specId`). Nol perubahan alur; `appendEvent` tak pernah
reject (`event-log.ts:62-66`).

**D4 · Sadapan `console` dipasang/dicabut oleh keadaan, bukan hanya oleh boot.**
`installConsoleTap()`/`uninstallConsoleTap()` dipanggil (a) di `server.ts` saat boot bila
`Setting.data.logShipping.server` menyala, dan (b) dari `updateRemoteControl()`
(`services/remote-control.ts:16-42`) sesudah tulisan, sehingga menyalakan toggle berlaku **tanpa
restart**. Keluaran asli diteruskan ke `console` asli lebih dulu (AC-D10), redaksi dan spool
sesudahnya.

**D5 · Dekompresi request ber-cap dipasang di scope terenkapsulasi**, bukan di parser JSON global:
`routes/sync.ts` membuka `app.register(async (logs) => { … })` yang memasang
`addContentTypeParser("application/json", { parseAs:"buffer", bodyLimit: LOG_BODY_MAX_BYTES })` dan
`gunzipSync(buf, { maxOutputLength: LOG_DECODED_MAX_BYTES })`. `/sync/push` dan `/sync/pull` tak
tersentuh. `content-encoding` selain `gzip`/kosong → **415**; `RangeError`
(`ERR_BUFFER_TOO_LARGE`) atau body mentah > 1 MiB → **413**.

**D6 · `LogsPanel` adalah tab di layar Klien, bukan tab di `RemoteInstanceView`.**
Turunan D bergantung **A saja**; `RemoteInstanceView` lahir di C. `frontend-implementation.md:56`
memang sudah menempatkan tab **Log** di layar Klien. `ClientsScreen.tsx:127-133` hari ini daftar datar
`DeviceCard` → ditambah `<Tabs variant="pill">` ("Device" | "Log") memakai komponen `Tabs` yang sudah
ada (`src/src/ds/components/ui.tsx`, dipakai `TerminalScreen.tsx:481`).

### S1. Arsitektur

```
 KLIEN (instance mana pun) ────────────────────────────────────────────────────────────────────
  console.*  ──► logs/console-tap.ts ──(redactText)──► logs/spool.ts  NDJSON bersegmen 1 MiB
                  (keluaran asli tetap ke stdout/stderr;   $HANOMAN_HOME/log-spool/server/*.ndjson
                   identik beruntun ≤60 dtk → data.repeat)  ≤64 MiB, buang tertua → log.gap
  hook sesi onBirth/onDeath ┐
  buildLocalPresence() ─────┤ logs/{event-tap,phase-tap}.ts ──(redactText)──► appendEvent()
  recordSessionResult()     ├─► kind: session.start|phase|end|result, launch.rejected,
  Launch*Error (titik lempar)│         remote.*, grant.changed, log.gap
  saveTranscript() (onDeath) ┘  lajur transcript: baris penunjuk LogEntry + transcriptKey lokal
                                     │
  syncTick() ──sesudah syncOnce()──► logs/shipper.ts   per lajur ≤4 batch/tick, ≤500 entri
      (TANPA timer baru)               sumber: LogEntry local seq > LogCursor("local",lane)
                                       lajur server: segmen spool
                                       ack 200 → LogCursor("local") maju; 400→gap; 404→tunda 30 mnt;
                                       413→belah; 429→tunda retryAfterSec (lajur itu saja)
                                     │ POST /api/sync/logs  Bearer device token, gzip opsional
 HUB ─────────────────────────────────▼────────────────────────────────────────────────────────
  routes/sync.ts (scope terenkapsulasi) → gunzip maxOutputLength 2 MiB → zod zLogBatch
   → logs/redact lapis 2 → tulis berkas transkrip (tmp+rename) → $transaction{
       LogCursor(deviceId,lane) → saring seq>cursor → createMany → upsert kursor }
   → kuota 20 000 entri/jam per device (memori) → 200 {lane,accepted,duplicate,lastSeq}
  routes/logs.ts  GET /logs · GET /logs/:id/transcript · GET|PUT /logs/retention   (COOKIE_ONLY)
  services/retention.ts runRetention() + pruneLogs()  (sapuan 24 jam yang SUDAH ada)
  src/src/screens/ClientsScreen.tsx  tab "Log" → LogsPanel.tsx
```

### S2. Komponen

| Modul | Baru/ubah | Tanggung jawab |
|---|---|---|
| `shared/src/logs.ts` | ubah | konstanta S4.1 yang belum ada (batch/body/spool/kuota/pencarian), `zLogBatch`/`zLogWireEntry` `.strict()`, `zLogSearchQuery` |
| `shared/src/redact.ts` | baru | `redactText(text, known)` murni + `redactValue(data, known)` untuk `data` JSON |
| `server/src/services/logs/redact-known.ts` | baru | kumpulan "nilai yang diketahui proses" (device token, `secret.key`, env bernama rahasia) — **tak** ikut ke `shared` karena membaca proses |
| `server/src/services/logs/spool.ts` | baru | NDJSON bersegmen, `append()`, `readSegments()`, `dropOldest()`, batas 64 MiB/1 MiB |
| `server/src/services/logs/console-tap.ts` | baru | `installConsoleTap()`/`uninstallConsoleTap()`, penggabung `data.repeat` |
| `server/src/services/logs/phase-tap.ts` | baru | `observePhases()` (D1) |
| `server/src/services/logs/event-log.ts` | ubah | `installEventTap()` + tap transkrip `onDeath`; `appendGap()` |
| `server/src/services/logs/shipper.ts` | baru | `shipLogs(base, token)` per lajur, kursor, penundaan per lajur |
| `server/src/services/logs/ingest.ts` | baru | redaksi lapis 2, berkas transkrip, transaksi high-water mark, kuota |
| `server/src/services/logs/search.ts` | baru | `searchLogs(q)` kursor opaque, `readRemoteTranscript(id)` |
| `server/src/services/logs/prune.ts` | baru | `pruneLogs(now, retention)` + `reconcileRemoteTranscripts()` |
| `server/src/routes/sync.ts` | ubah | scope `POST /sync/logs` (D5) |
| `server/src/routes/logs.ts` | baru | `GET /logs`, `GET /logs/:id/transcript`, `GET|PUT /logs/retention` |
| `server/src/services/agent-capabilities.ts` | ubah | top `/logs*` → COOKIE_ONLY (pola `/remote-control*`, baris 44) |
| `server/src/services/retention.ts` | ubah | `runRetention()` memanggil `pruneLogs()`; `RetentionReport.logsPruned`/`logBytes` |
| `server/src/services/remote-control.ts` | ubah | `logs` di `GET` (P6 SPEC-1215) + pasang/cabut sadapan console (D4) |
| `server/src/services/sync-client.ts` | ubah | `syncTick()` memanggil `shipLogs()` fire-and-forget |
| `server/src/services/presence/snapshot.ts` | ubah | satu baris `observePhases()` (D1) |
| `server/src/services/session-admission.ts` · `session-launch.ts` · `session-result.ts` | ubah | tap D2/D3 |
| `server/src/server.ts` | ubah | `installConsoleTap()` di boot bila lajur `server` menyala |
| `src/src/screens/LogsPanel.tsx` | baru | pencarian + kursor + transkrip + pengaturan retensi |
| `src/src/screens/ClientsScreen.tsx` · `RemoteControlPanel.tsx` | ubah | tab "Log" (D6); tiga toggle lajur log |
| `src/src/api/client.ts` | ubah | `logs()`, `logTranscript()`, `logRetention()`, `putLogRetention()` |

### S3. Kontrak

#### S3.1 Konstanta yang ditambahkan ke `shared/src/logs.ts`

Sudah ada di kode (turunan A): `LOG_LANES`, `LOG_LEVELS`, `LOG_MSG_MAX_BYTES` (4 KiB),
`LOG_DATA_MAX_BYTES` (8 KiB), `nextSeq`, `LogEntryView`, `zLogShipping`, `zLogRetention`.
**Ditambahkan D**, nilai persis §S4.1 SPEC-1215 — tak boleh diubah tanpa amandemen ADR-0166:

```ts
LOG_BATCH_MAX_ENTRIES = 500          LOG_BODY_MAX_BYTES = 1 MiB     LOG_DECODED_MAX_BYTES = 2 MiB
LOG_TRANSCRIPT_MAX_BYTES = 1 MiB     LOG_SPOOL_MAX_BYTES = 64 MiB   LOG_SPOOL_SEGMENT_BYTES = 1 MiB
LOG_LOCAL_PENDING_MAX_ROWS = 50_000  LOG_REPEAT_WINDOW_MS = 60_000  LOG_INGEST_MAX_PER_HOUR = 20_000
LOG_SEARCH_MAX_RANGE_DAYS = 31       LOG_SEARCH_MAX_LIMIT = 200     LOG_SHIP_MAX_BATCHES_PER_TICK = 4
LOG_UNSUPPORTED_RETRY_MS = 30 * 60_000
```

#### S3.2 `redactText()` (fungsi murni, `shared/src/redact.ts`)

```ts
export function redactText(text: string, known?: readonly string[]): string
export function redactValue<T>(value: T, known?: readonly string[]): T   // rekursif atas string di JSON
```

- **Pola** (ADR-0166 §5, urutan tetap): header `Bearer <t>`; `hnm_agt_…`; `sk-ant-…`;
  `ghp_`/`github_pat_`; `AKIA[0-9A-Z]{16}`; `xox[abprs]-…`; blok PEM (`-----BEGIN … KEY-----` …
  `-----END`); JWT (`eyJ…\.…\.…`); baris `NAMA=nilai` dengan NAMA cocok
  `TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE|CREDENTIAL|COOKIE|DSN|AUTH`.
- **Nilai yang diketahui proses:** `known` ≥ 8 karakter, dicocokkan **terpanjang dulu** (substring
  literal, bukan regex).
- Pengganti: `«redacted:<label>»`. Fungsi **murni** dan **idempoten** (`f(f(x)) === f(x)`), sehingga
  lapis kedua di hub tak merusak keluaran lapis pertama.
- **Gagal-tertutup:** pemanggil (klien maupun hub) membungkusnya `try/catch`; lempar → entri dibuang
  dan diganti `log.gap { lost:1, reason:"redaction-failed", fromSeq, toSeq }`.

#### S3.3 Spool NDJSON (klien, lajur `server`)

`$HANOMAN_HOME/log-spool/server/<epochMs>-<n>.ndjson`, satu baris = satu `LogWireEntry` **yang sudah
diredaksi**. Segmen ditutup pada 1 MiB; total > 64 MiB → segmen **tertua** dihapus dan satu
`log.gap { lost, reason:"spool-full", fromSeq, toSeq }` lahir di lajur `event`. Urutan buang saat
tekanan: `server` → `transcript` → `event` (`event` hanya dipangkas bila baris `LogEntry` local
belum-terkirim > `LOG_LOCAL_PENDING_MAX_ROWS`). Nol tulisan SQLite per baris console.

#### S3.4 `POST /api/sync/logs` — dikutip utuh dari §S4.7 (kontrak final)

Skema `zLogBatch`/`LogWireEntry`, urutan enam langkah hub, dan matriks respons klien
(200/400/404/413/429/5xx) berlaku **apa adanya**. Tambahan bentuk yang ditutup fase ini:

- preHandler `requireDeviceToken` (pola `routes/sync.ts:66`), `deviceId = req.device!.id`;
- kuota: `Map<deviceId, { windowStart, count }>` di memori hub, jendela geser 1 jam →
  `429 { error:"quota", retryAfterSec }`; `retryAfterSec` = sisa detik jendela;
- `seq` naik **ketat** dalam batch (`400` bila tidak);
- transkrip ditulis `…/remote-transcripts/<deviceId>/<seq>.txt.tmp` lalu `rename` **sebelum**
  `$transaction` (berkas yatim dipungut sapuan; tak pernah baris tanpa berkas);
- `bytes` = `utf8Bytes(msg) + bytes(data JSON) + bytes(transkrip)`.

#### S3.5 `GET /api/logs` · `/logs/:id/transcript` · `GET|PUT /logs/retention`

Kontrak §S4.8 berlaku apa adanya. Bentuk yang ditutup fase ini:

- **Kursor opaque** = `base64url(JSON.stringify({ ts: <ISO>, id: <number> }))`; halaman berikutnya =
  `OR: [{ ts: { lt } }, { ts, id: { lt } }]` di atas `orderBy [{ts:"desc"},{id:"desc"}]` — stabil
  walau baris baru masuk di antara halaman. Kursor cacat → **400**.
- `lane` menerima daftar dipisah koma; `level` = **minimum** (`info` → `info|warn|error`) lewat
  `in`; `kind` = `startsWith`; `q` = `contains` pada `msg` (≤ 200 karakter, tanpa FTS/raw SQL).
- `from`/`to` wajib, `to - from ≤ 31 hari`, `to ≥ from` → selain itu **400**.
- **Tanpa `total`** (pengecualian keempat ADR-0107, dikunci ADR-0166 §7).
- `GET /logs/:id/transcript`: baris bukan lajur `transcript`, `transcriptKey` kosong, atau berkas
  hilang → **404**; sukses → `text/plain; charset=utf-8`.
- `PUT /logs/retention` memvalidasi `zLogRetention` (sudah ada, `shared/src/logs.ts:42-45`) dan
  menulis `Setting.data.logRetention`. `PUT /settings` tetap **mempertahankan** kunci itu (sudah
  terpasang turunan A) — memendekkan retensi lewat agent token berarti menghapus bukti audit.
- Ketiganya `COOKIE_ONLY` lewat top `/logs*` di `agent-capabilities.ts`.

#### S3.6 Retensi

`runRetention()` (`retention.ts:29-46`) memanggil `pruneLogs(now, retention, opts)` **sesudah**
`pruneSyncFeed` dan **sebelum** `reconcileTranscripts`. `RetentionReport` bertambah dua field
(`logsPruned`, `logBytesFreed`) — pola `feedPruned`, bukan laporan terpisah. Urutan di dalam
`pruneLogs`: (1) per lajur `ts < now - <lane>Days` dalam potongan 5 000 id; (2) selama
`aggregate _sum.bytes > maxBytes`, hapus terlama per potongan; (3) hapus berkas transkrip milik
baris yang terhapus; (4) `reconcileRemoteTranscripts()` memungut berkas tanpa baris (pola
`reconcileTranscripts`, `session-history.ts:170-200`, termasuk grace period). Di klien, baris
`deviceId:"local"` yang **sudah di-ack** (`seq ≤ LogCursor("local",lane)`) dan melewati umur ikut
tersapu fungsi yang sama (P7 SPEC-1215); baris belum-terkirim tak pernah dihapus sapuan umur.

#### S3.7 Frontend

- `LogsPanel` (`src/src/screens/LogsPanel.tsx`): formulir penyaring (rentang default 24 jam, device,
  project, spec, lane, level, kind, `q`), daftar baris dense (`hn-dense-row`, pola
  `ClientsScreen.tsx:34-47`), tombol "Muat lagi" memakai `nextCursor` (tak ada nomor halaman — tak ada
  `total`), baris ber-`hasTranscript` membuka transkrip, dan blok "Retensi" (`GET|PUT`).
  `StateBlock kind="empty"` saat nol hasil; galat 400 rentang ditampilkan apa adanya.
- `ClientsScreen`: `Tabs variant="pill"` ("Device" | "Log"); tab default "Device" sehingga layar yang
  ada tak berubah bentuknya.
- `RemoteControlPanel`: tiga toggle lajur log (`logs.event|server|transcript`) di atas
  `api.putRemoteControl()` yang sudah ada; `event` ditampilkan menyala secara default.

### S4. Penanganan galat

Matriks §S6 SPEC-1215 berlaku apa adanya untuk baris ingest/spool/redaktor/transkrip. Yang
ditambahkan fase ini (bentuk, bukan keputusan):

| Kondisi | Perilaku | Jejak |
|---|---|---|
| `content-encoding` asing di `/sync/logs` | `415` sebelum parsing | — |
| gzip mekar > 2 MiB (`ERR_BUFFER_TOO_LARGE`) atau body mentah > 1 MiB | `413`; klien membelah batch | — |
| `seq` tak naik ketat / skema cacat | `400 { error }`; klien menaruh `log.gap reason:"rejected"` dan **memajukan** kursor (anti-livelock ADR-0082) | `log.gap` |
| Kuota terlampaui | `429 { error, retryAfterSec }`; klien menunda **lajur itu**; `syncOnce` tetap jalan | — |
| `attempt === 1 && duplicate > 0` | hub menulis `log.gap reason:"seq-regression"` | `log.gap` |
| `$transaction` gagal | `500`; berkas transkrip yang sudah ditulis jadi yatim → dipungut sapuan; kursor klien tak maju → kirim ulang | — |
| Shipper melempar apa pun | ditangkap di `syncTick`; sync **tak** terganggu (K11/AC-M2) | `console.warn` transisi |
| `redactText` melempar (klien atau hub) | entri dibuang, diganti `log.gap reason:"redaction-failed"` | `log.gap` |
| Spool tak bisa ditulis (disk penuh/ENOSPC) | sadapan console **tetap** meneruskan ke stdout/stderr; baris dibuang | `log.gap reason:"spool-write"` |
| Berkas transkrip hilang sebelum dikirim | entri dikirim `data.missing:true`, tanpa `transcript` | — |
| Kursor `GET /logs` cacat / rentang > 31 hari / `from`/`to` absen | `400` | — |
| `GET /logs/:id/transcript` bukan lajur transcript / berkas hilang | `404` | — |

### S5. Acceptance criteria (EARS)

**Kontrak final (dikutip dari §S9 SPEC-1215 — tak diubah):** AC-D1 … AC-D10, sebagaimana tertulis
lengkap di bagian "Keputusan yang dikunci untuk turunan D" di atas. Turunan D dinyatakan selesai
hanya bila kesepuluhnya terbukti lewat test.

**Turunan spec (mengikat Plan/Execute; menutup mekanisme §D, bukan menggantikan AC-D di atas):**

- **AC-S1** (D1) — WHEN `buildLocalPresence()` menghasilkan snapshot yang fase `active` sebuah sesi
  berbeda dari snapshot sebelumnya, THE instance SHALL menulis satu `LogEntry` `kind:"session.phase"`
  ber-`data {from, to}`. WHILE fase tak berubah, THE instance SHALL tak menulis satu baris pun.
- **AC-S2** (D2/D3) — WHEN `LaunchAdmissionError` atau `LaunchError` dilempar, THE instance SHALL
  menulis `launch.rejected` ber-`level:"warn"` **satu kali** per lemparan, apa pun penangkapnya
  (route, scheduler, relay). WHEN `recordSessionResult()` menulis barisnya, THE instance SHALL
  menulis `session.result {status, oldStage, newStage}`. IF penulisan log gagal, THEN peluncuran dan
  `SessionResult` SHALL tetap berjalan seperti sebelumnya.
- **AC-S3** (D4) — WHEN operator menyalakan lajur `server` lewat `PUT /api/remote-control`, THE klien
  SHALL memasang sadapan `console` tanpa restart, dan WHEN ia mematikannya, THE klien SHALL
  mencabutnya sehingga `console.*` kembali ke bentuk aslinya (diuji dengan membandingkan referensi
  fungsi sebelum dan sesudah).
- **AC-S4** (D5) — THE route `POST /api/sync/logs` SHALL memakai parser ber-`bodyLimit` sendiri,
  dan `POST /api/sync/push` SHALL tetap memakai parser JSON bawaan (diuji: push besar yang lolos hari
  ini tetap lolos).
- **AC-S5** (S3.2) — THE `redactText()` SHALL idempoten (`f(f(x)) === f(x)`) dan murni (nol I/O),
  dibuktikan korpus yang memuat setiap pola ADR-0166 §5 plus kasus negatif (teks biasa yang
  menyerupai token tak boleh ikut tersamar lebih dari polanya).
- **AC-S6** (S3.5) — WHEN sebuah halaman `GET /api/logs` diambil dan baris baru masuk sebelum halaman
  berikutnya diminta, THE kursor SHALL tetap mengembalikan baris yang belum terlihat, tanpa
  duplikat dan tanpa lompatan (diuji dengan menyisipkan baris di antara dua panggilan).
- **AC-S7** (S3.6) — WHEN sapuan retensi berjalan di klien, THE sapuan SHALL tak pernah menghapus
  baris `local` yang `seq`-nya melewati `LogCursor("local", lane)` (belum di-ack hub), berapa pun
  umurnya.
- **AC-S8** (D6) — THE layar Klien SHALL merender tab "Device" secara default, sehingga test layar
  Klien yang ada hijau tanpa perubahan ekspektasi; tab "Log" SHALL merender `LogsPanel`.
- **AC-S9** (§S10 SPEC-1215 / ADR-0166 §7) — THE pengukuran ingest sintetis (10 device × 500
  entri/15 dtk × 10 mnt) SHALL dijalankan sebagai task eksplisit sebelum default
  `LOG_INGEST_MAX_PER_HOUR` dikunci. IF p95 `GET /specs` naik > 20 % atau ada `P1008`, THEN
  koreksinya SHALL berupa amandemen ADR-0166, bukan keputusan baru di sesi ini.

### S6. Rencana verifikasi

Diambil dari §S10 SPEC-1215 ("Server D" + frontend), ditambah berkas untuk mekanisme §D:

| Berkas test | Menutup |
|---|---|
| `shared/test/redact.test.ts` | AC-D4, AC-S5 (korpus pola + nilai diketahui + idempoten + lempar) |
| `shared/test/logs.test.ts` (ubah) | konstanta baru, `zLogBatch` `.strict()`, seq naik ketat |
| `server/test/log-ingest.route.test.ts` | AC-D2, AC-D4, AC-D7, AC-S4 (kirim ulang, gzip 413/415, kuota 429, berkas-sebelum-baris, `seq-regression`) |
| `server/test/log-shipper.test.ts` | AC-D1, AC-D2 (crash-kirim-ulang), AC-D7, AC-D9 |
| `server/test/log-spool.test.ts` | AC-D3, AC-D10 (`data.repeat`, urutan buang, `log.gap`) |
| `server/test/logs.route.test.ts` | AC-D5, AC-D8, AC-S6 (rentang wajib, penyaring, kursor stabil, `relay.*` + `remote.*` satu tabel) |
| `server/test/retention-logs.test.ts` | AC-D6, AC-S7 |
| `server/test/log-taps.test.ts` | AC-S1, AC-S2, AC-S3 (phase diff, launch.rejected, session.result, pasang/cabut sadapan) |
| `src/test/LogsPanel.test.tsx` · `ClientsScreen.test.tsx` (ubah) | AC-D5 (UI), AC-S8 |
| `src/test/RemoteControlPanel.test.tsx` (ubah) | AC-D1 (toggle lajur) |

Resep run (mesin bersesi banyak, wajib): `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u
SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism
<paths>`.

**Pengukuran (AC-S9)** dan **API nyata sekali di akhir** (`POST /api/sync/logs` dua kali identik →
`duplicate`; `GET /api/logs`; `GET|PUT /api/logs/retention`) sesuai §S10 SPEC-1215.

### S7. Docs yang tersentuh

- **Fase ini (commit yang sama):** dokumen ini; tautannya di `internal/docs/README.md`.
- **Saat Execute (commit implementasi):** cabut penanda "belum dilayani/DIRANCANG" bagian D di
  `architecture/api-contract.md:1417-1418` (`POST /sync/logs`, `/logs*`) dan `remote-control` tanpa
  `shipping` (baris 1414), `architecture/data-model.md:288-296,740-760`,
  `architecture/stack.md:41-48`, `frontend/frontend-implementation.md:45-59`,
  `adr/0166-log-terpusat-ingest-satu-arah.md` (status "sebagian mendarat" → mendarat penuh),
  `docs/agent-integration.md` (daftar cookie-only: top `logs`), dan `internal/skills/hanoman/SKILL.md`.

### S8. Batas & residu yang diterima

- Instance tanpa sync **dan** tanpa layar Presence terbuka tak menghasilkan `session.phase` (D1).
- Jam klien mundur melewati selisih seq → entri terbaca duplikat, terlihat sebagai
  `log.gap seq-regression` (residu ADR-0166 §3, tak ditutup di sini).
- Kuota disimpan di memori hub: restart hub mengosongkan jendela. Itu sengaja — ia pagar beban, bukan
  akuntansi.
- Angka §S3.1 adalah angka awal ADR-0166; hanya AC-S9 yang boleh mengubahnya, lewat amandemen ADR.
