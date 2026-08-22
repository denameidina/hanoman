# SPEC-885 — Sync hub → client baru: dari mandek jadi satu tarikan

Tanggal: 2026-08-22 · ADR: 0138 (ditulis bersama implementasi) · Status: rancangan

> Nomor ADR semula 0137 dan digeser ke 0138: SPEC-883 menerbitkan `0137-provisioning-vps-berbasis-katalog.md`
> ke `main` sementara spec ini ditulis. Tabrakan nomor ADR/SPEC antar-sesi paralel adalah kejadian
> berulang di repo ini — periksa `ls internal/docs/adr/ | tail -1` tepat sebelum menulis ADR-nya,
> bukan saat merancang.

## Masalah

Instalasi `hanoman` baru yang dikonfigurasi sebagai client sync tidak pernah selesai menarik data
dari hub. Keluhan operator: "sync semua datanya lama."

Pengukuran membantah kata "lama". Yang terjadi adalah **mandek permanen dan senyap**, ditambah
**kehilangan data diam-diam**, dan keduanya bukan regresi kode sync melainkan akibat susulan dari
retensi change-feed (ADR-0131) yang mengubah bentuk feed tanpa mengubah pembacanya.

## Pengukuran

Hub `hanoman.nafanesia.id` (`/srv/hanoman-prod/hanoman.db`), 2026-08-22. DB 19,3 MB, `journal_mode=wal`,
`MAX(seq) = 126.834` sementara feed hanya menyisakan 3.637 baris — retensi ADR-0131 bekerja.

Keadaan yang sebenarnya dibutuhkan client:

| entity | record |
|---|---|
| spec | 724 |
| sessionResult | 80 |
| ticket | 37 |
| ticketAttachment | 16 |
| project | 14 |
| vps | 9 |
| githubIssue | 9 |
| **total** | **889** |

Isi feed yang harus dilewatinya untuk sampai ke sana:

| entity | baris | record unik | KB | redundansi |
|---|---|---|---|---|
| vps | 2.469 | 9 | 4.068 | **274×** |
| spec | 971 | 728 | 3.699 | 1,3× |
| sessionResult | 80 | 80 | 23 | 1× |
| ticket | 43 | 43 | 21 | 1× |
| project | 29 | 18 | 51 | 1,6× |
| githubIssue | 27 | 9 | 88 | 3× |
| ticketAttachment | 18 | 18 | 4 | 1× |

Ukuran tiap halaman 500-baris yang diminta client sejak kursor 0:

| halaman | baris | MB |
|---|---|---|
| 0 | 500 | 0,75 |
| **1** | **500** | **2,51** |
| 2 | 500 | 1,12 |
| 3–6 | 500 | 0,85–0,91 |
| 7 | 130 | 0,23 |

Ada **348 jendela 500-baris** di feed yang melewati 2 MB, jadi halaman 1 bukan titik tunggal yang
kebetulan.

Urutan kausal di feed, sesudah retensi:

| | |
|---|---|
| spec total | 728 |
| induk tak ada di feed | **0** |
| **spec ber-`seq` lebih kecil dari baris induknya** | **510** |
| di antaranya jatuh di halaman 500-baris yang berbeda | 508 |

Kueri yang menghasilkan angka-angka ini dilampirkan di §Verifikasi agar bisa diulang.

## Empat akar

### A1 — Client baru mandek, tidak melambat

Halaman kedua berukuran 2,51 MB. `fetchTransport` (`server/src/services/sync-client.ts`) memasang
`maxResponseBytes: 2 * 1024 * 1024`; saat terlampaui `safeRequest` memanggil
`response.destroy(new Error("outbound response terlalu besar"))`. Pull melempar → `tick()`
menelannya (`catch { /* offline — coba lagi nanti */ }`, nol log) → halaman yang sama diminta ulang
tiap 15 detik, selamanya. Client berhenti di **500 dari 3.637** dan tak ada satu pun jejak.

Tombol "Tarik ulang" (`syncNow({ full: true })`) menabrak dinding yang sama. Bedanya lemparan itu
lolos ke route `/sync/now` → 500 → toast `Gagal sync` tanpa sebab. Jadi satu-satunya jalur pemulihan
yang dimiliki operator pun tertutup.

