# ADR-0100 — Webhook keluar: tap Prisma sebagai satu sumber peristiwa, amplop ber-versi, antrean SQLite

**Status:** Diterima · 2026-08-01 · SPEC-481
**Terkait:** memperluas ADR-0049 (config) & ADR-0097 (secret at-rest) · ADR-0024, ADR-0037,
ADR-0039, ADR-0065, ADR-0072, ADR-0079, ADR-0096 tetap utuh.

> **Amendment SPEC-761 / [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md):**
> resolve-then-fetch di bawah diganti transport address-pinned. Semua A/AAAA divalidasi, koneksi
> memakai address yang sama dengan Host/TLS SNI asli, dan seluruh 3xx gagal terminal. Signature,
> body, atau credential tidak pernah diteruskan ke hop/host redirect.

## Konteks

Sistem lain tak punya cara mengetahui apa yang terjadi di hanoman selain memanggil `/api` secara
berkala. Polling boros dan selalu terlambat, dan akibatnya terlihat di repo ini sendiri: gateway
Telegram (ADR-0096) adalah **satu subsistem penuh** yang lahir karena tak ada kanal peristiwa
keluar — integrasi terpaksa dibangun *di dalam* hanoman alih-alih berlangganan dari luar.

Kemampuan sejenis pernah ada dan dicabut: trigger webhook GitHub ikut hilang bersama ADR-0024.
Yang dicabut waktu itu adalah **webhook masuk** beserta message queue-nya. Yang dibangun sekarang
adalah kebalikannya — satu arah keluar, tanpa menghidupkan kembali apa pun yang ADR-0024 buang.

## Keputusan

### 1. Sumber peristiwa = tap di layer Prisma, bukan emit di call site

Satu client extension (`server/src/services/webhooks/tap.ts`) dipasang di `db.ts` — satu-satunya
tempat klien Prisma lahir — membungkus `create`/`update`/`upsert`/`delete`/`updateMany`/
`deleteMany` untuk model yang dienumerasi katalog.

Alasannya bukan keanggunan melainkan **rekam jejak**: hanoman sudah tiga kali membayar kelas bug
"satu definisi, N call site" — SPEC-431 (predikat `baseSha IS NULL` disalin dua pemakai), SPEC-448
(`rootBypassEnv` hidup hanya di `pty.ts`), SPEC-475 (`headSha` punya satu penulis padahal
`stage=done` dipersist tiga jalur). SPEC-475 mencatat bahwa yang paling licin adalah divergensi
pada **efek samping**, karena efek samping tak punya tipe yang bisa memaksanya konsisten seperti
`GovernorDeps.blockers`. "Pancarkan peristiwa" adalah efek samping murni. Di layer Prisma ia tak
bisa dilupakan oleh penulis mana pun — termasuk yang ditulis setahun dari sekarang.

Digerbangi flag in-memory (`webhooksActive()`): saat tak ada endpoint aktif — **default hanoman** —
tap langsung meneruskan panggilan, biayanya satu pembacaan boolean. Cache disegarkan tiap mutasi
endpoint, jadi perubahan berlaku tanpa restart.

### 2. Katalog `WEBHOOK_ENTITIES` menyetir tap DAN dokumentasi

`shared/src/webhook.ts` memegang katalog: model Prisma, **allowlist field**, peta aksi→jenis
peristiwa, peristiwa turunan, dan contoh payload. Tap membacanya untuk memutuskan apa yang
dipancarkan; halaman dokumentasi in-app membacanya untuk merender daftar jenis peristiwa, "kapan
terpicu", dan contoh payload. Menambah peristiwa = menambah satu entri, dan dokumentasi ikut
bergerak — brief mensyaratkan dokumentasi yang tak bisa basi, dan ini caranya secara struktural.

Allowlist field adalah **pagar data sensitif sekaligus kontrak payload**: yang tak disebut tak
pernah keluar. Test DMMF (`webhook-catalog-dmmf.test.ts`) menuntut setiap nama field benar-benar
ada di model Prisma-nya — cermin test `PG_ORDER`, karena pelanggarannya gagal senyap: payload jadi
kosong tanpa satu pun error.

### 3. Antrean = tabel SQLite + timer in-process, bukan message queue

`WebhookDelivery` merangkap **antrean dan riwayat**, dikuras `setInterval` yang di-start dari
`server.ts` — pola yang sama dengan governor scheduler (ADR-0072) dan outbox Telegram (ADR-0096).
**ADR-0024 tetap utuh**: tak ada Redis, BullMQ, atau worker terpisah yang dihidupkan kembali.

`payload` disimpan **per baris pengiriman**, bukan dirender ulang saat kirim. Dua alasan yang
sama-sama mengikat: retry wajib mengirim byte yang **persis sama** supaya `id` peristiwa stabil dan
idempotensi penerima berlaku, dan riwayat harus memperlihatkan apa yang **benar-benar dikirim**,
bukan keadaan hari ini.

### 4. Amplop ber-versi sejak awal, satu perubahan satu peristiwa

`specVersion: "hanoman.webhook/1"` di badan + `apiVersion` per endpoint, supaya penerima lama tak
patah saat versi 2 lahir. Nomor percobaan hidup di **header**, bukan badan — badan yang berubah
tiap percobaan akan mematahkan janji byte-identik di atas.

Peristiwa turunan **menggantikan**, tidak menambah: `spec.stage_changed` dikirim alih-alih
`spec.updated`. Diff dihitung atas allowlist di luar `version`/`updatedAt`, dan **diff kosong tak
melahirkan apa pun** — tanpa aturan itu overlay stage-live (`liveSpecs`, menulis tiap `GET /specs`)
dan bump `version` mesin sync akan jadi banjir peristiwa hampa.

