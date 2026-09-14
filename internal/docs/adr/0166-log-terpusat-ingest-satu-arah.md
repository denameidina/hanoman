# ADR-0166 — Log terpusat: ingest satu arah di `/api/sync/logs`, tiga lajur, high-water mark per device

**Status:** diterima (SPEC-1215, fase Spec) · 2026-09-15 · **implementasi menyusul**. Tabel dan jalur
event lokal dikerjakan turunan A. Pengiriman, ingest, pencarian, retensi, lajur `server`, dan lajur
`transcript` dikerjakan turunan D.
**Mengamandemen** [0079](0079-history-sesi-terminal-store-lokal-plus-transkrip.md): transkrip boleh
menyeberang ke hub, **hanya** bila lajur `transcript` dinyalakan cookie lokal.
**Menegakkan** [0131](0131-retensi-change-feed-sync.md) (tanpa tulisan berkadens tinggi di jalur sync;
sapuan retensi tanpa timer baru), [0138](0138-sync-bootstrap-halaman-byte-feed-berdenyut.md)
(anggaran byte + gzip ber-cap), [0126](0126-durabilitas-penghapusan-transkrip-riwayat.md) (urutan baris
↔ berkas + rekonsiliasi yatim), [0082](0082-kontrak-apply-changefeed-record-tertunda.md) (tak ada kursor
yang tertahan selamanya), [0045](0045-skema-sync-synclog-version-stamp.md) (log **bukan** record sync),
[0024](0024-sesi-interaktif-menggantikan-run.md)/[0086](0086-sqlite-satu-satunya-provider.md).
Berpasangan dengan [ADR-0165](0165-kendali-jarak-jauh-hub-lewat-socket-relay.md). Design-of-record:
[spec SPEC-1215](../../../docs/superpowers/specs/2026-09-14-spec-1215-hub-orkestrasi-klien-design.md).

## Konteks

Log sesi dan server tersebar di `~/.hanoman` tiap mesin. Fastify `logger: false`, dan log server
berupa keluaran `console.*` yang ditangkap launchd/terminal. Investigasi lintas klien karena itu
harus login ke masing-masing device.

Constraint-nya:
- log dicari di hub per klien/project/SPEC/rentang waktu;
- retensi dapat diatur;
- saat klien offline, log ditampung lalu dikirim ulang **tanpa duplikat**;
- rahasia disaring **sebelum** dikirim;
- klien mandiri tetap penuh.

Volume terukur di mesin klien (Mac, launchd, 2026-08-14 → 2026-09-14): **15 546 baris / 31 hari**
(1,8 MB), ±500 baris/hari. Prisma 6 di SQLite **tak** mendukung `createMany({ skipDuplicates })`.

## Keputusan

### 1. Bukan entitas `SYNCED`, bukan socket relay

- **Bukan `SYNCED`.** Pull membagikan record hub ke **setiap** klien, sehingga log A akan mendarat di
  B. Log berkadens tinggi juga persis yang ADR-0131 larang dari `SyncLog`.
- **Bukan relay.** Log harus mengalir tanpa grant kendali (ADR-0165 §4).
- **Jalur:** `POST /api/sync/logs`, ber-Bearer device token, dikuras tick sync klien yang sudah ada.
  **Tak ada timer baru** di klien.

### 2. Tiga lajur, satu tabel

| Lajur | Isi | Sumber | Penyimpanan di klien | Default |
|---|---|---|---|---|
| `event` | sesi lahir/fase/selesai/gagal, peluncuran ditolak, audit `remote.*`/`relay.*`, `grant.changed`, `log.gap` | hook sesi (dibuat **aditif**), tick snapshot sesi 3 dtk, `recordSessionResult`, `LaunchError`/`LaunchAdmissionError`, dispatcher relay | baris `LogEntry` `deviceId:"local"` | **menyala** saat terhubung hub |
| `server` | keluaran `console.*` + galat tak tertangkap | satu sadapan `console` saat boot; keluaran asli tetap ke stdout/stderr | spool NDJSON bersegmen di `$HANOMAN_HOME/log-spool/server/` — **nol tulisan SQLite per baris** | **mati** |
| `transcript` | transkrip saat sesi ditutup + metadata riwayat | hook `onDeath` sesudah `saveTranscript` | baris penunjuk `LogEntry` lokal + berkas yang sudah ada | **mati** |

