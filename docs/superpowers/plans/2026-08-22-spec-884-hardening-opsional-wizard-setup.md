# SPEC-884 · Hardening opsional + wizard setup awal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat `npm i -g hanoman && hanoman` bisa boot di device mana pun tanpa konfigurasi — hardening ADR-0117 jadi opt-in (default mati), setup awal dipandu wizard di browser, dan hub produksi yang env-nya sudah keras tak turun sedikit pun.

**Architecture:** Dua nilai eksplisit (`HANOMAN_DEPLOYMENT`, `HANOMAN_HARDENING`) menggantikan `NODE_ENV` sebagai penentu hardening; `NODE_ENV=production` tinggal berarti "runtime terpaket". Resolver murni hidup di `@hanoman/runner` supaya CLI dan server memakai satu sumber. Jawaban wizard ditulis ke `$HANOMAN_HOME/config.env` dan digabung **paling lemah** saat CLI men-spawn server, sehingga env systemd/shell selalu menang. Perubahan boot berlaku lewat sentinel exit `76` yang di-handle supervisor `hanoman start`.

**Tech Stack:** TypeScript strict · Node ≥ 20 · Fastify 5 · Prisma 6 (SQLite) · React 18 + Vite · Vitest · pnpm workspace (`shared`, `runner`, `server`, `cli`, `src`)

## Global Constraints

- **Spec acuan:** `docs/superpowers/specs/2026-08-22-spec-884-mode-hardening-opsional-wizard-setup-design.md`. Baca K1–K10 sebelum mulai.
- **Nomor spec sementara.** SPEC-884 menunggu id backlog dari server. Bila server memberi nomor lain, selaraskan nama berkas, judul, komentar `SPEC-884 ·`, dan pesan commit dalam satu commit (preseden SPEC-882/883).
- **ADR-0138** adalah nomor yang dialokasikan (0136 = SPEC-881, 0137 = SPEC-883). Jangan memakai nomor lain tanpa memeriksa `internal/docs/adr/`.
- **Perintah verifikasi setiap task** (SPEC-376/ADR-0080, SPEC-479):
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path-test>`
  `--no-file-parallelism` **wajib** untuk test server; `TEST_DATABASE_URL` **wajib** karena `~/.hanoman/hanoman.test.db` dibagi semua worktree dan dihapus di awal tiap run.
- **`--changed` menyalakan `passWithNoTests`** — nol test terlihat hijau. Selalu sebut path test secara eksplisit di plan ini.
- **Jangan jalankan suite penuh atau `pnpm -r typecheck`** sebagai rutinitas. Typecheck paket yang tersentuh saja: `pnpm --filter ./server typecheck`.
- **Bahasa komentar & pesan UI: Indonesia**, mengikuti gaya berkas sekitarnya. Komentar menjelaskan **kenapa**, bukan apa.
- **Semua assertion `server/test/session-sandbox.test.ts` yang ada tetap lulus tanpa diubah.** Bila salah satu merah, itu regresi — bukan alasan melonggarkan test.
- **`git stash` dilarang di worktree** — tumpukan stash milik repo, sesi tetangga bisa mem-pop stash kita.

---

## File Structure

**Baru:**

| Berkas | Tanggung jawab |
|---|---|
| `runner/src/runtime-profile.ts` | Murni. `resolveHardening(env)`, `resolveDeployment(env)`. Satu-satunya tempat aturan profil hidup. |
| `runner/src/config-env.ts` | Murni + IO tipis. Parse/format/baca/tulis `$HANOMAN_HOME/config.env`. |
| `runner/src/sandbox-probe.ts` | Murni + kolektor IO. Daftar prasyarat hardening; dipakai `doctor` **dan** route setup. |
| `server/src/routes/setup.ts` | `GET /api/setup/status`, `POST /api/setup`. |
| `server/src/services/setup-config.ts` | Menulis `config.env` lewat allowlist; menghitung `hardeningLocked`. |
| `src/src/screens/SetupWizard.tsx` | Wizard tiga langkah. |

**Diubah:** `runner/src/index.ts` · `server/src/services/session-sandbox.ts` · `server/src/services/lead/brain.ts` · `server/src/services/portal-chat/argv.ts` · `server/src/services/upload-pipeline.ts` · `server/src/services/auth.ts` · `server/src/routes/auth.ts` · `server/src/app.ts` · `cli/src/commands/start.ts` · `cli/src/commands/doctor.ts` · `shared/src/dto.ts` · `shared/src/api.ts` · `src/src/api/client.ts` · `src/src/screens/AuthScreen.tsx` · `src/src/App.tsx` · `src/src/screens/SettingsScreen.tsx`

**Kenapa `runner`, bukan `server/src/services` seperti tertulis di spec:** `cli/package.json:13-21` tidak memuat `@hanoman/server`. `hanoman doctor` harus memakai resolver dan probe yang sama persis dengan route setup; menaruhnya di `server` akan memaksa CLI menyalin logikanya — drift menunggu terjadi. Ini penyimpangan sadar dari daftar "Menyentuh" di spec; catat di ADR-0138.

---

### Task 1: `config-env.ts` — tempat jawaban wizard hidup

**Files:**
- Create: `runner/src/config-env.ts`
- Create: `runner/test/config-env.test.ts`
- Modify: `runner/src/index.ts` (tambah satu baris export)

**Interfaces:**
- Consumes: —
- Produces: `CONFIG_ENV_FILE: string`, `configEnvPath(home: string): string`, `parseConfigEnv(text: string): Record<string,string>`, `formatConfigEnv(values: Record<string,string>): string`, `readConfigEnv(home: string): Record<string,string>`, `writeConfigEnv(home: string, values: Record<string,string>): void`

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/config-env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configEnvPath, formatConfigEnv, parseConfigEnv, readConfigEnv, writeConfigEnv,
} from "../src/config-env";

const home = (): string => mkdtempSync(join(tmpdir(), "hanoman-cfgenv-"));

describe("config.env", () => {
  it("mengabaikan komentar, baris kosong, dan baris tanpa '='", () => {
    expect(parseConfigEnv([
      "# komentar",
      "",
      "   ",
      "HANOMAN_HARDENING=1",
      "tanpa-sama-dengan",
      "  HANOMAN_DEPLOYMENT = public  ",
    ].join("\n"))).toEqual({ HANOMAN_HARDENING: "1", HANOMAN_DEPLOYMENT: "public" });
  });

  it("mempertahankan '=' di dalam nilai", () => {
    expect(parseConfigEnv("HANOMAN_EGRESS_PROXY=http://p:3128/?a=b")).toEqual({
      HANOMAN_EGRESS_PROXY: "http://p:3128/?a=b",
    });
  });

  it("round-trip format → parse", () => {
    const values = { HANOMAN_DEPLOYMENT: "public", HANOMAN_HARDENING: "1" };
    expect(parseConfigEnv(formatConfigEnv(values))).toEqual(values);
  });

  it("membuang nilai kosong saat memformat", () => {
    expect(formatConfigEnv({ A: "1", B: "" })).toBe("A=1\n");
  });

  it("berkas yang tak ada dibaca sebagai kosong, bukan melempar", () => {
    expect(readConfigEnv(home())).toEqual({});
  });

  it("menulis 0600 dan bisa dibaca kembali", () => {
    const dir = home();
    writeConfigEnv(dir, { HANOMAN_HARDENING: "1" });
    expect(readConfigEnv(dir)).toEqual({ HANOMAN_HARDENING: "1" });
    expect(statSync(configEnvPath(dir)).mode & 0o777).toBe(0o600);
    expect(readFileSync(configEnvPath(dir), "utf8")).toContain("HANOMAN_HARDENING=1");
  });

  it("menulis ulang mengganti isi, tidak menambahkan", () => {
    const dir = home();
    writeConfigEnv(dir, { HANOMAN_HARDENING: "1" });
    writeConfigEnv(dir, { HANOMAN_DEPLOYMENT: "local" });
    expect(readConfigEnv(dir)).toEqual({ HANOMAN_DEPLOYMENT: "local" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run --no-file-parallelism runner/test/config-env.test.ts`
Expected: FAIL — `Failed to resolve import "../src/config-env"`

- [x] **Step 3: Implementasi minimal**

Buat `runner/src/config-env.ts`:

