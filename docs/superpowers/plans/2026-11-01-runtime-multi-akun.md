# Multi-akun runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator mendaftarkan beberapa akun langganan per runtime (Claude Code, Codex, Antigravity) di hanoman, memilih akun default per runtime dan per sesi, menjalankan sesi paralel dengan akun berbeda, dan melihat limit tiap akun.

**Architecture:** Tiap akun non-bawaan punya home sendiri `$HANOMAN_HOME/accounts/<runtime>/<id>` yang disuntik sebagai `CLAUDE_CONFIG_DIR`/`CODEX_HOME` ke sesi, berisi symlink ke aset bersama di home bawaan (skills, plugins, settings, …). Model `RuntimeAccount` (LOCAL-only) + snapshot memori melayani resolver sinkron yang didaftarkan ke `pty.createSession` (pty tetap nol dependensi DB). Limit dibaca per akun dari sumber yang sama dengan limit bawaan; Antigravity memakai mode tukar eksklusif atas slot Keychain.

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), tmux, React+Vite, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-11-01-runtime-multi-akun-design.md` · **ADR:** ADR-0234 (ditulis di Task 0).

## Global Constraints

- Bahasa komentar, pesan error, dan copy UI: **Bahasa Indonesia**, gaya repo (komentar menyebut `ADR-0234`).
- Akun bawaan tak punya baris DB; id tetap `default:<runtime>`, label `Default`. Id akun non-bawaan: 8 karakter hex huruf kecil.
- Kode error persis: `account-not-found` (404), `account-runtime-mismatch`, `account-not-logged-in`, `antigravity-account-busy`, `account-in-use`, `account-label-taken`, `account-sandbox-unsupported` (semua 409). Bentuk body: `{ error: <kode>, message: <kalimat> }`.
- Kredensial tak pernah masuk DB, respons API, atau argv proses. `AccountLimitsDTO` **tanpa email** (`/limits/*` = `GLOBAL_READ`).
- `Setting.accounts` hanya ditulis `PUT /api/runtime-accounts/default`; `PUT /settings` mempertahankan nilai tersimpan.
- Sandbox aktif (`sessionSandboxOn()`) → hanya akun bawaan.
- hanoman tak pernah me-refresh token OAuth.
- Skema hanya berubah lewat migration + ADR. Docs yang tersentuh diperbarui di commit yang sama dan ditautkan di `internal/docs/README.md`.
- Setiap API baru punya keputusan MCP di commit yang sama (tool atau entri `UNWRAPPED` beralasan).
- Git di worktree ini: pakai `/usr/bin/git` (hook rtk menulis ulang `git`). **Jangan `git add -A`** — tambahkan path eksplisit (boot server meninggalkan `hanoman-dev.db-shm/-wal`).
- Akhiri setiap pesan commit dengan baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Setelah tiap task: centang `- [ ]` → `- [x]` di berkas plan ini.
- **Perintah test server (SRV)** — env sesi hanoman wajib dilepas dan DB test diisolasi:

  ```bash
  mkdir -p /private/tmp/claude-501/-Users-denameidina-Developers-Nafanesia-hanoman/c14906f5-0ce1-4f0c-9ad7-f1ae9369845c/scratchpad/ra-test
  /usr/bin/env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u HANOMAN_SESSION_ID \
    -u HANOMAN_EVENT_URL -u HANOMAN_EVENT_TOKEN -u HANOMAN_EVENT_DIR -u HANOMAN_EVENT_HOST -u SSH_ASKPASS \
    TEST_DATABASE_URL=file:/private/tmp/claude-501/-Users-denameidina-Developers-Nafanesia-hanoman/c14906f5-0ce1-4f0c-9ad7-f1ae9369845c/scratchpad/ra-test/t.test.db \
    pnpm vitest --run <path test…> --no-file-parallelism
  ```

  Bila direktori scratchpad itu tak ada (sesi lain), pakai direktori sementara lain **di luar repo**. Ditulis "SRV `<path>`" di bawah.
- **Perintah test web/shared (WEB):** `pnpm vitest --run <path test…>`.
- Baseline gagal yang **bukan** regresi (main 0.9.37): `src/test/settings-search.test.tsx`, `server/test/pty.test.ts`, `spec-attachment-launch`, `structured-launch-admission`, `admin-surface.route`, `agent-tokens.route`, `pagination-contract`, `prd-from-audit.route`, `shared/test/agent.test.ts`. Bandingkan dengan `main` sebelum menyalahkan perubahan sendiri.

## File Structure

**shared**
- Create `shared/src/runtime-accounts.ts` — tipe, zod, id bawaan, kode error.
- Modify `shared/src/index.ts` (ekspor), `shared/src/entities.ts` (`zSetting.accounts`), `shared/src/dto.ts` (`zTerminalSession.account`, `zSessionHistory.accountId`, `EventMsg` `accountLimits`), `shared/src/api.ts` (paths), `shared/src/mcp-catalog/{settings,system,sessions}.ts`, `shared/src/mcp-catalog.team.test.ts`.

**server**
- `server/prisma/schema.prisma` + `server/prisma/migrations/20261101090000_runtime_account/migration.sql`.
- Create `server/src/services/runtime-accounts/`:
  - `paths.ts` — lokasi akar akun, home bawaan, `.claude.json` bawaan, penjaga hapus.
  - `home.ts` — symlink aset bersama, deteksi drift, mirror kunci `.claude.json`.
  - `keychain.ts` — nama service Keychain claude per config dir, baca/hapus entri.
  - `identity.ts` — probe login claude (`claude auth status --json`) & codex (`auth.json`).
  - `registry.ts` — CRUD DB, snapshot memori, default, periksa status, `AccountError`.
  - `resolver.ts` — env per akun, resolver sinkron untuk pty, validasi launch.
  - `login.ts` — perintah login & sesi terminal login.
  - `limits.ts` — limit per akun ber-cache.
  - `antigravity-swap.ts` — mode tukar eksklusif agy (Task 10).
  - `install.ts` — pemasangan saat boot.
- Create `server/src/routes/runtime-accounts.ts`.
- Modify `server/src/app.ts`, `server/src/server.ts`, `server/src/services/{pty,session-launch,session-history,session-boot-resume,session-sandbox,agent-capabilities,agent-invocations,events,limits,antigravity-limits}.ts`, `server/src/routes/{terminal,settings,limits}.ts`, `cli/src/commands/migrate-pg.ts` (`PG_ORDER`).
- Tests: `server/test/runtime-accounts-*.test.ts`, `server/test/pty-parse.test.ts`, `server/test/mcp-coverage.test.ts`.

**web**
- Create `src/src/api/account-limits.ts`, `src/src/lib/limit-reset.ts`, `src/src/screens/AccountField.tsx`, `src/src/screens/settings/RuntimeAccounts.tsx`, `src/src/screens/styles/accounts.css`, tests.
- Modify `src/src/api/client.ts`, `src/src/screens/session-runtime.ts`, `src/src/App.tsx` (dialog Start), `src/src/screens/NewTerminalModal.tsx`, `src/src/screens/TerminalScreen.tsx`, `src/src/screens/LimitIndicator.tsx`, `src/src/screens/settings/SessionSettings.tsx`.

**docs**
- Create `internal/docs/adr/0234-multi-akun-runtime.md`.
- Modify `internal/docs/README.md`, `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`, `docs/agent-integration.md`, `internal/skills/hanoman/SKILL.md`, `CLAUDE.md`.

---

### Task 0: Spike — verifikasi perilaku CLI & tulis ADR-0234

Butuh operator untuk langkah login. Hasilnya menentukan konstanta di Task 2/3 dan cabang agy di Task 10.

**Files:**
- Create: `internal/docs/adr/0234-multi-akun-runtime.md`
- Modify: `internal/docs/README.md` (baris index ADR, sesudah baris 0233)

**Interfaces:**
- Produces: nilai terverifikasi untuk `claudeKeychainService()` (Task 3), `MIRRORED_CLAUDE_KEYS` (Task 2), dan keputusan agy (Task 10).

- [x] **Step 1: Codex — apakah symlink `config.toml` bertahan saat codex menulis (otomatis)**

```bash
B=$(mktemp -d); A=$(mktemp -d)
cp ~/.codex/config.toml "$B/config.toml"
ln -s "$B/config.toml" "$A/config.toml"
CODEX_HOME="$A" codex mcp add hanoman-spike -- echo hi
test -L "$A/config.toml" && echo "SYMLINK BERTAHAN" || echo "SYMLINK PUTUS"
grep -c hanoman-spike "$B/config.toml"
rm -rf "$A" "$B"
```

Catat hasilnya. "PUTUS" tak mengubah desain (drift terdeteksi `inspectAccountHome`), tapi wajib ditulis di ADR.

- [x] **Step 2: Claude — nama service Keychain untuk `CLAUDE_CONFIG_DIR` (operator login akun kedua)**

```bash
D="$HOME/.hanoman/accounts/claude/spike0000"; mkdir -p "$D"
CLAUDE_CONFIG_DIR="$D" claude auth login --claudeai      # operator menyelesaikan OAuth di browser
security dump-keychain | grep -o '"svce"<blob>="Claude Code-credentials[^"]*"' | sort -u
node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,8))' "$D"
CLAUDE_CONFIG_DIR="$D" claude auth status --json
```

Expected: ada service `Claude Code-credentials-<8hex>` dan `<8hex>` = keluaran `node`. Bila berbeda, catat rumus yang benar. Task 3 Step 3 menyesuaikan `claudeKeychainService()`.

- [x] **Step 3: Claude — dialog apa yang muncul di sesi pertama config dir baru**

```bash
python3 -I -c "import json,os;d=json.load(open(os.path.expanduser('~/.claude.json')));print(sorted(k for k in d if k in ('mcpServers','hasCompletedOnboarding','lastOnboardingVersion','theme','bypassPermissionsModeAccepted','projects')))"
CLAUDE_CONFIG_DIR="$D" claude --dangerously-skip-permissions
```

Catat setiap dialog yang muncul sebelum prompt (onboarding/tema/bypass/trust) dan kunci `~/.claude.json` mana yang menekannya. Daftar akhirnya menjadi `MIRRORED_CLAUDE_KEYS` (Task 2). Bersihkan: `CLAUDE_CONFIG_DIR="$D" claude auth logout; rm -rf "$D"`.

- [x] **Step 4: Antigravity — cari isolasi per direktori (batas 30 menit)**

```bash
AGY=$(readlink -f ~/.local/bin/agy)
strings -n 6 "$AGY" | grep -nE "DefaultKeyringMarkerPath|KeyringTokenStorage|antigravity-oauth-token" | head
```

Uji: dengan `HOME` sementara, apakah agy memakai berkas `antigravity-oauth-token` alih-alih Keychain. Bila tak ditemukan cara bersih dalam 30 menit, keputusan = **mode tukar eksklusif** (Task 10 apa adanya). Bila ditemukan, Task 10 diganti spec lanjutan; catat di ADR.

- [x] **Step 5: Tulis ADR-0234**

Buat `internal/docs/adr/0234-multi-akun-runtime.md`:

```markdown
# ADR-0234 — Multi-akun runtime (Claude Code, Codex, Antigravity)

**Status:** aktif (2026-11-01). **Memperluas** ADR-0074 (dua agen + limit codex), ADR-0224 (limit
Antigravity), ADR-0039/0145 (grup siar baru `accountLimits`). **Menegakkan** ADR-0117 (sandbox) dan
ADR-0202 (keputusan MCP).
Desain: [`docs/superpowers/specs/2026-11-01-runtime-multi-akun-design.md`](../../../docs/superpowers/specs/2026-11-01-runtime-multi-akun-design.md) ·
plan: [`docs/superpowers/plans/2026-11-01-runtime-multi-akun.md`](../../../docs/superpowers/plans/2026-11-01-runtime-multi-akun.md).

## Konteks

Operator punya beberapa akun langganan per runtime. Pindah akun berarti logout/login ulang di CLI, dan
itu mengganti akun untuk semua sesi di mesin.

## Keputusan

1. Satu akun non-bawaan = satu home `$HANOMAN_HOME/accounts/<runtime>/<id>` (0700) yang disuntik
   sebagai `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. Aset bersama (skills, plugins, settings, hooks,
   instruksi global, `projects/` claude, `config.toml` codex) disymlink ke home bawaan; entri yang
   sudah bukan symlink tak ditimpa — dilaporkan sebagai drift.
2. Akun bawaan tak punya baris; id `default:<runtime>`.
3. Model `RuntimeAccount` LOCAL-only + `SessionHistory.accountId`. Default per runtime di
   `Setting.accounts`, hanya ditulis `PUT /api/runtime-accounts/default`.
4. Resolusi akun di `createSession` lewat resolver sinkron yang didaftarkan layanan akun (snapshot
   memori), cermin `registerSessionHooks`.
5. Sandbox production hanya akun bawaan (`account-sandbox-unsupported`).
6. Limit per akun, tanpa refresh token; `AccountLimitsDTO` tanpa email karena `/limits/*` GLOBAL_READ.
7. Antigravity: <isi dari Step 4 — "mode tukar eksklusif" atau temuan isolasi>.
8. MCP: `hanoman_runtime_accounts_list` (settings:read), `hanoman_runtime_account_default_set`
   (settings:write), `hanoman_limits_accounts` (GLOBAL_READ), parameter `account` di
   `hanoman_session_create`; buat/ubah/hapus/login/periksa COOKIE_ONLY.

## Hasil spike (2026-11-01)

- Codex symlink `config.toml`: <BERTAHAN | PUTUS>.
- Keychain claude: service `<nama terukur>`; rumus `sha256(configDir)[0:8]` <cocok | diganti …>.
- Dialog sesi pertama claude & kunci penekannya: <daftar>.
- Antigravity: <ringkasan>.

## Konsekuensi

- Sesi paralel beda akun mungkin untuk claude & codex; agy satu akun aktif per mesin.
- Akun menganggur: limit `stale` (token kedaluwarsa); window yang resetnya lewat ditampilkan "sudah reset".
```

Ganti setiap `<…>` dengan hasil Step 1–4 (jangan biarkan placeholder).

- [x] **Step 6: Tautkan di index**

Di `internal/docs/README.md`, sesudah baris `- [0233 — Fase Mockup …](…)`, tambahkan:

```markdown
- [0234 — Multi-akun runtime (Claude Code, Codex, Antigravity)](adr/0234-multi-akun-runtime.md)
```

(Salin bentuk tautan persis dari baris 0233 di atasnya bila awalan path-nya berbeda.)

- [x] **Step 7: Commit**

```bash
/usr/bin/git add internal/docs/adr/0234-multi-akun-runtime.md internal/docs/README.md docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "docs(adr): ADR-0234 multi-akun runtime + hasil spike

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Kontrak shared + skema DB

**Files:**
- Create: `shared/src/runtime-accounts.ts`, `server/prisma/migrations/20261101090000_runtime_account/migration.sql`, `server/test/runtime-accounts-settings.test.ts`
- Modify: `shared/src/index.ts`, `shared/src/entities.ts:475-523`, `shared/src/dto.ts` (`zSessionHistory` ±:41, `zTerminalSession` :473-500, `EventMsg` :892, `AntigravityLimitsDTO` sekitar :733), `shared/src/api.ts`, `server/prisma/schema.prisma`, `server/src/routes/settings.ts:44-48`, `cli/src/commands/migrate-pg.ts` (`PG_ORDER`), `internal/docs/architecture/data-model.md`

**Interfaces:**
- Produces (dipakai semua task berikut):
  - `type RuntimeName = "claude" | "codex" | "antigravity"`
  - `type RuntimeAccountStatus = "belum-login" | "aktif" | "perlu-login-ulang"`
  - `builtinAccountId(runtime): string`, `isBuiltinAccountId(id): boolean`, `runtimeOfBuiltin(id): RuntimeName | null`, `BUILTIN_ACCOUNT_LABEL = "Default"`
  - zod: `zAccountId`, `zAccountLabel`, `zRuntimeAccountCreate`, `zRuntimeAccountPatch`, `zRuntimeAccountDefault`, `zRuntimeAccountLogin`, `zRuntimeAccountDefaults`
  - `type RuntimeAccountIdentity = { email?: string; plan?: string }`
  - `type RuntimeAccountDTO`, `type RuntimeAccountsListDTO = { accounts: RuntimeAccountDTO[]; sandbox: boolean }`, `type AccountLimitsDTO`, `type AccountErrorCode`
  - `Setting.accounts: { claude?: string; codex?: string; antigravity?: string }`
  - Prisma `RuntimeAccount { id, runtime, label, homeDir, identity Json?, status, createdAt, lastLoginAt? }`, `SessionHistory.accountId String?`
  - paths: `paths.runtimeAccounts`, `paths.runtimeAccount(id)`, `paths.runtimeAccountsDefault`, `paths.runtimeAccountLogin(id)`, `paths.runtimeAccountCheck(id)`, `paths.limitsAccounts`

- [x] **Step 1: Tulis test yang gagal — `PUT /settings` mempertahankan `accounts`**

Create `server/test/runtime-accounts-settings.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// ADR-0234 · `Setting.accounts` hanya ditulis PUT /runtime-accounts/default. Simpan form Settings
// (PUT /settings membawa blok utuh) tak boleh menimpa pilihan akun — pola remoteControl.
describe("Setting.accounts", () => {
  const app = buildApp({ requireAuth: false });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await prisma.setting.deleteMany(); });

  it("default {} saat belum pernah diset", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual({});
  });

  it("PUT /settings mempertahankan nilai tersimpan", async () => {
    const base = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    await prisma.setting.upsert({ where: { id: 1 }, update: { data: { ...base, accounts: { claude: "a1b2c3d4" } } },
      create: { id: 1, data: { ...base, accounts: { claude: "a1b2c3d4" } } } });
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: { ...base, accounts: { claude: "ffffffff" } } });
    expect(put.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(after.accounts).toEqual({ claude: "a1b2c3d4" });
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: SRV `server/test/runtime-accounts-settings.test.ts`
Expected: FAIL — `accounts` undefined (zod membuang kunci tak dikenal).

- [x] **Step 3: Buat `shared/src/runtime-accounts.ts`**

```ts
import { z } from "zod";
import { zAgent } from "./enums";
import type { LimitsDTO } from "./dto";

// ADR-0234 · multi-akun runtime. Satu "akun runtime" = satu login langganan claude/codex/antigravity
// di mesin ini. Akun bawaan (home bawaan CLI) TIDAK punya baris DB: id tetap `default:<runtime>`.
export type RuntimeName = z.infer<typeof zAgent>;

export const RUNTIME_ACCOUNT_STATUSES = ["belum-login", "aktif", "perlu-login-ulang"] as const;
export type RuntimeAccountStatus = (typeof RUNTIME_ACCOUNT_STATUSES)[number];

export const BUILTIN_ACCOUNT_PREFIX = "default:";
export const BUILTIN_ACCOUNT_LABEL = "Default";
export const builtinAccountId = (runtime: RuntimeName): string => `${BUILTIN_ACCOUNT_PREFIX}${runtime}`;
export const isBuiltinAccountId = (id: string): boolean => id.startsWith(BUILTIN_ACCOUNT_PREFIX);
export function runtimeOfBuiltin(id: string): RuntimeName | null {
  if (!isBuiltinAccountId(id)) return null;
  const r = zAgent.safeParse(id.slice(BUILTIN_ACCOUNT_PREFIX.length));
  return r.success ? r.data : null;
}

export const zAccountId = z.string().min(1).max(80);
export const zAccountLabel = z.string().trim().min(1).max(40);
export const zRuntimeAccountCreate = z.object({ runtime: zAgent, label: zAccountLabel }).strict();
export const zRuntimeAccountPatch = z.object({ label: zAccountLabel }).strict();
export const zRuntimeAccountDefault = z.object({ runtime: zAgent, accountId: zAccountId }).strict();
export const zRuntimeAccountLogin = z.object({ deviceAuth: z.boolean().optional() }).strict();

/** `Setting.accounts` — default akun per runtime, LOCAL per mesin. Absen = akun bawaan. */
export const zRuntimeAccountDefaults = z.object({
  claude: zAccountId.optional(), codex: zAccountId.optional(), antigravity: zAccountId.optional(),
});
export type RuntimeAccountDefaults = z.infer<typeof zRuntimeAccountDefaults>;

export type RuntimeAccountIdentity = { email?: string; plan?: string };

/** Satu akun di `GET /api/runtime-accounts`. Memuat email → di balik `settings:read`, BUKAN GLOBAL_READ. */
export type RuntimeAccountDTO = {
  id: string; runtime: RuntimeName; label: string; builtin: boolean; isDefault: boolean;
  status: RuntimeAccountStatus; identity: RuntimeAccountIdentity | null;
  /** Entri bersama yang sudah bukan symlink ke home bawaan. Kosong = sehat. */
  drift: string[];
  createdAt: string | null; lastLoginAt: string | null;
};
export type RuntimeAccountsListDTO = { accounts: RuntimeAccountDTO[]; sandbox: boolean };

/** Limit satu akun. SENGAJA tanpa email: `/limits/*` GLOBAL_READ (terbaca setiap agent token). */
export type AccountLimitsDTO = {
  accountId: string; runtime: RuntimeName; label: string; builtin: boolean; isDefault: boolean;
  loginStatus: RuntimeAccountStatus; limits: LimitsDTO;
};

export const ACCOUNT_ERROR_CODES = [
  "account-not-found", "account-runtime-mismatch", "account-not-logged-in", "antigravity-account-busy",
  "account-in-use", "account-label-taken", "account-sandbox-unsupported",
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];
```

Tambahkan di `shared/src/index.ts` (di antara baris `export * from …` lain):

```ts
export * from "./runtime-accounts";
```

- [x] **Step 4: `zSetting.accounts`**

Di `shared/src/entities.ts`, impor di bagian atas:

```ts
import { zRuntimeAccountDefaults } from "./runtime-accounts";
```

Di `zSetting`, tepat sesudah baris `logRetention: zLogRetention.default(LOG_RETENTION_DEFAULTS), …`:

```ts
  // ADR-0234 · default akun runtime per mesin. LOCAL (setting tak ada di SYNCED) dan TAK ditulis
  // `PUT /settings` (routes/settings.ts mempertahankan nilai tersimpan) — pengelolanya
  // `PUT /api/runtime-accounts/default`. Absen = akun bawaan `default:<runtime>`.
  accounts: zRuntimeAccountDefaults.default({}),
```

- [x] **Step 5: `PUT /settings` mempertahankan `accounts`**

Di `server/src/routes/settings.ts`, objek `data` (±:44-48) jadi:

```ts
    const data = {
      ...runtimePreserved,
      builtinRuntimeDefaults: markRuntimeDefaultsUserEdited(before, runtimePreserved),
      remoteControl: before.remoteControl, logShipping: before.logShipping, logRetention: before.logRetention,
      // ADR-0234 · pilihan akun runtime milik PUT /runtime-accounts/default, bukan form Settings.
      accounts: before.accounts,
    };
```

- [x] **Step 6: Jalankan test, pastikan lulus**

Run: SRV `server/test/runtime-accounts-settings.test.ts`
Expected: PASS (2 test).

- [x] **Step 7: DTO, event, path**

Di `shared/src/dto.ts`:

1. Impor di atas: `import { zAccountId, type AccountLimitsDTO } from "./runtime-accounts";`
2. `zSessionHistory` — sesudah `exitCode: z.number().nullable(), transcriptBytes: z.number().nullable(),` tambahkan:
   ```ts
     // ADR-0234 · akun runtime saat sesi lahir. null/absen = akun bawaan (atau baris lama).
     accountId: z.string().nullable().optional(),
   ```
3. Varian terminal agen biasa (`project`, `flow: z.undefined()`, …) — sesudah `effort: z.string().optional(),` tambahkan `account: zAccountId.optional(),   // ADR-0234`.
4. Varian backlog (`spec`, `flow: zFlow`, …) — sesudah `agent: zAgent.optional(),` tambahkan `account: zAccountId.optional(),   // ADR-0234`.
5. `EventMsg` — sesudah baris `| { t: "antigravityLimits"; … }` tambahkan:
   ```ts
     | { t: "accountLimits"; accounts: AccountLimitsDTO[] }   // ADR-0234 · limit per akun runtime
   ```

Di `shared/src/api.ts`, sesudah `limits: \`${API}/limits\`,` tambahkan:

