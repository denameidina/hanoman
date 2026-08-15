# ADR-0068 — Lampiran tiket masuk record-sync (metadata di feed, byte lazy-fetch)

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-272
**Terkait:** [ADR-0066](0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md) (**mencabut sebagian** —
"lampiran biner tak disync"), [ADR-0045](0045-skema-sync-synclog-version-stamp.md) (version-stamp +
change-feed), [ADR-0043](0043-sync-arsitektur-hub-client-server-to-server.md) (peran hub/client),
[ADR-0067](0067-sync-lww-reconciliation-manual.md) (`updatedAt` jam LWW, backfill feed),
[ADR-0062](0062-help-center-tiket-publik-triase.md) (Help Center + `TicketAttachment`)

> **Sebagian dicabut oleh [ADR-0119](0119-tombstone-sync-penghapusan-menyeberang.md)** (SPEC-799):
> konsekuensi "propagasi delete/tombstone di luar scope" tidak lagi berlaku — penghapusan kini
> menyeberang dua arah untuk seluruh entitas SYNCED. Sisa keputusan ADR ini (metadata di feed, byte
> lazy-fetch, tanpa GC cache lampiran lokal) tetap utuh.

## Konteks

Tiket Help Center dilaporkan di **hub (VPS)** beserta lampiran gambar. Saat instance **local**
melakukan sync (pull), **metadata tiket** menyeberang tetapi **lampirannya tidak** — baik row
`TicketAttachment` maupun berkas binernya. Di UI triase local tiket muncul tanpa gambar, konteks
visual pelapor hilang.

Ini konsekuensi desain ADR-0066: `TicketAttachment` sengaja **dikecualikan** dari mesin sync
(byte biner tak layak dititip di `SyncLog` JSONB). Mesin sync hanya mengangkut data JSON record via
`SyncLog`; tak ada jalur untuk blob. Permintaan konkret: lampiran **harus terlihat di local**, arah
**hub → local**.

## Keputusan

Pisahkan **metadata** (masuk feed seperti record lain) dari **byte** (ditarik on-demand), sehingga
semangat ADR-0066 (biner tak masuk feed) tetap terjaga.

### 1. `ticketAttachment` jadi entitas SYNCED (metadata)

- `TicketAttachment` mendapat kolom `version Int @default(0)` + `updatedAt DateTime @updatedAt`
  (diwajibkan mesin: `snapshot`/`applyPush`/`upsertLocal`). Migration **additive** (aman VPS live).
  Lampiran immutable → LWW praktis tak relevan; kolom murni untuk kompatibilitas engine.
- `SYNCED += "ticketAttachment"`; `FIELDS` = `ticketId, projectId, filename, mimeType, size,
  storageKey, createdAt, updatedAt` — **metadata saja**. `storageKey` menyeberang sebagai **pointer
  opaque** (`uuid+ext`), bukan isi file.
- Publish ke feed: lampiran baru → `notifySynced("ticketAttachment", id)` (asal-hub `publishLocal`).
  Lampiran lama → `backfillFeed()` (ADR-0067) sudah mengiterasi seluruh `SYNCED` saat boot hub.

### 2. Byte biner: lazy fetch-through + cache

- Hub mengekspos `GET /api/sync/attachments/:storageKey` — **device-token** (server-to-server, bukan
  cookie; di bawah prefix `/api/sync` yang di-bypass gate cookie). Divalidasi `storageKey` milik satu
  `TicketAttachment` (cegah baca file arbitrer di upload dir), lalu stream `readUpload` + `Content-Type` mime.
- Client menyajikan lampiran via `readUploadOrFetch(storageKey)`: baca lokal; bila absen **dan**
  instance ini CLIENT sync (`SYNC_SERVER_URL`+`SYNC_DEVICE_TOKEN`), tarik byte dari endpoint hub
  (Bearer), tulis ke upload dir (**cache**), kembalikan. Pembukaan berikutnya baca dari disk lokal.
- Route serve `GET /tickets/:id/attachments/:attId` beralih ke `readUploadOrFetch`. Di **hub**
  (`SYNC_SERVER_URL` kosong) tak ada fetch → perilaku sama seperti `readUpload`.

## Konsekuensi

- **Lampiran terlihat di local** tanpa membengkakkan feed: byte hanya mengalir saat benar-benar
  dibuka, lalu ter-cache. Feed `SyncLog` tetap ramping (metadata JSON).
- **Mencabut** klaim ADR-0066 "lampiran biner tak disync" → kini metadata disync; byte tetap tak
  masuk feed (nuansa berbeda, tak kontradiktif).
- **Arah hub → local saja.** Dua-arah (local→hub upload balik), propagasi delete/tombstone (mesin
  sync upsert-only — batasan eksisting), dan garbage-collection cache lampiran lokal **di luar scope**.
- **Ketergantungan konektivitas:** membuka lampiran di client saat hub tak terjangkau → 404 (byte
  belum ter-cache). Diterima; retry saat hub kembali online.
- **Keamanan:** endpoint biner memvalidasi kepemilikan `storageKey` + device-token; kunci opaque
  lampiran tak pernah diekspos ke publik.
