# ADR-0226 — Notifikasi "sesi menunggu keputusan" dikirim juga ke Telegram operator

Tanggal: 2026-10-19 · Status: diterima · tanpa nomor SPEC (permintaan langsung operator)

**Memperluas** [ADR-0036](0036-notifikasi-human-decision.md) dan [ADR-0143](0143-menunggu-keputusan-keadaan-turunan.md)
(notifikasi `decision` hanya hidup di dashboard) dengan satu kanal keluar. **Memakai** kredensial
[ADR-0097](0097-kredensial-telegram-di-settings-terenkripsi.md); **tidak** bergantung pada gateway
percakapan [ADR-0096](0096-telegram-gateway-session-operator-persisten.md). **Menegakkan**
[ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (tanpa timer/queue baru) dan
[ADR-0202](0202-keputusan-mcp-wajib-untuk-setiap-api-baru.md) (keputusan MCP, di bawah).
Nol skema, nol migration, nol endpoint.

## Konteks

Sesi backlog sering diam menunggu jawaban `AskUserQuestion` karena operator tak sedang membuka
dashboard. Terukur pada 86 sesi: **80 jam dari 293 jam jam-dinding** (≈27%) dihabiskan menunggu
keputusan; p90 per putaran **36 menit**. `scanDecisions()` sudah melahirkan baris `Notification`
`type: "decision"` (dedup per episode lewat set `awaiting`), tetapi toast + sound-nya hanya terlihat
di tab dashboard yang terbuka. Webhook `notification.created` ([ADR-0100](0100-webhook-keluar-peristiwa.md))
ada, tetapi instance operator tak punya endpoint penerima.

Instance operator sudah punya Telegram: `configured: true, enabled: true, allowlistCount: 1`, namun
gateway `running: false` karena AgentToken gateway kurang capability. Gateway percakapan menjalankan
pekerjaan dengan capability token itu; push satu arah tidak butuh itu sama sekali.

## Keputusan

1. **Push lewat `pushDecisionToTelegram`** (`server/src/services/telegram/notify.ts`), dipanggil dari
   `scanDecisions` tepat sesudah baris `decision` baru dibuat. Dedup diwarisi apa adanya: satu baris
   `decision` baru = satu push, jadi episode yang sama tak mengirim dobel, dan kedipan "sibuk" di tengah
   episode (ADR-0143) tak mengirim apa pun. Perilaku hanoman-lead tak diubah: lead yang menjawab sendiri
   tidak melahirkan baris `decision`, sehingga tak ada pesan.
2. **Kredensial = bot token + allowlist saja.** Penerima = tiap numeric user id di
   `HANOMAN_TELEGRAM_ALLOWED_USER_IDS` (private chat: chat id = user id); entri non-numerik dibuang.
   `HANOMAN_TELEGRAM_TARGET_CHAT_ID` sengaja tak dipakai agar push tak mendarat di channel/grup.
   Master switch `telegram.enabled` dan AgentToken gateway tidak dilihat.
3. **Fire-and-forget.** `scanDecisions` memanggilnya tanpa `await`; fungsi itu sendiri tak pernah
   melempar (semua galat → `console.warn`, token disamarkan `sanitizeTelegramOutput`), mengirim ke
   penerima paralel (`allSettled`, satu penerima gagal tak membatalkan yang lain), dan dibatasi
   timeout 10 detik lewat `AbortSignal` agar Telegram yang menggantung tak menumpuk promise.
4. **Toggle `Setting.notifyDecisionTelegram`** (default `true`, kunci di blob JSON `Setting`). "Default
   menyala" aman karena tanpa bot token + allowlist push no-op. Kontrolnya di kartu "Sesi & notifikasi"
   Settings, tepat di bawah "Notifikasi butuh keputusan". Ia independen dari `notifyDecision` (toggle
   toast sisi klien — server tak pernah membacanya).
5. **Tautan hanya bila diketahui:** `${origin}/terminal` dengan origin = host control pertama
   `HANOMAN_CONTROL_ORIGINS`. Pemindai berjalan tanpa request, jadi tak ada host untuk ditiru; tanpa
   env itu (instalasi polos) pesan tak memuat tautan. Rute dashboard tak punya deep-link per sesi,
   maka `/terminal`; id sesi dan spec ada di teks pesan.
6. **Keputusan MCP (aturan #7):** tool `hanoman_settings_get/set` yang ada cukup — skemanya objek
   `Setting` utuh, field baru lewat tanpa perubahan katalog. Tak ada route baru.

## Alternatif ditolak

- **Webhook `notification.created`** — instance operator tak punya endpoint penerima.
- **Menaruh push di gateway percakapan** — mati bersama AgentToken-nya; persis keadaan instance operator.
- **Outbox tabel / retry** — skema baru + loop pengirim = timer yang dilarang ADR-0024. Notifikasi ini
  cuma pengingat: baris `Notification` tetap ada di dashboard, kehilangan satu push tidak merusak
  data. Ditukar dengan kesederhanaan; bila nanti perlu jaminan, ADR baru.
- **Mengirim juga saat `awaiting` lama dipulihkan setelah restart** — sudah diterima di ADR-0036
  (paling banyak satu notifikasi ulang per keputusan terbuka); push mengikutinya.

## Konsekuensi

- Operator wajib sudah `/start` bot-nya sekali; bila belum, Telegram menjawab 403 dan galat tercatat di log server.
- Pesan memuat judul backlog dan id spec/sesi — masuk ke Telegram (pihak ketiga). Allowlist yang sama
  sudah dipercaya gateway percakapan; toggle mematikannya.
- Kegagalan jaringan = pesan hilang tanpa retry; dashboard tetap menjadi sumber kebenaran.