Penyebab strukturalnya: `pull()` memotong per **jumlah baris** (`limit = 500`, `sync.ts:292`)
sedangkan client memotong per **byte**. Baris feed berkisar 100 B–29 KB, jadi dua satuan itu tak
pernah bisa sepakat, dan yang menentukan bukan salah satunya melainkan kebetulan komposisi halaman.

### A2 — 70% spec hilang senyap, bahkan setelah A1 dibuka

Retensi ADR-0131 menyimpan hanya baris **terakhir** per `(entity, recordId)` di luar jendela 7 hari.
Baris **penciptaan** induk karena itu lenyap, dan yang tersisa adalah baris terakhirnya — yang
`seq`-nya bisa jauh lebih besar daripada `seq` anaknya. Terukur: **510 dari 728 spec** kini punya
`seq` lebih kecil dari baris project induknya.

`syncOnce` menangani anak-mendahului-induk dengan `deferred` + pass ulang — tetapi hanya **di dalam
satu halaman**. Satu putaran penuh tanpa kemajuan → `console.warn("…dilewati")`, `dropped++`, lalu
`setCursor(pullRes.body.cursor)` **tetap dijalankan**. Baris itu tertinggal di belakang kursor dan
tak akan pernah ditarik lagi.

Ini kelas kegagalan SPEC-382 yang terbuka kembali lewat pintu baru. Bukan karena kontrak apply
berubah, tetapi karena retensi menghapus properti yang diam-diam diandalkannya: dulu baris
penciptaan induk selalu ber-`seq` lebih kecil daripada anaknya, dan itu benar sampai baris itu
dipangkas.

### A3 — 75% yang diunduh memang sampah

`runHealth()` (`server/src/services/vps-audit.ts:135`) memanggil `notifySynced("vps", v.id)` di
**setiap** polling. ADR-0131 menyebut ini eksplisit di "Yang tidak diubah" dan menyerahkannya sebagai
optimasi terpisah — spec inilah tempatnya. Hasilnya 2.469 baris untuk 9 record: **51% byte feed,
68% barisnya**, hanya untuk mendarat jadi 9 baris `Vps`.

### A4 — Lajunya dipatok timer, bukan kapasitas

`syncOnce` melakukan **satu** pull per tick, dan tick-nya 15 detik. 8 halaman = 2 menit, dan hampir
sepanjang waktu itu jaringan serta CPU menganggur. Tidak ada loop "tarik lagi selagi masih ada".

## Rancangan

Lima fase. Fase 1–2 adalah koreksi kebenaran dan berdiri sendiri: setelah keduanya, instalasi baru
**selesai**. Fase 3 yang menjawab "lebih cepat". Fase 4–5 higienis dan bisa dibatalkan tanpa
menyentuh yang lain.

### Fase 1 — Halaman feed ber-anggaran byte

`pull(since, limit)` tetap mengambil `take: limit`, lalu **memangkas hasilnya sampai anggaran byte**
dan mengembalikan kursor yang menunjuk baris terakhir yang **benar-benar dikirim**.

- `SYNC_PULL_MAX_BYTES` default **1 MB** — separuh cap client, sisanya headroom amplop JSON
  (`entity`/`recordId`/`version`/`op` di luar `data`).
- **Minimal satu baris selalu dikirim**, supaya satu record raksasa tak bisa membekukan feed. Record
  terbesar di hub 29 KB dan `MAX_SYNC_RECORD_BYTES` client 1 MB — jaraknya aman, tetapi aturannya
  tetap ditulis karena yang dijaga adalah kelasnya, bukan angka hari ini.
- Respons dapat field aditif **`hasMore: boolean`**. Hub tahu persis karena ia yang memangkas —
  bukan tebakan `records.length === limit` yang salah tepat saat halaman penuh kebetulan habis.
  Client lama mengabaikan field ini (status quo).

Sisi client: `fetchTransport` menaikkan `maxResponseBytes` untuk pull ke **8 MB**.