```ts
  // ADR-0234 · akun runtime & limit per akun.
  limitsAccounts: `${API}/limits/accounts`,
  runtimeAccounts: `${API}/runtime-accounts`,
  runtimeAccount: (id: string) => `${API}/runtime-accounts/${encodeURIComponent(id)}`,
  runtimeAccountsDefault: `${API}/runtime-accounts/default`,
  runtimeAccountLogin: (id: string) => `${API}/runtime-accounts/${encodeURIComponent(id)}/login`,
  runtimeAccountCheck: (id: string) => `${API}/runtime-accounts/${encodeURIComponent(id)}/check`,
```

- [x] **Step 8: Skema Prisma**

Di `server/prisma/schema.prisma`, dalam `model SessionHistory` sesudah `transcriptBytes Int?`:

```prisma
  // ADR-0234 · akun runtime saat sesi lahir (`RuntimeAccount.id` atau `default:<runtime>`). Tanpa FK:
  // riwayat bertahan sesudah akunnya dihapus. null = baris lama / akun bawaan.
  accountId       String?
```

Sesudah `model RuntimeConfig { … }`:

```prisma
// ADR-0234 · akun langganan runtime (claude/codex/antigravity) di mesin ini. LOCAL-only: tak masuk
// SYNCED/FIELDS sync. Kredensial TIDAK di sini — ia hidup di `homeDir` (atau Keychain macOS).
// Akun bawaan tak punya baris: id tetap `default:<runtime>`.
model RuntimeAccount {
  id          String    @id
  runtime     String
  label       String
  homeDir     String
  identity    Json?
  status      String    @default("belum-login")
  createdAt   DateTime  @default(now())
  lastLoginAt DateTime?

  @@unique([runtime, label])
}
```

- [x] **Step 9: Migration**

```bash
mkdir -p server/prisma/migrations/20261101090000_runtime_account
cd server && pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:/private/tmp/claude-501/-Users-denameidina-Developers-Nafanesia-hanoman/c14906f5-0ce1-4f0c-9ad7-f1ae9369845c/scratchpad/ra-test/shadow.db" \
  --script > prisma/migrations/20261101090000_runtime_account/migration.sql; cd ..
cat server/prisma/migrations/20261101090000_runtime_account/migration.sql
```

Expected isi (urutan boleh beda; tak boleh ada perubahan tabel lain):

```sql
-- AlterTable
ALTER TABLE "SessionHistory" ADD COLUMN "accountId" TEXT;

-- CreateTable
CREATE TABLE "RuntimeAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runtime" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "homeDir" TEXT NOT NULL,
    "identity" JSONB,
    "status" TEXT NOT NULL DEFAULT 'belum-login',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeAccount_runtime_label_key" ON "RuntimeAccount"("runtime", "label");
```

Lalu `pnpm db:generate`.

- [x] **Step 10: `PG_ORDER`**

`cli/test/migrate-pg.test.ts` menuntut `PG_ORDER` = seluruh model DMMF. Di `cli/src/commands/migrate-pg.ts`, sesudah baris `"RuntimeConfig", "LeadFlow", "LeadDecision",` tambahkan:

```ts
  // ADR-0234 · LOCAL-only; sumber Postgres lama tak punya tabel ini → jalur 42P01 = nol baris.
  "RuntimeAccount",
```

- [x] **Step 11: Dokumentasi data model**

Di `internal/docs/architecture/data-model.md`, pada daftar model pendukung LOCAL-only (baris yang menyebut `LocalBinding, SyncOutbox, …, RuntimeConfig`), tambahkan `**RuntimeAccount**` (ADR-0234), dan satu paragraf:

```markdown
**`RuntimeAccount`** (ADR-0234) — akun langganan runtime di mesin ini: `runtime`, `label` (unik per
runtime), `homeDir` (`$HANOMAN_HOME/accounts/<runtime>/<id>`), `identity` `{email?, plan?}` untuk
tampilan, `status` `belum-login|aktif|perlu-login-ulang`. LOCAL-only, tanpa kredensial. Akun bawaan
tak punya baris (`default:<runtime>`). `SessionHistory.accountId` mencatat akun saat sesi lahir.
Default per runtime di `Setting.accounts`.
```

- [x] **Step 12: Verifikasi**

Run: SRV `server/test/runtime-accounts-settings.test.ts cli/test/migrate-pg.test.ts server/test/sync-parents-dmmf.test.ts`
Expected: PASS.
Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: tanpa error.

- [x] **Step 13: Commit**

```bash
/usr/bin/git add shared/src/runtime-accounts.ts shared/src/index.ts shared/src/entities.ts shared/src/dto.ts shared/src/api.ts \
  server/prisma/schema.prisma server/prisma/migrations/20261101090000_runtime_account server/src/routes/settings.ts \
  server/test/runtime-accounts-settings.test.ts cli/src/commands/migrate-pg.ts internal/docs/architecture/data-model.md \
  docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): kontrak shared, model RuntimeAccount, Setting.accounts (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Home akun — symlink bersama, drift, mirror `.claude.json`

**Files:**
- Create: `server/src/services/runtime-accounts/paths.ts`, `server/src/services/runtime-accounts/home.ts`, `server/test/runtime-accounts-home.test.ts`

**Interfaces:**
- Consumes: `RuntimeName` (Task 1); `resolveHome`, `agentSkillHome` dari `@hanoman/runner`.
- Produces:
  - `accountsRoot(env?): string`, `accountHomeDir(runtime, id, env?): string`, `baseHome(runtime, env?): string`, `baseClaudeJson(env?, osHome?): string`, `insideAccountsRoot(path, env?): boolean`
  - `SHARED_ENTRIES: Record<RuntimeName, readonly string[]>`, `MIRRORED_CLAUDE_KEYS: readonly string[]`
  - `inspectAccountHome(runtime, homeDir, base?): string[]` (drift)
  - `ensureAccountHome(runtime, homeDir, base?): { linked: string[]; drift: string[] }`
  - `mirrorClaudeJson(accountHome, baseJsonPath?): void`
  - `prepareAccountHome(runtime, homeDir): { linked: string[]; drift: string[] }`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/runtime-accounts-home.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAccountHome, inspectAccountHome, mirrorClaudeJson } from "../src/services/runtime-accounts/home";

let root: string, base: string, acct: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ra-home-"));
  base = join(root, "base"); acct = join(root, "acct");
  mkdirSync(join(base, "skills"), { recursive: true });
  writeFileSync(join(base, "settings.json"), "{}");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("ensureAccountHome", () => {
  it("membuat home 0700 dan symlink entri bersama yang ADA di home bawaan", () => {
    const r = ensureAccountHome("claude", acct, base);
    expect(statSync(acct).mode & 0o777).toBe(0o700);
    expect(r.linked.sort()).toEqual(["settings.json", "skills"]);
    expect(readlinkSync(join(acct, "skills"))).toBe(join(base, "skills"));
    expect(existsSync(join(acct, "plugins"))).toBe(false);   // target belum ada → dilewati
  });

  it("idempoten: panggilan kedua tak memasang apa pun", () => {
    ensureAccountHome("claude", acct, base);
    expect(ensureAccountHome("claude", acct, base)).toEqual({ linked: [], drift: [] });
  });

  it("target yang baru muncul dipasang di panggilan berikutnya", () => {
    ensureAccountHome("claude", acct, base);
    mkdirSync(join(base, "plugins"));
    expect(ensureAccountHome("claude", acct, base).linked).toEqual(["plugins"]);
  });

  it("berkas biasa yang menggantikan symlink = drift, TIDAK ditimpa", () => {
    ensureAccountHome("claude", acct, base);
    unlinkSync(join(acct, "settings.json"));
    writeFileSync(join(acct, "settings.json"), '{"milik":"cli"}');
    const r = ensureAccountHome("claude", acct, base);
    expect(r.drift).toEqual(["settings.json"]);
    expect(readFileSync(join(acct, "settings.json"), "utf8")).toBe('{"milik":"cli"}');
    expect(inspectAccountHome("claude", acct, base)).toEqual(["settings.json"]);
  });

  it("symlink ke tempat lain = drift", () => {
    mkdirSync(acct, { recursive: true });
    symlinkSync(join(root, "lain"), join(acct, "skills"));
    expect(ensureAccountHome("claude", acct, base).drift).toEqual(["skills"]);
    expect(lstatSync(join(acct, "skills")).isSymbolicLink()).toBe(true);
  });

  it("codex memakai daftar entrinya sendiri", () => {
    writeFileSync(join(base, "config.toml"), "");
    expect(ensureAccountHome("codex", acct, base).linked.sort()).toEqual(["config.toml", "skills"]);
  });

  it("menghapus home akun TIDAK menghapus target symlink di home bawaan", () => {
    ensureAccountHome("claude", acct, base);
    rmSync(acct, { recursive: true, force: true });
    expect(existsSync(join(base, "skills"))).toBe(true);
    expect(existsSync(join(base, "settings.json"))).toBe(true);
  });
});

describe("mirrorClaudeJson", () => {
  it("menyalin kunci bersama dan mempertahankan kunci milik akun", () => {
    const baseJson = join(root, "base.claude.json");
    writeFileSync(baseJson, JSON.stringify({ mcpServers: { a: { command: "x" } }, hasCompletedOnboarding: true, oauthAccount: { emailAddress: "bawaan@x" } }));
    mkdirSync(acct, { recursive: true });
    writeFileSync(join(acct, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "akun@x" } }));
    mirrorClaudeJson(acct, baseJson);
    const got = JSON.parse(readFileSync(join(acct, ".claude.json"), "utf8"));
    expect(got.mcpServers).toEqual({ a: { command: "x" } });
    expect(got.hasCompletedOnboarding).toBe(true);
    expect(got.oauthAccount).toEqual({ emailAddress: "akun@x" });
    expect(statSync(join(acct, ".claude.json")).mode & 0o777).toBe(0o600);
  });

  it("berkas bawaan tak terbaca → tak menulis apa pun", () => {
    mkdirSync(acct, { recursive: true });
    mirrorClaudeJson(acct, join(root, "tidak-ada.json"));
    expect(existsSync(join(acct, ".claude.json"))).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: SRV `server/test/runtime-accounts-home.test.ts`
Expected: FAIL — modul `runtime-accounts/home` tak ada.

- [x] **Step 3: Implementasi `paths.ts`**

Create `server/src/services/runtime-accounts/paths.ts`:

```ts
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { agentSkillHome, resolveHome } from "@hanoman/runner";
import type { RuntimeName } from "@hanoman/shared";

// ADR-0234 · semua home akun di bawah `$HANOMAN_HOME/accounts` — satu batas backup/restore bersama
// data hanoman lain (SPEC-846), dan satu akar yang boleh dihapus `deleteAccount`.
export const accountsRoot = (env: NodeJS.ProcessEnv = process.env): string => join(resolveHome(env), "accounts");

export const accountHomeDir = (runtime: RuntimeName, id: string, env: NodeJS.ProcessEnv = process.env): string =>
  join(accountsRoot(env), runtime, id);

/** Home bawaan CLI = sumber aset bersama. Sama dengan akar skill (`HANOMAN_*_HOME` menang, ADR-0114). */
export const baseHome = (runtime: RuntimeName, env: NodeJS.ProcessEnv = process.env): string =>
  agentSkillHome(runtime, env);

/** `.claude.json` akun bawaan ada di HOME (bukan `~/.claude`) kecuali config dir di-override. */
export function baseClaudeJson(env: NodeJS.ProcessEnv = process.env, osHome: string = homedir()): string {
  const own = env.HANOMAN_CLAUDE_HOME?.trim() || env.CLAUDE_CONFIG_DIR?.trim();
  return own ? join(own, ".claude.json") : join(osHome, ".claude.json");
}

/** Penjaga hapus: hanya path DI DALAM `accountsRoot` yang boleh di-`rm -rf`. */
export function insideAccountsRoot(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolve(path).startsWith(resolve(accountsRoot(env)) + sep);
}
```

- [x] **Step 4: Implementasi `home.ts`**

Create `server/src/services/runtime-accounts/home.ts` (isi `MIRRORED_CLAUDE_KEYS` disesuaikan dengan hasil Task 0 Step 3):

```ts
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeName } from "@hanoman/shared";
import { baseClaudeJson, baseHome } from "./paths";

// ADR-0234 · aset yang SAMA untuk semua akun: disymlink dari home akun ke home bawaan. Yang tak
// disebut di sini (kredensial, `.claude.json`, `auth.json`, `sessions/`, riwayat, cache) milik akun.
// `projects/` claude ikut dibagi: memori project & transkrip tetap satu tempat. `config.toml` codex
// ikut dibagi: entri trust `codex-trust.ts` berlaku untuk semua akun.
export const SHARED_ENTRIES: Readonly<Record<RuntimeName, readonly string[]>> = {
  claude: ["skills", "plugins", "agents", "commands", "hooks", "output-styles", "settings.json", "CLAUDE.md", "projects"],
  codex: ["config.toml", "skills", "plugins", "AGENTS.md", "hooks.json", "prompts", "rules"],
  // Mode tukar agy (Task 10): home akun hanya menyimpan slot token, tak ada aset bersama.
  antigravity: [],
};

// Kunci `.claude.json` bawaan yang disalin ke akun tiap launch. `.claude.json` sendiri tak bisa
// dibagi karena memuat identitas akun (`oauthAccount`). Daftar ini diverifikasi spike ADR-0234.
export const MIRRORED_CLAUDE_KEYS = [
  "mcpServers", "hasCompletedOnboarding", "lastOnboardingVersion", "theme", "bypassPermissionsModeAccepted", "projects",
] as const;

type EntryState = "ok" | "absent" | "no-target" | "drift";

function classify(target: string, link: string): EntryState {
  let st: ReturnType<typeof lstatSync> | null = null;
  try { st = lstatSync(link); } catch { st = null; }
  if (!st) return existsSync(target) ? "absent" : "no-target";
  if (st.isSymbolicLink()) return readlinkSync(link) === target ? "ok" : "drift";
  // Berkas/direktori biasa: CLI menulis atomik dan memutus symlink, atau operator menaruhnya sendiri.
  return "drift";
}

/** Entri bersama yang menyimpang dari home bawaan. Hanya membaca. */
export function inspectAccountHome(runtime: RuntimeName, homeDir: string, base: string = baseHome(runtime)): string[] {
  return SHARED_ENTRIES[runtime].filter((e) => classify(join(base, e), join(homeDir, e)) === "drift");
}

/** Buat home (0700) dan pasang symlink yang belum ada. Entri drift TAK pernah ditimpa. */
export function ensureAccountHome(runtime: RuntimeName, homeDir: string, base: string = baseHome(runtime)): { linked: string[]; drift: string[] } {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  chmodSync(homeDir, 0o700);
  const linked: string[] = [], drift: string[] = [];
  for (const entry of SHARED_ENTRIES[runtime]) {
    const target = join(base, entry), link = join(homeDir, entry);
    const state = classify(target, link);
    if (state === "drift") drift.push(entry);
    else if (state === "absent") { symlinkSync(target, link); linked.push(entry); }
  }
  return { linked, drift };
}