Model baru **`LogEntry`** dan **`LogCursor`** dipakai di **setiap** instance, dan butuh migration.
Hub mencatat event miliknya sendiri di pintu yang sama dengan `deviceId:"local"` (cermin ADR-0147 §8).
Lajur `server` hub masuk lewat fungsi ingest in-process yang sama, bukan HTTP ke dirinya sendiri.

### 3. Dedup tanpa `skipDuplicates`: high-water mark per `(deviceId, lane)`

- `seq` = **jam logis hibrida** per lajur: `max(seqTerakhir + 1, Date.now() × 1000)`.
  - Monoton lintas restart **tanpa** menulis penghitung per baris.
  - Monoton lintas instal ulang dengan device token yang sama.
  - Tetap aman sebagai integer JS (≈ 1,8 × 10¹⁵).
  - Kolomnya `BigInt`, karena `Int` Prisma 32 bit.
- **Hub**, dalam **satu transaksi**, membaca `LogCursor(deviceId, lane)`, menyisipkan hanya
  `seq > cursor`, lalu memajukan kursor.
- **Klien** memajukan `LogCursor("local", lane)` hanya sesudah ack.
- Crash di antara commit hub dan tulis kursor klien → kirim ulang → hub membalas `duplicate = n` →
  nol baris ganda.
- Unique `(deviceId, lane, seq)` tetap dipasang sebagai jaring pengaman.
- **Residu:** jam klien yang mundur melewati selisih seq membuat entri terbaca duplikat. Hub mendeteksi
  `duplicate > 0` pada batch `attempt: 1` dan mencatat `log.gap reason:"seq-regression"`, supaya
  kehilangan itu terlihat, bukan senyap.

### 4. Offline berbatas, pembuangan terlihat

- Batas penampungan: spool `server` ≤ 64 MiB (segmen 1 MiB); entri `event`/`transcript` belum-terkirim
  ≤ 50 000 baris.
- Saat penuh, yang dibuang lebih dulu adalah `server` terlama, lalu `transcript`; `event` paling akhir.
- Setiap pembuangan melahirkan entri `log.gap {lost, reason, fromSeq, toSeq}` ber-seq sendiri
  (pelajaran ADR-0131 §3: tak ada yang hilang senyap).
- Batch yang ditolak hub dengan 400 dibuang dengan `log.gap reason:"rejected"`, dan kursor maju.
  Menahannya berarti livelock (ADR-0082).

### 5. Redaksi dua lapis, gagal-tertutup

Fungsi murni `redactText(text, known)` di `@hanoman/shared` diuji korpus. Ia menyaring:
- **pola:** header `Bearer`, `hnm_agt_…`, `sk-ant-…`, `ghp_`/`github_pat_`, `AKIA…`, `xox?-…`, blok
  PEM, JWT, baris `NAMA=nilai` bernama rahasia;
- **nilai yang diketahui proses:** device token plaintext, `secret.key`, runtime config sensitif,
  nilai env bernama `TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE|CREDENTIAL|COOKIE|DSN|AUTH` (≥ 8 karakter,
  terpanjang dulu).

Diterapkan di klien **sebelum** spool atau pengiriman, lalu **diulang** saat ingest di hub. Redaktor
yang melempar → entri dibuang, diganti `log.gap reason:"redaction-failed"`.

### 6. Ingest ber-anggaran

- **Request:** body mentah ≤ 1 MiB; `content-encoding: gzip` didekompresi dengan `maxOutputLength`
  2 MiB (cap ganda, ADR-0138).
- **Batch:** ≤ 500 entri berseq naik ketat, `msg` ≤ 4 KiB, `data` ≤ 8 KiB, satu transkrip ≤ 1 MiB.
- **Kuota:** 20 000 entri/jam per device di memori hub → `429 retryAfterSec`. Klien menunda lajur
  itu tanpa menghentikan sync.
