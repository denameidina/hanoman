# ADR-0097 — Kredensial Telegram di Settings: entri config terenkripsi, bukan `.env`

- Status: Accepted — **diamandemen [0193](0193-kredensial-telegram-terjangkau-agen.md)**: permukaan kredensial kini terjangkau agent token lewat capability `telegram:admin` (danger), dengan anti-eskalasi di server
- Tanggal: 2026-08-01
- SPEC: SPEC-477
- Terkait: **mengamandemen** [0096](0096-telegram-gateway-session-operator-persisten.md)
  (kredensial tak lagi env-only); **memperluas** [0049](0049-config-runtime-store-registry.md)
  (nilai `kind: "secret"` kini terenkripsi at-rest) dan [0065](0065-ai-agent-capability-agent-token.md)
  (kategori `credential` = cookie-only); **tidak mencabut** keputusan mana pun.
  ADR-0037 & ADR-0086 utuh.

## Konteks

ADR-0096 menaruh tiga kredensial gateway Telegram di environment: `HANOMAN_TELEGRAM_BOT_TOKEN`,
`HANOMAN_TELEGRAM_ALLOWED_USER_IDS`, dan `HANOMAN_TELEGRAM_AGENT_TOKEN`. `installTelegramGateway`
membacanya **sekali saat boot** dari `process.env`, dan kartu Settings dengan sadar menutup dirinya
sendiri: *"Tidak ada input secret di layar ini: credential disimpan di env, bukan database."*

Harganya baru terlihat saat dipakai. Setiap perubahan menuntut mengedit berkas di server lalu
me-restart proses — mustahil bagi pengguna non-teknis, dan menghalangi konfigurasi berbeda per
instance. Onboarding di layar berakhir dengan langkah "lalu restart service", satu-satunya alur
hanoman yang menyuruh operator keluar dari dashboard.

Sementara itu hanoman **sudah punya** store konfigurasi runtime sejak ADR-0049: `RuntimeConfig` +
`CONFIG_REGISTRY`, dengan resolver `effectiveStr()` = **DB → env → default** dan `sourceOf()` yang
sudah membedakan `"db"`/`"env"`/`"default"`. Itu persis semantik "DB kosong → pakai `.env` → tandai
deprecated" yang dibutuhkan — sudah berjalan, hanya belum dipakai Telegram.

Dua hal menghalangi pemakaian langsung. `RuntimeConfig.value` disimpan **plaintext**, sementara bot
token adalah rahasia. Dan `capabilityForRoute` memetakan `/config` ke `settings:write`, capability
yang justru **wajib** dimiliki AgentToken gateway Telegram (ADR-0096 §2 menuntut 23 capability) —
artinya sesi operator Telegram bisa menulis ulang kredensialnya sendiri lewat percakapan.

## Keputusan

### 1. Kredensial Telegram adalah entri `CONFIG_REGISTRY`, bukan store kedua

Grup registry `telegram` dengan empat entri:

| Key | `kind` | `category` | Catatan |
| --- | --- | --- | --- |
| `HANOMAN_TELEGRAM_BOT_TOKEN` | `secret` | `credential` | dimasked di semua respons |
| `HANOMAN_TELEGRAM_AGENT_TOKEN` | `secret` | `credential` | plaintext AgentToken (ADR-0096 §2) |
| `HANOMAN_TELEGRAM_ALLOWED_USER_IDS` | `string` | `credential` | bukan rahasia, tapi kontrol keamanan |
| `HANOMAN_TELEGRAM_TARGET_CHAT_ID` | `string` | `knob` | tujuan Test Connection |

`kind` menentukan **masking**; `category` menentukan **pagar tulis**. Pemisahan dua sumbu ini
disengaja: allowlist harus bisa dibaca kembali oleh operator yang mengisinya, tapi ia memutuskan
siapa yang boleh memerintah bot — jadi ia `credential` tanpa menjadi `secret`.

**Tak ada `Setting.telegram.botToken`.** Blok `Setting` dikembalikan utuh oleh `GET /settings`
(capability `settings:read`); menaruh secret di sana membocorkannya ke setiap pembaca settings.

### 2. Nilai `kind: "secret"` terenkripsi at-rest, satu mekanisme untuk semua

`services/secret-box.ts` — AES-256-GCM, tanpa dependency baru (`node:crypto`), tanpa cabang khusus
Telegram. Kunci 32 byte acak di `<HANOMAN_HOME>/secret.key` mode `0600`, dibuat otomatis saat
pertama dibutuhkan; override opsional `HANOMAN_SECRET_KEY`. Default tidak menuntut env apa pun —
itulah syarat "`.env` tidak lagi diperlukan".

