# SPEC-799 — Sync tombstone: penghapusan menyeberang antar-instance

**Tanggal:** 2026-08-15 · **Sumber:** brief · **Prioritas:** tinggi
**ADR baru:** 0119 — Tombstone sync: hard-delete + `SyncTombstone`, `SyncLog.op`, delete menang
**ADR tersentuh:** 0045 (diperluas), 0067 (diperluas), 0068 (batasan "tanpa tombstone" **dicabut**),
0082 (batasan "delete tak merambat" **dicabut**; kontrak apply **ditegakkan**), 0043/0046 (utuh)

## Masalah

Mesin sync record hanya mengenal UPSERT. Tak ada satu pun bentuk record "dihapus":
`server/src/routes/projects.ts:105` memanggil `prisma.project.delete()` lalu langsung `204` —
tanpa `notifySynced`, tanpa `enqueueOutbox`. Komentar `sync-client.ts:121` sudah mengakuinya apa
adanya: *"feed append-only tanpa tombstone (ADR-0068)"*.

Akibatnya penghapusan tak pernah menyeberang, dan sisi lain **menghidupkannya kembali lewat dua
jalur berlawanan arah**:

1. **Hapus di CLIENT** → baris masih hidup di hub, dan kembali begitu ada `SyncLog` baru menyentuh
   record itu: siapa pun mengedit di hub, `backfillFeed()` saat hub boot (`sync.ts:256`), atau
   tombol **Tarik ulang** yang me-reset kursor ke 0 dan memutar ulang seluruh feed
   (`sync-client.ts:203-220`). `upsertLocal()` adalah upsert — cabang create menyisipkannya utuh.
2. **Hapus di HUB** → baris masih hidup di client. Begitu client mengedit record itu (atau punya
   entri outbox tersisa) ia push, dan `applyPush` memperlakukan id yang absen sebagai **INSERT BARU
   yang selalu diterima** (`sync.ts:201-213`, `newVersion = 1`) — nol konflik tercatat.

Efek samping: anak dari record yang dihapus tetap datang di feed, gagal FK, lalu **dilewati dengan
`console.warn`** (`sync-client.ts:114-129`) — hilang senyap sampai induknya muncul lagi.

Gejala yang dilaporkan: *"project yang sudah dihapus kembali lagi setiap sync dengan hub."*

Ini bukan tambal satu route. Seluruh delapan entitas `SYNCED` (`sync.ts:16`) berpenyakit sama, dan
perbaikannya menyentuh **kedua peran** karena satu binary yang sama memainkan keduanya.

## Keputusan bentuk (dikunci di fase brainstorm)

| Percabangan | Keputusan | Alasan singkat |
|---|---|---|
| Bentuk data | **hard-delete + tabel `SyncTombstone`** | nol query baca yang berubah; cascade Prisma tetap bekerja; unique constraint tak terhalang; tap webhook tetap melihat delete sebagai delete |
| Konflik hapus-vs-edit | **delete menang tanpa syarat** | hasil independen urutan tiba; kelas bug ini justru "yang dihapus kembali lagi" — antrean konflik mengembalikannya sebagai "masih ada sampai manusia mengklik" |
| Retensi otomatis | **tidak menerbitkan tombstone** | `retention.ts` & `ticket.ts:pruneOldTickets` memang sudah di luar permukaan `notifySynced` — batas yang ada, bukan pengecualian baru |

**Mengapa bukan soft-delete `deletedAt`.** Bentuk (b) menyentuh **setiap** query baca dari delapan
entitas — `findMany`/`findUnique`/`count`/`aggregate` di seluruh server. Satu penyaring yang
terlewat membuat record "terhapus" muncul lagi, yaitu **bug yang sedang kita perbaiki**, dan ia
gagal SENYAP. Di samping itu `onDelete: Cascade` tak lagi berlaku (perambatan harus ditulis
tangan), `@@unique([projectId, number])` pada `Ticket` menolak pembuatan ulang, dan tap Prisma
ADR-0100 membaca hapus sebagai `update`. Biaya itu dinyatakan di sini, bukan ditemukan di tengah
jalan.

## Ide inti

> **Tombstone bukan mekanisme kedua di samping version-stamp — ia adalah versi record itu sendiri,
> berkeadaan "dihapus".**