/** Salin `MIRRORED_CLAUDE_KEYS` dari `.claude.json` bawaan ke akun. Tulis atomik, kunci lain utuh. */
export function mirrorClaudeJson(accountHome: string, baseJsonPath: string = baseClaudeJson()): void {
  let base: Record<string, unknown>;
  try { base = JSON.parse(readFileSync(baseJsonPath, "utf8")) as Record<string, unknown>; } catch { return; }
  const path = join(accountHome, ".claude.json");
  let acct: Record<string, unknown> = {};
  try { acct = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { acct = {}; }
  let changed = false;
  for (const k of MIRRORED_CLAUDE_KEYS) {
    if (!(k in base) || JSON.stringify(acct[k]) === JSON.stringify(base[k])) continue;
    acct[k] = base[k];
    changed = true;
  }
  if (!changed) return;
  const tmp = `${path}.hanoman-${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(acct, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/** Persiapan sebelum setiap launch. Drift dilaporkan, tak pernah dilempar. */
export function prepareAccountHome(runtime: RuntimeName, homeDir: string): { linked: string[]; drift: string[] } {
  const r = ensureAccountHome(runtime, homeDir);
  if (runtime === "claude") mirrorClaudeJson(homeDir);
  return r;
}
```

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: SRV `server/test/runtime-accounts-home.test.ts`
Expected: PASS (9 test).

- [x] **Step 6: Commit**

```bash
/usr/bin/git add server/src/services/runtime-accounts/paths.ts server/src/services/runtime-accounts/home.ts \
  server/test/runtime-accounts-home.test.ts docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): home akun bersymlink ke aset bersama + deteksi drift (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Keychain & probe identitas login

**Files:**
- Create: `server/src/services/runtime-accounts/keychain.ts`, `server/src/services/runtime-accounts/identity.ts`, `server/test/runtime-accounts-identity.test.ts`
- Modify: `server/src/services/pty.ts:281` (ekspor `agentBin`)

**Interfaces:**
- Consumes: `RuntimeAccountIdentity`, `RuntimeAccountStatus` (Task 1).
- Produces:
  - `type SecurityRun = (args: string[], input?: string) => string`; `securityRun`
  - `claudeKeychainService(configDir: string): string`
  - `readClaudeKeychainToken(service: string, run?: SecurityRun, account?: string | null): string | null`
  - `deleteClaudeKeychainEntry(service: string, run?: SecurityRun): void`
  - `type LoginProbe = { loggedIn: boolean; identity: RuntimeAccountIdentity | null }`
  - `type ExecOut = (bin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>`
  - `probeClaudeLogin(homeDir: string | null, run?: ExecOut, bin?: string): Promise<LoginProbe>`
  - `probeCodexLogin(codexHome: string): LoginProbe`
  - `decodeJwtClaims(token: string): Record<string, unknown> | null`
  - `nextStatus(loggedIn: boolean, everLoggedIn: boolean): RuntimeAccountStatus`
  - `pty.ts`: `export const agentBin(agent: Agent): string`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/runtime-accounts-identity.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeKeychainService, readClaudeKeychainToken } from "../src/services/runtime-accounts/keychain";
import { decodeJwtClaims, nextStatus, probeClaudeLogin, probeCodexLogin } from "../src/services/runtime-accounts/identity";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

describe("keychain claude", () => {
  it("service = Claude Code-credentials-<sha256(dir) 8 hex>", () => {
    const dir = "/Users/x/.hanoman/accounts/claude/a1b2c3d4";
    const h = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    expect(claudeKeychainService(dir)).toBe(`Claude Code-credentials-${h}`);
  });

  it("akun user macOS dulu, lalu tanpa -a; token kosong dilewati", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      if (args.includes("-a")) return JSON.stringify({ claudeAiOauth: { accessToken: "" } });
      return JSON.stringify({ claudeAiOauth: { accessToken: "tok-2" } });
    };
    expect(readClaudeKeychainToken("svc", run, "dena")).toBe("tok-2");
    expect(calls[0]).toEqual(["find-generic-password", "-s", "svc", "-a", "dena", "-w"]);
  });

  it("entri tak ada → null", () => {
    expect(readClaudeKeychainToken("svc", () => { throw new Error("44"); }, "dena")).toBeNull();
  });
});

describe("probeClaudeLogin", () => {
  it("loggedIn true → identitas email + plan; env config dir & tanpa token env", async () => {
    let seen: NodeJS.ProcessEnv = {};
    const run = async (_b: string, args: string[], env: NodeJS.ProcessEnv) => {
      seen = env;
      expect(args).toEqual(["auth", "status", "--json"]);
      return JSON.stringify({ loggedIn: true, email: "ops@x.id", subscriptionType: "max" });
    };
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "bocor";
    try {
      expect(await probeClaudeLogin("/h/acct", run, "claude")).toEqual({ loggedIn: true, identity: { email: "ops@x.id", plan: "max" } });
    } finally { delete process.env.CLAUDE_CODE_OAUTH_TOKEN; }
    expect(seen.CLAUDE_CONFIG_DIR).toBe("/h/acct");
    expect(seen.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("loggedIn false / keluaran rusak → tak login", async () => {
    expect(await probeClaudeLogin("/h", async () => JSON.stringify({ loggedIn: false }), "claude")).toEqual({ loggedIn: false, identity: null });
    expect(await probeClaudeLogin("/h", async () => "bukan json", "claude")).toEqual({ loggedIn: false, identity: null });
  });
});

describe("probeCodexLogin", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ra-codex-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("auth.json ChatGPT → email + plan dari klaim id_token", () => {
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: {
      access_token: "a", id_token: jwt({ email: "c@x.id", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }) } }));
    expect(probeCodexLogin(dir)).toEqual({ loggedIn: true, identity: { email: "c@x.id", plan: "pro" } });
  });

  it("auth.json absen / tanpa access_token → tak login", () => {
    expect(probeCodexLogin(dir)).toEqual({ loggedIn: false, identity: null });
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ tokens: null }));
    expect(probeCodexLogin(dir)).toEqual({ loggedIn: false, identity: null });
  });

  it("decodeJwtClaims tahan token rusak", () => {
    expect(decodeJwtClaims("x")).toBeNull();
    expect(decodeJwtClaims("a.!!!.c")).toBeNull();
  });
});

describe("nextStatus", () => {
  it("login → aktif; belum pernah → belum-login; pernah lalu hilang → perlu-login-ulang", () => {
    expect(nextStatus(true, false)).toBe("aktif");
    expect(nextStatus(false, false)).toBe("belum-login");
    expect(nextStatus(false, true)).toBe("perlu-login-ulang");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: SRV `server/test/runtime-accounts-identity.test.ts`
Expected: FAIL — modul tak ada.

- [x] **Step 3: Implementasi `keychain.ts`**

Create `server/src/services/runtime-accounts/keychain.ts` (rumus service disesuaikan bila spike Task 0 Step 2 menemukan bentuk lain):

```ts
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

export type SecurityRun = (args: string[], input?: string) => string;
export const securityRun: SecurityRun = (args, input) =>
  execFileSync("security", args, {
    encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
  });

export const osAccount = (): string | null => {
  try { return userInfo().username || null; } catch { return null; }
};

/**
 * ADR-0234 · nama service Keychain Claude Code untuk `CLAUDE_CONFIG_DIR` non-bawaan: suffix 8 hex
 * pertama sha256 dari path config dir (terverifikasi spike ADR-0234). Config dir bawaan memakai
 * `Claude Code-credentials` tanpa suffix (`services/limits.ts`).
 */
export function claudeKeychainService(configDir: string): string {
  return `Claude Code-credentials-${createHash("sha256").update(configDir).digest("hex").slice(0, 8)}`;
}

/**
 * Token akses dari satu service Keychain. Entri milik akun user DULU, baru tanpa `-a` (terukur
 * 2026-09-23: Keychain bisa memuat entri akun `unknown` ber-token kosong). Token kosong = sumber berikutnya.
 */
export function readClaudeKeychainToken(service: string, run: SecurityRun = securityRun, account: string | null = osAccount()): string | null {
  const base = ["find-generic-password", "-s", service];
  for (const scope of account ? [["-a", account], []] : [[]]) {
    try {
      const tok: unknown = JSON.parse(run([...base, ...scope, "-w"]))?.claudeAiOauth?.accessToken;
      if (typeof tok === "string" && tok) return tok;
    } catch { /* entri tak ada / bukan JSON */ }
  }
  return null;
}

/** Hapus SEMUA entri service itu (bisa >1: akun `unknown` + akun user). Diam bila tak ada. */
export function deleteClaudeKeychainEntry(service: string, run: SecurityRun = securityRun): void {
  for (let i = 0; i < 4; i++) {
    try { run(["delete-generic-password", "-s", service]); } catch { return; }
  }
}
```

- [x] **Step 4: Ekspor `agentBin` dari pty**

Di `server/src/services/pty.ts:281`, ubah `const agentBin = (agent: Agent): string => {` menjadi:

```ts
// ADR-0234 · diekspor: perintah login & probe status akun memakai biner yang sama dengan sesi.
export const agentBin = (agent: Agent): string => {
```

- [x] **Step 5: Implementasi `identity.ts`**

Create `server/src/services/runtime-accounts/identity.ts`:

```ts
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAccountIdentity, RuntimeAccountStatus } from "@hanoman/shared";
import { agentBin } from "../pty";

export type LoginProbe = { loggedIn: boolean; identity: RuntimeAccountIdentity | null };
export type ExecOut = (bin: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

const NONE: LoginProbe = { loggedIn: false, identity: null };

// `claude auth status` bisa keluar non-nol saat belum login sambil tetap mencetak JSON — stdout dipakai
// bila ada, apa pun kode keluarnya.
const execOut: ExecOut = (bin, args, env) => new Promise((res, rej) => {
  execFile(bin, args, { env, encoding: "utf8", timeout: 15_000 }, (err, stdout) => (stdout ? res(stdout) : rej(err)));
});

/**
 * ADR-0234 · status login claude lewat CLI-nya sendiri (`claude auth status --json`, claude ≥ 2.1.316).
 * Untuk akun non-bawaan (`homeDir` diisi) token env dilepas supaya status mencerminkan login DIREKTORI
 * itu, bukan `CLAUDE_CODE_OAUTH_TOKEN` warisan. Akun bawaan memakai env server apa adanya.
 */
export async function probeClaudeLogin(homeDir: string | null, run: ExecOut = execOut, bin: string = agentBin("claude")): Promise<LoginProbe> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (homeDir) {
    env.CLAUDE_CONFIG_DIR = homeDir;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
  }
  try {
    const j = JSON.parse(await run(bin, ["auth", "status", "--json"], env)) as { loggedIn?: unknown; email?: unknown; subscriptionType?: unknown };
    if (j.loggedIn !== true) return NONE;
    return { loggedIn: true, identity: {
      ...(typeof j.email === "string" && j.email ? { email: j.email } : {}),
      ...(typeof j.subscriptionType === "string" && j.subscriptionType ? { plan: j.subscriptionType } : {}),
    } };
  } catch { return NONE; }
}

export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** ADR-0234 · status login codex dari `auth.json` di CODEX_HOME — lokal, tanpa jaringan. */
export function probeCodexLogin(codexHome: string): LoginProbe {
  let j: { tokens?: { access_token?: unknown; id_token?: unknown } | null };
  try { j = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf8")); } catch { return NONE; }
  const access = j.tokens?.access_token;
  if (typeof access !== "string" || !access) return NONE;
  const claims = typeof j.tokens?.id_token === "string" ? decodeJwtClaims(j.tokens.id_token) : null;
  const auth = claims?.["https://api.openai.com/auth"] as { chatgpt_plan_type?: unknown } | undefined;
  return { loggedIn: true, identity: {
    ...(typeof claims?.email === "string" ? { email: claims.email } : {}),
    ...(typeof auth?.chatgpt_plan_type === "string" ? { plan: auth.chatgpt_plan_type } : {}),
  } };
}

export function nextStatus(loggedIn: boolean, everLoggedIn: boolean): RuntimeAccountStatus {
  return loggedIn ? "aktif" : everLoggedIn ? "perlu-login-ulang" : "belum-login";
}
```

- [x] **Step 6: Jalankan test, pastikan lulus**

Run: SRV `server/test/runtime-accounts-identity.test.ts`
Expected: PASS (10 test).

- [x] **Step 7: Commit**

```bash
/usr/bin/git add server/src/services/runtime-accounts/keychain.ts server/src/services/runtime-accounts/identity.ts \
  server/src/services/pty.ts server/test/runtime-accounts-identity.test.ts docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): probe login claude/codex + Keychain per config dir (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Registry, snapshot, resolver launch

**Files:**
- Create: `server/src/services/runtime-accounts/registry.ts`, `server/src/services/runtime-accounts/resolver.ts`, `server/test/runtime-accounts-registry.test.ts`
- Modify: `server/src/services/session-sandbox.ts:13-17` (ekspor `sessionSandboxOn`)

**Interfaces:**
- Consumes: Task 1–3.
- Produces (registry.ts):
  - `class AccountError extends Error { code: AccountErrorCode; status: 404 | 409 }`
  - `type AccountRow = { id; runtime: RuntimeName; label; homeDir; identity: RuntimeAccountIdentity | null; status: RuntimeAccountStatus; createdAt: Date; lastLoginAt: Date | null }`
  - `type Probes = { claude(home: string | null): Promise<LoginProbe>; codex(home: string): Promise<LoginProbe>; antigravity(home: string | null, accountId: string): Promise<LoginProbe> }`
  - `accountSnapshot(): Snapshot`, `refreshSnapshot(): Promise<void>`, `_setAccountSnapshot(s: Partial<Snapshot>): void` (test-only)
  - `listAccountDTOs(): RuntimeAccountDTO[]`, `accountExists(id): boolean`
  - `createAccount(runtime, label): Promise<RuntimeAccountDTO>`, `renameAccount(id, label)`, `deleteAccount(id, liveAccountIds: () => string[])`, `setDefaultAccount(runtime, accountId, sandbox: boolean)`, `checkAccount(id, probes?)`, `refreshAllStatuses(probes?)`
  - `setProbe(runtime, fn)` — Task 10 memasang probe agy.
- Produces (resolver.ts):
  - `accountEnv(runtime, homeDir): { env: Record<string,string>; unset: string[] }`
  - `resolveLaunchAccount(agent, requested?, deps?): SessionAccount | null` (`SessionAccount` didefinisikan di pty.ts, Task 5)
  - `assertLaunchAccount(agent, requested?, sandbox?): Promise<void>`
- Produces (session-sandbox.ts): `sessionSandboxOn(env?): boolean`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/runtime-accounts-registry.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import {
  AccountError, _setAccountSnapshot, accountSnapshot, checkAccount, createAccount, deleteAccount,
  listAccountDTOs, refreshSnapshot, renameAccount, setDefaultAccount,
} from "../src/services/runtime-accounts/registry";
import { assertLaunchAccount, resolveLaunchAccount } from "../src/services/runtime-accounts/resolver";

const home = mkdtempSync(join(tmpdir(), "ra-reg-"));
const prev = { h: process.env.HANOMAN_HOME, c: process.env.HANOMAN_CLAUDE_HOME, x: process.env.HANOMAN_CODEX_HOME };
process.env.HANOMAN_HOME = home;
// Home bawaan palsu: test tak boleh membuat symlink ke ~/.claude / ~/.codex mesin operator.
process.env.HANOMAN_CLAUDE_HOME = join(home, "base-claude");
process.env.HANOMAN_CODEX_HOME = join(home, "base-codex");
afterAll(() => {
  for (const [k, v] of [["HANOMAN_HOME", prev.h], ["HANOMAN_CLAUDE_HOME", prev.c], ["HANOMAN_CODEX_HOME", prev.x]] as const)
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(home, { recursive: true, force: true });
});

const okProbe = async () => ({ loggedIn: true, identity: { email: "a@x.id", plan: "max" } });
const probes = { claude: okProbe, codex: okProbe, antigravity: async () => ({ loggedIn: false, identity: null }) };

beforeEach(async () => {
  await prisma.runtimeAccount.deleteMany();
  await prisma.setting.deleteMany();
  await refreshSnapshot();
});

describe("registry", () => {
  it("akun bawaan selalu ada (3 runtime) dan jadi default", () => {
    const all = listAccountDTOs();
    expect(all.filter((a) => a.builtin).map((a) => a.id)).toEqual(["default:claude", "default:codex", "default:antigravity"]);
    expect(all.every((a) => a.isDefault)).toBe(true);
  });

  it("create → baris + home 0700 di bawah $HANOMAN_HOME/accounts, status belum-login", async () => {
    const a = await createAccount("claude", "Kantor");
    expect(a).toMatchObject({ runtime: "claude", label: "Kantor", builtin: false, status: "belum-login", isDefault: false });
    expect(a.id).toMatch(/^[0-9a-f]{8}$/);
    expect(existsSync(join(home, "accounts", "claude", a.id))).toBe(true);
  });

  it("label duplikat per runtime / label 'Default' → account-label-taken", async () => {
    await createAccount("claude", "Kantor");
    await expect(createAccount("claude", "Kantor")).rejects.toMatchObject({ code: "account-label-taken", status: 409 });
    await expect(createAccount("codex", "default")).rejects.toMatchObject({ code: "account-label-taken" });
    await expect(createAccount("codex", "Kantor")).resolves.toMatchObject({ runtime: "codex" });
  });

  it("rename & delete; delete menghapus home dan mengembalikan default ke bawaan", async () => {
    const a = await createAccount("codex", "A");
    await renameAccount(a.id, "B");
    await checkAccount(a.id, probes);
    await setDefaultAccount("codex", a.id, false);
    expect(accountSnapshot().defaults.codex).toBe(a.id);
    await deleteAccount(a.id, () => []);
    expect(existsSync(join(home, "accounts", "codex", a.id))).toBe(false);
    expect(accountSnapshot().defaults.codex).toBeUndefined();
  });

  it("delete akun yang dipakai sesi hidup → account-in-use", async () => {
    const a = await createAccount("claude", "Sibuk");
    await expect(deleteAccount(a.id, () => [a.id])).rejects.toMatchObject({ code: "account-in-use", status: 409 });
  });

  it("setDefault: runtime salah → mismatch; sandbox → sandbox-unsupported; id asing → 404", async () => {
    const a = await createAccount("claude", "K");
    await expect(setDefaultAccount("codex", a.id, false)).rejects.toMatchObject({ code: "account-runtime-mismatch" });
    await expect(setDefaultAccount("claude", a.id, true)).rejects.toMatchObject({ code: "account-sandbox-unsupported" });
    await expect(setDefaultAccount("claude", "deadbeef", false)).rejects.toMatchObject({ code: "account-not-found", status: 404 });
    await expect(setDefaultAccount("claude", "default:codex", false)).rejects.toMatchObject({ code: "account-runtime-mismatch" });
  });

  it("checkAccount: login → aktif + identitas + lastLoginAt", async () => {
    const a = await createAccount("claude", "K");
    const got = await checkAccount(a.id, probes);
    expect(got).toMatchObject({ status: "aktif", identity: { email: "a@x.id", plan: "max" } });
    expect(got.lastLoginAt).not.toBeNull();
  });
});

describe("resolver", () => {
  it("akun bawaan / tanpa default → null (perilaku lama)", () => {
    expect(resolveLaunchAccount("claude", undefined, { sandbox: false, warn: () => {} })).toBeNull();
    expect(resolveLaunchAccount("claude", "default:claude", { sandbox: false, warn: () => {} })).toBeNull();
  });

  it("akun claude eksplisit → CLAUDE_CONFIG_DIR + lepas token env", async () => {
    const a = await createAccount("claude", "K");
    await checkAccount(a.id, probes);
    const r = resolveLaunchAccount("claude", a.id, { sandbox: false, warn: () => {} });
    expect(r).toEqual({ id: a.id, env: { CLAUDE_CONFIG_DIR: join(home, "accounts", "claude", a.id) }, unset: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] });
  });

  it("default codex aktif dipakai sesi otomatis; default yang belum login jatuh ke bawaan", async () => {
    const a = await createAccount("codex", "C");
    await checkAccount(a.id, probes);
    await setDefaultAccount("codex", a.id, false);
    expect(resolveLaunchAccount("codex", undefined, { sandbox: false, warn: () => {} })?.env).toEqual({ CODEX_HOME: join(home, "accounts", "codex", a.id) });
    _setAccountSnapshot({ rows: accountSnapshot().rows.map((r) => ({ ...r, status: "perlu-login-ulang" as const })) });
    const warns: string[] = [];
    expect(resolveLaunchAccount("codex", undefined, { sandbox: false, warn: (m) => warns.push(m) })).toBeNull();
    expect(warns).toHaveLength(1);
  });

  it("sandbox aktif → selalu null", async () => {
    const a = await createAccount("claude", "K");
    await checkAccount(a.id, probes);
    expect(resolveLaunchAccount("claude", a.id, { sandbox: true, warn: () => {} })).toBeNull();
  });

  it("assertLaunchAccount: 404 / mismatch / belum login / sandbox", async () => {
    const a = await createAccount("claude", "K");
    await expect(assertLaunchAccount("claude", "deadbeef", false)).rejects.toMatchObject({ code: "account-not-found", status: 404 });
    await expect(assertLaunchAccount("codex", a.id, false)).rejects.toMatchObject({ code: "account-runtime-mismatch" });
    await expect(assertLaunchAccount("claude", a.id, false)).rejects.toMatchObject({ code: "account-not-logged-in" });
    await checkAccount(a.id, probes);
    await expect(assertLaunchAccount("claude", a.id, true)).rejects.toMatchObject({ code: "account-sandbox-unsupported" });
    await expect(assertLaunchAccount("claude", a.id, false)).resolves.toBeUndefined();
    await expect(assertLaunchAccount("claude", undefined, false)).resolves.toBeUndefined();
    await expect(assertLaunchAccount("claude", "default:codex", false)).rejects.toBeInstanceOf(AccountError);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: SRV `server/test/runtime-accounts-registry.test.ts`
Expected: FAIL — modul tak ada.

- [x] **Step 3: `sessionSandboxOn`**

Di `server/src/services/session-sandbox.ts`, sebelum `assertAntigravityLaunch`:

```ts
/** Sandbox sesi menyala? Satu sumber untuk gerbang agy (ADR-0117) dan akun runtime (ADR-0234). */
export function sessionSandboxOn(env: Env = process.env): boolean {
  return resolveHardening(env) || (env.HANOMAN_SESSION_SANDBOX !== undefined && env.HANOMAN_SESSION_SANDBOX !== "off");
}
```

dan ubah baris pertama `assertAntigravityLaunch` menjadi `if (sessionSandboxOn(env))` (kondisinya identik).

- [x] **Step 4: Implementasi `registry.ts`**

Create `server/src/services/runtime-accounts/registry.ts`:

```ts
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { Prisma } from "@prisma/client";
import {
  BUILTIN_ACCOUNT_LABEL, builtinAccountId, isBuiltinAccountId, runtimeOfBuiltin, zAgent,
  type AccountErrorCode, type RuntimeAccountDTO, type RuntimeAccountDefaults, type RuntimeAccountIdentity,
  type RuntimeAccountStatus, type RuntimeName,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { getSetting } from "../settings";
import { inspectAccountHome, ensureAccountHome } from "./home";
import { accountHomeDir, baseHome, insideAccountsRoot } from "./paths";
import { claudeKeychainService, deleteClaudeKeychainEntry } from "./keychain";
import { nextStatus, probeClaudeLogin, probeCodexLogin, type LoginProbe } from "./identity";

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode, readonly status: 404 | 409, message: string) { super(message); }
}

export type AccountRow = {
  id: string; runtime: RuntimeName; label: string; homeDir: string; identity: RuntimeAccountIdentity | null;
  status: RuntimeAccountStatus; createdAt: Date; lastLoginAt: Date | null;
};
type BuiltinState = { status: RuntimeAccountStatus; identity: RuntimeAccountIdentity | null };
type Snapshot = { rows: AccountRow[]; defaults: RuntimeAccountDefaults; builtin: Partial<Record<RuntimeName, BuiltinState>> };

export type Probes = {
  claude: (home: string | null) => Promise<LoginProbe>;
  codex: (home: string) => Promise<LoginProbe>;
  antigravity: (home: string | null, accountId: string) => Promise<LoginProbe>;
};
const probes: Probes = {
  claude: (home) => probeClaudeLogin(home),
  codex: async (home) => probeCodexLogin(home),
  // Task 10 memasang probe slot agy lewat setProbe.
  antigravity: async () => ({ loggedIn: false, identity: null }),
};
export function setProbe<K extends keyof Probes>(runtime: K, fn: Probes[K]): void { probes[runtime] = fn; }

export const RUNTIMES: readonly RuntimeName[] = zAgent.options;

// ADR-0234 · snapshot memori untuk resolver SINKRON di pty.createSession (Prisma asinkron). Diperbarui
// setiap mutasi lewat refreshSnapshot(); dibaca boot SEBELUM sesi apa pun bisa lahir (install.ts).
let snapshot: Snapshot = { rows: [], defaults: {}, builtin: {} };
export const accountSnapshot = (): Snapshot => snapshot;
/** Test-only. */
export function _setAccountSnapshot(s: Partial<Snapshot>): void { snapshot = { ...snapshot, ...s }; }

type DbRow = { id: string; runtime: string; label: string; homeDir: string; identity: Prisma.JsonValue | null; status: string; createdAt: Date; lastLoginAt: Date | null };
const toRow = (r: DbRow): AccountRow => ({
  id: r.id, runtime: zAgent.parse(r.runtime), label: r.label, homeDir: r.homeDir,
  identity: r.identity && typeof r.identity === "object" && !Array.isArray(r.identity) ? (r.identity as RuntimeAccountIdentity) : null,
  status: r.status === "aktif" || r.status === "perlu-login-ulang" ? r.status : "belum-login",
  createdAt: r.createdAt, lastLoginAt: r.lastLoginAt,
});

export async function refreshSnapshot(): Promise<void> {
  const [rows, setting] = await Promise.all([
    prisma.runtimeAccount.findMany({ orderBy: { createdAt: "asc" } }), getSetting(),
  ]);
  snapshot = { ...snapshot, rows: rows.map(toRow), defaults: setting.accounts ?? {} };
}

const defaultOf = (runtime: RuntimeName): string => snapshot.defaults[runtime] ?? builtinAccountId(runtime);

export function accountExists(id: string): boolean {
  return isBuiltinAccountId(id) ? runtimeOfBuiltin(id) !== null : snapshot.rows.some((r) => r.id === id);
}

export function listAccountDTOs(): RuntimeAccountDTO[] {
  const out: RuntimeAccountDTO[] = [];
  for (const runtime of RUNTIMES) {
    const def = defaultOf(runtime);
    const b = snapshot.builtin[runtime];
    out.push({
      id: builtinAccountId(runtime), runtime, label: BUILTIN_ACCOUNT_LABEL, builtin: true,
      isDefault: def === builtinAccountId(runtime),
      // Belum diprobe = anggap aktif: akun bawaan adalah perilaku hanoman selama ini.
      status: b?.status ?? "aktif", identity: b?.identity ?? null, drift: [], createdAt: null, lastLoginAt: null,
    });
    for (const r of snapshot.rows.filter((x) => x.runtime === runtime)) {
      out.push({
        id: r.id, runtime, label: r.label, builtin: false, isDefault: def === r.id, status: r.status,
        identity: r.identity, drift: inspectAccountHome(runtime, r.homeDir),
        createdAt: r.createdAt.toISOString(), lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      });
    }
  }
  return out;
}

const dtoOf = (id: string): RuntimeAccountDTO => {
  const d = listAccountDTOs().find((a) => a.id === id);
  if (!d) throw new AccountError("account-not-found", 404, `akun ${id} tak ditemukan`);
  return d;
};

const labelTaken = (runtime: RuntimeName, label: string) =>
  new AccountError("account-label-taken", 409, `label "${label}" sudah dipakai di ${runtime}`);

export async function createAccount(runtime: RuntimeName, label: string): Promise<RuntimeAccountDTO> {
  if (label.toLowerCase() === BUILTIN_ACCOUNT_LABEL.toLowerCase()) throw labelTaken(runtime, label);
  const id = randomUUID().replace(/-/g, "").slice(0, 8);
  const homeDir = accountHomeDir(runtime, id);
  try {
    await prisma.runtimeAccount.create({ data: { id, runtime, label, homeDir, status: "belum-login" } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw labelTaken(runtime, label);
    throw e;
  }
  ensureAccountHome(runtime, homeDir, baseHome(runtime));
  await refreshSnapshot();
  return dtoOf(id);
}

async function rowOrThrow(id: string): Promise<AccountRow> {
  const r = await prisma.runtimeAccount.findUnique({ where: { id } });
  if (!r) throw new AccountError("account-not-found", 404, `akun ${id} tak ditemukan`);
  return toRow(r);
}

export async function renameAccount(id: string, label: string): Promise<RuntimeAccountDTO> {
  const row = await rowOrThrow(id);
  if (label.toLowerCase() === BUILTIN_ACCOUNT_LABEL.toLowerCase()) throw labelTaken(row.runtime, label);
  try { await prisma.runtimeAccount.update({ where: { id }, data: { label } }); }
  catch (e) {
    if ((e as { code?: string }).code === "P2002") throw labelTaken(row.runtime, label);
    throw e;
  }
  await refreshSnapshot();
  return dtoOf(id);
}

async function writeDefaults(accounts: RuntimeAccountDefaults): Promise<void> {
  const s = await getSetting();
  const data = { ...s, accounts } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}

export async function deleteAccount(id: string, liveAccountIds: () => string[]): Promise<void> {
  const row = await rowOrThrow(id);
  if (liveAccountIds().includes(id)) throw new AccountError("account-in-use", 409, `akun "${row.label}" masih dipakai sesi yang hidup`);
  await prisma.runtimeAccount.delete({ where: { id } });
  const s = await getSetting();
  if (s.accounts?.[row.runtime] === id) {
    const next = { ...s.accounts };
    delete next[row.runtime];
    await writeDefaults(next);
  }
  if (row.runtime === "claude" && process.platform === "darwin") deleteClaudeKeychainEntry(claudeKeychainService(row.homeDir));
  // fs.rmSync rekursif meng-unlink symlink tanpa mengikutinya — aset bersama di home bawaan aman
  // (dikunci test "menghapus home akun TIDAK menghapus target symlink").
  if (insideAccountsRoot(row.homeDir)) rmSync(row.homeDir, { recursive: true, force: true });
  await refreshSnapshot();
}

export async function setDefaultAccount(runtime: RuntimeName, accountId: string, sandbox: boolean): Promise<void> {
  if (isBuiltinAccountId(accountId)) {
    if (accountId !== builtinAccountId(runtime))
      throw new AccountError("account-runtime-mismatch", 409, `${accountId} bukan akun bawaan ${runtime}`);
  } else {
    const row = await rowOrThrow(accountId);
    if (row.runtime !== runtime) throw new AccountError("account-runtime-mismatch", 409, `akun "${row.label}" milik ${row.runtime}, bukan ${runtime}`);
    if (sandbox) throw new AccountError("account-sandbox-unsupported", 409, "sandbox sesi hanya mendukung akun bawaan");
  }
  const s = await getSetting();
  const next: RuntimeAccountDefaults = { ...(s.accounts ?? {}) };
  if (isBuiltinAccountId(accountId)) delete next[runtime]; else next[runtime] = accountId;
  await writeDefaults(next);
  await refreshSnapshot();
}

async function probeBuiltin(runtime: RuntimeName, use: Probes = probes): Promise<void> {
  const p = runtime === "claude" ? await use.claude(null)
    : runtime === "codex" ? await use.codex(baseHome("codex"))
    : await use.antigravity(null, builtinAccountId("antigravity"));
  snapshot = { ...snapshot, builtin: { ...snapshot.builtin, [runtime]: {
    status: nextStatus(p.loggedIn, true), identity: p.identity,
  } } };
}

export async function checkAccount(id: string, override?: Probes): Promise<RuntimeAccountDTO> {
  const use = override ?? probes;
  const builtin = runtimeOfBuiltin(id);
  if (builtin) {
    await probeBuiltin(builtin, use);
    return dtoOf(id);
  }
  const row = await rowOrThrow(id);
  const p = row.runtime === "claude" ? await use.claude(row.homeDir)
    : row.runtime === "codex" ? await use.codex(row.homeDir)
    : await use.antigravity(row.homeDir, row.id);
  const ever = row.lastLoginAt !== null || row.status !== "belum-login";
  await prisma.runtimeAccount.update({ where: { id }, data: {
    status: nextStatus(p.loggedIn, ever),
    ...(p.loggedIn ? { identity: (p.identity ?? {}) as Prisma.InputJsonValue } : {}),
    ...(p.loggedIn && row.status !== "aktif" ? { lastLoginAt: new Date() } : {}),
  } });
  await refreshSnapshot();
  return dtoOf(id);
}

/** Boot: perbarui status semua akun (berurutan — probe claude men-spawn CLI). Gagal satu tak menghentikan sisanya. */
export async function refreshAllStatuses(): Promise<void> {
  for (const runtime of RUNTIMES) {
    try { await probeBuiltin(runtime); } catch (e) { console.error(`akun runtime (status ${runtime} bawaan):`, e); }
  }
  for (const r of snapshot.rows) {
    try { await checkAccount(r.id); } catch (e) { console.error(`akun runtime (status ${r.label}):`, e); }
  }
}
```

- [x] **Step 5: Implementasi `resolver.ts`**

Create `server/src/services/runtime-accounts/resolver.ts`:

```ts
import { builtinAccountId, isBuiltinAccountId, type Agent, type RuntimeName } from "@hanoman/shared";
import type { SessionAccount } from "../pty";
import { sessionSandboxOn } from "../session-sandbox";
import { prisma } from "../../db";
import { prepareAccountHome } from "./home";
import { AccountError, accountSnapshot } from "./registry";

/** Env yang membuat CLI memakai login akun. Token env claude dilepas: ia mengalahkan config dir. */
export function accountEnv(runtime: RuntimeName, homeDir: string): { env: Record<string, string>; unset: string[] } {
  if (runtime === "claude") return { env: { CLAUDE_CONFIG_DIR: homeDir }, unset: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] };
  if (runtime === "codex") return { env: { CODEX_HOME: homeDir }, unset: [] };
  return { env: {}, unset: [] };
}

type ResolveDeps = { sandbox: boolean; warn: (m: string) => void };
const prodDeps = (): ResolveDeps => ({ sandbox: sessionSandboxOn(), warn: (m) => console.warn(m) });

/**
 * ADR-0234 · resolver SINKRON untuk pty.createSession. null = akun bawaan (perilaku lama, nol env
 * tambahan). `requested` diisi pemanggil manusia (sudah divalidasi `assertLaunchAccount`) atau
 * auto-resume; absen = default runtime. Default yang tak lagi `aktif` jatuh ke bawaan + peringatan,
 * supaya sesi otomatis (scheduler/lead) tak mati karena satu akun kedaluwarsa.
 */
export function resolveLaunchAccount(agent: Agent, requested?: string, deps: ResolveDeps = prodDeps()): SessionAccount | null {
  if (deps.sandbox) return null;
  const snap = accountSnapshot();
  const id = requested ?? snap.defaults[agent];
  if (!id || isBuiltinAccountId(id)) return null;
  const row = snap.rows.find((r) => r.id === id && r.runtime === agent);
  if (!row) { deps.warn(`hanoman: akun runtime ${id} tak ditemukan untuk ${agent} — memakai akun bawaan`); return null; }
  if (!requested && row.status !== "aktif") {
    deps.warn(`hanoman: akun default ${agent} "${row.label}" berstatus ${row.status} — sesi memakai akun bawaan`);
    return null;
  }
  try { prepareAccountHome(agent, row.homeDir); }
  catch (e) { deps.warn(`hanoman: menyiapkan home akun "${row.label}" gagal: ${(e as Error).message}`); }
  return { id: row.id, ...accountEnv(agent, row.homeDir) };
}

/** Validasi pilihan akun EKSPLISIT sebelum launch (route). Melempar AccountError. */
export async function assertLaunchAccount(agent: Agent, requested: string | undefined, sandbox: boolean = sessionSandboxOn()): Promise<void> {
  if (!requested) return;
  if (isBuiltinAccountId(requested)) {
    if (requested !== builtinAccountId(agent))
      throw new AccountError("account-runtime-mismatch", 409, `${requested} bukan akun bawaan ${agent}`);
    return;
  }
  const row = await prisma.runtimeAccount.findUnique({ where: { id: requested } });
  if (!row) throw new AccountError("account-not-found", 404, `akun ${requested} tak ditemukan`);
  if (row.runtime !== agent) throw new AccountError("account-runtime-mismatch", 409, `akun "${row.label}" milik ${row.runtime}, bukan ${agent}`);
  if (sandbox) throw new AccountError("account-sandbox-unsupported", 409, "sandbox sesi hanya mendukung akun bawaan");
  if (row.status !== "aktif") throw new AccountError("account-not-logged-in", 409, `akun "${row.label}" belum login`);
}
```

`SessionAccount` baru lahir di Task 5 Step 3. Supaya Task 4 bisa dikompilasi sendiri, tambahkan sekarang di `server/src/services/pty.ts`, tepat sesudah `export type Pane = …;` (blok tipe):

```ts
// ADR-0234 · akun runtime yang dipakai sebuah sesi (diisi resolver layanan akun).
export type SessionAccount = { id: string; env: Record<string, string>; unset: string[] };
```

- [x] **Step 6: Jalankan test, pastikan lulus**

Run: SRV `server/test/runtime-accounts-registry.test.ts server/test/runtime-accounts-settings.test.ts`
Expected: PASS.
Run: `pnpm --filter ./server typecheck` — tanpa error.

- [x] **Step 7: Commit**

```bash
/usr/bin/git add server/src/services/runtime-accounts/registry.ts server/src/services/runtime-accounts/resolver.ts \
  server/src/services/session-sandbox.ts server/src/services/pty.ts server/test/runtime-accounts-registry.test.ts \
  docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): registry, snapshot memori, resolver & validasi launch (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wiring launch — pty, riwayat, resume, route terminal

**Files:**
- Create: `server/src/services/runtime-accounts/install.ts`, `server/src/services/runtime-accounts/login.ts` (hanya helper id sesi; perintah login di Task 6), `server/test/runtime-accounts-launch.test.ts`
- Modify: `server/src/services/pty.ts` (resolver, `CreateOpts.accountId`, env/unset, `@hanoman_account`, FMT/`parsePanes`/`SessionInfo`/`toSessionInfo`, `SessionBirth`, return), `server/test/pty-parse.test.ts`, `server/src/services/session-history.ts` (`view`, `beginSession`, `SessionRuntime`, `reconciledRuntimesSince`), `server/src/services/session-launch.ts` (opts + createSession), `server/src/services/session-boot-resume.ts` (`prodDeps.startSpec`), `server/src/routes/terminal.ts` (backlog & terminal agen), `server/src/services/agent-invocations.ts:67-70`, `server/src/server.ts` (boot)

**Interfaces:**
- Consumes: `resolveLaunchAccount`, `assertLaunchAccount`, `AccountError`, `accountExists`, `refreshSnapshot`, `refreshAllStatuses`, `checkAccount`, `accountSnapshot` (Task 4); `accountsRoot` (Task 2).
- Produces:
  - pty: `registerAccountResolver(r: (agent: Agent, requested?: string) => SessionAccount | null): () => void`; `CreateOpts.accountId?: string`; `SessionInfo.accountId?: string`; `SessionBirth.accountId?: string`
  - `SessionRuntime.accountId?: string`; `startSpecSession` opts `accountId?: string`
  - `loginSessionId(accountId): string`, `accountIdForLoginSession(sessionId): string | null`
  - `installRuntimeAccounts(): Promise<void>`

- [x] **Step 1: Kunci kolom FMT baru (test gagal dulu)**

Di `server/test/pty-parse.test.ts`, test `"FMT dan destructuring sama panjang"` jadi:

```ts
  it("FMT dan destructuring sama panjang", () => {
    expect(FIELDS).toHaveLength(25);
    // SPEC-1218 · AC-C2 · pane_width/pane_height di UJUNG (pola SPEC-919): kolom lama tak bergeser.
    expect(FIELDS[FIELDS.length - 4]).toBe("#{pane_width}");
    expect(FIELDS[FIELDS.length - 3]).toBe("#{pane_height}");
    expect(FIELDS[FIELDS.length - 2]).toBe("#{@hanoman_name}");
    // ADR-0234 · akun runtime — di UJUNG juga.
    expect(FIELDS[FIELDS.length - 1]).toBe("#{@hanoman_account}");
  });

  it("ADR-0234 · @hanoman_account terbaca jadi accountId; kosong → undefined", () => {
    expect(parsePanes(line({ "#{@hanoman_account}": "a1b2c3d4" }))[0]!.accountId).toBe("a1b2c3d4");
    expect(parsePanes(line())[0]!.accountId).toBeUndefined();
  });
```

Run: SRV `server/test/pty-parse.test.ts`
Expected: FAIL (panjang 24, `accountId` tak ada).

- [x] **Step 2: FMT, parsePanes, SessionInfo**

Di `server/src/services/pty.ts`:

1. Di `FMT`, sesudah `"#{@hanoman_name}",`:
   ```ts
     // ADR-0234 · akun runtime sesi (`RuntimeAccount.id` / `default:<runtime>`) — di UJUNG juga.
     "#{@hanoman_account}",
   ```
2. Di `parsePanes`, destructuring: `orchestrated, doneAtBirth, paneWidth, paneHeight, customName, accountRaw] = line.split("\t");` dan di objek hasil (sesudah `height: …,`):
   ```ts
         // ADR-0234 · sesi lama / akun bawaan tanpa opsi ini → undefined.
         accountId: accountRaw || undefined,
   ```
3. Di `SessionInfo`, sesudah `name?: string;`:
   ```ts
     /** ADR-0234 · akun runtime sesi. Absen = akun bawaan (atau sesi lama). */
     accountId?: string;
   ```
4. `toSessionInfo`: tambahkan `accountId` di destructuring parameter dan `...(accountId ? { accountId } : {}),` sesudah `...(name ? { name } : {}),`.

Run: SRV `server/test/pty-parse.test.ts` → PASS.

- [x] **Step 3: Resolver di createSession**

Di `server/src/services/pty.ts`:

1. Dekat `registerSessionHooks` (sesudah fungsinya):
   ```ts
   // ADR-0234 · akun runtime per sesi. pty tetap NOL dependensi DB: layanan akun mendaftarkan resolver
   // SINKRON (snapshot memori) saat boot — cermin registerSessionHooks. Tanpa pendaftar → akun bawaan.
   type AccountResolver = (agent: Agent, requested?: string) => SessionAccount | null;
   let accountResolver: AccountResolver = () => null;
   export function registerAccountResolver(r: AccountResolver): () => void {
     accountResolver = r;
     return () => { if (accountResolver === r) accountResolver = () => null; };
   }
   ```
2. `CreateOpts`, sesudah `askVia?: AskVia;`:
   ```ts
     // ADR-0234 · akun runtime pilihan pemanggil (sudah divalidasi). Kosong = default runtime.
     accountId?: string;
   ```
3. Tepat sesudah `const agent: Agent = opts.agent ?? "claude";` (±:1066):
   ```ts
     // ADR-0234 · hanya sesi AGEN; shell/console tak membawa akun. Resolver boleh melempar (agy sibuk,
     // Task 10) — itu terjadi sebelum tmux menyentuh apa pun.
     const account = opts.command ? null : accountResolver(agent, opts.accountId);
   ```
4. Sesudah loop `for (const [k, v] of Object.entries(agentEnvironment(runtime, opts.env ?? {}))) { … }`:
   ```ts
     for (const [k, v] of Object.entries(account?.env ?? {})) envPairs.push(`${k}=${sq(v)}`);
   ```
5. Array `unsets`: tambahkan `...(account?.unset ?? []),` sebagai elemen terakhir sebelum `].flatMap(…)`.
6. Sesudah `tmux("set-option", "-t", name(id), "@hanoman_agent", agent);`:
   ```ts
     if (account) tmux("set-option", "-t", name(id), "@hanoman_account", account.id);
   ```
7. `SessionBirth`: tambahkan `accountId?: string;`. Panggilan `emitBirth({ … })`: tambahkan `accountId: account?.id,`.
8. `return { id, projectId, …, agent };` jadi `return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, branch: opts.branch, exited: false, decision: false, agent, ...(account ? { accountId: account.id } : {}) };`

- [x] **Step 4: Tulis test launch yang gagal**

Create `server/test/runtime-accounts-launch.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import { beginSession, reconciledRuntimesSince } from "../src/services/session-history";
import { resumeReconciledSessions } from "../src/services/session-boot-resume";
import { accountIdForLoginSession, loginSessionId } from "../src/services/runtime-accounts/login";
import { _setAccountSnapshot, refreshSnapshot } from "../src/services/runtime-accounts/registry";

const home = mkdtempSync(join(tmpdir(), "ra-launch-"));
const prev = process.env.HANOMAN_HOME;
process.env.HANOMAN_HOME = home;
afterAll(() => { process.env.HANOMAN_HOME = prev; rmSync(home, { recursive: true, force: true }); });
beforeEach(async () => { await prisma.sessionHistory.deleteMany(); await prisma.runtimeAccount.deleteMany(); await refreshSnapshot(); });

describe("riwayat & resume membawa akun", () => {
  it("beginSession menyimpan accountId; reconciledRuntimesSince mengembalikannya", async () => {
    await beginSession({ sessionId: "s1", projectId: "p", specId: "SPEC-1", kind: "spec", agent: "codex", cwd: "/w", accountId: "a1b2c3d4" });
    const row = await prisma.sessionHistory.findFirstOrThrow({ where: { sessionId: "s1" } });
    expect(row.accountId).toBe("a1b2c3d4");
    await prisma.sessionHistory.update({ where: { id: row.id }, data: { endedAt: new Date(), endedReason: "reconciled", reconciledAt: new Date() } });
    const rt = await reconciledRuntimesSince(new Date(Date.now() - 60_000));
    expect(rt.get("SPEC-1")).toMatchObject({ agent: "codex", accountId: "a1b2c3d4" });
  });

  it("auto-resume dengan akun yang sudah dihapus → failed + alasan, bukan pindah akun", async () => {
    await prisma.project.upsert({ where: { id: "p" }, update: {}, create: { id: "p", name: "p" } as never });
    await prisma.spec.upsert({ where: { id: "SPEC-1" }, update: { stage: "execute" }, create: { id: "SPEC-1", projectId: "p", title: "t", stage: "execute" } as never });
    await beginSession({ sessionId: "s1", projectId: "p", specId: "SPEC-1", kind: "spec", agent: "claude", cwd: "/w", accountId: "deadbeef" });
    await prisma.sessionHistory.updateMany({ data: { endedAt: new Date(), endedReason: "reconciled", reconciledAt: new Date() } });
    _setAccountSnapshot({ rows: [] });
    const fails: string[] = [];
    const { prodResumeStart } = await import("../src/services/session-boot-resume");
    const report = await resumeReconciledSessions(new Date(Date.now() - 60_000), {
      startSpec: prodResumeStart, recordFail: async (_s, _t, _p, reason) => { fails.push(reason); },
      recordDeferred: async () => {},
    });
    expect(report.failed).toEqual(["SPEC-1"]);
    expect(fails[0]).toMatch(/akun runtime deadbeef sudah dihapus/);
  });
});

describe("id sesi login", () => {
  it("dua arah, termasuk akun bawaan", async () => {
    _setAccountSnapshot({ rows: [{ id: "a1b2c3d4", runtime: "claude", label: "K", homeDir: "/h", identity: null, status: "belum-login", createdAt: new Date(), lastLoginAt: null }] });
    expect(loginSessionId("a1b2c3d4")).toBe("acct-login-a1b2c3d4");
    expect(loginSessionId("default:codex")).toBe("acct-login-default-codex");
    expect(accountIdForLoginSession("acct-login-a1b2c3d4")).toBe("a1b2c3d4");
    expect(accountIdForLoginSession("acct-login-default-codex")).toBe("default:codex");
    expect(accountIdForLoginSession("spec-1")).toBeNull();
  });
});
```

Catatan: sesuaikan `create` Project/Spec dengan field wajib model nyata (lihat `server/test/` lain yang membuat Spec, mis. `grep -rn "prisma.spec.create" server/test | head -3`) — kast `as never` hanya menutup tipe, bukan constraint DB.

Run: SRV `server/test/runtime-accounts-launch.test.ts`
Expected: FAIL (`accountId` belum ada di `SessionBirth`/riwayat; `login.ts` & `prodResumeStart` tak ada).

- [x] **Step 5: Riwayat sesi**

Di `server/src/services/session-history.ts`:

1. `view`: tambahkan `accountId: r.accountId,` sesudah `transcriptBytes: r.transcriptBytes,`.
2. `beginSession` → `data`: tambahkan `accountId: b.accountId ?? null,`.
3. `SessionRuntime`: `export type SessionRuntime = { agent: "claude" | "codex" | "antigravity"; model?: string; effort?: string; accountId?: string };`
4. `reconciledRuntimesSince`: `select` tambahkan `accountId: true`; objek yang di-`set` tambahkan `...(r.accountId ? { accountId: r.accountId } : {}),`.

- [x] **Step 6: Launch backlog membawa akun**

Di `server/src/services/session-launch.ts`:

1. Tipe `opts` `startSpecSession`, sesudah `agent?: Agent;`:
   ```ts
       // ADR-0234 · akun runtime. undefined → default runtime (Setting.accounts). Auto-resume memasoknya
       // dari SessionHistory; route dari picker Start.
       accountId?: string;
   ```
2. Panggilan `createSession(spec.projectId, worktree, { … })`: tambahkan `accountId: opts.accountId,` sesudah `agent, askVia,`.

Di `server/src/services/session-boot-resume.ts`:

```ts
import { accountExists } from "./runtime-accounts/registry";
…
// ADR-0234 · resume memakai akun yang SAMA dengan saat sesi lahir. Akun itu sudah dihapus → gagal dengan
// alasan (operator melanjutkan manual & memilih akun), bukan diam-diam pindah ke akun lain.
export const prodResumeStart: ResumeDeps["startSpec"] = async (spec, runtime) => {
  if (runtime?.accountId && !accountExists(runtime.accountId))
    throw new Error(`akun runtime ${runtime.accountId} sudah dihapus — lanjutkan manual dan pilih akun lain`);
  return startSpecSession(spec, { flow: flowForSource(spec.source), ...(runtime ?? {}) });
};
```

dan di `prodDeps` ganti `startSpec: (spec, runtime) => startSpecSession(…)` menjadi `startSpec: prodResumeStart,`. Periksa bahwa blok `catch` di `resumeReconciledSessions` meneruskan `(e as Error).message` ke `recordFail` sebagai `reason`; bila tidak, ubah agar begitu.

- [x] **Step 7: `login.ts` (helper id) dan `install.ts`**

Create `server/src/services/runtime-accounts/login.ts`:

```ts
import { builtinAccountId, zAgent } from "@hanoman/shared";
import { accountSnapshot } from "./registry";

// ADR-0234 · sesi terminal login punya id deterministik: klik Login kedua menyambung, bukan menumpuk.
// tmux tak menerima ":" di nama sesi, jadi `default:claude` → `default-claude`.
export const LOGIN_PREFIX = "acct-login-";
export const loginSessionId = (accountId: string): string => `${LOGIN_PREFIX}${accountId.replace(/[^a-z0-9]/gi, "-")}`;

export function accountIdForLoginSession(sessionId: string): string | null {
  if (!sessionId.startsWith(LOGIN_PREFIX)) return null;
  const ids = [...zAgent.options.map((r) => builtinAccountId(r)), ...accountSnapshot().rows.map((r) => r.id)];
  return ids.find((id) => loginSessionId(id) === sessionId) ?? null;
}
```

Create `server/src/services/runtime-accounts/install.ts`:

```ts
import { registerAccountResolver, registerSessionHooks } from "../pty";
import { accountIdForLoginSession } from "./login";
import { checkAccount, refreshAllStatuses, refreshSnapshot } from "./registry";
import { resolveLaunchAccount } from "./resolver";

/**
 * ADR-0234 · dipanggil server.ts SEBELUM sesi apa pun bisa lahir (dan sebelum auto-resume): snapshot
 * harus terisi supaya resolver & `accountExists` menjawab benar. Status login diperbarui di latar.
 */
export async function installRuntimeAccounts(): Promise<void> {
  await refreshSnapshot();
  registerAccountResolver((agent, requested) => resolveLaunchAccount(agent, requested));
  registerSessionHooks({
    // Sesi login ditutup operator → baca ulang status akun itu.
    onDeath: (d) => {
      const id = accountIdForLoginSession(d.sessionId);
      if (id) void checkAccount(id).catch((e) => console.error("akun runtime (periksa sesudah login):", e));
    },
  });
  void refreshAllStatuses().catch((e) => console.error("akun runtime (status boot):", e));
}
```

Di `server/src/server.ts`, tepat sesudah `installSessionHistory();`:

```ts
  // ADR-0234 · resolver akun runtime + snapshot SEBELUM sesi apa pun lahir dan sebelum auto-resume.
  await installRuntimeAccounts();
```

(impor `import { installRuntimeAccounts } from "./services/runtime-accounts/install";`). Pastikan baris ini berada sebelum panggilan `resumeReconciledSessions(…)` (±:161).

- [x] **Step 8: Route terminal — validasi & teruskan akun**

Di `server/src/routes/terminal.ts`:

1. Impor: `import { AccountError } from "../services/runtime-accounts/registry";` dan `import { assertLaunchAccount } from "../services/runtime-accounts/resolver";`
2. Cabang backlog: tepat sesudah `const agent = parsed.data.agent ?? setting.agent;`:
   ```ts
           await assertLaunchAccount(agent, parsed.data.account);   // ADR-0234
   ```
   Panggilan `startSpecSession(launchable, { … })`: tambahkan `accountId: parsed.data.account,   // ADR-0234` sesudah baris `agent: parsed.data.agent,`.
   Di blok `catch (e)` cabang ini, sebagai cabang PERTAMA:
   ```ts
         if (e instanceof AccountError) return reply.code(e.status).send({ error: e.code, message: e.message });
   ```
3. Cabang terminal agen biasa: sesudah `const { agent, model, effort } = await terminalAgentDefaults(parsed.data);`:
   ```ts
       // ADR-0234 · akun pilihan form "Sesi baru".
       try { await assertLaunchAccount(agent, parsed.data.account); }
       catch (e) {
         if (e instanceof AccountError) return reply.code(e.status).send({ error: e.code, message: e.message });
         throw e;
       }
   ```
   `createSession(project.id, wt, { id, agent, model, effort, branch })` → tambahkan `accountId: parsed.data.account`. `createOperatorSession(project.id, repoDir, { agent, model, effort }, …)` → `{ agent, model, effort, accountId: parsed.data.account }`.

- [x] **Step 9: Allowlist transkrip**

Di `server/src/services/agent-invocations.ts:67-70`:

```ts
const transcriptRoots = (): string[] => [
  resolve(process.env.CLAUDE_CONFIG_DIR ?? `${homedir()}/.claude`),
  resolve(process.env.CODEX_HOME ?? `${homedir()}/.codex`),
  // ADR-0234 · home akun runtime (CLAUDE_CONFIG_DIR/CODEX_HOME per sesi). Transkrip claude akun lewat
  // symlink `projects/` tetap berada di bawah akar ini.
  resolve(accountsRoot()),
];
```

(impor `import { accountsRoot } from "./runtime-accounts/paths";`).

- [x] **Step 10: Test route terminal menolak akun tak sah**

Tambahkan ke `server/test/runtime-accounts-launch.test.ts`:

```ts
import { buildApp } from "../src/app";

describe("POST /terminal/sessions + account", () => {
  const app = buildApp({ requireAuth: false });
  afterAll(async () => { await app.close(); });

  it("akun tak dikenal → 404 account-not-found sebelum sesi lahir", async () => {
    const p = await prisma.project.findFirst();
    if (!p) return;   // tanpa project di DB test, cabang ini tak terjangkau — test di atas sudah membuat "p"
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: p.id, agent: "claude", account: "deadbeef" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "account-not-found" });
  });
});
```

Bila project `p` tak punya `LocalBinding`, route menjawab 400 `needsBind` sebelum mencapai validasi akun — dalam kasus itu buat binding seperti test route terminal lain (`grep -rn "localBinding.create" server/test | head -2`) supaya cabang akun benar-benar teruji.

- [x] **Step 11: Jalankan test**

Run: SRV `server/test/runtime-accounts-launch.test.ts server/test/pty-parse.test.ts server/test/runtime-accounts-registry.test.ts`
Expected: PASS.
Run juga test yang sudah ada di jalur ini: SRV `server/test/session-boot-resume.test.ts server/test/session-history.test.ts` (path persis: `ls server/test | grep -E "boot-resume|session-history"`).
Expected: PASS (atau gagal yang sama persis dengan baseline `main`).
Run: `pnpm --filter ./server typecheck`.

- [x] **Step 12: Commit**

```bash
/usr/bin/git add server/src/services/pty.ts server/test/pty-parse.test.ts server/src/services/session-history.ts \
  server/src/services/session-launch.ts server/src/services/session-boot-resume.ts server/src/routes/terminal.ts \
  server/src/services/agent-invocations.ts server/src/server.ts server/src/services/runtime-accounts/login.ts \
  server/src/services/runtime-accounts/install.ts server/test/runtime-accounts-launch.test.ts \
  docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): sesi lahir dengan akun runtime, dipatok ke riwayat & resume (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: REST `/runtime-accounts`, sesi login, capability & MCP

**Files:**
- Create: `server/src/routes/runtime-accounts.ts`, `server/test/runtime-accounts.route.test.ts`
- Modify: `server/src/services/runtime-accounts/login.ts` (perintah & sesi login), `server/src/app.ts:25,282`, `server/src/services/agent-capabilities.ts:182`, `server/test/mcp-coverage.test.ts` (`UNWRAPPED`), `shared/src/mcp-catalog/settings.ts`, `shared/src/mcp-catalog/sessions.ts:162-224`, `docs/agent-integration.md`, `internal/docs/architecture/api-contract.md`

**Interfaces:**
- Consumes: registry, resolver (Task 4), `loginSessionId` (Task 5), `createOperatorSession` (`session-launch-gate.ts:64`), `agentBin` (Task 3), `listSessions` (pty).
- Produces:
  - Route: `GET /runtime-accounts` → `RuntimeAccountsListDTO`; `POST /runtime-accounts` `{runtime,label}` → 201 `RuntimeAccountDTO`; `PATCH /runtime-accounts/:id` `{label}` → 200; `DELETE /runtime-accounts/:id` → 204; `PUT /runtime-accounts/default` `{runtime,accountId}` → 200 `RuntimeAccountsListDTO`; `POST /runtime-accounts/:id/login` `{deviceAuth?}` → 201 `{ id }`; `POST /runtime-accounts/:id/check` → 200 `RuntimeAccountDTO`.
  - `loginArgv(runtime, opts): string[]`, `openLoginSession(accountId, opts): Promise<{ id: string }>`
  - MCP: `hanoman_runtime_accounts_list`, `hanoman_runtime_account_default_set`; `hanoman_session_create.account`.

- [x] **Step 1: Tulis test route yang gagal**

Create `server/test/runtime-accounts.route.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { refreshSnapshot } from "../src/services/runtime-accounts/registry";
import { loginArgv } from "../src/services/runtime-accounts/login";

const home = mkdtempSync(join(tmpdir(), "ra-route-"));
const prev = process.env.HANOMAN_HOME;
process.env.HANOMAN_HOME = home;
const app = buildApp({ requireAuth: false });
afterAll(async () => { await app.close(); process.env.HANOMAN_HOME = prev; rmSync(home, { recursive: true, force: true }); });
beforeEach(async () => { await prisma.runtimeAccount.deleteMany(); await prisma.setting.deleteMany(); await refreshSnapshot(); });

describe("/api/runtime-accounts", () => {
  it("GET → 3 akun bawaan + flag sandbox", async () => {
    const res = await app.inject({ method: "GET", url: "/api/runtime-accounts" });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts.map((a: { id: string }) => a.id)).toEqual(["default:claude", "default:codex", "default:antigravity"]);
    expect(typeof res.json().sandbox).toBe("boolean");
  });

  it("POST → 201; body cacat → 400; label sama → 409", async () => {
    const ok = await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "codex", label: "Kantor" } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ runtime: "codex", label: "Kantor", status: "belum-login" });
    expect((await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "x", label: "" } })).statusCode).toBe(400);
    const dup = await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "codex", label: "Kantor" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "account-label-taken" });
  });

  it("PATCH/DELETE akun bawaan → 400; id asing → 404", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/runtime-accounts/default%3Aclaude" })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/runtime-accounts/default%3Aclaude", payload: { label: "X" } })).statusCode).toBe(400);
    const nf = await app.inject({ method: "DELETE", url: "/api/runtime-accounts/deadbeef" });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toMatchObject({ error: "account-not-found" });
  });

  it("PATCH ganti label, DELETE → 204", async () => {
    const id = (await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "claude", label: "A" } })).json().id;
    const p = await app.inject({ method: "PATCH", url: `/api/runtime-accounts/${id}`, payload: { label: "B" } });
    expect(p.json()).toMatchObject({ label: "B" });
    expect((await app.inject({ method: "DELETE", url: `/api/runtime-accounts/${id}` })).statusCode).toBe(204);
  });

  it("PUT default: akun bawaan selalu boleh; runtime salah → 409", async () => {
    const id = (await app.inject({ method: "POST", url: "/api/runtime-accounts", payload: { runtime: "claude", label: "A" } })).json().id;
    const bad = await app.inject({ method: "PUT", url: "/api/runtime-accounts/default", payload: { runtime: "codex", accountId: id } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toMatchObject({ error: "account-runtime-mismatch" });
    const ok = await app.inject({ method: "PUT", url: "/api/runtime-accounts/default", payload: { runtime: "claude", accountId: "default:claude" } });
    expect(ok.statusCode).toBe(200);
  });

  it("capability: baca & set default terbuka untuk settings:*, sisanya COOKIE_ONLY", () => {
    expect(capabilityForRoute("GET", "/api/runtime-accounts")).toBe("settings:read");
    expect(capabilityForRoute("PUT", "/api/runtime-accounts/default")).toBe("settings:write");
    for (const [m, p] of [["POST", "/api/runtime-accounts"], ["PATCH", "/api/runtime-accounts/x"], ["DELETE", "/api/runtime-accounts/x"],
      ["POST", "/api/runtime-accounts/x/login"], ["POST", "/api/runtime-accounts/x/check"]] as const)
      expect(capabilityForRoute(m, p), `${m} ${p}`).toBe("COOKIE_ONLY");
  });
});

