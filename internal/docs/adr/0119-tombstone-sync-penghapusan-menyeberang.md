# ADR-0119 — Tombstone sync: hard-delete + `SyncTombstone`, `SyncLog.op`, delete menang tanpa syarat

**Status:** accepted · **Tanggal:** 2026-08-15 · **Spec:** SPEC-799
**Terkait:** [ADR-0045](0045-skema-sync-synclog-version-stamp.md) (**diperluas** — version-stamp kini
juga menstempel keadaan "dihapus"), [ADR-0068](0068-lampiran-tiket-masuk-record-sync.md)
(**sebagian dicabut** — "propagasi delete/tombstone di luar scope"),
[ADR-0082](0082-kontrak-apply-changefeed-record-tertunda.md) (**sebagian dicabut** — "feed
append-only tanpa tombstone"; kontrak apply-nya justru **ditegakkan**),
[ADR-0067](0067-sync-lww-reconciliation-manual.md) (backfill feed, LWW, antrean konflik),
[ADR-0043](0043-sync-arsitektur-hub-client-server-to-server.md) (peran hub/client),
[ADR-0046](0046-kanal-ws-sync-terpisah.md) (siar changefeed),
[ADR-0064](0064-project-id-renameable.md) (rename project via `renamedFrom`),
[ADR-0100](0100-webhook-keluar-peristiwa.md) (tap Prisma — tak berubah)

## Konteks

Mesin sync record hanya mengenal UPSERT. Tak ada satu pun bentuk record "dihapus":
`routes/projects.ts:105` memanggil `prisma.project.delete()` lalu langsung `204` — tanpa
`notifySynced`, tanpa `enqueueOutbox`. Komentar `sync-client.ts:121` sudah mengakuinya apa adanya:
*"feed append-only tanpa tombstone (ADR-0068)"*.

Akibatnya penghapusan tak pernah menyeberang, dan sisi lain menghidupkannya kembali lewat **dua
jalur yang berbeda arah**:

1. **Hapus di CLIENT** → baris masih hidup di hub, dan kembali begitu ada `SyncLog` baru menyentuh
   record itu: siapa pun mengedit di hub/mesin lain, `backfillFeed()` saat hub boot (`sync.ts:256`),
   atau tombol **Tarik ulang** yang me-reset kursor ke 0 dan memutar ulang seluruh feed
   (`sync-client.ts:203-220`). `upsertLocal()` adalah upsert, jadi cabang create menyisipkannya utuh.
2. **Hapus di HUB** → baris masih hidup di client. Begitu client itu mengedit record tersebut (atau
   punya entri outbox tersisa) ia push, dan `applyPush` memperlakukan id yang absen sebagai **INSERT
   BARU yang selalu diterima** (`sync.ts:201-213`, `newVersion = 1`) — tanpa satu pun konflik tercatat.

Efek samping yang menyertai: anak dari record yang dihapus (spec/ticket/ticketAttachment milik
project itu) tetap datang di feed, gagal FK, lalu **dilewati dengan sekadar `console.warn`**
(`sync-client.ts:114-129`) — hilang senyap sampai induknya muncul lagi.

Gejala yang dilaporkan pengguna: *"project yang sudah dihapus kembali lagi setiap sync dengan hub."*

Ini bukan tambal di satu route. Seluruh delapan entitas `SYNCED` (`sync.ts:16`) berpenyakit sama,
dan perbaikannya menyentuh **kedua peran** karena satu binary yang sama memainkan keduanya.

## Keputusan

### 1. Hard-delete + tabel `SyncTombstone`, BUKAN soft-delete `deletedAt` per entitas

Baris tetap benar-benar dihapus; keadaan "dihapus" hidup di tabel baru
`SyncTombstone(entity, recordId, version, data, deletedAt, deviceId)` ber-`@@unique([entity, recordId])`.

Bentuk alternatifnya — kolom `deletedAt` yang ikut `FIELDS` per entitas — ditolak, dan biayanya
dinyatakan di sini supaya tak ditemukan di tengah jalan:

- ia menyentuh **setiap query baca yang sudah ada** untuk delapan entitas (`findMany`/`findUnique`/
  `count`/`aggregate`). Satu penyaring yang terlewat membuat record "terhapus" muncul lagi — yaitu
  **bug yang sedang kita perbaiki** — dan ia gagal SENYAP;
- `onDelete: Cascade` tingkat-DB tak lagi berlaku: perambatan ke anak harus ditulis tangan;
- `@@unique([projectId, number])` pada `Ticket` (dan id deterministik `customAgent`/`githubIssue`)
  menolak pembuatan ulang selama baris lamanya masih ada;
- tap Prisma ADR-0100 membaca penghapusan sebagai `update`, jadi katalog peristiwanya ikut bohong.

Bentuk yang dipilih membayar **nol** dari itu semua: nol query baca berubah, cascade tetap bekerja
di kedua sisi, dan `project.deleted` tetap terpancar sebagaimana adanya.

### 2. Tombstone ADALAH versi record itu sendiri, berkeadaan "dihapus"

`applyPush` sudah menerima tulisan bila `baseVersion === existing.version`. Dengan menjadikan
tombstone sebagai sumber `existing.version` ketika barisnya tak ada, **penolakan kebangkitan jatuh
dari aturan yang sudah ada** — tanpa cabang khusus, tanpa kosakata baru:

```
currentVersion = baris?.version ?? tombstone?.version ?? null
```

Sebuah id yang mati di version 6 karena itu hanya bisa dihidupkan oleh tulisan yang **tahu** tentang
version 6. Konflik yang sebabnya tombstone membawa `{ deleted: true, deletedVersion, server: null }`
— dua field aditif yang diabaikan client versi lama.

`writeTombstone` **monoton**: keadaan yang lebih tua tak boleh menimpa yang lebih baru walau tiba
belakangan. Replay full-pull memutar ulang feed dari awal, jadi kedatangan tak berurutan adalah
keadaan normal, bukan anomali.

### 3. `op` hidup di TOP-LEVEL `SyncLog`, dan baris tombstone tetap membawa `data` yang sah

Kompatibilitas versi campur adalah kendala **mengikat**, bukan nice-to-have: `validateIncomingRecord`
(`sync-client.ts:18`) melempar untuk bentuk tak dikenal, dan lemparan itu menyalakan `feedHole` yang
**menahan kursor** — client versi lama karena itu bisa **mandek total**, bukan sekadar melewatkan
tombstone. Konsekuensinya dua-duanya mengikat:

- **`op` tak pernah di dalam `data`.** `validateSyncData` menegakkan allowlist field atas `data`;
  satu penanda di sana (mis. `__deleted`) = client lama melempar = mandek. `validateIncomingRecord`
  hanya membaca `entity`/`recordId`/`version`/`data`, jadi kunci top-level tambahan **diabaikan**.
- **Baris feed `op:"delete"` membawa `data` = snapshot terakhir yang SAH.** Client lama
  memvalidasinya, menerapkannya sebagai upsert biasa, dan record tetap hidup di sana — persis
  perilaku hari ini. Nol `feedHole`, nol kehilangan senyap, nol jam.

Matriks yang berlaku:

| Arah | Perilaku |
|---|---|
| hub baru → client lama | tombstone terbaca sebagai upsert snapshot terakhir → delete **tidak** menyeberang (status quo). Tak mandek. |
| hub lama → client baru | tak pernah ada `op` → semua dibaca `upsert` (default kolom). Status quo. |
| client baru → hub lama | push `op:"delete"` + `data` snapshot → `zPush` non-strict membuang `op` → hub mengupsert snapshot = resurrect (status quo). Tak 500. |
| client lama → hub baru | push upsert biasa; id bertombstone ditolak `conflict` + `deleted`. |
| `op` tak dikenal (hub lebih baru) | record **dilewati** tanpa melempar — kursor tetap maju. |

### 4. Delete menang TANPA SYARAT

`op:"delete"` diterima hub tanpa melihat `baseVersion` sama sekali, dan tombstone yang tiba di client
menghapus baris lokal **meski ada edit lokal pending** (outbox dibersihkan). Itulah yang membuat
hasil hapus-vs-edit **independen urutan tiba** — syarat yang diminta brief secara eksplisit.

Alternatifnya — mencatatnya sebagai `SyncConflict` — ditolak: seluruh kelas bug ini adalah "yang
dihapus kembali lagi", dan antrean konflik mengembalikannya sebagai *"masih ada sampai manusia
mengklik"*. Amandemen ADR-0067 sudah mencatat modal rekonsil ramai oleh konflik telemetri VPS yang
lahir berulang kali; sebuah penghapusan bisa terkubur di dalamnya.

Harganya dinyatakan: **edit bersamaan hilang.** Mitigasinya bukan kesunyian — satu `Notification`
`type:"sync"` ber-`key` `sync-delete:<entity>:<recordId>:<version>` lahir setiap kali sebuah edit
pending tergilas, dan snapshot terakhirnya tetap ada di `SyncLog` **dan** `SyncTombstone.data`.

### 5. Anak yatim dibuang SENGAJA, bukan ditebak

Penghapusan induk merambat ke anak di penerima lewat `onDelete: Cascade` yang **sudah ada** — karena
itu tombstone hanya lahir untuk record yang benar-benar dihapus, tak pernah satu per anak.

Record anak yang datang bagi induk bertombstone dibuang **secara sengaja** dan terhitung `dropped`,
menggantikan `console.warn("induk absen?")` yang selama ini tak bisa dibedakan dari kegagalan
sungguhan. Relasinya dinyatakan di peta `PARENTS` (`sync.ts`). `sessionResult` sengaja **absen**:
`projectId`-nya kolom polos tanpa `@relation`, jadi menghapus project memang tak merambat ke sana;
`ticketAttachment.projectId` juga bukan FK (denormal) — yang FK hanya `ticketId`.

### 6. Retensi otomatis TIDAK menerbitkan tombstone

`services/retention.ts` (sweep) dan `services/ticket.ts:pruneOldTickets` hari ini **tidak** memanggil
`notifySynced` sama sekali — keduanya sudah berada di luar permukaan sync. Aturannya karena itu bisa
dinyatakan dalam satu kalimat: *yang memanggil `notifySynced` saat menulis, memanggil `deleteSynced`
saat menghapus.* Pemangkasan adalah kebijakan penyimpanan **per-instance**; menerbitkannya berarti
retensi di laptop developer menghapus tiket di hub produksi. Aman: prune lokal tak pernah
membangkitkan apa pun, karena client hanya mem-push bila ada entri outbox.

### 7. Jalan pulang bagi data yang terlanjur bangkit

Tak butuh migrasi data maupun perintah khusus: **hapus ulang sekali di sisi mana pun sesudah
upgrade**. Penghapusan itu melahirkan tombstone, tombstone masuk feed/outbox, tiap instance
menghapus barisnya **dan menyimpan tombstone-nya sendiri** — sesudah itu id tersebut tak bisa
dibangkitkan oleh jalur mana pun: push ditolak, replay membuangnya, `backfillFeed` tak punya baris
untuk dipublish. Tombol **Tarik ulang** ADR-0082 tetap bekerja apa adanya dan kini justru ikut
menyebarkan tombstone.

## Bentuk konkret

- Skema (migration additive): model `SyncTombstone`; kolom `SyncLog.op String @default("upsert")`.
- `services/tombstone.ts` — satu-satunya pemilik tabelnya, nol dependency selain `db`.
- `services/sync-delete.ts` — **`deleteSynced()`: SATU panggilan** (baca versi + snapshot → hapus →
  tulis tombstone → terbitkan sadar-peran) dan `listPendingDeletes()`.
- `sync-notify.ts` — `notifyDeleted()` cermin persis `notifySynced()`.
- `sync.ts` — `publishDelete()`, `deleteRow()`, `consumeTombstoneOnRecreate()`, `PARENTS`, `applyPush`
  sadar-tombstone, `pull`/siar membawa `op`, `backfillFeed` mencakup tombstone.
- `sync-client.ts` — `applyRemote(..., op)` mengembalikan `"applied" | "dropped"`, push `op:"delete"`
  dari outbox, `SyncStats` += `deleted`/`dropped`.
- Enam route DELETE beralih ke `deleteSynced`: `/projects/:id`, `/specs/:id`, `/vps/:id`,
  `/tickets/:id`, `/custom-agents/:id`, `/session-results` (purge).
- `GET /api/sync/pending` (cookie-only) + lencana **"N hapus menunggu"** di `SyncButton`.

## Enam gotcha wajib

1. **`op` tak boleh masuk `data`.** Allowlist `validateSyncData` menolaknya di client versi lama →
   `feedHole` → kursornya tertahan selamanya. Mandek total, bukan sekadar melewatkan tombstone.
2. **Baris feed `op:"delete"` wajib membawa snapshot yang sah.** Objek kosong membuat hub versi lama
   menjalankan create tanpa kolom required (P2011 → 500 di tiap siklus push) dan client versi lama
   menerapkan baris kosong. Karena itu `SyncTombstone.data` bukan kenyamanan — ia prasyarat.
3. **`SyncTombstone` wajib masuk `PG_ORDER`** (`cli/src/commands/migrate-pg.ts`).
   `cli/test/migrate-pg.test.ts` menuntutnya sama persis dengan DMMF dan itu **satu-satunya**
   gerbangnya (cermin ADR-0105).
4. **`writeTombstone` wajib monoton.** Keadaan lebih tua yang tiba belakangan — dan replay full-pull
   memang memutar ulang feed dari awal — tak boleh menurunkan versi.
5. **Konsumsi tombstone saat pembuatan ulang duduk di `notifySynced`**, bukan di tiap jalur `create`
   (kelas bug SPEC-431/448/475/481), **dan wajib mengangkat `version` baris ke versi tombstone**:
   baris baru lahir di `version = 0`, jadi tanpa itu push-nya membawa `baseVersion = 0` melawan
   tombstone hub di versi jauh lebih tinggi dan pembuatan ulang yang sah ditolak SELAMANYA.
6. **`op` tak dikenal dilewati, tak pernah melempar.** Melempar berarti hub yang lebih baru bisa
   mematikan client lama hanya dengan memperkenalkan satu jenis peristiwa.

Tambahan yang mengikat: **rename bukan hapus.** Pintu rename (`renamedFrom`, ADR-0064) memang
MELEWATI optimistic-concurrency biasa, jadi ia mendapat gerbang tombstone sendiri — rename ke id
yang bertombstone ditolak, dan project asalnya dibiarkan utuh.

## Konsekuensi

- **Penghapusan menyeberang dua arah** untuk seluruh entitas `SYNCED`, dan record yang sudah
  bertombstone tak bisa dibangkitkan oleh jalur mana pun: push, replay, maupun backfill.
- **Batasan ADR-0068 & ADR-0082 "delete tak merambat" dicabut**; kontrak apply ADR-0082 (record
  tertunda, kursor tak melompat, tarik ulang penuh) justru **ditegakkan** — tombstone mengalir lewat
  kontrak yang sama persis, tanpa mekanisme kedua.
- **Yatim sejati tak lagi ambigu**: yang induknya bertombstone dibuang sengaja & terhitung; sisanya
  tetap `console.warn` karena ia memang tak bisa dijelaskan.
- Edit bersamaan yang tergilas delete **hilang** — dinyatakan, dinotifikasi, dan snapshot terakhirnya
  tetap tersimpan.
- **Belum ada pemangkasan `SyncTombstone`** (feed `SyncLog` pun belum — ADR-0045). Tabelnya tumbuh
  seiring jumlah penghapusan, bukan seiring waktu.
- Penghapusan lewat tulis DB langsung tetap **di luar cakupan**: ia memang melewati notifikasi & sync.
- Byte lampiran di cache lokal penerima tetap tanpa garbage collection (batasan ADR-0068 yang
  **masih** berlaku); baris DB-nya ikut cascade.