Ini bukan duplikasi anggaran hub. Ini satu-satunya lapis yang menolong **client baru yang bicara ke
hub versi lama**, yang tetap mengirim 500 baris apa adanya. Urutan rilis tetap hub-duluan
(ADR-0135), tapi fase ini sengaja dibuat agar kombinasi client-baru/hub-lama pun sembuh — karena
justru itulah kombinasi yang dialami setiap orang yang baru `npm i -g hanoman`.

**Invarian:** kursor tak pernah melompati baris yang tak dikirim.

### Fase 2 — Drain berkelanjutan, `deferred` lintas halaman

Dua gejala (A2 dan A4) dengan satu obat.

`syncOnce` melingkar: tarik → terapkan → ulangi selama `hasMore`, dibatasi `FULL_PULL_MAX_PAGES`
sebagai jaring pengaman (bukan kuota), lalu drain outbox **sekali** di akhir. `deferred` hidup
**sepanjang lingkaran itu** dan di-retry sesudah tiap halaman.

Konsekuensinya justru inti fase ini: begitu drain-nya utuh, induk pasti sudah tiba sebelum lingkaran
berakhir. Terukur `induk_tak_ada_di_feed = 0`, jadi ini menyelamatkan **510 dari 510**. Yang masih
tak bisa diterapkan di **akhir** drain barulah benar-benar yatim, dan di situ `console.warn` +
`dropped++` yang sudah ada menjadi pernyataan jujur alih-alih artefak paginasi.

`syncNow({ full: true })` menjadi sepele: set kursor 0, satu `syncOnce`. Lingkaran 200-halaman di
`syncNow` dihapus karena `syncOnce` kini yang memilikinya.

**Yang sengaja TIDAK dilakukan:** menahan kursor di depan record yang gagal. Itu livelock yang
ditutup ADR-0082, dan di sini justru fatal — induknya ada di halaman **berikutnya**, jadi kursor
yang menolak maju menjamin ia tak pernah tiba.

`tick()` berhenti menelan senyap: kegagalan pull dicatat **sekali pada transisi sehat→gagal** dan
sekali saat pulih (pola ADR-0131 §3). Digerbangi flag modul, karena tick berjalan tiap 15 detik dan
log per-kegagalan akan jadi hujan log saat hub tak terjangkau.

### Fase 3 — Bootstrap snapshot

`GET /api/sync/bootstrap` (device-token, `preHandler: requireDeviceToken`).

Hub:

1. `cursor = MAX(seq)` dari `SyncLog` — **diambil lebih dulu**, sebelum satu tabel pun dibaca.
2. Baca **tabel**, bukan feed, lewat `snapshot()` yang sama supaya proyeksi `FIELDS` identik dengan
   record feed. Tidak ada jalur serialisasi kedua yang bisa menyimpang.
3. Urutan dependensi topologis diturunkan dari `PARENTS`: `project` → `spec` / `ticket` /
   `customAgent` / `githubIssue` → `ticketAttachment`. `sessionResult` bebas (`projectId`-nya kolom
   polos tanpa `@relation`).
4. Halaman ber-anggaran byte yang sama seperti Fase 1: `{ cursor, records, hasMore, next }`, dengan
   `next` = kursor posisi baca (`"<entity>:<id>"`) supaya paginasi stabil terhadap tulisan yang
   masuk selagi dibaca.

Hasil terukur: **3.637 baris / 7,9 MB → 889 record / ~2,5 MB** — 4× lebih sedikit baris, 3× lebih
sedikit byte, dan urutan FK benar *by construction* alih-alih diperbaiki oleh retry. Dengan anggaran
1 MB itu ~3 request berturut-turut, bukan 8 tick yang digiring timer.

**Yang terlihat salah tapi benar, dan wajib masuk ADR:** kursor diambil **sebelum** membaca, jadi
baris yang dibaca bisa lebih baru dari kursornya. Memutar ulang feed `> cursor` sesudahnya bisa
sesaat menulis versi lama di atas versi baru — `upsertLocal` menulis `version`/`data` apa adanya
dan tidak melihat urutan versi. Itu konvergen, karena seluruh baris diputar berurutan dan berakhir
di puncak yang benar. Kebalikannya (kursor diambil **sesudah** membaca) yang tidak aman: tulisan
yang masuk di sela itu ber-`seq` lebih kecil dari kursor dan hilang selamanya.

