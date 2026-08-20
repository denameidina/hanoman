# SPEC-861 — IDE tab Worktrees: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab **Worktrees** di IDE yang mendaftar worktree git yang masih HIDUP di sebuah project dan bisa menghapusnya berikut branch-nya dalam satu aksi, sehingga worktree yatim punya permukaan dan kebuntuan `BranchLock: "worktree"` di tab Branches punya jalan keluar.

**Architecture:** Satu service **murni** `server/src/services/worktree-list.ts` menurunkan seluruh daftar dari `git worktree list --porcelain` tiap request (ADR-0018/0011) — tanpa kolom DB, tanpa cache; sinyal non-git (Spec + stage, sesi tmux) dan seluruh efek samping (tutup sesi, `rename` ke `.trash`, `prune`, hapus branch) masuk sebagai **parameter/deps**, dirakit di `routes/ide.ts` yang memang sudah boleh menyentuh DB & tmux. Penghapusan mengikuti SPEC-742/ADR-0116: request hanya me-`rename` ke `.worktrees/.trash/` lalu membalas; byte-nya dihabisi `worktree-reaper.ts` yang domainnya **tetap** `.trash/**` saja.

**Tech Stack:** Node 20+ / TypeScript strict, Fastify, Prisma 6 + SQLite, vitest, React 18 + Vite, design system `internal/docs/design-system/**`.

## Global Constraints

- **Reuse, jangan duplikat:** `branch-cleanup.ts` (`deleteBranches` + pagar kunci), `worktree-reaper.ts` (`releaseWorktree`), `session-worktree.ts` (`ownsWorktree`), `local-binding.ts` (`resolveRepoDir`).
- **Service baru MURNI** seperti `branch-cleanup.ts`: tak boleh mengimpor `prisma`, `pty`, atau `worktree-reaper`. Semua itu masuk sebagai parameter/deps.
- **Baca git TAK PERNAH melempar.** Repo rusak / tanpa commit → daftar kosong, bukan 500. Cermin `out()` di `branch-cleanup.ts`.
- **`execFile` async, bukan `spawnSync`.** Route ini melayani event loop yang sama dengan terminal PTY.
- **Entri `.trash/**` DIKECUALIKAN** dari daftar — wilayah reaper, sudah punya permukaannya sendiri (`GET /terminal/cleanups`).
- **Domain reaper tidak diperlebar.** Ia hanya menyentuh `.trash/**`. Yang berubah adalah APA yang masuk ke `.trash`.
- **`ownsWorktree()` adalah SATU-SATUNYA gerbang `deletable`.** Jangan menebak dari substring path. `repoDir` sendiri tak pernah boleh masuk daftar yang bisa dihapus.
- **Capability:** `worktrees` di bawah domain `ide` yang sudah ada, diturunkan **dari method** (`rw()`), bukan dari prefix.
- **Konfirmasi destruktif** lewat `useConfirm` (ADR-0127). Brief menyebut "ADR-0125"; kontrak konfirmasi destruktif final bernomor **0127** (`internal/docs/adr/0127-satu-kontrak-konfirmasi-destruktif.md`).
- **Test wajib** (dari brief): parsing porcelain termasuk detached HEAD & `.trash` terkecualikan & prunable, pemetaan worktree→SPEC, pagar `repoDir`/`.worktrees` sendiri, jalur hapus-dengan-branch.
- **Verifikasi ber-scope** (SPEC-376/ADR-0080): jalankan hanya test yang tersentuh, dengan `--no-file-parallelism` dan `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"`.
- Update `internal/docs` yang tersentuh + ADR baru **dalam commit yang sama**, dan tautkan di `internal/docs/README.md`.

## Struktur berkas

| Berkas | Tanggung jawab |
| --- | --- |
| `shared/src/dto.ts` (modifikasi) | `WorktreeView`, `WorktreeReport`, `WorktreeStats`, `WorktreeDeleteResult` |
| `shared/src/api.ts` (modifikasi) | tiga path baru |
| `server/src/services/worktree-list.ts` (baru) | **murni**: parsing porcelain, pemetaan spec/sesi, gerbang `deletable`, stats, orkestrasi hapus lewat deps |
| `server/src/services/session-close.ts` (baru) | badan penutupan sesi yang dipindah dari `routes/terminal.ts` — satu definisi, dua call site |
| `server/src/services/branch-cleanup.ts` (modifikasi) | `worktreeBranches` → `Map`; field additif `UnusedBranch.worktree` |
| `server/src/services/agent-capabilities.ts` (modifikasi) | `worktrees` masuk `IDE_SUBS` |
| `server/src/routes/ide.ts` (modifikasi) | tiga route + perakitan deps (DB & tmux) |
| `server/src/routes/terminal.ts` (modifikasi) | `DELETE /terminal/sessions/:id` jadi pembungkus tipis |
| `src/src/api/client.ts` (modifikasi) | tipe cermin + tiga method |
| `src/src/screens/WorktreesPanel.tsx` (baru) | panel tab Worktrees |
| `src/src/screens/IdeScreen.tsx` (modifikasi) | tab keempat + tautan dua arah |
| `src/src/screens/BranchesPanel.tsx` (modifikasi) | badge `dipakai worktree` jadi tautan |
| `internal/docs/adr/0132-*.md` (baru) | ADR permukaan penghapusan worktree |
| `internal/docs/architecture/api-contract.md`, `internal/docs/README.md`, `internal/skills/hanoman/SKILL.md` (modifikasi) | docs SoT |

---

### Task 1: DTO bersama + service murni `worktree-list.ts` (daftar)

**Files:**
- Modify: `shared/src/dto.ts` (append di dekat `WorktreeCleanupView`)
- Create: `server/src/services/worktree-list.ts`
- Test: `server/test/worktree-list.test.ts`

**Interfaces:**
- Consumes: `ownsWorktree(repoDir, cwd)` dari `server/src/services/session-worktree.ts`.
- Produces:
  - `parseWorktreePorcelain(text: string): RawWorktree[]`
  - `listWorktrees(repoDir: string | null, inputs: WorktreeInputs): Promise<WorktreeReport>`
  - `type WorktreeInputs = { specs: Map<string, { id: string; stage: string }>; sessions: Map<string, { id: string; specId: string | null }> }`
  - DTO `WorktreeView` / `WorktreeReport` dari `@hanoman/shared`.

- [x] **Step 1: Tambahkan DTO di `shared/src/dto.ts`**

Sisipkan tepat SESUDAH blok `WorktreeCleanupView` (cari `state: "closing" | "failed";`):

```ts
// SPEC-861 · ADR-0132 · worktree yang masih HIDUP di sebuah project. Nilai turunan penuh dari
// `git worktree list --porcelain` tiap request (ADR-0018/0011): tak ada kolom DB, tak ada cache.
// Entri `.worktrees/.trash/**` TIDAK muncul di sini — itu wilayah reaper (WorktreeCleanupView).
export type WorktreeView = {
  /** Path absolut apa adanya dari git. */
  path: string;
  /** `basename(path)` — juga id baris di API tulis; klien tak pernah mengirim path. */
  name: string;
  /** SHA HEAD; "" bila tak terbaca (registrasi prunable). */
  head: string;
  /** null = detached HEAD. Sesi hanoman SELALU detached (ADR-0002). */
  branch: string | null;
  /** Registrasi git menunjuk direktori yang sudah lenyap. */
  prunable: boolean;
  /** `git worktree lock`. */
  locked: boolean;
  /** `ownsWorktree(repoDir, path)` — SATU-SATUNYA gerbang penghapusan. */
  deletable: boolean;
  /** Alasan prosa saat `deletable` false; null saat boleh dihapus. */
  blocked: string | null;
  spec: { id: string; stage: string } | null;
  /** Sesi tmux yang HIDUP di worktree ini sekarang. */
  session: { id: string; specId: string | null } | null;
  createdAt: string | null;
};
export type WorktreeReport = { repoDir: string; worktrees: WorktreeView[] };

// SPEC-861 · sinyal MAHAL, sengaja di endpoint terpisah supaya daftar tak menunggu keduanya.
export type WorktreeStats = {
  name: string;
  /** null = `du` gagal/timeout. */
  sizeBytes: number | null;
  dirtyFiles: number;
  /** Commit yang HANYA hidup di worktree ini — kerja yang benar-benar hilang bila dihapus. */
  orphanCommits: number;
};
```

- [x] **Step 2: Tulis test yang gagal**

Buat `server/test/worktree-list.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseWorktreePorcelain, listWorktrees, type WorktreeInputs } from "../src/services/worktree-list";

const NONE: WorktreeInputs = { specs: new Map(), sessions: new Map() };
const g = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

// Repo: main + worktree detached `.worktrees/spec-1`, worktree ber-branch `.worktrees/wt-feat`,
// registrasi prunable `.worktrees/gone`, dan satu entri sampah di `.worktrees/.trash/`.
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-wtlist-"));
  g(dir, "init", "-q", "-b", "main");
  g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "x");
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "base");
  g(dir, "branch", "feat");
  g(dir, "worktree", "add", "-q", "--detach", join(dir, ".worktrees", "spec-1"), "main");
  g(dir, "worktree", "add", "-q", join(dir, ".worktrees", "wt-feat"), "feat");
  g(dir, "worktree", "add", "-q", "--detach", join(dir, ".worktrees", "gone"), "main");
  rmSync(join(dir, ".worktrees", "gone"), { recursive: true, force: true });
  const trash = join(dir, ".worktrees", ".trash", "spec-9.abc");
  mkdirSync(trash, { recursive: true });
  writeFileSync(join(trash, "x.txt"), "sampah");
  return dir;
}

