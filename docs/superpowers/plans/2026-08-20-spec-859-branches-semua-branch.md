# SPEC-859 — IDE → Branches: tampilkan semua branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab Branches di IDE menampilkan SELURUH branch project (local + origin), ter-merge maupun belum, dengan filter status, dan hapus branch belum-ter-merge dipagari konfirmasi risiko tersendiri.

**Architecture:** Perluasan **aditif** pada satu service turunan-git yang sudah ada (`server/src/services/branch-cleanup.ts`) — bukan endpoint kedua: `GET /projects/:id/branches/unused` mendapat `?include=all` dan tiap baris mendapat tiga field merged (`merged`, `mergedLocal`, `mergedRemote`); `POST /projects/:id/branches/delete` mendapat `allowUnmerged?: boolean` yang satu-satunya membuka `git branch -D` pada sisi lokal yang belum ter-merge. Frontend memuat `include=all` sekali lalu menyaring di klien (status + cari + batas render), sehingga "yang sedang tampak" persis sama dengan yang bisa dipilih.

**Tech Stack:** Node + TypeScript (Fastify) · vitest · React + TypeScript (Vite) · Testing Library · komponen `ds` (Card/Button/Badge/Select/Input/Checkbox/StateBlock/ConfirmDialog).

## Global Constraints

- Read tetap **turunan git murni** (ADR-0018) — tak ada kolom DB, tak ada migration, tak ada cache, tak digerbang sesi aktif.
- Hapus tetap **ref-only per-branch** (ADR-0055) lewat `runGitOp` `delete-branch` — satu-satunya jalur hapus branch di codebase.
- **Lima kunci proteksi** (`current`/`base`/`worktree`/`spec-open`/`session`) ditegakkan ulang di jalur tulis dan **tidak dilonggarkan**; `allowUnmerged` tak pernah menang atas kunci.
- `git branch -D` **hanya** untuk sisi lokal branch belum-ter-merge yang diminta lewat `allowUnmerged: true`. Sisi origin (`git push origin --delete`) tak pernah butuh flag.
- Kontrak lama tak boleh pecah: **tanpa** `?include=`, himpunan baris `GET /branches/unused` tetap "hanya yang ter-merge"; **tanpa** `allowUnmerged`, `POST /branches/delete` berperilaku persis seperti sekarang.
- `base` **tak pernah** di-hardcode `"main"` (SPEC-227) dan selalu di-resolve ke SHA sebelum diberikan ke `--merged` (`--end-of-options` tak berlaku di sana).
- Urutan daftar **deterministik dari server** (urut nama).
- Frontend mengikuti design system `internal/docs/design-system/**` dan komponen `ds` yang sudah dipakai panel ini.
- Test frontend WAJIB mengklik `getByTestId(id).firstElementChild` untuk `Checkbox` (label bukan pembawa onClick) dan `role: "tab"` untuk `Tabs`.
- Perintah test: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>`.

---

### Task 1: Server — daftar branch penuh + flag merged per sisi

**Files:**
- Modify: `server/src/services/branch-cleanup.ts`
- Test: `server/test/branch-cleanup.test.ts`

**Interfaces:**
- Consumes: `runGitOp` dari `./git-ide` (sudah ada), `LockInputs` (sudah ada).
- Produces:
  ```ts
  export type BranchInclude = "merged" | "all";
  export type UnusedBranch = {
    name: string; local: boolean; remote: boolean;
    merged: boolean; mergedLocal: boolean; mergedRemote: boolean;
    lastCommit: { sha: string; at: string; subject: string } | null;
    locks: BranchLock[];
  };
  export async function listUnusedBranches(
    repoDir: string | null,
    opts: { base?: string; include?: BranchInclude } & LockInputs,
  ): Promise<UnusedReport>;
  ```

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/branch-cleanup.test.ts`, di dalam `describe("listUnusedBranches", ...)`:

```ts
  it("include all memuat branch yang BELUM ter-merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("a1"); // hanoman/a1 tak di-merge
    const r = await listUnusedBranches(repoDir, { ...NONE, include: "all" });
    const b = r.branches.find((x) => x.name === "hanoman/a1")!;
    expect(b).toBeTruthy();
    expect(b.merged).toBe(false);
    expect(b.local).toBe(true);
  });

  it("include all tetap menyaring baris hantu & origin/HEAD", async () => {
    const dir = mergedRepo("a2");
    g(dir, "remote", "set-head", "origin", "main");
    g(dir, "checkout", "-q", "--detach", "HEAD");
    const r = await listUnusedBranches(dir, { ...NONE, include: "all" });
    for (const ghost of ["(no branch)", "origin", "origin/HEAD", "HEAD", ""])
      expect(r.branches.some((x) => x.name === ghost)).toBe(false);
  });

  it("default (tanpa include) tetap HANYA branch ter-merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("a3");
    const r = await listUnusedBranches(repoDir, NONE);
    expect(r.branches.some((x) => x.name === "hanoman/a3")).toBe(false);
  });

  it("merged benar per sisi: ter-merge local+origin", async () => {
    const r = await listUnusedBranches(mergedRepo("a4"), { ...NONE, include: "all" });
    const b = r.branches.find((x) => x.name === "hanoman/a4")!;
    expect(b).toMatchObject({ local: true, remote: true, mergedLocal: true, mergedRemote: true, merged: true });
  });

  it("branch lokal tanpa ref origin: remote false, merged menilai sisi lokal saja", async () => {
    const dir = mergedRepo("a5");
    g(dir, "branch", "lokal-baru"); // di commit main → ter-merge, tanpa ref origin
    const r = await listUnusedBranches(dir, { ...NONE, include: "all" });
    const b = r.branches.find((x) => x.name === "lokal-baru")!;
    expect(b).toMatchObject({ local: true, remote: false, mergedRemote: false, merged: true });
  });

  it("kunci tetap dihitung untuk branch belum ter-merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("a6");
    const r = await listUnusedBranches(repoDir, {
      ...NONE, include: "all", sessionBranches: new Set(["hanoman/a6"]) });
    expect(r.branches.find((x) => x.name === "hanoman/a6")!.locks).toContain("session");
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/branch-cleanup.test.ts -t "include all"`
Expected: FAIL — `include` bukan properti yang dikenal `opts` (typecheck), dan daftar tetap hanya memuat yang ter-merge.

