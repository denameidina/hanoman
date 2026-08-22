# ADR-0134 — Prediksi input dihakimi oleh pengakuan pengiriman, bukan oleh `readyState`

Status: accepted · 2026-08-21

## Konteks

Echo prediktif SPEC-856 punya satu backstop: bila sebuah prediksi mencapai TTL **500 ms** tanpa
pernah ter-echo, ia di-rollback dan prediksi disuspend **30 detik**. Backstop itu benar dan tetap
dibutuhkan — `read -s` dan tombol yang ditelan dialog Ink sama-sama terukur membalas **nol byte**,
dan tak ada cara lain memisahkan "pty sengaja bungkam" dari "jaringan lambat".

Tetapi jam TTL-nya dimulai saat karakter **diketik**, dan gerbang prediksinya membaca
`view.connected = ws.readyState === OPEN`. Keduanya fakta **transport**, dipakai sebagai fakta
**pengiriman**. SPEC-878 mengukur harganya di jalur nyata (tmux 3.7b + node-pty + `@xterm/xterm` 6
asli + Chrome 151 headless, RTT 200 ms dan pemadaman disuntik di jembatan):

1. **Socket `OPEN` tetapi byte tak mengalir** — bentuk normal "pindah sel / sinyal turun", jauh
   sebelum browser menyatakan socket mati. Prediksi menyala, sembilan glyph muncul, lalu TTL
   **menghapus kesembilannya** (`\x1b[9D\x1b[K`) dan menyalakan `suspendedUntil = now + 30_000`.
   Sesudah itu **0 tulis lokal** untuk setiap ketikan berikutnya, `link` terukur tetap `"open"`,
   **nol banner**. Satu kedip 500 ms membeli **30,5 detik layar bisu**.
2. **Socket tertutup** — prediksi menolak total: **0 tulis lokal untuk 14 keystroke**, meski
   bytenya sendiri aman diantre di `pendingInput` dan pasti terkirim.

