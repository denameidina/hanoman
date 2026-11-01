# Multi-akun runtime (Claude Code, Codex, Antigravity) — desain

**Tanggal:** 2026-11-01 · **Status:** disetujui operator (brainstorming 2026-11-01) · **ADR:** ADR-0234
(ditulis bersama implementasi, memuat hasil spike).

## Konteks & keputusan

Operator punya beberapa akun langganan di tiap runtime. Saat ini pindah akun berarti logout/login ulang
di CLI-nya, dan itu mengganti akun untuk **semua** sesi di mesin. Operator ingin mendaftarkan akun di
hanoman sekali, lalu memilih akun per runtime dan per sesi. Selain login, semuanya (skills, plugins,
settings, hooks, MCP, instruksi global) harus tetap sama. Limit tiap akun juga harus terlihat.

Yang sudah ada dan dipakai ulang:

- Limit claude: token OAuth hidup (Keychain `Claude Code-credentials` / `$CLAUDE_CONFIG_DIR/.credentials.json`)
  → `https://api.anthropic.com/api/oauth/usage`, TTL 30 dtk, tanpa refresh token (`server/src/services/limits.ts`).
- Limit codex: snapshot `rate_limits` dari rollout `$CODEX_HOME/sessions/**`, tanpa jaringan, `stale` >12 jam
  (`server/src/services/codex-limits.ts`).
- Limit agy: token Keychain `gemini`/`antigravity` → `v1internal:retrieveUserQuotaSummary`, hanya macOS
  (`server/src/services/antigravity-limits.ts`).
- Perakitan env sesi di `server/src/services/pty.ts` (`envPairs`, `unsets`, `agentEnvironment`), agen sesi
  disimpan di tmux `@hanoman_agent`, riwayat di `SessionHistory`.
- Form picker Start dan Sesi baru berbagi katalog `src/src/screens/session-runtime.ts`.
- Pola "server merakit perintah, klien tak pernah mengirim teks perintah" dari install metode (SPEC-739).
- `services/secret-box.ts` untuk menyimpan rahasia terenkripsi.

Temuan riset yang menentukan desain:

- Claude Code mengisolasi login lewat `CLAUDE_CONFIG_DIR`. Di macOS, entri Keychain-nya ikut terpisah
  (nama service diberi suffix turunan path config dir; diverifikasi di spike).
- Codex mengisolasi login lewat `CODEX_HOME` (`auth.json`, `sessions/` per direktori).
- agy (1.4.12) menyimpan login di Keychain dengan nama **tetap** (`gemini`/`antigravity`), tak bergantung
  pada direktori. `AGY_ACCOUNT` hanya untuk akun plugin (gh dsb.), bukan login utama.
- `claude setup-token` hanya ber-scope inference (endpoint usage kemungkinan menolak), API key codex
  berarti tagihan API. Keduanya tak memenuhi kebutuhan limit langganan per akun.

Keputusan operator (brainstorming):

1. Akun dipilih di **dua tempat**: default per runtime (Settings) dan per sesi (picker Start / form Sesi baru).
2. Saat limit akun hampir/sudah habis, hanoman **hanya menandai**. Tak ada pemilihan atau rotasi otomatis.
3. agy: bila isolasi per direktori tak terbukti di spike, pakai **mode tukar eksklusif** (satu akun agy
   aktif per mesin; Start ditolak bila ada sesi agy hidup dengan akun lain).
4. Mekanisme diserahkan ke desain ini, dengan syarat skills dan konfigurasi lain tetap sama antar akun.

## Objective

Operator menambah akun langganan untuk tiap runtime lewat dashboard, memilih akun mana yang dipakai
(default per runtime dan per sesi), menjalankan beberapa sesi paralel dengan akun berbeda, dan melihat
limit setiap akun, tanpa pernah logout/login ulang di CLI dan tanpa perbedaan skills/konfigurasi.

Kriteria sukses:

- Dua sesi claude berjalan paralel dengan akun berbeda; `/status` di masing-masing menampilkan email berbeda.
  Sama untuk codex.
- Skill yang dipasang di `~/.claude/skills` (atau `~/.codex/skills`) terbaca di sesi akun mana pun tanpa
  langkah tambahan.
- Popover limit menampilkan window limit setiap akun terdaftar per runtime.
- Instalasi tanpa akun tambahan tak melihat perubahan apa pun di picker Start / Sesi baru.
- Resume sesi (manual dan otomatis ADR-0169) memakai akun yang sama dengan saat sesi lahir.

## Pendekatan

Dipilih **A. Home terisolasi per akun + symlink bersama**. Setiap akun punya direktori sendiri yang
dijadikan `CLAUDE_CONFIG_DIR` / `CODEX_HOME`; isinya symlink ke aset bersama di home bawaan, sedangkan
kredensial, riwayat, dan rollout milik akun.