- [x] **Step 3: Implementasi**

Di `server/src/services/branch-cleanup.ts`, tambahkan tipe `BranchInclude` dan ganti `UnusedBranch`:

```ts
export type BranchInclude = "merged" | "all";

export type UnusedBranch = {
  name: string;
  // SPEC-859 · `local`/`remote` = ref itu ADA (bukan "ref itu ter-merge"): badge scope di UI harus
  // jujur untuk branch yang belum ter-merge. Merged-ness hidup di tiga field di bawahnya.
  local: boolean;
  remote: boolean;
  mergedLocal: boolean;
  mergedRemote: boolean;
  // Ter-merge = TIAP sisi yang ada sudah ter-merge ke base-nya masing-masing. Repo yang
  // origin/<base>-nya tertinggal karena itu terbaca `belum`, bukan setengah-aman.
  merged: boolean;
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];
};
```

Ganti `lastCommits()` (dan `type CommitMeta` di atasnya) dengan indeks ref tunggal. `SEP` tetap
ditulis sebagai escape `\u001f` seperti sekarang — jangan pernah mengetik karakter mentahnya:

```ts
type CommitMeta = { sha: string; at: string; subject: string };
type RefIndex = { locals: Set<string>; remotes: Set<string>; meta: Map<string, CommitMeta> };

// Satu for-each-ref memasok himpunan ref DAN commit terakhir. `%(refname)` penuh dibaca lebih
// dulu karena `refname:short` sudah kehilangan info sisi mana ref itu hidup.
async function refIndex(repoDir: string): Promise<RefIndex> {
  const fmt = ["%(refname)", "%(refname:short)", "%(objectname)",
    "%(committerdate:iso-strict)", "%(contents:subject)"].join(SEP);
  const idx: RefIndex = { locals: new Set(), remotes: new Set(), meta: new Map() };
  for (const l of lines(await out(repoDir, ["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes/origin"]))) {
    const [full, ref, sha, at, ...rest] = l.split(SEP);
    const name = shortName(ref ?? "");
    if (!name || !sha) continue;
    (full?.startsWith("refs/heads/") ? idx.locals : idx.remotes).add(name);
    // refs/heads tersortir sebelum refs/remotes → meta lokal menang, sama seperti sebelum SPEC-859.
    if (!idx.meta.has(name)) idx.meta.set(name, { sha, at: at ?? "", subject: rest.join(SEP) });
  }
  return idx;
}
```

Ganti seluruh badan `listUnusedBranches`:

```ts
export async function listUnusedBranches(
  repoDir: string | null,
  opts: { base?: string; include?: BranchInclude } & LockInputs,
): Promise<UnusedReport> {
  if (!repoDir) return EMPTY;
  const current = (await out(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (!current) return EMPTY; // bukan repo git / belum punya commit
  const base = await resolveBase(repoDir, opts.base, current);
  const baseSha = await revSha(repoDir, base);
  if (!baseSha) return { ...EMPTY, current };
  // Untuk ref origin, "branch utama"-nya adalah origin/<base> — main lokal bisa tertinggal.
  const baseRemote = (await revSha(repoDir, `origin/${base}`)) ? `origin/${base}` : null;
  const baseRemoteSha = baseRemote ? await revSha(repoDir, baseRemote) : baseSha;

  const [localMerged, remoteMerged, wt, refs] = await Promise.all([
    out(repoDir, ["branch", "--merged", baseSha, "--format=%(refname:short)"]),
    out(repoDir, ["branch", "-r", "--merged", baseRemoteSha, "--format=%(refname:short)"]),
    worktreeBranches(repoDir),
    refIndex(repoDir),
  ]);

  const mergedLocals = new Set(lines(localMerged).map(shortName).filter(Boolean));
  const mergedRemotes = new Set(
    lines(remoteMerged).filter((r) => r.startsWith("origin/")).map(shortName).filter(Boolean));

  const all = opts.include === "all";
  const names = [...new Set(all
    ? [...refs.locals, ...refs.remotes]
    : [...mergedLocals, ...mergedRemotes])].sort();

  const branches: UnusedBranch[] = [];
  for (const name of names) {
    const local = refs.locals.has(name);
    const remote = refs.remotes.has(name);
    const mergedLocal = local && mergedLocals.has(name);
    const mergedRemote = remote && mergedRemotes.has(name);
    const merged = (!local || mergedLocal) && (!remote || mergedRemote);
    if (!all && !merged) continue;
    const locks: BranchLock[] = [];
    if (name === current) locks.push("current");
    if (name === base) locks.push("base");
    if (wt.has(name)) locks.push("worktree");
    if (opts.openSpecBranches.has(name)) locks.push("spec-open");
    if (opts.sessionBranches.has(name)) locks.push("session");
    branches.push({ name, local, remote, mergedLocal, mergedRemote, merged,
      lastCommit: refs.meta.get(name) ?? null, locks });
  }
  return { base, baseRemote, current, branches };
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/branch-cleanup.test.ts`
Expected: PASS seluruh berkas, termasuk test lama (mode default tak berubah).

- [x] **Step 5: Commit**

```bash
git add server/src/services/branch-cleanup.ts server/test/branch-cleanup.test.ts
git commit -m "feat(branches): daftar branch penuh + flag merged per sisi (SPEC-859)"
```

---

### Task 2: Server — hapus branch belum ter-merge di balik `allowUnmerged`

**Files:**
- Modify: `server/src/services/branch-cleanup.ts`
- Modify: `server/src/routes/ide.ts` (kedua handler `/branches/unused` & `/branches/delete`)
- Test: `server/test/branch-cleanup.test.ts`, `server/test/ide.route.test.ts`