describe("parseWorktreePorcelain", () => {
  it("membaca branch, detached, prunable, dan locked", () => {
    const rows = parseWorktreePorcelain([
      "worktree /r", "HEAD aaa", "branch refs/heads/main", "",
      "worktree /r/.worktrees/spec-1", "HEAD bbb", "detached", "",
      "worktree /r/.worktrees/gone", "HEAD ccc", "detached",
      "prunable gitdir file points to non-existent location", "",
      "worktree /r/.worktrees/held", "HEAD ddd", "detached", "locked alasan", "",
    ].join("\n"));
    expect(rows.map((r) => r.branch)).toEqual(["main", null, null, null]);
    expect(rows[2]!.prunable).toBe(true);
    expect(rows[3]!.locked).toBe(true);
    expect(rows[0]!.head).toBe("aaa");
  });

  it("keluaran kosong → nol baris", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("listWorktrees", () => {
  it("mendaftar worktree hidup dengan branch atau detached", async () => {
    const dir = repo();
    const r = await listWorktrees(dir, NONE);
    const byName = new Map(r.worktrees.map((w) => [w.name, w]));
    expect(byName.get("spec-1")!.branch).toBeNull();
    expect(byName.get("spec-1")!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(byName.get("wt-feat")!.branch).toBe("feat");
    expect(byName.get("gone")!.prunable).toBe(true);
  });

  it("entri .trash TIDAK pernah muncul", async () => {
    const r = await listWorktrees(repo(), NONE);
    expect(r.worktrees.some((w) => w.path.includes("/.trash/"))).toBe(false);
    expect(r.worktrees.some((w) => w.name === "spec-9.abc")).toBe(false);
  });

  it("repoDir sendiri tampil tapi TAK PERNAH deletable", async () => {
    const dir = repo();
    const r = await listWorktrees(dir, NONE);
    const self = r.worktrees.find((w) => w.path === resolve(dir))!;
    expect(self.deletable).toBe(false);
    expect(self.blocked).toBe("checkout project");
    expect(r.worktrees.find((w) => w.name === "spec-1")!.deletable).toBe(true);
  });

  // GOTCHA · hanoman didogfood DI DALAM worktree-nya sendiri: sebuah project bisa ter-bind ke
  // checkout yang kebetulan berada di bawah `.worktrees/`. Menguji bentuk path saja pernah membuat
  // removeWorktree(repoDir, repoDir) menghapus checkout project itu sendiri (SPEC-362).
  it("project ter-bind ke checkout DI BAWAH .worktrees → tak ada baris yang deletable", async () => {
    const dir = repo();
    const bound = join(dir, ".worktrees", "spec-1");
    const r = await listWorktrees(bound, NONE);
    expect(r.worktrees.length).toBeGreaterThan(1);
    expect(r.worktrees.every((w) => !w.deletable)).toBe(true);
  });

  it("memetakan worktree ke SPEC lewat id sesi & stage-nya", async () => {
    const r = await listWorktrees(repo(), {
      specs: new Map([["spec-1", { id: "SPEC-1", stage: "executing" }]]),
      sessions: new Map(),
    });
    const w = r.worktrees.find((x) => x.name === "spec-1")!;
    expect(w.spec).toEqual({ id: "SPEC-1", stage: "executing" });
    expect(r.worktrees.find((x) => x.name === "wt-feat")!.spec).toBeNull();
  });

  it("menandai sesi tmux hidup di worktree itu", async () => {
    const dir = repo();
    const r = await listWorktrees(dir, {
      specs: new Map(),
      sessions: new Map([[resolve(dir, ".worktrees", "spec-1"), { id: "spec-1", specId: "SPEC-1" }]]),
    });
    expect(r.worktrees.find((w) => w.name === "spec-1")!.session).toEqual({ id: "spec-1", specId: "SPEC-1" });
    expect(r.worktrees.find((w) => w.name === "wt-feat")!.session).toBeNull();
  });

  it("createdAt terisi untuk worktree hidup, null untuk prunable", async () => {
    const r = await listWorktrees(repo(), NONE);
    expect(r.worktrees.find((w) => w.name === "spec-1")!.createdAt).toMatch(/^\d{4}-/);
    expect(r.worktrees.find((w) => w.name === "gone")!.createdAt).toBeNull();
  });

  // Cermin out() di branch-cleanup.ts: route ini read-only, repo rusak tak boleh jadi 500.
  it("bukan repo git / repoDir null → daftar kosong, tak melempar", async () => {
    expect((await listWorktrees(null, NONE)).worktrees).toEqual([]);
    const plain = mkdtempSync(join(tmpdir(), "hanoman-notrepo-"));
    expect((await listWorktrees(plain, NONE)).worktrees).toEqual([]);
  });
});
```

- [x] **Step 3: Jalankan test — harus GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/worktree-list.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/services/worktree-list"`.

- [x] **Step 4: Tulis `server/src/services/worktree-list.ts`**

```ts
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WorktreeReport, WorktreeView } from "@hanoman/shared";
import { ownsWorktree } from "./session-worktree";

// SPEC-861 · ADR-0132 · penemuan worktree yang masih HIDUP di sebuah project.
// Nilai turunan penuh dari git tiap request (ADR-0018/0011): tak ada kolom DB, tak ada cache.
// Murni seperti branch-cleanup.ts: sinyal non-git (Spec, sesi tmux) dan seluruh efek samping masuk
// sebagai parameter/deps — modul ini bisa dites tanpa DB maupun tmux.
const exec = promisify(execFile);
const GIT = { timeout: 60_000, maxBuffer: 1 << 24, encoding: "utf8" as const };

// Cermin out() di branch-cleanup.ts: gagal → string kosong, TAK PERNAH melempar.
async function out(cwd: string, args: string[]): Promise<string> {
  try { return (await exec("git", args, { cwd, ...GIT })).stdout; } catch { return ""; }
}

export type RawWorktree = {
  path: string; head: string; branch: string | null;
  prunable: boolean; locked: boolean; bare: boolean;
};

// `git worktree list --porcelain` memancarkan satu blok per worktree, dipisah baris kosong:
//   worktree <path> / HEAD <sha> / (branch refs/heads/<b> | detached) / [bare] / [locked …] /
//   [prunable <alasan>]
// `detached` sengaja tak punya cabang sendiri: ketiadaan baris `branch` SUDAH berarti detached.
export function parseWorktreePorcelain(text: string): RawWorktree[] {
  const rows: RawWorktree[] = [];
  let cur: RawWorktree | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), head: "", branch: null,
        prunable: false, locked: false, bare: false };
      rows.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch refs/heads/")) cur.branch = line.slice("branch refs/heads/".length);
    else if (line === "bare") cur.bare = true;
    else if (line === "locked" || line.startsWith("locked ")) cur.locked = true;
    else if (line === "prunable" || line.startsWith("prunable ")) cur.prunable = true;
  }
  return rows;
}

export type WorktreeInputs = {
  /** Kunci = id sesi deterministik dari id spec (ADR-0015) = `basename` worktree-nya. */
  specs: Map<string, { id: string; stage: string }>;
  /** Kunci = `resolve(cwd)` sesi tmux yang masih hidup. */
  sessions: Map<string, { id: string; specId: string | null }>;
};

const EMPTY: WorktreeReport = { repoDir: "", worktrees: [] };

// `.git` sebuah worktree tertaut adalah BERKAS yang ditulis sekali saat `worktree add` dan tak
// pernah disentuh lagi — stempel lahir yang jujur. birthtime 0 (sebagian filesystem Linux) → mtime.
async function bornAt(path: string): Promise<string | null> {
  try {
    const st = await stat(join(path, ".git"));
    const ms = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
    return new Date(ms).toISOString();
  } catch { return null; }
}

export async function listWorktrees(
  repoDir: string | null, inputs: WorktreeInputs,
): Promise<WorktreeReport> {
  if (!repoDir) return EMPTY;
  const base = resolve(repoDir);
  const text = await out(base, ["worktree", "list", "--porcelain"]);
  // `.trash` adalah wilayah reaper (SPEC-742/ADR-0116) dan sudah punya permukaannya sendiri.
  // Prefix path yang sudah dinormalkan, bukan substring: nama worktree boleh memuat ".trash".
  const trash = resolve(base, ".worktrees", ".trash");
  const rows: WorktreeView[] = [];
  for (const w of parseWorktreePorcelain(text)) {
    const path = resolve(w.path);
    if (path === trash || path.startsWith(trash + sep)) continue;
    const name = basename(path);
    const deletable = ownsWorktree(base, path);
    const spec = inputs.specs.get(name);
    rows.push({
      path, name, head: w.head, branch: w.branch,
      prunable: w.prunable, locked: w.locked,
      deletable,
      blocked: deletable ? null : path === base ? "checkout project" : "di luar .worktrees project ini",
      spec: spec ? { id: spec.id, stage: spec.stage } : null,
      session: inputs.sessions.get(path) ?? null,
      createdAt: await bornAt(path),
    });
  }
  // Deterministik untuk test & UI: yang tak bisa dihapus di atas (konteks), sisanya per nama.
  rows.sort((a, b) => Number(a.deletable) - Number(b.deletable) || a.name.localeCompare(b.name));
  return { repoDir: base, worktrees: rows };
}
```

- [x] **Step 5: Jalankan test — harus LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/worktree-list.test.ts
```

Expected: PASS, 10 test.

- [x] **Step 6: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```

Expected: keluar 0.

- [x] **Step 7: Commit**

```bash
git add shared/src/dto.ts server/src/services/worktree-list.ts server/test/worktree-list.test.ts
git commit -m "feat(ide): daftar worktree hidup turunan git (SPEC-861)"
```

---

### Task 2: Sinyal mahal — ukuran disk, isi kotor, commit yatim

**Files:**
- Modify: `server/src/services/worktree-list.ts`
- Test: `server/test/worktree-list.test.ts`

**Interfaces:**
- Consumes: `WorktreeView` dari Task 1.
- Produces: `worktreeStats(repoDir: string, w: WorktreeView): Promise<WorktreeStats>`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/worktree-list.test.ts` (dan tambahkan `worktreeStats` ke baris `import`):

```ts
describe("worktreeStats", () => {
  const find = async (dir: string, name: string) =>
    (await listWorktrees(dir, NONE)).worktrees.find((w) => w.name === name)!;

  it("menghitung berkas yang belum tersimpan", async () => {
    const dir = repo();
    writeFileSync(join(dir, ".worktrees", "spec-1", "baru.txt"), "kerja");
    const s = await worktreeStats(dir, await find(dir, "spec-1"));
    expect(s.dirtyFiles).toBe(1);
    expect(s.sizeBytes).toBeGreaterThan(0);
  });

  it("commit yang juga ada di branch lain BUKAN yatim", async () => {
    const dir = repo();
    expect((await worktreeStats(dir, await find(dir, "wt-feat"))).orphanCommits).toBe(0);
  });

  // GOTCHA git 2.50.1 · pola --exclude untuk --branches RELATIF terhadap refs/heads/:
  // `--exclude=feat` bekerja, `--exclude=refs/heads/feat` diam-diam tak mengecualikan apa pun.
  // Untuk --remotes ia relatif terhadap refs/remotes/ → `*/feat`. Dan --exclude di-RESET sesudah
  // tiap --branches/--remotes/--tags, jadi wajib ditulis ulang sebelum masing-masing.
  it("commit di branch worktree ini SENDIRI dihitung yatim (ia ikut hilang bila branch dihapus)", async () => {
    const dir = repo();
    const wt = join(dir, ".worktrees", "wt-feat");
    writeFileSync(join(wt, "kerja.txt"), "satu");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "kerja");
    expect((await worktreeStats(dir, await find(dir, "wt-feat"))).orphanCommits).toBe(1);
  });

  it("commit detached yang lepas dari semua ref dihitung yatim", async () => {
    const dir = repo();
    const wt = join(dir, ".worktrees", "spec-1");
    writeFileSync(join(wt, "lepas.txt"), "x");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "lepas");
    expect((await worktreeStats(dir, await find(dir, "spec-1"))).orphanCommits).toBe(1);
  });

  it("baris prunable tak melempar dan menjawab nol", async () => {
    const dir = repo();
    const s = await worktreeStats(dir, await find(dir, "gone"));
    expect(s.dirtyFiles).toBe(0);
    expect(s.sizeBytes).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — harus GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/worktree-list.test.ts
```

Expected: FAIL — `worktreeStats is not a function` / import error.

- [x] **Step 3: Implementasi**

Tambahkan ke `server/src/services/worktree-list.ts` (dan tambahkan `WorktreeStats` ke `import type`):

```ts
// SPEC-861 · sinyal MAHAL. Sengaja TERPISAH dari listWorktrees: `du` menelusuri seluruh pohon dan
// `status` bisa lambat di repo besar, sementara daftar harus lahir seketika. UI memuatnya menyusul
// per baris. Ketiganya gagal-diam — tak satu pun boleh jadi 500.
export async function worktreeStats(repoDir: string, w: WorktreeView): Promise<WorktreeStats> {
  const [sizeBytes, dirtyFiles, orphanCommits] = await Promise.all([
    diskBytes(w), dirtyCount(w), orphanCount(resolve(repoDir), w),
  ]);
  return { name: w.name, sizeBytes, dirtyFiles, orphanCommits };
}

async function diskBytes(w: WorktreeView): Promise<number | null> {
  if (w.prunable) return null;   // direktorinya sudah lenyap
  try {
    const { stdout } = await exec("du", ["-sk", w.path],
      { timeout: 30_000, maxBuffer: 1 << 20, encoding: "utf8" });
    const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "", 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch { return null; }
}

async function dirtyCount(w: WorktreeView): Promise<number> {
  if (w.prunable) return 0;
  return out(w.path, ["status", "--porcelain"]).then(
    (s) => s.split("\n").filter((l) => l.trim()).length);
}

// "Kerja yang akan hilang": commit reachable dari HEAD worktree ini tetapi TIDAK dari ref lain mana
// pun — dengan branch yang ter-checkout DI SINI ikut dikecualikan, karena checkbox 'hapus branch
// juga' akan ikut menghapusnya. SHA heksadesimal tak pernah terbaca sebagai flag (ADR-0032).
//
// GOTCHA terukur (git 2.50.1): pola `--exclude` untuk `--branches` relatif terhadap `refs/heads/`
// (`feat`, BUKAN `refs/heads/feat` — bentuk panjang diam-diam tak mengecualikan apa pun) dan untuk
// `--remotes` relatif terhadap `refs/remotes/` (`*/feat`). `--exclude` juga di-RESET sesudah tiap
// `--branches`/`--remotes`/`--tags`, jadi ia wajib ditulis ulang sebelum masing-masing.
async function orphanCount(repoDir: string, w: WorktreeView): Promise<number> {
  if (!w.head) return 0;
  const args = ["rev-list", "--count", w.head, "--not"];
  if (w.branch) args.push(`--exclude=${w.branch}`, "--branches", `--exclude=*/${w.branch}`, "--remotes", "--tags");
  else args.push("--branches", "--remotes", "--tags");
  const n = Number.parseInt((await out(repoDir, args)).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}
```

- [x] **Step 4: Jalankan test — harus LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/worktree-list.test.ts
```

Expected: PASS, 15 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/worktree-list.ts server/test/worktree-list.test.ts
git commit -m "feat(ide): ukuran disk, isi kotor & commit yatim per worktree (SPEC-861)"
```

---

### Task 3: Ekstraksi `services/session-close.ts`

Menutup sesi hari ini hidup **inline** di `DELETE /terminal/sessions/:id`. Route worktrees butuh perilaku yang sama persis; menyalinnya adalah kelas bug "satu definisi, N call site" yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475/481).

**Files:**
- Create: `server/src/services/session-close.ts`
- Modify: `server/src/routes/terminal.ts:47-70` (`advanceStage`) dan `:429-462` (handler DELETE)
- Test: `server/test/session-close.test.ts`

**Interfaces:**
- Produces: `closeSession(id: string): Promise<{ cleanup: string | null } | null>` — `null` = sesi tak ada.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/session-close.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetDb, makeProject, makeRepoWithWorktree } from "./factory";
import { createSession, getSession, killAll } from "../src/services/pty";
import { closeSession } from "../src/services/session-close";
import { trashDirOf, __resetReaper } from "../src/services/worktree-reaper";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

beforeEach(async () => { await resetDb(); __resetReaper(); });
afterAll(() => { killAll(); });

describe("closeSession", () => {
  it("sesi tak ada → null", async () => {
    expect(await closeSession("tak-ada")).toBeNull();
  });

  it("melepas worktree sesi ke .trash dan mematikan pane-nya", async () => {
    const repoDir = makeRepoWithWorktree("spec-c1", { "a.txt": "a" }, {});
    await makeProject({ id: "closep", repoDir });
    const wt = join(repoDir, ".worktrees", "spec-c1");
    createSession("closep", wt, { id: "spec-c1", shell: FAKE_CLAUDE });

    const r = await closeSession("spec-c1");
    expect(r?.cleanup).toBeTruthy();
    expect(getSession("spec-c1")?.exited ?? true).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(trashDirOf(repoDir), r!.cleanup!))).toBe(true);
  });

  // SPEC-362 · terminal biasa punya cwd === repoDir; melepasnya berarti menghapus checkout project.
  it("terminal biasa (cwd = repoDir) TIDAK melepas apa pun", async () => {
    const repoDir = makeRepoWithWorktree("spec-c2", { "a.txt": "a" }, {});
    await makeProject({ id: "closep2", repoDir });
    createSession("closep2", repoDir, { id: "term-c2", shell: FAKE_CLAUDE });

    const r = await closeSession("term-c2");
    expect(r).toEqual({ cleanup: null });
    expect(existsSync(join(repoDir, "a.txt"))).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test — harus GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-close.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/services/session-close"`.

- [x] **Step 3: Pindahkan `advanceStage` + badan DELETE ke service baru**

Buat `server/src/services/session-close.ts` dengan isi yang dipindah **apa adanya** dari `routes/terminal.ts` (jangan menulis ulang logikanya):

```ts
import type { Flow } from "@hanoman/runner";
import { realGit } from "@hanoman/runner";
import type { Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { getSession, killSession } from "./pty";
import { phaseFilePath, readPhases, stageForRun } from "./session-phases";
import { recordSessionResult } from "./session-result";
import { recordCompletion } from "./notifications";
import { STAGES } from "./stage-machine";
import { recordHeadSha } from "./spec-head";
import { resolveRepoDir } from "./local-binding";
import { ownsWorktree } from "./session-worktree";
import { releaseWorktree } from "./worktree-reaper";

// Stage hanya maju (ADR-0008). Agen bisa saja tak pernah menulis berkas fasenya; itu tak
// boleh menyeret backlog item mundur ke `brainstorming`.
async function advanceStage(
  specId: string, repoDir: string, sessionId: string, flow: Flow, worktree: string,
): Promise<void> {
  // …salin utuh dari routes/terminal.ts (stageForRun, CAS updateMany, recordSessionResult,
  //   recordCompletion) berikut seluruh komentarnya…
}

// SPEC-861 · ADR-0132 · SATU definisi penutupan sesi, dipakai `DELETE /terminal/sessions/:id`
// DAN `POST /projects/:id/worktrees/delete`. Menyalinnya ke call site kedua berarti mengulang
// kelas bug "satu definisi, N call site" (SPEC-431/448/475/481) pada operasi yang, bila terlewat,
// membuang stage & bukti dependency antar-backlog.
//
// Mengembalikan `null` bila sesinya tak ada; `{ cleanup }` = nama entri `.trash` yang lahir
// (SPEC-742/ADR-0116), `null` bila memang tak ada yang perlu dilepas.
export async function closeSession(id: string): Promise<{ cleanup: string | null } | null> {
  const s = getSession(id);
  if (!s) return null;

  // Sesi ber-flow (run/reverse) DAN sesi integrasi (SPEC-175, tanpa flow) sama-sama hidup di
  // worktree-nya sendiri di `.worktrees/*`. Syarat ini hanya memilih sesi mana yang perlu
  // BOOKKEEPING akhir; penghapusan worktree digerbangi `ownsWorktree` di bawah (SPEC-362).
  if (s.flow || s.cwd.includes("/.worktrees/")) {
    const repoDir = await resolveRepoDir(s.projectId);
    if (repoDir) {
      // SPEC-742 · dua bacaan ini WAJIB terjadi SEBELUM worktree-nya lepas: keduanya membaca
      // berkas fase, plan, dan HEAD dari DALAM worktree.
      if (s.specId) {
        if (s.flow) await advanceStage(s.specId, repoDir, id, s.flow, s.cwd);
        await recordHeadSha(s.specId, s.cwd);
      }
      killSession(id);
      const cleanup = ownsWorktree(repoDir, s.cwd) ? releaseWorktree(repoDir, s.cwd, s.projectId) : null;
      return { cleanup };
    }
  }
  killSession(id);
  return { cleanup: null };
}
```

Lalu di `server/src/routes/terminal.ts`:

- Hapus fungsi `advanceStage` (baris ~47–70) beserta impor yang **hanya** dipakainya. `readPhases`/`phaseFilePath` masih dipakai route lain — periksa dengan `grep -n "readPhases\|phaseFilePath\|STAGES\|recordSessionResult\|recordCompletion\|releaseWorktree\|ownsWorktree\|recordHeadSha" server/src/routes/terminal.ts` sesudah menghapus, dan buang impor yang jadi tak terpakai (TypeScript `noUnusedLocals` akan menyebutkannya).
- Tambahkan `import { closeSession } from "../services/session-close";`.
- Ganti handler DELETE jadi:

```ts
  // SPEC-861 · ADR-0132 · badannya pindah ke services/session-close.ts — dipakai bersama
  // POST /projects/:id/worktrees/delete. Perilaku route ini tak berubah sebaris pun.
  app.delete("/terminal/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await closeSession(id);
    if (!r) return reply.code(404).send({ error: "not found" });
    return reply.code(202).send(r);
  });
```

- [x] **Step 4: Jalankan test baru + test route terminal yang sudah ada**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/session-close.test.ts server/test/terminal.route.test.ts server/test/worktree-reaper.test.ts
```

Expected: PASS semua — `terminal.route.test.ts` adalah bukti bahwa ekstraksi tak mengubah perilaku.

- [x] **Step 5: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Expected: keluar 0.

- [x] **Step 6: Commit**

```bash
git add server/src/services/session-close.ts server/src/routes/terminal.ts server/test/session-close.test.ts
git commit -m "refactor(sesi): satu definisi penutupan sesi di services/session-close (SPEC-861)"
```

---

### Task 4: Orkestrasi hapus + tiga route + capability

**Files:**
- Modify: `server/src/services/worktree-list.ts`
- Modify: `shared/src/dto.ts`, `shared/src/api.ts`
- Modify: `server/src/routes/ide.ts`
- Modify: `server/src/services/agent-capabilities.ts:7-15`
- Test: `server/test/worktrees.route.test.ts`

**Interfaces:**
- Consumes: `listWorktrees`, `worktreeStats` (Task 1–2); `closeSession` (Task 3); `releaseWorktree` (`worktree-reaper.ts`); `deleteBranches` + `LockInputs` (`branch-cleanup.ts`); `lockInputs(id)` yang sudah ada di `routes/ide.ts:35`.
- Produces:
  - `deleteWorktrees(repoDir, names, opts): Promise<{ results: WorktreeDeleteResult[] }>`
  - `type WorktreeDeleteDeps = { closeSession; release; prune; deleteBranch }`
  - `GET /projects/:id/worktrees`, `GET /projects/:id/worktrees/stats?name=`, `POST /projects/:id/worktrees/delete`

- [x] **Step 1: Tambahkan DTO hasil hapus di `shared/src/dto.ts`**

Sisipkan tepat sesudah `WorktreeStats`:

```ts
// SPEC-861 · ADR-0132 · satu baris hasil per worktree yang diminta. Selalu 200 bila body sah —
// kegagalan hidup di baris ini, bukan di status HTTP (cermin POST /branches/delete).
export type WorktreeDeleteResult = {
  name: string;
  ok: boolean;
  /** Nama entri `.worktrees/.trash/` yang lahir (SPEC-742); null bila tak ada yang dipindah. */
  cleanup: string | null;
  /** Id sesi tmux yang ikut ditutup lebih dulu. */
  closedSession?: string;
  /** Hasil `deleteBranches` bila 'hapus branch juga' diminta — pagar ADR-0077 tetap berlaku. */
  branch?: { name: string; ok: boolean; error?: string };
  error?: string;
};
```

- [x] **Step 2: Tambahkan path di `shared/src/api.ts`**

Sisipkan tepat sesudah `branchesDelete`:

```ts
  // SPEC-861 · ADR-0132 · worktree HIDUP (nilai turunan git) + sinyal mahal per baris + hapus batch.
  worktrees: (id: string) => `${API}/projects/${id}/worktrees`,
  worktreeStats: (id: string, name: string) =>
    `${API}/projects/${id}/worktrees/stats?name=${encodeURIComponent(name)}`,
  worktreesDelete: (id: string) => `${API}/projects/${id}/worktrees/delete`,
```

- [x] **Step 3: Tulis test route yang gagal**

Buat `server/test/worktrees.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeSpec, makeRepoWithWorktree } from "./factory";
import { createSession, getSession, killAll } from "../src/services/pty";
import { __resetReaper, trashDirOf } from "../src/services/worktree-reaper";

const app = buildApp({ requireAuth: false });
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });

beforeEach(async () => { await resetDb(); __resetReaper(); });
afterAll(() => { killAll(); });

// Repo: main + worktree detached `.worktrees/spec-w1` + worktree ber-branch `.worktrees/wt-b`
// (branch `topik`, sudah ter-merge ke main → boleh dihapus tab Branches).
async function project(id: string): Promise<string> {
  const repoDir = makeRepoWithWorktree("spec-w1", { "a.txt": "a" }, {});
  g(repoDir, "branch", "topik");
  g(repoDir, "worktree", "add", "-q", join(repoDir, ".worktrees", "wt-b"), "topik");
  await makeProject({ id, repoDir });
  return repoDir;
}

describe("GET /projects/:id/worktrees", () => {
  it("mendaftar worktree hidup + memetakan backlog & stage-nya", async () => {
    const repoDir = await project("wp1");
    await makeSpec({ id: "SPEC-W1", projectId: "wp1", stage: "executing" });
    const r = await app.inject({ method: "GET", url: "/api/projects/wp1/worktrees" });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { repoDir: string; worktrees: any[] };
    expect(body.repoDir).toBe(repoDir);
    const w = body.worktrees.find((x) => x.name === "spec-w1")!;
    expect(w.spec).toEqual({ id: "SPEC-W1", stage: "executing" });
    expect(w.deletable).toBe(true);
    expect(body.worktrees.find((x) => x.path === repoDir)!.deletable).toBe(false);
  });

  it("project tanpa repoDir → daftar kosong, bukan 500", async () => {
    await makeProject({ id: "wnodir", repoDir: null });
    const r = await app.inject({ method: "GET", url: "/api/projects/wnodir/worktrees" });
    expect(r.statusCode).toBe(200);
    expect(r.json().worktrees).toEqual([]);
  });

  it("project tak ada → 404", async () => {
    const r = await app.inject({ method: "GET", url: "/api/projects/hantu/worktrees" });
    expect(r.statusCode).toBe(404);
  });
});

describe("GET /projects/:id/worktrees/stats", () => {
  it("menjawab ukuran, berkas kotor, dan commit yatim", async () => {
    const repoDir = await project("wp2");
    writeFileSync(join(repoDir, ".worktrees", "spec-w1", "belum.txt"), "kerja");
    const r = await app.inject({ method: "GET", url: "/api/projects/wp2/worktrees/stats?name=spec-w1" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ name: "spec-w1", dirtyFiles: 1 });
    expect(r.json().sizeBytes).toBeGreaterThan(0);
  });

  // Klien tak pernah mengirim path: `name` divalidasi terhadap daftar TURUNAN.
  it("nama di luar daftar turunan → 404", async () => {
    await project("wp3");
    const r = await app.inject({ method: "GET", url: "/api/projects/wp3/worktrees/stats?name=../../etc" });
    expect(r.statusCode).toBe(404);
  });
});

describe("POST /projects/:id/worktrees/delete", () => {
  it("melepas worktree ke .trash lalu mem-prune registrasinya", async () => {
    const repoDir = await project("wp4");
    const wt = join(repoDir, ".worktrees", "spec-w1");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp4/worktrees/delete",
      payload: { names: ["spec-w1"] } });
    expect(r.statusCode).toBe(200);
    const [res] = r.json().results;
    expect(res).toMatchObject({ name: "spec-w1", ok: true });
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(trashDirOf(repoDir), res.cleanup))).toBe(true);
    const list = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: repoDir, encoding: "utf8" }).stdout;
    expect(list).not.toContain("/spec-w1");
  });

  it("menutup sesi tmux hidup lebih dulu, bukan mencabut direktori dari bawahnya", async () => {
    const repoDir = await project("wp5");
    createSession("wp5", join(repoDir, ".worktrees", "spec-w1"), { id: "spec-w1", shell: FAKE_CLAUDE });
    const r = await app.inject({ method: "POST", url: "/api/projects/wp5/worktrees/delete",
      payload: { names: ["spec-w1"] } });
    expect(r.json().results[0]).toMatchObject({ ok: true, closedSession: "spec-w1" });
    expect(getSession("spec-w1")?.exited ?? true).toBe(true);
  });

  it("hapus branch juga: worktree lepas DAN branch-nya terhapus", async () => {
    const repoDir = await project("wp6");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp6/worktrees/delete",
      payload: { names: ["wt-b"], deleteBranch: true } });
    const [res] = r.json().results;
    expect(res).toMatchObject({ ok: true, branch: { name: "topik", ok: true } });
    const branches = spawnSync("git", ["branch", "--format=%(refname:short)"], { cwd: repoDir, encoding: "utf8" }).stdout;
    expect(branches).not.toContain("topik");
  });

  // Pagar ADR-0077 tetap berdiri untuk BRANCH; baris worktree-nya tetap terhapus.
  it("branch terkunci melapor alasannya tanpa membatalkan penghapusan worktree", async () => {
    const repoDir = await project("wp7");
    await makeSpec({ id: "topik", projectId: "wp7", stage: "executing" });
    const r = await app.inject({ method: "POST", url: "/api/projects/wp7/worktrees/delete",
      payload: { names: ["wt-b"], deleteBranch: true } });
    const [res] = r.json().results;
    expect(res.ok).toBe(true);
    expect(res.branch.ok).toBe(false);
    expect(existsSync(join(repoDir, ".worktrees", "wt-b"))).toBe(false);
  });

  it("checkout project sendiri TAK PERNAH bisa dihapus", async () => {
    const repoDir = await project("wp8");
    const name = repoDir.split("/").pop()!;
    const r = await app.inject({ method: "POST", url: "/api/projects/wp8/worktrees/delete",
      payload: { names: [name] } });
    expect(r.json().results[0].ok).toBe(false);
    expect(existsSync(join(repoDir, "a.txt"))).toBe(true);
  });

  it("nama di luar daftar turunan ditolak per baris", async () => {
    await project("wp9");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp9/worktrees/delete",
      payload: { names: ["/etc"] } });
    expect(r.json().results[0]).toMatchObject({ ok: false });
  });

  it("body tanpa names → 400", async () => {
    await project("wp10");
    const r = await app.inject({ method: "POST", url: "/api/projects/wp10/worktrees/delete", payload: {} });
    expect(r.statusCode).toBe(400);
  });
});
```

- [x] **Step 4: Jalankan test — harus GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/worktrees.route.test.ts
```

