# ADR-0196 — Tool MCP untuk kredensial & akun: capability opt-in dan pagar tak-eskalasi-diri di server

Tanggal: 2026-10-11
Status: diterima (permintaan eksplisit pemilik repo)
**Mengamandemen ADR-0065** (`/agent-tokens` cookie-only: "agen tak boleh mencetak/menaikkan token sendiri"),
**ADR-0044** (device token tak terjangkau agen) dan **ADR-0099 §4** (MCP tak mengekspos kredensial);
menegaskan ADR-0097, ADR-0100, ADR-0110 (permukaan kredensial lain tetap cookie-only).
Melanjutkan **ADR-0155** (batas ada di capability, bukan di ketiadaan tool) · Kembar: ADR-0197, ADR-0198.

## Konteks

Audit cakupan menemukan permukaan admin yang tak punya tool MCP karena `capabilityForRoute`
memetakannya ke `COOKIE_ONLY`: `/api/agent-tokens*`, `/api/device-tokens*`, `/api/auth/users*`, dan
`POST /api/auth/change-password`. Pemilik repo **meminta secara eksplisit** agar mereka dibungkus, jadi
keputusan lama — "tak ada capability yang bisa berarti apa pun di sana" — dibalik dengan sadar.

Membalik dengan benar bukan sekadar menghapus `COOKIE_ONLY`. Ini permukaan eskalasi paling langsung yang
ada: token yang boleh mencetak token adalah token yang boleh mencetak token lebih kuat dari dirinya.

## Keputusan

### 1. Capability baru, opt-in, granular — tak ada yang diwarisi

| Capability | Akses | Membuka |
|---|---|---|
| `tokens:read` / `tokens:write` | baca / tulis | `GET /agent-tokens{,/capabilities}` / `POST`, `PATCH`, `DELETE /agent-tokens` |
| `devices:read` / `devices:write` | baca / tulis | `GET /device-tokens` / `POST`, `DELETE /device-tokens` |
| `access:read` | baca | `GET /auth/users` |
| `access:admin` | **danger** | `POST /auth/users`, `DELETE /auth/users/:id`, `POST /auth/change-password` |

`grantsCapability` **tidak diubah**: `:write` mengimplikasikan `:read` di domainnya sendiri dan tidak
lebih; `access:admin` (danger) tak diimplikasikan apa pun dan tak mengimplikasikan `access:read`. Token
yang sudah terbit tidak berubah hak satu bit pun (nol backfill). Domain `tokens`/`devices`/`access`
masing-masing punya SATU kotak per tingkat akses, sesuai grid Settings.

### 2. Pagar tak-eskalasi-diri di HANDLER (`routes/agent-tokens.ts`), bukan di katalog

`capabilityForRoute` sengaja murni `(method, path)` — ia tak melihat body, jadi tak bisa menegakkan
"token hasil cetak ⊆ pencetak". Pagarnya hidup di handler, hanya berlaku untuk principal `req.agent`
(cookie manusia tak dibatasi, perilaku lama utuh), memakai `exceedingCapabilities()` di `shared`:

- **POST** — `capabilities` token baru ⊆ capability pemanggil (`write ⊇ read`; danger hanya bila pemanggil
  memegang persis danger itu; id tak dikenal = melebihi). Lainnya → 403 `{ error, exceeds }`. `createdBy`
  = `agent:<id>`, sehingga rantai penerbit terlacak.
- **PATCH** — (a) `capabilities` baru ⊆ milik pemanggil; (b) capability token TARGET ⊆ milik pemanggil —
  agen lemah tak boleh menonaktifkan, menurunkan, atau mencabut token yang manusia beri hak lebih besar
  (itu sabotase/DoS atas kredensial lain); (c) **token sendiri tak bisa diubah** (403 `{ self: true }`).
- **DELETE** — (b) dan (c) yang sama.

Keputusan tentang "mengubah/mencabut token dirinya sendiri": **dilarang, untuk semua isi patch**, juga
penyempitan dan penonaktifan. Token yang memutus kanalnya sendiri tanpa pemberitahuan membuat agen mati
tanpa jejak yang bisa dijelaskan; manusia yang memutuskan itu di dashboard. Menyempitkan diri tak bernilai
cukup untuk membuka pengecualian.

### 3. Rahasia: sekali-tampil, tak masuk jejak

