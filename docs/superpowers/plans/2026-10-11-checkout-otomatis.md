# Checkout Otomatis & Kredensial Git Lintas Device Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meluncurkan sesi untuk project yang belum punya checkout di device/VPS ini otomatis meng-clone repo-nya (memakai token GitHub yang dibawa dari hub), memasang binding, lalu lanjut membuat worktree.

**Architecture:** Tiga unit baru di `server/src/services/` — `git-auth.ts` (askpass + normalisasi remote), `git-token.ts` (resolusi token: `GITHUB_TOKEN` lokal → hub via device token), `project-checkout.ts` (clone asinkron ber-kunci per project + fetch ref yang hilang). `session-launch.ts` memanggil clone saat binding kosong; `POST /projects/:id/clone` didelegasikan ke unit yang sama. Hub mendapat satu endpoint mesin-ke-mesin `GET /api/sync/git-credential`.

**Tech Stack:** Node + TypeScript strict, Fastify, Prisma 6/SQLite, vitest, git CLI.

## Global Constraints

- TypeScript strict; tanpa `any` baru kecuali mengikuti pola file yang disentuh.
- Tanpa perubahan skema Prisma dan tanpa migration: token memakai `GITHUB_TOKEN` yang sudah ada di `RuntimeConfig` (kind `secret`, terenkripsi `secret.key` lokal). Tidak ada model baru.
- Token tidak boleh muncul di URL remote, `.git/config`, argv proses git, log, atau body balasan API selain `GET /sync/git-credential`.
- Token hanya dikirim ke git untuk remote `https://github.com/…` (askpass tidak boleh membocorkannya ke host lain).
- Agen sesi tidak menerima token; hanya proses git yang dijalankan hanoman.
- Endpoint `GET /api/sync/git-credential` hanya terbuka untuk Bearer device token; agent token → 401 (ADR-0199 butir 4). Dicatat di `UNWRAPPED` `server/test/mcp-coverage.test.ts`.
- Test server dijalankan `--no-file-parallelism` dengan `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (CLAUDE.md, SPEC-479).
- Setelah tiap task: centang checklist task di file plan ini, jalankan test yang tersentuh, commit.
- Dokumen yang tersentuh diperbarui dalam commit yang sama; tautkan di `internal/docs/README.md`.
- Commit message diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Tanggung jawab |
|---|---|
| Create `server/src/services/git-auth.ts` | `httpsRemote`, `isGithubHttps`, `gitAuthEnv` (skrip askpass token) |
| Create `server/src/services/git-token.ts` | `localGitToken`, `hubGitToken`, `resolveGitToken` |
| Create `server/src/services/project-checkout.ts` | `cloneProjectCheckout`, `CheckoutError`, `fetchRefIfMissing`, `checkoutRoot` |
| Modify `server/src/routes/sync.ts` | `GET /sync/git-credential` |
| Modify `server/src/services/session-launch.ts` | auto-clone saat binding kosong, kind `checkout`, fetch ref |
| Modify `server/src/routes/bindings.ts` | `POST /projects/:id/clone` memakai service |
| Modify `server/test/mcp-coverage.test.ts`, `server/test/instance-sync-gate.test.ts` | catatan UNWRAPPED + gate agent token |
| Create `server/test/git-auth.test.ts`, `git-token.test.ts`, `project-checkout.test.ts` | test unit |
| Modify `server/test/session-launch.test.ts`, `bindings.route.test.ts` | test integrasi |
| Create `internal/docs/adr/0203-checkout-otomatis-token-git-dari-hub.md` | keputusan |
| Modify `internal/docs/architecture/api-contract.md`, `internal/docs/README.md` | kontrak + indeks |

Frontend tidak berubah: tombol "Jalankan git clone" sudah ada di `src/src/screens/MissingRepoCard.tsx` dan memanggil `POST /projects/:id/clone`.

---

### Task 1: Helper autentikasi git

**Files:**
- Create: `server/src/services/git-auth.ts`
- Test: `server/test/git-auth.test.ts`

**Interfaces:**
- Produces:
  - `gitAskpassPath(): string`
  - `httpsRemote(remote: string): string`
  - `isGithubHttps(remote: string): boolean`
  - `gitAuthEnv(token: string): Record<string, string>` — berisi `GIT_ASKPASS`, `GIT_TERMINAL_PROMPT`, `HANOMAN_GIT_TOKEN`

- [x] **Step 1: Write the failing test**

```ts
// server/test/git-auth.test.ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { gitAuthEnv, httpsRemote, isGithubHttps } from "../src/services/git-auth";

describe("httpsRemote", () => {
  it("mengubah remote SSH GitHub ke HTTPS", () => {
    expect(httpsRemote("git@github.com:acme/app.git")).toBe("https://github.com/acme/app.git");
    expect(httpsRemote("ssh://git@github.com/acme/app.git")).toBe("https://github.com/acme/app.git");
  });
  it("membiarkan remote lain apa adanya", () => {
    expect(httpsRemote("https://github.com/acme/app.git")).toBe("https://github.com/acme/app.git");
    expect(httpsRemote("git@gitlab.com:acme/app.git")).toBe("git@gitlab.com:acme/app.git");
    expect(httpsRemote("/tmp/lokal/repo")).toBe("/tmp/lokal/repo");
  });
});

describe("isGithubHttps", () => {
  it("hanya true untuk https://github.com/", () => {
    expect(isGithubHttps("https://github.com/acme/app.git")).toBe(true);
    expect(isGithubHttps("https://evil.example/github.com/x.git")).toBe(false);
    expect(isGithubHttps("git@github.com:acme/app.git")).toBe(false);
  });
});