**Tombstone sengaja tidak ikut.** Record yang sudah dihapus cukup absen dari snapshot, dan kursor =
puncak berarti tak ada baris `op: "delete"` lama yang akan ditarik. Penghapusan sesudah kursor tiba
lewat feed seperti biasa.

Sisi client, di `startSyncClient` dan `syncNow({ full: true })`:

- Dipakai hanya bila `cursor === "0"` **dan** outbox kosong. Syarat kedua yang menjaga suntingan
  lokal dari ditimpa — tanpa itu "Tarik ulang" di mesin yang punya edit tertunda akan membuangnya.
- Hub lama menjawab 404 → jatuh ke drain feed biasa (Fase 2). Galat apa pun juga jatuh ke sana.
- Sesudah selesai: `setCursor(cursor)`, lalu lanjut normal.

### Fase 4 — Feed vps berhenti berdenyut

`runHealth()` publish hanya bila **`health` berubah**, bukan tiap polling.

Jebakannya: `runHealth` juga selalu menulis `lastSeenAt: new Date()`, dan `lastSeenAt` ada di
`FIELDS.vps` — jadi "publish kalau snapshot berubah" yang naif **tetap** publish tiap 5 menit.
Pembandingnya karena itu `health` saja.

`runAudit` (`vps-audit.ts:125`) **tidak** disentuh: `AUDIT_MS = 24 jam` dan `auditSweep` melewati
VPS yang `lastAuditAt`-nya < 24 jam, jadi ia paling banyak 1 baris/hari/vps — itu bukan denyut.
Yang berdenyut hanya `healthSweep`, `HEALTH_MS = 5 menit`.

Catatan atas angkanya: 9 VPS × 288 poll/hari × 7 hari seharusnya 18.144 baris, tapi feed hanya
memuat 2.469. Selisihnya karena `runHealth` `return false` **sebelum** publish bila SSH gagal
(`r.code !== 0 || !health`) — jadi ~1–2 VPS saja yang benar-benar terjangkau dan berdenyut. Ini
tidak mengubah rancangan; ia mengubah cara membaca hasilnya, karena artinya penghematan −4,0 MB
itu datang dari segelintir VPS dan akan **tumbuh** begitu VPS lain kembali sehat.

Tapi kalau `lastSeenAt` berhenti menyeberang sama sekali, ia mendarat basi di tiap client tanpa satu
pun error — persis kelas gagal-senyap ADR-0090/0093/0105. Karena itu ditambah **denyut berjangka**:
publish juga bila publikasi terakhir sudah lewat `VPS_PUBLISH_HEARTBEAT_MS` (default 1 jam). Hasil:
12 baris/hari/vps alih-alih 288 (−96%), dan `lastSeenAt` tetap akurat dalam ±1 jam.

Pelacaknya kolom **lokal** `Vps.lastPublishedAt` — migration aditif, **tidak** masuk `FIELDS` karena
ia properti mesin ini, bukan pernyataan bersama (sejajar `Project.repoDir`, `Vps.keyPath`).

Alternatif yang ditolak: membuat `lastSeenAt` sendiri berkadensi per jam. Itu menghemat satu kolom
dengan cara mengubah arti kolom yang dibaca dashboard — biaya yang salah tempat.

### Fase 5 — gzip di kabel

- Hub: `zlib.gzipSync` **di dalam dua route** (`/sync/pull`, `/sync/bootstrap`) saat client mengirim
  `accept-encoding: gzip`; balas `content-encoding: gzip` + `vary: accept-encoding`.

  Bukan `@fastify/compress`: paket itu belum jadi dependency, menambahkannya menyentuh daftar
  `--external` di skrip build esbuild `server/package.json`, dan ia memasang hook di seluruh
  lifecycle. Yang dibutuhkan cuma dua endpoint mesin-ke-mesin yang payload-nya sudah dibatasi
  ≤1 MB oleh Fase 1 dan sudah utuh di memori — `gzipSync` atasnya ~10 ms. Plugin sebesar itu
  untuk permukaan sekecil itu adalah dependency yang harus dibayar tiap rilis tanpa alasan.