describe("loginArgv", () => {
  it("claude: auth login --claudeai; codex: login [+ --device-auth]", () => {
    expect(loginArgv("claude", {}).slice(1)).toEqual(["auth", "login", "--claudeai"]);
    expect(loginArgv("codex", {}).slice(1)).toEqual(["login"]);
    expect(loginArgv("codex", { deviceAuth: true }).slice(1)).toEqual(["login", "--device-auth"]);
  });
});
```

Run: SRV `server/test/runtime-accounts.route.test.ts`
Expected: FAIL (route 404, `loginArgv` tak ada).

- [x] **Step 2: Perintah & sesi login**

Tambahkan ke `server/src/services/runtime-accounts/login.ts`:

```ts
import { homedir } from "node:os";
import { runtimeOfBuiltin, type RuntimeName } from "@hanoman/shared";
import { agentBin } from "../pty";
import { createOperatorSession } from "../session-launch-gate";
import { prepareAccountHome } from "./home";
import { AccountError } from "./registry";
import { accountEnv } from "./resolver";

/** ADR-0234 · perintah login dirakit SERVER (pola install metode SPEC-739): klien tak pernah mengirim teks perintah. */
export function loginArgv(runtime: RuntimeName, opts: { deviceAuth?: boolean }): string[] {
  if (runtime === "claude") return [agentBin("claude"), "auth", "login", "--claudeai"];
  if (runtime === "codex") return [agentBin("codex"), "login", ...(opts.deviceAuth ? ["--device-auth"] : [])];
  // Antigravity: Task 10 (mode tukar) memasang alurnya sendiri lewat `setAntigravityLogin`.
  return antigravityLogin(opts);
}

