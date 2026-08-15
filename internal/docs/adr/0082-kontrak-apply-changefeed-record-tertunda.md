# ADR-0082 — Kontrak apply changefeed: record tertunda, kursor tak melompat, tarik ulang penuh

**Status:** accepted · **Tanggal:** 2026-07-29 · **Spec:** SPEC-382
**Terkait:** [ADR-0045](0045-skema-sync-synclog-version-stamp.md) (**memperluas** — change-feed + kursor),
[ADR-0046](0046-kanal-ws-sync-terpisah.md) (siar WS), [ADR-0068](0068-lampiran-tiket-masuk-record-sync.md)
(**memulihkan janjinya** — lampiran menyeberang), [ADR-0067](0067-sync-lww-reconciliation-manual.md)
(backfill feed, LWW), [ADR-0043](0043-sync-arsitektur-hub-client-server-to-server.md) (peran hub/client),
[ADR-0062](0062-help-center-tiket-publik-triase.md) (Help Center + `TicketAttachment`)

> **Sebagian dicabut oleh [ADR-0119](0119-tombstone-sync-penghapusan-menyeberang.md)** (SPEC-799):
> batasan "feed append-only tanpa tombstone (delete tak merambat)" tidak lagi berlaku, dan "yatim
> sejati dilewati diam-diam" kini punya cabang yang dinyatakan — anak dari induk **bertombstone**
> dibuang SENGAJA dan terhitung, sementara yatim yang benar-benar tak bisa dijelaskan tetap
> `console.warn`. Keputusan 1–5 (record tertunda, kursor tak melompat, tarik ulang penuh) justru
> **ditegakkan**: tombstone mengalir lewat kontrak apply yang sama persis.

## Konteks

ADR-0068 memutuskan lampiran tiket **harus** menyeberang hub → local: metadata lewat feed
(`SYNCED += "ticketAttachment"`), byte lazy-fetch. Di lapangan tak terjadi: tiket triase masuk ke
local **tanpa lampirannya** (SPEC-382, sumber qa).

Audit menemukan mesin sync punya lubang yang lebih dalam daripada satu urutan write:

1. **Feed memancarkan ANAK sebelum INDUK.** `POST /help/:slug/tickets` mem-publish setiap
   `ticketAttachment` lebih dulu, baru `ticket`. Client menerapkan record **urut seq**, sehingga
   `upsertLocal` menabrak FK `TicketAttachment.ticketId → Ticket.id`.
2. **Mesin sync tak punya kontrak untuk record yang belum bisa diterapkan.** Ia hanya mengenal
   "berhasil" dan "meledak":
   - **jalur WS** menelan kegagalan (`catch { /* frame rusak */ }`) lalu frame berikutnya menjalankan
     `setCursor(seq)` — kursor **melompati** baris yang gagal, dan baris itu hilang selamanya karena
     pull berikutnya mulai dari seq yang lebih tinggi;
   - **jalur pull** membiarkan exception merambat keluar `syncOnce`, jadi `setCursor` tak pernah
     tercapai dan client **mandek total** — bukan cuma lampiran, seluruh sync berhenti.

Feed berisi record **berelasi** (satu-satunya hari ini: `ticketAttachment` → `ticket`, FK nyata di
schema). Selama feed adalah aliran datar tanpa urutan kausal yang dijamin, "record tiba sebelum
induknya" adalah keadaan **normal**, bukan anomali — dan keduanya di atas menanganinya dengan salah.

## Keputusan

### 1. Record yang belum bisa diterapkan DITUNDA, bukan dibuang & bukan pula melempar

`syncOnce` menerapkan tiap record secara defensif. Yang gagal masuk daftar tunda dan dicoba ulang
setelah batch, **berulang selama masih ada kemajuan** (induk yang menyusul di batch yang sama membuka
anaknya; rantai berapa pun dalam). Satu putaran penuh tanpa kemajuan = berhenti.

### 2. Sisa yang tetap gagal DILEWATI dengan jejak, bukan menahan kursor