Format `enc:v1:<b64url(iv)>:<b64url(tag)>:<b64url(ciphertext)>`. Batasnya di `setConfig`/`loadConfig`;
**cache in-memory memegang plaintext**, sehingga `effectiveStr`/`effectiveBool`/`rawDbValue` dan
seluruh pemakainya tak berubah satu baris pun. Baris tanpa prefix = plaintext lama, dikembalikan apa
adanya dan naik kelas saat ditulis ulang → **tanpa migration Prisma**. Gagal dekripsi = baris
dianggap **absen** (boot tak boleh mati karena satu secret tak terbaca).

Ikut terenkripsi sekaligus: `SYNC_DEVICE_TOKEN`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`.

### 3. Kategori `credential` tak bisa ditulis agent token

`PUT /config` dan `DELETE /config/:key` menolak **403** bila `req.agent` ada dan
`entry.category === "credential"`. Pagar ini di **permukaan handler**, bukan peta route:
`capabilityForRoute` hanya melihat method+path dan tak pernah melihat `body.key`, jadi ia struktural
tak bisa membedakan `PUT /config {key:"SYNC_TICK_MS"}` dari `PUT /config {key:"GITHUB_TOKEN"}`.
Kondisi tambahan untuk identitas AgentToken — bukan capability baru; ADR-0065 utuh.

### 4. Bootstrap membaca resolver, bukan `process.env`

`installTelegramGateway` menerima `read?: (key) => string | undefined`, default `effectiveStr`. Seam
`env` SPEC-476 dipertahankan dan kini berarti "baca dari peta ini"; fallback diam-diam ke
`process.env` **dicabut**.

**Pasangan wajib:** `loadConfig()` + `applyConfigOnBoot()` dinaikkan dan di-`await` **sebelum**
`installTelegramGateway` di `server.ts`. Sebelumnya keduanya berjalan di `void (async …)` paling
akhir.

### 5. Berlaku langsung tanpa restart

`reloadTelegramGateway()` = `stopTelegramRuntime()` → `installTelegramGateway` lagi dengan seam yang
sama. Dipanggil dari `applyConfigSideEffect` untuk key grup `telegram` (satu titik untuk
`PUT`/`DELETE /config` maupun endpoint Telegram) dan dari `PUT /settings` **hanya bila** blok
`telegram` berbeda — supaya menyimpan setelan lain tak memutus long-poll yang sedang jalan.

Toggle mati tetap tidak membunuh tmux atau menghapus memory (ADR-0096 konsekuensi 2).

### 6. Tiga endpoint baru, semuanya COOKIE_ONLY

```
GET    /api/telegram/settings      view kredensial (secret masked) + `source` per field
PUT    /api/telegram/settings      simpan sebagian/semua; secret kosong = pertahankan; reload
POST   /api/telegram/test          kirim pesan percobaan, timeout 10 dtk, galat sudah diredaksi
DELETE /api/telegram/credentials   hapus keempat key + reload; balas {cleared, envFallback}
```

`capabilityForRoute` mengembalikan `"COOKIE_ONLY"` untuk sub-path `settings`/`test`/`credentials`
**sebelum** `rw("telegram")`. Sub-path lama (`status`, `chats/*`, `replies`, `audit`) tak berubah —
itu memang permukaan kerja sesi operator.

`PUT` memvalidasi **seluruh** patch sebelum menulis satu pun: satu field salah tak boleh
meninggalkan separuh kredensial tersimpan. Test Connection memakai **klien sekali pakai** dengan
`AbortSignal`, bukan klien gateway yang sedang long-poll.

### 7. Validasi format sebagai gerbang TULIS

`ConfigEntry` mendapat `pattern?`/`patternError?`, ditegakkan `parseConfigValue` untuk
`string`/`secret`/`path`. Bot token `^\d{5,}:[A-Za-z0-9_-]{30,}$`, chat id `^-?\d+$`, allowlist
`^\d+(?:[\s,]+\d+)*$`. Satu jalur validasi untuk `PUT /config` maupun `PUT /telegram/settings`.

Nilai dari `.env` **tidak** divalidasi: instance yang hidup hari ini dengan token berbentuk tak
terduga harus tetap hidup.

## Konsekuensi

- Onboarding Telegram selesai di dalam dashboard. Langkah "restart service" hilang.
- Satu store kredensial, bukan dua. Fallback `.env` dan penanda deprecated adalah perilaku resolver
  yang sudah ada, bukan kode baru yang harus dijaga.
- Enkripsi at-rest berlaku untuk seluruh secret registry, bukan hanya Telegram. Ini keuntungan
  sekaligus tanggung jawab: `secret.key` menjadi berkas yang wajib ikut dicadangkan bersama DB.
- `HANOMAN_SECRET_KEY` yang hilang atau berganti membuat secret tersimpan tak terbaca. Perilakunya
  **fail-soft** (baris dianggap absen), jadi instance tetap boot dan operator mengisi ulang.
- `.env` untuk Telegram menjadi jalur warisan yang masih didukung penuh, ditandai `deprecated` di UI.
- Reload gateway memutus koneksi long-poll sesaat. Itu harga yang sadar untuk "berlaku langsung";
  update Telegram yang tertahan tetap aman karena offset baru naik sesudah update durable
  (ADR-0096 gotcha 1).

## Gotcha yang wajib diingat

1. **`loadConfig()` wajib mendahului `installTelegramGateway` — tapi tak boleh fatal.** Urutan lama
   membuat gateway lahir dengan cache config kosong; kegagalannya **senyap dan tampak benar** —
   gateway jalan dari env persis seperti sebelum spec ini, tanpa satu pun error. Menaikkannya saja
   tidak cukup: sebelum spec ini ia fire-and-forget (`void (async …)`), jadi DB yang kedip hanya
   mencetak `unhandledRejection`; di posisi barunya lemparan yang sama menjadi `listen gagal` →
   `process.exit(1)` untuk **seluruh orchestrator**. Terbukti in-vivo saat smoke (`P2021` dari DB
   yang belum bermigrasi menjatuhkan server). Karena itu blok ini di-`await` **di dalam `try/catch`
   yang mencatat lalu lanjut** — cermin kebijakan "log, jangan crash" di `server.ts`; degradasinya
   benar: tanpa cache config, gateway jatuh ke env, yakni perilaku pra-SPEC-477.
2. **Cache config memegang plaintext, DB memegang ciphertext.** Mengenkripsi di `effectiveStr` akan
   memaksa kripto di hot-path sinkron dan memutus setiap pemakai `rawDbValue`.
3. **Nilai tanpa prefix `enc:v1:` adalah plaintext lama, bukan data rusak.** Melempar di sana akan
   mematikan setiap instance yang sudah punya `SYNC_DEVICE_TOKEN`/`GITHUB_TOKEN`.
4. **Chat id channel/supergroup NEGATIF.** Pola `^\d+$` menolak persis kasus "Channel ID". Allowlist
   **user** id tetap non-negatif — dua pola berbeda, jangan disatukan.
5. **`capabilityForRoute` tak pernah melihat body.** Pagar kategori `credential` karena itu harus di
   handler `PUT`/`DELETE /config`, bukan di peta route.
6. **Test Connection tak boleh memakai klien gateway.** Klien yang sedang `getUpdates` long-poll
   memegang `AbortController` loop-nya; menumpang di sana menukar "uji koneksi" dengan "putuskan
   polling".
7. **Nilai dari `.env` tak divalidasi pola.** Validasi adalah gerbang **tulis**, bukan gerbang baca.
8. **`DELETE` kredensial tidak selalu berarti gateway mati.** Bila `.env` lama masih terisi, resolver
   kembali memakainya — responsnya wajib menyebutkan `envFallback`.
9. **Bot token tetap tak pernah masuk sesi.** ADR-0096 gotcha 4 utuh: sesi operator hanya menerima
   AgentToken, chat id, dan base URL. Yang berubah hanya dari mana gateway membaca token itu.
10. **Test SPEC-476 di `SettingsScreen.test.tsx` mengunci perilaku lama sebagai kontrak**
    ("tanpa input credential", "credential disimpan di env"). Ia diganti, bukan ditambahi —
    membiarkannya membuat merah yang benar terlihat seperti regresi (pola SPEC-433/475).

## Alternatif yang ditolak

- **Tabel terenkripsi terpisah (`EncryptedSecret`/`TelegramCredential`).** Isolasi capability jadi
  sepele, tapi melahirkan store kredensial kedua berdampingan dengan `RuntimeConfig`, menuntut
  migration, dan memaksa fallback `.env` + penanda deprecated ditulis tangan — padahal keduanya
  sudah ada dan berjalan di ADR-0049.
- **`Setting.telegram.botToken`.** Tanpa migration, tapi `GET /settings` mengembalikan blok itu utuh
  ke siapa pun ber-`settings:read`, termasuk agent token.
- **Enkripsi hanya untuk bot token.** Blast radius paling sempit, tapi meninggalkan dua aturan
  encoding untuk `kind: "secret"` yang sama — sumber kebingungan permanen — dan membiarkan
  `SYNC_DEVICE_TOKEN`/`GITHUB_TOKEN`/`ANTHROPIC_API_KEY` plaintext.
- **Kunci enkripsi dari env (`HANOMAN_SECRET_KEY` wajib).** Menghidupkan kembali ketergantungan
  `.env` yang justru dicabut spec ini. Ia tetap tersedia sebagai **override opsional**.
- **Restart proses untuk menerapkan perubahan.** Sudah menjadi keluhan aslinya; dan restart tak
  diperlukan karena gateway hidup in-process dengan lifecycle `start`/`stop` yang eksplisit.