let antigravityLogin = (_opts: { deviceAuth?: boolean }): string[] => {
  throw new AccountError("account-not-found", 404, "login Antigravity belum didukung");
};
export function setAntigravityLogin(fn: (opts: { deviceAuth?: boolean }) => string[]): void { antigravityLogin = fn; }

/**
 * Buka sesi terminal login (shell perintah, tanpa agen) di project sintetis `account:<id>` — cermin
 * console VPS `vps-console:<id>`. Exempt dari gerbang kapasitas: ini jendela manusia, bukan agen.
 */
export async function openLoginSession(accountId: string, opts: { deviceAuth?: boolean }): Promise<{ id: string }> {
  const builtin = runtimeOfBuiltin(accountId);
  let runtime: RuntimeName, homeDir: string | null, env: Record<string, string> = {};
  if (builtin) { runtime = builtin; homeDir = null; }
  else {
    const row = accountSnapshot().rows.find((r) => r.id === accountId);
    if (!row) throw new AccountError("account-not-found", 404, `akun ${accountId} tak ditemukan`);
    runtime = row.runtime; homeDir = row.homeDir;
    prepareAccountHome(runtime, homeDir);
    env = accountEnv(runtime, homeDir).env;
  }
  const s = await createOperatorSession(`account:${accountId}`, homeDir ?? homedir(), {
    id: loginSessionId(accountId), command: loginArgv(runtime, opts), env,
  });
  return { id: s.id };
}
```

(gabungkan impor dengan impor yang sudah ada di berkas: `accountSnapshot` dari `./registry` sudah diimpor di Task 5.)

- [x] **Step 3: Route**

Create `server/src/routes/runtime-accounts.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  isBuiltinAccountId, zRuntimeAccountCreate, zRuntimeAccountDefault, zRuntimeAccountLogin, zRuntimeAccountPatch,
} from "@hanoman/shared";
import { listSessions } from "../services/pty";
import { sessionSandboxOn } from "../services/session-sandbox";
import {
  AccountError, checkAccount, createAccount, deleteAccount, listAccountDTOs, renameAccount, setDefaultAccount,
} from "../services/runtime-accounts/registry";
import { openLoginSession } from "../services/runtime-accounts/login";

// ADR-0234 · akun runtime. Baca & set default = settings:*; sisanya COOKIE_ONLY (agent-capabilities.ts).
const fail = (reply: FastifyReply, e: unknown) => {
  if (e instanceof AccountError) return reply.code(e.status).send({ error: e.code, message: e.message });
  throw e;
};
const liveAccountIds = (): string[] =>
  listSessions().filter((s) => !s.exited && s.accountId).map((s) => s.accountId!);
const builtinRefused = (reply: FastifyReply) =>
  reply.code(400).send({ error: "akun bawaan tak bisa diubah atau dihapus" });

export default async function (app: FastifyInstance) {
  app.get("/runtime-accounts", async () => ({ accounts: listAccountDTOs(), sandbox: sessionSandboxOn() }));

  app.post("/runtime-accounts", async (req, reply) => {
    const p = zRuntimeAccountCreate.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return reply.code(201).send(await createAccount(p.data.runtime, p.data.label)); }
    catch (e) { return fail(reply, e); }
  });

  app.patch("/runtime-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isBuiltinAccountId(id)) return builtinRefused(reply);
    const p = zRuntimeAccountPatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return await renameAccount(id, p.data.label); } catch (e) { return fail(reply, e); }
  });

  app.delete("/runtime-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isBuiltinAccountId(id)) return builtinRefused(reply);
    try { await deleteAccount(id, liveAccountIds); return reply.code(204).send(); }
    catch (e) { return fail(reply, e); }
  });

  app.put("/runtime-accounts/default", async (req, reply) => {
    const p = zRuntimeAccountDefault.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try {
      await setDefaultAccount(p.data.runtime, p.data.accountId, sessionSandboxOn());
      return { accounts: listAccountDTOs(), sandbox: sessionSandboxOn() };
    } catch (e) { return fail(reply, e); }
  });

  app.post("/runtime-accounts/:id/login", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zRuntimeAccountLogin.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return reply.code(201).send(await openLoginSession(id, p.data)); } catch (e) { return fail(reply, e); }
  });

  app.post("/runtime-accounts/:id/check", async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return await checkAccount(id); } catch (e) { return fail(reply, e); }
  });
}
```

Di `server/src/app.ts`: impor `import runtimeAccounts from "./routes/runtime-accounts";` di dekat `import limits …` (:25), dan `await api.register(runtimeAccounts);` sesudah `await api.register(limits);` (:282).

- [x] **Step 4: Capability**

Di `server/src/services/agent-capabilities.ts`, tepat sebelum `if (top === "settings" || top === "config") return rw("settings");`:

```ts
  // ADR-0234 · akun runtime. Baca daftar & set default = `settings:*` (cermin setelan sesi). Buat, ganti
  // label, hapus, login, periksa menyentuh kredensial langganan di mesin ini atau butuh manusia di
  // browser OAuth → COOKIE_ONLY. Dicocokkan ke method + panjang segmen (kelas bug SPEC-405).
  if (top === "runtime-accounts") {
    if (read && seg.length === 1) return "settings:read";
    if (method === "PUT" && seg.length === 2 && seg[1] === "default") return "settings:write";
    return "COOKIE_ONLY";
  }
```

- [x] **Step 5: MCP — tool baru, parameter `account`, UNWRAPPED**

Di `shared/src/mcp-catalog/settings.ts`, tambahkan dua elemen di akhir `SETTINGS_TOOLS`:

```ts
  {
    name: "hanoman_runtime_accounts_list",
    title: "Daftar akun runtime",
    description:
      "Akun langganan Claude Code/Codex/Antigravity yang terdaftar di mesin ini — termasuk akun bawaan `default:<runtime>` — dengan status login (belum-login|aktif|perlu-login-ulang), email & paket, drift konfigurasi, dan akun mana yang jadi default tiap runtime. `id`-nya dipakai di `account` pada hanoman_session_create. Menambah/menghapus/login akun hanya lewat dashboard.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "settings:read",
    samplePath: "/runtime-accounts", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/runtime-accounts" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_runtime_account_default_set",
    title: "Set akun default runtime",
    description:
      "Menjadikan satu akun sebagai default runtime-nya untuk SETIAP sesi baru di mesin ini, termasuk sesi otomatis (scheduler, lead, reverse/prd). `accountId` dari hanoman_runtime_accounts_list; `default:<runtime>` mengembalikan ke akun bawaan. Sesi yang sedang berjalan tak berubah. Ditolak 409 bila runtime akun tak cocok atau sandbox sesi aktif (hanya akun bawaan).",
    inputSchema: obj({
      properties: {
        runtime: enumStr(["claude", "codex", "antigravity"], "Runtime yang default-nya diubah."),
        accountId: str("Id akun dari hanoman_runtime_accounts_list."),
      },
      required: ["runtime", "accountId"],
    }),
    mode: "write", capability: "settings:write",
    samplePath: "/runtime-accounts/default", sampleMethod: "PUT",
    build: (a) => ({ method: "PUT", path: "/runtime-accounts/default", body: { runtime: String(a.runtime), accountId: String(a.accountId) } }),
    shape: (raw) => raw,
  },
```

Di `shared/src/mcp-catalog/sessions.ts` (`hanoman_session_create`):

1. `properties`: sesudah `agent: enumStr([...]),` tambahkan
   ```ts
           account: str("Id akun runtime dari hanoman_runtime_accounts_list. Kosong = akun default runtime di mesin ini."),
   ```
2. `build`: daftar `["model", "effort", "goalCondition", "agent", "verifyScope", "method"]` → tambahkan `"account"`; daftar `["agent", "model", "effort", "branchFrom"]` → tambahkan `"account"`.

Di `server/test/mcp-coverage.test.ts`, di dalam `UNWRAPPED` (sesudah entri `/auth/*`):

```ts
  // ADR-0234 · akun runtime: menyentuh kredensial langganan di mesin ini; login butuh manusia di browser
  // OAuth. Semuanya COOKIE_ONLY di capabilityForRoute.
  ["POST /runtime-accounts", "membuat direktori kredensial akun langganan di mesin ini — pengelolaan kredensial milik manusia"],
  ["PATCH /runtime-accounts/:id", "mengelola akun kredensial (label) — milik manusia di dashboard, cermin POST"],
  ["DELETE /runtime-accounts/:id", "menghapus kredensial akun langganan (direktori + Keychain) — tak boleh didelegasikan"],
  ["POST /runtime-accounts/:id/login", "membuka sesi login OAuth yang hanya bisa diselesaikan manusia di browser"],
  ["POST /runtime-accounts/:id/check", "menjalankan CLI agen untuk membaca status login kredensial — bagian alur login manusia"],
```

- [x] **Step 6: Dokumentasi kontrak**

Di `internal/docs/architecture/api-contract.md`, dekat baris `GET /limits/antigravity …` (:800) tambahkan:

```text
GET      /limits/accounts               # AccountLimitsDTO[] — limit per akun runtime, TANPA email (ADR-0234)
GET      /runtime-accounts              # RuntimeAccountsListDTO { accounts[], sandbox }  settings:read (ADR-0234)
POST     /runtime-accounts              # {runtime,label} → 201 RuntimeAccountDTO          COOKIE_ONLY
PATCH    /runtime-accounts/:id          # {label} → RuntimeAccountDTO                      COOKIE_ONLY
DELETE   /runtime-accounts/:id          # 204 · 409 account-in-use                         COOKIE_ONLY
PUT      /runtime-accounts/default      # {runtime,accountId} → RuntimeAccountsListDTO     settings:write
POST     /runtime-accounts/:id/login    # {deviceAuth?} → 201 {id} sesi terminal login     COOKIE_ONLY
POST     /runtime-accounts/:id/check    # → RuntimeAccountDTO (status login terbaru)       COOKIE_ONLY
```

dan tambahkan `account?` pada deskripsi body `POST /terminal/sessions` (backlog & terminal agen), plus kode error akun dari Global Constraints. Pada baris `> **Read-only global** (…)` (:921) tambahkan `/limits/accounts` ke daftarnya.

Di `docs/agent-integration.md`, pada tabel route→capability (sekitar :316), tambahkan:

```markdown
| `GET /api/runtime-accounts` | `settings:read` | akun runtime per mesin (tool `hanoman_runtime_accounts_list`). Memuat email. |
| `PUT /api/runtime-accounts/default` | `settings:write` | default akun per runtime (tool `hanoman_runtime_account_default_set`). |
| `GET /api/limits/accounts` | — (GLOBAL_READ) | limit per akun, tanpa email (tool `hanoman_limits_accounts`). |
```

dan satu kalimat di bawah paragraf Settings: "`hanoman_session_create` menerima `account` (id dari `hanoman_runtime_accounts_list`); buat/hapus/login akun hanya lewat dashboard (ADR-0234)."

- [x] **Step 7: Jalankan test**

Run: SRV `server/test/runtime-accounts.route.test.ts server/test/mcp-coverage.test.ts`
Run: WEB `shared/src/mcp-catalog.team.test.ts`
Expected: PASS. (`hanoman_limits_accounts` belum ada — ia lahir di Task 7 bersama route-nya.)
Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`.

- [x] **Step 8: Commit**

```bash
/usr/bin/git add server/src/routes/runtime-accounts.ts server/src/app.ts server/src/services/agent-capabilities.ts \
  server/src/services/runtime-accounts/login.ts server/test/runtime-accounts.route.test.ts server/test/mcp-coverage.test.ts \
  shared/src/mcp-catalog/settings.ts shared/src/mcp-catalog/sessions.ts docs/agent-integration.md \
  internal/docs/architecture/api-contract.md docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): REST /runtime-accounts, sesi login, capability & MCP (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Limit per akun + grup siar `accountLimits`

**Files:**
- Create: `server/src/services/runtime-accounts/limits.ts`, `server/test/runtime-accounts-limits.test.ts`
- Modify: `server/src/services/limits.ts` (ekspor `mapWindows`, `fetchClaudeWindows`, delegasi keychain), `server/src/services/antigravity-limits.ts` (ekspor `parseAgyToken`, `fetchAgyWindows`), `server/src/routes/limits.ts`, `server/src/services/events.ts:107`, `shared/src/mcp-catalog/system.ts`, `shared/src/mcp-catalog.team.test.ts:101`

**Interfaces:**
- Consumes: `listAccountDTOs`, `accountSnapshot` (Task 4); `claudeKeychainService`, `readClaudeKeychainToken` (Task 3).
- Produces:
  - `limits.ts`: `export function mapWindows(json: unknown): LimitWindow[]`; `export async function fetchClaudeWindows(token: string, fetchImpl?: typeof fetch): Promise<LimitWindow[] | null>`
  - `antigravity-limits.ts`: `export function parseAgyToken(raw: string): AgyToken | null`; `export async function fetchAgyWindows(tok: AgyToken, project: string | null, f: typeof fetch): Promise<LimitWindow[] | null>`
  - `runtime-accounts/limits.ts`: `readClaudeAccountToken(homeDir, platform?)`, `type AccountLimitsDeps`, `getAccountLimits(deps?): Promise<AccountLimitsDTO[]>`, `setAntigravityAccountLimits(fn)` (Task 10), `_resetAccountLimitsCache()`
  - `GET /limits/accounts`; frame `{ t: "accountLimits", accounts }`; tool `hanoman_limits_accounts`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/runtime-accounts-limits.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { LimitsDTO } from "@hanoman/shared";
import { _setAccountSnapshot } from "../src/services/runtime-accounts/registry";
import { _resetAccountLimitsCache, getAccountLimits, type AccountLimitsDeps } from "../src/services/runtime-accounts/limits";

const W = (pct: number) => [{ key: "session", label: "Sesi 5 jam", usedPct: pct, resetsAt: null, severity: "normal" as const, isActive: true }];
const OK = (pct: number): LimitsDTO => ({ status: "ok", windows: W(pct), fetchedAt: "2026-11-01T00:00:00.000Z" });
const row = (id: string, runtime: "claude" | "codex") =>
  ({ id, runtime, label: id, homeDir: `/h/${id}`, identity: { email: "rahasia@x.id" }, status: "aktif" as const, createdAt: new Date(), lastLoginAt: null });

let now = 1_000_000;
const deps = (over: Partial<AccountLimitsDeps> = {}): AccountLimitsDeps => ({
  now: () => now, fetchEnabled: true,
  builtin: { claude: async () => OK(10), codex: async () => OK(20), antigravity: async () => ({ status: "unavailable", windows: [], fetchedAt: null }) },
  claudeToken: () => "tok", claudeWindows: async () => W(55), codexLimits: async () => OK(66),
  antigravity: async () => ({ status: "unavailable", windows: [], fetchedAt: null }),
  ...over,
});

beforeEach(() => { _resetAccountLimitsCache(); now = 1_000_000; _setAccountSnapshot({ rows: [row("aaaaaaaa", "claude"), row("bbbbbbbb", "codex")], defaults: { claude: "aaaaaaaa" } }); });

describe("getAccountLimits", () => {
  it("bawaan + akun, default ditandai, TANPA email", async () => {
    const out = await getAccountLimits(deps());
    expect(out.map((a) => [a.accountId, a.limits.windows[0]?.usedPct ?? null, a.isDefault])).toEqual([
      ["default:claude", 10, false], ["aaaaaaaa", 55, true],
      ["default:codex", 20, true], ["bbbbbbbb", 66, false],
      ["default:antigravity", null, true],
    ]);
    expect(JSON.stringify(out)).not.toContain("rahasia@x.id");
  });

  it("cache 30 dtk per akun; gagal sesudahnya → data terakhir sebagai stale", async () => {
    let calls = 0;
    const d = deps({ claudeWindows: async () => (++calls === 1 ? W(55) : null) });
    await getAccountLimits(d);
    await getAccountLimits(d);
    expect(calls).toBe(1);
    now += 31_000;
    const out = await getAccountLimits(d);
    expect(out.find((a) => a.accountId === "aaaaaaaa")!.limits).toMatchObject({ status: "stale", windows: W(55) });
  });

  it("token tak terbaca → unavailable; fetch dimatikan → unavailable tanpa memanggil apa pun", async () => {
    expect((await getAccountLimits(deps({ claudeToken: () => null }))).find((a) => a.accountId === "aaaaaaaa")!.limits.status).toBe("unavailable");
    let called = false;
    await getAccountLimits(deps({ fetchEnabled: false, claudeWindows: async () => { called = true; return W(1); } }));
    expect(called).toBe(false);
  });

  it("codex membaca <homeDir>/sessions", async () => {
    let dir = "";
    await getAccountLimits(deps({ codexLimits: async (d) => { dir = d; return OK(1); } }));
    expect(dir).toBe("/h/bbbbbbbb/sessions");
  });
});
```

Run: SRV `server/test/runtime-accounts-limits.test.ts`
Expected: FAIL — modul tak ada.

- [x] **Step 2: Refactor `services/limits.ts`**

1. `function mapWindows(json: unknown)` → `export function mapWindows(json: unknown)`.
2. Tambahkan (sesudah `mapWindows`):
   ```ts
   /** ADR-0234 · satu panggilan usage untuk token tertentu. null = gagal/ditolak; pemanggil memutuskan stale/unavailable. */
   export async function fetchClaudeWindows(token: string, fetchImpl: typeof fetch = fetch): Promise<LimitWindow[] | null> {
     try {
       const res = await fetchImpl(USAGE_URL, {
         headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
         signal: AbortSignal.timeout(5000),
       });
       if (!res.ok) return null;
       return mapWindows(await res.json());
     } catch { return null; }
   }
   ```
3. `fetchUsage()` jadi:
   ```ts
   async function fetchUsage(): Promise<LimitsDTO> {
     const token = readAccessToken();
     if (!token) return fallback();
     const windows = await fetchClaudeWindows(token);
     if (!windows) return fallback();
     const dto: LimitsDTO = { status: "ok", windows, fetchedAt: nowIso() };
     lastOk = dto;
     return dto;
   }
   ```
4. `keychainAccessToken` jadi delegasi (signature & perilaku tetap; test lama tetap lulus):
   ```ts
   export function keychainAccessToken(run: SecurityRun = securityRun, account = osAccount()): string | null {
     return readClaudeKeychainToken("Claude Code-credentials", run, account);
   }
   ```
   dengan impor `import { readClaudeKeychainToken } from "./runtime-accounts/keychain";`.

- [x] **Step 3: Refactor `services/antigravity-limits.ts`**

1. Pecah `readAgyToken`:
   ```ts
   /** ADR-0234 · parse isi Keychain/slot agy (`go-keyring-base64:` opsional) → token akses + kedaluwarsa. */
   export function parseAgyToken(raw: string): AgyToken | null {
     try {
       let s = raw.trim();
       const prefix = "go-keyring-base64:";
       if (s.startsWith(prefix)) s = Buffer.from(s.slice(prefix.length), "base64").toString("utf8");
       const tok = (JSON.parse(s) as { token?: { access_token?: unknown; expiry?: unknown } })?.token;
       if (typeof tok?.access_token !== "string" || !tok.access_token) return null;
       const expiry = typeof tok.expiry === "string" ? Date.parse(tok.expiry) : NaN;
       return { accessToken: tok.access_token, expiry: Number.isFinite(expiry) ? expiry : null };
     } catch { return null; }
   }

   export function readAgyToken(run: SecurityRun = securityRun): AgyToken | null {
     try { return parseAgyToken(run(["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"])); }
     catch { return null; }
   }
   ```
2. Pecah panggilan jaringan di `fetchQuota`:
   ```ts
   /** ADR-0234 · satu panggilan kuota untuk token tertentu. null = gagal / bentuk tak dikenali. */
   export async function fetchAgyWindows(tok: AgyToken, project: string | null, f: typeof fetch): Promise<LimitWindow[] | null> {
     try {
       const res = await f(QUOTA_URL, {
         method: "POST",
         headers: { authorization: `Bearer ${tok.accessToken}`, "content-type": "application/json", "user-agent": USER_AGENT },
         body: JSON.stringify(project ? { project } : {}),
         signal: AbortSignal.timeout(5000),
       });
       if (!res.ok) return null;
       const windows = mapQuota(await res.json());
       return windows.length ? windows : null;
     } catch { return null; }
   }
   ```
   dan `fetchQuota` memakai `const windows = await fetchAgyWindows(tok, project, deps.fetch); if (!windows) return fallback();` di tempat blok `try { … }` lamanya.
3. Ekspor `defaultProject` (`export function defaultProject()`) dan konstanta `EXPIRY_SKEW_MS` (`export const`), dipakai Task 10.

Run: SRV `server/test/limits.route.test.ts` dan test limit lama (`ls server/test | grep -E "limits|antigravity"`) → PASS tanpa diubah.

- [x] **Step 4: Implementasi `runtime-accounts/limits.ts`**

Create `server/src/services/runtime-accounts/limits.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountLimitsDTO, LimitWindow, LimitsDTO } from "@hanoman/shared";
import { effectiveStr } from "../../config";
import { fetchClaudeWindows, getLimits } from "../limits";
import { getCodexLimits } from "../codex-limits";
import { getAntigravityLimits } from "../antigravity-limits";
import { claudeKeychainService, readClaudeKeychainToken } from "./keychain";
import { accountSnapshot, listAccountDTOs, type AccountRow } from "./registry";

