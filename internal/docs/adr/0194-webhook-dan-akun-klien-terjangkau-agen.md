# ADR-0194 — Webhook keluar dan akun klien terjangkau agen: domain `webhooks` dan `clients`

Tanggal: 2026-10-11
Status: diterima (permintaan pemilik repo)
**Mengamandemen ADR-0100** (webhook keluar cookie-only) dan **ADR-0110** (`/client-accounts` cookie-only; `/portal` ditangani ADR-0195)
Terkait: ADR-0193 · ADR-0155 (mode `danger` ergonomi vs capability) · ADR-0157 (preseden domain baru) · SPEC-405 (peta menurut method) · SPEC-481 (SSRF) · SPEC-617

## Konteks

Dua permukaan yang dulu dikecualikan dari MCP karena memegang kredensial:

- **Webhook keluar** (`/webhooks*`): secret penandatanganan, dan penentu ke mana data workspace
  mengalir keluar (ADR-0100).
- **Akun klien** (`/client-accounts*`): membuat login portal beserta password awalnya (ADR-0110).

Pemilik repo meminta keduanya dibungkus. Yang dipertahankan dari larangan lama bukan "tak ada
tool", melainkan tiga hal: capability opt-in, rahasia tak bocor di luar yang memang sekali-tampil,
dan tak ada jalan mengubah apa yang hanya boleh diputuskan manusia.

## Keputusan

### 1. Dua domain BARU, dipetakan MENURUT METHOD

`webhooks:read|write` dan `clients:read|write` (`write` mengimplikasikan `read`). Tidak menumpang
`settings`: `settings:write` tak boleh diam-diam menjadi hak mengalirkan data keluar atau membuat
login orang luar. Keduanya opt-in; tak ada token lama yang mewarisinya.

### 2. Webhook: `allowPrivate` tetap keputusan manusia

`allowPrivate` mematikan pagar SSRF (alamat loopback/internal) — peta `(method, path)` tak bisa
menyatakannya karena bergantung body. Handler (`routes/webhooks.ts`) menolak **403** untuk agent
token yang (a) menyalakan `allowPrivate`, atau (b) mengganti URL endpoint yang SUDAH ber-
`allowPrivate` (pagar IP literal tak diperiksa ulang untuk flag yang sudah menyala). Pemeriksaan
mendahului validasi lain sehingga respons 400 tak bisa dipakai meraba pagar. Parameter `allowPrivate`
dan `secret` (secret pilihan sendiri) sengaja tidak ada di skema tool; test memastikan `build()`
tak mengirimnya walau model menyelipkannya.

Secret yang dibangkitkan server ditampilkan **sekali** di respons create/rotate, persis seperti REST,
dan tidak disensor (agen memang harus menyerahkannya ke penerima). Peristiwa `webhook.ping` dari
agen memakai aktor `agent:<id>` bukan `operator`.

`webhooks:read` membuka riwayat pengiriman beserta `payload` amplop — data project APA PUN yang
cocok langganan, bukan hanya yang boleh dilihat agen lewat capability lain. Ditulis di deskripsi
capability dan tool.

### 3. Akun klien: hanya baris `role="client"`

Handler lama sudah membatasi ke akun klien; test baru membuktikan reset password / nonaktifkan /
hapus terhadap id akun operator menjawab 404 dan tak mengubah baris. Password tak pernah
dikembalikan oleh server; tool menandainya `secretArgs` sehingga juga tak muncul di keluaran tool.
Reset password dan nonaktifkan tetap mencabut sesi aktif seketika (perilaku REST tak diubah).

### 4. Tool: sembilan tulis `danger`, tiga baca

Baca: `hanoman_webhooks_list`, `hanoman_webhook_deliveries`, `hanoman_client_accounts_list`.
`danger` (semua tulis): `hanoman_webhook_{create,update,delete,test,delivery_retry}` dan
`hanoman_client_account_{create,update,password_reset,delete}`. Capability-nya tetap `:write`
(domain ini tak punya pecahan `danger`), jadi kesembilannya masuk daftar `DESTRUCTIVE_BUT_WRITE`
(ADR-0155): mode `danger` adalah ergonomi, bukan gerbang. `password_reset` dipisah dari `update`
agar kata sandi tak bercampur dengan perubahan akses.

## Konsekuensi

- Capability **+4**; tool **+12**. Aditif bagi token lama.
- Pemegang `clients:write` bisa membuka login baru (read-only) ke data project mana pun — ini
  pelebaran data-exposure, bukan pelebaran capability token; itulah mengapa tulisnya `danger` dan
  deskripsi capability menyebutnya.
- `ADR-0100` dan `ADR-0110` tetap berlaku untuk cookie manusia; yang dibalik hanya "tak ada
  capability yang cukup" untuk permukaan ini.

## Yang TIDAK diputuskan di sini

- `webhooks:allow-private` sebagai capability tersendiri. Tidak dibuat: SSRF internal tidak punya
  kasus pakai yang mendesak bagi agen, dan menambahnya hanya menambah kotak.
- Portal klien itu sendiri — ADR-0195.