`applyPush` hari ini menerima tulisan bila `baseVersion === existing.version`. Dengan menjadikan
tombstone sebagai sumber `existing.version` ketika barisnya tak ada, **penolakan kebangkitan jatuh
dari aturan yang SUDAH ada** — tanpa cabang khusus, tanpa kosakata baru. Sebuah id yang bertombstone
di version 6 hanya bisa dihidupkan oleh tulisan yang tahu tentang version 6.

## Skema (migration additive)

```prisma
// SPEC-799 · ADR-0119 · keadaan "record ini dihapus" yang bisa menyeberang & bertahan restart.
// Hard-delete: barisnya benar-benar hilang, cascade tingkat-DB tetap bekerja. `data` = snapshot
// terakhir field tersync — dibutuhkan agar push delete ke hub versi LAMA tetap berbentuk sah
// (kalau tidak: create tanpa kolom required → P2011 → 500 di tiap siklus push).
model SyncTombstone {
  id        String   @id @default(cuid())
  entity    String
  recordId  String
  version   Int      // versi record SESUDAH dihapus (= versi terakhir + 1)
  data      Json     // snapshot field tersync tepat sebelum dihapus
  deletedAt DateTime @default(now())
  deviceId  String?

  @@unique([entity, recordId])
  @@index([entity, recordId])
}

model SyncLog {
  ...
  op String @default("upsert")   // "upsert" | "delete" — kolom baru, default aman untuk baris lama
}
```

Keduanya additive. `op` ber-`@default` sehingga seluruh baris feed lama terbaca sebagai `upsert`.

## Kompatibilitas versi campur — ini yang menyetir bentuk wire

`validateIncomingRecord` (`sync-client.ts:18-30`) **melempar** untuk bentuk tak dikenal, dan lemparan
itu menyalakan `feedHole` yang **menahan kursor**. Client versi lama karena itu bisa **mandek total**,
bukan sekadar melewatkan tombstone. Konsekuensinya mengikat:

- **`op` hidup di TOP-LEVEL record, tak pernah di dalam `data`.** `validateSyncData` menegakkan
  allowlist field atas `data`; satu penanda di sana (mis. `__deleted`) = client lama melempar =
  mandek. `validateIncomingRecord` hanya membaca `entity`/`recordId`/`version`/`data` — kunci
  top-level tambahan **diabaikan** tanpa cedera.
- **Baris feed `op:"delete"` tetap membawa `data` = snapshot terakhir yang SAH.** Client lama
  memvalidasinya, menerapkannya sebagai upsert biasa, dan record tetap hidup di sana — persis
  perilaku hari ini. Nol `feedHole`, nol kehilangan senyap, nol jam.

Matriks yang dinyatakan & diuji:

| Arah | Perilaku |
|---|---|
| hub baru → client lama | tombstone terbaca sebagai upsert snapshot terakhir → delete **tidak** menyeberang (status quo). Tak mandek. |
| hub lama → client baru | tak pernah ada `op` → semua dibaca `upsert` (default). Status quo. |
| client baru → hub lama | push `op:"delete"` + `data` snapshot → `zPush` non-strict membuang `op` → hub mengupsert snapshot = resurrect (status quo). Tak 500. |
| client lama → hub baru | push upsert biasa; bila id bertombstone → ditolak `conflict` (lihat di bawah). |
| `op` tak dikenal (hub lebih baru) | record **dilewati** tanpa melempar — forward-compat, kursor tetap maju. |

## Arsitektur

### Modul baru: `server/src/services/tombstone.ts`

Satu-satunya pemilik tabel `SyncTombstone`. Tak mengimpor apa pun selain `db` → bebas siklus, bisa
diuji langsung.

```
findTombstone(entity, recordId)            → row | null
writeTombstone(entity, recordId, version, data, deviceId?)   // upsert, idempoten
clearTombstone(entity, recordId)
listPendingDeletes()                        // tombstone yang masih punya entri outbox
```

### Modul baru: `server/src/services/sync-delete.ts` — **satu panggilan, bukan tiga**

