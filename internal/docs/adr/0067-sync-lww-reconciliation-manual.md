# ADR-0067 — Sync self-healing: backfill feed + rekonsil konflik manual (LWW-default)

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-270
**Terkait:** [ADR-0045](0045-skema-sync-synclog-version-stamp.md) (**diperluas** — version-stamp +
change-feed), [ADR-0043](0043-sync-arsitektur-hub-client-server-to-server.md) (peran hub/client),
[ADR-0046](0046-kanal-ws-sync-terpisah.md) (siar changefeed),
[ADR-0066](0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md) (errors/tickets tersync +
pemicu manual), [ADR-0008](0008-stage-mirrors-run.md) (stage forward-only)

## Konteks

Diagnosa nyata lokal-prod ↔ VPS (2026-07-21) menemukan dua cacat struktural pada mesin sync
version-stamp:

1. **Record `version=0` tak pernah masuk feed → tak bisa di-pull.** `pull()` hanya me-replay
   `SyncLog`. Row yang dibuat sebelum entitasnya masuk `SYNCED` (mis. 4 `ErrorGroup` + 1 `Ticket`
   di VPS, `version=0`, **nol baris `SyncLog`**) tak pernah menyeberang ke client walau cursor
   sudah fully catch-up. Tak ada langkah backfill. → gejala "errors/triase tak ke-sync".
2. **Version-stamp nyimpang → push ditolak konflik permanen.** Bila `baseVersion ≠ serverVersion`,
   `applyPush` menolak & record nyangkut di outbox; `syncOnce` melewati record yang punya edit
   lokal pending saat pull (anti-clobber) → record konflik tak pernah bisa di-rebase (**deadlock**).
   Diperparah `syncOnce` yang tak meng-update versi lokal ke versi balikan hub setelah push sukses.

Prasyarat LWW juga cacat: mayoritas model synced memakai `updatedAt @default(now())` (**bukan**
`@updatedAt`) → `updatedAt` tak naik saat edit; PATCH status errors/tickets tak menyetel `updatedAt`.

## Keputusan

### 1. `updatedAt` jadi jam LWW tepercaya (migration + perilaku klien)

- `updatedAt @default(now())` → `@updatedAt` untuk 6 model synced (`Project`, `Spec`, `Vps`,
  `SessionResult`, `ErrorGroup`, `Ticket`). Prisma auto-bump tiap `update()`; nilai eksplisit yang
  dikirim tetap dihormati (diverifikasi test). Migration melepas `DEFAULT` DB agar tak drift.
- `updatedAt` masuk `FIELDS` + `DATE_FIELDS` → **ikut menyeberang** (wire + snapshot + feed).
- Layer sync (`applyPush`/`upsertLocal`) **mempertahankan `updatedAt` asal** saat menerapkan record
  dari peer (bukan menstempel `new Date()`), sehingga jam origin menyeberang utuh sebagai basis LWW.

### 2. Backfill feed idempoten saat boot HUB

- `backfillFeed()`: untuk tiap entitas SYNCED, `publishLocal` tiap row yang belum terwakili di feed
  pada version terkininya (mencakup semua `version=0`). Idempoten (row yang sudah ber-`SyncLog`
  untuk version-nya dilewati). Dipanggil dari `applyConfigOnBoot()` **hanya bila peran HUB**
  (`SYNC_SERVER_URL` kosong). Menyembuhkan data pra-entitas-tersync & menutup gap serupa ke depan.

### 3. Divergensi dua-sisi → antrean konflik + rekonsil manusia (LWW-default)

- `syncOnce` mengklasifikasi divergensi: **sepihak** (satu sisi berubah / data sama) → auto-apply
  seperti biasa (server-authoritative pada pull); setelah push `ok`, versi lokal dinaikkan = versi
  hub (fix deadlock berikutnya). **Dua-sisi sejati** (lokal punya edit pending **dan** data beda
  dari snapshot hub) → **tidak** dibuang, **tidak** nyangkut: dicatat ke tabel baru **`SyncConflict`**
  (LOCAL-only, unique `(entity,recordId)`, idempoten).