```ts
// SPEC-884 · ADR-0138 · jawaban wizard setup awal hidup di berkas ini, BUKAN di `RuntimeConfig`.
// Resolver config server presedensinya DB → env (`server/src/config.ts:31`), jadi lewat sana siapa
// pun yang bisa menulis config bisa MEMATIKAN hardening — jebakan yang sama yang sudah dihindari
// ADR-0088 untuk `HANOMAN_SUPERVISOR`. Berkas ini sebaliknya digabung PALING LEMAH saat CLI
// men-spawn server (lihat `cli/src/commands/start.ts`), sehingga env systemd/shell selalu menang.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_ENV_FILE = "config.env";

export function configEnvPath(home: string): string {
  return join(home, CONFIG_ENV_FILE);
}

/** Murni. Format `KEY=value` per baris; `#` komentar; baris tanpa `=` diabaikan diam-diam. */
export function parseConfigEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    // Hanya pemisah PERTAMA yang dipotong — nilai boleh memuat '=' (URL proxy ber-query).
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Murni. Nilai kosong dibuang: "ada tapi kosong" tak pernah berarti apa pun di sini. */
export function formatConfigEnv(values: Record<string, string>): string {
  const lines = Object.entries(values)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => `${k}=${v.trim()}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Berkas absen bukan kegagalan — instalasi yang belum pernah menjalankan wizard normal. */
export function readConfigEnv(home: string): Record<string, string> {
  try { return parseConfigEnv(readFileSync(configEnvPath(home), "utf8")); }
  catch { return {}; }
}

/** Menimpa, bukan menambah: berkas ini adalah snapshot jawaban wizard terakhir. */
export function writeConfigEnv(home: string, values: Record<string, string>): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = configEnvPath(home);
  writeFileSync(path, formatConfigEnv(values), { mode: 0o600 });
  chmodSync(path, 0o600);   // umask bisa melonggarkan mode saat berkas sudah ada sebelumnya
}
```

Tambahkan di `runner/src/index.ts`, setelah baris `export * from "./paths";`:

```ts
export * from "./config-env";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run --no-file-parallelism runner/test/config-env.test.ts`
Expected: PASS — 7 test

- [x] **Step 5: Commit**

```bash
git add runner/src/config-env.ts runner/src/index.ts runner/test/config-env.test.ts
git commit -m "feat(spec-884): berkas config.env sebagai tempat jawaban wizard setup"
```

---

### Task 2: `runtime-profile.ts` — satu-satunya tempat aturan profil

**Files:**
- Create: `runner/src/runtime-profile.ts`
- Create: `runner/test/runtime-profile.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Consumes: —
- Produces: `type Deployment = "local" | "public"`, `resolveHardening(env: Record<string,string|undefined>): boolean`, `resolveDeployment(env: Record<string,string|undefined>): Deployment`

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/runtime-profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveDeployment, resolveHardening } from "../src/runtime-profile";

describe("profil runtime", () => {
  it("instalasi npm polos: lokal, hardening mati", () => {
    // Persis tujuh variabel yang disuntik serverEnv() (cli/src/commands/start.ts:175-184).
    const env = {
      NODE_ENV: "production", DATABASE_URL: "file:/h/hanoman.db", PORT: "8787",
      HOST: "127.0.0.1", HANOMAN_HOME: "/h", HANOMAN_SUPERVISOR: "1", HANOMAN_WEB_DIR: "/w",
    };
    expect(resolveHardening(env)).toBe(false);
    expect(resolveDeployment(env)).toBe("local");
  });

  it("NODE_ENV=production sendirian TIDAK lagi menyalakan hardening", () => {
    expect(resolveHardening({ NODE_ENV: "production" })).toBe(false);
  });

  it("HANOMAN_HARDENING=1 menyalakannya", () => {
    expect(resolveHardening({ HANOMAN_HARDENING: "1" })).toBe(true);
    expect(resolveDeployment({ HANOMAN_HARDENING: "1" })).toBe("public");
  });

  it("nilai selain '1' tidak menyalakan apa pun", () => {
    for (const v of ["0", "true", "yes", "", " "])
      expect(resolveHardening({ HANOMAN_HARDENING: v })).toBe(false);
  });

  // Kompatibilitas mundur — ini yang menjaga hub produksi tak turun senyap saat upgrade.
  it.each([
    ["HANOMAN_SESSION_SANDBOX", "podman"],
    ["HANOMAN_PUBLIC_ORIGINS", "https://help.example"],
    ["HANOMAN_TRUST_PROXY", "127.0.0.1/32"],
  ])("env ADR-0117 lama (%s) dibaca sebagai hardening menyala", (key, value) => {
    const env = { [key]: value };
    expect(resolveHardening(env)).toBe(true);
    expect(resolveDeployment(env)).toBe("public");
  });

  it("HANOMAN_SESSION_SANDBOX=off tidak menyalakan hardening", () => {
    expect(resolveHardening({ HANOMAN_SESSION_SANDBOX: "off" })).toBe(false);
  });

  it("env kosong/whitespace tidak dianggap terisi", () => {
    expect(resolveHardening({ HANOMAN_PUBLIC_ORIGINS: "  " })).toBe(false);
    expect(resolveHardening({ HANOMAN_TRUST_PROXY: "" })).toBe(false);
  });

  it("deployment=public sendirian TIDAK menyalakan hardening", () => {
    const env = { HANOMAN_DEPLOYMENT: "public" };
    expect(resolveDeployment(env)).toBe("public");
    expect(resolveHardening(env)).toBe(false);
  });

  it("hardening menyala memaksa deployment public walau env bilang local", () => {
    expect(resolveDeployment({ HANOMAN_DEPLOYMENT: "local", HANOMAN_HARDENING: "1" })).toBe("public");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run --no-file-parallelism runner/test/runtime-profile.test.ts`
Expected: FAIL — `Failed to resolve import "../src/runtime-profile"`

- [x] **Step 3: Implementasi minimal**

Buat `runner/src/runtime-profile.ts`:

```ts
// SPEC-884 · ADR-0138 · dua nilai eksplisit menggantikan `NODE_ENV` sebagai penentu hardening.
//
// Sebelum ini `NODE_ENV=production` merangkap TIGA peran: runtime terpaket (`web-dir.ts`), cookie
// `Secure` (`auth.ts`), dan seluruh gerbang ADR-0117. Akibatnya `npm i -g hanoman` polos — yang
// TAK PERNAH menyetel satu pun env hardening — menolak boot di device siapa pun. Sesudah ini
// `NODE_ENV` hanya berarti "terpaket"; yang keras hanya yang meminta dirinya dikeraskan.
type Env = Record<string, string | undefined>;

export type Deployment = "local" | "public";

const filled = (v: string | undefined): boolean => !!v && v.trim() !== "";

/**
 * Satu-satunya gerbang ADR-0117. Tiga syarat terakhir adalah KOMPATIBILITAS MUNDUR dan ia yang
 * menjaga hub produksi: instance yang env-nya sudah memuat penanda ADR-0117 sudah menyatakan
 * niatnya secara sadar (systemd `EnvironmentFile`), jadi ia tetap keras setelah upgrade. Tanpa
 * klausa ini `hanoman.nafanesia.id` kehilangan seluruh hardening-nya pada `npm i -g` berikutnya.
 */
export function resolveHardening(env: Env): boolean {
  if (env.HANOMAN_HARDENING === "1") return true;
  return env.HANOMAN_SESSION_SANDBOX === "podman"
    || filled(env.HANOMAN_PUBLIC_ORIGINS)
    || filled(env.HANOMAN_TRUST_PROXY);
}

/**
 * Peruntukan instance. TIDAK memaksa apa pun — ia hanya mengubah default wizard, peringatan, dan
 * penanda permanen. Hardening yang menyala selalu berarti publik; kebalikannya tidak berlaku.
 */
export function resolveDeployment(env: Env): Deployment {
  if (resolveHardening(env)) return "public";
  return env.HANOMAN_DEPLOYMENT === "public" ? "public" : "local";
}
```

Tambahkan di `runner/src/index.ts`, tepat di bawah `export * from "./config-env";`:

```ts
export * from "./runtime-profile";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run --no-file-parallelism runner/test/runtime-profile.test.ts`
Expected: PASS — 11 test (`it.each` menghasilkan 3)

- [x] **Step 5: Commit**

```bash
git add runner/src/runtime-profile.ts runner/src/index.ts runner/test/runtime-profile.test.ts
git commit -m "feat(spec-884): resolver profil runtime (deployment + hardening)"
```

---

### Task 3: `assertRuntimeBoundary` digerbangi hardening, bukan `NODE_ENV`

**Files:**
- Modify: `server/src/services/session-sandbox.ts:3-14`
- Modify: `server/test/session-sandbox.test.ts`

**Interfaces:**
- Consumes: `resolveHardening` (Task 2)
- Produces: `assertRuntimeBoundary(env, runtime)` dengan tanda tangan **tidak berubah**

- [x] **Step 1: Tulis test yang gagal**

Tambahkan blok ini ke `server/test/session-sandbox.test.ts`, **di dalam** `describe("production session sandbox", …)`, setelah test `"accepts single origin only when acknowledged explicitly (SPEC-805)"`. Jangan mengubah test yang sudah ada:

```ts
  // SPEC-884 · ADR-0138 · hardening jadi opt-in. Semua assertion di atas tetap berlaku apa adanya
  // karena env-nya memuat penanda ADR-0117 (sandbox/origin/proxy) yang dibaca `resolveHardening`
  // sebagai "menyala". Yang baru: instalasi polos tak lagi menabrak satu pun gerbang ini.
  it("tanpa hardening, instalasi npm polos boot — termasuk sebagai root (SPEC-884)", () => {
    const plain = {
      NODE_ENV: "production", DATABASE_URL: "file:/h/hanoman.db", PORT: "8787",
      HOST: "127.0.0.1", HANOMAN_HOME: "/h", HANOMAN_SUPERVISOR: "1", HANOMAN_WEB_DIR: "/w",
    };
    expect(() => assertRuntimeBoundary(plain, { uid: 1000, host: "127.0.0.1" })).not.toThrow();
    expect(() => assertRuntimeBoundary(plain, { uid: 0, host: "127.0.0.1" })).not.toThrow();
    expect(() => assertRuntimeBoundary(plain, { uid: 0, host: "0.0.0.0" })).not.toThrow();
  });

  it("HANOMAN_HARDENING=1 menegakkan seluruh gerbang lama (SPEC-884)", () => {
    const on = { NODE_ENV: "production", HANOMAN_HARDENING: "1" };
    expect(() => assertRuntimeBoundary(on, { uid: 0, host: "127.0.0.1" })).toThrow(/non-root/);
    expect(() => assertRuntimeBoundary(on, { uid: 1000, host: "127.0.0.1" })).toThrow(/SESSION_SANDBOX/);
  });

  it("hardening tak lagi diturunkan dari NODE_ENV (SPEC-884)", () => {
    // Dev/test yang menyalakan hardening secara sadar TETAP tergerbang…
    expect(() => assertRuntimeBoundary({ NODE_ENV: "test", HANOMAN_HARDENING: "1" },
      { uid: 0, host: "127.0.0.1" })).toThrow(/non-root/);
    // …dan production yang tidak menyalakannya TIDAK tergerbang.
    expect(() => assertRuntimeBoundary({ NODE_ENV: "production" },
      { uid: 0, host: "0.0.0.0" })).not.toThrow();
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-sandbox.test.ts`
Expected: FAIL — 3 test baru merah dengan `production Hanoman harus berjalan sebagai user non-root` / `HANOMAN_SESSION_SANDBOX=podman wajib di production`. Tiga test lama tetap hijau.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/session-sandbox.ts`, ganti baris 1-7 (import + dua baris pertama fungsi):

```ts
import { resolveHardening } from "@hanoman/runner";

type Env = Record<string, string | undefined>;

export function assertRuntimeBoundary(env: Env, runtime: { uid: number | undefined; host: string }): void {
  // SPEC-884 · ADR-0138 · satu-satunya perubahan pada gerbang ini: ia berhenti diturunkan dari
  // `NODE_ENV` dan mulai diturunkan dari hardening yang diminta eksplisit. Isinya di bawah TIDAK
  // disentuh — begitu hardening menyala, perilakunya identik dengan sebelum SPEC-884.
  if (!resolveHardening(env)) return;
  if (runtime.uid === 0) throw new Error("production Hanoman harus berjalan sebagai user non-root");
  if (env.HANOMAN_SESSION_SANDBOX !== "podman")
    throw new Error("HANOMAN_SESSION_SANDBOX=podman wajib di production");
```

Sisa fungsi (cek origin, trust proxy, bind loopback) **tidak diubah sama sekali**.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-sandbox.test.ts`
Expected: PASS — 6 test (3 lama + 3 baru)

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./server typecheck`
Expected: keluar 0, tanpa error

- [x] **Step 6: Commit**

```bash
git add server/src/services/session-sandbox.ts server/test/session-sandbox.test.ts
git commit -m "feat(spec-884): gerbang boot digerbangi hardening, bukan NODE_ENV"
```

---

### Task 4: Sandbox sesi, lead, dan chat portal ikut hardening

**Files:**
- Modify: `server/src/services/session-sandbox.ts:57` (di `sandboxArgvFromEnv`)
- Modify: `server/src/services/lead/brain.ts:97`
- Modify: `server/src/services/portal-chat/argv.ts:71-75`
- Modify: `server/test/lead-brain.test.ts`
- Modify: `server/test/portal-chat-argv.test.ts`

**Interfaces:**
- Consumes: `resolveHardening` (Task 2)
- Produces: tak ada API baru — hanya pemicu tiga gerbang yang berubah

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/portal-chat-argv.test.ts`, di dalam `describe` teratas:

```ts
  // SPEC-884 · chat portal berhenti menolak jalan hanya karena NODE_ENV=production. Yang menolak
  // sekarang adalah hardening yang menyala tanpa sandbox terkonfigurasi — fail-closed yang sama,
  // pemicu yang benar.
  it("jalan di instalasi terpaket tanpa hardening (SPEC-884)", () => {
    const p = portalChatProcess(
      { workspace: "/w" } as Parameters<typeof portalChatProcess>[0],
      { NODE_ENV: "production" } as NodeJS.ProcessEnv,
    );
    expect(p.file).not.toBe("podman");
    expect(p.cwd).toBe("/w");
  });

  it("menolak jalan saat hardening menyala tanpa sandbox (SPEC-884)", () => {
    expect(() => portalChatProcess(
      { workspace: "/w" } as Parameters<typeof portalChatProcess>[0],
      { NODE_ENV: "production", HANOMAN_HARDENING: "1" } as NodeJS.ProcessEnv,
    )).toThrow(/sandbox/);
  });
```

Tambahkan ke `server/test/lead-brain.test.ts`, di dalam `describe` teratas:

```ts
  it("lead one-shot jalan langsung di instalasi tanpa hardening (SPEC-884)", () => {
    const p = leadProcess("halo", { agent: "claude" } as Parameters<typeof leadProcess>[1],
      { NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(p.file).not.toBe("podman");
    p.cleanup();
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/portal-chat-argv.test.ts server/test/lead-brain.test.ts`
Expected: FAIL — `chat portal menolak jalan: sandbox sesi wajib di production` dan `session sandbox production tidak dikonfigurasi`

- [x] **Step 3: Implementasi minimal**

`server/src/services/session-sandbox.ts` — di `sandboxArgvFromEnv`, ganti baris `const mode = …`:

```ts
  // SPEC-884 · pemicunya hardening, bukan NODE_ENV. Operator yang menyetel HANOMAN_SESSION_SANDBOX
  // secara eksplisit tetap menang atas keduanya (termasuk "off" untuk mematikannya sementara).
  const mode = env.HANOMAN_SESSION_SANDBOX ?? (resolveHardening(env) ? "required" : "off");
```

`server/src/services/lead/brain.ts` — tambahkan import dan ganti baris 97:

```ts
import { resolveHardening } from "@hanoman/runner";
```
```ts
  const mode = env.HANOMAN_SESSION_SANDBOX ?? (resolveHardening(env) ? "required" : "off");
```

`server/src/services/portal-chat/argv.ts` — tambahkan import dan ganti blok baris 71-75:

```ts
import { resolveHardening } from "@hanoman/runner";
```
```ts
  const mode = env.HANOMAN_SESSION_SANDBOX ?? (resolveHardening(env) ? "required" : "off");
  if (mode === "off") {
    // SPEC-884 · fail-closed dipertahankan, tetapi terhadap hardening — bukan terhadap "terpaket".
    if (resolveHardening(env))
      throw new Error("chat portal menolak jalan: sandbox sesi wajib saat hardening menyala");
    return { file, args, cwd: o.workspace };
  }
```

Perbarui juga komentar blok di atas fungsi (`argv.ts:60-64`): ganti kata "Di produksi" menjadi "Saat hardening menyala".

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/portal-chat-argv.test.ts server/test/lead-brain.test.ts server/test/session-sandbox.test.ts`
Expected: PASS — semua, termasuk test lama kedua berkas

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-sandbox.ts server/src/services/lead/brain.ts server/src/services/portal-chat/argv.ts server/test/portal-chat-argv.test.ts server/test/lead-brain.test.ts
git commit -m "feat(spec-884): sandbox sesi, lead, dan chat portal ikut hardening"
```

---

### Task 5: Scanner upload jadi peringatan saat hardening mati

**Files:**
- Modify: `server/src/services/upload-pipeline.ts:65-70`
- Create: `server/test/upload-scanner-gate.test.ts`

**Interfaces:**
- Consumes: `resolveHardening` (Task 2)
- Produces: `scannerFromEnv(path: string): Promise<void>` — tanda tangan tak berubah

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/upload-scanner-gate.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { scannerFromEnv } from "../src/services/upload-pipeline";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

describe("gerbang scanner upload (SPEC-884)", () => {
  it("tanpa hardening: berkas diterima, tapi peringatannya dicetak", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.HANOMAN_UPLOAD_SCANNER;
    delete process.env.HANOMAN_HARDENING;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(scannerFromEnv("/tmp/x")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HANOMAN_UPLOAD_SCANNER"));
  });

  it("hardening menyala tanpa scanner: fail closed", async () => {
    process.env.HANOMAN_HARDENING = "1";
    delete process.env.HANOMAN_UPLOAD_SCANNER;
    await expect(scannerFromEnv("/tmp/x")).rejects.toMatchObject({ code: "UPLOAD_SCAN" });
  });

  it("path scanner relatif tetap ditolak apa pun profilnya", async () => {
    delete process.env.HANOMAN_HARDENING;
    process.env.HANOMAN_UPLOAD_SCANNER = "clamscan";
    await expect(scannerFromEnv("/tmp/x")).rejects.toMatchObject({ code: "UPLOAD_SCAN" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/upload-scanner-gate.test.ts`
Expected: FAIL — test pertama menolak (`scanner required`) alih-alih resolve

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/upload-pipeline.ts`, tambahkan import `resolveHardening` dari `@hanoman/runner` dan ganti blok `if (!command)`:

```ts
  if (!command) {
    // SPEC-884 · ADR-0138 · fail-closed dipertahankan untuk instance yang minta dikeraskan. Di
    // instalasi biasa scanner virus bukan prasyarat yang masuk akal, tapi ketiadaannya tak boleh
    // senyap — lampiran diterima tanpa dipindai, dan itu harus terbaca di log.
    if (resolveHardening(process.env))
      return Promise.reject(new UploadError("UPLOAD_SCAN", "scanner required"));
    console.warn("upload: HANOMAN_UPLOAD_SCANNER tak disetel — lampiran diterima tanpa dipindai");
    return Promise.resolve();
  }
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/upload-scanner-gate.test.ts`
Expected: PASS — 3 test

- [x] **Step 5: Commit**

```bash
git add server/src/services/upload-pipeline.ts server/test/upload-scanner-gate.test.ts
git commit -m "feat(spec-884): scanner upload jadi peringatan saat hardening mati"
```

---

### Task 6: Setup token hanya diminta saat hardening menyala

**Files:**
- Modify: `server/src/app.ts:191`
- Modify: `server/test/bootstrap.test.ts`

**Interfaces:**
- Consumes: `resolveHardening` (Task 2)
- Produces: `GET /api/auth/status` mengembalikan `setupTokenRequired: false` di instalasi tanpa hardening

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/bootstrap.test.ts`, di dalam `describe("one-time bootstrap token", …)`:

```ts
  it("tanpa hardening, akun pertama dibuat tanpa setup token (SPEC-884)", async () => {
    await resetDb();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: await home() } });
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toMatchObject({ needsSetup: true, setupTokenRequired: false });
    expect(status.json().setupTokenPath).toBeUndefined();

    const r = await app.inject({ method: "POST", url: "/api/auth/setup",
      payload: { email: "a@b.co", password: "password1" } });
    expect(r.statusCode).toBe(200);
  });

  it("hardening menyala tetap mewajibkan bukti setup token (SPEC-884)", async () => {
    await resetDb();
    const dir = await home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HARDENING: "1", HANOMAN_HOME: dir } });
    expect((await app.inject({ method: "GET", url: "/api/auth/status" })).json())
      .toMatchObject({ setupTokenRequired: true });
    expect((await app.inject({ method: "POST", url: "/api/auth/setup",
      payload: { email: "a@b.co", password: "password1" } })).statusCode).toBe(400);
  });
```

> `buildApp` sudah menerima `{ env }` (`server/src/app.ts:78-80`); `resolveHome(env)` di baris 191 membaca `HANOMAN_HOME` dari env yang sama, jadi token mendarat di tmpdir dan bukan di home nyata (pelajaran SPEC-880).

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/bootstrap.test.ts`
Expected: FAIL — test pertama merah: `setupTokenRequired` `true`, dan setup menjawab 400

- [x] **Step 3: Implementasi minimal**

Di `server/src/app.ts`, ganti baris 191:

```ts
    // SPEC-884 · ADR-0138 · bukti setup token menjaga instance yang minta dikeraskan. Di instalasi
    // biasa ia justru menutup pintu terakhir: orang yang baru `npm i -g hanoman` harus membaca
    // berkas di HANOMAN_HOME lewat shell sebelum bisa memakai dashboard-nya sendiri.
    await api.register(authRoutes, { bootstrapRequired: resolveHardening(env), home: resolveHome(env) });
```

Ubah import di `server/src/app.ts:60`:

```ts
import { resolveHardening, resolveHome } from "@hanoman/runner";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/bootstrap.test.ts server/test/auth-routes.test.ts`
Expected: PASS — kedua berkas

- [x] **Step 5: Commit**

```bash
git add server/src/app.ts server/test/bootstrap.test.ts
git commit -m "feat(spec-884): setup token hanya diminta saat hardening menyala"
```

---

### Task 7: `AuthScreen` menghormati `setupTokenRequired`

**Files:**
- Modify: `src/src/screens/AuthScreen.tsx:9,12,16,23,58`
- Modify: `src/src/App.tsx:1256`
- Create: `src/test/auth-screen-token.test.tsx`

**Interfaces:**
- Consumes: `AuthStatus.setupTokenRequired` (sudah ada, `shared/src/dto.ts:497`)
- Produces: `<AuthScreen needsSetup setupTokenRequired onDone />` — prop baru `setupTokenRequired?: boolean`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/auth-screen-token.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthScreen } from "../src/screens/AuthScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  api: { setup: vi.fn(async () => ({ user: { id: "u1", email: "a@b.co", role: "admin", createdAt: "" } })) },
  ApiError: class extends Error { status = 0 },
}));