`deleteSynced(entity, id, deviceId?) → boolean`. Ia membaca `version` + snapshot **sebelum**
menghapus (sesudahnya barisnya tak ada lagi), menghapus barisnya, menulis tombstone, lalu
menerbitkan sadar-peran. Memecahnya jadi "tulis tombstone" + "hapus" + "terbitkan" berarti tiap
call site baru harus mengingat ketiganya berikut urutannya — kelas bug SPEC-431/448/475/481, dan
persis pelajaran `releaseWorktree()` di ADR-0116.

```
deleteSynced(entity, id):
  snap = snapshot(entity, id)            // null → baris tak ada
  if (!snap) return false
  DELEGATE[entity].delete({ id })        // cascade DB merambat ke anak
  writeTombstone(entity, id, snap.version + 1, snap.data, deviceId)
  notifyDeleted(entity, id)              // sadar-peran
  return true
```

### `notifyDeleted()` — cermin persis `notifySynced()`

```ts
// sync-notify.ts
export async function notifyDeleted(entity, id) {
  try {
    if (!isEntity(entity)) return;
    if (effectiveStr("SYNC_SERVER_URL")) await enqueueOutbox(entity, id);  // client → push nanti
    else await publishDelete(entity, id);                                   // hub → feed + siar
  } catch { /* jangan blok write utama */ }
}
```

Outbox tak butuh kolom baru: entri `(entity, recordId)` yang **tak punya baris tapi punya
tombstone** sudah tak ambigu berarti "delete menunggu push".

### Sisi hub

**`publishDelete(entity, id)`** (`sync.ts`, cermin `publishLocal`): append `SyncLog`
`{ entity, recordId, version, op:"delete", data: tomb.data }` + panggil `onAccepted` → siar WS.

**`applyPush` — tiga perubahan, semuanya mempertahankan aturan lama:**

1. `existing` = baris **atau** tombstone. Aturan `baseVersion === existing.version` tak berubah;
   penolakan kebangkitan jatuh darinya. Konflik yang sebabnya tombstone membawa
   **`{ ok:false, conflict:true, deleted:true, server:null }`** — field `deleted` aditif, diabaikan
   client lama (yang lalu sekadar mengulang push tanpa efek, bukan mandek).
2. `op:"delete"` diterima **tanpa cek `baseVersion`** — inilah "delete menang tanpa syarat", dan
   inilah yang membuat hasilnya independen urutan tiba.
3. **Idempoten**: tombstone sudah ada → `{ ok:true, version: tomb.version }` tanpa baris feed baru.
   Tanpa ini push berulang menaikkan version tanpa ujung dan setiap client berputar menariknya.

**`backfillFeed()`** ikut memastikan tiap tombstone punya baris feed pada versinya. Menutup kasus
instance yang dulu berperan CLIENT (tombstone lahir tanpa feed) lalu dipromosikan jadi HUB.

**`pull()`** memancarkan `op` apa adanya. `PulledRecord` bertambah `op`.

### Sisi client

`validateIncomingRecord` menerima `op` opsional; nilai selain `upsert`/`delete` → record **dilewati**
(bukan melempar — melempar = `feedHole` = mandek).

`applyRemote(entity, id, version, data, op)`:

- **`op === "delete"`** → tulis tombstone lokal + `delete` baris (baris tak ada = **no-op sukses**,
  bukan error yang menahan kursor) + `clearOutbox` (delete menang atas edit lokal pending). Bila
  ada edit lokal pending yang berbeda, lahir satu `Notification` `type:"sync"` ber-`key`
  `sync-delete:<entity>:<id>` — edit yang tergilas tak boleh senyap.
- **`op === "upsert"` atas id bertombstone**:
  - `version <= tomb.version` → **dibuang secara sengaja** (dihitung `dropped`). Inilah yang membuat
    full-pull replay konvergen tanpa kebangkitan transien.
  - `version > tomb.version` → tombstone dibersihkan lalu upsert. Ini jalan pulang pembuatan ulang
    id yang sah — nyata untuk `customAgent` (`"<scope>:<name>"`) dan `githubIssue`
    (`"<projectId>:<slug>#<n>"`) yang id-nya **deterministik**, jadi hapus-lalu-buat-lagi memakai
    id yang sama persis.