Expected: FAIL — seluruh request 404 (route belum ada).

- [x] **Step 5: Tambahkan `deleteWorktrees` ke `worktree-list.ts`**

```ts
// SPEC-861 · ADR-0132 · orkestrasi penghapusan. Deps disuntik supaya modul ini tetap murni: tutup
// sesi (tmux+DB), lepas worktree (fs), prune (git), hapus branch (branch-cleanup) semuanya masuk
// dari routes/ide.ts, yang memang sudah boleh menyentuh DB & tmux.
export type WorktreeDeleteDeps = {
  /** `services/session-close.ts` — SATU definisi penutupan sesi. */
  closeSession: (sessionId: string) => Promise<{ cleanup: string | null } | null>;
  /** `worktree-reaper.releaseWorktree` — `rename` ke `.trash`, byte-nya milik penyapu (SPEC-742). */
  release: (repoDir: string, path: string) => string | null;
  prune: (repoDir: string) => Promise<void>;
  /** `branch-cleanup.deleteBranches` BESERTA pagar kuncinya — jangan tulis jalur kedua. */
  deleteBranch: (repoDir: string, name: string) => Promise<{ ok: boolean; error?: string }>;
};

export async function deleteWorktrees(
  repoDir: string,
  names: string[],
  opts: { deleteBranch?: boolean } & WorktreeInputs & WorktreeDeleteDeps,
): Promise<{ results: WorktreeDeleteResult[] }> {
  // Turunkan ulang daftarnya SENDIRI lalu validasi tiap nama terhadap daftar itu: klien tak pernah
  // mengirim path, dan gerbang `deletable` ditegakkan di jalur TULIS — bukan sekadar petunjuk UI
  // (cermin pagar per-branch ADR-0077).
  const report = await listWorktrees(repoDir, opts);
  const byName = new Map(report.worktrees.map((w) => [w.name, w]));
  const results: WorktreeDeleteResult[] = [];
  for (const name of names) {
    const w = byName.get(name);
    if (!w) { results.push({ name, ok: false, cleanup: null, error: "worktree tak ditemukan" }); continue; }
    if (!w.deletable) {
      results.push({ name, ok: false, cleanup: null, error: `tak bisa dihapus: ${w.blocked}` });
      continue;
    }
    const row: WorktreeDeleteResult = { name, ok: true, cleanup: null };
    try {
      // Sesi hidup ditutup lewat jalur penutupan sesi yang SUDAH ADA — bukan mencabut direktori
      // dari bawah proses yang masih jalan. Jalur itu juga yang memajukan stage & mencatat headSha
      // selagi worktree-nya masih di tempatnya.
      if (w.session) {
        const closed = await opts.closeSession(w.session.id);
        row.closedSession = w.session.id;
        row.cleanup = closed?.cleanup ?? null;
      }
      if (!row.cleanup) row.cleanup = opts.release(report.repoDir, w.path);
      // Registrasi harus lenyap SEKARANG: bersamanya lepas pula kunci `BranchLock: "worktree"`
      // di tab Branches — itulah yang membuka kebuntuan yang jadi alasan SPEC-861 ada.
      await opts.prune(report.repoDir);
      if (opts.deleteBranch && w.branch) {
        const b = await opts.deleteBranch(report.repoDir, w.branch);
        row.branch = { name: w.branch, ok: b.ok, ...(b.error ? { error: b.error } : {}) };
      }
    } catch (e) {
      row.ok = false;
      row.error = (e as Error).message;
    }
    results.push(row);
  }
  return { results };
}
```