beforeEach(() => vi.clearAllMocks());

const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("kamu@nafanesia.id"), { target: { value: "a@b.co" } });
  fireEvent.change(screen.getAllByPlaceholderText("••••••••")[0]!, { target: { value: "password1" } });
};

describe("AuthScreen · setup token (SPEC-884)", () => {
  it("tak menampilkan field token dan bisa submit saat token tak diwajibkan", async () => {
    render(<AuthScreen needsSetup setupTokenRequired={false} onDone={() => {}} />);
    expect(screen.queryByText("Setup token")).toBeNull();
    fill();
    const btn = screen.getByRole("button", { name: /Buat akun & masuk/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(api.setup).toHaveBeenCalledWith({ email: "a@b.co", password: "password1" }));
  });

  it("tetap mewajibkan token saat server memintanya", () => {
    render(<AuthScreen needsSetup setupTokenRequired onDone={() => {}} />);
    expect(screen.getByText("Setup token")).toBeTruthy();
    fill();
    expect(screen.getByRole("button", { name: /Buat akun & masuk/ })).toBeDisabled();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/auth-screen-token.test.tsx`
Expected: FAIL — test pertama: field "Setup token" masih ada dan tombol disabled

- [x] **Step 3: Implementasi minimal**

Di `src/src/screens/AuthScreen.tsx`, ganti tanda tangan komponen (baris 9), `canSubmit` (baris 16-17), pemanggilan `api.setup` (baris 23), dan render field token (baris 58-61):

```tsx
export function AuthScreen({ needsSetup, setupTokenRequired = false, onDone }: {
  needsSetup: boolean; setupTokenRequired?: boolean; onDone: (u: UserView) => void;
}) {
```
```tsx
  // SPEC-884 · ADR-0138 · sebelum ini form mengunci tombol setiap kali `needsSetup` benar, tanpa
  // pernah membaca `setupTokenRequired` yang sudah dikirim /auth/status — jadi walau server tak
  // meminta token, akun pertama TAK BISA dibuat dari UI. Server tetap otoritasnya; ini cuma cermin.
  const needsToken = needsSetup && setupTokenRequired;
  const canSubmit = /\S+@\S+\.\S+/.test(email) && password.length >= (needsSetup ? 8 : 1)
    && (!needsToken || setupToken.trim().length > 0);
```
```tsx
      const { user } = await (needsSetup
        ? api.setup(needsToken ? { email, password, setupToken: setupToken.trim() } : { email, password })
        : api.login({ email, password }));
```
```tsx
            {needsToken && <Field label="Setup token" hint="baca setup.token di HANOMAN_HOME pada host server">
```

Di `src/src/App.tsx:1256`, teruskan prop-nya:

```tsx
  if (!auth.user) return <AuthScreen needsSetup={auth.needsSetup} setupTokenRequired={auth.setupTokenRequired ?? false}
    onDone={(u) => setAuth({ needsSetup: false, user: u })} />;
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/auth-screen-token.test.tsx src/test/auth-responsive.test.tsx`
Expected: PASS — kedua berkas

- [x] **Step 5: Commit**

```bash
git add src/src/screens/AuthScreen.tsx src/src/App.tsx src/test/auth-screen-token.test.tsx
git commit -m "fix(spec-884): AuthScreen menghormati setupTokenRequired"
```

---

### Task 8: Cookie `Secure` dari skema request

**Files:**
- Modify: `server/src/services/auth.ts:80-88`
- Modify: `server/src/routes/auth.ts:13-16`
- Create: `server/test/auth-cookie-secure.test.ts`

**Interfaces:**
- Consumes: `resolveHardening` (Task 2)
- Produces: `cookieOpts(req: { protocol?: string; headers: Record<string, unknown> })` — **breaking**: sekarang wajib menerima request

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/auth-cookie-secure.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { cookieOpts } from "../src/services/auth";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

const req = (o: { protocol?: string; xfp?: string }) => ({
  protocol: o.protocol ?? "http",
  headers: o.xfp === undefined ? {} : { "x-forwarded-proto": o.xfp },
});

describe("cookie Secure (SPEC-884)", () => {
  it("http polos: tanpa Secure — login dari HP di LAN berhenti gagal senyap", () => {
    delete process.env.HANOMAN_HARDENING;
    expect(cookieOpts(req({})).secure).toBe(false);
  });

  it("https langsung: Secure", () => {
    expect(cookieOpts(req({ protocol: "https" })).secure).toBe(true);
  });

  // Cloudflare Tunnel / reverse proxy TANPA HANOMAN_TRUST_PROXY: Fastify tak memercayai header
  // ini, jadi `req.protocol` tetap "http". Kalau kita ikut `req.protocol` saja, instance yang HARI
  // INI dapat Secure dari NODE_ENV akan kehilangannya — regresi. Header dibaca langsung.
  it("x-forwarded-proto dipercaya walau trustProxy kosong", () => {
    expect(cookieOpts(req({ xfp: "https" })).secure).toBe(true);
    expect(cookieOpts(req({ xfp: "https,http" })).secure).toBe(true);
    expect(cookieOpts(req({ xfp: "http" })).secure).toBe(false);
  });

  it("hardening memaksa Secure apa pun skema request-nya", () => {
    process.env.HANOMAN_HARDENING = "1";
    expect(cookieOpts(req({})).secure).toBe(true);
  });

  it("atribut lain tak berubah", () => {
    expect(cookieOpts(req({}))).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/auth-cookie-secure.test.ts`
Expected: FAIL — `Expected 0 arguments, but got 1` / `secure` selalu mengikuti `NODE_ENV`

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/auth.ts`, ganti `cookieOpts` (baris 80-88):

```ts
/**
 * SPEC-884 · ADR-0138 · `Secure` diturunkan dari SKEMA REQUEST, bukan dari `NODE_ENV`.
 *
 * `x-forwarded-proto` sengaja dibaca LANGSUNG dari header, bukan lewat `req.protocol`: Fastify
 * hanya memercayai header itu bila `trustProxy` terisi, dan `trustProxyFromEnv` mengembalikan
 * `false` tanpa `HANOMAN_TRUST_PROXY` (`services/ingress-policy.ts:55-57`). Instance di balik TLS
 * yang tak menyetel variabel itu — bentuk hanoman lokal di balik Cloudflare Tunnel — karena itu
 * akan KEHILANGAN `Secure` yang hari ini didapatnya dari `NODE_ENV`.
 *
 * Memercayai header ini aman karena arahnya satu: menyuntiknya hanya bisa membuat cookie lebih
 * ketat. Melonggarkannya menuntut MENGHAPUS header, dan header yang absen memang berarti request
 * polos. Yang mungkin terjadi hanyalah cookie `Secure` di koneksi http — cookie tak terkirim,
 * gagal tertutup.
 */
export function cookieOpts(req: { protocol?: string; headers: Record<string, unknown> }) {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  const https = req.protocol === "https" || forwarded === "https";
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: https || resolveHardening(process.env),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
```

Tambahkan import di `server/src/services/auth.ts`:

```ts
import { resolveHardening } from "@hanoman/runner";
```

Di `server/src/routes/auth.ts`, ganti helper `issue` (baris 13-16):

```ts
async function issue(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = await auth.createSession(userId);
  reply.setCookie(auth.COOKIE_NAME, token, auth.cookieOpts(req));
}
```

Ubah import di baris 1 menjadi:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
```

Lalu perbarui **tiga** pemanggil `issue(...)` di berkas itu (setup, login, change-password) menjadi `await issue(req, reply, user.id);`.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/auth-cookie-secure.test.ts server/test/auth-routes.test.ts server/test/bootstrap.test.ts`
Expected: PASS — ketiganya

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./server typecheck`
Expected: keluar 0

- [x] **Step 6: Commit**

```bash
git add server/src/services/auth.ts server/src/routes/auth.ts server/test/auth-cookie-secure.test.ts
git commit -m "feat(spec-884): cookie Secure dari skema request, bukan NODE_ENV"
```

---

### Task 9: Kontrak bersama — exit code, DTO setup, path API

**Files:**
- Modify: `shared/src/dto.ts` (dekat baris 493 dan 607)
- Modify: `shared/src/api.ts` (dekat baris 149)
- Create: `shared/test/setup-dto.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `CONFIG_RESTART_EXIT = 76`, `type PrerequisiteId`, `type SetupPrerequisite`, `type SetupStatus`, `zSetupApply`, `paths.setupStatus`, `paths.setupApply`

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/test/setup-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONFIG_RESTART_EXIT, UPDATE_RESTART_EXIT, zSetupApply } from "../src/dto";
import { paths } from "../src/api";

describe("kontrak setup (SPEC-884)", () => {
  it("sentinel restart config terpisah dari sentinel update", () => {
    expect(CONFIG_RESTART_EXIT).toBe(76);
    expect(CONFIG_RESTART_EXIT).not.toBe(UPDATE_RESTART_EXIT);
  });

  it("zSetupApply menerima bentuk minimal dan menolak deployment asing", () => {
    expect(zSetupApply.safeParse({ deployment: "local", hardening: false }).success).toBe(true);
    expect(zSetupApply.safeParse({ deployment: "staging", hardening: false }).success).toBe(false);
    expect(zSetupApply.safeParse({ deployment: "public" }).success).toBe(false);
  });

  it("path setup terdaftar", () => {
    expect(paths.setupStatus).toBe("/api/setup/status");
    expect(paths.setupApply).toBe("/api/setup");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/test/setup-dto.test.ts`
Expected: FAIL — `CONFIG_RESTART_EXIT` dan `zSetupApply` tak diekspor

- [x] **Step 3: Implementasi minimal**

Di `shared/src/dto.ts`, tepat di bawah `export const UPDATE_RESTART_EXIT = 75;` (baris 607):

```ts
// SPEC-884 · ADR-0138 · "tulis config lalu jalankan ulang", TANPA memasang apa pun. Memakai ulang
// UPDATE_RESTART_EXIT akan menjalankan `npm i -g hanoman@latest` setiap kali seseorang
// menyelesaikan wizard — akibat yang sama sekali tak diminta.
export const CONFIG_RESTART_EXIT = 76;
```

Di `shared/src/dto.ts`, tepat di bawah `zSetup` (baris 493):

```ts
// SPEC-884 · ADR-0138 · wizard setup awal.
export type PrerequisiteId =
  | "podman" | "network" | "egress-proxy" | "credential-dir"
  | "control-origin" | "trust-proxy" | "upload-scanner";
export type SetupPrerequisite = { id: PrerequisiteId; label: string; ok: boolean; detail: string | null };
export type SetupStatus = {
  needed: boolean;                 // belum ada satu pun user
  deployment: "local" | "public";
  hardening: boolean;
  hardeningLocked: boolean;        // dinyalakan di luar config.env (systemd/shell) → UI tak boleh mematikannya
  supervised: boolean;             // HANOMAN_SUPERVISOR === "1" → server bisa menjalankan ulang dirinya
  setupTokenRequired: boolean;
  prerequisites: SetupPrerequisite[];
};
export const zSetupApply = z.object({
  deployment: z.enum(["local", "public"]),
  hardening: z.boolean(),
  acknowledgedUnhardened: z.boolean().optional(),
});
export type SetupApplyResult = { restart: "self" | "manual" };
```

Di `shared/src/api.ts`, setelah baris `authChangePassword: …` (baris 149):

```ts
  // SPEC-884 · wizard setup awal
  setupStatus: `${API}/setup/status`,
  setupApply: `${API}/setup`,
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/test/setup-dto.test.ts`
Expected: PASS — 3 test

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts shared/test/setup-dto.test.ts
git commit -m "feat(spec-884): kontrak setup — CONFIG_RESTART_EXIT, DTO, path"
```

---

### Task 10: Supervisor membaca `config.env` dan menangani exit 76

**Files:**
- Modify: `cli/src/commands/start.ts:155-166` (`planSupervisorStep`), `:196-207` (`runServer`), `:236-280` (loop)
- Modify: `cli/test/start-args.test.ts` (atau buat `cli/test/start-supervisor.test.ts`)

**Interfaces:**
- Consumes: `readConfigEnv` (Task 1), `CONFIG_RESTART_EXIT` (Task 9)
- Produces: `SupervisorStep` bertambah `{ action: "restart" }`; `planSupervisorStep(code, restartsUsed, configRestartsUsed?)`; `MAX_CONFIG_RESTARTS = 5`; `spawnEnv(fileEnv, processEnv, serverEnv)`

- [x] **Step 1: Tulis test yang gagal**

Buat `cli/test/start-supervisor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_CONFIG_RESTARTS, MAX_UPDATE_RESTARTS, planSupervisorStep, spawnEnv,
} from "../src/commands/start";
import { CONFIG_RESTART_EXIT, UPDATE_RESTART_EXIT } from "@hanoman/shared";

describe("supervisor (SPEC-884)", () => {
  it("exit 76 = jalankan ulang TANPA memasang apa pun", () => {
    expect(planSupervisorStep(CONFIG_RESTART_EXIT, 0, 0)).toEqual({ action: "restart" });
  });

  it("jatah restart config terpisah dari jatah update", () => {
    expect(planSupervisorStep(CONFIG_RESTART_EXIT, MAX_UPDATE_RESTARTS, 0)).toEqual({ action: "restart" });
    expect(planSupervisorStep(CONFIG_RESTART_EXIT, 0, MAX_CONFIG_RESTARTS))
      .toEqual({ action: "exit", code: CONFIG_RESTART_EXIT });
  });

  it("perilaku lama tak berubah", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, 0, 0)).toEqual({ action: "update" });
    expect(planSupervisorStep(0, 0, 0)).toEqual({ action: "exit", code: 0 });
    expect(planSupervisorStep(1, 0, 0)).toEqual({ action: "exit", code: 1 });
  });
});

describe("presedensi env spawn (SPEC-884)", () => {
  const file = { HANOMAN_HARDENING: "1", HANOMAN_DEPLOYMENT: "public", ONLY_FILE: "f" };
  const proc = { HANOMAN_HARDENING: "", PATH: "/bin" };
  const server = { NODE_ENV: "production", HANOMAN_SUPERVISOR: "1" };

  it("env proses (systemd/shell) MENGALAHKAN config.env", () => {
    expect(spawnEnv(file, proc, server).HANOMAN_HARDENING).toBe("");
  });

  it("kunci yang hanya ada di berkas tetap terbawa", () => {
    expect(spawnEnv(file, proc, server).ONLY_FILE).toBe("f");
    expect(spawnEnv(file, proc, server).HANOMAN_DEPLOYMENT).toBe("public");
  });

  it("serverEnv() tetap paling kuat", () => {
    expect(spawnEnv({ NODE_ENV: "development" }, { NODE_ENV: "test" }, server).NODE_ENV).toBe("production");
    expect(spawnEnv(file, proc, server).HANOMAN_SUPERVISOR).toBe("1");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run cli/test/start-supervisor.test.ts`
Expected: FAIL — `spawnEnv` dan `MAX_CONFIG_RESTARTS` tak diekspor; `planSupervisorStep` menolak argumen ketiga

- [x] **Step 3: Implementasi minimal**

Di `cli/src/commands/start.ts`:

Ubah import baris 13:

```ts
import { CONFIG_RESTART_EXIT, UPDATE_RESTART_EXIT } from "@hanoman/shared";
```

Ubah import `@hanoman/runner` (baris 10-12) supaya memuat `readConfigEnv`:

```ts
import {
  resolveHome, resolveDbUrl, dbFilePath, prismaCliPath, dbUrlNotice, repairSpawnHelper, readConfigEnv,
} from "@hanoman/runner";
```

Ganti `SupervisorStep` + `planSupervisorStep` (baris 155-166):

```ts
export const MAX_UPDATE_RESTARTS = 5;
// SPEC-884 · jatah TERPISAH: menyelesaikan wizard tak boleh memakan jatah update, dan sebaliknya.
export const MAX_CONFIG_RESTARTS = 5;

export type SupervisorStep =
  | { action: "exit"; code: number }
  | { action: "update" }
  | { action: "restart" };

export function planSupervisorStep(
  code: number, restartsUsed: number, configRestartsUsed = 0,
): SupervisorStep {
  // SPEC-884 · ADR-0138 · "config berubah, jalankan ulang" — TANPA npm, TANPA prisma generate.
  if (code === CONFIG_RESTART_EXIT)
    return configRestartsUsed >= MAX_CONFIG_RESTARTS ? { action: "exit", code } : { action: "restart" };
  if (code !== UPDATE_RESTART_EXIT) return { action: "exit", code };
  if (restartsUsed >= MAX_UPDATE_RESTARTS) return { action: "exit", code };
  return { action: "update" };
}
```

Tambahkan fungsi murni tepat di bawahnya:

```ts
/**
 * SPEC-884 · ADR-0138 · presedensi env proses anak, dibuat MURNI supaya urutannya bisa diuji
 * alih-alih diandalkan dari pembacaan. `config.env` sengaja PALING LEMAH: `EnvironmentFile`
 * systemd dan `export` di shell mengalahkannya, sehingga wizard di dashboard secara struktural tak
 * bisa mematikan hardening yang dipasang operator. `serverEnv()` tetap paling kuat.
 */
export function spawnEnv(
  fileEnv: Record<string, string>,
  processEnv: NodeJS.ProcessEnv,
  server: Record<string, string>,
): NodeJS.ProcessEnv {
  return { ...fileEnv, ...processEnv, ...server };
}
```

Ganti `runServer` (baris 196-207) supaya menerima env berkas dan membacanya **tiap putaran**:

```ts
function runServer(
  serverJs: string, env: Record<string, string>, fileEnv: Record<string, string>,
): Promise<number> {
  const child = spawn(process.execPath, [serverJs], {
    stdio: "inherit", env: spawnEnv(fileEnv, process.env, env),
  });
  const handlers = (["SIGINT", "SIGTERM"] as const).map((sig) => [sig, () => child.kill(sig)] as const);
  for (const [sig, h] of handlers) process.on(sig, h);
  return new Promise<number>((res) => child.on("exit", (code) => {
    for (const [sig, h] of handlers) process.off(sig, h);
    res(code ?? 0);
  }));
}
```

Di loop supervisor (baris ~253), ganti awal iterasi dan tambahkan cabang `restart`:

```ts
  let restartsUsed = 0;
  let configRestartsUsed = 0;
  for (;;) {
    // Dibaca ULANG tiap putaran: wizard menulis berkas ini TEPAT sebelum meminta restart.
    const code = await runServer(layout.server, env, readConfigEnv(home));
    const step = planSupervisorStep(code, restartsUsed, configRestartsUsed);
    if (step.action === "exit") {
      if (code === UPDATE_RESTART_EXIT)
        ctx.stderr(`hanoman: jatah update-restart (${MAX_UPDATE_RESTARTS}) habis — keluar tanpa memasang\n`);
      if (code === CONFIG_RESTART_EXIT)
        ctx.stderr(`hanoman: jatah restart-konfigurasi (${MAX_CONFIG_RESTARTS}) habis — keluar\n`);
      return step.code;
    }
    if (step.action === "restart") {
      configRestartsUsed++;
      ctx.stdout(`hanoman · konfigurasi berubah; menjalankan ulang (${configRestartsUsed}/${MAX_CONFIG_RESTARTS})\n`);
      continue;
    }

    restartsUsed++;
```

Sisa cabang `update` tidak diubah.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run cli/test/start-supervisor.test.ts cli/test/start-args.test.ts`
Expected: PASS — kedua berkas

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./cli typecheck`
Expected: keluar 0

- [x] **Step 6: Commit**

```bash
git add cli/src/commands/start.ts cli/test/start-supervisor.test.ts
git commit -m "feat(spec-884): supervisor membaca config.env dan menangani exit 76"
```

---

### Task 11: Probe prasyarat hardening, satu sumber untuk CLI dan server

**Files:**
- Create: `runner/src/sandbox-probe.ts`
- Create: `runner/test/sandbox-probe.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Consumes: `SetupPrerequisite`, `PrerequisiteId` (Task 9)
- Produces: `type ProbeFacts = { podman: string|null; rootless: boolean; networkExists: boolean; credentialDirReadable: boolean }`, `prerequisites(env, facts): SetupPrerequisite[]`, `allReady(rows): boolean`, `collectProbeFacts(env): ProbeFacts`

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/sandbox-probe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allReady, prerequisites, type ProbeFacts } from "../src/sandbox-probe";

const facts = (o: Partial<ProbeFacts> = {}): ProbeFacts => ({
  podman: null, rootless: false, networkExists: false, credentialDirReadable: false, ...o,
});
const byId = (rows: ReturnType<typeof prerequisites>, id: string) => rows.find((r) => r.id === id)!;

describe("prasyarat hardening (SPEC-884)", () => {
  it("mesin kosong: semua merah, tak ada yang siap", () => {
    const rows = prerequisites({}, facts());
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => !r.ok)).toBe(true);
    expect(allReady(rows)).toBe(false);
  });

  it("podman ada tapi tidak rootless tetap merah, dan alasannya disebut", () => {
    const row = byId(prerequisites({}, facts({ podman: "podman 5.2.0", rootless: false })), "podman");
    expect(row.ok).toBe(false);
    expect(row.detail).toContain("rootless");
  });

  it("scanner upload harus absolut", () => {
    expect(byId(prerequisites({ HANOMAN_UPLOAD_SCANNER: "clamscan" }, facts()), "upload-scanner").ok).toBe(false);
    expect(byId(prerequisites({ HANOMAN_UPLOAD_SCANNER: "/usr/bin/clamscan" }, facts()), "upload-scanner").ok).toBe(true);
  });

  it("trusted proxy menolak nilai yang bukan hop/CIDR", () => {
    expect(byId(prerequisites({ HANOMAN_TRUST_PROXY: "true" }, facts()), "trust-proxy").ok).toBe(false);
    expect(byId(prerequisites({ HANOMAN_TRUST_PROXY: "1" }, facts()), "trust-proxy").ok).toBe(true);
    expect(byId(prerequisites({ HANOMAN_TRUST_PROXY: "127.0.0.1/32" }, facts()), "trust-proxy").ok).toBe(true);
  });

  it("semua terpenuhi → siap", () => {
    const env = {
      HANOMAN_EGRESS_PROXY: "http://egress:3128",
      HANOMAN_AGENT_CREDENTIAL_DIR: "/srv/cred",
      HANOMAN_CONTROL_ORIGINS: "https://admin.example",
      HANOMAN_TRUST_PROXY: "127.0.0.1/32",
      HANOMAN_UPLOAD_SCANNER: "/usr/bin/clamscan",
    };
    const rows = prerequisites(env, facts({
      podman: "podman 5.2.0", rootless: true, networkExists: true, credentialDirReadable: true,
    }));
    expect(allReady(rows)).toBe(true);
  });

  it("credential dir yang terisi tapi tak terbaca tetap merah", () => {
    const rows = prerequisites({ HANOMAN_AGENT_CREDENTIAL_DIR: "/srv/cred" },
      facts({ credentialDirReadable: false }));
    expect(byId(rows, "credential-dir").ok).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run runner/test/sandbox-probe.test.ts`
Expected: FAIL — `Failed to resolve import "../src/sandbox-probe"`

- [x] **Step 3: Implementasi minimal**

Buat `runner/src/sandbox-probe.ts`:

```ts
// SPEC-884 · ADR-0138 · prasyarat hardening ADR-0117, dinilai di SATU tempat supaya
// `hanoman doctor` dan wizard setup tak pernah menjawab berbeda tentang mesin yang sama.
// Keputusannya murni (fakta → baris); IO-nya dipisah di `collectProbeFacts`.
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import type { SetupPrerequisite } from "@hanoman/shared";

type Env = Record<string, string | undefined>;

export type ProbeFacts = {
  podman: string | null;
  rootless: boolean;
  networkExists: boolean;
  credentialDirReadable: boolean;
};

const filled = (v: string | undefined): boolean => !!v && v.trim() !== "";

// Cermin `trustProxyFromEnv` (server/src/services/ingress-policy.ts:55-63) tanpa melempar —
// wizard menampilkan status, bukan menggagalkan boot.
function trustProxyOk(raw: string | undefined): boolean {
  const v = raw?.trim();
  if (!v) return false;
  if (/^[1-9]\d*$/.test(v)) return true;
  const values = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (!values.length) return false;
  return !values.some((s) => s === "true" || (!s.includes("/") && s !== "loopback"));
}

export function prerequisites(env: Env, facts: ProbeFacts): SetupPrerequisite[] {
  const network = env.HANOMAN_SESSION_NETWORK ?? "hanoman-egress";
  const credentialDir = env.HANOMAN_AGENT_CREDENTIAL_DIR;
  const scanner = env.HANOMAN_UPLOAD_SCANNER?.trim();
  return [
    { id: "podman", label: "Podman rootless",
      ok: !!facts.podman && facts.rootless,
      detail: facts.podman
        ? (facts.rootless ? facts.podman : `${facts.podman} — berjalan rootful, butuh rootless`)
        : "podman tak ada" },
    { id: "network", label: `Network "${network}"`,
      ok: facts.networkExists, detail: facts.networkExists ? network : `network ${network} belum dibuat` },
    { id: "egress-proxy", label: "Egress proxy",
      ok: filled(env.HANOMAN_EGRESS_PROXY),
      detail: env.HANOMAN_EGRESS_PROXY ?? "HANOMAN_EGRESS_PROXY belum disetel" },
    { id: "credential-dir", label: "Dir credential agen",
      ok: filled(credentialDir) && facts.credentialDirReadable,
      detail: !filled(credentialDir)
        ? "HANOMAN_AGENT_CREDENTIAL_DIR belum disetel"
        : (facts.credentialDirReadable ? credentialDir! : `${credentialDir} — tak terbaca`) },
    { id: "control-origin", label: "Control origin",
      ok: filled(env.HANOMAN_CONTROL_ORIGINS),
      detail: env.HANOMAN_CONTROL_ORIGINS ?? "HANOMAN_CONTROL_ORIGINS belum disetel" },
    { id: "trust-proxy", label: "Trusted proxy hop/CIDR",
      ok: trustProxyOk(env.HANOMAN_TRUST_PROXY),
      detail: filled(env.HANOMAN_TRUST_PROXY)
        ? (trustProxyOk(env.HANOMAN_TRUST_PROXY) ? env.HANOMAN_TRUST_PROXY! : "harus hop atau CIDR eksplisit")
        : "HANOMAN_TRUST_PROXY belum disetel" },
    { id: "upload-scanner", label: "Scanner upload",
      ok: !!scanner && isAbsolute(scanner),
      detail: !scanner ? "HANOMAN_UPLOAD_SCANNER belum disetel"
        : (isAbsolute(scanner) ? scanner : `${scanner} — path harus absolut`) },
  ];
}

export function allReady(rows: SetupPrerequisite[]): boolean {
  return rows.every((r) => r.ok);
}

function run(file: string, args: string[]): string | null {
  try { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/** IO. Dipanggil `doctor` dan route setup; tak pernah melempar — kegagalan probe adalah data. */
export function collectProbeFacts(env: Env): ProbeFacts {
  const podman = run("podman", ["--version"]);
  const network = env.HANOMAN_SESSION_NETWORK ?? "hanoman-egress";
  const dir = env.HANOMAN_AGENT_CREDENTIAL_DIR;
  let credentialDirReadable = false;
  if (dir) { try { accessSync(dir, constants.R_OK); credentialDirReadable = true; } catch { /* tetap false */ } }
  return {
    podman,
    rootless: podman ? run("podman", ["info", "--format", "{{.Host.Security.Rootless}}"]) === "true" : false,
    networkExists: podman ? run("podman", ["network", "exists", network]) !== null : false,
    credentialDirReadable,
  };
}
```

Tambahkan di `runner/src/index.ts`:

```ts
export * from "./sandbox-probe";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run runner/test/sandbox-probe.test.ts`
Expected: PASS — 6 test

- [x] **Step 5: Commit**

```bash
git add runner/src/sandbox-probe.ts runner/src/index.ts runner/test/sandbox-probe.test.ts
git commit -m "feat(spec-884): probe prasyarat hardening bersama CLI dan server"
```

---

### Task 12: `hanoman doctor` berhenti menyatakan sandbox fatal

**Files:**
- Modify: `cli/src/commands/doctor.ts:120-131` dan `:49-53`
- Modify: `cli/test/doctor.test.ts`

**Interfaces:**
- Consumes: `resolveHardening` (Task 2), `collectProbeFacts`/`prerequisites`/`allReady` (Task 11)
- Produces: `Probes.sandboxRequired` kini diturunkan dari hardening

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `cli/test/doctor.test.ts`:

```ts
  it("sandbox non-fatal saat hardening mati (SPEC-884)", () => {
    const r = doctorReport({
      node: "v20.11.0", git: "git 2.44", tmux: "tmux 3.4", claude: "1.0", codex: null, gh: null,
      dirs: [], web: true, db: "/h/hanoman.db", methods: [],
      podman: null, sandboxRequired: false, sandboxReady: false,
    });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("!");
  });

  it("sandbox fatal saat hardening menyala (SPEC-884)", () => {
    const r = doctorReport({
      node: "v20.11.0", git: "git 2.44", tmux: "tmux 3.4", claude: "1.0", codex: null, gh: null,
      dirs: [], web: true, db: "/h/hanoman.db", methods: [],
      podman: null, sandboxRequired: true, sandboxReady: false,
    });
    expect(r.ok).toBe(false);
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL atau LULUS**

Run: `pnpm vitest --run cli/test/doctor.test.ts`
Expected: LULUS — `doctorReport` sudah murni dan sudah berperilaku begini. Test ini mengunci perilaku itu sebagai regresi sebelum pemicunya diganti di Step 3. Kalau merah, perbaiki dulu sebelum lanjut.

- [x] **Step 3: Ganti pemicunya**

Di `cli/src/commands/doctor.ts`, ganti blok probe (baris 120-131) menjadi:

```ts
  const podmanFacts = collectProbeFacts(ctx.env);
  const prereq = prerequisites(ctx.env, podmanFacts);
  // SPEC-884 · ADR-0138 · sandbox hanya prasyarat bagi instance yang MINTA dikeraskan. Menandainya
  // ✗ fatal di laptop membuat `doctor` berkata hanoman tak bisa menjalankan sesi — padahal bisa.
  const sandboxRequired = resolveHardening(ctx.env);
  const sandboxReady = allReady(prereq);
```

Tambahkan ke import `@hanoman/runner` di baris 7:

```ts
import {
  resolveDataDirs, resolveDbUrl, dbFilePath, dbUrlNotice, scanAgentSkills,
  resolveHardening, collectProbeFacts, prerequisites, allReady,
} from "@hanoman/runner";
```

Hapus baris lama yang sudah tak dipakai: `const rootless = …`, `const credentialDir = …`, blok `if (credentialDir) { … }`, `const network = …`, `const networkReady = …`. Ganti pemakaian `podman` di `doctorReport({ … })` menjadi `podman: podmanFacts.podman`.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run cli/test/doctor.test.ts && pnpm --filter ./cli typecheck`
Expected: PASS + typecheck 0

- [x] **Step 5: Commit**

```bash
git add cli/src/commands/doctor.ts cli/test/doctor.test.ts
git commit -m "feat(spec-884): doctor menandai sandbox fatal hanya saat hardening menyala"
```

---

### Task 13: Route setup — status dan apply

**Files:**
- Create: `server/src/services/setup-config.ts`
- Create: `server/src/routes/setup.ts`
- Modify: `server/src/app.ts` (import, `PUBLIC`, register)
- Create: `server/test/setup-route.test.ts`

**Interfaces:**
- Consumes: `readConfigEnv`/`writeConfigEnv` (Task 1), `resolveHardening`/`resolveDeployment` (Task 2), `collectProbeFacts`/`prerequisites`/`allReady` (Task 11), `SetupStatus`/`zSetupApply`/`CONFIG_RESTART_EXIT` (Task 9)
- Produces: `SETUP_ALLOWED_KEYS: readonly string[]`, `hardeningLocked(home: string, env: Env): boolean`, `setupDone(home: string): boolean`, `applySetup(home: string, input: { deployment: "local"|"public"; hardening: boolean }): Record<string,string>`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/setup-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { configEnvPath } from "@hanoman/runner";

const home = () => mkdtempSync(join(tmpdir(), "hanoman-setup-"));
const clean = async () => { await prisma.session.deleteMany(); await prisma.user.deleteMany(); };
beforeEach(clean);
afterEach(clean);

describe("route setup (SPEC-884)", () => {
  it("instalasi polos: perlu setup, lokal, hardening mati, tak terkunci", async () => {
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: home(), HANOMAN_SUPERVISOR: "1" } });
    const r = await app.inject({ method: "GET", url: "/api/setup/status" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      needed: true, deployment: "local", hardening: false,
      hardeningLocked: false, supervised: true, setupTokenRequired: false,
    });
    expect(r.json().prerequisites).toHaveLength(7);
  });

  it("menyimpan pilihan lokal ke config.env dan minta restart sendiri", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir, HANOMAN_SUPERVISOR: "1" } });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "local", hardening: false } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ restart: "self" });
    expect(readFileSync(configEnvPath(dir), "utf8")).toContain("HANOMAN_DEPLOYMENT=local");
  });

  it("menolak hardening saat prasyarat merah, dan tak menulis apa pun", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir, HANOMAN_SUPERVISOR: "1" } });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "public", hardening: true } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("prerequisites-missing");
    expect(r.json().missing.length).toBeGreaterThan(0);
    expect(() => readFileSync(configEnvPath(dir), "utf8")).toThrow();
  });

  it("hardening yang dipasang lewat env tak bisa dimatikan dari dashboard", async () => {
    const dir = home();
    const app = buildApp({ env: {
      NODE_ENV: "production", HANOMAN_HOME: dir, HANOMAN_SUPERVISOR: "1",
      HANOMAN_SESSION_SANDBOX: "podman",
    } });
    expect((await app.inject({ method: "GET", url: "/api/setup/status" })).json())
      .toMatchObject({ hardening: true, hardeningLocked: true, deployment: "public" });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "local", hardening: false } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("hardening-locked");
  });

  // Tanpa penanda durable, wizard MUNCUL LAGI sesudah restart: belum ada user, jadi `needed`
  // masih benar — dan operator terjebak lingkaran wizard → restart → wizard.
  it("sesudah apply, wizard tak diminta lagi walau belum ada user", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir } });
    await app.inject({ method: "POST", url: "/api/setup", payload: { deployment: "local", hardening: false } });
    expect((await app.inject({ method: "GET", url: "/api/setup/status" })).json())
      .toMatchObject({ needed: false });
  });

  it("tanpa supervisor: menyimpan, tapi restart manual", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir } });
    const r = await app.inject({ method: "POST", url: "/api/setup",
      payload: { deployment: "local", hardening: false } });
    expect(r.json()).toMatchObject({ restart: "manual" });
    expect(readFileSync(configEnvPath(dir), "utf8")).toContain("HANOMAN_DEPLOYMENT=local");
  });

  it("sesudah ada user, /api/setup/status tergerbang cookie", async () => {
    const dir = home();
    const app = buildApp({ env: { NODE_ENV: "production", HANOMAN_HOME: dir } });
    await app.inject({ method: "POST", url: "/api/auth/setup",
      payload: { email: "a@b.co", password: "password1" } });
    expect((await app.inject({ method: "GET", url: "/api/setup/status" })).statusCode).toBe(401);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/setup-route.test.ts`
Expected: FAIL — semua 404 (`/api/setup/status` belum ada)

- [x] **Step 3: Implementasi minimal**

Buat `server/src/services/setup-config.ts`:

```ts
// SPEC-884 · ADR-0138 · menulis jawaban wizard ke $HANOMAN_HOME/config.env lewat allowlist.
import { readConfigEnv, resolveHardening, writeConfigEnv } from "@hanoman/runner";

type Env = Record<string, string | undefined>;

/**
 * Berkas ini BUKAN pintu belakang untuk menyuntik env sembarang ke proses sesi: kunci di luar
 * daftar ini ditolak. Setiap penambahan wajib punya alasan di ADR-0138.
 */
export const SETUP_ALLOWED_KEYS = [
  "HANOMAN_DEPLOYMENT", "HANOMAN_HARDENING", "HANOMAN_SETUP_DONE", "HANOMAN_SESSION_SANDBOX",
  "HANOMAN_SESSION_NETWORK", "HANOMAN_EGRESS_PROXY", "HANOMAN_AGENT_CREDENTIAL_DIR",
  "HANOMAN_CONTROL_ORIGINS", "HANOMAN_PUBLIC_ORIGINS", "HANOMAN_SINGLE_ORIGIN",
  "HANOMAN_TRUST_PROXY", "HANOMAN_UPLOAD_SCANNER",
] as const;

/**
 * Penanda DURABLE bahwa wizard sudah dijawab. Tanpa ini wizard muncul lagi setiap restart selama
 * akun pertama belum dibuat — dan operator terjebak lingkaran wizard → restart → wizard, karena
 * `needed` diturunkan dari "belum ada user" yang memang masih benar pada saat itu.
 */
export function setupDone(home: string): boolean {
  return readConfigEnv(home).HANOMAN_SETUP_DONE === "1";
}

/**
 * Hardening yang menyala karena sesuatu DI LUAR berkas (systemd, shell) tak boleh dimatikan dari
 * dashboard. Sesudah CLI menggabungkan berkas ke `process.env`, keduanya tak bisa dibedakan lagi —
 * jadi perbedaannya dihitung dengan membaca berkasnya sendiri.
 */
export function hardeningLocked(home: string, env: Env): boolean {
  return resolveHardening(env) && !resolveHardening(readConfigEnv(home));
}

/** Menimpa berkas dengan jawaban wizard; mengembalikan nilai yang benar-benar ditulis. */
export function applySetup(
  home: string, input: { deployment: "local" | "public"; hardening: boolean },
): Record<string, string> {
  const existing = readConfigEnv(home);
  const next: Record<string, string> = {};
  for (const key of SETUP_ALLOWED_KEYS) if (existing[key]) next[key] = existing[key]!;
  next.HANOMAN_DEPLOYMENT = input.deployment;
  next.HANOMAN_SETUP_DONE = "1";
  if (input.hardening) next.HANOMAN_HARDENING = "1";
  else delete next.HANOMAN_HARDENING;
  writeConfigEnv(home, next);
  return next;
}
```

Buat `server/src/routes/setup.ts`:

```ts
// SPEC-884 · ADR-0138 · wizard setup awal. Permukaan tak ber-auth SELAMA belum ada satu pun user —
// gerbangnya sama persis dengan `needsSetup` di /auth/status. Konsekuensi yang diterima sadar:
// instance yang sudah terjangkau internet sebelum wizard selesai bisa diklaim orang pertama yang
// membukanya. Urutan amannya: selesaikan wizard di localhost, baru sambungkan domain.
import type { FastifyInstance } from "fastify";
import {
  allReady, collectProbeFacts, prerequisites, resolveDeployment, resolveHardening,
} from "@hanoman/runner";
import { CONFIG_RESTART_EXIT, zSetupApply, type SetupStatus } from "@hanoman/shared";
import { prisma } from "../db";
import { BoundedRateLimiter } from "../services/bounded-rate-limit";
import { applySetup, hardeningLocked, setupDone } from "../services/setup-config";

export default async function (
  app: FastifyInstance, opts: { home: string; env: Record<string, string | undefined> },
) {
  // Permukaan tak ber-auth kedua tak boleh lahir tanpa limiter (cermin /auth/setup).
  const attempts = new BoundedRateLimiter({ windowMs: 60_000, limit: 10, maxKeys: 4_096 });
  const env = opts.env;

  const status = async (): Promise<SetupStatus> => ({
    // Dua syarat, bukan satu: belum ada user DAN wizard belum pernah dijawab.
    needed: (await prisma.user.count()) === 0 && !setupDone(opts.home),
    deployment: resolveDeployment(env),
    hardening: resolveHardening(env),
    hardeningLocked: hardeningLocked(opts.home, env),
    supervised: env.HANOMAN_SUPERVISOR === "1",
    setupTokenRequired: resolveHardening(env),
    prerequisites: prerequisites(env, collectProbeFacts(env)),
  });

  app.get("/setup/status", async () => status());

  app.post("/setup", async (req, reply) => {
    if (attempts.hit(req.ip).blocked) return reply.code(429).send({ error: "too many attempts" });
    const p = zSetupApply.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (hardeningLocked(opts.home, env) && !p.data.hardening)
      return reply.code(409).send({ error: "hardening-locked" });
    if (p.data.hardening) {
      // Menulis HANOMAN_HARDENING=1 tanpa prasyarat lengkap melahirkan instance yang MENOLAK BOOT
      // pada restart berikutnya — kegagalan yang spec ini ada untuk mencabut, cuma dipindah tempat.
      const rows = prerequisites(env, collectProbeFacts(env));
      if (!allReady(rows))
        return reply.code(400).send({
          error: "prerequisites-missing",
          missing: rows.filter((r) => !r.ok).map((r) => r.id),
        });
    }
    applySetup(opts.home, { deployment: p.data.deployment, hardening: p.data.hardening });
    attempts.clear(req.ip);
    if (env.HANOMAN_SUPERVISOR !== "1") return { restart: "manual" as const };
    // Keluar SESUDAH response terkirim: keluar lebih dulu membuat wizard melihat koneksi putus,
    // bukan konfirmasi. Yang menghidupkan lagi adalah supervisor `hanoman start` (ADR-0088).
    reply.raw.on("finish", () => setTimeout(() => process.exit(CONFIG_RESTART_EXIT), 50));
    return { restart: "self" as const };
  });
}
```

Di `server/src/app.ts`: tambah import `import setup from "./routes/setup";`, tambahkan `"GET /api/setup/status"` dan `"POST /api/setup"` ke set `PUBLIC` (baris 63-72), dan register tepat di bawah `authRoutes` (baris 191):

```ts
    await api.register(setup, { home: resolveHome(env), env });
```

> **Gerbang "publik hanya selama belum ada user":** set `PUBLIC` melewatkan route ini tanpa syarat, jadi tambahkan pemeriksaan di gate auth `onRequest` (`app.ts`, blok yang menangani `PUBLIC`): untuk kedua path setup, lewatkan **hanya bila** `(await prisma.user.count()) === 0`; selain itu jatuhkan ke jalur cookie biasa. Test terakhir di Step 1 mengunci perilaku ini — kalau ia hijau tanpa perubahan itu, periksa lagi: berarti route-nya terbuka selamanya.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/setup-route.test.ts server/test/auth-routes.test.ts`
Expected: PASS — 6 test setup + auth-routes tetap hijau

- [x] **Step 5: Typecheck**

Run: `pnpm --filter ./server typecheck`
Expected: keluar 0

- [x] **Step 6: Commit**

```bash
git add server/src/routes/setup.ts server/src/services/setup-config.ts server/src/app.ts server/test/setup-route.test.ts
git commit -m "feat(spec-884): route setup — status probe dan apply ke config.env"
```

---

### Task 14: Wizard setup di browser (peruntukan → keamanan)

**Files:**
- Modify: `src/src/api/client.ts` (dua method baru, dekat baris 466)
- Create: `src/src/screens/SetupWizard.tsx`
- Modify: `src/src/App.tsx:717-719,1255-1256`
- Create: `src/test/setup-wizard.test.tsx`

**Interfaces:**
- Consumes: `paths.setupStatus`/`paths.setupApply`, `SetupStatus`, `SetupApplyResult` (Task 9)
- Produces: `api.setupStatus()`, `api.applySetup(b)`, `<SetupWizard status onDone />`

> **Penyimpangan sadar dari spec K5:** spec menyebut wizard **tiga** langkah dengan akun pertama sebagai langkah 3. Plan ini membuatnya **dua** langkah, dan akun pertama tetap di `AuthScreen` yang sudah ada. Alasannya: hanya boleh ada **satu** tempat yang melahirkan akun (`POST /api/auth/setup` dengan aturan token-nya sendiri, Task 6-7); menyalinnya ke dalam wizard berarti dua jalur yang harus dijaga sepakat soal token, limiter, dan 409. Urutan yang dilihat operator tetap persis seperti spec: peruntukan → keamanan → buat akun. Catat penyimpangan ini di ADR-0138.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/setup-wizard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SetupWizard } from "../src/screens/SetupWizard";
import { api } from "../src/api/client";
import type { SetupStatus } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: { applySetup: vi.fn(async () => ({ restart: "self" })) },
  ApiError: class extends Error { status = 0 },
}));

const status = (o: Partial<SetupStatus> = {}): SetupStatus => ({
  needed: true, deployment: "local", hardening: false, hardeningLocked: false,
  supervised: true, setupTokenRequired: false,
  prerequisites: [
    { id: "podman", label: "Podman rootless", ok: false, detail: "podman tak ada" },
    { id: "network", label: "Network", ok: false, detail: null },
    { id: "egress-proxy", label: "Egress proxy", ok: false, detail: null },
    { id: "credential-dir", label: "Dir credential agen", ok: false, detail: null },
    { id: "control-origin", label: "Control origin", ok: false, detail: null },
    { id: "trust-proxy", label: "Trusted proxy", ok: false, detail: null },
    { id: "upload-scanner", label: "Scanner upload", ok: false, detail: null },
  ],
  ...o,
});

const green = (s: SetupStatus): SetupStatus =>
  ({ ...s, prerequisites: s.prerequisites.map((p) => ({ ...p, ok: true })) });

beforeEach(() => vi.clearAllMocks());

describe("SetupWizard (SPEC-884)", () => {
  it("langkah 1 default device pribadi, dan lanjut ke langkah keamanan", () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    expect(screen.getByLabelText("Device saya sendiri")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByLabelText("Aktifkan hardening")).not.toBeChecked();
  });

  it("toggle hardening TERKUNCI selama ada prasyarat merah", () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    const toggle = screen.getByLabelText("Aktifkan hardening");
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/podman tak ada/)).toBeTruthy();
  });

  it("prasyarat hijau → toggle bisa dinyalakan dan tersimpan", async () => {
    render(<SetupWizard status={green(status())} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    const toggle = screen.getByLabelText("Aktifkan hardening");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /Simpan/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith(
      expect.objectContaining({ hardening: true })));
  });

  it("publik + hardening ditolak → wajib mencentang pengakuan", async () => {
    render(<SetupWizard status={status()} onDone={() => {}} />);
    fireEvent.click(screen.getByLabelText("Diakses orang lain"));
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByRole("button", { name: /Simpan/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Saya paham/));
    fireEvent.click(screen.getByRole("button", { name: /Simpan/ }));
    await waitFor(() => expect(api.applySetup).toHaveBeenCalledWith(
      expect.objectContaining({ deployment: "public", hardening: false, acknowledgedUnhardened: true })));
  });

  it("hardening terkunci env: tak ada tombol mematikannya", () => {
    render(<SetupWizard status={{ ...green(status()), hardening: true, hardeningLocked: true }} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
    expect(screen.getByLabelText("Aktifkan hardening")).toBeDisabled();
    expect(screen.getByText(/dipasang lewat env/)).toBeTruthy();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/setup-wizard.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/screens/SetupWizard"`

- [x] **Step 3: Implementasi minimal**

Tambahkan ke `src/src/api/client.ts`, tepat di bawah `authStatus` (baris 466):

```ts
  // SPEC-884 · ADR-0138 · wizard setup awal
  setupStatus: () => j<SetupStatus>(paths.setupStatus),
  applySetup: (b: { deployment: "local" | "public"; hardening: boolean; acknowledgedUnhardened?: boolean }) =>
    j<SetupApplyResult>(paths.setupApply, { method: "POST", ...body(b) }),
```

Tambahkan `SetupStatus, SetupApplyResult` ke import type dari `@hanoman/shared` di berkas itu.

Buat `src/src/screens/SetupWizard.tsx`:

```tsx
/* SetupWizard — SPEC-884 · ADR-0138 · setup awal tiga langkah.
   Langkah 3 (akun pertama) TIDAK di sini: ia tetap AuthScreen, supaya hanya ada satu tempat yang
   membuat akun. Wizard ini berhenti sesudah menyimpan pilihan dan meminta restart. */
import React from "react";
import { Card, Button, Field } from "../ds";
import { Wordmark } from "../ds/marks";
import { api } from "../api/client";
import type { SetupStatus } from "@hanoman/shared";

type Step = "purpose" | "security";

export function SetupWizard({ status, onDone }: { status: SetupStatus; onDone: () => void }) {
  const [step, setStep] = React.useState<Step>("purpose");
  const [deployment, setDeployment] = React.useState<"local" | "public">(status.deployment);
  const [hardening, setHardening] = React.useState(status.hardening);
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const missing = status.prerequisites.filter((p) => !p.ok);
  // Toggle tak boleh dinyalakan selama ada yang merah: menulis HANOMAN_HARDENING=1 tanpa prasyarat
  // lengkap melahirkan instance yang menolak boot pada restart berikutnya.
  const toggleDisabled = status.hardeningLocked || (!hardening && missing.length > 0);
  const needsAck = deployment === "public" && !hardening;
  const canSave = !busy && (!needsAck || ack);

  // Memilih "diakses orang lain" MENYODORKAN hardening — tapi tak memaksanya (keputusan operator).
  function choose(next: "local" | "public") {
    setDeployment(next);
    if (next === "public" && missing.length === 0 && !status.hardeningLocked) setHardening(true);
    if (next === "local" && !status.hardeningLocked) setHardening(false);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr("");
    try {
      await api.applySetup({ deployment, hardening, ...(needsAck ? { acknowledgedUnhardened: true } : {}) });
      onDone();
    } catch { setErr("Gagal menyimpan setup. Coba lagi."); setBusy(false); }
  }

  return (
    <div className="hn-dynamic-viewport" style={{ minHeight: "100dvh", display: "flex", overflowY: "auto",
      background: "var(--bone-100)", boxSizing: "border-box", padding: "max(24px, var(--safe-top)) 16px" }}>
      <div style={{ width: "100%", maxWidth: 460, margin: "auto" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Wordmark /></div>
        {step === "purpose" ? (
          <Card eyebrow="hanoman · setup 1/2" title="Instance ini untuk apa?">
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
              Pilihan ini hanya mengubah default dan peringatan. Ia tak memaksa apa pun.
            </div>
            <Field label="">
              <label style={{ display: "block", marginBottom: 10 }}>
                <input type="radio" name="deployment" aria-label="Device saya sendiri"
                  checked={deployment === "local"} onChange={() => choose("local")} />
                {" "}Device saya sendiri
              </label>
              <label style={{ display: "block" }}>
                <input type="radio" name="deployment" aria-label="Diakses orang lain"
                  checked={deployment === "public"} onChange={() => choose("public")} />
                {" "}Diakses orang lain
              </label>
            </Field>
            <Button onClick={() => setStep("security")} style={{ width: "100%", justifyContent: "center" }}>
              Lanjut
            </Button>
          </Card>
        ) : (
          <Card eyebrow="hanoman · setup 2/2" title="Keamanan">
            <Field label="">
              <label>
                <input type="checkbox" aria-label="Aktifkan hardening" checked={hardening}
                  disabled={toggleDisabled} onChange={(e) => setHardening(e.target.checked)} />
                {" "}Aktifkan hardening
              </label>
            </Field>
            {status.hardeningLocked && (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
                Hardening dipasang lewat env di host ini — dashboard tak bisa mematikannya.
              </div>
            )}
            <ul style={{ fontSize: 12.5, listStyle: "none", padding: 0, margin: "0 0 14px" }}>
              {status.prerequisites.map((p) => (
                <li key={p.id} style={{ color: p.ok ? "var(--text-muted)" : "var(--status-err)", marginBottom: 4 }}>
                  {p.ok ? "✓" : "✗"} {p.label}{p.detail ? ` — ${p.detail}` : ""}
                </li>
              ))}
            </ul>
            {needsAck && (
              <label style={{ display: "block", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
                <input type="checkbox" aria-label="Saya paham risikonya" checked={ack}
                  onChange={(e) => setAck(e.target.checked)} />
                {" "}Saya paham instance ini menjalankan perintah penuh di mesin ini, dan tanpa
                hardening satu-satunya penghalangnya adalah password akun hanoman.
              </label>
            )}
            {err && <div style={{ fontSize: 12.5, color: "var(--status-err)", marginBottom: 12 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={() => setStep("purpose")}>Kembali</Button>
              <Button onClick={save} disabled={!canSave} style={{ flex: 1, justifyContent: "center" }}>
                {busy ? "Menyimpan…" : "Simpan & lanjut"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
```

`Button` (`src/src/ds/components/forms.tsx:29`) memang punya `variant="ghost"` dan `fullWidth` — pakai `fullWidth` alih-alih `style={{ width: "100%" }}` bila lebih rapi.

Di `src/src/App.tsx`, tambahkan state dan gerbang. Setelah baris 719:

```tsx
  // SPEC-884 · ADR-0138 · wizard setup awal berdiri DI DEPAN AuthScreen: pilihannya menentukan
  // apakah akun pertama nanti diminta setup token.
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus | null>(null);
  React.useEffect(() => {
    if (auth?.needsSetup) api.setupStatus().then(setSetupStatus).catch(() => setSetupStatus(null));
  }, [auth?.needsSetup]);
  const [setupDone, setSetupDone] = React.useState(false);
```

Ganti baris 1255-1256:

```tsx
  if (!auth) return <StateBlock kind="loading" title="Memuat hanoman…" />;
  if (auth.needsSetup && setupStatus?.needed && !setupDone)
    return <SetupWizard status={setupStatus} onDone={() => setSetupDone(true)} />;
  if (!auth.user) return <AuthScreen needsSetup={auth.needsSetup} setupTokenRequired={auth.setupTokenRequired ?? false}
    onDone={(u) => setAuth({ needsSetup: false, user: u })} />;
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/setup-wizard.test.tsx src/test/app-flows.test.tsx`
Expected: PASS — kedua berkas. Bila `app-flows` merah karena `api.setupStatus` tak ada di mock parsialnya, tambahkan `setupStatus: vi.fn(async () => ({ needed: false }))` ke mock — jebakan mock parsial yang sama yang sudah dicatat SPEC-739/786 di berkas itu.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SetupWizard.tsx src/src/App.tsx src/src/api/client.ts src/test/setup-wizard.test.tsx
git commit -m "feat(spec-884): wizard setup awal dua langkah di browser"
```

---

### Task 15: Penanda permanen "terbuka tanpa hardening"

**Files:**
- Modify: `src/src/App.tsx` (poll status + render banner)
- Create: `src/test/unhardened-banner.test.tsx`

**Interfaces:**
- Consumes: `api.setupStatus()` (Task 14)
- Produces: elemen ber-`data-testid="unhardened-banner"`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/unhardened-banner.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { UnhardenedBanner } from "../src/screens/SetupWizard";

describe("penanda instance tanpa hardening (SPEC-884)", () => {
  it("muncul saat publik tanpa hardening", async () => {
    render(<UnhardenedBanner status={{ deployment: "public", hardening: false } as never} />);
    expect(screen.getByTestId("unhardened-banner")).toBeTruthy();
    expect(screen.getByText(/tanpa hardening/)).toBeTruthy();
  });

  it("tak muncul di instance lokal", () => {
    render(<UnhardenedBanner status={{ deployment: "local", hardening: false } as never} />);
    expect(screen.queryByTestId("unhardened-banner")).toBeNull();
  });

  it("tak muncul saat hardening menyala", () => {
    render(<UnhardenedBanner status={{ deployment: "public", hardening: true } as never} />);
    expect(screen.queryByTestId("unhardened-banner")).toBeNull();
  });

  it("tak muncul saat status belum diketahui", () => {
    render(<UnhardenedBanner status={null} />);
    expect(screen.queryByTestId("unhardened-banner")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/unhardened-banner.test.tsx`
Expected: FAIL — `UnhardenedBanner` tak diekspor

- [x] **Step 3: Implementasi minimal**

Tambahkan di akhir `src/src/screens/SetupWizard.tsx`:

```tsx
/**
 * SPEC-884 · ADR-0138 · kalau perlindungan sebuah instance publik turun jadi satu password, keadaan
 * itu tidak boleh tak terlihat. Tak bisa ditutup permanen — ia padam saat hardening menyala.
 */
export function UnhardenedBanner({ status }: { status: SetupStatus | null }) {
  if (!status || status.deployment !== "public" || status.hardening) return null;
  return (
    <div data-testid="unhardened-banner" style={{
      background: "var(--status-warn-bg, #fff4e0)", color: "var(--text-strong, #3a2c12)",
      fontSize: 12.5, padding: "6px 14px", borderBottom: "1px solid var(--rule)",
    }}>
      Instance ini terbuka tanpa hardening — sesi agen berjalan langsung di mesin ini.
    </div>
  );
}
```

Di `src/src/App.tsx`, ganti efek pemuat status (Task 14) supaya juga berjalan setelah login, dan render banner-nya di atas shell:

```tsx
  React.useEffect(() => {
    if (auth?.needsSetup || auth?.user) api.setupStatus().then(setSetupStatus).catch(() => setSetupStatus(null));
  }, [auth?.needsSetup, auth?.user?.id]);
```

Render `<UnhardenedBanner status={setupStatus} />` sebagai elemen pertama di dalam pembungkus utama dashboard operator (tepat sebelum `Shell`/`body`), bukan di dalam `ClientPortal`.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/unhardened-banner.test.tsx src/test/app-flows.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SetupWizard.tsx src/src/App.tsx src/test/unhardened-banner.test.tsx
git commit -m "feat(spec-884): penanda permanen instance publik tanpa hardening"
```

---

### Task 16: Kartu "Setup awal" di Settings

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx`
- Create: `src/test/settings-setup-card.test.tsx`

**Interfaces:**
- Consumes: `api.setupStatus()` (Task 14), `SetupWizard` (Task 14)
- Produces: kartu ber-`data-testid="setup-card"`

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/settings-setup-card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn().mockResolvedValue({}),
    getConfig: vi.fn().mockResolvedValue({ sync: { running: false, connected: false }, entries: [] }),
    putConfig: vi.fn(), deleteConfig: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
    setupStatus: vi.fn().mockResolvedValue({
      needed: false, deployment: "local", hardening: false, hardeningLocked: false,
      supervised: true, setupTokenRequired: false, prerequisites: [],
    }),
  },
  ApiError: class extends Error { status = 0 },
}));

beforeEach(() => vi.clearAllMocks());

// Tanda tangan nyata: SettingsScreen({ onToast?, me, onLoggedOut }) — src/src/screens/SettingsScreen.tsx:542
const props = { me: { id: "u1", email: "a@b.c", role: "admin", createdAt: "" } as never, onLoggedOut: () => {} };

describe("kartu Setup awal (SPEC-884)", () => {
  it("menampilkan peruntukan dan status hardening", async () => {
    render(<SettingsScreen {...props} />);
    await waitFor(() => expect(screen.getByTestId("setup-card")).toBeTruthy());
    expect(screen.getByText(/Device saya sendiri/)).toBeTruthy();
    expect(screen.getByText(/Hardening mati/)).toBeTruthy();
  });

  it("tombol membuka ulang wizard", async () => {
    render(<SettingsScreen {...props} />);
    await waitFor(() => expect(screen.getByTestId("setup-card")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Jalankan ulang setup/ }));
    expect(screen.getByLabelText("Device saya sendiri")).toBeTruthy();
  });
});
```

> Kartu ini hidup di sub-tab Settings; `tab` bertahan lewat `usePersistedState` (`SettingsScreen.tsx:547`). Taruh kartunya di sub-tab yang sama dengan kartu config lain, dan bila test tak menemukannya, klik dulu tab itu di test (pola yang sudah dipakai `src/test/config-panel.test.tsx`).

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/settings-setup-card.test.tsx`
Expected: FAIL — `setup-card` tak ditemukan

- [x] **Step 3: Implementasi minimal**

Di `src/src/screens/SettingsScreen.tsx`, tambahkan state + kartu di dekat kartu setting lain:

```tsx
  // SPEC-884 · ADR-0138 · setup awal bisa ditinjau & diubah kapan saja; jalur ini TAK PERNAH
  // menyentuh akun — hanya peruntukan dan hardening.
  const [setup, setSetup] = React.useState<SetupStatus | null>(null);
  const [rerun, setRerun] = React.useState(false);
  React.useEffect(() => { api.setupStatus().then(setSetup).catch(() => setSetup(null)); }, []);
```

```tsx
  {setup && !rerun && (
    <div data-testid="setup-card">
      <Card eyebrow="setup" title="Setup awal">
        <div style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          Peruntukan: {setup.deployment === "local" ? "Device saya sendiri" : "Diakses orang lain"}
          <br />
          {setup.hardening ? "Hardening menyala" : "Hardening mati"}
          {setup.hardeningLocked ? " — dipasang lewat env, tak bisa diubah dari sini" : ""}
        </div>
        <Button onClick={() => setRerun(true)}>Jalankan ulang setup</Button>
      </Card>
    </div>
  )}
  {setup && rerun && (
    <SetupWizard status={setup} onDone={() => { setRerun(false); api.setupStatus().then(setSetup).catch(() => {}); }} />
  )}
```

Impor `SetupWizard` dan tipe `SetupStatus` di berkas itu.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/settings-setup-card.test.tsx src/test/config-panel.test.tsx`
Expected: PASS — kedua berkas

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/settings-setup-card.test.tsx
git commit -m "feat(spec-884): kartu Setup awal di Settings"
```

---

### Task 17: ADR-0138 dan docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0138-hardening-opsional-dan-wizard-setup.md`
- Modify: `internal/docs/README.md` · `internal/docs/operations/deploy-vps.md` · `internal/docs/operations/production.md` · `internal/docs/operations/npm-readme.md` · `internal/docs/product/onboarding.md` · `internal/docs/security/threat-model.md` · `internal/docs/architecture/stack.md` · `internal/docs/architecture/api-contract.md`
- Modify: `docs/superpowers/plans/2026-08-22-spec-883-provisioning-vps-satu-perintah.md`

**Interfaces:**
- Consumes: seluruh task sebelumnya
- Produces: —

- [x] **Step 1: Tulis ADR-0138**

Buat `internal/docs/adr/0138-hardening-opsional-dan-wizard-setup.md`, mengikuti bentuk ADR lain (Status/Tanggal/SPEC/Terkait · Konteks · Keputusan · Alternatif yang ditolak · Konsekuensi · Invariant). Isi yang wajib ada:

- **Terkait:** mengamandemen [0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md) — invariant-nya **tetap utuh, tetapi berlaku saat hardening menyala** — dan [0087](0087-distribusi-npm-global.md): instalasi npm polos wajib bisa boot. Menegaskan ulang pelajaran [0088](0088-tombol-update-npm-supervisor.md) tentang nilai keamanan yang tak boleh lewat config DB.
- **Konteks:** bukti terukur bahwa `npm i -g hanoman && hanoman` menolak boot (dua pesan galat, uid 1000 dan uid 0); env hardening tak pernah lahir dari instalasi npm, hanya dari `EnvironmentFile` systemd; `NODE_ENV` merangkap tiga peran.
- **Keputusan:** `HANOMAN_DEPLOYMENT` + `HANOMAN_HARDENING`; hardening opt-in default mati **termasuk untuk instance publik** (keputusan operator, sadar); kompatibilitas mundur env ADR-0117; `config.env` paling lemah; `CONFIG_RESTART_EXIT = 76`; wizard browser; cookie `Secure` dari skema request dengan `x-forwarded-proto` dibaca langsung.
- **Dua penyimpangan dari spec, keduanya sadar:** (a) resolver dan probe tinggal di `@hanoman/runner`, bukan `server/src/services/`, karena `cli` tak bergantung pada `server` (`cli/package.json:13-21`) dan `doctor` wajib menjawab sama dengan wizard; (b) wizard punya **dua** langkah, bukan tiga — akun pertama tetap di `AuthScreen` supaya hanya ada satu jalur yang melahirkan akun. Urutan yang dilihat operator tak berubah.
- **Penanda `HANOMAN_SETUP_DONE`:** `needed` diturunkan dari dua syarat (belum ada user **dan** wizard belum dijawab). Dengan satu syarat saja, wizard muncul lagi tiap restart selama akun pertama belum dibuat — lingkaran wizard → restart → wizard.
- **Konsekuensi yang diterima sadar:** instance publik tanpa hardening hanya dijaga password; wizard bisa diklaim orang pertama bila instance sudah terjangkau internet sebelum selesai; urutan aman = wizard di localhost dulu.
- **Invariant baru:** (1) `config.env` tak pernah mengalahkan env proses; (2) hardening yang dinyalakan di luar `config.env` tak bisa dimatikan dari dashboard; (3) `hardening=on` tak pernah ditulis saat prasyarat merah; (4) invariant 1–7 ADR-0117 tetap berlaku penuh setiap kali hardening menyala.

- [x] **Step 2: Perbarui docs yang tersentuh**

- `internal/docs/README.md` — tautkan ADR-0138 di daftar ADR.
- `internal/docs/operations/deploy-vps.md` — dua jalur: default longgar (tanpa env apa pun) vs `HANOMAN_HARDENING=1` + prasyarat; sebutkan bahwa env ADR-0117 lama tetap dibaca sebagai hardening menyala.
- `internal/docs/operations/production.md` — `NODE_ENV=production` kini hanya berarti "terpaket".
- `internal/docs/operations/npm-readme.md` — alur baru: `npm i -g hanoman` → `hanoman` → buka browser → wizard → akun pertama tanpa token.
- `internal/docs/product/onboarding.md` — ganti langkah 1 menjadi wizard + akun pertama.
- `internal/docs/security/threat-model.md` — model ancaman instance tanpa hardening + klaimabilitas wizard + urutan aman.
- `internal/docs/architecture/stack.md` — dua nilai profil, `config.env`, presedensi.
- `internal/docs/architecture/api-contract.md` — `GET /api/setup/status`, `POST /api/setup`, kode `400 prerequisites-missing` / `409 hardening-locked` / `429`.

- [x] **Step 3: Sesuaikan plan SPEC-883**

Di `docs/superpowers/plans/2026-08-22-spec-883-provisioning-vps-satu-perintah.md`, perbarui bagian profil:

- profil `lab` → tulis `HANOMAN_DEPLOYMENT=public` tanpa `HANOMAN_HARDENING`; **jangan** mengandalkan `NODE_ENV` (hardcoded `serverEnv()` mengalahkan `EnvironmentFile`, `cli/src/commands/start.ts:177,201`);
- profil `production` → tulis `HANOMAN_HARDENING=1` beserta env ADR-0117 lengkap;
- cabut catatan konsekuensi "cookie lahir tanpa `Secure`" — sudah tak berlaku sejak K7 SPEC-884.

- [x] **Step 4: Verifikasi integritas index docs**

Run: `node cli/dist/cli.js docs index --check` (atau `pnpm --filter ./cli build` dulu bila `dist` belum ada)
Expected: keluar 0, tanpa entri yatim

- [x] **Step 5: Commit**

```bash
git add internal/docs docs/superpowers/plans/2026-08-22-spec-883-provisioning-vps-satu-perintah.md
git commit -m "docs(spec-884): ADR-0138 hardening opsional + wizard setup awal"
```

---

## Verifikasi akhir (sekali, setelah semua task)

- [x] **Test yang tersentuh, serial, DB terisolasi**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  runner/test/config-env.test.ts runner/test/runtime-profile.test.ts runner/test/sandbox-probe.test.ts \
  shared/test/setup-dto.test.ts \
  server/test/session-sandbox.test.ts server/test/portal-chat-argv.test.ts server/test/lead-brain.test.ts \
  server/test/upload-scanner-gate.test.ts server/test/bootstrap.test.ts server/test/auth-routes.test.ts \
  server/test/auth-cookie-secure.test.ts server/test/setup-route.test.ts \
  cli/test/start-supervisor.test.ts cli/test/start-args.test.ts cli/test/doctor.test.ts \
  src/test/auth-screen-token.test.tsx src/test/setup-wizard.test.tsx \
  src/test/unhardened-banner.test.tsx src/test/settings-setup-card.test.tsx src/test/app-flows.test.tsx
```

- [x] **Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck \
  && pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck
```

- [x] **Uji endpoint nyata di local** (task ini menyentuh endpoint — wajib, sekali di akhir)

```bash
# Home terpisah supaya tak menyentuh ~/.hanoman yang dipakai instance nyata.
export SMOKE_HOME="$(mktemp -d)"
pnpm build
HANOMAN_HOME="$SMOKE_HOME" DATABASE_URL="file:$SMOKE_HOME/hanoman.db" NODE_ENV=production \
  HANOMAN_SUPERVISOR=1 PORT=8899 node server/dist/server.js &
sleep 2
curl -s localhost:8899/api/setup/status | head -c 400; echo
curl -s -X POST localhost:8899/api/setup -H 'content-type: application/json' \
  -d '{"deployment":"local","hardening":false}'; echo
curl -s -X POST localhost:8899/api/setup -H 'content-type: application/json' \
  -d '{"deployment":"public","hardening":true}'; echo   # harus 400 prerequisites-missing
curl -s -X POST localhost:8899/api/auth/setup -H 'content-type: application/json' \
  -d '{"email":"a@b.co","password":"password1"}' -D- | grep -i set-cookie   # tanpa Secure di http
```

Yang harus terlihat: `needed: true`, `deployment: "local"`, `hardening: false`, tujuh baris prasyarat; apply lokal `{"restart":"self"}` (server keluar 76 — normal, ia memang minta dijalankan ulang); apply hardening `400 prerequisites-missing`; cookie `hn_session` **tanpa** `Secure`.

> **Jangan jalankan smoke tanpa `HANOMAN_HOME`** — `ensureSetupToken` dan `writeConfigEnv` akan menulis ke `~/.hanoman` yang nyata (pelajaran SPEC-880). Bersihkan sesudahnya: `rm -rf "$SMOKE_HOME"`.

- [x] **Centang checklist plan ini** (`- [ ]` → `- [x]`) untuk task yang selesai, dalam commit yang sama dengan task itu.