**Pembuatan ulang arah sebaliknya (lokal → hub)** butuh satu lapis lagi: baris baru lahir di
`version = 0`, jadi push-nya membawa `baseVersion = 0` dan hub yang bertombstone di version 6
menolaknya selamanya. Lapisnya dipasang di **`notifySynced()`** — choke point yang sudah dipanggil
setiap tulisan lokal, jadi nol call site baru: bila `(entity, id)` punya tombstone lokal **dan**
barisnya ada lagi, seseorang jelas membuatnya ulang → tombstone dikonsumsi dan `version` baris
disetel ke `tomb.version`. Push berikutnya karena itu membawa `baseVersion = tomb.version`, dan hub
menerimanya sebagai version berikutnya sambil membersihkan tombstone-nya sendiri. Menaruh lapis ini
di tiap jalur `create` adalah pengulangan kelas bug SPEC-431/448/475/481.

**Anak yatim** (`syncOnce`, menggantikan `console.warn "induk absen?"`): peta `PARENTS` menyatakan
relasi FK antar entitas `SYNCED`; record yang induknya bertombstone **dibuang secara sengaja** dan
dihitung, bukan dilaporkan sebagai anomali.

```ts
const PARENTS = {
  spec:             [{ field: "projectId", entity: "project" }],
  ticket:           [{ field: "projectId", entity: "project" }],
  ticketAttachment: [{ field: "ticketId",  entity: "ticket"  }],
  customAgent:      [{ field: "projectId", entity: "project" }],
  githubIssue:      [{ field: "projectId", entity: "project" }],
};
```

`sessionResult` sengaja **tak** ada di sini: `projectId`-nya kolom polos **tanpa `@relation`**
(schema `:325-340`), jadi menghapus project memang tidak merambat ke sana — hari ini maupun nanti.
`ticketAttachment.projectId` juga bukan FK (denormal, `:718`). Peta ini kontrak, dan kontrak yang
disalin dari skema selalu basi diam-diam — sebuah test **DMMF** menegakkannya sama persis dengan
himpunan FK antar model `SYNCED` (preseden `PG_ORDER` & `WEBHOOK_ENTITIES`).

**Konvergensi replay** karena itu punya dua lapis yang saling menutup: tombstone lokal membuang
upsert basi, dan urutan `seq` yang monoton menempatkan baris delete sesudah upsert-nya. Salah satu
sendirian sudah konvergen; keduanya membuat tak ada kebangkitan **transien** sekalipun.

### Call site yang berubah (enam, semuanya user-facing)

| Route | Entitas |
|---|---|
| `DELETE /projects/:id` (`projects.ts:105`) | `project` — cascade ke spec/ticket/customAgent/githubIssue |
| `DELETE /specs/:id` (`specs.ts:309`) | `spec` — pembersihan `dependsOn` yang ada tetap jalan |
| `DELETE /vps/:id` (`vps.ts:67`) | `vps` |
| `DELETE /tickets/:id` (`tickets.ts:135`) | `ticket` — cascade ke `ticketAttachment` |
| `DELETE /custom-agents/:id` (`custom-agents.ts:195`) | `customAgent` — pencabutan `mentions` tetap jalan |
| `DELETE /session-results` (`session-results.ts:38`) | `sessionResult` — purge bulk, id dikumpulkan dulu |

**Sengaja tak berubah:** `services/retention.ts` (sweep retensi) dan `services/ticket.ts:58`
(`pruneOldTickets`). Keduanya hari ini **tidak** memanggil `notifySynced` sama sekali — mereka sudah
berada di luar permukaan sync. Aturannya karena itu bisa dinyatakan dalam satu kalimat: *yang
memanggil `notifySynced` saat menulis, memanggil `deleteSynced` saat menghapus.*

### Jalan pulang untuk data yang terlanjur bangkit

Tak butuh migration data maupun perintah khusus: **hapus ulang sekali di sisi mana pun sesudah
upgrade**. Penghapusan itu melahirkan tombstone, tombstone masuk feed/outbox, tiap instance
menghapus barisnya **dan menyimpan tombstone-nya sendiri** — sesudah itu id tersebut tak bisa
dibangkitkan oleh jalur mana pun: push ditolak (kebangkitan), replay membuangnya (upsert basi),
`backfillFeed` tak pernah punya baris untuk dipublish. Tombol **Tarik ulang** ADR-0082 tetap bekerja
apa adanya dan kini justru ikut menyebarkan tombstone.

