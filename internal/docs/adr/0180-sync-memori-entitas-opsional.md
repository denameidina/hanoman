# 0180 — Memori project menyeberang lewat record-sync sebagai entitas OPSIONAL

> **Digantikan untuk fitur memori project/changelog oleh [ADR-0182](0182-hapus-memori-project-dan-changelog.md).**
> Dokumen ini mempertahankan keputusan historis; fitur dan data terkait telah dihapus.
> Kontrak generik sync opsional dan `Spec.doneAt` tetap berlaku.

Tanggal: 2026-10-07 · Status: diterima · Melanjutkan [ADR-0178](0178-memori-project-bersama.md), [ADR-0179](0179-suntik-memori-sesi.md) · Plan: [tahap 3](../../../docs/superpowers/plans/2026-10-07-shared-project-memory-stage3.md)

## Konteks

Memori project harus bersama lintas mesin dan tim. Peta record-sync (2026-10-07) menemukan tiga hal:

- **B1 — client lama macet pada entitas tak dikenal.** `validateIncomingRecord` melempar, `syncOnce`
  tak menangkapnya, kursor tak pernah maju; jalur WS menyalakan `feedHole` selamanya. Tak ada
  negosiasi versi/entitas antara client dan hub.
- **B2 —** `MemoryEvent` tak punya `version`/`updatedAt`, padahal seluruh mesin sync memakainya.
- **B3 — bug tahap 1:** store memori menaikkan `version` lokal, melanggar konvensi (hanya hub yang
  menaikkan; client menyalin versi hub). Di bawah sync, setiap suntingan client akan jadi konflik.

## Keputusan

1. **Entitas opsional.** `projectMemory` dan `memoryEvent` masuk `SYNCED` sekaligus `OPTIONAL_ENTITIES`.
   Hub hanya mengirimnya ke client yang menyebutnya lewat query `entities=` di `/sync/pull`,
   `/sync/bootstrap`, dan `/sync/ws`. Kursor pull = seq baris terakhir yang **dikonsumsi** (dikirim
   ATAU disaring), jadi client lama melompati baris memori tanpa pernah melihatnya — kursornya maju
   sampai ujung feed (diverifikasi dua instance).
2. **Iklan hub.** Balasan pull/bootstrap membawa `entities: [...]`. Client menunda push entitas opsional
   (tetap di outbox, tanpa error) selama hub tak mengiklankannya — kombinasi client-baru/hub-lama aman.
   Urutan rilis hub-duluan (ADR-0135) tetap disarankan.
3. **Catch-up sekali.** Mesin yang naik versi sesudah hub menyimpan memori sudah melewati barisnya. Ia
   menarik KEADAAN entitas opsional yang belum pernah ia ambil lewat `/sync/bootstrap?only=…` tanpa
   memindahkan kursor feed; penanda LOCAL-only `SyncState.entities` mencegah pengulangan. Bootstrap dari
   nol atau kursor 0 langsung menandainya.
4. **Toleransi ke depan.** Entitas tak dikenal kini `UnknownEntityError`; pull, bootstrap, dan WS
   melewatinya (WS memajukan kursor). Tak menolong client yang sudah terpasang — itulah alasan butir 1.
5. **Merge tanpa manusia.** `projectMemory`: field selain `status`/`updatedAt` immutable (ADR-0178 §2);
   bila hanya status yang berbeda, hub (`applyPush`) dan client (cabang outbox pending) menggabung
   dengan lattice `proposed < active < invalidated = rejected` — tanpa `SyncConflict`. Field immutable
   berbeda → konflik biasa. `memoryEvent` append-only → push ulang idempoten.
6. **Store mengikuti konvensi.** Tak ada lagi bump `version` lokal; setiap transaksi mengumumkan baris
   yang disentuhnya lewat `notifySynced` SESUDAH commit, memori sebelum event (urutan FK di outbox).
   `sourceDeviceId` = `LOCAL_DEVICE_ID`.
7. **Hapus permanen** `DELETE /api/memories/:id` — cookie-only (COOKIE_ONLY bagi agent token), lewat
   `deleteSynced`: tombstone menang tanpa syarat di semua mesin, event ikut cascade dan dibuang penerima
   lewat `parentTombstoned`.
8. **Skema:** `MemoryEvent.version` + `updatedAt` (baris lama diisi `createdAt` — SQL redefine Prisma
   disunting), `SyncState.entities` (LOCAL-only).

## Konsekuensi

- Dua mesin yang meng-supersede memori yang sama secara bersamaan menghasilkan dua pengganti aktif —
  tak ada yang hilang; UI review (tahap 4) perlu menampilkannya.
- `sourceTokenId` adalah id token di mesin asal; tak bermakna di mesin lain (audit saja).
- `MemoryLocalState` tetap per mesin: memori dari mesin lain baru tersuntik setelah diverifikasi terhadap
  worktree lokal.
- Mekanisme entitas opsional berlaku umum: entitas baru di masa depan sebaiknya lahir opsional.