Tambahkan `WorktreeDeleteResult` ke `import type { … } from "@hanoman/shared"`.

- [x] **Step 6: Tambahkan tiga route di `server/src/routes/ide.ts`**

Impor:

```ts
import { listWorktrees, worktreeStats, deleteWorktrees, type WorktreeInputs } from "../services/worktree-list";
import { closeSession } from "../services/session-close";
import { releaseWorktree } from "../services/worktree-reaper";
import { sessionIdForSpec } from "../services/session-id";
```

Helper di dekat `lockInputs()` yang sudah ada (blok yang sama: "dikumpulkan di route yang boleh menyentuh DB & tmux, lalu diserahkan ke service"):

```ts
// SPEC-861 · ADR-0132 · sinyal NON-git sebuah worktree. Kunci `specs` adalah id sesi yang
// deterministik dari id spec (ADR-0015) — sama dengan `basename` worktree-nya; kunci `sessions`
// adalah cwd yang sudah dinormalkan.
async function worktreeInputs(id: string): Promise<WorktreeInputs> {
  const specs = await prisma.spec.findMany({ where: { projectId: id }, select: { id: true, stage: true } });
  return {
    specs: new Map(specs.map((s) => [sessionIdForSpec(s.id), { id: s.id, stage: s.stage }])),
    sessions: new Map(listSessions()
      .filter((s) => s.projectId === id && !s.exited)
      .map((s) => [resolve(s.cwd), { id: s.id, specId: s.specId ?? null }])),
  };
}
```