- Client: `fetchTransport` mengirim `accept-encoding: gzip`.
- `safeRequest` menangani `content-encoding: gzip` di `pinnedRequest` lewat `zlib.createGunzip()`.

**Dua cap, bukan satu.** `maxResponseBytes` sekarang menghitung byte kabel. Dengan gzip itu tak lagi
cukup: 1 MB gzip bisa mengembang jadi gigabyte. Ditambah `maxDecodedBytes` (default = `maxResponseBytes`)
yang mematikan stream saat keluaran gunzip melewatinya.

**gzip opt-in per panggilan** (`acceptEncoding?: "gzip"`, default mati). `safe-outbound-request.ts`
dipakai juga oleh webhook keluar (ADR-0100) dengan penjaga SSRF; menyalakan dekompresi untuk semua
pemanggil memperlebar permukaan serang tanpa ada yang memintanya. Sync menyalakannya, webhook tidak.

## Yang sengaja tidak dikerjakan

- **Batching apply dalam satu `$transaction`.** 889 record × ~1 ms ≈ 1 detik — di bawah kebisingan
  dibanding fase mana pun di atas. Dan ia menabrak `deferred`: satu record gagal membatalkan seluruh
  batch, sehingga per-record fallback tetap harus ada. Kompleksitas tanpa hasil terukur.
- **Membuang `lastSeenAt` dari `FIELDS.vps`.** Lihat Fase 4.
- **Menahan kursor pada record yang gagal.** Lihat Fase 2.
- **Menyimpan `deferred` di tabel durable.** Fase 2 membuatnya tak perlu: drain yang utuh sudah
  menyelesaikan 510 dari 510. Tabel baru berarti permukaan gagal baru untuk masalah yang sudah habis.

## Acceptance criteria

1. **Ketika** hub memiliki jendela feed yang total byte-nya melewati anggaran, **maka** `pull` harus
   mengembalikan halaman yang lebih pendek dengan kursor menunjuk baris terakhir yang dikirim, dan
   `hasMore: true`.
2. **Ketika** sebuah baris feed sendirian sudah melewati anggaran byte, **maka** `pull` harus tetap
   mengirimkannya (minimal satu baris).
3. **Ketika** client menarik feed yang memuat record anak ber-`seq` lebih kecil daripada induknya di
   halaman berbeda, **maka** seluruh record harus terpasang di akhir drain dan tak satu pun
   `dropped`.
4. **Ketika** pull gagal, **maka** sistem harus mencatat satu baris log pada transisi sehat→gagal dan
   satu saat pulih — bukan per-kegagalan.
5. **Ketika** client dengan `cursor = "0"` dan outbox kosong memulai sync, **maka** ia harus memakai
   `/api/sync/bootstrap` dan selesai dalam satu drain.
6. **Ketika** hub menjawab 404 untuk `/api/sync/bootstrap`, **maka** client harus jatuh ke drain feed
   biasa tanpa galat yang terlihat operator.
7. **Ketika** client punya entri outbox, **maka** ia **tidak boleh** memakai bootstrap sekalipun
   kursornya 0.
8. **Ketika** `runHealth` mendapat `health` yang identik dengan yang tersimpan dan `lastPublishedAt`
   belum melewati ambang, **maka** tak ada baris `SyncLog` yang lahir.
9. **Ketika** `health` berubah, **atau** `lastPublishedAt` sudah lewat ambang, **maka** tepat satu
   baris `SyncLog` lahir.
10. **Ketika** respons ber-`content-encoding: gzip` mengembang melewati `maxDecodedBytes`, **maka**
    `safeRequest` harus mematikan stream dan melempar.
11. **Ketika** pemanggil tidak meminta `acceptEncoding: "gzip"`, **maka** `safeRequest` tidak boleh
    mengirim header itu maupun men-decompress.

## Verifikasi