Dua keadaan yang berlawanan secara pengiriman ("pasti sampai, hanya belum" vs "tak akan pernah
sampai") diperlakukan sama, dan keadaan yang paling berbahaya justru dinilai paling sehat.

`ws.bufferedAmount` sudah dipertimbangkan dan **tidak cukup**: payload satu keystroke lolos ke
buffer kernel dan terbaca `0` meski tak satu byte pun sampai ke server. Klien, sendirian, tak punya
cara mengetahui apakah bytenya sampai.

## Keputusan

**Klien menomori setiap frame input dan server mengakuinya; hanya pengakuan itu yang boleh
menjalankan jam TTL prediksi.**

1. Kontrak frame terminal bertambah satu pasang:
   - klien → server: **`{ t: "in"; d: string; seq?: number }`** — `seq` monoton per socket, mulai 1;
   - server → klien: **`{ t: "ack"; seq: number }`**, dikirim **sesudah** `writeTo` selesai, hanya
     bila frame masuknya membawa `seq`.
   Maknanya tepat: *"server menerima frame ini dan menyerahkannya ke pty"*.
2. Modul murni `terminal-predict.ts` mengubah dua hal dan menambah satu:
   - `View.connected` → **`View.deliverable`** — "antrean masih bisa menerima byte ini DAN suatu
     saat akan terkuras". `open`/`retrying`/`lost` true; `gone` (4004) dan antrean penuh false.
   - `onInput` menyetel `since = null` — jam **berhenti** setiap kali lahir prediksi baru.
   - **`onDelivered(state, now)`** menyalakan jam. Komponen memanggilnya hanya saat sebuah ack
     membuat jumlah frame yang belum di-ack mencapai nol **dan** socket `OPEN`.
3. `onTick`, `TTL_MS`, dan `SUSPEND_MS = 30_000` **tak berubah**. Yang diperbaiki bukan hukumannya,
   melainkan kapan ia berhak dijatuhkan.

Aturan umumnya, dan itulah yang dipertaruhkan ADR ini:

> Umpan balik optimistis dihakimi oleh **pengiriman**, tidak oleh **koneksi**. Selama sebuah byte
> masih mungkin sampai, diamnya server bukan bukti tentang apa pun.

Ini pasangan ADR-0133: di sana keadaan **pane** berhenti ditebak dari aliran byte, di sini keadaan
**pengiriman** berhenti ditebak dari `readyState`.

## Konsekuensi

- Prediksi hidup selama outage dan **bertahan** selama lubang hitam: operator melihat ketikannya,
  bukan layar diam — janji pokok SPEC-878.
- Backstop TTL **tidak melemah**. Ia kini menyala tepat pada kejadian yang dirancang untuknya:
  byte sudah di pty, dan pty memilih tak membalas.
- Ongkos kawat: satu frame ~20 byte per frame masuk, lewat socket yang sudah `perMessageDeflate`
  (SPEC-812). Frame masuk sudah dibatasi batcher ke ≤1 per 16 ms saat mengetik; bandingannya
  **1 540 byte** repaint yang dikirim TUI agen untuk keystroke yang sama. Arah keluar SPEC-812 tak
  disentuh sama sekali.
- `WsMessageGuard` menghitung frame **masuk** saja, jadi kuota 6 000/menit (SPEC-771) tak bergeser.
- **Tak ada denyut periodik.** Ack hanya lahir sebagai balasan; pane yang diam tak menghasilkan satu
  byte pun tambahan — kalau tidak, ia membalik justru yang dibeli SPEC-812.
- **Merosot ke arah aman di kedua rilis campuran.** Server lama tak mengenal `seq` dan tak membalas:
  jam TTL tak pernah berjalan, prediksi bertahan sampai byte server berikutnya melepasnya. Klien
  lama tak mengirim `seq` dan tak menerima ack: perilakunya persis seperti sebelum ADR ini. Pada
  paket npm global (ADR-0087) keduanya satu artefak, jadi kombinasi itu praktis tak pernah lahir.
- Menegakkan [ADR-0014](0014-pty-terminal-di-proses-api.md),
  [ADR-0016](0016-sesi-terminal-hidup-di-tmux.md),
  [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md), dan
  [ADR-0133](0133-alternate-screen-pane-dari-tmux.md). **Tidak** menyentuh skema, kolom, endpoint
  HTTP, maupun arah keluar SPEC-812.

## Alternatif yang ditolak

- **`ws.bufferedAmount` sebagai proksi pengiriman.** Terukur tak cukup: payload sekecil satu
  keystroke lolos ke buffer kernel dan terbaca `0` justru pada kasus yang paling perlu dideteksi.
- **Denyut/ping periodik dari server sebagai bukti hidup.** Memberi sinyal tanpa mengubah kontrak
  frame masuk, tetapi membebani setiap pane yang diam — persis biaya yang SPEC-812 hapus — dan tetap
  tak menjawab "apakah **byte saya** sampai", hanya "apakah pipa hidup".
- **Membiarkan prediksi bertahan tanpa jam sama sekali** (cabut TTL). Menghapus satu-satunya
  perlindungan terhadap `read -s` yang tak tertangkap `looksLikePasswordPrompt` — menukar bug umpan
  balik dengan bug kebocoran layar.
- **Memperpendek `SUSPEND_MS`.** Meredakan gejala tanpa menyentuh sebabnya, dan melemahkan backstop
  di kasus yang memang benar.
- **Ack per byte alih-alih per frame.** Tak menambah informasi apa pun — batcher sudah membuat frame
  jadi satuan pengiriman yang tepat — dan mengalikan ongkos kawat tanpa hasil.

## Amandemen — suspend menyembuhkan diri lewat bukti echo; fallback 5 detik (2026-08-22)

Alternatif "memperpendek `SUSPEND_MS`" di atas ditolak karena ia meredakan gejala **tanpa menyentuh
sebabnya**: suspend tak punya jalur pulih selain menunggu. Amandemen ini menyentuh sebabnya, dan baru
sesudah itu memperpendek angkanya.

**Yang berubah di medan.** Sesudah jalur server dibuat sinkron (frame `in` tak lagi menunggu query
Prisma; poll tmux tak lagi memblokir event loop), pemicu palsu TTL yang tersisa adalah **TUI agen
yang menggambar ulang >500 ms saat mesin sibuk** — bukan jaringan. Satu repaint lambat membeli
**30 detik tanpa echo lokal** pada `suspendedUntil` yang hanya direset saat reconnect.

**Keputusan.**
1. Selama suspend, teks yang diketik (dan tak diprediksi) dicatat sebagai `typed` (berbatas
   `TYPED_MAX`; control/bulk mengosongkannya karena barisnya berubah). Sesudah setiap frame server
   **tergambar** — dibaca di callback `term.write`, karena xterm memproses write server secara
   asinkron — bila teks di kiri kursor berakhir dengan ekor `typed` (≥2 huruf bila ada), itu bukti
   pty membalas ketikan lagi dan suspend **dicabut seketika** (`onEchoed`). Di prompt password dan
   dialog yang menelan tombol tak pernah ada bukti, jadi suspend bertahan persis seperti sebelumnya.
2. `SUSPEND_MS` 30 000 → **5 000**. Ia kini hanya fallback untuk konteks yang memang bungkam atau
   yang echonya tak terbaca di kiri kursor. Harga di `read -s` yang lolos `looksLikePasswordPrompt`:
   paling banyak **satu huruf berkedip 500 ms per 5 detik** (dulu per 30 detik) — huruf pertama
   selalu berkedip di kedua versi.
3. `TTL_MS` **tak berubah**: ia tetap satu-satunya perlindungan kebocoran layar.

Dikunci di `terminal-predict.test.ts` (buku ketikan, bukti echo, kasus ketikan menyusul frame,
prompt bungkam tetap suspend) dan `terminal-pane.test.tsx` (bukti dibaca di callback write).