**Interfaces:**
- Consumes: `listUnusedBranches` + `UnusedBranch` dari Task 1.
- Produces:
  ```ts
  export type DeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; forced?: true; error?: string };
  export async function deleteBranches(
    repoDir: string, names: string[],
    opts: { scope: BranchScope; base?: string; allowUnmerged?: boolean } & LockInputs,
  ): Promise<{ base: string; results: DeleteResult[] }>;
  ```

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/branch-cleanup.test.ts` di dalam `describe("deleteBranches", ...)`:

```ts
  it("branch belum ter-merge DITOLAK tanpa allowUnmerged, alasannya menyebut risiko", async () => {
    const { repoDir } = makeRepoWithSpecBranch("u1");
    const r = await deleteBranches(repoDir, ["hanoman/u1"], { scope: "both", ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toMatch(/belum ter-merge/);
    expect(r.results[0]!.error).toMatch(/hilang/);
    expect(branchList(repoDir)).toContain("hanoman/u1");
  });

  it("allowUnmerged menghapus branch belum ter-merge dan menandainya forced", async () => {
    const { repoDir } = makeRepoWithSpecBranch("u2");
    const r = await deleteBranches(repoDir, ["hanoman/u2"], {
      scope: "local", allowUnmerged: true, ...NONE });
    expect(r.results[0]).toEqual({ name: "hanoman/u2", ok: true, scope: "local", forced: true });
    expect(branchList(repoDir)).not.toContain("hanoman/u2");
  });

  it("branch ter-merge TAK PERNAH dipaksa meski allowUnmerged menyala", async () => {
    const dir = mergedRepo("u3");
    const r = await deleteBranches(dir, ["hanoman/u3"], {
      scope: "both", allowUnmerged: true, ...NONE });
    expect(r.results[0]).toEqual({ name: "hanoman/u3", ok: true, scope: "both" });
  });

  it("kunci menang atas allowUnmerged", async () => {
    const { repoDir } = makeRepoWithSpecBranch("u4");
    const r = await deleteBranches(repoDir, ["hanoman/u4"], {
      scope: "both", allowUnmerged: true,
      openSpecBranches: new Set(["hanoman/u4"]), sessionBranches: new Set() });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toContain(LOCK_REASON["spec-open"]);
    expect(branchList(repoDir)).toContain("hanoman/u4");
  });

  it("nama yang bukan branch nyata tetap ditolak meski allowUnmerged menyala", async () => {
    const dir = mergedRepo("u5");
    const r = await deleteBranches(dir, ["tidak-ada-branch-ini"], {
      scope: "both", allowUnmerged: true, ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toMatch(/tak ditemukan/);
  });
```

Ganti judul test lama `"nama di luar daftar ter-merge ditolak (tak bisa diselundupkan lewat body)"`
menjadi `"branch belum ter-merge tak bisa diselundupkan lewat body"` — assertion-nya tak berubah
(`error` tetap memuat `"ter-merge"`), hanya jalur penolakannya yang kini eksplisit.

Tambahkan ke `server/test/ide.route.test.ts` di dalam `describe("branch cleanup (SPEC-360)", ...)`:

```ts
  it("GET /branches/unused?include=all memuat flag merged di tiap baris (SPEC-859)", async () => {
    const r = await app.inject({ url: "/api/projects/cleanrepo/branches/unused?include=all" });
    expect(r.statusCode).toBe(200);
    expect(r.json().branches.length).toBeGreaterThan(0);
    for (const b of r.json().branches) expect(typeof b.merged).toBe("boolean");
    const plain = await app.inject({ url: "/api/projects/cleanrepo/branches/unused" });
    expect(plain.json().branches.every((x: { merged: boolean }) => x.merged)).toBe(true);
  });

  it("POST /branches/delete: allowUnmerged bukan boolean → 400 (SPEC-859)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/projects/cleanrepo/branches/delete",
      payload: { names: ["hanoman/clean"], allowUnmerged: "ya" } });
    expect(r.statusCode).toBe(400);
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/branch-cleanup.test.ts server/test/ide.route.test.ts -t "allowUnmerged"`
Expected: FAIL — `allowUnmerged` bukan properti yang dikenal; route membalas 200, bukan 400.

- [x] **Step 3: Implementasi**

Di `server/src/services/branch-cleanup.ts`, ganti `DeleteResult` dan badan `deleteBranches`:

```ts
export type DeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; forced?: true; error?: string };

// SPEC-360 · ADR-0077 · hapus batch. Menurunkan daftar branch lebih dulu, lalu MEMVALIDASI ULANG
// tiap nama terhadap daftar itu: klien tak bisa menyelundupkan branch sembarang lewat body, dan
// kunci proteksi ditegakkan di jalur tulis (bukan sekadar petunjuk UI). Eksekusi didelegasikan ke
// runGitOp `delete-branch` (SPEC-206) — satu-satunya jalur hapus branch di codebase.
//
// SPEC-859 (amandemen ADR-0077) · daftarnya kini `include:"all"`, jadi premis lama "semua kandidat
// sudah ter-merge" gugur dan `-D` tak bisa lagi dilarang mutlak. Gerbangnya `allowUnmerged`, yang
// HANYA dikirim dialog konfirmasi risiko: tanpa itu baris belum-ter-merge ditolak apa adanya.
// Force dipasang per SISI — `push origin --delete` tak pernah menguji merged-ness.
export async function deleteBranches(
  repoDir: string,
  names: string[],
  opts: { scope: BranchScope; base?: string; allowUnmerged?: boolean } & LockInputs,
): Promise<{ base: string; results: DeleteResult[] }> {
  const report = await listUnusedBranches(repoDir, { ...opts, include: "all" });
  const byName = new Map(report.branches.map((b) => [b.name, b]));
  const results: DeleteResult[] = [];
  for (const name of names) {
    const b = byName.get(name);
    if (!b) {
      results.push({ name, ok: false, scope: "none", error: "branch tak ditemukan di repo" });
      continue;
    }
    if (b.locks.length) {
      results.push({ name, ok: false, scope: "none",
        error: `terkunci: ${b.locks.map((l) => LOCK_REASON[l]).join(", ")}` });
      continue;
    }
    if (!b.merged && !opts.allowUnmerged) {
      results.push({ name, ok: false, scope: "none",
        error: `belum ter-merge ke ${report.base} — commit-nya bisa hilang; butuh konfirmasi terpisah` });
      continue;
    }
    const scope = effectiveScope(opts.scope, b);
    if (scope === "none") {
      results.push({ name, ok: false, scope: "none",
        error: opts.scope === "remote" ? "branch tak punya ref origin" : "branch tak punya ref lokal" });
      continue;
    }
    const forced = scope !== "remote" && !b.mergedLocal;
    const r = await runGitOp(repoDir, {
      op: "delete-branch", name, local: scope !== "remote", remote: scope !== "local", force: forced });
    results.push(r.ok
      ? { name, ok: true, scope, ...(forced ? { forced: true as const } : {}) }
      : { name, ok: false, scope, error: r.stderr || "hapus branch gagal" });
  }
  return { base: report.base, results };
}
```

Di `server/src/routes/ide.ts`, ganti kedua handler branches:

```ts
  // SPEC-360 · ADR-0077 · daftar branch + alasan kunci per branch. Read murni turunan git
  // (ADR-0018) — tak digerbang sesi aktif.
  // SPEC-859 · `?include=all` memuat branch yang BELUM ter-merge. Tanpa parameter itu himpunan
  // barisnya persis seperti sebelumnya, jadi klien lama tak pecah.
  app.get("/projects/:id/branches/unused", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { base, include } = req.query as { base?: string; include?: string };
    return listUnusedBranches(repoDir, {
      base, include: include === "all" ? "all" : "merged", ...(await lockInputs(id)) });
  });

  // SPEC-360 · ADR-0077 · hapus batch. TAK memakai gerbang sesi-aktif global (touchesTree):
  // delete-branch adalah op ref-only (ADR-0055) dan pagarnya sudah per-branch & lebih tepat.
  // Selalu 200 bila body sah — kegagalan hidup di baris `results`, bukan di status HTTP.
  // SPEC-859 · `allowUnmerged` membuka baris yang belum ter-merge (dan hanya itu). Kunci proteksi
  // tak ikut longgar; UI-lah yang wajib meminta konfirmasi risiko sebelum mengirimnya.
  app.post("/projects/:id/branches/delete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { names?: unknown; scope?: unknown; base?: unknown; allowUnmerged?: unknown };
    if (!Array.isArray(b?.names) || b.names.some((n) => typeof n !== "string" || !n))
      return reply.code(400).send({ error: "names wajib berisi nama branch" });
    if (b.scope !== undefined && b.scope !== "local" && b.scope !== "remote" && b.scope !== "both")
      return reply.code(400).send({ error: "scope harus local, remote, atau both" });
    if (b.allowUnmerged !== undefined && typeof b.allowUnmerged !== "boolean")
      return reply.code(400).send({ error: "allowUnmerged harus boolean" });
    return deleteBranches(repoDir, b.names as string[], {
      scope: (b.scope as BranchScope | undefined) ?? "both",
      base: typeof b.base === "string" && b.base ? b.base : undefined,
      allowUnmerged: b.allowUnmerged === true,
      ...(await lockInputs(id)),
    });
  });
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/branch-cleanup.test.ts server/test/ide.route.test.ts`
Expected: PASS.

- [x] **Step 5: Typecheck server**

Run: `pnpm --filter ./server typecheck`
Expected: keluar 0, tanpa error.

- [x] **Step 6: Commit**

```bash
git add server/src/services/branch-cleanup.ts server/src/routes/ide.ts server/test/branch-cleanup.test.ts server/test/ide.route.test.ts
git commit -m "feat(branches): hapus branch belum ter-merge di balik allowUnmerged (SPEC-859)"
```

---

### Task 3: Klien — path `include` + body `allowUnmerged` + tipe

**Files:**
- Modify: `shared/src/api.ts` (`paths.branchesUnused`)
- Modify: `src/src/api/client.ts` (blok tipe SPEC-360 + fungsi `branchesUnused`/`deleteBranches`)
- Test: `src/test/branch-cleanup-client.test.ts`

**Interfaces:**
- Consumes: bentuk respons dari Task 1 & 2.
- Produces:
  ```ts
  paths.branchesUnused(id: string, base?: string, include?: "all"): string
  api.branchesUnused(id: string, base?: string, include?: "all"): Promise<UnusedReport>
  api.deleteBranches(id: string, b: { names: string[]; scope?: BranchScope; base?: string; allowUnmerged?: boolean }):
    Promise<{ base: string; results: BranchDeleteResult[] }>
  type UnusedBranch = { name; local; remote; merged; mergedLocal; mergedRemote; lastCommit; locks }
  type BranchDeleteResult = { name; ok; scope; forced?: true; error? }
  ```

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/branch-cleanup-client.test.ts` di dalam `describe("api branch cleanup (SPEC-360)", ...)`:

```ts
  it("branchesUnused meneruskan include=all (SPEC-859)", async () => {
    const f = mockFetch({ base: "main", baseRemote: null, current: "main", branches: [] });
    await api.branchesUnused("p1", undefined, "all");
    expect(String(f.mock.calls[0]![0])).toContain("include=all");
  });

  it("branchesUnused menggabungkan base & include (SPEC-859)", async () => {
    const f = mockFetch({ base: "dev", baseRemote: null, current: "main", branches: [] });
    await api.branchesUnused("p1", "dev", "all");
    const url = String(f.mock.calls[0]![0]);
    expect(url).toContain("base=dev");
    expect(url).toContain("include=all");
  });

  it("deleteBranches meneruskan allowUnmerged (SPEC-859)", async () => {
    const f = mockFetch({ base: "main", results: [] });
    await api.deleteBranches("p1", { names: ["x"], scope: "local", allowUnmerged: true });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ names: ["x"], scope: "local", allowUnmerged: true });
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run --no-file-parallelism src/test/branch-cleanup-client.test.ts -t "SPEC-859"`
Expected: FAIL — URL tak memuat `include=all`.

- [x] **Step 3: Implementasi**

Di `shared/src/api.ts` ganti `branchesUnused`:

```ts
  // SPEC-360 · ADR-0077 · daftar branch (nilai turunan git) + hapus batch local/origin.
  // SPEC-859 · `include=all` memuat branch yang belum ter-merge; tanpa itu hanya yang ter-merge.
  branchesUnused: (id: string, base?: string, include?: "all") => {
    const q = new URLSearchParams();
    if (base) q.set("base", base);
    if (include) q.set("include", include);
    const s = q.toString();
    return `${API}/projects/${id}/branches/unused${s ? `?${s}` : ""}`;
  },
```