**Reproduksi end-to-end dengan data nyata, tanpa menyentuh produksi.** Ambil salinan DB hub dengan
`sqlite3 ".backup"` (bukan `cp` — di WAL commit terbaru bisa masih ada di berkas `-wal`, ADR-0131),
jalankan sebagai hub di port cadangan dengan `HANOMAN_HOME` tersendiri, lalu arahkan client
ber-`HANOMAN_HOME` kosong kepadanya. Sebelum spec ini, client itu harus berhenti di ~500 record;
sesudahnya harus mencapai 889.

**Kueri pengukuran** (read-only, dijalankan atas salinan):

```sql
-- ukuran tiap halaman 500-baris sejak kursor 0
WITH f AS (SELECT seq, LENGTH(data)+LENGTH(entity)+LENGTH(recordId)+80 AS b,
                  ROW_NUMBER() OVER (ORDER BY seq) AS rn FROM SyncLog)
SELECT (rn-1)/500 AS page, COUNT(*) rows, SUM(b)/1048576.0 mb FROM f GROUP BY page ORDER BY page;

-- ukuran snapshot bootstrap (didekati dari baris puncak tiap record di feed: 905 record / 2,58 MB;
-- tabelnya sendiri 889 record karena 16 di antaranya sudah dihapus dan tinggal baris delete)
WITH tip AS (SELECT entity, recordId, MAX(seq) s FROM SyncLog GROUP BY entity, recordId)
SELECT COUNT(*) records, SUM(LENGTH(l.data))/1048576.0 mb
FROM tip t JOIN SyncLog l ON l.entity=t.entity AND l.recordId=t.recordId AND l.seq=t.s;

-- anak mendahului induk
WITH tip AS (SELECT entity, recordId, MAX(seq) s FROM SyncLog GROUP BY entity, recordId),
sp AS (SELECT t.recordId spec_id, t.s spec_seq, json_extract(l.data,'$.projectId') pid
       FROM tip t JOIN SyncLog l ON l.entity='spec' AND l.recordId=t.recordId AND l.seq=t.s
       WHERE t.entity='spec'),
pr AS (SELECT recordId pid, s FROM tip WHERE entity='project')
SELECT COUNT(*) total_spec,
       SUM(CASE WHEN pr.s IS NULL THEN 1 ELSE 0 END) induk_tak_ada_di_feed,
       SUM(CASE WHEN pr.s > sp.spec_seq THEN 1 ELSE 0 END) anak_mendahului_induk
FROM sp LEFT JOIN pr ON pr.pid = sp.pid;
```

**Test yang tersentuh** (`--no-file-parallelism`, `TEST_DATABASE_URL` tersendiri):
`sync.service.test.ts`, `sync-client.test.ts`, `sync.route.test.ts`, `sync-exclusions.test.ts`,
`vps-sync.test.ts`, plus berkas baru untuk bootstrap dan untuk regresi anak-mendahului-induk.

**Endpoint diuji nyata sekali di akhir** (boot server + curl `/api/sync/pull`, `/api/sync/bootstrap`)
sesuai AGENTS.md.

## Berkas yang tersentuh

| Fase | Berkas |
|---|---|
| 1 | `server/src/services/sync.ts` (`pull`), `server/src/services/sync-client.ts` (`fetchTransport`) |
| 2 | `server/src/services/sync-client.ts` (`syncOnce`, `syncNow`, `tick`) |
| 3 | `server/src/services/sync.ts` (`bootstrapSnapshot`), `server/src/routes/sync.ts`, `server/src/services/sync-client.ts` |
| 4 | `server/src/services/vps-audit.ts`, `server/prisma/schema.prisma` + migration |
| 5 | `server/src/routes/sync.ts`, `server/src/services/safe-outbound-request.ts`, `server/src/services/sync-client.ts` |
| docs | `internal/docs/adr/0138-*.md`, `internal/docs/README.md`, `internal/docs/architecture/api-contract.md` (endpoint bootstrap + `hasMore`), `internal/docs/architecture/data-model.md` (`Vps.lastPublishedAt`) |

## Urutan rilis

Hub duluan, client menyusul (ADR-0135). Fase 1 dirancang agar client baru terhadap hub lama pun
sembuh, jadi jendela di antara dua rilis itu tidak meninggalkan kombinasi yang mandek.