### UI: penghapusan yang tertunda karena offline

`GET /api/sync/pending` → `{ deletes: [{ entity, recordId, deletedAt }], total }`, cookie-only —
karena itu ia **wajib ditambahkan ke daftar pengecualian bypass** di `app.ts:134` bersama
`/api/sync/now` dan `/api/sync/conflicts`; tanpa itu route tulis-baca UI ini justru meminta device
token.

`SyncButton` merender lencana **"N hapus menunggu"** saat `total > 0`, dan `SyncStats` bertambah
`deleted`/`dropped` sehingga toast berbunyi `Sinkron: ↓12 ↑3 ⨯2`. Penghapusan yang tak terlihat
efeknya adalah penghapusan yang dikira gagal, lalu diulang manusia.

## Rencana test

Semua run server dengan `--no-file-parallelism` + `TEST_DATABASE_URL` tersendiri.

**Sisi hub** (`sync-tombstone.service.test.ts`)
- `applyPush op:"delete"` menghapus baris, menulis tombstone, meng-append feed `op:"delete"`, memicu siar
- delete atas id yang tak ada = `ok:true` (no-op), delete berulang idempoten (nol baris feed kedua)
- `applyPush` upsert atas id bertombstone → `conflict` + `deleted:true` + `server:null`
- push ber-`baseVersion === tomb.version` **diterima** (pembuatan ulang yang sah), tombstone bersih
- `publishDelete` membawa `data` yang lolos `validateSyncData` (kontrak kompat client lama)
- `backfillFeed()` mempublish tombstone yang belum punya baris feed

**Sisi client** (`sync-tombstone.client.test.ts`)
- `syncOnce` menarik tombstone → baris hilang, tombstone lokal ada, outbox bersih, kursor maju
- tombstone tiba **sebelum** record-nya pernah ada → no-op sukses, kursor maju
- upsert basi atas id bertombstone dibuang; upsert ber-version lebih tinggi menghidupkan
- membuat ulang id bertombstone secara lokal → `notifySynced` mengonsumsi tombstone & menyetel
  `version = tomb.version`, sehingga push berikutnya diterima hub (bukan ditolak selamanya)
- full-pull (`{full:true}`, kursor 0) tak membangkitkan record bertombstone
- record anak untuk induk bertombstone dibuang **sengaja** (terhitung `dropped`, bukan `console.warn`)
- hapus lokal saat offline → tombstone + outbox; siklus berikutnya mem-push `op:"delete"`
- edit lokal pending vs tombstone masuk → delete menang, `Notification` lahir
- `op` tak dikenal → dilewati, `feedHole` **tidak** menyala

**Kompatibilitas** (`sync-tombstone.compat.test.ts`)
- record lama tanpa `op` tetap upsert
- `validateIncomingRecord` menerima `op` top-level tanpa menyentuh allowlist `data`

**Kontrak** — test DMMF `PARENTS` = himpunan FK antar model `SYNCED`

**Route** (`sync-delete.routes.test.ts`) — keenam DELETE menulis tombstone + menerbitkan;
`retention`/`pruneOldTickets` **tidak**

**Web** — lencana "N hapus menunggu" di `SyncButton`

**End-to-end dua instance** (kriteria selesai brief) — hub + client nyata di local:
hapus di client → hilang di hub → **tak kembali** sesudah restart hub + `{full:true}`;
hapus di hub → hilang di client → **tak dibangkitkan** oleh push client.

## Yang di luar cakupan

- Pemangkasan/retensi baris `SyncTombstone` (feed `SyncLog` pun belum dipangkas — ADR-0045).
- Penghapusan lewat tulis DB langsung (dinyatakan di luar cakupan oleh brief).
- Menghapus lampiran biner dari disk instance penerima saat tombstone tiba (baris DB-nya ikut
  cascade; byte cache lokal tetap tanpa GC — batasan ADR-0068 yang **masih** berlaku).
- Menghidupkan kembali record dari tombstone lewat UI (undo). `data` tersimpan, tapi jalur
  pemulihannya bukan bagian spec ini.