Di `src/src/api/client.ts` ganti blok tipe SPEC-360:

```ts
// SPEC-360 · ADR-0077 · branch & hapus batch. Cermin server/src/services/branch-cleanup.ts.
export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
export type BranchScope = "local" | "remote" | "both";
export type UnusedBranch = {
  name: string;
  // SPEC-859 · `local`/`remote` = ref itu ADA; merged-ness terpisah di tiga field di bawah.
  local: boolean; remote: boolean;
  merged: boolean; mergedLocal: boolean; mergedRemote: boolean;
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];
};
export type UnusedReport = { base: string; baseRemote: string | null; current: string; branches: UnusedBranch[] };
export type BranchDeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; forced?: true; error?: string };
```

Dan ganti kedua fungsi api:

```ts
  // SPEC-360 · ADR-0077 · daftar branch + hapus batch (local/origin).
  // SPEC-859 · `include: "all"` memuat branch belum ter-merge; `allowUnmerged` membuka hapusnya.
  branchesUnused: (id: string, base?: string, include?: "all") =>
    j<UnusedReport>(paths.branchesUnused(id, base, include)),
  deleteBranches: (id: string, b: { names: string[]; scope?: BranchScope; base?: string; allowUnmerged?: boolean }) =>
    j<{ base: string; results: BranchDeleteResult[] }>(paths.branchesDelete(id), { method: "POST", ...body(b) }),
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run --no-file-parallelism src/test/branch-cleanup-client.test.ts`
Expected: PASS — termasuk test lama (`branchesUnused("p1")` tetap tanpa query, `("p1","dev")` tetap `?base=dev`).