Ditolak:

- **B. Tukar kredensial untuk semua runtime** (home tetap satu, token ditukar sebelum launch). Hanya satu
  akun aktif per runtime sehingga sesi paralel beda akun mustahil, dan refresh token yang diputar sesi
  berjalan membuat blob simpanan basi. Dipakai **hanya** untuk agy, dan hanya bila spike gagal.
- **C. Token via env** (`claude setup-token`, API key codex). Scope token tak menjangkau endpoint usage,
  dan API key bukan langganan.

## Arsitektur

### 1. Model data & penyimpanan

Model baru `RuntimeAccount` (migration + ADR-0234):

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | String @id | |
| `runtime` | String | `claude` \| `codex` \| `antigravity` |
| `label` | String | nama pilihan operator, unik per runtime |
| `homeDir` | String? | `$HANOMAN_HOME/accounts/<runtime>/<id>`; null untuk mode tukar agy |
| `identity` | Json? | `{ email?, plan? }` hasil baca lokal, hanya untuk tampilan |
| `secretRef` | String? | khusus mode tukar agy: kunci blob terenkripsi `secret-box` |
| `status` | String | `belum-login` \| `aktif` \| `perlu-login-ulang` (cache; diturunkan ulang saat dibaca) |
| `createdAt`, `lastLoginAt` | DateTime | |

- **Akun bawaan "Default"** tidak disimpan sebagai baris. Ia adalah home bawaan (`~/.claude`, `~/.codex`,
  Keychain agy) dan disintesis di lapis layanan dengan id tetap `default:<runtime>`. Tak bisa dihapus.
- **Default per runtime** di `Setting` (kolom Json, tanpa migration tambahan):
  `accounts: { claude?: string, codex?: string, antigravity?: string }`. Absen = `default:<runtime>`.
- `SessionHistory` mendapat kolom `accountId String?` (null = baris lama / akun bawaan).
- **LOCAL-only**: `RuntimeAccount` tak masuk `SYNCED`/`FIELDS` sync, sama seperti `LocalBinding`. Kredensial
  tak pernah masuk DB (kecuali blob terenkripsi mode tukar agy) dan tak pernah dikirim ke klien.
- Direktori akun dibuat `0700`.

### 2. Isi direktori akun

| Runtime | Disymlink ke home bawaan | Milik akun |
|---|---|---|
| claude | `skills/` `plugins/` `agents/` `commands/` `hooks/` `output-styles/` `settings.json` `CLAUDE.md` `projects/` | kredensial (Keychain ber-suffix / `.credentials.json`), `.claude.json` |
| codex | `config.toml` `skills/` `plugins/` `AGENTS.md` `hooks.json` `prompts/` `rules/` | `auth.json`, `sessions/`, `history.jsonl`, `goals_1.sqlite`, log, cache |

- `projects/` claude dibagi supaya memori project dan transkrip tetap satu tempat.
- `config.toml` codex dibagi, jadi entri trust yang ditulis `codex-trust.ts` berlaku untuk semua akun.
- `mcpServers` claude hidup di `.claude.json` yang tak bisa dibagi (memuat identitas akun). Setiap launch,
  hanoman menyalin kunci `mcpServers` dari `~/.claude.json` ke `.claude.json` akun (tulis atomik, kunci
  lain tak disentuh).
- `ensureAccountHome(account)` dipanggil sebelum setiap launch dan setelah akun dibuat. Idempoten:
  - symlink hilang → dipasang;
  - target belum ada di home bawaan → dilewati, dipasang di launch berikutnya bila sudah ada;
  - entri sudah berupa berkas/direktori biasa (CLI menulis atomik dan memutus symlink) → **tak ditimpa**.
    Akun ditandai `drift: [path…]` dan dashboard menampilkan peringatan. Launch tetap jalan.

### 3. Tambah akun & login

Settings → Runtime → panel **Akun** per runtime.

1. **Tambah akun** → label → `POST /api/runtime-accounts` membuat baris + direktori + symlink.
2. `POST /api/runtime-accounts/:id/login` membuka **sesi terminal login** di tab Terminal. Perintahnya
   dirakit server dari katalog per runtime:
   - claude: `claude` dengan `CLAUDE_CONFIG_DIR=<homeDir>` (TUI first-run → `/login`). Spike memastikan
     apakah ada subcommand login non-TUI yang lebih bersih.
   - codex: `codex login` dengan `CODEX_HOME=<homeDir>`. Opsi `--device-auth` saat hanoman diakses jarak jauh.
   - agy: sesuai hasil spike (lihat §6).
3. Saat pane login keluar, atau saat tombol **Periksa** ditekan, server membaca identitas secara lokal tanpa
   jaringan: claude dari `.claude.json` (`oauthAccount`), codex dari klaim `id_token` di `auth.json`, agy dari
   `id_token_email`. Status jadi `aktif` bila kredensial terbaca.