// ADR-0234 · limit per akun runtime. Sumbernya SAMA dengan limit bawaan (usage API claude, rollout codex,
// quota API agy), hanya diarahkan ke kredensial/home akun. Tak pernah me-refresh token: akun menganggur
// → token kedaluwarsa → `stale` (data terakhir) atau `unavailable`. Akun bawaan memakai service lama
// apa adanya (cache & fallback-nya sendiri).
const TTL_MS = 30_000;
const UNAVAILABLE: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };

export type AccountLimitsDeps = {
  now: () => number;
  /** `HANOMAN_ACCOUNT_LIMITS_FETCH=0` mematikan semua bacaan akun non-bawaan (suite test di macOS operator). */
  fetchEnabled: boolean;
  builtin: { claude: () => Promise<LimitsDTO>; codex: () => Promise<LimitsDTO>; antigravity: () => Promise<LimitsDTO> };
  claudeToken: (homeDir: string) => string | null;
  claudeWindows: (token: string) => Promise<LimitWindow[] | null>;
  codexLimits: (sessionsDir: string) => Promise<LimitsDTO>;
  antigravity: (row: AccountRow) => Promise<LimitsDTO>;
};

export function readClaudeAccountToken(homeDir: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "darwin") {
    const t = readClaudeKeychainToken(claudeKeychainService(homeDir));
    if (t) return t;
  }
  try {
    const t: unknown = JSON.parse(readFileSync(join(homeDir, ".credentials.json"), "utf8"))?.claudeAiOauth?.accessToken;
    return typeof t === "string" && t ? t : null;
  } catch { return null; }
}

let antigravityAccount = async (_row: AccountRow): Promise<LimitsDTO> => UNAVAILABLE;
/** Task 10 memasang pembaca limit slot agy. */
export function setAntigravityAccountLimits(fn: (row: AccountRow) => Promise<LimitsDTO>): void { antigravityAccount = fn; }

const prodDeps = (): AccountLimitsDeps => ({
  now: Date.now,
  fetchEnabled: effectiveStr("HANOMAN_ACCOUNT_LIMITS_FETCH") !== "0",
  builtin: { claude: getLimits, codex: () => getCodexLimits(), antigravity: getAntigravityLimits },
  claudeToken: (h) => readClaudeAccountToken(h),
  claudeWindows: (t) => fetchClaudeWindows(t),
  codexLimits: (d) => getCodexLimits(d),
  antigravity: (row) => antigravityAccount(row),
});

type Entry = { last: LimitsDTO; freshUntil: number };
const cache = new Map<string, Entry>();
export function _resetAccountLimitsCache(): void { cache.clear(); }

async function cached(key: string, now: number, load: () => Promise<LimitsDTO>): Promise<LimitsDTO> {
  const e = cache.get(key);
  if (e && now < e.freshUntil) return e.last;
  const dto = await load();
  if (dto.status !== "unavailable") { cache.set(key, { last: dto, freshUntil: now + TTL_MS }); return dto; }
  return e ? { ...e.last, status: "stale" } : dto;
}

async function loadRow(row: AccountRow, d: AccountLimitsDeps): Promise<LimitsDTO> {
  if (row.runtime === "claude") {
    const tok = d.claudeToken(row.homeDir);
    if (!tok) return UNAVAILABLE;
    const windows = await d.claudeWindows(tok);
    return windows ? { status: "ok", windows, fetchedAt: new Date(d.now()).toISOString() } : UNAVAILABLE;
  }
  if (row.runtime === "codex") {
    const c = await d.codexLimits(join(row.homeDir, "sessions"));
    return { status: c.status, windows: c.windows, fetchedAt: c.fetchedAt };
  }
  return d.antigravity(row);
}

export async function getAccountLimits(deps: AccountLimitsDeps = prodDeps()): Promise<AccountLimitsDTO[]> {
  const rows = new Map(accountSnapshot().rows.map((r) => [r.id, r]));
  return Promise.all(listAccountDTOs().map(async (a): Promise<AccountLimitsDTO> => {
    let limits: LimitsDTO;
    if (a.builtin) {
      const b = await deps.builtin[a.runtime]();
      limits = { status: b.status, windows: b.windows, fetchedAt: b.fetchedAt };
    } else if (!deps.fetchEnabled) limits = UNAVAILABLE;
    else limits = await cached(a.id, deps.now(), () => loadRow(rows.get(a.id)!, deps));
    return { accountId: a.id, runtime: a.runtime, label: a.label, builtin: a.builtin, isDefault: a.isDefault, loginStatus: a.status, limits };
  }));
}
```

- [x] **Step 5: Route, grup siar, tool MCP**

`server/src/routes/limits.ts`: impor `getAccountLimits` dari `../services/runtime-accounts/limits` dan tambahkan:

```ts
  // ADR-0234 · limit per akun runtime (bawaan + terdaftar). GLOBAL_READ → DTO sengaja tanpa email.
  app.get("/limits/accounts", async () => getAccountLimits());
```

`server/src/services/events.ts`, sesudah grup `antigravityLimits` (:107):

```ts
  // ADR-0234 · limit per akun runtime — grup TERPISAH. Akun bawaan memakai cache service lama; akun
  // terdaftar ber-cache 30 dtk per akun. Dedup signature: frame lahir saat isinya berubah.
  { everyTicks: 30, last: "", build: async () => ({ t: "accountLimits", accounts: await getAccountLimits() }) },
```

(impor `getAccountLimits`). Suite test server harus tetap tanpa jaringan: di `server/vitest.config.ts`, di blok `env` yang sudah memuat `HANOMAN_ANTIGRAVITY_LIMITS_FETCH` (cari dengan `grep -n LIMITS_FETCH server/vitest.config.ts server/test/*.ts | head`), tambahkan `HANOMAN_ACCOUNT_LIMITS_FETCH: "0"` di tempat yang sama. Bila nilai itu diset per berkas test, tambahkan baris yang sama di `server/test/limits.route.test.ts`.

`shared/src/mcp-catalog/system.ts`, tambahkan elemen (sesudah `hanoman_limits_antigravity`):

```ts
  {
    name: "hanoman_limits_accounts",
    title: "Limit langganan per akun runtime",
    description:
      "Limit (window 5 jam, mingguan, dst) untuk SETIAP akun runtime terdaftar di mesin ini — Claude, Codex, Antigravity — termasuk akun bawaan `default:<runtime>`. Tanpa email. `limits.status` stale = data terakhir (akun belum dipakai sejak tokennya kedaluwarsa); window yang `resetsAt`-nya sudah lewat berarti sudah reset. `isDefault` menandai akun yang dipakai sesi baru.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/limits/accounts", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/limits/accounts" }),
    shape: (raw) => raw,
  },
```

`shared/src/mcp-catalog.team.test.ts:101`: tambahkan `"hanoman_limits_accounts"` ke array `names`.

- [x] **Step 6: Jalankan test**

Run: SRV `server/test/runtime-accounts-limits.test.ts server/test/limits.route.test.ts server/test/mcp-coverage.test.ts`
Run: SRV untuk test events yang ada (`ls server/test | grep -i event` → jalankan yang menguji `/events/ws`).
Run: WEB `shared/src/mcp-catalog.team.test.ts`
Expected: PASS.
Run: `pnpm --filter ./server typecheck && pnpm --filter ./shared typecheck`.

- [x] **Step 7: Commit**

```bash
/usr/bin/git add server/src/services/runtime-accounts/limits.ts server/src/services/limits.ts server/src/services/antigravity-limits.ts \
  server/src/routes/limits.ts server/src/services/events.ts server/vitest.config.ts server/test/runtime-accounts-limits.test.ts \
  shared/src/mcp-catalog/system.ts shared/src/mcp-catalog.team.test.ts docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): limit per akun runtime + grup siar accountLimits (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Tambahkan `server/test/limits.route.test.ts` ke `git add` bila diubah di Step 5.)

---

### Task 8: Web — klien API, store limit akun, panel Settings

**Files:**
- Create: `src/src/api/account-limits.ts`, `src/src/screens/settings/RuntimeAccounts.tsx`, `src/src/screens/styles/accounts.css`, `src/src/screens/settings/RuntimeAccounts.test.tsx`
- Modify: `src/src/api/client.ts` (fungsi baru; `createTerminal` & `startSession` menerima `account`), `src/src/screens/settings/SessionSettings.tsx` (render kartu sesudah kartu "Agen & model")

**Interfaces:**
- Consumes: `RuntimeAccountDTO`, `RuntimeAccountsListDTO`, `AccountLimitsDTO`, `paths.*` (Task 1); endpoint Task 6–7.
- Produces:
  - `api.listRuntimeAccounts()`, `api.createRuntimeAccount({runtime,label})`, `api.renameRuntimeAccount(id,label)`, `api.deleteRuntimeAccount(id)`, `api.setDefaultRuntimeAccount(runtime,accountId)`, `api.loginRuntimeAccount(id,opts?)`, `api.checkRuntimeAccount(id)`, `api.getAccountLimits()`
  - `useAccountLimits(): AccountLimitsDTO[]`, `loadAccountLimits(): Promise<AccountLimitsDTO[]>` (tak pernah melempar), `_resetAccountLimitsStore()`
  - `<RuntimeAccounts onToast? />`

- [x] **Step 1: Klien API**

Di `src/src/api/client.ts` (impor tipe `RuntimeAccountDTO, RuntimeAccountsListDTO, AccountLimitsDTO` dari `@hanoman/shared`), di objek `createApi`, sesudah `getLimits: …`:

```ts
  // ADR-0234 · akun runtime & limit per akun.
  getAccountLimits: () => j<AccountLimitsDTO[]>(paths.limitsAccounts),
  listRuntimeAccounts: () => j<RuntimeAccountsListDTO>(paths.runtimeAccounts),
  createRuntimeAccount: (b: { runtime: Agent; label: string }) =>
    j<RuntimeAccountDTO>(paths.runtimeAccounts, { method: "POST", ...body(b) }),
  renameRuntimeAccount: (id: string, label: string) =>
    j<RuntimeAccountDTO>(paths.runtimeAccount(id), { method: "PATCH", ...body({ label }) }),
  deleteRuntimeAccount: (id: string) => j<void>(paths.runtimeAccount(id), { method: "DELETE" }),
  setDefaultRuntimeAccount: (runtime: Agent, accountId: string) =>
    j<RuntimeAccountsListDTO>(paths.runtimeAccountsDefault, { method: "PUT", ...body({ runtime, accountId }) }),
  loginRuntimeAccount: (id: string, opts?: { deviceAuth?: boolean }) =>
    j<{ id: string }>(paths.runtimeAccountLogin(id), { method: "POST", ...body(opts ?? {}) }),
  checkRuntimeAccount: (id: string) => j<RuntimeAccountDTO>(paths.runtimeAccountCheck(id), { method: "POST", ...body({}) }),
```

`createTerminal` opts: tambahkan `account?: string` ke tipe. `startSession` body: tambahkan `account?: string` ke tipe parameternya.

- [x] **Step 2: Store limit akun**

Create `src/src/api/account-limits.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { AccountLimitsDTO } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";
import { api } from "./client";

// ADR-0234 · store limit per akun — cermin api/antigravity-limits.ts (singleton ref-count di atas satu WS
// siar), berlangganan grup `accountLimits`.
let state: AccountLimitsDTO[] = [];
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => {
      if (m.t === "accountLimits") { state = m.accounts; for (const s of subs) s(); }
    });
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && unsub) { unsub(); unsub = undefined; }
  };
}

export function useAccountLimits(): AccountLimitsDTO[] {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/**
 * Muat sekali lewat HTTP untuk form (Start / Sesi baru). TAK PERNAH melempar: test yang me-mock `api`
 * sebagian tanpa `getAccountLimits` (kelas jebakan SPEC-884) cukup melihat field Akun tersembunyi.
 */
export async function loadAccountLimits(): Promise<AccountLimitsDTO[]> {
  try { return await Promise.resolve().then(() => api.getAccountLimits()); } catch { return []; }
}

export function _resetAccountLimitsStore(): void { state = []; }
```

- [x] **Step 3: Tulis test panel yang gagal**

Create `src/src/screens/settings/RuntimeAccounts.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RuntimeAccountDTO } from "@hanoman/shared";

const acc = (o: Partial<RuntimeAccountDTO>): RuntimeAccountDTO => ({
  id: "default:claude", runtime: "claude", label: "Default", builtin: true, isDefault: true, status: "aktif",
  identity: null, drift: [], createdAt: null, lastLoginAt: null, ...o,
});
const list = vi.fn();
const create = vi.fn();
const setDefault = vi.fn();
const login = vi.fn();
const check = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    listRuntimeAccounts: (...a: unknown[]) => list(...a), createRuntimeAccount: (...a: unknown[]) => create(...a),
    setDefaultRuntimeAccount: (...a: unknown[]) => setDefault(...a), loginRuntimeAccount: (...a: unknown[]) => login(...a),
    checkRuntimeAccount: (...a: unknown[]) => check(...a), renameRuntimeAccount: vi.fn(), deleteRuntimeAccount: vi.fn(),
  },
}));
vi.mock("../../api/account-limits", () => ({ useAccountLimits: () => [] }));
import { RuntimeAccounts } from "./RuntimeAccounts";

beforeEach(() => {
  list.mockResolvedValue({ sandbox: false, accounts: [
    acc({}), acc({ id: "a1b2c3d4", label: "Kantor", builtin: false, isDefault: false, status: "belum-login" }),
    acc({ id: "default:codex", runtime: "codex" }),
  ] });
  check.mockImplementation(async (id: string) => acc({ id, label: "Kantor", builtin: false, isDefault: false, status: "belum-login" }));
  create.mockReset(); setDefault.mockReset(); login.mockReset();
});

describe("RuntimeAccounts", () => {
  it("menampilkan akun per runtime dengan status, dan memeriksa ulang akun yang belum login", async () => {
    render(<RuntimeAccounts />);
    expect(await screen.findByText("Kantor")).toBeTruthy();
    expect(screen.getByText("belum login")).toBeTruthy();
    await waitFor(() => expect(check).toHaveBeenCalledWith("a1b2c3d4"));
  });

  it("radio default memanggil setDefaultRuntimeAccount", async () => {
    setDefault.mockResolvedValue({ sandbox: false, accounts: [] });
    render(<RuntimeAccounts />);
    fireEvent.click(await screen.findByRole("radio", { name: /Kantor/ }));
    await waitFor(() => expect(setDefault).toHaveBeenCalledWith("claude", "a1b2c3d4"));
  });

  it("Login membuka sesi terminal login", async () => {
    login.mockResolvedValue({ id: "acct-login-a1b2c3d4" });
    const onToast = vi.fn();
    render(<RuntimeAccounts onToast={onToast} />);
    fireEvent.click(await screen.findByRole("button", { name: "Login Kantor" }));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a1b2c3d4", {}));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Terminal"), "ok", "terminal");
  });

  it("email sama di runtime yang sama → peringatan duplikat", async () => {
    list.mockResolvedValue({ sandbox: false, accounts: [
      acc({ identity: { email: "dena@x.id" } }),
      acc({ id: "a1b2c3d4", label: "Kantor", builtin: false, isDefault: false, identity: { email: "dena@x.id" } }),
    ] });
    render(<RuntimeAccounts />);
    expect(await screen.findByText(/Email sama dengan akun "Default"/)).toBeTruthy();
  });

  it("Tambah akun mengirim runtime + label", async () => {
    create.mockResolvedValue(acc({ id: "ffffffff", label: "Cadangan", builtin: false }));
    render(<RuntimeAccounts />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Tambah akun/ }))[0]!);
    fireEvent.change(screen.getByLabelText("Label akun"), { target: { value: "Cadangan" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan akun" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ runtime: "claude", label: "Cadangan" }));
  });
});
```

Run: WEB `src/src/screens/settings/RuntimeAccounts.test.tsx`
Expected: FAIL — komponen tak ada.

- [x] **Step 4: Komponen panel**

Create `src/src/screens/settings/RuntimeAccounts.tsx`:

```tsx
import React from "react";
import type { Agent, AccountLimitsDTO, RuntimeAccountDTO } from "@hanoman/shared";
import { Button, Callout, Card, Field, Input, Modal, Prose, useConfirm } from "../../ds";
import { api } from "../../api/client";
import { useAccountLimits } from "../../api/account-limits";
import { failureMessage } from "../../lib/report-error";
import "../styles/accounts.css";

// ADR-0234 · akun langganan per runtime. Kredensial tak pernah lewat sini: login berjalan di sesi
// terminal yang dibuka server, dan panel hanya membaca status/identitas yang dilaporkan server.
const RUNTIME_LABEL: Record<Agent, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity" };
const STATUS_LABEL: Record<RuntimeAccountDTO["status"], string> = {
  "aktif": "aktif", "belum-login": "belum login", "perlu-login-ulang": "perlu login ulang",
};
const RUNTIMES: Agent[] = ["claude", "codex", "antigravity"];

function pctOf(limits: AccountLimitsDTO["limits"] | undefined, match: RegExp): string {
  const w = limits?.windows.filter((x) => match.test(x.label)) ?? [];
  if (!w.length) return "—";
  return `${Math.max(...w.map((x) => x.usedPct))}%`;
}