### 5. Kontrak at-least-once dengan id stabil; baris tertinggal crash DIULANG

Baris `sending` yang tertinggal setelah crash dikembalikan ke `pending` saat boot. Ini **sengaja
berlawanan** dengan `TelegramOutbox` (ADR-0096), yang memilih `uncertain` dan tak pernah mengulang:
di sana kembarannya adalah pesan ganda ke manusia, di sini penerima memegang `id` yang stabil dan
dokumentasinya mewajibkan mereka idempoten. Retry berbackoff tabel eksplisit (6 percobaan, 0 · 30
dtk · 2 mnt · 10 mnt · 30 mnt · 2 jam), `410 Gone` menonaktifkan seketika, dan 5 kegagalan beruntun
menonaktifkan endpoint otomatis dengan satu notifikasi.

### 6. Pengelolaan COOKIE_ONLY, secret terenkripsi, SSRF dua lapis

`/api/webhooks*` dipetakan `COOKIE_ONLY` (preseden `/telegram/{settings,test,credentials}`,
ADR-0097): permukaan ini memegang secret penandatanganan **dan** menentukan ke mana data workspace
mengalir keluar — tak ada capability yang cukup untuk itu. Secret 32 byte acak disimpan terenkripsi
lewat `services/secret-box.ts`, ditampilkan **sekali** saat dibuat/dirotasi (pola AgentToken), dan
`GET` hanya mengembalikan empat karakter terakhir.

SSRF awalnya dijaga dua lapis dengan pertanyaan berbeda: `checkUrlShape` saat **simpan** (skema http/https,
tanpa kredensial, tolak IP literal internal & `localhost`) dan `checkDestination` saat **setiap
percobaan kirim** (resolve DNS, tolak semua alamat privat/loopback/link-local/ULA/multicast).
Lapis simpan sengaja **tidak** menyentuh DNS: menaruh resolusi jaringan di jalur tulis CRUD membuat
pendaftaran endpoint gagal saat DNS lambat atau mati, dan gagal-tertutup di sana berarti operator
tak bisa mendaftarkan apa pun secara offline. Gerbang yang sebenarnya adalah lapis kedua. ADR-0117
mempertahankan dua lapis ini tetapi mengganti jalur kirim dengan address pinning dan no-redirect.

## Konsekuensi

**Yang didapat.** Setiap penulis baris — hari ini maupun yang belum ditulis — otomatis memancarkan
peristiwa, dengan `before`/`after` gratis dan tanpa satu pun perubahan di call site. Sesi terminal
ikut terliput cuma-cuma karena `SessionHistory` sudah ditulis di dua titik cekik `pty.ts`
(ADR-0079). Dokumentasi in-app tak bisa basi.

**Yang dibayar, semuanya sadar:**

- **Cascade delete tingkat-DB tak terlihat.** `onDelete: Cascade` dieksekusi SQLite, di luar
  jangkauan Prisma. Menghapus project memancarkan `project.deleted` saja; jumlah anak yang ikut
  terhapus dilaporkan di `data.cascade`, dan keterbatasan ini ditulis apa adanya di halaman docs.
- **`$executeRaw` dan `createMany` lolos.** Keduanya tak dipakai untuk model terlacak hari ini;
  `webhook-no-raw-writes.test.ts` yang menjaga itu tetap benar, karena pelanggarannya gagal senyap.
- **Satu pre-read per tulisan** untuk `update`/`upsert`/`delete` model terlacak — **hanya** saat ada
  endpoint aktif. Dengan nol endpoint biayanya satu boolean.
- **Pernyataan historis:** jendela DNS rebinding masih ada pada implementasi ADR asli; ADR-0117
  menutupnya dengan address pinning dan test regresi mixed A/AAAA serta redirect.
- **Notifikasi bertipe `webhook` tak difan-out.** Nonaktif otomatis melahirkan notifikasi, dan
  meneruskannya berarti kegagalan satu endpoint mengirim lalu lintas ke endpoint lain. Rantainya
  berhenti sendiri (endpoint nonaktif dilewati), tapi kebisingannya tak berguna.
- **Klien Prisma yang diekspor kini ber-extension** sehingga tak lagi assignable ke `PrismaClient`
  polos maupun `Prisma.TransactionClient`. `db.ts` mengekspor alias `Db`/`DbTx` yang **diturunkan
  dari nilai nyatanya**, jadi menambah atau mencabut extension kelak tak menuntut menyunting tanda
  tangan mana pun.

## Alternatif yang ditolak

- **Emit eksplisit di call site.** Menghidupkan kembali kelas bug SPEC-431/448/475 pada efek samping
  yang tak punya tipe pemaksa. Ditolak meski lebih mudah dibaca.
- **Polling diff periodik.** Butuh tabel snapshot sendiri — sebuah changefeed kedua — dan kehilangan
  perubahan yang terjadi lalu dibatalkan dalam satu interval.
- **Menumpang `SyncLog`.** Ia sudah berbentuk changefeed ber-snapshot, tapi **role-dependent**:
  peran client memakai `enqueueOutbox` dan tak menulis changefeed sama sekali, jadi `before`/`after`
  hilang justru di separuh topologi. Ia juga hanya meliput entitas yang disync — bukan
  `SessionHistory`, `LeadDecision`, maupun `Notification`.
- **Menghidupkan message queue.** ADR-0024 mencabutnya dengan alasan yang belum berubah.