4. Email yang sama sudah terdaftar di runtime yang sama → peringatan duplikat (tidak memblokir).
5. **Hapus akun**: konfirmasi, ditolak `409 account-in-use` bila ada sesi hidup yang memakainya. Direktori
   dihapus; untuk claude macOS, entri Keychain ber-suffix milik akun ikut dihapus.

### 4. Launch sesi

- `POST /terminal/sessions` menerima `account?: string`. Resolusi: eksplisit → `Setting.accounts[runtime]`
  → `default:<runtime>`.
- Sesi otomatis (reverse, prd, scaffold, breakdown, lead, scheduler, konflik integrasi) selalu memakai
  default runtime.
- Validasi sebelum spawn: akun ada (`404 account-not-found`), runtime cocok dengan agen
  (`409 account-runtime-mismatch`), status `aktif` (`409 account-not-logged-in`).
- Env di `pty.ts`:
  - claude akun non-bawaan: `CLAUDE_CONFIG_DIR=<homeDir>`, dan `CLAUDE_CODE_OAUTH_TOKEN` +
    `ANTHROPIC_API_KEY` di-`unset` (kalau tidak, keduanya diam-diam mengalahkan pilihan akun).
  - codex akun non-bawaan: `CODEX_HOME=<homeDir>`.
  - akun bawaan: tak ada perubahan dari perilaku sekarang.
- Akun dipatok ke sesi: tmux `@hanoman_account` (sesi hidup) + `SessionHistory.accountId` (riwayat/resume).
  Resume memakai akun yang sama. Akun sudah dihapus → resume berhenti dengan pesan, tidak pindah akun diam-diam.
- Pembaca yang dibuat sadar akun:
  - `transcriptRoots` di `agent-invocations.ts`: tambah home akun ke allowlist, dibandingkan setelah `realpath`
    (transkrip claude lewat symlink `projects/`).
  - Pembaca goal codex (`goals_1.sqlite`) memakai home akun sesi.
  - Sandbox production: direktori akun di-mount di `/agent-home` menggantikan `HANOMAN_AGENT_CREDENTIAL_DIR`,
    dengan mode mount yang sama dengan mount kredensial sekarang. Akun bawaan tetap memakai
    `HANOMAN_AGENT_CREDENTIAL_DIR`. agy tetap tak didukung di sandbox (`assertAntigravityLaunch`).

### 5. Limit per akun

| Runtime | Sumber per akun | Akun menganggur |
|---|---|---|
| claude | token akun (Keychain ber-suffix / `<homeDir>/.credentials.json`) → usage API, TTL 30 dtk per akun, paralel | token kedaluwarsa → `stale` |
| codex | snapshot `rate_limits` dari `<homeDir>/sessions/**` | snapshot >12 jam → `stale` |
| agy | token dari slot akun (Keychain bila aktif, blob tersimpan bila tidak) → quota API | token >±1 jam → `stale` |

- hanoman **tidak pernah me-refresh token** (aturan yang sudah berlaku).
- Window yang `resetsAt`-nya sudah lewat ditampilkan **"sudah reset"**, bukan persen lama.
- DTO baru `AccountLimitsDTO { accountId, runtime, label, identity, status, windows, fetchedAt }`.
  Grup siar baru `accountLimits` (array) di `/api/events/ws`.
- Grup lama `limits`, `codexLimits`, `antigravityLimits` tetap ada dan berisi akun default runtime masing-masing.

### 6. Antigravity

**Spike lebih dulu:** cari cara mengisolasi login agy per direktori tanpa mengganti `HOME` seluruh proses
(mis. penanda penyimpanan berkas `antigravity-oauth-token` alih-alih Keychain). Bila berhasil, agy memakai
pola §2–§4 seperti runtime lain.

Bila tidak, **mode tukar eksklusif** (hanya macOS):

- Blob token tiap akun disimpan terenkripsi lewat `secret-box` (`RuntimeAccount.secretRef`).
- Start dengan akun X: ada sesi agy hidup dengan akun lain → `409 antigravity-account-busy`. Tidak ada →
  tulis blob X ke Keychain `gemini`/`antigravity`.
- Saat sesi agy selesai, dan sebelum setiap penukaran, isi Keychain dibaca balik ke slot akun yang sedang
  aktif supaya token hasil refresh agy tak hilang.
- Login akun agy baru: penukaran ke slot kosong lalu login agy di terminal; hasilnya disimpan ke slot akun.

### 7. UI

- **Settings → Runtime, panel Akun** per runtime: label · email · plan · status · mini bar 5 jam & mingguan.
  Radio = default runtime. Menu: Login ulang, Ganti label, Hapus. Akun `drift` / `perlu-login-ulang`
  ditandai beserta alasannya.
