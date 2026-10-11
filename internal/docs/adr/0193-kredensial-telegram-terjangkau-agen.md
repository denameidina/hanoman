# ADR-0193 — Kredensial Telegram terjangkau agen: capability `telegram:admin` (danger), dengan anti-eskalasi di server

Tanggal: 2026-10-11
Status: diterima (permintaan pemilik repo)
**Mengamandemen ADR-0097** (permukaan kredensial Telegram cookie-only) dan **ADR-0155** (kosakata akses `danger`)
Terkait: ADR-0096 (domain `telegram`) · ADR-0099 §4 · ADR-0065 · SPEC-491 (Telegram diam total) · ADR-0194/0195 (keputusan serumpun)

## Konteks

`GET|PUT /telegram/settings`, `POST /telegram/test`, dan `DELETE /telegram/credentials` dipetakan
`COOKIE_ONLY` oleh ADR-0097: ia menyimpan bot token dan AgentToken gateway, dan gateway sendiri —
yang wajib memegang `settings:write` — tidak boleh menyentuhnya. Audit cakupan MCP menemukan keempat
route itu satu-satunya bagian domain Telegram tanpa tool. Pemilik repo meminta keempatnya dibungkus.

Larangan lama punya dua alasan: (1) kredensial tak boleh bocor ke agen, (2) agen tak boleh
menaikkan haknya lewat kredensial. Alasan (1) sudah dijawab desain REST-nya sendiri: respons hanya
`masked` + `hasValue`. Alasan (2) nyata dan TIDAK hilang dengan membuka route — gateway Telegram
menjalankan pekerjaan operator dengan **seluruh capability token gateway-nya** (termasuk
`sessions:spawn`, `vps:exec`, `ide:git`, `backlog:lifecycle`) atas perintah user yang ada di
allowlist. Siapa pun yang boleh mengganti allowlist, bot token, atau AgentToken gateway pada
dasarnya menentukan siapa yang mewarisi capability itu.

## Keputusan

### 1. Capability BARU `telegram:admin`, akses `danger`

Dipetakan apa pun methodnya untuk `settings`, `test`, dan `credentials` (GET pun: ia membuka
allowlist dan chat target). Sifat `danger` ADR-0155: tak diimplikasikan `telegram:write`, dan
`telegram:admin` tidak memberi `telegram:read`. Domain `telegram` mendapat kolom ketiga di grid
Settings; `risk: "exec"`.

**Tak ada regresi untuk gateway.** `TELEGRAM_REQUIRED_CAPABILITIES` TIDAK diubah, jadi token
gateway yang sudah berjalan tetap sah dan tetap tidak memegang `telegram:admin` — ia tetap tak
menjangkau kredensialnya sendiri (kini dijawab `403 need: telegram:admin`, dulu `403 cookie session
required`). Test mengikat: token ber-seluruh-capability-gateway ditolak di keempat route, namun
`/telegram/status` tetap terbuka baginya.

### 2. Anti-eskalasi diri, ditegakkan di handler SERVER

`PUT /telegram/settings` oleh **agent token** (bukan cookie manusia) diperiksa `gatewayEscalation`
(`services/telegram/credentials.ts`) SEBELUM validasi lain: token gateway **efektif** — yang
dikirim di patch, atau yang sudah tersimpan — tidak boleh memegang capability yang tak dimiliki
token pemanggil (`grantsCapability`); selisihnya `403 {error, missing[]}` dan tak ada yang
tertulis. Akibat praktis yang disengaja: mengubah kredensial gateway menuntut capability yang
setara gateway itu. Token yang tak bisa diverifikasi (belum diisi/tak dikenal) tidak memicu
penolakan: gateway dengan token seperti itu tak bisa berjalan.

`DELETE` dan `POST /test` tak memberi hak baru, jadi tak diperiksa serupa; keduanya tetap `danger`
karena `DELETE` mematikan gateway dan `test` mengirim pesan sungguhan ke chat operator.

### 3. Empat tool, semuanya `danger`

`hanoman_telegram_settings_get`, `_settings_set`, `_test`, `_credentials_clear`. `settings_get`
pun bermode `danger` karena aturan "tool bercapability danger wajib bermode danger" (mode &
capability dikunci satu-satu oleh `mcp-catalog.test.ts`). `settings_set` menandai `botToken` dan
`agentToken` sebagai `secretArgs`.

### 4. Redaksi

`cli/src/mcp/redact.ts`: (a) pola bentuk bot token Telegram disensor di titik keluar tunggal;
(b) `secretArgs` per-tool — nilai rahasia yang DIKIRIM pemanggil disensor dari hasil dan galat
panggilan itu (`redactSecrets`). Rahasia yang dibangkitkan server tidak termasuk (lihat ADR-0194).

## Konsekuensi

- Capability **+1** (`telegram:admin`); tool **+4**. Aditif bagi token lama: tak ada yang kehilangan
  hak, dan tak ada yang otomatis mendapat `telegram:admin` — manusia mencentangnya.
- `ADR-0097` tetap berlaku untuk cookie manusia dan untuk token gateway; yang dibalik hanya
  "tak ada capability yang cukup".
- `MCP_TOOL_SCHEMA_VERSION` tidak berubah (penambahan aditif).

## Yang TIDAK diputuskan di sini

- Menjadikan gateway pemegang `telegram:admin`. Tidak: gateway menerima perintah dari luar, dan
  kemampuan mengganti allowlist-nya sendiri dari Telegram adalah eskalasi yang dicegah ADR ini.