(tambahkan `import { basename, resolve } from "node:path";` — `basename` sudah ada.)

Route, tepat sesudah `POST /projects/:id/branches/delete`:

```ts
  // SPEC-861 · ADR-0132 · worktree yang masih HIDUP. Read murni turunan git (ADR-0018) —
  // tak digerbang sesi aktif, cermin /branches/unused.
  app.get("/projects/:id/worktrees", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return listWorktrees(repoDir, await worktreeInputs(id));
  });

  // SPEC-861 · sinyal MAHAL per baris (ukuran disk, isi kotor, commit yatim) — sengaja terpisah
  // supaya daftar tak menunggu `du`. `name` divalidasi terhadap daftar TURUNAN: klien tak pernah
  // mengirim path.
  app.get("/projects/:id/worktrees/stats", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const { name } = req.query as { name?: string };
    const report = await listWorktrees(repoDir, await worktreeInputs(id));
    const w = report.worktrees.find((x) => x.name === name);
    if (!w) return reply.code(404).send({ error: "not found" });
    return worktreeStats(report.repoDir, w);
  });

  // SPEC-861 · ADR-0132 · hapus batch. Operasi destruktif; diperlakukan seperti /branches/delete —
  // selalu 200 bila body sah, kegagalan hidup di baris `results`.
  app.post("/projects/:id/worktrees/delete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { names?: unknown; deleteBranch?: unknown };
    if (!Array.isArray(b?.names) || b.names.some((n) => typeof n !== "string" || !n))
      return reply.code(400).send({ error: "names wajib berisi nama worktree" });
    const locks = await lockInputs(id);
    return deleteWorktrees(repoDir, b.names as string[], {
      deleteBranch: b.deleteBranch === true,
      ...(await worktreeInputs(id)),
      closeSession,
      release: (repo, path) => releaseWorktree(repo, path, id),
      prune: async (repo) => { await runGitOp(repo, { op: "prune-worktrees" } as GitOp).catch(() => {}); },
      // Pagar kunci ADR-0077 ikut apa adanya — jangan tulis jalur kedua penghapusan branch.
      deleteBranch: async (repo, name) => {
        const r = await deleteBranches(repo, [name], { scope: "both", ...locks });
        const first = r.results[0];
        return { ok: !!first?.ok, ...(first?.error ? { error: first.error } : {}) };
      },
    });
  });
```

**Catatan `prune`:** `runGitOp` tak punya op `prune-worktrees`. Jangan menambahkannya — pakai `execFile` langsung di `routes/ide.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(execFile);
```

dan deps-nya:

```ts
      prune: async (repo) => {
        // Gagal-diam: registrasi basi bukan alasan menahan penghapusan (cermin prodReaperDeps).
        try { await execAsync("git", ["worktree", "prune"], { cwd: repo, timeout: 30_000 }); } catch { /* */ }
      },
```

- [x] **Step 7: Tambahkan capability**

Di `server/src/services/agent-capabilities.ts`, tambahkan ke `IDE_SUBS`:

```ts
  // SPEC-861 · ADR-0132 · daftar & hapus worktree hidup. `rw()` menurunkan read/write DARI METHOD,
  // jadi POST /worktrees/delete menuntut ide:write (hindari kelas bug SPEC-405).
  "worktrees",
```

- [x] **Step 8: Jalankan test — harus LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/worktrees.route.test.ts server/test/worktree-list.test.ts server/test/agent-capabilities.test.ts
```

Expected: PASS. (Bila `agent-capabilities.test.ts` tak ada, jalankan `server/test/agent-*.test.ts`.)

- [x] **Step 9: Typecheck + commit**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
git add shared/src/dto.ts shared/src/api.ts server/src/services/worktree-list.ts \
        server/src/services/agent-capabilities.ts server/src/routes/ide.ts server/test/worktrees.route.test.ts
git commit -m "feat(ide): endpoint daftar & hapus worktree + branch-nya (SPEC-861)"
```

---

### Task 5: Kaitan Branches → Worktrees (`UnusedBranch.worktree`)

**Files:**
- Modify: `server/src/services/branch-cleanup.ts:70-77` (`worktreeBranches`) dan `:20-27` (`UnusedBranch`)
- Test: `server/test/branch-cleanup.test.ts`

**Interfaces:**
- Produces: field **additif** `UnusedBranch.worktree?: string` — path worktree yang mengunci branch itu.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `describe("listUnusedBranches", …)` pada `server/test/branch-cleanup.test.ts`:

```ts
  // SPEC-861 · kebuntuan 'branch tak bisa dihapus karena worktree, worktree tak terlihat di mana
  // pun' butuh jalan keluar: baris branch harus menyebut worktree MANA yang menguncinya.
  it("kunci worktree menyebut path worktree yang menguncinya", async () => {
    const dir = mergedRepo("s9");
    mkdirSync(join(dir, ".worktrees"), { recursive: true });
    g(dir, "worktree", "add", "-q", join(dir, ".worktrees", "wt-s9"), "hanoman/s9");
    const r = await listUnusedBranches(dir, NONE);
    const b = r.branches.find((x) => x.name === "hanoman/s9")!;
    expect(b.locks).toContain("worktree");
    expect(b.worktree).toBe(join(dir, ".worktrees", "wt-s9"));
  });

  it("branch tanpa worktree tak punya field worktree", async () => {
    const r = await listUnusedBranches(mergedRepo("s10"), NONE);
    expect(r.branches.find((x) => x.name === "hanoman/s10")!.worktree).toBeUndefined();
  });
```

