# ADR-0234 — Multi-akun runtime (Claude Code, Codex, Antigravity)

**Status:** aktif (2026-11-01). **Memperluas** ADR-0074 (dua agen + limit codex), ADR-0224 (limit
Antigravity), ADR-0039/0145 (grup siar baru `accountLimits`). **Menegakkan** ADR-0117 (sandbox) dan
ADR-0202 (keputusan MCP).
Desain: [`docs/superpowers/specs/2026-11-01-runtime-multi-akun-design.md`](../../../docs/superpowers/specs/2026-11-01-runtime-multi-akun-design.md) ·
plan: [`docs/superpowers/plans/2026-11-01-runtime-multi-akun.md`](../../../docs/superpowers/plans/2026-11-01-runtime-multi-akun.md).

## Konteks

Operator punya beberapa akun langganan per runtime. Pindah akun berarti logout/login ulang di CLI, dan
itu mengganti akun untuk SEMUA sesi di mesin. Operator ingin mendaftarkan akun di hanoman, memilihnya per
runtime dan per sesi, dan melihat limit tiap akun — dengan skills dan konfigurasi lain tetap sama.

## Keputusan

1. **Home terisolasi per akun.** Akun non-bawaan = direktori `$HANOMAN_HOME/accounts/<runtime>/<id>`
   (0700) yang disuntik ke sesi sebagai `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. Aset bersama disymlink ke
   home bawaan: claude `skills/ plugins/ agents/ commands/ hooks/ output-styles/ settings.json CLAUDE.md
   projects/`, codex `config.toml skills/ plugins/ AGENTS.md hooks.json prompts/ rules/`. Entri yang sudah
   bukan symlink ke home bawaan dilaporkan sebagai **drift** dan tak pernah ditimpa. Kunci `.claude.json`
   bawaan yang relevan (`mcpServers`, status onboarding, tema, `projects`) disalin ke akun tiap launch,
   karena `.claude.json` sendiri memuat identitas akun dan tak bisa dibagi.
2. **Akun bawaan tak punya baris**; id tetap `default:<runtime>`, label `Default`. Instalasi tanpa akun
   tambahan berperilaku persis seperti sebelumnya.
3. **Model `RuntimeAccount`** (LOCAL-only, tanpa kredensial) + **`SessionHistory.accountId`**. Default per
   runtime di `Setting.accounts`, hanya ditulis `PUT /api/runtime-accounts/default`; `PUT /settings`
   mempertahankan nilai tersimpan (pola `remoteControl`).
4. **Resolusi di `createSession` lewat resolver sinkron** yang didaftarkan `installRuntimeAccounts()`
   (snapshot memori; cermin `registerSessionHooks`). `pty.ts` tetap nol dependensi DB, dan ke-12 pemanggil
   `createSession` tercakup sekaligus. Akun dipatok di tmux `@hanoman_account`. Sesi otomatis memakai default
   runtime; default yang tak `aktif` jatuh ke akun bawaan + peringatan. Untuk akun non-bawaan claude,
   `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` dilepas karena keduanya mengalahkan config dir.
5. **Resume:** auto-resume (ADR-0169) dan "Mulai lagi" dari riwayat memakai akun yang sama; akun yang sudah
   dihapus → auto-resume gagal dengan alasan, tidak pindah akun diam-diam. Start manual boleh memilih akun
   lain: kelanjutan sesi hanoman berjalan dari artefak, bukan riwayat percakapan CLI.
6. **Sandbox production hanya akun bawaan** (`409 account-sandbox-unsupported`): direktori kredensial sandbox
   global per proses dan di-mount read-only.
7. **Limit per akun** dari sumber yang sama dengan limit bawaan, tanpa refresh token. `GET /limits/accounts`
   + grup siar `accountLimits`. `AccountLimitsDTO` **tanpa email** karena `/limits/*` adalah GLOBAL_READ;
   identitas hanya di `GET /runtime-accounts` (`settings:read`). Grup lama `limits`/`codexLimits`/
   `antigravityLimits` tetap ada untuk klien lama.
8. **Antigravity: mode tukar eksklusif** (hanya macOS). Login agy hidup di Keychain ber-nama tetap, jadi
   akun = slot terenkripsi `slot.enc` (secret-box) berisi isi Keychain `gemini`/`antigravity` dan berkas
   `antigravity-oauth-token`. Satu akun aktif per mesin (`accounts/antigravity/active`); menukar ditolak
   `409 antigravity-account-busy` selama sesi agy (termasuk sesi login agy) masih hidup. Token hasil refresh
   agy ditangkap kembali ke slot akun aktif setiap kali sesi ditutup. Rahasia ditulis ke Keychain lewat
   stdin `security -i`, bukan argv.
9. **MCP:** `hanoman_runtime_accounts_list` (settings:read), `hanoman_runtime_account_default_set`
   (settings:write), `hanoman_limits_accounts` (GLOBAL_READ), parameter `account` di
   `hanoman_session_create`. Buat/ubah/hapus/login/periksa akun COOKIE_ONLY (dicatat di `UNWRAPPED`).

## Hasil spike (2026-11-01)

- **Codex 0.165.0:** `CODEX_HOME=<akun> codex mcp add …` menulis LEWAT symlink `config.toml` — symlink
  bertahan, isi berubah di berkas bawaan. `config.toml` aman dibagi.
- **Claude Code 2.1.316:** fungsi `K2()` di biner membentuk service Keychain
  `` `Claude Code${OAUTH_FILE_SUFFIX}-credentials${CLAUDE_CONFIG_DIR ? "-" + sha256(configDir).hex.slice(0, 8) : ""}` ``
  (dengan `CLAUDE_SECURESTORAGE_CONFIG_DIR` sebagai override), akun Keychain `$USER`. Rumus
  `claudeKeychainService()` cocok. `claude auth login --claudeai` dan `claude auth status --json`
  (`loggedIn`, `email`, `subscriptionType`) tersedia — dipakai untuk login & probe.
- **Antigravity 1.4.12:** `ANTIGRAVITY_GEMINI_DIR` tak berefek, flag tersembunyi `--gemini_dir=<dir>`
  memindahkan data (config, percakapan, cache) tetapi `agy -p` di direktori kosong tetap login lewat Keychain
  bersama. `AGY_ACCOUNT` hanya untuk akun plugin. Tak ada isolasi login per direktori → keputusan 8.
- Dialog sesi pertama claude di config dir baru: diverifikasi pada uji manual akhir (lihat di bawah).

## Konsekuensi

- Sesi paralel beda akun mungkin untuk claude & codex; agy satu akun aktif per mesin.
- Akun menganggur: limit `stale` (token kedaluwarsa) atau `unavailable`; window yang resetnya sudah lewat
  ditampilkan "sudah reset" di UI.
- Saat akun agy non-bawaan aktif, grup lama `antigravityLimits` mencerminkan akun aktif itu; limit akun
  bawaan dibaca dari slotnya di `accountLimits`.
- Pembaca transkrip (`agent-invocations.ts`) menerima path di bawah `$HANOMAN_HOME/accounts`.