- **Picker Start & form Sesi baru**: field **Akun** muncul setelah runtime dipilih, **hanya bila runtime itu
  punya ≥2 akun**. Opsi: label · % 5 jam · % mingguan, penanda ⚠ ≥70% dan ‼ ≥90%. Akun belum login
  dinonaktifkan dengan alasan. Pilihan awal = default runtime. Logika di `session-runtime.ts`.
- **Terminal**: chip label akun di header sesi dan daftar sesi.
- **Top bar**: badge limit tetap satu per runtime, mencerminkan akun default. Popover menampilkan semua akun.
- Mengikuti design system (`internal/docs/design-system/**`).

## API & keputusan MCP (ADR-0202)

| Route | Keputusan |
|---|---|
| `GET /api/runtime-accounts` | tool `hanoman_runtime_accounts_list` (read) |
| `PUT /api/runtime-accounts/default` `{runtime, accountId}` | tool `hanoman_runtime_account_default_set` (write) |
| `GET /api/limits/accounts` | `GLOBAL_READ` + tool `hanoman_limits_accounts` (read) |
| `POST /terminal/sessions` field `account?` | parameter opsional di tool launch sesi yang sudah ada |
| `POST /api/runtime-accounts`, `PATCH`/`DELETE /api/runtime-accounts/:id`, `POST /api/runtime-accounts/:id/login` | **COOKIE_ONLY**: pengelolaan kredensial; login butuh manusia di browser |

Respons tak pernah memuat token, isi `auth.json`, atau blob.

## Penanganan error

| Kondisi | Hasil |
|---|---|
| akun tak ada | `404 account-not-found` |
| runtime akun ≠ agen | `409 account-runtime-mismatch` |
| akun belum login / perlu login ulang | `409 account-not-logged-in` |
| agy: sesi hidup dengan akun lain | `409 antigravity-account-busy` |
| hapus akun yang dipakai sesi hidup | `409 account-in-use` |
| label duplikat dalam runtime yang sama | `409 account-label-taken` |
| symlink terputus / berkas menyimpang | launch jalan, akun ditandai `drift` |
| terminal login ditutup sebelum login | status tetap `belum-login` |
| agy di non-macOS | multi-akun agy tak tersedia (sama dengan batas limit agy) |

## Test

- **Unit**: `ensureAccountHome` (pasang, perbaiki, lewati target absen, deteksi drift) di direktori tmp;
  resolusi akun; perakitan env `pty.ts` (env disuntik, kredensial env dilepas, akun bawaan tak berubah);
  pembaca identitas dari fixture; salin `mcpServers`; limit per akun dengan deps diinjeksi, tanpa Keychain
  atau jaringan sungguhan (pola `HANOMAN_*_LIMITS_FETCH=0`); "sudah reset"; gerbang dan baca-balik mode tukar agy.
- **Route**: CRUD, set default, setiap cabang 404/409, `mcp-coverage.test.ts`.
- **Web**: field Akun tersembunyi dengan 1 akun dan tampil dengan ≥2; penanda ⚠/‼; opsi nonaktif. Berkas
  test yang me-mock `api` sebagian ditambal (jebakan SPEC-884).
- **Manual, sekali di akhir**: tambah akun claude kedua, dua sesi paralel beda akun, `/status` menampilkan
  email berbeda, popover limit menampilkan kedua akun. Boot server + curl endpoint baru.

## Urutan kerja

0. **Spike (dibatasi waktu)**: suffix Keychain claude dengan `CLAUDE_CONFIG_DIR`; perintah login claude &
   codex; apakah symlink `config.toml`/`settings.json` bertahan setelah CLI menulis; isolasi agy. Hasil di ADR-0234.
1. Model `RuntimeAccount` + `SessionHistory.accountId` + migration + ADR-0234; layanan akun (home, symlink,
   identitas, `mcpServers`); API + MCP.
2. Wiring launch: resolusi akun, env `pty.ts`, `@hanoman_account`, resume, `transcriptRoots`, goal codex,
   mount sandbox.
3. Limit per akun + grup siar `accountLimits`.
4. UI: panel Settings, picker Start / Sesi baru, chip sesi, popover limit.
5. agy (isolasi atau mode tukar eksklusif).
6. Docs di commit irisan yang menyentuhnya: `internal/docs/architecture/data-model.md`, `api-contract.md`,
   `docs/agent-integration.md`, `internal/skills/hanoman/SKILL.md`, index `internal/docs/README.md`.

## Di luar scope

- Rotasi/pemilihan akun otomatis berdasarkan limit.
- Refresh token oleh hanoman.
- Default akun per project atau per cron scheduler.
- Sync akun lintas device (hub/klien).
- Akun berbasis API key.