export function RuntimeAccounts({ onToast }: { onToast?: (msg: string, tone: "ok" | "err", icon: string) => void }) {
  const [accounts, setAccounts] = React.useState<RuntimeAccountDTO[] | null>(null);
  const [sandbox, setSandbox] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<Agent | null>(null);
  const [label, setLabel] = React.useState("");
  const limits = useAccountLimits();
  const { confirm, dialog } = useConfirm();

  const reload = React.useCallback(async () => {
    try {
      const r = await api.listRuntimeAccounts();
      setAccounts(r.accounts); setSandbox(r.sandbox); setError(null);
      // Akun yang belum aktif diperiksa ulang tiap panel dibuka / tab kembali fokus — operator baru saja
      // menyelesaikan login di Terminal.
      const pending = r.accounts.filter((a) => !a.builtin && a.status !== "aktif");
      if (pending.length) {
        const fresh = await Promise.all(pending.map((a) => api.checkRuntimeAccount(a.id).catch(() => a)));
        setAccounts((cur) => cur?.map((a) => fresh.find((f) => f.id === a.id) ?? a) ?? cur);
      }
    } catch (e) { setError(failureMessage("memuat akun runtime", e)); }
  }, []);

  React.useEffect(() => {
    void reload();
    const onFocus = () => { void reload(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const act = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) onToast?.(ok, "ok", "check"); await reload(); }
    catch (e) { onToast?.(failureMessage(what, e), "err", "alert-triangle"); }
  };

  const login = (a: RuntimeAccountDTO) => act("membuka login", async () => {
    await api.loginRuntimeAccount(a.id, {});
    onToast?.(`Login ${RUNTIME_LABEL[a.runtime]} · ${a.label} berjalan di Terminal`, "ok", "terminal");
  });

  const remove = async (a: RuntimeAccountDTO) => {
    if (!await confirm({
      title: `Hapus akun "${a.label}"?`,
      message: `Login ${RUNTIME_LABEL[a.runtime]} akun ini dihapus dari mesin ini.`,
      impact: ["Direktori akun & kredensialnya dihapus.", "Skills dan setelan bersama tidak tersentuh."],
      confirmLabel: "Hapus akun", tone: "danger",
    })) return;
    await act("menghapus akun", () => api.deleteRuntimeAccount(a.id), `Akun "${a.label}" dihapus`);
  };

  // Spec §3.4 · email yang sama di runtime yang sama = peringatan, tidak memblokir.
  const dupeOf = (a: RuntimeAccountDTO): RuntimeAccountDTO | undefined => {
    const email = a.identity?.email;
    return email ? accounts?.find((o) => o.runtime === a.runtime && o.id !== a.id && o.identity?.email === email) : undefined;
  };

  const save = async () => {
    if (!adding || !label.trim()) return;
    await act("menambah akun", () => api.createRuntimeAccount({ runtime: adding, label: label.trim() }), `Akun "${label.trim()}" ditambahkan`);
    setAdding(null); setLabel("");
  };

  return (
    <Card eyebrow="akun" title="Akun runtime" data-setting-card data-search="akun runtime login langganan claude codex antigravity limit">
      <Prose>
        Daftarkan beberapa akun langganan per runtime, lalu pilih akun default di sini atau per sesi saat
        <b> Start</b>. Skills, plugins, dan setelan lain tetap sama untuk semua akun — yang berbeda hanya login.
      </Prose>
      {sandbox && (
        <Callout tone="warn" title="Sandbox sesi aktif">Sesi di mesin ini hanya bisa memakai akun bawaan.</Callout>
      )}
      {error && <Callout tone="err" title="Akun belum terbaca">{error}</Callout>}
      {accounts && RUNTIMES.map((rt) => (
        <section key={rt} className="hn-acct-group" aria-label={RUNTIME_LABEL[rt]}>
          <div className="hn-acct-group-head">
            <span className="hn-eyebrow">{RUNTIME_LABEL[rt]}</span>
            <Button size="sm" variant="ghost" leftIcon="plus" onClick={() => { setAdding(rt); setLabel(""); }}>
              Tambah akun {RUNTIME_LABEL[rt]}
            </Button>
          </div>
          <div role="radiogroup" aria-label={`Akun default ${RUNTIME_LABEL[rt]}`} className="hn-acct-list">
            {accounts.filter((a) => a.runtime === rt).map((a) => {
              const lim = limits.find((l) => l.accountId === a.id)?.limits;
              return (
                <div key={a.id} className="hn-acct-row" data-status={a.status}>
                  <label className="hn-acct-pick">
                    <input type="radio" name={`acct-${rt}`} checked={a.isDefault}
                      disabled={sandbox && !a.builtin}
                      aria-label={`${a.label} sebagai default ${RUNTIME_LABEL[rt]}`}
                      onChange={() => void act("mengubah akun default", () => api.setDefaultRuntimeAccount(rt, a.id))} />
                    <span className="hn-acct-label">{a.label}</span>
                  </label>
                  <span className="hn-acct-identity">{a.identity?.email ?? "—"}{a.identity?.plan ? ` · ${a.identity.plan}` : ""}</span>
                  <span className="hn-acct-status">{STATUS_LABEL[a.status]}</span>
                  <span className="hn-acct-lim" title="Limit 5 jam · mingguan">
                    5j {pctOf(lim, /5 jam/)} · Mgg {pctOf(lim, /Mingguan/)}
                  </span>
                  <span className="hn-acct-actions">
                    {a.status !== "aktif" || !a.builtin ? (
                      <Button size="sm" variant="ghost" aria-label={`Login ${a.label}`} onClick={() => void login(a)}>
                        {a.status === "aktif" ? "Login ulang" : "Login"}
                      </Button>
                    ) : null}
                    {!a.builtin && (
                      <Button size="sm" variant="ghost" aria-label={`Hapus ${a.label}`} onClick={() => void remove(a)}>Hapus</Button>
                    )}
                  </span>
                  {a.drift.length > 0 && (
                    <div className="hn-acct-drift" role="note">
                      Konfigurasi menyimpang: {a.drift.join(", ")} bukan lagi tautan ke setelan bersama.
                    </div>
                  )}
                  {dupeOf(a) && (
                    <div className="hn-acct-drift" role="note">
                      Email sama dengan akun "{dupeOf(a)!.label}" — keduanya login ke langganan yang sama.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <Modal open={adding !== null} onClose={() => setAdding(null)} icon="plus"
        eyebrow={adding ? RUNTIME_LABEL[adding] : ""} title="Tambah akun"
        footer={<>
          <Button variant="ghost" onClick={() => setAdding(null)}>Batal</Button>
          <Button disabled={!label.trim()} onClick={() => void save()}>Simpan akun</Button>
        </>}>
        <Field label="Label akun" hint="Nama pendek untuk membedakan akun, mis. Kantor atau Pribadi 2.">
          <Input aria-label="Label akun" value={label} maxLength={40}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)} />
        </Field>
        <div className="hn-acct-hint">Sesudah disimpan, tekan <b>Login</b> untuk masuk ke akun ini di Terminal.</div>
      </Modal>
      {dialog}
    </Card>
  );
}
```

Catatan: periksa signature `Button`/`Input`/`Modal`/`Field` di `src/src/ds` (mis. `grep -n "export function Input" -A6 src/src/ds/*.tsx`) dan sesuaikan prop bila namanya berbeda; perilaku yang diuji test tetap.

Create `src/src/screens/styles/accounts.css`:

```css
/* ADR-0234 · panel akun runtime. Token DS saja (bone paper, brass accent). */
.hn-acct-group { margin-top: var(--space-4, 16px); }
.hn-acct-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hn-acct-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.hn-acct-row {
  display: grid; grid-template-columns: minmax(120px, 1.2fr) minmax(120px, 1.5fr) auto auto auto;
  align-items: center; gap: 12px; padding: 8px 10px; border-radius: 6px; background: var(--bone-100, transparent);
}
.hn-acct-row[data-status="perlu-login-ulang"] .hn-acct-status { color: var(--brass-700); }
.hn-acct-row[data-status="belum-login"] .hn-acct-status { color: var(--text-muted); }
.hn-acct-pick { display: flex; align-items: center; gap: 8px; }
.hn-acct-label { font-weight: 600; }
.hn-acct-identity, .hn-acct-lim { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.hn-acct-actions { display: flex; gap: 4px; justify-content: flex-end; }
.hn-acct-drift { grid-column: 1 / -1; color: var(--brass-700); font-size: 0.9em; }
.hn-acct-hint { margin-top: 8px; color: var(--text-muted); }
@media (max-width: 640px) {
  .hn-acct-row { grid-template-columns: 1fr auto; }
  .hn-acct-identity, .hn-acct-lim { grid-column: 1 / -1; }
}
```

- [x] **Step 5: Pasang di SessionSettings**

Di `src/src/screens/settings/SessionSettings.tsx`: impor `import { RuntimeAccounts } from "./RuntimeAccounts";` dan render `<RuntimeAccounts onToast={onToast} />` tepat sesudah `</Card>` milik kartu `"Agen & model — default global"` (sebelum `<Card eyebrow="goal" …>`). Sesuaikan tipe `onToast` bila signature di SessionSettings berbeda (lihat pemakaian `onToast?.(…, "ok", "terminal")` di `installMethod`).

Cari test yang me-mock `api` lalu merender `SessionSettings`/`SettingsScreen` (`grep -rln "SessionSettings\|SettingsScreen" src/test src/src --include=*.test.tsx`) dan tambahkan ke mock-nya:

```ts
    listRuntimeAccounts: vi.fn(async () => ({ accounts: [], sandbox: false })),
    checkRuntimeAccount: vi.fn(),
```

- [x] **Step 6: Jalankan test**

Run: WEB `src/src/screens/settings/RuntimeAccounts.test.tsx` dan berkas test Settings yang ditambal.
Expected: PASS (kecuali `src/test/settings-search.test.tsx` yang gagal juga di baseline).
Run: `pnpm --filter ./src typecheck`.

- [x] **Step 7: Commit**

```bash
/usr/bin/git add src/src/api/client.ts src/src/api/account-limits.ts src/src/screens/settings/RuntimeAccounts.tsx \
  src/src/screens/settings/RuntimeAccounts.test.tsx src/src/screens/styles/accounts.css src/src/screens/settings/SessionSettings.tsx \
  docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
# + berkas test yang mock-nya ditambal di Step 5
/usr/bin/git commit -m "feat(akun): panel Akun runtime di Settings (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web — field Akun di Start & Sesi baru, chip sesi, popover limit

**Files:**
- Create: `src/src/lib/limit-reset.ts`, `src/src/screens/AccountField.tsx`, `src/src/screens/AccountField.test.tsx`
- Modify: `src/src/screens/session-runtime.ts`, `src/src/App.tsx` (dialog Start ±:150-360), `src/src/screens/NewTerminalModal.tsx`, `src/src/screens/TerminalScreen.tsx:1471-1480` & tipe `TerminalSession` di `src/src/api/client.ts:33-55`, `src/src/screens/LimitIndicator.tsx`

**Interfaces:**
- Consumes: `loadAccountLimits`, `useAccountLimits` (Task 8); `LimitWindows` (LimitIndicator).
- Produces:
  - `resetPassed(w: LimitWindow, status: LimitsStatus, now?: number): boolean`
  - `session-runtime.ts`: `accountsFor(list, agent)`, `defaultAccountId(list, agent)`, `accountWorstPct(a, now?)`, `accountMarker(pct)`, `accountOptionLabel(a, now?)`
  - `<AccountField agent accounts value onChange />` (null bila runtime < 2 akun)
  - `TerminalSession.accountId?: string`

- [x] **Step 1: Tulis test yang gagal**

Create `src/src/screens/AccountField.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AccountLimitsDTO } from "@hanoman/shared";
import { AccountField } from "./AccountField";
import { accountMarker, accountOptionLabel, defaultAccountId } from "./session-runtime";
import { resetPassed } from "../lib/limit-reset";

const win = (pct: number, resetsAt: string | null = null) =>
  ({ key: "session", label: "Sesi 5 jam", usedPct: pct, resetsAt, severity: "normal" as const, isActive: false });
const a = (o: Partial<AccountLimitsDTO>): AccountLimitsDTO => ({
  accountId: "default:claude", runtime: "claude", label: "Default", builtin: true, isDefault: true, loginStatus: "aktif",
  limits: { status: "ok", windows: [win(10)], fetchedAt: null }, ...o,
});
const two = [a({}), a({ accountId: "a1b2c3d4", label: "Kantor", builtin: false, isDefault: false, limits: { status: "ok", windows: [win(93)], fetchedAt: null } })];

describe("logika akun", () => {
  it("marker ⚠ ≥70, ‼ ≥90", () => {
    expect(accountMarker(69)).toBe(""); expect(accountMarker(70)).toBe(" ⚠"); expect(accountMarker(90)).toBe(" ‼");
  });
  it("label opsi memuat persen terburuk + marker; belum login ditandai", () => {
    expect(accountOptionLabel(two[1]!)).toBe("Kantor · 93% ‼");
    expect(accountOptionLabel(a({ label: "X", loginStatus: "belum-login", limits: { status: "unavailable", windows: [], fetchedAt: null } }))).toBe("X · belum login");
  });
  it("window stale yang resetnya lewat dianggap 0%", () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    expect(resetPassed(win(99, old), "stale")).toBe(true);
    expect(resetPassed(win(99, old), "ok")).toBe(false);
    expect(accountOptionLabel(a({ label: "Y", limits: { status: "stale", windows: [win(99, old)], fetchedAt: null } }))).toBe("Y · sudah reset");
  });
  it("default = isDefault, lalu bawaan", () => {
    expect(defaultAccountId(two, "claude")).toBe("default:claude");
    expect(defaultAccountId([], "codex")).toBe("default:codex");
  });
});

describe("<AccountField>", () => {
  it("tersembunyi bila runtime punya < 2 akun", () => {
    const { container } = render(<AccountField agent="claude" accounts={[a({})]} value="default:claude" onChange={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
  it("tampil dengan ≥2 akun; akun belum login nonaktif; memilih memanggil onChange", () => {
    const onChange = vi.fn();
    const list = [...two, a({ accountId: "ffffffff", label: "Baru", builtin: false, isDefault: false, loginStatus: "belum-login" })];
    render(<AccountField agent="claude" accounts={list} value="default:claude" onChange={onChange} />);
    const sel = screen.getByLabelText("Akun") as HTMLSelectElement;
    expect([...sel.options].find((o) => o.value === "ffffffff")!.disabled).toBe(true);
    fireEvent.change(sel, { target: { value: "a1b2c3d4" } });
    expect(onChange).toHaveBeenCalledWith("a1b2c3d4");
  });
});
```

Run: WEB `src/src/screens/AccountField.test.tsx`
Expected: FAIL — modul tak ada.

- [x] **Step 2: `limit-reset.ts` & logika di `session-runtime.ts`**

Create `src/src/lib/limit-reset.ts`:

```ts
import type { LimitWindow, LimitsStatus } from "@hanoman/shared";

/**
 * ADR-0234 · angka `stale` (akun menganggur, token kedaluwarsa) menyesatkan bila window-nya sudah
 * reset sejak snapshot diambil. Window seperti itu ditampilkan "sudah reset", bukan persen lama.
 */
export function resetPassed(w: LimitWindow, status: LimitsStatus, now: number = Date.now()): boolean {
  return status !== "ok" && !!w.resetsAt && Date.parse(w.resetsAt) <= now;
}
```

(Bila `LimitsStatus` tak diekspor dari `@hanoman/shared`, ekspor dari `shared/src/dto.ts` di task ini.)

Tambahkan ke `src/src/screens/session-runtime.ts`:

```ts
import { builtinAccountId, type AccountLimitsDTO } from "@hanoman/shared";
import { resetPassed } from "../lib/limit-reset";

// ADR-0234 · pemilihan akun runtime — dipakai picker Start DAN form "Sesi baru" (satu sumber).
export const accountsFor = (list: readonly AccountLimitsDTO[], agent: Agent): AccountLimitsDTO[] =>
  list.filter((a) => a.runtime === agent);

export function defaultAccountId(list: readonly AccountLimitsDTO[], agent: Agent): string {
  return accountsFor(list, agent).find((a) => a.isDefault)?.accountId ?? builtinAccountId(agent);
}

/** Persen terburuk di antara window yang belum reset; null = tak ada data. */
export function accountWorstPct(a: AccountLimitsDTO, now: number = Date.now()): number | null {
  const live = a.limits.windows.filter((w) => !resetPassed(w, a.limits.status, now));
  if (!a.limits.windows.length) return null;
  return live.length ? Math.max(...live.map((w) => w.usedPct)) : 0;
}

/** Penanda teks (bukan warna saja): ⚠ ≥70%, ‼ ≥90%. Tak pernah memilih akun otomatis. */
export const accountMarker = (pct: number): string => (pct >= 90 ? " ‼" : pct >= 70 ? " ⚠" : "");

export function accountOptionLabel(a: AccountLimitsDTO, now: number = Date.now()): string {
  if (a.loginStatus !== "aktif") return `${a.label} · ${a.loginStatus === "belum-login" ? "belum login" : "perlu login ulang"}`;
  const all = a.limits.windows;
  if (all.length && all.every((w) => resetPassed(w, a.limits.status, now))) return `${a.label} · sudah reset`;
  const pct = accountWorstPct(a, now);
  return pct === null ? a.label : `${a.label} · ${pct}%${accountMarker(pct)}`;
}
```

- [x] **Step 3: Komponen `AccountField`**

Create `src/src/screens/AccountField.tsx`:

```tsx
import React from "react";
import type { Agent, AccountLimitsDTO } from "@hanoman/shared";
import { Field, Select } from "../ds";
import { LimitWindows } from "./LimitIndicator";
import { accountOptionLabel, accountsFor } from "./session-runtime";

/**
 * ADR-0234 · pilihan akun runtime untuk satu sesi. Muncul HANYA bila runtime itu punya ≥2 akun —
 * instalasi satu akun tak melihat perubahan apa pun. Akun yang belum login tampil tapi nonaktif.
 * Limit hanya DITANDAI (⚠/‼); pilihan tetap di tangan operator.
 */
export function AccountField({ agent, accounts, value, onChange, className }: {
  agent: Agent; accounts: readonly AccountLimitsDTO[]; value: string; onChange: (id: string) => void; className?: string;
}) {
  const own = accountsFor(accounts, agent);
  if (own.length < 2) return null;
  const selected = own.find((a) => a.accountId === value);
  return (
    <Field label="Akun" hint="Akun langganan yang dipakai sesi ini. Default dari Settings → Akun runtime.">
      <Select aria-label="Akun" value={value} className={className ?? "hn-w-full"}
        options={own.map((a) => ({ value: a.accountId, label: accountOptionLabel(a), disabled: a.loginStatus !== "aktif" }))}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} />
      {selected && selected.limits.windows.length > 0 && <LimitWindows dto={selected.limits} />}
    </Field>
  );
}
```

Periksa `Select` di `src/src/ds` menerima `disabled` per opsi (`grep -n "options" src/src/ds/*.tsx | head`). Bila belum, tambahkan dukungan `disabled?: boolean` pada tipe opsinya dan teruskan ke `<option disabled>` — itu bagian task ini.

Run: WEB `src/src/screens/AccountField.test.tsx` → PASS.

- [x] **Step 4: Pasang di dialog Start (`App.tsx`)**

Di komponen dialog Start (`App.tsx` ±:140-360):

1. Impor: `import { AccountField } from "./screens/AccountField";`, `import { loadAccountLimits } from "./api/account-limits";`, dan `defaultAccountId` dari `./screens/session-runtime`.
2. State: `const [accountsList, setAccountsList] = React.useState<AccountLimitsDTO[]>([]);` dan `const [account, setAccount] = React.useState<string>("");`
3. Di `React.useEffect` yang memuat Setting saat `open` (setelah `setDefs(d); setAgent(a); …`): tambahkan
   ```ts
         void loadAccountLimits().then((l) => { setAccountsList(l); setAccount(defaultAccountId(l, a)); });
   ```
4. Di `pickAgent(a)`: tambahkan `setAccount(defaultAccountId(accountsList, a));`.
5. Render, sesudah `<Field label="Agen" …>…</Field>`, hanya untuk mesin lokal (akun bersifat per mesin):
   ```tsx
         {!isRemoteTarget && (
           <AccountField agent={agent} accounts={accountsList} value={account} onChange={setAccount} />
         )}
   ```
6. Di `start()`, body `targetApi.startSession({ … })`: tambahkan
   ```ts
           ...(!isRemoteTarget && account && accountsList.filter((x) => x.runtime === agent).length >= 2 ? { account } : {}),
   ```

- [x] **Step 5: Pasang di `NewTerminalModal`**

Di `src/src/screens/NewTerminalModal.tsx`, pola yang sama:

1. Impor `AccountField`, `loadAccountLimits`, `defaultAccountId`, tipe `AccountLimitsDTO`.
2. State `accountsList`, `account`.
3. Di effect pemuat Setting (±:53-56), sesudah agen default diketahui: `void loadAccountLimits().then((l) => { setAccountsList(l); setAccount(defaultAccountId(l, a)); });` (pakai nama variabel agen di effect itu).
4. `pickAgent`: `setAccount(defaultAccountId(accountsList, a));`
5. Render sesudah field Agen: `<AccountField agent={agent} accounts={accountsList} value={account} onChange={setAccount} className="hn-terminal-field-full" />`
6. `api.createTerminal(projectId, { agent, model, effort, ... })`: tambahkan `...(account && accountsList.filter((x) => x.runtime === agent).length >= 2 ? { account } : {}),`

Jalankan test form yang sudah ada: WEB `src/test/new-terminal-runtime.test.tsx` dan test dialog Start (`grep -rln "StartSessionModal\|startSession" src/test src/src --include=*.test.tsx`). Mock parsial tanpa `getAccountLimits` tetap lulus karena `loadAccountLimits` tak pernah melempar; bila ada yang gagal karena `account-limits` mengimpor `./events`, tambahkan `vi.mock("../src/api/account-limits", () => ({ loadAccountLimits: async () => [], useAccountLimits: () => [] }))` di berkas itu.

- [x] **Step 6: Chip akun di Terminal**

1. `src/src/api/client.ts` tipe `TerminalSession`: sesudah `name?: string;` tambahkan `/** ADR-0234 · akun runtime sesi; absen = akun bawaan. */ accountId?: string;`
2. `src/src/screens/TerminalScreen.tsx`: impor `useAccountLimits` dan `isBuiltinAccountId`. Di komponen header sel (tempat `orchestrator-chip` dirender, :1471-1480) tambahkan:
   ```tsx
           {/* ADR-0234 · akun runtime sesi — hanya akun non-bawaan, supaya instalasi satu akun tak berubah. */}
           {session.accountId && !isBuiltinAccountId(session.accountId) && (
             <span data-testid="account-chip" title="Akun runtime sesi ini" className="hn-terminal-orch">
               {accountLabels.get(session.accountId) ?? session.accountId}
             </span>
           )}
   ```
   dengan `const accountLabels = new Map(useAccountLimits().map((a) => [a.accountId, a.label]));` di badan komponen yang sama (hook di level atas komponen, bukan di dalam kondisi). Bila komponen header bukan komponen tersendiri, letakkan hook di komponen terdekat yang merender header dan teruskan `accountLabels` sebagai prop.

- [x] **Step 6b: "Mulai lagi" dari riwayat membawa akun yang sama**

Di `src/src/screens/TerminalScreen.tsx` (±:384-402, fungsi restart dari baris riwayat `r`): pada objek
`api.startSession({ … })` dan `api.createTerminal(r.projectId, { … })` tambahkan
`...(r.accountId ? { account: r.accountId } : {}),` sesudah baris `effort`. Komentar:
`// ADR-0234 · akun runtime sesi asal ikut — "Mulai lagi" berjanji konteks yang sama.`
Akun yang sudah dihapus dijawab server `404 account-not-found`; pesan galatnya tampil lewat jalur error
restart yang sudah ada (periksa bahwa `catch` di fungsi itu menampilkan `ApiError.detail.message` bila ada;
bila hanya status, tambahkan `message` ke teks galatnya).

- [x] **Step 7: Popover limit menampilkan semua akun + "sudah reset"**

Di `src/src/screens/LimitIndicator.tsx`:

1. `LimitWindows`: di dalam `dto.windows.map((w) => …)`, hitung `const reset = resetPassed(w, dto.status);` lalu:
   - `<span className="hn-lim-pct">{reset ? "sudah reset" : `${w.usedPct}%`}</span>` dan sembunyikan `hn-lim-word` bila `reset`.
   - `WindowMeter pct={reset ? 0 : w.usedPct}`.
2. `LimitPill` menerima prop opsional `accounts?: AccountLimitsDTO[]`. Bila `accounts && accounts.length >= 2`, di dalam popover sesudah `<LimitWindows … />` render:
   ```tsx
             <div className="hn-lim-accounts">
               {accounts.map((a) => (
                 <div key={a.accountId} className="hn-lim-account">
                   <div className="hn-eyebrow hn-lim-eyebrow">{a.label}{a.isDefault ? " · default" : ""}</div>
                   <LimitWindows dto={a.limits} emptyHint="Belum terbaca — akun ini belum dipakai atau belum login." />
                 </div>
               ))}
             </div>
   ```
   Bila `accounts.length >= 2`, popover menampilkan daftar akun SAJA (tanpa `LimitWindows dto={dto}` di atasnya, karena akun default sudah ada di daftar).
3. `LimitBadge`, `CodexLimitBadge`, `AntigravityLimitBadge`: `const all = useAccountLimits();`, `const own = all.filter((x) => x.runtime === "claude")` (masing-masing runtime-nya). Teruskan `accounts={own}` ke `LimitPill`. Bila `own.length >= 2`, `dto` pil = `own.find((x) => x.isDefault)?.limits ?? dto` — pil mencerminkan akun **default** runtime (yang dipakai sesi baru), bukan selalu akun bawaan. Dengan < 2 akun perilakunya persis seperti sekarang. Grup siar lama (`limits`/`codexLimits`/`antigravityLimits`) dan tool `hanoman_limits*` tetap berisi akun bawaan demi kompatibilitas.
4. CSS di `src/src/screens/styles/limits.css`:
   ```css
   /* ADR-0234 · daftar akun di popover limit. */
   .hn-lim-accounts { display: flex; flex-direction: column; gap: 12px; }
   .hn-lim-account + .hn-lim-account { border-top: 1px solid var(--bone-200); padding-top: 8px; }
   ```

Jalankan test limit yang ada (`ls src/test src/src/screens | grep -i limit`) — bila me-mock store limit tanpa `account-limits`, tambahkan `vi.mock("../src/api/account-limits", () => ({ useAccountLimits: () => [] }))` (sesuaikan path relatif).

- [x] **Step 8: Jalankan test**

Run: WEB `src/src/screens/AccountField.test.tsx` + semua test web yang disentuh di Step 4–7.
Expected: PASS (kecuali baseline `settings-search`).
Run: `pnpm --filter ./src typecheck`.

- [x] **Step 9: Commit**

```bash
/usr/bin/git add src/src/lib/limit-reset.ts src/src/screens/AccountField.tsx src/src/screens/AccountField.test.tsx \
  src/src/screens/session-runtime.ts src/src/App.tsx src/src/screens/NewTerminalModal.tsx src/src/screens/TerminalScreen.tsx \
  src/src/api/client.ts src/src/screens/LimitIndicator.tsx src/src/screens/styles/limits.css \
  docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
# + berkas test/ds yang ikut diubah
/usr/bin/git commit -m "feat(akun): pilih akun saat Start & Sesi baru, chip sesi, limit semua akun (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Antigravity — mode tukar eksklusif

Lewati task ini bila spike Task 0 Step 4 menemukan isolasi per direktori (catat di ADR dan buka spec lanjutan).

**Files:**
- Create: `server/src/services/runtime-accounts/antigravity-swap.ts`, `server/test/runtime-accounts-agy.test.ts`
- Modify: `server/src/services/runtime-accounts/resolver.ts` (cabang agy), `server/src/services/runtime-accounts/resolver.ts` → `assertLaunchAccount` (sibuk), `server/src/services/runtime-accounts/install.ts` (pasang probe/login/limit/hook), `server/src/services/runtime-accounts/registry.ts` (`deleteAccount` agy: hapus slot via rm home — sudah tercakup)

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret` (`services/secret-box.ts`); `securityRun`, `SecurityRun` (Task 3); `parseAgyToken`, `fetchAgyWindows`, `defaultProject`, `EXPIRY_SKEW_MS` (Task 7); `listSessions` (pty); `setProbe`, `setAntigravityLogin`, `setAntigravityAccountLimits`.
- Produces:
  - `type AgySlot = { keychain: string | null; file: string | null }`
  - `type AgyIo = { run: SecurityRun; readFile(p): string | null; writeFile(p, s): void; removeFile(p): void; tokenFile: string; accountsDir: string; liveAgyAccountIds(): string[] }`
  - `activeAgyAccount(io?): string`, `captureActiveSlot(io?): void`, `activateAgyAccount(targetId, io?): void` (melempar `AccountError` busy), `readSlot(accountId, io?): AgySlot | null`, `probeAgyLogin(accountId, io?): LoginProbe`, `agyAccountLimits(row): Promise<LimitsDTO>`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/runtime-accounts-agy.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { resetSecretKeyCache } from "../src/services/secret-box";
import { activateAgyAccount, activeAgyAccount, captureActiveSlot, probeAgyLogin, readSlot, type AgyIo } from "../src/services/runtime-accounts/antigravity-swap";

const blob = (email: string) => JSON.stringify({ token: { access_token: `at-${email}`, expiry: "2099-01-01T00:00:00Z" }, id_token_email: email });

let dir: string, keychain: string | null, files: Map<string, string>, live: string[];
const io = (): AgyIo => ({
  run: (args, input) => {
    if (args[0] === "find-generic-password") { if (keychain === null) throw new Error("44"); return keychain; }
    if (args[0] === "delete-generic-password") { if (keychain === null) throw new Error("44"); keychain = null; return ""; }
    if (args[0] === "-i") { const m = /-w '((?:[^']|'\\'')*)'/.exec(input ?? ""); keychain = m ? m[1]!.replace(/'\\''/g, "'") : null; return ""; }
    throw new Error(`tak terduga: ${args.join(" ")}`);
  },
  readFile: (p) => files.get(p) ?? null,
  writeFile: (p, s) => { files.set(p, s); },
  removeFile: (p) => { files.delete(p); },
  tokenFile: "/agy/antigravity-oauth-token",
  accountsDir: dir,
  liveAgyAccountIds: () => live,
});

const prevHome = process.env.HANOMAN_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-agy-"));
  process.env.HANOMAN_HOME = dir;   // kunci secret-box ikut tmp
  resetSecretKeyCache();
  keychain = blob("bawaan@x"); files = new Map(); live = [];
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = prevHome;
  resetSecretKeyCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("mode tukar agy", () => {
  it("awal: akun aktif = bawaan", () => { expect(activeAgyAccount(io())).toBe("default:antigravity"); });

  it("tukar ke akun baru (slot kosong): login bawaan diselamatkan ke slotnya, Keychain dikosongkan", () => {
    activateAgyAccount("a1b2c3d4", io());
    expect(readSlot("default:antigravity", io())?.keychain).toBe(blob("bawaan@x"));
    expect(keychain).toBeNull();
    expect(activeAgyAccount(io())).toBe("a1b2c3d4");
  });

  it("login akun baru lalu tukar balik: kedua login utuh", () => {
    activateAgyAccount("a1b2c3d4", io());
    keychain = blob("kantor@x");                       // operator login agy
    activateAgyAccount("default:antigravity", io());  // menangkap slot a1b2c3d4 lebih dulu
    expect(keychain).toBe(blob("bawaan@x"));
    expect(readSlot("a1b2c3d4", io())?.keychain).toBe(blob("kantor@x"));
    expect(probeAgyLogin("a1b2c3d4", io())).toEqual({ loggedIn: true, identity: { email: "kantor@x" } });
  });

  it("berkas token ikut ditukar", () => {
    files.set("/agy/antigravity-oauth-token", blob("berkas@x"));
    activateAgyAccount("a1b2c3d4", io());
    expect(files.has("/agy/antigravity-oauth-token")).toBe(false);
    activateAgyAccount("default:antigravity", io());
    expect(files.get("/agy/antigravity-oauth-token")).toBe(blob("berkas@x"));
  });

  it("ada sesi agy hidup dengan akun lain → antigravity-account-busy, tak ada yang berubah", () => {
    live = ["default:antigravity"];
    let err: unknown;
    try { activateAgyAccount("a1b2c3d4", io()); } catch (e) { err = e; }
    expect(err).toMatchObject({ code: "antigravity-account-busy", status: 409 });
    expect(keychain).toBe(blob("bawaan@x"));
    expect(activeAgyAccount(io())).toBe("default:antigravity");
  });

  it("tukar ke akun yang sudah aktif = no-op walau ada sesi hidup", () => {
    live = ["default:antigravity"];
    expect(() => activateAgyAccount("default:antigravity", io())).not.toThrow();
  });

  it("captureActiveSlot menyimpan token hasil refresh agy", () => {
    activateAgyAccount("a1b2c3d4", io());
    keychain = blob("refresh@x");
    captureActiveSlot(io());
    expect(readSlot("a1b2c3d4", io())?.keychain).toBe(blob("refresh@x"));
  });

  it("slot tersimpan terenkripsi (bukan teks polos)", () => {
    activateAgyAccount("a1b2c3d4", io());
    const raw = readFileSync(join(dir, "default", "slot.enc"), "utf8");
    expect(raw.startsWith("enc:v1:")).toBe(true);
    expect(raw).not.toContain("bawaan@x");
  });
});
```

Run: SRV `server/test/runtime-accounts-agy.test.ts`
Expected: FAIL — modul tak ada.

- [x] **Step 2: Implementasi `antigravity-swap.ts`**

Create `server/src/services/runtime-accounts/antigravity-swap.ts`:

```ts
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { builtinAccountId, isBuiltinAccountId, type LimitsDTO } from "@hanoman/shared";
import { decryptSecret, encryptSecret } from "../secret-box";
import { defaultProject, EXPIRY_SKEW_MS, fetchAgyWindows, parseAgyToken } from "../antigravity-limits";
import { listSessions } from "../pty";
import { securityRun, type SecurityRun } from "./keychain";
import { accountsRoot } from "./paths";
import { AccountError, type AccountRow } from "./registry";
import type { LoginProbe } from "./identity";

// ADR-0234 · agy menyimpan login di Keychain ber-nama TETAP (`gemini`/`antigravity`) dan bisa jatuh ke
// berkas `~/.gemini/antigravity-cli/antigravity-oauth-token`. Tak ada isolasi per direktori, jadi
// multi-akun = MENUKAR isi keduanya: satu akun aktif per mesin. Slot tiap akun = `<akar>/<id>/slot.enc`
// (secret-box, 0600). Akun bawaan punya slot di `<akar>/default/`. Akun aktif dicatat di `<akar>/active`.
export type AgySlot = { keychain: string | null; file: string | null };
export type AgyIo = {
  run: SecurityRun;
  readFile: (p: string) => string | null;
  writeFile: (p: string, s: string) => void;
  removeFile: (p: string) => void;
  tokenFile: string;
  accountsDir: string;
  liveAgyAccountIds: () => string[];
};

const BUILTIN = builtinAccountId("antigravity");
const fsIo = (): AgyIo => ({
  run: securityRun,
  readFile: (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } },
  writeFile: (p, s) => { writeFileSync(p, s, { mode: 0o600 }); chmodSync(p, 0o600); },
  removeFile: (p) => rmSync(p, { force: true }),
  tokenFile: join(homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token"),
  accountsDir: join(accountsRoot(), "antigravity"),
  // Sesi agy hidup memakai akun yang AKTIF saat ini (satu Keychain), apa pun @hanoman_account-nya.
  liveAgyAccountIds: () => listSessions().filter((s) => !s.exited && s.agent === "antigravity").map((s) => s.accountId ?? BUILTIN),
});

const slotDir = (io: AgyIo, id: string) => join(io.accountsDir, isBuiltinAccountId(id) ? "default" : id);
const activeFile = (io: AgyIo) => join(io.accountsDir, "active");

export function activeAgyAccount(io: AgyIo = fsIo()): string {
  return io.readFile(activeFile(io))?.trim() || BUILTIN;
}

// Slot SELALU di disk nyata di bawah `io.accountsDir` (test memakai direktori tmp); `io.readFile/writeFile`
// hanya untuk berkas token agy dan penanda `active`.
export function readSlot(accountId: string, io: AgyIo = fsIo()): AgySlot | null {
  let raw: string;
  try { raw = readFileSync(join(slotDir(io, accountId), "slot.enc"), "utf8"); } catch { return null; }
  const plain = decryptSecret(raw);
  if (!plain) return null;
  try { return JSON.parse(plain) as AgySlot; } catch { return null; }
}

function writeSlot(accountId: string, slot: AgySlot, io: AgyIo): void {
  const d = slotDir(io, accountId);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const p = join(d, "slot.enc");
  writeFileSync(p, encryptSecret(JSON.stringify(slot)), { mode: 0o600 });
  chmodSync(p, 0o600);
}

function readKeychain(io: AgyIo): string | null {
  try { return io.run(["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"]).trim() || null; }
  catch { return null; }
}

// Rahasia lewat STDIN `security -i`, bukan argv (argv terbaca `ps` proses lain).
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
function writeKeychain(value: string | null, io: AgyIo): void {
  try { io.run(["delete-generic-password", "-s", "gemini", "-a", "antigravity"]); } catch { /* belum ada */ }
  if (value) io.run(["-i"], `add-generic-password -U -s gemini -a antigravity -w ${shq(value)}\n`);
}

/** Simpan login yang sedang aktif ke slot akun aktif (menangkap token hasil refresh agy). */
export function captureActiveSlot(io: AgyIo = fsIo()): void {
  writeSlot(activeAgyAccount(io), { keychain: readKeychain(io), file: io.readFile(io.tokenFile) }, io);
}

/**
 * Jadikan `targetId` akun agy aktif. Ditolak bila ada sesi agy hidup (semuanya memakai akun aktif
 * sekarang). Urutan: tangkap slot aktif → pulihkan slot target (kosong = belum login) → catat aktif.
 */
export function activateAgyAccount(targetId: string, io: AgyIo = fsIo()): void {
  const current = activeAgyAccount(io);
  if (current === targetId) return;
  if (io.liveAgyAccountIds().length > 0)
    throw new AccountError("antigravity-account-busy", 409, "masih ada sesi Antigravity yang berjalan dengan akun lain — tutup dulu sesinya");
  captureActiveSlot(io);
  const slot = readSlot(targetId, io) ?? { keychain: null, file: null };
  writeKeychain(slot.keychain, io);
  if (slot.file) io.writeFile(io.tokenFile, slot.file); else io.removeFile(io.tokenFile);
  mkdirSync(io.accountsDir, { recursive: true, mode: 0o700 });
  io.writeFile(activeFile(io), targetId);
}

/** Status login dari slot (atau Keychain langsung bila akun itu yang aktif). */
export function probeAgyLogin(accountId: string, io: AgyIo = fsIo()): LoginProbe {
  const raw = activeAgyAccount(io) === accountId ? readKeychain(io) ?? io.readFile(io.tokenFile) : (() => {
    const s = readSlot(accountId, io);
    return s?.keychain ?? s?.file ?? null;
  })();
  if (!raw || !parseAgyToken(raw)) return { loggedIn: false, identity: null };
  let email: string | undefined;
  try {
    let s = raw.trim();
    if (s.startsWith("go-keyring-base64:")) s = Buffer.from(s.slice(18), "base64").toString("utf8");
    const e = (JSON.parse(s) as { id_token_email?: unknown }).id_token_email;
    if (typeof e === "string" && e) email = e;
  } catch { /* identitas opsional */ }
  return { loggedIn: true, identity: email ? { email } : {} };
}

const UNAVAILABLE: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };

/** Limit akun agy non-aktif dari token di slotnya (tanpa refresh); akun aktif memakai Keychain. */
export async function agyAccountLimits(row: AccountRow, io: AgyIo = fsIo()): Promise<LimitsDTO> {
  if (process.platform !== "darwin") return UNAVAILABLE;
  const raw = activeAgyAccount(io) === row.id ? readKeychain(io) : readSlot(row.id, io)?.keychain ?? null;
  const tok = raw ? parseAgyToken(raw) : null;
  if (!tok || (tok.expiry !== null && tok.expiry - EXPIRY_SKEW_MS <= Date.now())) return UNAVAILABLE;
  const windows = await fetchAgyWindows(tok, defaultProject(), fetch);
  return windows ? { status: "ok", windows, fetchedAt: new Date().toISOString() } : UNAVAILABLE;
}
```

`secret-box` membaca/membuat kuncinya di `$HANOMAN_HOME` (`secretKeyPath()`), jadi test mengarahkan
`HANOMAN_HOME` ke direktori tmp (lihat `beforeEach` di Step 1) dan memanggil `resetSecretKeyCache()`.

- [x] **Step 3: Cabang agy di resolver & validasi**

Di `server/src/services/runtime-accounts/resolver.ts`:

1. Impor `activateAgyAccount` dari `./antigravity-swap`.
2. Di `resolveLaunchAccount`, tepat sesudah `if (deps.sandbox) return null;` (agy tak didukung sandbox — `assertAntigravityLaunch` sudah menolaknya):
   ```ts
     // ADR-0234 · agy: mode tukar. Akun bawaan JUGA perlu ditukar balik bila akun lain sedang aktif.
     // Melempar AccountError busy bila sesi agy lain masih hidup — sebelum tmux menyentuh apa pun.
     if (agent === "antigravity") {
       const snap = accountSnapshot();
       const target = requested ?? snap.defaults.antigravity ?? builtinAccountId("antigravity");
       const row = snap.rows.find((r) => r.id === target && r.runtime === "antigravity");
       const id = row && (requested || row.status === "aktif") ? row.id : builtinAccountId("antigravity");
       if (snap.rows.some((r) => r.runtime === "antigravity") || id !== builtinAccountId("antigravity")) activateAgyAccount(id);
       return { id, env: {}, unset: [] };
     }
   ```
3. Di `assertLaunchAccount`, untuk `agent === "antigravity"` dan akun non-bawaan: sesudah cek status, tambahkan cek sibuk:
   ```ts
     if (agent === "antigravity" && activeAgyAccount() !== requested && liveAgy().length > 0)
       throw new AccountError("antigravity-account-busy", 409, "masih ada sesi Antigravity yang berjalan dengan akun lain — tutup dulu sesinya");
   ```
   dengan `liveAgy = () => listSessions().filter((s) => !s.exited && s.agent === "antigravity")` dan impor `activeAgyAccount`, `listSessions`. Lakukan cek yang sama untuk akun bawaan agy yang dipilih eksplisit.

Route terminal (Task 5 Step 8) sudah memetakan `AccountError` → status; resolver yang melempar di dalam `createSession` dari jalur otomatis tertangkap pemanggilnya sebagai kegagalan peluncuran biasa.

- [x] **Step 4: Pasang di `install.ts`**

Tambahkan ke `installRuntimeAccounts()` (sebelum `void refreshAllStatuses()`):

```ts
  // ADR-0234 · Antigravity mode tukar: probe/limit/login dari slot, dan token hasil refresh agy ditangkap
  // ke slot akun aktif setiap kali sesi agy ditutup.
  setProbe("antigravity", async (_home, accountId) => probeAgyLogin(accountId));
  setAntigravityAccountLimits((row) => agyAccountLimits(row));
  setAntigravityLogin(() => [agentBin("antigravity")]);
  registerSessionHooks({
    onDeath: () => { try { if (process.platform === "darwin") captureActiveSlot(); } catch (e) { console.error("akun agy (tangkap slot):", e); } },
  });
```

dan di `openLoginSession` (login.ts) — untuk runtime `antigravity`, panggil `activateAgyAccount(accountId)` sebelum `createOperatorSession` (slot kosong → Keychain dikosongkan → agy meminta login). Impor yang dibutuhkan: `setProbe` (registry), `setAntigravityAccountLimits` (limits), `setAntigravityLogin` (login), `agentBin` (pty), dan fungsi swap.

Builtin agy di limits: ubah `builtin.antigravity` di `prodDeps` (Task 7) menjadi
`() => activeAgyAccount() === builtinAccountId("antigravity") ? getAntigravityLimits() : agyAccountLimits({ id: builtinAccountId("antigravity") } as AccountRow)` supaya limit akun bawaan tetap terbaca saat akun lain aktif.

- [x] **Step 5: Jalankan test**

Run: SRV `server/test/runtime-accounts-agy.test.ts server/test/runtime-accounts-registry.test.ts server/test/runtime-accounts-limits.test.ts server/test/runtime-accounts.route.test.ts`
Expected: PASS.
Run: `pnpm --filter ./server typecheck`.

- [x] **Step 6: Commit**

```bash
/usr/bin/git add server/src/services/runtime-accounts/antigravity-swap.ts server/src/services/runtime-accounts/resolver.ts \
  server/src/services/runtime-accounts/install.ts server/src/services/runtime-accounts/login.ts \
  server/src/services/runtime-accounts/limits.ts server/test/runtime-accounts-agy.test.ts \
  docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "feat(akun): Antigravity multi-akun lewat mode tukar eksklusif (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs akhir, verifikasi end-to-end

**Files:**
- Modify: `internal/skills/hanoman/SKILL.md`, `CLAUDE.md`, `internal/docs/README.md` (bila ada entri lain yang perlu ditautkan)

- [x] **Step 1: SKILL.md**

Di `internal/skills/hanoman/SKILL.md`, sesudah butir "**Dua agen** (SPEC-338/ADR-0074) …", tambahkan butir:

```markdown
- **Multi-akun runtime** (ADR-0234): akun langganan claude/codex/agy didaftarkan di Settings → Akun
  runtime. Akun non-bawaan = home `$HANOMAN_HOME/accounts/<runtime>/<id>` (0700) yang disuntik sebagai
  `CLAUDE_CONFIG_DIR`/`CODEX_HOME`; aset bersama (skills, plugins, settings, hooks, `projects/`,
  `config.toml`) disymlink ke home bawaan — entri yang bukan symlink lagi = **drift**, dilaporkan, tak
  ditimpa. Akun bawaan tanpa baris (`default:<runtime>`). Resolusi di `createSession` lewat resolver
  sinkron yang didaftarkan `installRuntimeAccounts()` (snapshot memori; pty tetap nol DB). Default per
  runtime di `Setting.accounts` — **hanya** `PUT /runtime-accounts/default` yang menulisnya. Sesi
  otomatis memakai default; default yang tak `aktif` jatuh ke bawaan + peringatan. Auto-resume memakai
  `SessionHistory.accountId`. Sandbox = akun bawaan saja. Limit per akun: grup siar `accountLimits`,
  `GET /limits/accounts` (GLOBAL_READ → **tanpa email**). agy: mode tukar eksklusif atas Keychain
  `gemini`/`antigravity` + berkas token, slot terenkripsi `slot.enc`, `409 antigravity-account-busy`.
  **Gotcha:** `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` di env mengalahkan config dir — resolver
  melepasnya untuk akun non-bawaan; nama service Keychain claude per config dir = `Claude Code-credentials-<sha256(dir)[0:8]>`.
```

Pada kalimat "**Sebelas** grup snapshot GLOBAL …", tambahkan `accountLimits (ADR-0234)` ke daftar grup (jangan mengubah hitungan lain tanpa memverifikasi `GROUPS` di `events.ts`).

- [x] **Step 2: CLAUDE.md**

Di `CLAUDE.md` bagian Konteks, ubah "tiga belas grup snapshot global — termasuk … serta `antigravityLimits`, limit Antigravity CLI (ADR-0224)" menjadi "empat belas grup snapshot global — termasuk … `antigravityLimits`, limit Antigravity CLI (ADR-0224), serta `accountLimits`, limit per akun runtime (ADR-0234)". Verifikasi hitungannya dengan `grep -c "build: async" server/src/services/events.ts` dibandingkan sebelum/sesudah.

- [x] **Step 3: Test seluruh set yang tersentuh**

```bash
/usr/bin/git diff --name-only main...HEAD | grep -E "\.test\.tsx?$"
```

Run: SRV seluruh berkas test server dari daftar itu, lalu WEB seluruh berkas test web/shared dari daftar itu.
Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck && pnpm --filter ./cli typecheck`
Expected: hijau, kecuali gagal baseline yang tercantum di Global Constraints (buktikan dengan menjalankan berkas yang sama di `main`).

- [ ] **Step 4: Uji endpoint nyata (boot server + curl)**

```bash
pnpm --filter ./server build
/usr/bin/env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u HANOMAN_SESSION_ID \
  HANOMAN_HOME=/private/tmp/claude-501/-Users-denameidina-Developers-Nafanesia-hanoman/c14906f5-0ce1-4f0c-9ad7-f1ae9369845c/scratchpad/ra-home \
  PORT=4899 node server/dist/server.js &
```

(`PORT`/flag host: ikuti cara boot yang dipakai `pnpm dev` di `server/package.json`; auth: login setup akun pertama lewat `POST /api/auth/setup` atau set `requireAuth` dev sesuai README.) Lalu dengan `rtk proxy curl -o <berkas>` (hook rtk meringkas JSON yang di-pipe):

1. `GET /api/runtime-accounts` → 3 akun bawaan.
2. `POST /api/runtime-accounts {"runtime":"codex","label":"Uji"}` → 201; `GET` → 4 akun, direktori `ra-home/accounts/codex/<id>` ada dengan symlink `config.toml`, `skills`.
3. `PUT /api/runtime-accounts/default {"runtime":"codex","accountId":"<id>"}` → 200.
4. `GET /api/limits/accounts` → 4+ entri, tanpa string `@`.
5. `POST /api/terminal/sessions {"project":"<id>","agent":"codex","account":"deadbeef"}` → 404 `account-not-found`.
6. `DELETE /api/runtime-accounts/<id>` → 204; direktori hilang; `~/.codex/config.toml` masih ada.

Matikan server per-PID (`kill <pid>`, jangan `pkill`). Hapus `ra-home`. Pastikan `git status` tak memuat `hanoman-dev.db-shm/-wal`.

- [ ] **Step 5: Uji manual oleh operator (sekali)**

1. Settings → Akun runtime → Tambah akun Claude "Kedua" → Login → selesaikan OAuth di Terminal → tutup sesi login → status jadi `aktif`, email tampil.
2. Buka dua "Sesi baru" claude: satu akun Default, satu akun "Kedua". Di masing-masing jalankan `/status` → email berbeda.
3. Di sesi akun "Kedua", jalankan skill yang hanya ada di `~/.claude/skills` → terbaca.
4. Popover limit Claude menampilkan dua akun dengan window masing-masing.
5. Start backlog: field Akun muncul, akun ≥90% bertanda ‼, pilihan tidak berubah sendiri.

Catat hasilnya di ADR-0234 bagian "Hasil spike" (sub-butir "Verifikasi akhir").

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add internal/skills/hanoman/SKILL.md CLAUDE.md internal/docs/adr/0234-multi-akun-runtime.md \
  docs/superpowers/plans/2026-11-01-runtime-multi-akun.md
/usr/bin/git commit -m "docs(akun): SKILL, CLAUDE.md, verifikasi akhir multi-akun runtime (ADR-0234)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