describe("gitAuthEnv", () => {
  it("askpass menjawab username dan token, tanpa menulis token ke disk", () => {
    const env = gitAuthEnv("tok_123");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    const run = (prompt: string) =>
      spawnSync(env.GIT_ASKPASS!, [prompt], { env: { HANOMAN_GIT_TOKEN: "tok_123" }, encoding: "utf8" }).stdout;
    expect(run("Username for 'https://github.com': ")).toBe("x-access-token\n");
    expect(run("Password for 'https://x-access-token@github.com': ")).toBe("tok_123\n");
    const script = spawnSync("cat", [env.GIT_ASKPASS!], { encoding: "utf8" }).stdout;
    expect(script).not.toContain("tok_123");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest --run test/git-auth.test.ts --no-file-parallelism`
Expected: FAIL — `Failed to resolve import "../src/services/git-auth"`.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/git-auth.ts
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

// ADR-0203 · skrip askpass token. Sekamar dengan askpass-deny sesi (pty.ts) dan, seperti itu, TAK
// memuat rahasia: token datang dari env proses git anak (`HANOMAN_GIT_TOKEN`), jadi tak pernah
// menyentuh disk, argv, URL remote, maupun `.git/config`.
export const gitAskpassPath = (): string => `${tmpdir()}/hanoman-askpass/token.sh`;

const ASKPASS_TOKEN = `#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' "x-access-token" ;;
  *) printf '%s\\n' "$HANOMAN_GIT_TOKEN" ;;
esac
`;

/** Remote SSH GitHub → HTTPS (hanya untuk operasi git hanoman); remote lain apa adanya. */
export function httpsRemote(remote: string): string {
  const scp = /^[\w.-]+@github\.com:(.+)$/.exec(remote);
  if (scp) return `https://github.com/${scp[1]}`;
  const ssh = /^ssh:\/\/(?:[\w.-]+@)?github\.com(?::\d+)?\/(.+)$/.exec(remote);
  if (ssh) return `https://github.com/${ssh[1]}`;
  return remote;
}

/** Token hanya boleh dipakai untuk GitHub lewat HTTPS — askpass menjawab host MANA PUN yang bertanya. */
export const isGithubHttps = (remote: string): boolean => /^https:\/\/github\.com\//.test(remote);

export function gitAuthEnv(token: string): Record<string, string> {
  const path = gitAskpassPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, ASKPASS_TOKEN, { mode: 0o700 });
  chmodSync(path, 0o700);
  return { GIT_ASKPASS: path, GIT_TERMINAL_PROMPT: "0", HANOMAN_GIT_TOKEN: token };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm vitest --run test/git-auth.test.ts --no-file-parallelism`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add server/src/services/git-auth.ts server/test/git-auth.test.ts docs/superpowers/plans/2026-10-11-checkout-otomatis.md
git commit -m "feat(git): helper askpass token + normalisasi remote GitHub

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Resolusi token + endpoint hub `GET /sync/git-credential`

**Files:**
- Create: `server/src/services/git-token.ts`
- Modify: `server/src/routes/sync.ts` (tambah route setelah `/sync/bootstrap`, ±baris 90)
- Modify: `server/test/mcp-coverage.test.ts` (daftar `UNWRAPPED`, ±baris 62)
- Modify: `server/test/instance-sync-gate.test.ts` (daftar URL ±baris 175)
- Test: `server/test/git-token.test.ts`

**Interfaces:**
- Consumes: `effectiveStr` dari `server/src/config.ts`; `Transport`, `fetchTransport` dari `server/src/services/sync-client.ts`; `requireDeviceToken` dari `server/src/services/device-auth.ts`.
- Produces:
  - `localGitToken(): string | null`
  - `hubGitToken(transport?: Transport): Promise<string | null>`
  - `resolveGitToken(deps?: { hub?: () => Promise<string | null> }): Promise<string | null>`
  - Route `GET /api/sync/git-credential` → `200 { token: string | null }`, header `cache-control: no-store`; 401 tanpa device token.

- [x] **Step 1: Write the failing test**

```ts
// server/test/git-token.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { clearConfig, setConfig } from "../src/config";
import { issueDeviceToken } from "../src/services/device-token";
import { hubGitToken, localGitToken, resolveGitToken } from "../src/services/git-token";
import type { Transport } from "../src/services/sync-client";

const app = buildApp();
const clean = async () => {
  await clearConfig("GITHUB_TOKEN");
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("GET /api/sync/git-credential", () => {
  it("401 tanpa device token", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sync/git-credential" });
    expect(r.statusCode).toBe(401);
  });

  it("200 dengan token hub, no-store", async () => {
    await setConfig("GITHUB_TOKEN", "ghp_hub");
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "vps");
    const r = await app.inject({ method: "GET", url: "/api/sync/git-credential", headers: { authorization: `Bearer ${t.token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ token: "ghp_hub" });
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("token: null bila hub tak punya GITHUB_TOKEN", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "vps");
    const r = await app.inject({ method: "GET", url: "/api/sync/git-credential", headers: { authorization: `Bearer ${t.token}` } });
    expect(r.json()).toEqual({ token: null });
  });
});

describe("resolveGitToken", () => {
  it("memakai GITHUB_TOKEN lokal lebih dulu tanpa menyentuh hub", async () => {
    await setConfig("GITHUB_TOKEN", "ghp_lokal");
    expect(localGitToken()).toBe("ghp_lokal");
    let called = false;
    const t = await resolveGitToken({ hub: async () => { called = true; return "ghp_hub"; } });
    expect(t).toBe("ghp_lokal");
    expect(called).toBe(false);
  });

  it("jatuh ke hub bila lokal kosong", async () => {
    expect(await resolveGitToken({ hub: async () => "ghp_hub" })).toBe("ghp_hub");
  });

  it("null bila keduanya kosong", async () => {
    expect(await resolveGitToken({ hub: async () => null })).toBeNull();
  });
});

describe("hubGitToken", () => {
  const ok = (body: unknown, status = 200): Transport => async () => ({ status, body });
  it("mengembalikan token dari balasan 200", async () => {
    expect(await hubGitToken(ok({ token: "ghp_x" }))).toBe("ghp_x");
  });
  it("null untuk status non-200, token kosong, atau transport yang melempar", async () => {
    expect(await hubGitToken(ok({ token: "ghp_x" }, 401))).toBeNull();
    expect(await hubGitToken(ok({ token: null }))).toBeNull();
    expect(await hubGitToken(async () => { throw new Error("hub offline"); })).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/git-token.test.ts --no-file-parallelism`
Expected: FAIL — import `../src/services/git-token` tidak ditemukan.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/git-token.ts
import { effectiveStr } from "../config";
import { fetchTransport, type Transport } from "./sync-client";

// ADR-0203 · token GitHub untuk operasi git hanoman. Sumber: `GITHUB_TOKEN` instance ini
// (RuntimeConfig, terenkripsi), lalu — di client — hub lewat device token yang SUDAH dipakai sync.
// Tidak disimpan ulang di client: dicabutnya token di hub langsung berlaku di sana.
export const localGitToken = (): string | null => effectiveStr("GITHUB_TOKEN")?.trim() || null;

function clientTransport(): Transport | null {
  const base = effectiveStr("SYNC_SERVER_URL");
  const device = effectiveStr("SYNC_DEVICE_TOKEN");
  return base && device ? fetchTransport(base, device) : null;
}

/** Gagal apa pun (hub offline, 401, bentuk tak dikenal) = `null`; pemanggil yang memilih galatnya. */
export async function hubGitToken(transport?: Transport): Promise<string | null> {
  const t = transport ?? clientTransport();
  if (!t) return null;
  try {
    const res = await t("GET", "/api/sync/git-credential");
    const token = (res.body as { token?: unknown } | null)?.token;
    return res.status === 200 && typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

export async function resolveGitToken(
  deps: { hub?: () => Promise<string | null> } = {},
): Promise<string | null> {
  return localGitToken() ?? (await (deps.hub ?? hubGitToken)());
}
```

Tambahkan route di `server/src/routes/sync.ts`, tepat setelah blok `app.get("/sync/bootstrap", …)`:

```ts
  // ADR-0203 · token GitHub hub untuk client yang menjalankan clone/fetch. Bearer device-token
  // (bukan cookie, bukan agent token — lihat UNWRAPPED di mcp-coverage). `no-store`: rahasia tak
  // boleh tertinggal di cache perantara.
  app.get("/sync/git-credential", { preHandler: requireDeviceToken }, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return { token: localGitToken() };
  });
```

dan impor di bagian atas file yang sama:

```ts
import { localGitToken } from "../services/git-token";
```

Tambahkan di `server/test/mcp-coverage.test.ts` pada daftar `UNWRAPPED`, setelah baris `GET /sync/bootstrap`:

```ts
  ["GET /sync/git-credential", "mesin-ke-mesin: Bearer device-token; membawa rahasia (ADR-0203)"],
```

Tambahkan di `server/test/instance-sync-gate.test.ts` pada array URL tes "kanal mesin-ke-mesin TIDAK terbuka untuk agent token":

```ts
      ["GET", "/api/sync/git-credential"],
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/git-token.test.ts test/instance-sync-gate.test.ts test/mcp-coverage.test.ts --no-file-parallelism`
Expected: PASS. Bila `mcp-coverage` gagal karena route tak terdaftar di inventaris, periksa regex `routeInventory()` dan pastikan entri `UNWRAPPED` persis `"GET /sync/git-credential"`.

- [x] **Step 5: Commit**

```bash
git add server/src/services/git-token.ts server/src/routes/sync.ts server/test/git-token.test.ts server/test/mcp-coverage.test.ts server/test/instance-sync-gate.test.ts docs/superpowers/plans/2026-10-11-checkout-otomatis.md
git commit -m "feat(sync): endpoint token git hub untuk client (device token)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Service clone ber-kunci per project

**Files:**
- Create: `server/src/services/project-checkout.ts`
- Test: `server/test/project-checkout.test.ts`

**Interfaces:**
- Consumes: `resolveGitToken` (Task 2); `gitAuthEnv`, `httpsRemote`, `isGithubHttps` (Task 1); `setBinding` dari `./local-binding`; `resolveHome` dari `@hanoman/runner`; `realGit.revParse` dari `@hanoman/runner`.
- Produces:
  - `type CheckoutErrorKind = "not-found" | "no-remote" | "auth" | "clone" | "occupied"`
  - `class CheckoutError extends Error { kind: CheckoutErrorKind; detail?: string }`
  - `checkoutRoot(): string` → `<HANOMAN_HOME>/projects`
  - `cloneProjectCheckout(projectId: string, opts?: { dir?: string; token?: string | null }): Promise<string>` — mengembalikan dir, binding terpasang
  - `fetchRefIfMissing(repoDir: string, rev: string | null | undefined, token?: string | null): Promise<void>`

- [x] **Step 1: Write the failing test**

```ts
// server/test/project-checkout.test.ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prisma } from "../src/db";
import { makeRepoWithBranches } from "./factory";
import { resolveRepoDir } from "../src/services/local-binding";
import {
  CheckoutError, checkoutRoot, cloneProjectCheckout, fetchRefIfMissing,
} from "../src/services/project-checkout";

const clean = async () => { await prisma.localBinding.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
let home: string;
const oldHome = process.env.HANOMAN_HOME;
beforeEach(async () => { await clean(); home = mkdtempSync(join(tmpdir(), "hn-home-")); process.env.HANOMAN_HOME = home; });
afterEach(() => { if (oldHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = oldHome; });
afterAll(clean);

const project = (gitRemote: string | null, id = "p1") =>
  prisma.project.create({ data: { id, name: id, desc: "d", kind: "existing", repoDir: null, gitRemote } });
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

describe("cloneProjectCheckout", () => {
  it("clone ke <HANOMAN_HOME>/projects/<id> dan memasang binding", async () => {
    await project(makeRepoWithBranches("main"));
    const dir = await cloneProjectCheckout("p1");
    expect(dir).toBe(join(checkoutRoot(), "p1"));
    expect(checkoutRoot()).toBe(join(home, "projects"));
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(await resolveRepoDir("p1")).toBe(dir);
  });

  it("memakai dir eksplisit", async () => {
    await project(makeRepoWithBranches("main"));
    const dest = join(mkdtempSync(join(tmpdir(), "hn-dest-")), "repo");
    expect(await cloneProjectCheckout("p1", { dir: dest })).toBe(dest);
    expect(await resolveRepoDir("p1")).toBe(dest);
  });

  it("project tak ada → not-found; tanpa gitRemote → no-remote", async () => {
    await expect(cloneProjectCheckout("nope")).rejects.toMatchObject({ kind: "not-found" });
    await project(null);
    await expect(cloneProjectCheckout("p1")).rejects.toMatchObject({ kind: "no-remote" });
  });

  it("folder tujuan berisi repo dengan remote yang sama dipakai ulang tanpa clone", async () => {
    const remote = makeRepoWithBranches("main");
    await project(remote);
    const first = await cloneProjectCheckout("p1");
    writeFileSync(join(first, "lokal.txt"), "jangan hilang");
    await prisma.localBinding.deleteMany();
    expect(await cloneProjectCheckout("p1")).toBe(first);
    expect(readFileSync(join(first, "lokal.txt"), "utf8")).toBe("jangan hilang");
    expect(await resolveRepoDir("p1")).toBe(first);
  });

  it("folder tujuan terisi hal lain → occupied, isi tidak ditimpa", async () => {
    await project(makeRepoWithBranches("main"));
    const dest = join(home, "projects", "p1");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "milik-orang.txt"), "x");
    await expect(cloneProjectCheckout("p1")).rejects.toMatchObject({ kind: "occupied" });
    expect(existsSync(join(dest, "milik-orang.txt"))).toBe(true);
    expect(await resolveRepoDir("p1")).toBeNull();
  });

  it("clone gagal → kind clone, folder sisa dihapus, tanpa binding", async () => {
    await project(join(tmpdir(), "tidak-ada-repo-ini"));
    const err = await cloneProjectCheckout("p1").catch((e) => e);
    expect(err).toBeInstanceOf(CheckoutError);
    expect(["clone", "auth"]).toContain(err.kind);
    expect(existsSync(join(home, "projects", "p1"))).toBe(false);
    expect(await resolveRepoDir("p1")).toBeNull();
  });

  it("dua panggilan bersamaan untuk project yang sama menghasilkan satu clone", async () => {
    await project(makeRepoWithBranches("main"));
    const [a, b] = await Promise.all([cloneProjectCheckout("p1"), cloneProjectCheckout("p1")]);
    expect(a).toBe(b);
  });

  it("pesan galat tidak memuat token", async () => {
    await project("https://github.com/tidak-ada-org-ini-xyz/tidak-ada-repo.git");
    const err = await cloneProjectCheckout("p1", { token: "ghp_RAHASIA123" }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckoutError);
    expect(`${err.message} ${err.detail ?? ""}`).not.toContain("ghp_RAHASIA123");
  }, 30_000);
});

describe("fetchRefIfMissing", () => {
  it("mengambil branch yang baru ada di remote", async () => {
    const remote = makeRepoWithBranches("main");
    await project(remote);
    const dir = await cloneProjectCheckout("p1");
    git(remote, "branch", "fitur-baru");
    expect(git(dir, "rev-parse", "--verify", "origin/fitur-baru").status).not.toBe(0);
    await fetchRefIfMissing(dir, "fitur-baru");
    expect(git(dir, "rev-parse", "--verify", "origin/fitur-baru").status).toBe(0);
  });

  it("tidak melakukan apa pun untuk rev kosong, dan tidak melempar bila fetch gagal", async () => {
    const dir = makeRepoWithBranches("main"); // tanpa remote origin
    await expect(fetchRefIfMissing(dir, null)).resolves.toBeUndefined();
    await expect(fetchRefIfMissing(dir, "tidak-ada")).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/project-checkout.test.ts --no-file-parallelism`
Expected: FAIL — import `../src/services/project-checkout` tidak ditemukan.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/project-checkout.ts
import { execFile, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { realGit, resolveHome } from "@hanoman/runner";
import { prisma } from "../db";
import { gitAuthEnv, httpsRemote, isGithubHttps } from "./git-auth";
import { resolveGitToken } from "./git-token";
import { setBinding } from "./local-binding";

const execFileAsync = promisify(execFile);

// ADR-0203 · checkout otomatis. Clone ASINKRON (execFile, bukan spawnSync): clone repo besar bisa
// berjalan menit, dan spawnSync akan membekukan event loop server — kelas bug yang sama dengan
// SPEC-742 (ADR-0116) pada penghapusan worktree.
export type CheckoutErrorKind = "not-found" | "no-remote" | "auth" | "clone" | "occupied";
export class CheckoutError extends Error {
  constructor(message: string, readonly kind: CheckoutErrorKind, readonly detail?: string) { super(message); }
}

const CLONE_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 2 * 60_000;
const AUTH_RE = /Authentication failed|could not read (Username|Password)|Invalid username or password|HTTP 40[13]|returned error: 40[13]|Repository not found|Permission denied \(publickey\)/i;

export const checkoutRoot = (): string => join(resolveHome(), "projects");
const slug = (id: string): string => id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
const sameRemote = (a: string, b: string): boolean => {
  const norm = (u: string) => httpsRemote(u).replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
};
const redact = (text: string, token: string | null): string => (token ? text.split(token).join("***") : text);

type RunResult = { ok: true } | { ok: false; stderr: string };
async function runGit(args: string[], o: { cwd?: string; token: string | null; timeout: number }): Promise<RunResult> {
  // `credential.helper=` (kosong) mereset daftar helper: keychain mesin tak boleh menjawab lebih dulu
  // dan membuat token hanoman diam-diam tidak terpakai.
  const full = o.token ? ["-c", "credential.helper=", ...args] : args;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(o.token ? gitAuthEnv(o.token) : {}) };
  try {
    await execFileAsync("git", full, { cwd: o.cwd, env, timeout: o.timeout, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, stderr: redact(String(err.stderr || err.message || "git gagal"), o.token) };
  }
}

const isEmptyDir = (dir: string): boolean => { try { return readdirSync(dir).length === 0; } catch { return false; } };
function originOf(dir: string): string | null {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function doClone(projectId: string, opts: { dir?: string; token?: string | null }): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new CheckoutError(`project "${projectId}" tidak ada`, "not-found");
  if (!project.gitRemote) throw new CheckoutError(`project "${projectId}" tidak punya gitRemote untuk di-clone`, "no-remote");
  const remote = project.gitRemote;
  const dest = opts.dir ?? join(checkoutRoot(), slug(project.id));

  if (existsSync(dest) && !isEmptyDir(dest)) {
    const origin = originOf(dest);
    if (origin && sameRemote(origin, remote)) { await setBinding(projectId, dest); return dest; }
    throw new CheckoutError(`folder ${dest} sudah berisi hal lain, tidak ditimpa`, "occupied");
  }

  const url = httpsRemote(remote);
  const token = opts.token !== undefined ? opts.token : await resolveGitToken();
  const useAuth = !!token && isGithubHttps(url);
  const res = await runGit(["clone", "--", useAuth ? url : remote, dest], {
    token: useAuth ? token : null, timeout: CLONE_TIMEOUT_MS,
  });
  if (!res.ok) {
    rmSync(dest, { recursive: true, force: true }); // hanya mungkin absen/kosong di titik ini
    const auth = AUTH_RE.test(res.stderr);
    throw new CheckoutError(
      auth
        ? (useAuth
          ? `token GitHub ditolak atau tanpa akses ke ${remote}`
          : `akses ke ${remote} ditolak: isi GITHUB_TOKEN di Settings atau hubungkan instance ini ke hub`)
        : `git clone ${remote} gagal`,
      auth ? "auth" : "clone", res.stderr.trim().slice(0, 2000),
    );
  }
  await setBinding(projectId, dest);
  return dest;
}

const inflight = new Map<string, Promise<string>>();
/** Clone (atau pakai ulang) checkout project di mesin ini lalu pasang binding. Satu clone per project. */
export function cloneProjectCheckout(projectId: string, opts: { dir?: string; token?: string | null } = {}): Promise<string> {
  const running = inflight.get(projectId);
  if (running) return running;
  const p = doClone(projectId, opts).finally(() => inflight.delete(projectId));
  inflight.set(projectId, p);
  return p;
}

/**
 * Branch dasar sebuah spec bisa hanya ada di device lain. Bila ref tak ada lokal maupun di
 * `origin/*`, ambil dari origin. Best-effort: gagal tidak melempar — `addWorktree` yang
 * menyebut revisi mana yang tak resolve (ADR-0009), dan tak ada fallback diam-diam ke HEAD.
 */
export async function fetchRefIfMissing(repoDir: string, rev: string | null | undefined, token?: string | null): Promise<void> {
  if (!rev) return;
  if (realGit.revParse(repoDir, rev) || realGit.revParse(repoDir, `origin/${rev}`)) return;
  const origin = originOf(repoDir);
  if (!origin) return;
  const t = token !== undefined ? token : await resolveGitToken();
  const useAuth = !!t && isGithubHttps(httpsRemote(origin));
  await runGit(["fetch", "origin"], { cwd: repoDir, token: useAuth ? t : null, timeout: FETCH_TIMEOUT_MS });
}
```

Catatan untuk implementer: `fetch origin` pada remote ber-URL SSH tidak memakai token (askpass tidak dipakai SSH), sehingga perilaku mesin yang sudah punya ssh key tak berubah.

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/project-checkout.test.ts --no-file-parallelism`
Expected: PASS (10 tests). Test "pesan galat tidak memuat token" butuh jaringan atau gagal cepat di DNS; keduanya menghasilkan `CheckoutError` tanpa token, jadi aman offline.

- [x] **Step 5: Commit**

```bash
git add server/src/services/project-checkout.ts server/test/project-checkout.test.ts docs/superpowers/plans/2026-10-11-checkout-otomatis.md
git commit -m "feat(checkout): service clone asinkron ber-kunci + fetch ref hilang

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Auto-clone di `startSpecSession`

**Files:**
- Modify: `server/src/services/session-launch.ts` (impor ±baris 5; `LaunchError` ±baris 30; resolusi repoDir ±baris 127-128; sebelum `addWorktree` ±baris 204)
- Test: `server/test/session-launch.test.ts` (tambah di akhir `describe("session-launch")`)

**Interfaces:**
- Consumes: `cloneProjectCheckout`, `CheckoutError`, `fetchRefIfMissing` (Task 3).
- Produces: `LaunchError.kind` bertambah `"checkout"` (route `POST /terminal/sessions` memetakannya ke 422 lewat cabang default yang sudah ada — tidak perlu mengubah `terminal.ts`).

- [x] **Step 1: Write the failing test**

Tambahkan di `server/test/session-launch.test.ts` (impor `mkdtempSync`, `tmpdir`, `join`, `existsSync` sudah ada; tambahkan `makeRepoWithBranches` dari `./factory` dan `resolveRepoDir` dari `../src/services/local-binding`):

```ts
  it("meng-clone otomatis saat binding kosong dan project punya gitRemote", async () => {
    const remote = makeRepoWithBranches("main");
    const home = mkdtempSync(join(tmpdir(), "hn-home-"));
    const oldHome = process.env.HANOMAN_HOME; process.env.HANOMAN_HOME = home;
    try {
      await prisma.project.create({ data: { id: "pc", name: "PC", desc: "", kind: "existing", gitRemote: remote } });
      const spec = await prisma.spec.create({ data: { id: "SPEC-CL", projectId: "pc", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "o", launchApprovedAt: new Date(), launchApprovedBy: "test" } });
      const r = await startSpecSession(spec, { flow: "feature" });
      const dir = await resolveRepoDir("pc");
      expect(dir).toBe(join(home, "projects", "pc"));
      expect(existsSync(join(dir!, ".git"))).toBe(true);
      expect(existsSync(join(dir!, ".worktrees", r.id))).toBe(true);
      expect((await prisma.spec.findUnique({ where: { id: "SPEC-CL" } }))!.baseSha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      if (oldHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = oldHome;
    }
  }, 30_000);

  it("clone gagal → LaunchError kind checkout dan baseSha tidak tersentuh", async () => {
    const home = mkdtempSync(join(tmpdir(), "hn-home-"));
    const oldHome = process.env.HANOMAN_HOME; process.env.HANOMAN_HOME = home;
    try {
      await prisma.project.create({ data: { id: "pf", name: "PF", desc: "", kind: "existing", gitRemote: join(tmpdir(), "tidak-ada-repo-ini") } });
      const spec = await prisma.spec.create({ data: { id: "SPEC-CF", projectId: "pf", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "o", launchApprovedAt: new Date(), launchApprovedBy: "test" } });
      await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "checkout" });
      expect((await prisma.spec.findUnique({ where: { id: "SPEC-CF" } }))!.baseSha).toBeNull();
    } finally {
      if (oldHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = oldHome;
    }
  });
```

Test lama "throws LaunchError needs-bind when the project has no local checkout" (project tanpa `gitRemote`) harus tetap lulus tanpa diubah.

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/session-launch.test.ts --no-file-parallelism -t "meng-clone otomatis|clone gagal"`
Expected: FAIL — launch melempar `needs-bind` karena belum ada auto-clone.

- [x] **Step 3: Write minimal implementation**

Di `server/src/services/session-launch.ts`:

1. Impor (setelah baris impor `./local-binding`):
```ts
import { CheckoutError, cloneProjectCheckout, fetchRefIfMissing } from "./project-checkout";
```

2. Ubah union `kind` pada `LaunchError`:
```ts
    readonly kind: "needs-bind" | "worktree" | "blocked" | "not-approved" | "remote-session" | "confirm-required" | "checkout",
```

3. Tambahkan fungsi di atas `export async function startSpecSession`:
```ts
// ADR-0203 · binding kosong bukan lagi jalan buntu: project yang punya gitRemote di-clone sendiri.
// Tanpa gitRemote tak ada yang bisa di-clone, jadi perilaku lama (needs-bind) dipertahankan.
async function autoCheckout(projectId: string): Promise<string> {
  try {
    return await cloneProjectCheckout(projectId);
  } catch (e) {
    if (!(e instanceof CheckoutError)) throw e;
    if (e.kind === "no-remote" || e.kind === "not-found")
      throw new LaunchError(`project "${projectId}" belum di-bind ke checkout lokal`, "needs-bind");
    throw new LaunchError(`gagal menyiapkan checkout: ${e.message}`, "checkout");
  }
}
```

4. Ganti dua baris resolusi repoDir:
```ts
    const repoDir = (await resolveRepoDir(spec.projectId)) ?? (await autoCheckout(spec.projectId));
```
(hapus baris `if (!repoDir) throw new LaunchError(... "needs-bind")` — `autoCheckout` kini yang melempar).

5. Tepat sebelum `let baseSha: string;` (sebelum blok `addWorktree`), tambahkan:
```ts
    // ADR-0203 · branch dasar yang hanya ada di device lain: ambil dulu. Best-effort — bila tetap tak
    // resolve, `addWorktree` melempar dengan nama revisinya (tak ada fallback diam-diam ke HEAD).
    if (!resume?.worktreeKept) await fetchRefIfMissing(repoDir, spec.branchFrom);
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/session-launch.test.ts test/session-launch-admission.test.ts test/structured-launch-admission.test.ts --no-file-parallelism`
Expected: PASS, termasuk test lama `needs-bind`. Bila ada `switch` pada `LaunchError.kind` yang tidak lengkap, `grep -rn "LaunchError" server/src` dan tangani kind `checkout` seperti `worktree` (gagal → `markFailed`).

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-launch.ts server/test/session-launch.test.ts docs/superpowers/plans/2026-10-11-checkout-otomatis.md
git commit -m "feat(launch): auto-clone checkout saat binding kosong

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `POST /projects/:id/clone` memakai service yang sama

**Files:**
- Modify: `server/src/routes/bindings.ts:35-46`
- Test: `server/test/bindings.route.test.ts` (tambah dua test)

**Interfaces:**
- Consumes: `cloneProjectCheckout`, `CheckoutError` (Task 3).
- Produces: kontrak HTTP tetap — `201 { repoDir }`, `404`, `409 { error, detail? }`. Body tetap `{ dir }` wajib (MCP `hanoman_project_clone` tidak berubah).

- [x] **Step 1: Write the failing test**

Tambahkan di `server/test/bindings.route.test.ts`, di dalam `describe` yang ada:

```ts
  it("clone ke folder yang sudah berisi hal lain → 409 dan isinya tidak ditimpa", async () => {
    const remote = makeRepoWithBranches("main");
    await pathlessProject(remote);
    const dest = mkdtempSync(join(tmpdir(), "hn-clone-"));
    writeFileSync(join(dest, "milik-orang.txt"), "x");
    const r = await app.inject({ method: "POST", url: "/api/projects/p1/clone", payload: { dir: dest } });
    expect(r.statusCode).toBe(409);
    expect(existsSync(join(dest, "milik-orang.txt"))).toBe(true);
  });

  it("clone gagal → 409 dengan detail stderr git dan tanpa binding", async () => {
    await pathlessProject(join(tmpdir(), "tidak-ada-repo-ini"));
    const dest = join(mkdtempSync(join(tmpdir(), "hn-clone-")), "repo");
    const r = await app.inject({ method: "POST", url: "/api/projects/p1/clone", payload: { dir: dest } });
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toBeTruthy();
    expect(await resolveRepoDir("p1")).toBeNull();
  });
```

dan tambahkan `writeFileSync` ke impor `node:fs` di file itu.

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/bindings.route.test.ts --no-file-parallelism`
Expected: FAIL pada test "folder yang sudah berisi hal lain" (`git clone` ke folder tak kosong gagal, tapi `detail` bentuk lama dan test kedua gagal karena `detail` kosong untuk path non-repo). Catat output sebenarnya sebelum lanjut.

- [x] **Step 3: Write minimal implementation**

Ganti handler `app.post("/projects/:id/clone", …)` di `server/src/routes/bindings.ts` dan hapus impor `spawnSync` yang tak terpakai:

```ts
  app.post("/projects/:id/clone", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zClone.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    try {
      const repoDir = await cloneProjectCheckout(id, { dir: p.data.dir });
      return reply.code(201).send({ repoDir });
    } catch (e) {
      if (!(e instanceof CheckoutError)) throw e;
      if (e.kind === "not-found") return reply.code(404).send({ error: "not found" });
      if (e.kind === "no-remote") return reply.code(409).send({ error: "project tidak punya gitRemote untuk clone" });
      return reply.code(409).send({ error: e.message, ...(e.detail ? { detail: e.detail } : {}) });
    }
  });
```

dengan impor:
```ts
import { CheckoutError, cloneProjectCheckout } from "../services/project-checkout";
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd server && TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run test/bindings.route.test.ts test/binding-routes.test.ts test/binding-edit.test.ts test/binding-aware.test.ts --no-file-parallelism`
Expected: PASS, termasuk test lama (201 + `.git`, 409 tanpa gitRemote).

- [x] **Step 5: Commit**

```bash
git add server/src/routes/bindings.ts server/test/bindings.route.test.ts docs/superpowers/plans/2026-10-11-checkout-otomatis.md
git commit -m "refactor(projects): route clone memakai service checkout bersama

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ADR, kontrak, dan uji nyata di lokal

**Files:**
- Create: `internal/docs/adr/0203-checkout-otomatis-token-git-dari-hub.md`
- Modify: `internal/docs/architecture/api-contract.md` (tambah `GET /sync/git-credential` di blok sync mesin-ke-mesin, dekat baris 1426; catat bahwa `POST /projects/:id/clone` kini memakai token & menolak folder terisi)
- Modify: `internal/docs/README.md` (tautkan ADR-0203)

**Interfaces:** tidak ada kode baru.

- [ ] **Step 1: Tulis ADR**

Isi `internal/docs/adr/0203-checkout-otomatis-token-git-dari-hub.md` (format mengikuti ADR-0199): Tanggal 2026-10-11, Status diterima; **Konteks** (checkout LOCAL-only tak ikut sync — ADR-0135; device baru butuh clone + login git manual); **Keputusan** (1. launch tanpa binding meng-clone otomatis ke `$HANOMAN_HOME/projects/<id>`; 2. token = `GITHUB_TOKEN` lokal lalu hub via `GET /sync/git-credential` Bearer device-token, tidak disimpan ulang di client; 3. askpass env-only, hanya `https://github.com/`; 4. clone asinkron, satu per project; 5. folder terisi tak pernah ditimpa; 6. endpoint credential masuk `UNWRAPPED` — agent token tak bisa memakainya, ADR-0199 butir 4); **Alternatif ditolak** (model `GitCredential` + sealed box per instance: topologi hub–client sudah mengautentikasi device token, jadi lapisan kedua hanya menambah permukaan; token yang di-cache di client: pencabutan di hub tak berlaku); **Konsekuensi** (tanpa migration; hub offline = clone repo private gagal dengan pesan jelas; token hub dapat dibaca setiap device token aktif — cabut device token untuk mencabut akses).

- [ ] **Step 2: Perbarui kontrak dan indeks**

Tambahkan di `api-contract.md` baris `GET /sync/git-credential   # Bearer device token → 200 { token: string | null }, cache-control: no-store; tanpa token → 401; agent token → 401`. Tambahkan tautan ADR-0203 di `internal/docs/README.md` pada daftar ADR.

- [ ] **Step 3: Uji nyata end-to-end di lokal**

Run:
```bash
export HANOMAN_HOME="$(mktemp -d)" TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
pnpm dev   # terminal lain; tunggu server siap
```
Lalu, dengan project uji tanpa binding dan `gitRemote` berupa repo lokal sementara:
```bash
curl -s -X POST localhost:<port>/api/projects/<id>/clone -H 'content-type: application/json' -d '{"dir":"'$HANOMAN_HOME'/projects/<id>"}'
curl -s -i localhost:<port>/api/sync/git-credential   # Expected: 401 tanpa Bearer
```
Expected: clone → `201 {"repoDir":…}`; credential tanpa Bearer → `401`. Catat port dan output di komentar commit.

- [ ] **Step 4: Jalankan seluruh set test yang tersentuh**

Run: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` dengan `TEST_DATABASE_URL` terpisah.
Expected: PASS. Bila gagal 404/P2022 masif, itu isolasi DB (SPEC-479), bukan regresi — ulangi dengan `TEST_DATABASE_URL` baru.

- [ ] **Step 5: Commit**

```bash
git add internal/docs/adr/0203-checkout-otomatis-token-git-dari-hub.md internal/docs/architecture/api-contract.md internal/docs/README.md docs/superpowers/plans/2026-10-11-checkout-otomatis.md
git commit -m "docs: ADR-0203 checkout otomatis + kontrak git-credential

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-10-11-checkout-otomatis-design.md`):
- Auto-clone saat launch → Task 4. Lokasi `$HANOMAN_HOME/projects/<slug>` → Task 3.
- Token dari hub via device token → Task 2; tanpa `GitCredential`/migration (revisi dari spec, lihat di bawah).
- Askpass env-only, hanya GitHub HTTPS, SSH→HTTPS → Task 1 + Task 3.
- Kunci per project, folder sisa dihapus, folder cocok dipakai ulang, folder terisi tak ditimpa → Task 3.
- `branchFrom` hilang → fetch best-effort + galat dari `addWorktree` → Task 3 & 4.
- Tabel galat: `gitRemote` kosong (needs-bind), token ditolak (`auth`), disk/occupied, clone terputus (`clone`, folder dihapus), launch bersamaan → Task 3/4.
- Keputusan MCP (ADR-0202) → `UNWRAPPED` Task 2; tool clone tidak berubah.
- Dokumen, ADR, indeks → Task 6.

**Revisi terhadap spec yang harus ikut dikoreksi saat eksekusi** (fakta baru dari kode):
1. `GITHUB_TOKEN` + UI Settings sudah ada (`shared/src/config-registry.ts:42`) → model `GitCredential`, migration, halaman "Akses Git" dan tool MCP status token **dihapus** dari scope.
2. Tombol "Clone sekarang" sudah ada (`MissingRepoCard.tsx`) → tanpa pekerjaan frontend.
3. Status "cloning" lewat `/api/events/ws` **ditunda**: launch menunggu clone di request HTTP (asinkron terhadap event loop, bukan sinkron). Menambah grup snapshot events adalah perubahan kontrak tersendiri (ADR-0145) dan bukan syarat agar launch seamless.
4. Token tidak disalin/di-cache di client; diambil dari hub saat dibutuhkan.

**Placeholder scan:** tidak ada TBD/TODO; semua langkah kode memuat kode lengkap. Satu langkah (Task 5 Step 2) meminta mencatat output gagal aktual karena bentuk `detail` lama tidak saya jalankan.

**Type consistency:** `cloneProjectCheckout(projectId, { dir?, token? })`, `CheckoutError.kind` (`not-found|no-remote|auth|clone|occupied`), `fetchRefIfMissing(repoDir, rev, token?)`, `resolveGitToken({ hub? })`, `hubGitToken(transport?)`, `gitAuthEnv(token)` — dipakai identik di Task 1-5.