- [x] **Step 5: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/test/branch-cleanup-client.test.ts
git commit -m "feat(branches): klien meneruskan include & allowUnmerged (SPEC-859)"
```

---

### Task 4: Panel Branches — daftar penuh, filter status, cari, batas render

**Files:**
- Modify: `src/src/screens/BranchesPanel.tsx`
- Test: `src/test/branches-panel.test.tsx`, `src/test/ide-screen.test.tsx` (fixture)

**Interfaces:**
- Consumes: `api.branchesUnused(id, base, "all")`, `api.deleteBranches(id, { names, scope, allowUnmerged })`, tipe dari Task 3.
- Produces: komponen `BranchesPanel({ projectId })` — prop tak berubah.

- [x] **Step 1: Tulis test yang gagal**

Ganti helper `report()` di `src/test/branches-panel.test.tsx` supaya memuat branch belum ter-merge
(dan tambahkan `type UnusedBranch` ke baris import dari `../src/api/client`):

```ts
const br = (over: Partial<UnusedBranch> & { name: string }): UnusedBranch => ({
  local: true, remote: true, merged: true, mergedLocal: true, mergedRemote: true,
  lastCommit: { sha: "aaa1111", at: "2026-07-20T10:00:00Z", subject: "kerja" }, locks: [], ...over,
});
const report = (over: Partial<UnusedReport> = {}): UnusedReport => ({
  base: "main", baseRemote: "origin/main", current: "main",
  branches: [
    br({ name: "main", locks: ["current", "base"] }),
    br({ name: "hanoman/spec-1" }),
    br({ name: "hanoman/spec-2", remote: false, mergedRemote: false }),
    br({ name: "hanoman/spec-3", lastCommit: null, locks: ["session"] }),
    br({ name: "fitur/aktif", merged: false, mergedLocal: false, mergedRemote: false }),
  ],
  ...over,
});
```

Sesuaikan dua test lama terhadap fixture baru:
- `"pilih semua hanya mencentang yang boleh dihapus"` → `toHaveTextContent("3")` (spec-1, spec-2,
  fitur/aktif; bukan `main` yang base+current, bukan spec-3 yang session).
- `"bulk mengirim semua nama terpilih dalam SATU panggilan"` → tambahkan
  `fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });` sebelum
  `pick("pick-all")` supaya batch-nya murni ter-merge dan dialognya dialog biasa.
- `"tanpa branch ter-merge → state kosong"` → ganti jadi:
  ```ts
  it("project tanpa branch → state kosong", async () => {
    vi.spyOn(api, "branchesUnused").mockResolvedValue(report({ branches: [] }));
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText(/tak ada branch/i)).toBeInTheDocument();
  });
  ```

Test baru di dalam `describe("BranchesPanel", ...)`:

```ts
  it("meminta include=all dan menampilkan branch belum ter-merge", async () => {
    render(<BranchesPanel projectId="p1" />);
    expect(await screen.findByText("fitur/aktif")).toBeInTheDocument();
    expect(api.branchesUnused).toHaveBeenCalledWith("p1", undefined, "all");
  });

  it("filter status ter-merge menyembunyikan yang belum", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });
    expect(screen.queryByText("fitur/aktif")).toBeNull();
    expect(screen.getByText("hanoman/spec-1")).toBeInTheDocument();
  });

  it("filter status belum ter-merge menyisakan yang belum saja", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "unmerged" } });
    expect(screen.getByText("fitur/aktif")).toBeInTheDocument();
    expect(screen.queryByText("hanoman/spec-1")).toBeNull();
  });

  it("cari menyaring berdasarkan nama", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("cari"), { target: { value: "spec-2" } });
    expect(screen.getByText("hanoman/spec-2")).toBeInTheDocument();
    expect(screen.queryByText("hanoman/spec-1")).toBeNull();
  });

  it("pilih semua hanya mencakup yang tampak setelah filter", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "unmerged" } });
    pick("pick-all");
    expect(screen.getByTestId("bulk-delete")).toHaveTextContent("1");
  });

  it("hapus branch belum ter-merge menuntut konfirmasi risiko lalu mengirim allowUnmerged", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({
      base: "main", results: [{ name: "fitur/aktif", ok: true, scope: "both", forced: true }] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.click(screen.getByTestId("row-delete-fitur/aktif"));
    expect(await screen.findByText(/commit yang hanya ada di branch itu akan hilang/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ya, hapus/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/ketik fitur\/aktif untuk konfirmasi/i),
      { target: { value: "fitur/aktif" } });
    fireEvent.click(screen.getByRole("button", { name: /ya, hapus/i }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1",
      { names: ["fitur/aktif"], scope: "both", allowUnmerged: true }));
  });

  it("batch semua-ter-merge TIDAK mengirim allowUnmerged", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({ base: "main", results: [] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("hanoman/spec-1");
    fireEvent.change(screen.getByTestId("status"), { target: { value: "merged" } });
    pick("pick-all");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    await confirm();
    await waitFor(() => expect(del.mock.calls[0]![1]).toEqual(
      { names: ["hanoman/spec-1", "hanoman/spec-2"], scope: "both" }));
  });

  it("batch campuran menuntut ketikan `hapus paksa`", async () => {
    const del = vi.spyOn(api, "deleteBranches").mockResolvedValue({ base: "main", results: [] });
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    pick("pick-all");
    fireEvent.click(screen.getByTestId("bulk-delete"));
    expect(await screen.findByText(/1 branch belum ter-merge/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/ketik hapus paksa untuk konfirmasi/i),
      { target: { value: "hapus paksa" } });
    fireEvent.click(screen.getByRole("button", { name: /ya, hapus/i }));
    await waitFor(() => expect(del.mock.calls[0]![1]).toMatchObject({ allowUnmerged: true }));
  });

  it("daftar tersaring kosong dibedakan dari project tanpa branch", async () => {
    render(<BranchesPanel projectId="p1" />);
    await screen.findByText("fitur/aktif");
    fireEvent.change(screen.getByTestId("cari"), { target: { value: "zzz" } });
    expect(screen.getByText(/tak ada branch cocok filter/i)).toBeInTheDocument();
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run --no-file-parallelism src/test/branches-panel.test.tsx`
Expected: FAIL — `getByTestId("status")` tak ditemukan; `api.branchesUnused` dipanggil tanpa `"all"`.

- [x] **Step 3: Implementasi**

Tulis ulang `src/src/screens/BranchesPanel.tsx`:

```tsx
/* SPEC-360 · ADR-0077 — panel branch project: SELURUH branch (local + origin), ter-merge maupun
   belum, dengan satu tombol hapus per baris + bulk. Komponen sendiri (bukan tambahan ke
   GitGraph.tsx yang sudah 43 KB). Seluruh data turunan git dari server — tak ada state persist.
   SPEC-859 — daftar melebar dari "hanya ter-merge" ke semua branch; filter status/cari & batas
   render hidup di klien supaya "yang sedang tampak" persis sama dengan yang bisa dipilih. */
import React from "react";
import { Card, Button, Badge, Select, Input, Checkbox, StateBlock, ConfirmDialog } from "../ds";
import { api, LOCK_LABEL, type UnusedBranch, type UnusedReport, type BranchScope, type BranchDeleteResult } from "../api/client";

const SCOPES: { value: BranchScope; label: string }[] = [
  { value: "both", label: "local + origin" },
  { value: "local", label: "local saja" },
  { value: "remote", label: "origin saja" },
];

type Status = "all" | "merged" | "unmerged";
const STATUSES: { value: Status; label: string }[] = [
  { value: "all", label: "semua status" },
  { value: "merged", label: "ter-merge saja" },
  { value: "unmerged", label: "belum ter-merge" },
];

// Repo besar: daftar penuh bisa ratusan baris. Batas ini bagian dari definisi "sedang tampak" —
// pilihan tak pernah memuat baris yang tak dirender, jadi "Pilih semua yang boleh (N)" jujur.
const PAGE = 100;

const rel = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}j`;
  if (s < 2592000) return `${Math.floor(s / 86400)}h`;
  return new Date(iso).toLocaleDateString();
};

const deletable = (b: UnusedBranch) => b.locks.length === 0;
const scopeOf = (b: UnusedBranch) => (b.local && b.remote ? "local + origin" : b.local ? "local" : "origin");

export function BranchesPanel({ projectId }: { projectId: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [report, setReport] = React.useState<UnusedReport | null>(null);
  const [bases, setBases] = React.useState<string[]>([]);
  const [base, setBase] = React.useState("");
  const [scope, setScope] = React.useState<BranchScope>("both");
  const [status, setStatus] = React.useState<Status>("all");
  const [q, setQ] = React.useState("");
  const [shown, setShown] = React.useState(PAGE);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<BranchDeleteResult[] | null>(null);

  const load = React.useCallback(() => {
    setState("loading");
    api.branchesUnused(projectId, base || undefined, "all")
      .then((r) => { setReport(r); setPicked(new Set()); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId, base]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    api.listBranches(projectId)
      .then((r) => setBases([...new Set([...r.branches, ...r.remotes])].sort()))
      .catch(() => setBases([]));
  }, [projectId]);

  const branches = report?.branches ?? [];
  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return branches.filter((b) =>
      (status === "all" || (status === "merged") === b.merged) &&
      (!needle || b.name.toLowerCase().includes(needle)));
  }, [branches, status, q]);
  // Menyempitkan filter tak boleh menyisakan pilihan yang tak terlihat lagi: batas render ikut
  // jadi bagian dari "tampak", dan pilihan dikosongkan tiap kali himpunan itu berubah bentuk.
  React.useEffect(() => { setShown(PAGE); setPicked(new Set()); }, [status, q]);

  const visible = filtered.slice(0, shown);
  const free = React.useMemo(() => visible.filter(deletable).map((b) => b.name), [visible]);
  const allPicked = free.length > 0 && free.every((n) => picked.has(n));

  const toggle = (name: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const toggleAll = () => setPicked(allPicked ? new Set<string>() : new Set(free));

  // Urutan mengikuti daftar server supaya `names` deterministik (dan enak di-assert).
  const pickedNames = visible.filter((b) => picked.has(b.name)).map((b) => b.name);

  const byName = React.useMemo(() => new Map(branches.map((b) => [b.name, b])), [branches]);
  const risky = (pending ?? []).filter((n) => byName.get(n)?.merged === false);
  const force = risky.length > 0;

  const run = () => {
    const names = pending;
    if (!names) return;
    setBusy(true);
    api.deleteBranches(projectId, { names, scope, ...(force ? { allowUnmerged: true } : {}) })
      .then((r) => { setResults(r.results); setPending(null); load(); })
      .catch((e: Error) => {
        setResults(names.map((n) => ({ name: n, ok: false, scope: "none" as const, error: e.message })));
        setPending(null);
      })
      .finally(() => setBusy(false));
  };

  const failed = (results ?? []).filter((r) => !r.ok);
  const okCount = (results ?? []).length - failed.length;
  const forcedCount = (results ?? []).filter((r) => r.ok && r.forced).length;
  const scopeLabel = SCOPES.find((s) => s.value === scope)!.label;

  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        <span className="hn-eyebrow" style={{ flex: 1 }}>
          branch project{report?.base ? ` · base ${report.base}` : ""}
        </span>
        <Input size="sm" data-testid="cari" leftIcon="search" placeholder="cari branch…"
          value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          style={{ width: 180 }} />
        <Select size="sm" data-testid="status" value={status}
          onChange={(e) => setStatus(e.target.value as Status)} options={STATUSES} />
        <Select size="sm" data-testid="base" value={base} onChange={(e) => setBase(e.target.value)}
          options={[{ value: "", label: `base otomatis${report?.base ? ` (${report.base})` : ""}` },
            ...bases.map((b) => ({ value: b, label: b }))]} />
        <Select size="sm" data-testid="scope" value={scope}
          onChange={(e) => setScope(e.target.value as BranchScope)} options={SCOPES} />
        <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={load}>Muat ulang</Button>
        <Button size="sm" variant="primary" leftIcon="trash-2" data-testid="bulk-delete"
          disabled={pickedNames.length === 0} onClick={() => setPending(pickedNames)}>
          Hapus terpilih ({pickedNames.length})
        </Button>
      </div>

      {results && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)", fontSize: 12.5 }}>
          <div style={{ color: "var(--text-strong)" }}>
            {okCount} terhapus{forcedCount ? ` (${forcedCount} dipaksa)` : ""} · {failed.length} gagal
          </div>
          {failed.map((f) => (
            <div key={f.name} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {f.name} — {f.error ?? "gagal"}
            </div>
          ))}
        </div>
      )}

      {state === "loading" ? <StateBlock kind="loading" title="Memuat branch…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat branch" action={load} />
        : branches.length === 0 ? <StateBlock kind="empty" icon="git-branch" title="Tak ada branch"
            hint="Project ini belum punya branch local maupun origin." />
        : filtered.length === 0 ? <StateBlock kind="empty" icon="filter" title="Tak ada branch cocok filter"
            hint="Longgarkan filter status atau kosongkan pencarian." />
        : (
          <div style={{ maxHeight: 620, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
              borderBottom: "1px solid var(--border-hair)" }}>
              <Checkbox data-testid="pick-all" checked={allPicked} onChange={toggleAll}
                disabled={free.length === 0} label={`Pilih semua yang boleh (${free.length})`} />
            </div>
            {visible.map((b) => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                borderBottom: "1px solid var(--border-hair)" }}>
                <Checkbox data-testid={`pick-${b.name}`} checked={picked.has(b.name)}
                  disabled={!deletable(b)} onChange={() => toggle(b.name)} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1 }}>
                  {b.name}
                </span>
                <Badge size="sm" tone={b.merged ? "ok" : "warn"}>
                  {b.merged ? "ter-merge" : "belum ter-merge"}
                </Badge>
                <Badge size="sm" tone="brass">{scopeOf(b)}</Badge>
                {b.locks.map((l) => <Badge key={l} size="sm" tone="warn">{LOCK_LABEL[l]}</Badge>)}
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 200, textAlign: "right" }}>
                  {b.lastCommit ? `${b.lastCommit.subject} · ${rel(b.lastCommit.at)}` : "—"}
                </span>
                <Button size="sm" variant="ghost" leftIcon="trash-2" data-testid={`row-delete-${b.name}`}
                  disabled={!deletable(b)} onClick={() => setPending([b.name])}>Hapus</Button>
              </div>
            ))}
            {filtered.length > visible.length && (
              <div style={{ padding: "8px 14px", textAlign: "center" }}>
                <Button size="sm" variant="ghost" data-testid="show-more"
                  onClick={() => setShown((n) => n + PAGE)}>
                  Tampilkan {Math.min(PAGE, filtered.length - visible.length)} lagi
                  ({filtered.length - visible.length} tersisa)
                </Button>
              </div>
            )}
          </div>
        )}

      {/* confirmLabel BUKAN "Hapus": tombol per baris sudah memakai label itu → query test ambigu.
          SPEC-859 · target yang belum ter-merge memakai dialog TERPISAH: `git branch -D` membuang
          commit yang tak ada di mana pun lagi, jadi pagarnya ketikan ulang (pola ADR-0121) —
          nama branch bila targetnya satu, `hapus paksa` bila batch. */}
      <ConfirmDialog
        open={pending !== null} busy={busy} eyebrow="branch" title="Hapus branch?"
        confirmLabel="Ya, hapus"
        requireText={force ? (pending?.length === 1 ? pending[0] : "hapus paksa") : undefined}
        message={pending
          ? `${pending.length} branch akan dihapus (${scopeLabel}). Tindakan ini tak bisa dibatalkan.`
          : ""}
        impact={force ? [
          `${risky.length} branch belum ter-merge ke ${report?.base ?? "base"}: ${risky.join(", ")}.`,
          "Commit yang hanya ada di branch itu akan hilang dan tak bisa dipulihkan dari dashboard.",
        ] : undefined}
        onConfirm={run} onCancel={() => setPending(null)} />
    </Card>
  );
}
```

- [x] **Step 4: Perbarui fixture `ide-screen.test.tsx`**

Mock `api.branchesUnused` di `describe("IdeScreen tab Branches (SPEC-360)")` memakai objek
`UnusedBranch` literal — tambahkan `merged: true, mergedLocal: true, mergedRemote: true` supaya
typecheck-nya hijau.

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run --no-file-parallelism src/test/branches-panel.test.tsx src/test/ide-screen.test.tsx`
Expected: PASS.

- [x] **Step 6: Typecheck frontend**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0, tanpa error.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/BranchesPanel.tsx src/test/branches-panel.test.tsx src/test/ide-screen.test.tsx
git commit -m "feat(branches): panel menampilkan semua branch + filter status & pagar unmerged (SPEC-859)"
```

---

### Task 5: Docs Source of Truth

**Files:**
- Modify: `internal/docs/adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md`
- Modify: `internal/docs/adr/README.md` (baris ADR-0077)
- Modify: `internal/docs/architecture/api-contract.md` (blok "Bersihkan branch tak terpakai")
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian "Tab Branches")
- Modify: `internal/docs/requirements/frd.md` (bagian "## Branches")
- Modify: `internal/docs/requirements/rd.md` (kalimat "tanpa `--force`")
- Verify: `internal/docs/README.md` (tak ada berkas doc baru — cukup pastikan index tetap konsisten)

- [ ] **Step 1: Amandemen ADR-0077**

Tambahkan blok **Amandemen SPEC-859 (2026-08-20)** di ujung `0077-*.md` yang menyatakan:

- Cakupan panel melebar dari "hanya ter-merge" ke **seluruh branch** lewat `?include=all`; default
  tetap ter-merge saja, jadi klien lama tak pecah.
- `local`/`remote` kini berarti **ref itu ADA**; merged-ness pindah ke `merged`/`mergedLocal`/
  `mergedRemote`. Konsekuensi pada mode default hanya di kasus divergen (`x` ter-merge ke `main`
  lokal tetapi `origin/x` belum ke `origin/main`): dulu barisnya muncul dengan `remote:false`, kini
  tak muncul. Arahnya **lebih ketat**, tak pernah lebih longgar.
- Larangan `-D` **dipersempit, bukan dicabut**: alasan aslinya ("semua kandidat sudah ter-merge")
  gugur begitu daftarnya memuat branch belum ter-merge. `-D` hidup **hanya** di balik
  `allowUnmerged: true` + konfirmasi ketik-ulang di UI, dan **hanya** untuk sisi lokal `!mergedLocal`.
- Lima kunci proteksi **tidak** dilonggarkan dan tetap menang atas `allowUnmerged`.
- `push origin --delete` tak pernah menguji merged-ness, jadi sisi origin tak ikut digerbangi force.

- [ ] **Step 2: Perbarui index ADR & empat doc kontrak**

- `adr/README.md`: tambahkan klausa `— **Diamandemen SPEC-859 (2026-08-20)**: …` pada baris 0077.
- `architecture/api-contract.md`: `GET …/branches/unused?base=&include=` (`merged` default | `all`),
  bentuk baris beserta tiga field merged, dan `POST …/branches/delete { names, scope?, base?,
  allowUnmerged? }` beserta `forced?` di `results` + `400` bila `allowUnmerged` bukan boolean.
- `frontend/frontend-implementation.md`: judul bagian jadi "Tab Branches — semua branch project
  (SPEC-360 · ADR-0077 · SPEC-859)"; header bertambah `Select` status + kotak cari; baris bertambah
  badge status; batas render `PAGE = 100` + "Tampilkan N lagi"; "Pilih semua yang boleh" berskop
  yang sedang tampak; dialog risiko untuk target belum-ter-merge.
- `requirements/frd.md`: ganti `THE SYSTEM SHALL menghapus branch tanpa --force.` dengan tiga baris
  EARS: SHALL menampilkan seluruh branch (local + origin) beserta status ter-merge; SHALL menolak
  penghapusan branch belum-ter-merge kecuali permintaan membawa `allowUnmerged`; SHALL tak pernah
  memakai `--force` pada branch yang sudah ter-merge.
- `requirements/rd.md`: ganti "tanpa `--force`" menjadi "`--force` hanya di balik `allowUnmerged` +
  konfirmasi ketik-ulang (SPEC-859)".

- [ ] **Step 3: Verifikasi integritas index**

Run: `git diff --name-only -- internal/docs`
Expected: hanya berkas yang sudah ter-link di `internal/docs/README.md` (tak ada berkas baru).

- [ ] **Step 4: Commit**

```bash
git add internal/docs
git commit -m "docs(branches): amandemen ADR-0077 untuk daftar branch penuh + gerbang allowUnmerged (SPEC-859)"
```

---

### Task 6: Verifikasi akhir — test tersentuh + smoke endpoint

**Files:** tak ada perubahan berkas; hanya verifikasi.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/branch-cleanup.test.ts server/test/ide.route.test.ts \
  src/test/branches-panel.test.tsx src/test/branch-cleanup-client.test.ts src/test/ide-screen.test.tsx
```
Expected: PASS semua; jumlah test berjalan **> 0** (jangan terima "no test files" sebagai bukti).

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./server typecheck && pnpm --filter ./src typecheck && pnpm --filter ./shared typecheck`
Expected: keluar 0.

- [ ] **Step 3: Smoke endpoint nyata (task ini menyentuh endpoint)**

Boot server lalu curl kedua endpoint terhadap project yang punya `repoDir`:
```bash
curl -s "http://127.0.0.1:<port>/api/projects/<id>/branches/unused" | head -c 400
curl -s "http://127.0.0.1:<port>/api/projects/<id>/branches/unused?include=all" | head -c 400
curl -s -X POST "http://127.0.0.1:<port>/api/projects/<id>/branches/delete" \
  -H 'content-type: application/json' -d '{"names":[],"allowUnmerged":"ya"}' -i | head -3
```
Expected: daftar `include=all` **lebih panjang atau sama** dengan daftar default; tiap baris punya
`merged`; body cacat → `400`.

- [ ] **Step 4: Commit sisa & push**

```bash
git status --porcelain      # harus bersih setelah semua commit
git push origin HEAD:refs/heads/hanoman/spec-859
```
