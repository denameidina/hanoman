# ADR-0224 — Limit Antigravity dibaca dari API kuota Google dengan token agy yang hidup

Tanggal: 2026-10-18 · Status: diterima · tanpa nomor SPEC (permintaan langsung operator, opsi 1 dipilih eksplisit)

**Memperluas** [ADR-0221](0221-antigravity-cli-runtime-interaktif-native.md) (Antigravity sebagai runtime
ketiga) dengan limit langganannya, sejajar limit Claude (SPEC-181) dan Codex ([ADR-0074](0074-codex-sebagai-mesin-sesi.md)).
**Menegakkan** [0039](0039-realtime-lewat-websocket-siar.md) (data dashboard lewat kanal siar — grup
global ke-13 `antigravityLimits`, tanpa kanal baru), [0187](0187-mcp-properti-mesin-baca-global.md)/prefix
`limits` sebagai bacaan global, dan [0202](0202-keputusan-mcp-wajib-untuk-setiap-api-baru.md) (tool MCP baru).
Nol skema, nol migration.

## Konteks

Top bar menampilkan limit Claude (panggilan live ke endpoint OAuth Anthropic) dan Codex (snapshot
`rate_limits` yang codex tulis ke rollout). Antigravity tak punya keduanya: `agy` 1.4.2 tak menulis
kuota ke disk dan tak punya subcommand usage. Biner `agy` memuat `quota_manager.go`, yang mengambil
kuota dari Cloud Code API Google — `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`
— dan menyimpannya di memori. Token OAuth agy disimpan go-keyring di Keychain macOS (service `gemini`,
akun `antigravity`, format `go-keyring-base64:<JSON>` berisi `token.access_token` & `token.expiry`).

Satu request percobaan (2026-10-18, atas persetujuan operator) mengembalikan 200 dengan dua grup model
("Gemini Models"; "Claude and GPT models"), masing-masing bucket `weekly` dan `5h` ber-`remainingFraction`
dan `resetTime`.

## Keputusan

1. **Sumber = endpoint yang sama dengan agy, token agy yang sedang hidup.** Cermin limit Claude:
   baca, jangan putar. Refresh token TAK PERNAH dipakai — memutarnya bisa me-logout agy yang sedang
   berjalan. Token yang kedaluwarsa (≤ 30 dtk tersisa) = nol panggilan jaringan; hasilnya `stale`
   (data terakhir) atau `unavailable`. `default_project_id.txt` agy ikut dikirim bila ada.
   Header `User-Agent: antigravity (hanoman)`: terukur, token yang sama dijawab 403 "You do not have a
   valid license of this product" bila UA tak memuat `antigravity`, dan 200 bila memuatnya. UA tetap
   menyebut hanoman sebagai pemanggil sebenarnya, bukan menyamar sebagai versi agy tertentu.
2. **DTO sendiri, window dipakai ulang.** `AntigravityLimitsDTO { status, windows, fetchedAt }`; satu
   `LimitWindow` per (grup × bucket), label "Gemini · Mingguan" / "Claude/GPT · Sesi 5 jam",
   `usedPct = round((1 − remainingFraction) × 100)`, `isActive` hanya untuk bucket yang habis (API tak
   punya padanan `is_active`). Bentuk tak dikenali → kosong → `stale`/`unavailable`, tak pernah angka
   karangan.
3. **Permukaan:** `GET /api/limits/antigravity` (bacaan global lewat prefix `limits`), tool MCP
   `hanoman_limits_antigravity` (read, tanpa capability), grup siar `antigravityLimits` (30 dtk; cache
   service 60 dtk, timeout 5 dtk), dan pil top bar + strip Scheduler berpenanda belah ketupat yang
   disembunyikan saat `unavailable` (cermin pil Codex).
4. **Opt-out:** knob registry `HANOMAN_ANTIGRAVITY_LIMITS_FETCH` (default `1`). `0` = hanoman tak
   menyentuh Keychain agy sama sekali. Config vitest server mematoknya `0` supaya test di mesin operator
   tak membaca kredensial asli dan memanggil Google.
5. **Hanya macOS.** Di platform lain go-keyring memakai secret-service atau berkas yang lokasinya belum
   diverifikasi → `unavailable`, dinyatakan alih-alih ditebak.

## Alternatif yang ditolak

- **Badge status saja (tanpa angka).** Aman, tapi tak menjawab "berapa sisa kuota".
- **RPC language server lokal agy (`GetUserStatus`).** Hanya ada selagi agy berjalan, butuh token CSRF
  dari argv prosesnya — lebih rapuh daripada endpoint yang dipanggil agy sendiri.
- **Me-refresh token sendiri supaya selalu segar.** Merebut refresh token milik agy; risiko me-logout CLI.
- **Menunggu perintah usage resmi.** Ditunda tanpa batas waktu; operator memilih opsi ini secara sadar.

## Konsekuensi

- Endpoint `v1internal` internal dan tak terdokumentasi: bila Google mengubahnya, pil menghilang
  (`unavailable`) atau menandai `lama` — tidak salah tampil.
- Tanpa agy berjalan dalam ±1 jam terakhir, angkanya `stale`; footnote popover menyatakannya.
- Panel "Bensin" Overview (ADR-0220) belum memakai sumber ini — lanjutan terpisah.
- Implementasi: `server/src/services/antigravity-limits.ts`, `server/src/routes/limits.ts`,
  `server/src/services/events.ts`, `shared/src/{dto,config-registry}.ts`, `shared/src/mcp-catalog/system.ts`,
  `src/src/api/antigravity-limits.ts`, `src/src/screens/LimitIndicator.tsx`; test
  `server/test/antigravity-limits.test.ts`, `src/test/antigravity-limit-badge.test.tsx`.