- [x] **Step 2: Jalankan test — harus GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/branch-cleanup.test.ts
```

Expected: FAIL — `expected undefined to be '…/wt-s9'`.

- [x] **Step 3: Implementasi**

Di `server/src/services/branch-cleanup.ts`:

```ts
export type UnusedBranch = {
  name: string;
  local: boolean;
  remote: boolean;
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];
  /** SPEC-861 · path worktree yang menahannya, ada hanya saat lock `worktree` menyala. */
  worktree?: string;
};
```

Ganti `worktreeBranches` (Set → Map, satu-satunya perubahan perilaku: path-nya ikut dibawa):

```ts
// Branch yang ter-checkout di worktree lain, BESERTA path worktree-nya (SPEC-861: baris branch
// harus bisa menunjuk worktree mana yang menguncinya). Sesi hanoman lahir --detach (ADR-0002) jadi
// seringnya TAK ada baris `branch` sama sekali — itulah alasan kunci `session` tetap perlu.
async function worktreeBranches(repoDir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  let path = "";
  for (const l of lines(await out(repoDir, ["worktree", "list", "--porcelain"]))) {
    if (l.startsWith("worktree ")) path = l.slice("worktree ".length);
    else if (l.startsWith("branch refs/heads/")) m.set(l.slice("branch refs/heads/".length), path);
  }
  return m;
}
```

Di badan `listUnusedBranches`, ganti pemakaian `wt`:

```ts
    if (wt.has(name)) locks.push("worktree");
    …
    return { name, local: locals.has(name), remote: remotes.has(name),
      lastCommit: meta.get(name) ?? null, locks,
      ...(wt.get(name) ? { worktree: wt.get(name)! } : {}) };
```

- [x] **Step 4: Jalankan test — harus LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/branch-cleanup.test.ts server/test/ide.route.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/branch-cleanup.ts server/test/branch-cleanup.test.ts
git commit -m "feat(branches): baris branch menyebut worktree yang menguncinya (SPEC-861)"
```

---

### Task 6: Klien API + `WorktreesPanel.tsx`

**Files:**
- Modify: `src/src/api/client.ts` (tipe cermin di dekat `UnusedBranch`, method di dekat `deleteBranches`)
- Create: `src/src/screens/WorktreesPanel.tsx`
- Test: `src/test/worktrees-panel.test.tsx`

**Interfaces:**
- Consumes: `paths.worktrees`, `paths.worktreeStats`, `paths.worktreesDelete` (Task 4).
- Produces:
  - `api.worktrees(id)`, `api.worktreeStats(id, name)`, `api.deleteWorktrees(id, { names, deleteBranch })`
  - `<WorktreesPanel projectId focus onOpenBranch />`

- [x] **Step 1: Tambahkan tipe + method di `src/src/api/client.ts`**

Tepat sesudah `LOCK_LABEL`:

```ts
// SPEC-861 · ADR-0132 · cermin server/src/services/worktree-list.ts + shared/src/dto.ts.
export type WorktreeView = {
  path: string; name: string; head: string; branch: string | null;
  prunable: boolean; locked: boolean; deletable: boolean; blocked: string | null;
  spec: { id: string; stage: string } | null;
  session: { id: string; specId: string | null } | null;
  createdAt: string | null;
};
export type WorktreeReport = { repoDir: string; worktrees: WorktreeView[] };
export type WorktreeStats = { name: string; sizeBytes: number | null; dirtyFiles: number; orphanCommits: number };
export type WorktreeDeleteResult = {
  name: string; ok: boolean; cleanup: string | null; closedSession?: string;
  branch?: { name: string; ok: boolean; error?: string }; error?: string;
};
```

Tambahkan `worktree?: string;` ke `UnusedBranch` di berkas yang sama.

Method, tepat sesudah `deleteBranches`:

```ts
  worktrees: (id: string) => j<WorktreeReport>(paths.worktrees(id)),
  worktreeStats: (id: string, name: string) => j<WorktreeStats>(paths.worktreeStats(id, name)),
  deleteWorktrees: (id: string, b: { names: string[]; deleteBranch?: boolean }) =>
    j<{ results: WorktreeDeleteResult[] }>(paths.worktreesDelete(id), { method: "POST", body: JSON.stringify(b) }),
```

- [x] **Step 2: Tulis test yang gagal**

Buat `src/test/worktrees-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { WorktreesPanel } from "../src/screens/WorktreesPanel";
import { api, type WorktreeReport } from "../src/api/client";

const report = (): WorktreeReport => ({
  repoDir: "/repo",
  worktrees: [
    { path: "/repo", name: "repo", head: "aaa1111", branch: "main", prunable: false, locked: false,
      deletable: false, blocked: "checkout project", spec: null, session: null, createdAt: "2026-07-01T10:00:00Z" },
    { path: "/repo/.worktrees/spec-1", name: "spec-1", head: "bbb2222", branch: null, prunable: false,
      locked: false, deletable: true, blocked: null, spec: { id: "SPEC-1", stage: "executing" },
      session: { id: "spec-1", specId: "SPEC-1" }, createdAt: "2026-08-01T10:00:00Z" },
    { path: "/repo/.worktrees/wt-b", name: "wt-b", head: "ccc3333", branch: "topik", prunable: false,
      locked: false, deletable: true, blocked: null, spec: null, session: null, createdAt: "2026-08-02T10:00:00Z" },
  ],
});
// `Checkbox` design system BUKAN <input type=checkbox>: onClick hidup di <span> anak, bukan label.
const pick = (id: string) => fireEvent.click(screen.getByTestId(id).firstElementChild!);
const confirm = async () => fireEvent.click(await screen.findByRole("button", { name: /ya, hapus/i }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "worktrees").mockResolvedValue(report());
  vi.spyOn(api, "worktreeStats").mockImplementation(async (_id, name) =>
    ({ name, sizeBytes: 4 * 1024 * 1024, dirtyFiles: 2, orphanCommits: 3 }));
});

describe("WorktreesPanel", () => {
  it("menampilkan tiap worktree hidup + backlog & stage-nya", async () => {
    render(<WorktreesPanel projectId="p1" />);
    expect(await screen.findByText("spec-1")).toBeInTheDocument();
    expect(screen.getByText(/SPEC-1/)).toBeInTheDocument();
    expect(screen.getByText(/executing/)).toBeInTheDocument();
  });

  it("HEAD detached tampil sebagai SHA, bukan nama branch", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("spec-1");
    expect(screen.getByText(/bbb2222/)).toBeInTheDocument();
    expect(screen.getByText("topik")).toBeInTheDocument();
  });

  it("checkout project tampil tapi tak bisa dipilih", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("repo");
    expect(screen.getByText(/checkout project/i)).toBeInTheDocument();
    pick("pick-repo");
    expect(screen.getByTestId("bulk-delete")).toBeDisabled();
  });

  it("ukuran & isi kotor dimuat menyusul per baris", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("spec-1");
    await waitFor(() => expect(api.worktreeStats).toHaveBeenCalledWith("p1", "spec-1"));
    expect(await screen.findByText(/4(\.0)? MB/)).toBeInTheDocument();
  });

  it("dialog konfirmasi menyebut apa yang akan hilang", async () => {
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("spec-1");
    fireEvent.click(screen.getByTestId("row-delete-spec-1"));
    expect(await screen.findByText(/1 sesi aktif akan ditutup/i)).toBeInTheDocument();
    expect(screen.getByText(/3 commit/i)).toBeInTheDocument();
    expect(screen.getByText(/2 berkas belum tersimpan/i)).toBeInTheDocument();
  });

  it("hapus memanggil api dengan nama baris dan flag branch", async () => {
    const del = vi.spyOn(api, "deleteWorktrees").mockResolvedValue({
      results: [{ name: "wt-b", ok: true, cleanup: "wt-b.abc" }] });
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("wt-b");
    pick("with-branch");
    fireEvent.click(screen.getByTestId("row-delete-wt-b"));
    await confirm();
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", { names: ["wt-b"], deleteBranch: true }));
  });

  it("kegagalan hapus branch dilaporkan tanpa menyembunyikan keberhasilan worktree", async () => {
    vi.spyOn(api, "deleteWorktrees").mockResolvedValue({
      results: [{ name: "wt-b", ok: true, cleanup: "wt-b.abc",
        branch: { name: "topik", ok: false, error: "terkunci: backlog-nya belum selesai" } }] });
    render(<WorktreesPanel projectId="p1" />);
    await screen.findByText("wt-b");
    fireEvent.click(screen.getByTestId("row-delete-wt-b"));
    await confirm();
    expect(await screen.findByText(/backlog-nya belum selesai/)).toBeInTheDocument();
  });

  it("nama branch membawa ke tab Branches", async () => {
    const onOpenBranch = vi.fn();
    render(<WorktreesPanel projectId="p1" onOpenBranch={onOpenBranch} />);
    fireEvent.click(await screen.findByTestId("goto-branch-wt-b"));
    expect(onOpenBranch).toHaveBeenCalledWith("topik");
  });
});
```

- [x] **Step 3: Jalankan test — harus GAGAL**

```bash
pnpm vitest --run src/test/worktrees-panel.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/screens/WorktreesPanel"`.

- [x] **Step 4: Tulis `src/src/screens/WorktreesPanel.tsx`**

```tsx
/* SPEC-861 · ADR-0132 — panel worktree hidup: satu baris per worktree terdaftar di git, dengan
   hapus per baris + bulk yang ikut menutup sesinya dan (opsional) menghapus branch-nya. Seluruh
   data turunan git dari server — tak ada state persist selain preferensi 'hapus branch juga'.
   Pola BranchesPanel.tsx (badge alasan, seleksi multi-baris). */
import React from "react";
import { Card, Button, Badge, Checkbox, StateBlock, useConfirm } from "../ds";
import { usePersistedState, scoped } from "../ui-state/hooks";
import { api, type WorktreeReport, type WorktreeView, type WorktreeStats, type WorktreeDeleteResult } from "../api/client";

const rel = (iso: string | null): string => {
  const t = iso ? new Date(iso).getTime() : 0;
  if (!t) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}j`;
  if (s < 2592000) return `${Math.floor(s / 86400)}h`;
  return new Date(iso!).toLocaleDateString();
};

