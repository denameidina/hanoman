# ADR-0204 — Requeue baris gagal, tandai notifikasi terbaca per item, zona waktu scheduler

Tanggal: 2026-10-11
Status: diterima (tindak lanjut audit UI/UX 2026-10, Fase 1)
SPEC: —
Terkait: ADR-0106 (diperluas di sini: pembatalan & requeue antrean) · ADR-0191 (cron = eksekusi, butuh `sessions:spawn`) · ADR-0099 (MCP) · ADR-0202 (keputusan MCP wajib) · ADR-0107 (state scheduler tanpa `queue`) · ADR-0112 (cron, zona lokal server)

## Konteks

Empat temuan audit UI/UX yang menunggu sisi server:

1. **Antre ulang untuk item Gagal tak pernah berhasil.** `markRequeued` hanya menerima `canceled`, sehingga
   `POST /scheduler/queue/:id/requeue` atas baris `failed` selalu 409, dan tombol "Antre ulang" di UI gagal
   terus. Izin untuk `failed` belum pernah diputuskan.
2. **Notifikasi hanya bisa ditandai terbaca semuanya.** Tak ada cara menandai satu item; operator yang ingin
   menandai satu notifikasi tanpa menyapu sisanya tak punya jalan.
3. **Preview cron memakai zona browser.** Cron dihitung di zona LOKAL server (`shared/src/cron-expr.ts` memakai
   penanda lokal), tetapi server tak mengekspos zonanya, sehingga UI tak bisa menyesuaikan preview.
4. **`setupTokenPath` di `GET /auth/status`** sudah ada sejak SPEC-884 (hanya saat hardening menyala dan belum
   ada akun), tetapi tak ada tes yang memastikan nilainya benar.

## Keputusan

**1. Requeue menerima `canceled` dan `failed`.** `markRequeued` memakai CAS ber-`status IN (canceled, failed)`
dan membuang `note`, `sessionId`, dan `launchedAt` (jejak sesi yang sudah mati). `launched`, `done`, dan
`queued` tak pernah lewat sini. Status lain dijawab **409** `{ error, status }` dengan pesan yang menyebut yang
bisa dikembalikan (`canceled` atau `failed`); id tak ada 404.

**Idempotensi = efek.** Requeue ulang atas baris yang sudah `queued` tidak mengubah apa pun dan dijawab 409
beserta statusnya: bukan 500, dan bukan 200 palsu yang menyangka ia baru saja memindahkan baris. Dua requeue
yang balapan hanya satu yang menang karena penulisannya CAS.

**2. Izin requeue `failed` = `settings:write` + `sessions:spawn`.** Tool `hanoman_scheduler_queue_requeue` tetap
`settings:write` (sudah ada sejak SPEC-522; `capabilityForRoute` tak melihat status baris). Untuk baris `failed`,
handler menuntut juga `sessions:spawn` dan menjawab **403** `{ need: "sessions:spawn", reason: "requeue-executes" }`
bila tak ada. Alasannya sama dengan cron (ADR-0191): peluncuran ulang membuka sesi agen berizin penuh, dan
`settings:write` sendirian tak boleh menjadi jalan memutar ke sana. Baris `canceled` **tak dijaga**: checker
`backlog` memang akan mengantrekan ulang spec-nya sendiri (spec tanpa `baseSha`), jadi tak ada kewenangan baru.

**3. Tandai satu notifikasi terbaca: `POST /notifications/:id/read`.** 204 bila berhasil, 404 bila id tak ada.
Idempoten: `readAt` yang sudah terisi tidak ditulis ulang, jadi waktu baca pertama yang tercatat. Read-state
tetap global (`readAt` per baris, bukan per user), maka yang dijaga hanya keberadaan. **Keputusan MCP: dibuat tool**
`hanoman_notification_mark_read` (mode `write`, `notifications:write`, berdasarkan `id`). Tool tandai-semua
(`hanoman_notifications_mark_read`) tetap dan deskripsinya menunjuk ke tool per item. Tanpa perubahan skema.

**4. Zona waktu lokal server sebagai field aditif.** `serverTimeZone` (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
ditambahkan ke `GET /scheduler/state` dan `GET /scheduler/config`. `PUT /scheduler/config` tetap menerima setelan
polos (zod membuang field asing). `hanoman_scheduler_state` dan `hanoman_scheduler_config_get` memakai
`shape: raw`, jadi field ikut tanpa tool baru.

**5. `setupTokenPath` dibiarkan apa adanya, dengan tes.** Ia hanya berisi **lokasi** berkas token, bukan isinya,
dan hanya muncul saat hardening menyala dan belum ada akun. Tidak dibatasi ke request loopback: pembatasan itu
justru menyembunyikannya dari instalasi VPS yang diakses lewat domain saat first-run, padahal di situlah ia
dibutuhkan. Tes baru memastikan nilainya ada saat first-run dan hilang setelah akun pertama dibuat.

## Konsekuensi

- **Perilaku yang berubah:** `POST /scheduler/queue/:id/requeue` kini menerima `failed`, dan token agen tanpa
  `sessions:spawn` ditolak (403) untuk baris itu. Ini memperluas ADR-0106, yang hanya mengenal `canceled`.
- **Tool MCP:** satu baru (`hanoman_notification_mark_read`). `mcp-coverage` tetap hijau; route `POST
  /notifications/:id/read` terjangkau tool itu. Tak ada perubahan `UNWRAPPED` atau `COOKIE_ONLY`.
- **Tanpa migrasi** dan tanpa perubahan skema. Field baru bersifat aditif; klien lama yang tak membacanya tak
  terganggu.
- **Sisi UI yang belum diubah** (milik agen lain, bukan di ADR ini): `SchedulerCrons` masih memakai zona browser
  untuk preview, dan `AuthScreen` belum menerima `setupTokenPath` dari `App.tsx`. Keduanya sudah tersedia di server.