- **Transkrip** ditulis hub ke `$HANOMAN_HOME/remote-transcripts/<deviceId>/<seq>.txt` **sebelum**
  transaksi baris. Berkas tanpa baris dipungut sapuan, dan tak pernah ada baris tanpa berkas.

### 7. Pencarian dan retensi di hub — COOKIE_ONLY

- **`GET /api/logs`:**
  - `from`/`to` wajib, rentang ≤ 31 hari;
  - penyaring `device`, `project`, `spec`, `session`, `lane`, `level` (minimum), prefix `kind`, `q`
    (`contains` pada `msg`, ≤ 200 karakter);
  - urut `ts desc, id desc`, **paginasi kursor** ≤ 200/halaman, **tanpa `total`**.
  - Ini **pengecualian keempat ADR-0107**: `COUNT(*)` atas tabel log di setiap halaman mahal dan tak
    menjawab pertanyaan operator. Tak ada FTS/raw SQL (guard `webhook-no-raw-writes`).
- **`GET|PUT /api/logs/retention`:**
  - `Setting.data.logRetention = { eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 268435456 }`,
    tanpa migration;
  - **tak** bisa ditulis lewat `PUT /settings`, sebab memendekkan retensi = menghapus bukti audit.
- **Sapuan:** `runRetention()` yang sudah ada menghapus per lajur melewati umur dalam potongan, lalu
  memangkas terlama sampai `SUM(bytes) ≤ maxBytes`. Baris dulu, berkas transkrip sesudahnya, lalu
  rekonsiliasi yatim (ADR-0126).
- **Proyeksi volume hub:** 10 klien ber-lajur `server` × 500 baris/hari = ±35 000 baris pada retensi
  7 hari. Plan wajib mengukur p95 `GET /specs` di bawah ingest sintetis sebelum default ini dikunci.

### 8. Pengaturan pengiriman di klien — COOKIE_ONLY

`Setting.data.logShipping = { event: true, server: false, transcript: false }` dikelola lewat
`PUT /api/remote-control` bersama grant (ADR-0165 §4). Nilainya **tak** tertulis lewat `PUT /settings`,
karena menyalakan lajur transkrip = mengekspor isi sesi.

## Alternatif yang ditolak

- **`skipDuplicates`:** tak didukung SQLite.
- **`upsert` per baris:** N round-trip dan kunci tulis per entri.
- **Seq dari autoincrement lokal:** reset saat instal ulang ber-token sama → hub menolak semuanya
  senyap.
- **Epoch/streamId di kunci unik:** mengubah kontrak kriteria sukses dan menggandakan kursor tanpa
  perlu, karena HLC sudah menutup kasusnya.
- **Tulis SQLite per baris log server:** kelas ADR-0131.
- **FTS5 / raw SQL:** dilarang guard. `LIKE` dalam rentang waktu berindeks cukup untuk volume terukur.
- **Streaming transkrip selama sesi berjalan:** tampilan live sudah dilayani mirror terminal
  (ADR-0165).

## Konsekuensi

**Baik.** Satu tempat untuk menjawab "apa yang terjadi di klien X pada SPEC Y kemarin", termasuk
siapa di hub yang melakukan apa. Tanpa hub, klien tetap menyimpan audit `remote.*` lokal di tabel yang
sama.

**Buruk.**
- Dua model baru yang wajib dikecualikan dari daftar tulis-tangan entitas sync
  (`SYNCED`/`FIELDS`/`WEBHOOK_ENTITIES`), tetapi **wajib didaftarkan** di `PG_ORDER` `migrate-from-postgres`:
  test menuntut `PG_ORDER` = seluruh model DMMF, dan tabel yang absen di Postgres lama ditangani jalur
  42P01 (koreksi fase Plan SPEC-1215 §S13 P1).
- Hook sesi pty harus diubah dari satu slot menjadi aditif. `registerSessionHooks` hari ini
  **mengganti** hook sebelumnya, jadi pendaftar kedua akan mematikan riwayat sesi tanpa satu pun
  error.
- Tick snapshot sesi 3 dtk kini berjalan selama sync dikonfigurasi walau socket putus: ±20 spawn
  `tmux list-panes`/menit, sama dengan presence.