const size = (b: number | null): string => {
  if (b === null) return "—";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

export function WorktreesPanel({ projectId, focus, onOpenBranch }: {
  projectId: string; focus?: string; onOpenBranch?: (branch: string) => void;
}) {
  const ui = scoped("worktrees", projectId);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [report, setReport] = React.useState<WorktreeReport | null>(null);
  const [stats, setStats] = React.useState<Record<string, WorktreeStats>>({});
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [withBranch, setWithBranch] = usePersistedState(ui, "withBranch", false, (v): v is boolean => typeof v === "boolean");
  const [results, setResults] = React.useState<WorktreeDeleteResult[] | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = React.useCallback(() => {
    setState("loading");
    api.worktrees(projectId)
      .then((r) => { setReport(r); setPicked(new Set()); setStats({}); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId]);
  React.useEffect(() => { load(); }, [load]);

  // Sinyal mahal dimuat MENYUSUL, satu per baris dan berurutan: `du` menelusuri seluruh pohon, dan
  // membombardir server dengan N sekaligus membuat daftar yang sudah terender jadi ikut tersendat.
  React.useEffect(() => {
    if (!report) return;
    let alive = true;
    void (async () => {
      for (const w of report.worktrees) {
        if (!alive) return;
        const s = await api.worktreeStats(projectId, w.name).catch(() => null);
        if (alive && s) setStats((prev) => ({ ...prev, [w.name]: s }));
      }
    })();
    return () => { alive = false; };
  }, [report, projectId]);

  const rows = report?.worktrees ?? [];
  const free = React.useMemo(() => rows.filter((w) => w.deletable).map((w) => w.name), [rows]);
  const allPicked = free.length > 0 && free.every((n) => picked.has(n));
  const toggle = (name: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const pickedNames = rows.filter((w) => picked.has(w.name)).map((w) => w.name);
  const anyBranch = rows.some((w) => w.deletable && w.branch);

  // Dialog yang tak bisa menyebut angkanya bukan konfirmasi: bila stats sebuah baris belum termuat,
  // tunggu satu fetch dulu (ADR-0127 — `run` menahan dialog & submit ganda selama mutasi berjalan).
  const ask = async (names: string[]) => {
    const target = rows.filter((w) => names.includes(w.name));
    const missing = target.filter((w) => !stats[w.name]);
    for (const w of missing) {
      const s = await api.worktreeStats(projectId, w.name).catch(() => null);
      if (s) setStats((prev) => ({ ...prev, [w.name]: s }));
    }
    const got = (n: string) => stats[n] ?? missing.find((m) => m.name === n) && undefined;
    const sessions = target.filter((w) => w.session).length;
    const dirty = target.reduce((n, w) => n + (stats[w.name]?.dirtyFiles ?? 0), 0);
    const orphan = target.reduce((n, w) => n + (stats[w.name]?.orphanCommits ?? 0), 0);
    const branches = target.filter((w) => w.branch).map((w) => w.branch!);
    const impact: React.ReactNode[] = [];
    if (sessions) impact.push(`${sessions} sesi aktif akan ditutup lebih dulu`);
    if (orphan) impact.push(`${orphan} commit tak ada di tempat lain — hilang`);
    if (dirty) impact.push(`${dirty} berkas belum tersimpan`);
    if (withBranch && branches.length) impact.push(`branch ikut dihapus: ${branches.join(", ")}`);
    if (!impact.length) impact.push("tak ada kerja yang belum tersimpan di sini");
    void got;
    const ok = await confirm({
      eyebrow: "worktree", title: `Hapus ${names.length} worktree?`, confirmLabel: "Ya, hapus",
      message: "Direktorinya dipindah ke `.worktrees/.trash/` dan dihapus di latar.",
      impact,
      run: async () => {
        const r = await api.deleteWorktrees(projectId, { names, ...(withBranch ? { deleteBranch: true } : {}) });
        setResults(r.results);
        load();
      },
    }).catch((e: Error) => {
      setResults(names.map((n) => ({ name: n, ok: false, cleanup: null, error: e.message })));
      return false;
    });
    void ok;
  };

  const failed = (results ?? []).filter((r) => !r.ok);
  const branchFailed = (results ?? []).filter((r) => r.branch && !r.branch.ok);

  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        <span className="hn-eyebrow" style={{ flex: 1 }}>worktree hidup</span>
        {anyBranch && (
          <Checkbox data-testid="with-branch" checked={withBranch}
            onChange={() => setWithBranch(!withBranch)} label="Hapus branch-nya juga" />
        )}
        <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={load}>Muat ulang</Button>
        <Button size="sm" variant="primary" leftIcon="trash-2" data-testid="bulk-delete"
          disabled={pickedNames.length === 0} onClick={() => void ask(pickedNames)}>
          Hapus terpilih ({pickedNames.length})
        </Button>
      </div>

      {results && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)", fontSize: 12.5 }}>
          <div style={{ color: "var(--text-strong)" }}>
            {results.length - failed.length} terhapus · {failed.length} gagal
          </div>
          {[...failed, ...branchFailed].map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {f.name} — {f.error ?? f.branch?.error ?? "gagal"}
            </div>
          ))}
        </div>
      )}

      {state === "loading" ? <StateBlock kind="loading" title="Memuat worktree…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat worktree" action={load} />
        : rows.length === 0 ? <StateBlock kind="empty" icon="folder-git-2" title="Tak ada worktree"
            hint="Project ini belum punya checkout lokal, atau git tak bisa dibaca." />
        : (
          <div style={{ maxHeight: 620, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
              borderBottom: "1px solid var(--border-hair)" }}>
              <Checkbox data-testid="pick-all" checked={allPicked} disabled={free.length === 0}
                onChange={() => setPicked(allPicked ? new Set<string>() : new Set(free))}
                label={`Pilih semua yang boleh (${free.length})`} />
            </div>
            {rows.map((w) => (
              <div key={w.name} data-testid={`row-${w.name}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                  borderBottom: "1px solid var(--border-hair)",
                  background: focus === w.name ? "var(--surface-raised)" : undefined }}>
                <Checkbox data-testid={`pick-${w.name}`} checked={picked.has(w.name)}
                  disabled={!w.deletable} onChange={() => toggle(w.name)} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1 }}>
                  {w.name}
                </span>
                {w.branch
                  ? <button data-testid={`goto-branch-${w.name}`} onClick={() => onOpenBranch?.(w.branch!)}
                      style={{ background: "none", border: 0, padding: 0, cursor: "pointer",
                        fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--brass)" }}>{w.branch}</button>
                  : <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>
                      {w.head.slice(0, 7) || "—"}
                    </span>}
                {!w.branch && <Badge size="sm" tone="brass">detached</Badge>}
                {w.spec && <Badge size="sm" tone="brass">{w.spec.id} · {w.spec.stage}</Badge>}
                {w.session && <Badge size="sm" tone="warn">sesi aktif</Badge>}
                {w.prunable && <Badge size="sm" tone="warn">prunable</Badge>}
                {w.locked && <Badge size="sm" tone="warn">terkunci git</Badge>}
                {w.blocked && <Badge size="sm" tone="warn">{w.blocked}</Badge>}
                {!!stats[w.name]?.dirtyFiles && <Badge size="sm" tone="warn">{stats[w.name]!.dirtyFiles} kotor</Badge>}
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 150, textAlign: "right" }}>
                  {stats[w.name] ? size(stats[w.name]!.sizeBytes) : "…"} · {rel(w.createdAt)}
                </span>
                <Button size="sm" variant="ghost" leftIcon="trash-2" data-testid={`row-delete-${w.name}`}
                  disabled={!w.deletable} onClick={() => void ask([w.name])}>Hapus</Button>
              </div>
            ))}
          </div>
        )}
      {dialog}
    </Card>
  );
}
```

- [x] **Step 5: Jalankan test — harus LULUS**

```bash
pnpm vitest --run src/test/worktrees-panel.test.tsx
```

Expected: PASS, 8 test. Bila `usePersistedState`/`scoped` diimpor dari jalur yang salah, samakan dengan baris impor di `src/src/screens/IdeScreen.tsx`.

- [x] **Step 6: Typecheck + commit**

```bash
pnpm --filter ./src typecheck
git add src/src/api/client.ts src/src/screens/WorktreesPanel.tsx src/test/worktrees-panel.test.tsx
git commit -m "feat(ide): panel Worktrees + klien API (SPEC-861)"
```

---

### Task 7: Tab keempat di IDE + tautan dua arah

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx:78` (state), `:318-321` (Tabs), `:480-487` (render)
- Modify: `src/src/screens/BranchesPanel.tsx:26` (props), `:130` (badge kunci)
- Test: `src/test/branches-panel.test.tsx`, `src/test/ide-worktrees-tab.test.tsx`

**Interfaces:**
- Consumes: `<WorktreesPanel projectId focus onOpenBranch />` (Task 6); `UnusedBranch.worktree` (Task 5).
- Produces: `<BranchesPanel projectId onOpenWorktree?: (path: string) => void />`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/branches-panel.test.tsx` (dan tambahkan `worktree: "/repo/.worktrees/wt-b"` + `locks: ["worktree"]` pada satu baris di `report()`; tambahkan baris baru agar test lama tak berubah):

```tsx
  it("badge kunci worktree menautkan ke barisnya di tab Worktrees", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({
      branches: [{ name: "hanoman/spec-4", local: true, remote: false, lastCommit: null,
        locks: ["worktree"], worktree: "/repo/.worktrees/wt-b" }],
    }));
    const onOpenWorktree = vi.fn();
    render(<BranchesPanel projectId="p1" onOpenWorktree={onOpenWorktree} />);
    fireEvent.click(await screen.findByTestId("goto-worktree-hanoman/spec-4"));
    expect(onOpenWorktree).toHaveBeenCalledWith("/repo/.worktrees/wt-b");
  });
```

Buat `src/test/ide-worktrees-tab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "P1", repoDir: "/repo" } as any];

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main"], remotes: [] });
  vi.spyOn(api, "ideTree").mockResolvedValue({ files: [] } as any);
  vi.spyOn(api, "workingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] } as any);
  vi.spyOn(api, "branchesUnused").mockResolvedValue({
    base: "main", baseRemote: null, current: "main",
    branches: [{ name: "hanoman/spec-1", local: true, remote: false, lastCommit: null,
      locks: ["worktree"], worktree: "/repo/.worktrees/spec-1" }],
  });
  vi.spyOn(api, "worktrees").mockResolvedValue({
    repoDir: "/repo",
    worktrees: [{ path: "/repo/.worktrees/spec-1", name: "spec-1", head: "bbb2222", branch: null,
      prunable: false, locked: false, deletable: true, blocked: null,
      spec: null, session: null, createdAt: "2026-08-01T10:00:00Z" }],
  });
  vi.spyOn(api, "worktreeStats").mockResolvedValue(
    { name: "spec-1", sizeBytes: 1024, dirtyFiles: 0, orphanCommits: 0 });
});

describe("IdeScreen · tab Worktrees", () => {
  it("tab Worktrees ada dan merender panelnya", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: /worktrees/i }));
    expect(await screen.findByText("spec-1")).toBeInTheDocument();
  });

  // Kebuntuan 'branch tak bisa dihapus karena worktree, worktree tak terlihat di mana pun'.
  it("dari tab Branches, badge worktree memindahkan ke baris Worktrees-nya", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: /branches/i }));
    fireEvent.click(await screen.findByTestId("goto-worktree-hanoman/spec-1"));
    await waitFor(() => expect(screen.getByTestId("row-spec-1")).toBeInTheDocument());
  });
});
```

- [x] **Step 2: Jalankan test — harus GAGAL**

```bash
pnpm vitest --run src/test/ide-worktrees-tab.test.tsx src/test/branches-panel.test.tsx
```

Expected: FAIL — tab tak ada / `goto-worktree-…` tak ditemukan.

- [x] **Step 3: `BranchesPanel` — badge kunci jadi tautan**

Ubah signature dan render badge kunci:

```tsx
export function BranchesPanel({ projectId, onOpenWorktree }: {
  projectId: string; onOpenWorktree?: (path: string) => void;
}) {
```

```tsx
                {b.locks.map((l) =>
                  l === "worktree" && b.worktree && onOpenWorktree
                    ? <button key={l} data-testid={`goto-worktree-${b.name}`}
                        onClick={() => onOpenWorktree(b.worktree!)}
                        style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                        <Badge size="sm" tone="warn">{LOCK_LABEL[l]} →</Badge>
                      </button>
                    : <Badge key={l} size="sm" tone="warn">{LOCK_LABEL[l]}</Badge>)}
```

- [x] **Step 4: `IdeScreen` — tab keempat + jembatan dua arah**

```tsx
import { WorktreesPanel } from "./WorktreesPanel";
```

State (di dekat `tab`):

```tsx
  // SPEC-861 · baris Worktrees yang di-fokus saat datang dari badge kunci di tab Branches.
  // SENGAJA tak persisten: sebuah worktree bisa lenyap di antara kunjungan.
  const [wtFocus, setWtFocus] = React.useState("");
```

Tabs:

```tsx
        <Tabs tabs={[{ value: "explorer", label: "Explorer" }, { value: "graph", label: "Git Graph" },
          { value: "branches", label: "Branches" }, { value: "worktrees", label: "Worktrees" }]}
          value={tab} onChange={setTab} />
```

Render — ganti cabang terakhir:

```tsx
      ) : tab === "branches" ? (
        /* SPEC-360 · ADR-0077 · bersihkan branch yang sudah ter-merge ke branch utamanya. */
        <BranchesPanel projectId={projectId}
          onOpenWorktree={(path) => { setWtFocus(path.split("/").pop() ?? ""); setTab("worktrees"); }} />
      ) : (
        /* SPEC-861 · ADR-0132 · worktree yang masih hidup + hapus worktree & branch-nya sekaligus. */
        <WorktreesPanel projectId={projectId} focus={wtFocus}
          onOpenBranch={() => setTab("branches")} />
      )}
```

- [x] **Step 5: Jalankan test — harus LULUS**

```bash
pnpm vitest --run src/test/ide-worktrees-tab.test.tsx src/test/branches-panel.test.tsx src/test/worktrees-panel.test.tsx
```

Expected: PASS.

- [x] **Step 6: Typecheck + commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/IdeScreen.tsx src/src/screens/BranchesPanel.tsx \
        src/test/ide-worktrees-tab.test.tsx src/test/branches-panel.test.tsx
git commit -m "feat(ide): tab Worktrees + tautan dua arah dengan tab Branches (SPEC-861)"
```

---

### Task 8: Docs Source of Truth + smoke endpoint nyata

**Files:**
- Create: `internal/docs/adr/0132-permukaan-penghapusan-worktree.md`
- Modify: `internal/docs/README.md`, `internal/docs/architecture/api-contract.md`, `internal/skills/hanoman/SKILL.md`

- [x] **Step 1: Pastikan nomor ADR masih bebas**

```bash
ls internal/docs/adr/ | grep -c '^0132' || true
```

Expected: `0`. Bila sudah terpakai (sesi lain menomori duluan — lihat memori "ADR/SPEC number collisions"), pakai nomor bebas berikutnya dan ganti seluruh rujukan `ADR-0132` di kode & docs.

- [x] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0132-permukaan-penghapusan-worktree.md` mengikuti bentuk ADR yang sudah ada (`0116-penutupan-sesi-asinkron-worktree-trash.md` sebagai contoh terdekat). Isi yang WAJIB ada:

- **Konteks:** worktree hidup tak terdaftar di mana pun; `WorktreeCleanupView` hanya membaca `.trash`; kebuntuan `BranchLock: "worktree"` ↔ worktree tak terlihat.
- **Keputusan:** tab Worktrees + tiga endpoint di bawah capability `ide`; daftar turunan penuh tanpa DB/cache; `.trash` dikecualikan; `ownsWorktree` satu-satunya gerbang; penghapusan lewat `rename` ke `.trash` (SPEC-742) sehingga event loop tak terblokir; branch lewat `deleteBranches` **beserta pagar ADR-0077**; sesi hidup ditutup lewat `closeSession` yang kini satu definisi.
- **Konsekuensi:** tak ada baris worktree yang terkunci permanen, tetapi penghapusan **branch** tetap bisa gagal dan alasannya dilaporkan per baris; menghapus worktree melepas kunci `worktree` sehingga branch-nya bisa dibersihkan dari tab Branches.
- **Yang TIDAK berubah:** domain reaper tetap `.trash/**`; `DELETE /terminal/sessions/:id` berperilaku identik; tak ada kolom DB baru.
- **Gotcha terukur:** pola `--exclude` `rev-list` relatif terhadap `refs/heads/` (`feat`, bukan `refs/heads/feat`) dan di-reset sesudah tiap `--branches`/`--remotes`/`--tags`; kasus dogfood (project ter-bind ke checkout di bawah `.worktrees/`) membuat seluruh baris `deletable:false` — itu benar dan disengaja.

- [x] **Step 3: Tautkan di index**

Di `internal/docs/README.md`, tambahkan pada daftar ADR (di atas baris `0131`):

```markdown
- [0132 — Permukaan penghapusan worktree: tab Worktrees, daftar turunan git, hapus lewat `.trash`](adr/0132-permukaan-penghapusan-worktree.md)
```

- [x] **Step 4: Kontrak API**

Di `internal/docs/architecture/api-contract.md`, tepat sesudah blok `/projects/:id/branches/*`, tambahkan ketiga endpoint dengan bentuk request/response-nya (`WorktreeReport`, `WorktreeStats`, `{ names, deleteBranch? }` → `{ results: WorktreeDeleteResult[] }`), capability `ide:read`/`ide:write`, dan catatan "selalu 200 bila body sah".

- [x] **Step 5: Skill project**

Di `internal/skills/hanoman/SKILL.md`, tambahkan satu butir di "Aturan Arsitektur" tepat sesudah butir SPEC-360/ADR-0077, ringkas (3–6 kalimat) dengan pola yang sama: keputusan, gerbang `ownsWorktree`, `.trash` dikecualikan, pagar branch tetap ADR-0077, dan gotcha `--exclude`.

- [x] **Step 6: Cek integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli build && node cli/dist/index.js docs index --check
```

Expected: index konsisten (atau perbaiki dengan `docs index --fix`).

- [x] **Step 7: Smoke endpoint nyata (sekali, di akhir)**

```bash
pnpm --filter ./server build
HANOMAN_HOME="$(mktemp -d)" DATABASE_URL="file:$(mktemp -d)/smoke.db" \
  node server/dist/server.js &
SRV=$!
# tunggu port siap, lalu:
curl -s localhost:3001/api/projects/<id-project-nyata>/worktrees | head -40
curl -s -X POST localhost:3001/api/projects/<id>/worktrees/delete \
  -H 'content-type: application/json' -d '{"names":["tidak-ada"]}'
kill $SRV     # per-PID, JANGAN pkill -f
```

Expected: GET → `{ repoDir, worktrees: [...] }`; POST → 200 dengan `results[0].ok === false`.

- [x] **Step 8: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: PASS. Pastikan test-nya memang BERJALAN — `--changed` menyalakan `passWithNoTests`, jadi "no test files" bukan bukti.

- [x] **Step 9: Commit**

```bash
git add internal/docs/adr/0132-permukaan-penghapusan-worktree.md internal/docs/README.md \
        internal/docs/architecture/api-contract.md internal/skills/hanoman/SKILL.md
git commit -m "docs(adr): 0132 permukaan penghapusan worktree (SPEC-861)"
```

---

## Self-review

**Cakupan spec → task:**

| Butir objective | Task |
| --- | --- |
| 1. Daftar worktree hidup (path, branch/SHA detached, backlog+stage, ukuran, kotor, umur, sesi tmux) | 1, 2 |
| `.trash` dikecualikan | 1 |
| 2. `POST …/worktrees/delete` + prune + hapus branch lewat `deleteBranches` | 4 |
| 3. Tak ada baris terkunci permanen; konfirmasi `useConfirm` menyebut kerugian; sesi ditutup lewat jalur yang ada | 3, 4, 6 |
| 4. Tak memblokir event loop — `rename` ke `.trash`, reaper yang menghapus | 4 |
| 5. Kaitan dua arah dengan tab Branches | 5, 7 |
| Capability domain `ide` | 4 |
| Test wajib (parsing, pemetaan SPEC, pagar repoDir, hapus-dengan-branch) | 1, 4 |
| Docs + ADR baru dalam commit yang sama | 8 |

**Konsistensi tipe:** `WorktreeView` / `WorktreeReport` / `WorktreeStats` / `WorktreeDeleteResult` dideklarasikan satu kali di `shared/src/dto.ts` (Task 1 & 4) dan dicerminkan apa adanya di `src/src/api/client.ts` (Task 6). `WorktreeInputs` dipakai identik di Task 1, 2, 4. `closeSession` bersignature sama di Task 3 (definisi), Task 4 (deps `closeSession`), dan `routes/terminal.ts`.