Record yang masih gagal setelah tak ada kemajuan adalah **yatim sejati** — induknya sudah dihapus di
hub, dan feed append-only tak punya tombstone (batasan ADR-0068 yang masih berlaku). Menahan kursor di
depannya berarti **livelock**: batch yang sama ditarik ulang tiap siklus selamanya. Karena itu kursor
tetap maju, dengan `console.warn` per record. Prinsipnya: **satu record bermasalah tak boleh
menghentikan siklus** — itulah kegagalan lama.

### 3. Jalur WS tak boleh memajukan kursor melewati frame yang gagal

`applyFeedFrame()` menjadi satu-satunya pintu apply frame WS. Frame yang gagal menyalakan penanda
`feedHole` dan mengembalikan `false`; selama penanda menyala, **frame mana pun** berhenti memajukan
kursor, dan client langsung menjadwalkan `tick()`. Pull berikutnya (mulai dari kursor yang tertahan)
menarik ulang rentang itu, menerapkannya lewat keputusan 1–2, lalu memadamkan penanda.

Ini bukan mekanisme kedua di samping pull — justru sebaliknya: WS tetap **percepatan**, dan pull tetap
kebenaran. Yang berubah: WS tak lagi boleh **merusak** kursor milik pull.

### 4. Feed memancarkan INDUK sebelum ANAK

`routes/help.ts` mem-publish `ticket` sebelum loop lampiran. Keputusan 1–3 membuat client tahan
banting terhadap urutan apa pun (termasuk hub lama yang belum di-update), tapi urutan yang benar di
**sumber** membuat jalan bahagia tak pernah menyentuh jalur tunda sama sekali.

### 5. Tarik ulang penuh untuk baris yang terlanjur dilompati

Baris yang sudah dilompati kursor ada di **belakang** kursor; tak ada siklus normal yang bisa mundur,
dan `backfillFeed()` (ADR-0067) tak menolong karena barisnya memang sudah ada di feed pada versinya.
`POST /api/sync/now` menerima `{ full: true }`: kursor kembali ke `0`, feed di-drain halaman demi
halaman sampai kursor berhenti bergerak (batas 200 halaman sebagai jaring pengaman). Aman diulang —
pull server-authoritative dan `upsertLocal` idempoten. UI: tombol "Tarik ulang" di samping "Sync".

### 6. Eskalasi memateralisasi byte lampiran

Di instance client, byte lampiran baru mendarat di disk saat seseorang **membukanya** di UI triase
(fetch-through ADR-0068). `acceptTicket` kini menarik byte tiap lampiran lebih dulu (best-effort) agar
path yang disebut direktif SPEC-286 benar-benar ada saat agen mem-`Read`-nya; lampiran yang gagal
ditarik ditandai `BELUM TERUNDUH` + rujukan API, bukan dipura-purakan ada. Penting karena auto-accept
scheduler source-checker triase (SPEC-297) berjalan **tanpa manusia** yang pernah membuka gambarnya.

## Konsekuensi

- **Lampiran triase benar-benar menyeberang** — janji ADR-0068 terwujud, dan agen backlog hasil
  eskalasi membaca screenshot pelapor dari path yang nyata.
- **Tak ada lagi mandek total** akibat satu record: kegagalan apply bersifat lokal pada recordnya.
- **Tak ada lagi kehilangan senyap** di jalur WS: kursor tak pernah melompati record yang gagal.
- **Data lama bisa dipulihkan** tanpa menyentuh DB manual (`{ full: true }`).
- Kontrak ini **entitas-agnostik**: relasi baru antar entitas SYNCED di masa depan otomatis tertangani,
  tanpa perlu tabel urutan atau graf dependensi.
- **Tanpa perubahan skema, tanpa migration.** `SYNCED`, `FIELDS`, dan bentuk wire `pull`/`push` utuh —
  hub lama ↔ client baru dan hub baru ↔ client lama tetap saling paham.
- Batasan yang **tetap** berlaku: feed append-only tanpa tombstone (delete tak merambat), arah lampiran
  hub → local saja, dan tak ada garbage-collection cache lampiran lokal.
- Harga: yatim sejati dilewati diam-diam bagi pengguna (hanya `console.warn` di log server). Diterima —
  alternatifnya livelock. Bila kelak butuh visibilitas, hitungannya bisa naik ke `SyncStats`.