Plaintext hanya ada di balasan `POST` (agent maupun device token). Daftar tak pernah memuatnya; log
audit (`admin.*`) hanya memuat id/nama/capability. Di sisi CLI MCP, `redactToken` menyensor pola
`hnm_agt_…` di SEMUA keluaran — termasuk hasil tool pencetak, yang membuat tool-nya mustahil. Jawabannya
bukan melonggarkan `redactToken`, melainkan penanda eksplisit `McpToolDef.revealsSecret` pada **dua** tool
(`hanoman_agent_token_create`, `hanoman_device_token_create`): hanya HASIL SUKSES mereka yang memakai
`redactKeepingFresh` (token konfigurasi proses MCP tetap disensor). Galat dan stderr tetap disensor penuh.
Field `password`/`newPassword`/`passwordHash` ber-JSON kini disensor di semua keluaran (argumen tool akun
membawa password, dan galat server bisa memantulkan bentuk request).

### 4. Device token punya pemilik manusia

`DeviceToken.userId` adalah akun; agen tak punya akun. Pemilik dalam konteks agen = akun **admin aktif**
yang menerbitkan agent token itu (`AgentToken.createdBy`, menelusuri rantai `agent:<id>` ≤ 8 tingkat).
Tanpa pemilik manusia → 409, **bukan** diam-diam memilih akun lain. Agen hanya melihat/mencabut device
token milik akun itu (milik akun lain tampak 404). Tanpa migration: `createdBy` sudah berupa string bebas.

### 5. Akun

`access:admin` setara menyerahkan seluruh instance: akun admin = akses cookie penuh, termasuk semua yang
cookie-only. Capability ini karena itu `danger` + `risk: "rce"`, dan ditulis begitu di deskripsinya.
`POST /auth/change-password` untuk agen berbentuk lain (`zAdminPasswordReset`: `{ userId, newPassword }`,
`.strict()`) — tak ada "password saya" tanpa `req.user`; password lama tak diminta; **semua sesi akun target
dicabut**; **tidak ada cookie diterbitkan** ke agen. Penjaga "admin terakhir tak bisa dihapus" tetap.
Pembuatan akun klien tetap hanya lewat `/client-accounts` (cookie-only, ADR-0110).

### 6. Jejak audit

Setiap aksi admin oleh agent token ditulis ke log event (`admin.agent-token.created|updated|revoked`,
`admin.device-token.created|revoked`, `admin.user.created|deleted|password-reset`) lewat `appendEvent`
(`services/admin-audit.ts`). Manusia berkuki tak ditambah audit — perilakunya tak berubah.

## Tool (12)

Baca: `hanoman_agent_tokens_list`, `hanoman_agent_token_capabilities`, `hanoman_device_tokens_list`,
`hanoman_users_list` (4). Semua tulis (8) bermode **danger** (hanya tampil dengan `--danger`; ini ergonomi, bukan
gerbang): `hanoman_agent_token_create|update|revoke`, `hanoman_device_token_create|revoke`,
`hanoman_user_create|delete|password_reset`. Katalog: `shared/src/mcp-catalog/admin.ts`.

## Yang TETAP tidak dibungkus (teknis, bukan kelalaian)

- `GET /auth/status` — PUBLIK, `user` selalu null untuk agen; tak ada isi.
- `POST /auth/{setup,login,logout}` — cookie sesi & bootstrap setup-token; agen tak punya sesi cookie.
- `/sync/*` — Bearer device token mesin-ke-mesin, bukan agent token.
- `/client-accounts*`, `/portal*`, `/webhooks*`, kredensial Telegram — keputusan ADR-0097/0100/0110 berdiri.
Alasannya dicatat di `UNWRAPPED` (`server/test/mcp-coverage.test.ts`).

## Konsekuensi

- 6 capability dari ADR ini (14 bersama ADR-0197/0198): 34 → 48 id, 15 → 23 domain, `danger` 4 → 7.
  Jumlah kotak yang harus dicentang manusia bertambah — sengaja, dan disadari lewat tripwire angka di
  `agent-tokens.route.test.ts`.
- Nol endpoint baru, nol migration, aditif bagi token yang sudah terbit.
- `explainHttpError` membedakan 403 pagar (`exceeds`/`self`) dari 403 cookie-only.

## Verifikasi

`server/test/admin-surface.route.test.ts` (27 kasus: eskalasi POST/PATCH/DELETE, token sendiri, target lebih
berkuasa, pemilik device token, reset password mencabut sesi, rahasia tak bocor ke audit), `mcp-catalog.admin
.test.ts`, `agent-capabilities.test.ts`, kontrak cakupan MCP. Uji nyata: server lokal ber-`HANOMAN_HOME`
sementara, 403 dengan `need` tanpa capability, lolos dengan capability, semua penolakan eskalasi dikonfirmasi
lewat curl-setara (`fetch`).