- Endpoint cookie-only: `GET /api/sync/conflicts`, `POST /api/sync/conflicts/:entity/:recordId/resolve`
  `{choice:"local"|"server"}`. `local` → force-push data lokal ke hub (`baseVersion=serverVersion`);
  `server` → adopsi data hub secara lokal. Keduanya menandai `resolvedAt` + clear outbox.
- **Modal `ReconcileModal`** (dipicu `SyncButton` saat `conflicts>0`): tiap konflik side-by-side
  Lokal | Server; sisi ber-`updatedAt` terbaru **ter-highlight sebagai default** (LWW = saran, bukan
  keputusan otomatis). Keputusan **per-record**.

## Konsekuensi

- **Konvergensi deterministik tanpa kehilangan data diam-diam**: konflik menunggu manusia, bukan
  auto-overwrite. Deadlock outbox tuntas.
- **`stage` forward-only (ADR-0008) bisa diregres manual** lewat modal (resolusi per-record
  menimpa seluruh record). Diterima untuk v1 — manusia melihat kedua `stage` sebelum memilih.
- **Asumsi topologi: tepat satu hub (VPS)**, instance lain client. Desain menyembuhkan divergensi
  historis; menjalankan dua hub permanen tetap melanggar invariant version-stamp.
- **LWW bergantung wall-clock** mac vs VPS (asumsi NTP); risiko pemenang-default keliru
  **termitigasi** karena manusia bisa override di modal.

## Amandemen 2026-08-14 — keputusan manusia harus bertahan, dan `local` harus benar-benar menang

Tiga cacat membuat modal rekonsil praktis tak bisa dipakai; ditemukan saat 11 konflik lokal tak
bisa diputuskan sama sekali. Keputusannya di sini karena ketiganya mengubah **semantik** yang
dijanjikan di atas, bukan sekadar bug lokal.

- **`recordConflict` tak lagi membuka kembali konflik yang sudah diputuskan.** Payload `update`-nya
  dulu membawa `resolvedAt: null` tanpa syarat, jadi tick sync berikutnya (~15 detik) menghapus
  keputusan manusia sebelum operator sempat melihat efeknya — tombolnya tampak sekadar mati.
  Resolusi kini terikat pada **sepasang versi** `(localVersion, serverVersion)`: selama pasangan itu
  tak berubah, konflik tetap tuntas. Divergensi baru tetap membukanya lagi — itu konflik yang lain.
- **`resolve(local)` mencoba ulang sekali dengan versi hub terkini.** `baseVersion=serverVersion`
  adalah versi hub **saat konflik terdeteksi**; hub bergerak sendiri (monitor VPS menulis `health`
  tiap beberapa menit), jadi angka itu sering sudah basi begitu operator mengklik dan "force-push"
  yang dijanjikan ditolak selamanya. Tolakan hub sudah membawa snapshot terkininya — sekali coba
  ulang dengan versi itu. Hanya sekali: kalau hub bergeser lagi di sela itu, konfliknya memang hidup
  dan operator berhak melihatnya lagi.
- **Kegagalan resolusi tak lagi senyap.** Route membalas **HTTP 200** ber-`{ok:false, reason}`;
  `ReconcileModal` dulu membuang hasil itu, jadi setiap mode gagal terlihat identik dengan "tak
  terjadi apa-apa". Alasannya kini ditampilkan.

Tidak berubah: **telemetri VPS tetap menyeberang.** `health`/`lastSeenAt` ditulis monitor di kedua
sisi, jadi record VPS akan terus melahirkan konflik baru berulang kali. Diterima apa adanya atas
keputusan pemilik repo (2026-08-14); memindahkannya keluar dari `FIELDS` menuntut ADR tersendiri.
