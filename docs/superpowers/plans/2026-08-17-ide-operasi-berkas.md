# IDE Explorer — operasi berkas (buat · unggah · rename · hapus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator bisa membuat, mengunggah (berkas & folder), me-rename, dan menghapus isi checkout project langsung dari IDE Explorer hanoman.

**Architecture:** Satu service murni `server/src/services/repo-fs.ts` memegang seluruh manipulasi berkas di atas penjaga path yang sudah ada (`safe-repo-path.ts`); `routes/ide.ts` hanya me-resolve project → `repoDir` dan menerjemahkan error service ke kode HTTP. Empat endpoint: `POST|PATCH|DELETE /projects/:id/entry` untuk operasi struktural dan `POST /projects/:id/upload` (multipart, di-stream) untuk unggahan. Frontend menambah target folder yang bisa dipilih di pohon, satu baris aksi di pane Files, dan modal bentrok/konfirmasi.

**Tech Stack:** Fastify 5 + `@fastify/multipart` 10 · Node `fs/promises` + `stream/promises` · React 18 + TypeScript strict · Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-08-17-ide-operasi-berkas-design.md`.

## Global Constraints

- **TypeScript strict.** Tak ada `any` baru; tipe error service diekspor sebagai class.
- **Komentar & pesan error berbahasa Indonesia**, mengikuti gaya berkas di sekitarnya (sebut nomor spec/ADR pada komentar yang menjelaskan keputusan, bukan pada kode biasa).
- **Perintah test wajib:**
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run <path> --no-file-parallelism`
  — `--no-file-parallelism` wajib untuk test server (satu berkas DB bersama, SPEC-397); `TEST_DATABASE_URL` wajib karena DB test diturunkan dari `HANOMAN_HOME`, bukan dari checkout (SPEC-479). Jalankan dari root repo — `vitest --changed` pernah hijau palsu karena `cwd` menggeser.
- **Jangan** jalankan suite penuh atau `pnpm -r typecheck` sebagai rutinitas; typecheck paket yang tersentuh saja (`pnpm --filter ./server typecheck`).
- **Batas unggah** (dipakai verbatim di Task 3): `fileSize` 100 MB (`100 * 1024 * 1024`), `files` 1000, `fields` 10, `fieldSize` 1 MB (`1024 * 1024`), total badan 2 GB (`2 * 1024 * 1024 * 1024`).
- **Registrasi multipart global di `server/src/app.ts:127` TIDAK BOLEH diubah** — 5 MB/12 berkas itu milik lampiran gambar SPEC-816. Batas route ini disebut per-request lewat `req.parts({ limits })`.
- **Larangan path** berlaku di keempat endpoint: absolut, kosong, `..`, NUL, komponen `.git`, komponen symlink → ditolak sebelum disk tersentuh.
- **Commit tiap task**, docs yang tersentuh ikut di commit yang sama (AGENTS.md aturan 2).

---

### Task 1: Service `repo-fs` — buat, rename, hapus, simpan unggahan

**Files:**
- Modify: `server/src/services/safe-repo-path.ts` (ekspor `ensureRepoParents`, tambah opsi `allowMissingTail` pada `resolveRepoEntry`)
- Create: `server/src/services/repo-fs.ts`
- Test: `server/test/repo-fs.test.ts`

**Interfaces:**
- Consumes: `resolveRepoEntry`, `writeRepoFileAtomic`, `PathContainmentError` dari `safe-repo-path.ts`.
- Produces (dipakai Task 2 & 3):
  - `type EntryKind = "file" | "dir"`
  - `class EntryExistsError`, `class EntryMissingError`, `class EntryTargetInsideError`
  - `entryKind(repoDir: string, rel: string): Promise<EntryKind | null>`
  - `createEntry(repoDir: string, rel: string, kind: EntryKind): Promise<{ path: string }>`
  - `renameEntry(repoDir: string, from: string, to: string): Promise<{ from: string; to: string }>`
  - `deleteEntry(repoDir: string, rel: string): Promise<{ path: string; kind: EntryKind }>`
  - `saveUpload(repoDir: string, rel: string, source: Readable, opts: { overwrite?: boolean; isTruncated?: () => boolean }): Promise<{ status: "written" | "exists" | "too-large" }>`
  - `joinRel(dir: string, name: string): string`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/repo-fs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  entryKind, createEntry, renameEntry, deleteEntry, saveUpload, joinRel,
  EntryExistsError, EntryMissingError, EntryTargetInsideError,
} from "../src/services/repo-fs";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "hanoman-repofs-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "satu\n");
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
});

describe("entryKind", () => {
  it("membedakan berkas, folder, dan yang tak ada", async () => {
    expect(await entryKind(repo, "src/a.ts")).toBe("file");
    expect(await entryKind(repo, "src")).toBe("dir");
    expect(await entryKind(repo, "src/hantu.ts")).toBe(null);
    // induk yang belum ada bukan error — ini jalur "boleh dibuat"
    expect(await entryKind(repo, "belum/ada/x.ts")).toBe(null);
  });
});

describe("createEntry", () => {
  it("membuat berkas kosong berikut folder induknya", async () => {
    await createEntry(repo, "src/ds/Baru.tsx", "file");
    expect(readFileSync(join(repo, "src/ds/Baru.tsx"), "utf8")).toBe("");
  });
  it("folder lahir dengan .gitkeep supaya terlihat git", async () => {
    await createEntry(repo, "src/kosong", "dir");
    expect(existsSync(join(repo, "src/kosong/.gitkeep"))).toBe(true);
  });
  it("path yang sudah ada ditolak tanpa menyentuh isinya", async () => {
    await expect(createEntry(repo, "src/a.ts", "file")).rejects.toBeInstanceOf(EntryExistsError);
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("satu\n");
  });
});

describe("renameEntry", () => {
  it("memindahkan berkas beserta induk baru", async () => {
    await renameEntry(repo, "src/a.ts", "lib/b.ts");
    expect(existsSync(join(repo, "src/a.ts"))).toBe(false);
    expect(readFileSync(join(repo, "lib/b.ts"), "utf8")).toBe("satu\n");
  });
  it("tujuan yang sudah ada → EntryExistsError", async () => {
    writeFileSync(join(repo, "src/b.ts"), "dua\n");
    await expect(renameEntry(repo, "src/a.ts", "src/b.ts")).rejects.toBeInstanceOf(EntryExistsError);
  });
  it("sumber tak ada → EntryMissingError", async () => {
    await expect(renameEntry(repo, "src/hantu.ts", "src/z.ts")).rejects.toBeInstanceOf(EntryMissingError);
  });
  it("folder tak boleh dipindah ke dalam dirinya sendiri", async () => {
    await expect(renameEntry(repo, "src", "src/dalam")).rejects.toBeInstanceOf(EntryTargetInsideError);
  });
});

describe("deleteEntry", () => {
  it("menghapus berkas", async () => {
    expect(await deleteEntry(repo, "src/a.ts")).toEqual({ path: "src/a.ts", kind: "file" });
    expect(existsSync(join(repo, "src/a.ts"))).toBe(false);
  });
  it("menghapus folder berikut isinya", async () => {
    expect(await deleteEntry(repo, "src")).toEqual({ path: "src", kind: "dir" });
    expect(existsSync(join(repo, "src"))).toBe(false);
  });
  it("path tak ada → EntryMissingError", async () => {
    await expect(deleteEntry(repo, "src/hantu.ts")).rejects.toBeInstanceOf(EntryMissingError);
  });
});

describe("penjaga path", () => {
  const jahat = ["../keluar.ts", "/etc/passwd", ".git/HEAD", ".git/hooks/pre-commit", "", "src/../../x"];
  it("menolak traversal, absolut, dan .git di semua operasi", async () => {
    for (const p of jahat) {
      await expect(entryKind(repo, p)).rejects.toBeTruthy();
      await expect(createEntry(repo, p, "file")).rejects.toBeTruthy();
      await expect(deleteEntry(repo, p)).rejects.toBeTruthy();
    }
    expect(readFileSync(join(repo, ".git/HEAD"), "utf8")).toContain("refs/heads/main");
  });
  it("menolak komponen symlink", async () => {
    symlinkSync(tmpdir(), join(repo, "keluar"));
    await expect(deleteEntry(repo, "keluar/apa.ts")).rejects.toBeTruthy();
  });
});

describe("saveUpload", () => {
  const src = (s: string) => Readable.from([Buffer.from(s)]);
  it("menulis berkas baru berikut induknya", async () => {
    expect(await saveUpload(repo, "aset/img/a.txt", src("halo"))).toEqual({ status: "written" });
    expect(readFileSync(join(repo, "aset/img/a.txt"), "utf8")).toBe("halo");
  });
  it("tanpa overwrite, berkas yang sudah ada dilewati utuh", async () => {
    expect(await saveUpload(repo, "src/a.ts", src("baru"))).toEqual({ status: "exists" });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("satu\n");
  });
  it("dengan overwrite, isinya diganti", async () => {
    expect(await saveUpload(repo, "src/a.ts", src("baru"), { overwrite: true })).toEqual({ status: "written" });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("baru");
  });
  it("berkas ter-truncate tak pernah mendarat & tak meninggalkan .tmp", async () => {
    const r = await saveUpload(repo, "src/a.ts", src("potong"), { overwrite: true, isTruncated: () => true });
    expect(r).toEqual({ status: "too-large" });
    expect(readFileSync(join(repo, "src/a.ts"), "utf8")).toBe("satu\n");
    expect(readdirSync(join(repo, "src")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("joinRel", () => {
  it("menggabungkan folder tujuan dengan path relatif berkas", () => {
    expect(joinRel("", "a.ts")).toBe("a.ts");
    expect(joinRel("src/ds", "sub/b.ts")).toBe("src/ds/sub/b.ts");
    expect(joinRel("/src/", "/b.ts")).toBe("src/b.ts");
    expect(() => joinRel("src", "   ")).toThrow();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/repo-fs.test.ts --no-file-parallelism
```
Expected: FAIL — `Failed to resolve import "../src/services/repo-fs"`.

- [x] **Step 3: Buka dua kemampuan di `safe-repo-path.ts`**

`resolveRepoEntry` hari ini menolak path yang **induknya** belum ada; kembarannya yang sync (`assertSafeRepoPathSync`) sudah punya `allowMissingTail` untuk itu. Samakan, dan ekspor pembuat induk yang sudah ada.

Ubah `server/src/services/safe-repo-path.ts:31` — tambahkan `export`:

```ts
export async function ensureRepoParents(root: string, rel: string): Promise<void> {
```

Ubah `server/src/services/safe-repo-path.ts:63-84` menjadi:

```ts
export async function resolveRepoEntry(
  root: string, rel: string, opts: { allowMissingFinal?: boolean; allowMissingTail?: boolean } = {},
): Promise<{ root: string; path: string; parent: string }> {
  const base = await canonicalRoot(root);
  const parts = components(rel);
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      // allowMissingTail: seluruh sisa path boleh belum ada (jalur "boleh dibuat", cermin
      // assertSafeRepoPathSync). allowMissingFinal: hanya komponen terakhir.
      if (error.code === "ENOENT" && opts.allowMissingTail) return null;
      if (error.code === "ENOENT" && opts.allowMissingFinal && i === parts.length - 1) return null;
      return denied("komponen tidak ada");
    });
    if (!stat) break;
    if (stat.isSymbolicLink()) denied("symlink");
    if (i < parts.length - 1 && !stat.isDirectory()) denied("parent bukan direktori");
  }
  if (!beneath(base, resolve(current))) denied("keluar root");
  const parent = resolve(current, "..");
  const parentReal = await realpath(parent).catch(() => denied("parent tidak ada"));
  if (!beneath(base, parentReal)) denied("parent keluar root");
  return { root: base, path: current, parent: parentReal };
}
```

Catatan: dengan `allowMissingTail`, `path` yang dikembalikan adalah komponen pertama yang belum ada — cukup untuk `lstat` (yang akan ENOENT) dan itulah yang dipakai `entryKind`.

- [x] **Step 4: Tulis `server/src/services/repo-fs.ts`**

```ts
// SPEC (IDE operasi berkas) · ADR-0121 · buat/rename/hapus/unggah isi checkout project.
// Service MURNI: tak menyentuh Prisma maupun tmux, jadi bisa dites atas direktori sementara.
// Seluruh penjaga path diwarisi apa adanya dari safe-repo-path.ts — jangan menulis ulang
// pemeriksaannya di sini (kelas bug SPEC-431/448/475: predikat kembar yang berpisah diam-diam).
import { lstat, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  PathContainmentError, ensureRepoParents, resolveRepoEntry, writeRepoFileAtomic,
} from "./safe-repo-path";

export type EntryKind = "file" | "dir";

export class EntryExistsError extends Error { readonly code = "ENTRY_EXISTS"; }
export class EntryMissingError extends Error { readonly code = "ENTRY_MISSING"; }
export class EntryTargetInsideError extends Error { readonly code = "ENTRY_TARGET_INSIDE"; }

// Cermin larangan `.git` di repoAbsPath (git-ide.ts:16). Berdiri sebelum resolusi apa pun:
// menyentuh .git berarti bisa menulis hook yang dieksekusi git di mesin server.
function assertNotGit(rel: string): void {
  if (rel.split(/[\\/]/).includes(".git"))
    throw new PathContainmentError("repository path ditolak: tidak boleh menyentuh .git");
}

const clean = (s: string) => s.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();

// Gabungkan folder tujuan dengan path relatif berkas dari manifest unggahan.
// Traversal TIDAK diperiksa di sini — `components()` di safe-repo-path yang menolaknya,
// satu tempat untuk satu aturan.
export function joinRel(dir: string, name: string): string {
  const d = clean(dir), n = clean(name);
  if (!n) throw new PathContainmentError("repository path ditolak: nama berkas kosong");
  return d ? `${d}/${n}` : n;
}

export async function entryKind(repoDir: string, rel: string): Promise<EntryKind | null> {
  assertNotGit(rel);
  const { path } = await resolveRepoEntry(repoDir, rel, { allowMissingTail: true });
  const st = await lstat(path).catch(() => null);
  if (!st) return null;
  return st.isDirectory() ? "dir" : "file";
}

// Folder kosong tak dilacak git dan pohon Explorer dibangun dari `git ls-files` — tanpa
// `.gitkeep` folder baru jadi folder hantu yang hilang saat muat ulang.
export async function createEntry(repoDir: string, rel: string, kind: EntryKind): Promise<{ path: string }> {
  if (await entryKind(repoDir, rel)) throw new EntryExistsError(`sudah ada: ${rel}`);
  await writeRepoFileAtomic(repoDir, kind === "dir" ? `${clean(rel)}/.gitkeep` : rel, "");
  return { path: rel };
}

export async function renameEntry(repoDir: string, from: string, to: string): Promise<{ from: string; to: string }> {
  const kind = await entryKind(repoDir, from);
  if (!kind) throw new EntryMissingError(`tidak ada: ${from}`);
  if (await entryKind(repoDir, to)) throw new EntryExistsError(`sudah ada: ${to}`);
  if (kind === "dir" && `${clean(to)}/`.startsWith(`${clean(from)}/`))
    throw new EntryTargetInsideError("tujuan di dalam sumber");
  await ensureRepoParents(repoDir, to);
  const src = await resolveRepoEntry(repoDir, from);
  const dst = await resolveRepoEntry(repoDir, to, { allowMissingFinal: true });
  await rename(src.path, dst.path);
  return { from, to };
}

export async function deleteEntry(repoDir: string, rel: string): Promise<{ path: string; kind: EntryKind }> {
  const kind = await entryKind(repoDir, rel);
  if (!kind) throw new EntryMissingError(`tidak ada: ${rel}`);
  const { path } = await resolveRepoEntry(repoDir, rel);
  await rm(path, { recursive: kind === "dir", force: false });
  return { path: rel, kind };
}

// Unggahan di-STREAM ke .tmp lalu di-rename: pada batas 100 MB × 1000 berkas, memuat berkas
// penuh di RAM (pola toBuffer lampiran gambar 5 MB) adalah cara termudah membunuh instance 8 GB.
// `isTruncated` dibaca SESUDAH stream habis — batas ukuran multipart baru diketahui di akhir.
export async function saveUpload(
  repoDir: string, rel: string, source: Readable,
  opts: { overwrite?: boolean; isTruncated?: () => boolean } = {},
): Promise<{ status: "written" | "exists" | "too-large" }> {
  assertNotGit(rel);
  await ensureRepoParents(repoDir, rel);
  const entry = await resolveRepoEntry(repoDir, rel, { allowMissingFinal: true });
  const current = await lstat(entry.path).catch(() => null);
  if (current && !opts.overwrite) return { status: "exists" };
  if (current && !current.isFile())
    throw new PathContainmentError("repository path ditolak: target bukan file regular");
  const temp = join(entry.parent, `.hanoman-${randomUUID()}.tmp`);
  try {
    await pipeline(source, createWriteStream(temp, { flags: "wx", mode: 0o600 }));
    if (opts.isTruncated?.()) { await rm(temp, { force: true }); return { status: "too-large" }; }
    await rename(temp, entry.path);
    return { status: "written" };
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/repo-fs.test.ts --no-file-parallelism
pnpm --filter ./server typecheck
```
Expected: seluruh test `repo-fs.test.ts` PASS; typecheck bersih.

- [x] **Step 6: Pastikan pemakai lama `safe-repo-path` tak berubah perilakunya**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/safe-repo-path.test.ts server/test/git-ide.test.ts --no-file-parallelism
```
Expected: PASS. (Bila `safe-repo-path.test.ts` tak ada, jalankan `git-ide.test.ts` saja — `allowMissingTail` bersifat opt-in sehingga pemanggil lama menempuh cabang yang sama persis seperti sebelumnya.)

- [x] **Step 7: Commit**

```bash
git add server/src/services/repo-fs.ts server/src/services/safe-repo-path.ts server/test/repo-fs.test.ts
git commit -m "feat(ide): service repo-fs — buat, rename, hapus, simpan unggahan"
```

---

### Task 2: Endpoint `entry` (buat · rename · hapus) + peta capability

**Files:**
- Modify: `server/src/routes/ide.ts` (import di baris 14-18; route baru sesudah `PUT /file` di baris 110)
- Modify: `server/src/services/agent-capabilities.ts:7-10`
- Test: `server/test/ide.route.test.ts`, `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Consumes: `entryKind`, `createEntry`, `renameEntry`, `deleteEntry`, `EntryExistsError`, `EntryMissingError`, `EntryTargetInsideError` dari Task 1.
- Produces: `POST|PATCH|DELETE /api/projects/:id/entry` dengan bentuk respons yang dipakai Task 4 (`{ path }`, `{ from, to }`, `{ path, kind }`), dan helper lokal `entryError(reply, e)`.

- [x] **Step 1: Tulis test route yang gagal**

Tambahkan di akhir `server/test/ide.route.test.ts` (sebelum kurung tutup berkas), dan tambahkan `"entryrepo"` ke `beforeAll`:

```ts
// beforeAll — tambahkan baris ini bersama makeProject lain:
//   await makeProject({ id: "entryrepo", repoDir: makeRepoWithBranches() });

describe("operasi berkas IDE (entry)", () => {
  const post = (b: unknown) => app.inject({ method: "POST", url: "/api/projects/entryrepo/entry", payload: b });

  it("POST membuat berkas kosong", async () => {
    const r = await post({ path: "src/ds/Baru.tsx", kind: "file" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ path: "src/ds/Baru.tsx" });
    const tree = await app.inject({ url: "/api/projects/entryrepo/tree" });
    expect(tree.json().files).toContain("src/ds/Baru.tsx");
  });

  it("POST kind=dir membuat folder ber-.gitkeep", async () => {
    expect((await post({ path: "kosong", kind: "dir" })).statusCode).toBe(201);
    const tree = await app.inject({ url: "/api/projects/entryrepo/tree" });
    expect(tree.json().files).toContain("kosong/.gitkeep");
  });

  it("POST path yang sudah ada → 409", async () => {
    await post({ path: "dobel.txt", kind: "file" });
    expect((await post({ path: "dobel.txt", kind: "file" })).statusCode).toBe(409);
  });

  it("POST body tak sah → 400", async () => {
    expect((await post({ kind: "file" })).statusCode).toBe(400);
    expect((await post({ path: "x.txt", kind: "symlink" })).statusCode).toBe(400);
  });

  it("PATCH me-rename berkas", async () => {
    await post({ path: "lama.txt", kind: "file" });
    const r = await app.inject({ method: "PATCH", url: "/api/projects/entryrepo/entry",
      payload: { from: "lama.txt", to: "baru/nama.txt" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ from: "lama.txt", to: "baru/nama.txt" });
  });

  it("PATCH sumber tak ada → 404; tujuan sudah ada → 409; tujuan di dalam sumber → 400", async () => {
    const patch = (b: unknown) => app.inject({ method: "PATCH", url: "/api/projects/entryrepo/entry", payload: b });
    expect((await patch({ from: "hantu.txt", to: "z.txt" })).statusCode).toBe(404);
    await post({ path: "ada1.txt", kind: "file" });
    await post({ path: "ada2.txt", kind: "file" });
    expect((await patch({ from: "ada1.txt", to: "ada2.txt" })).statusCode).toBe(409);
    await post({ path: "folder/isi.txt", kind: "file" });
    expect((await patch({ from: "folder", to: "folder/dalam" })).statusCode).toBe(400);
  });

  it("DELETE menghapus berkas & folder; yang tak ada → 404", async () => {
    await post({ path: "buang.txt", kind: "file" });
    const r = await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry?path=buang.txt" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ path: "buang.txt", kind: "file" });
    await post({ path: "buangdir/isi.txt", kind: "file" });
    expect((await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry?path=buangdir" })).json())
      .toEqual({ path: "buangdir", kind: "dir" });
    expect((await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry?path=hantu.txt" })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/entryrepo/entry" })).statusCode).toBe(400);
  });

  it("path berbahaya ditolak 400 di ketiga method, .git utuh", async () => {
    for (const p of ["../keluar.txt", "/etc/passwd", ".git/hooks/pre-commit"]) {
      expect((await post({ path: p, kind: "file" })).statusCode).toBe(400);
      expect((await app.inject({ method: "PATCH", url: "/api/projects/entryrepo/entry",
        payload: { from: "README.md", to: p } })).statusCode).toBe(400);
      expect((await app.inject({ method: "DELETE",
        url: `/api/projects/entryrepo/entry?path=${encodeURIComponent(p)}` })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: "/api/projects/entryrepo/tree" })).json().files).toContain("README.md");
  });

  it("project tak ada → 404; project tanpa repoDir → 400", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/ghost/entry",
      payload: { path: "a.txt", kind: "file" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/projects/nodir/entry",
      payload: { path: "a.txt", kind: "file" } })).statusCode).toBe(400);
  });

  // AC-14 · sesi aktif TIDAK memblokir: ini bukan operasi git & tak memindahkan HEAD (spec §6).
  // Pola persis test "PUT /file … TIDAK digerbang sesi aktif" di berkas yang sama.
  it("sesi aktif tak memblokir operasi berkas", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    createSession("entryrepo", process.cwd());
    expect((await post({ path: "saat-sesi.txt", kind: "file" })).statusCode).toBe(201);
    killAll();   // catatan: socket tmux test dipakai bersama antar-worktree — jangan jalankan
                 // suite ini berbarengan dengan sesi lain di mesin yang sama.
  });
});
```

Tambahkan juga di `server/test/agent-capabilities.test.ts`, ke dalam array `cases`:

```ts
    ["POST", "/api/projects/foo/entry", "ide:write"],
    ["PATCH", "/api/projects/foo/entry", "ide:write"],
    ["DELETE", "/api/projects/foo/entry", "ide:write"],
    ["POST", "/api/projects/foo/upload", "ide:write"],
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/ide.route.test.ts server/test/agent-capabilities.test.ts --no-file-parallelism
```
Expected: FAIL — route `entry` menjawab 404 (belum terdaftar), dan capability memetakan ke `projects:write`.

- [x] **Step 3: Daftarkan sub-path di peta capability**

Ubah `server/src/services/agent-capabilities.ts:7-10`:

```ts
const IDE_SUBS = new Set([
  "tree", "file", "working-status", "file-diff", "graph", "commit", "git",
  "status", "stashes", "remotes", "compare", "archive", "pr-url",
  // ADR-0121 · operasi berkas Explorer. `rw()` menurunkan read/write DARI METHOD, jadi
  // POST/PATCH/DELETE menuntut ide:write — capability yang sudah memberi hak menimpa isi
  // berkas apa pun lewat PUT /file (hindari kelas bug SPEC-405: prefix tanpa lihat method).
  "entry", "upload",
]);
```

- [x] **Step 4: Tambahkan route `entry`**

Di `server/src/routes/ide.ts`, tambahkan import sesudah baris 18:

```ts
import {
  createEntry, renameEntry, deleteEntry,
  EntryExistsError, EntryMissingError, EntryTargetInsideError,
} from "../services/repo-fs";
```

Tambahkan helper di bawah `lockInputs` (sekitar baris 46):

```ts
// ADR-0121 · terjemahan seragam error service berkas → kode HTTP. Apa pun yang tak dikenal
// jatuh ke 400: seluruh sisanya adalah penolakan penjaga path, dan itu salah peminta.
function entryError(reply: import("fastify").FastifyReply, e: unknown) {
  const msg = (e as Error).message;
  if (e instanceof EntryMissingError) return reply.code(404).send({ error: "not found" });
  if (e instanceof EntryExistsError) return reply.code(409).send({ error: "sudah ada" });
  if (e instanceof EntryTargetInsideError) return reply.code(400).send({ error: "tujuan di dalam sumber" });
  return reply.code(400).send({ error: msg });
}
```

Tambahkan route sesudah `PUT /projects/:id/file` (sesudah baris 110):

```ts
  // ADR-0121 · operasi struktural berkas. SENGAJA tak digerbang sesi aktif, alasan yang sama
  // dengan PUT /file di atas: bukan operasi git, tak memindahkan HEAD, dan sesi hidup di
  // .worktrees/<id> yang terpisah. Yang menjaga hapus/rename adalah konfirmasi di UI.
  app.post("/projects/:id/entry", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { path?: string; kind?: string };
    if (!b?.path || typeof b.path !== "string") return reply.code(400).send({ error: "path wajib" });
    if (b.kind !== "file" && b.kind !== "dir") return reply.code(400).send({ error: "kind harus file atau dir" });
    try { return reply.code(201).send(await createEntry(repoDir, b.path, b.kind)); }
    catch (e) { return entryError(reply, e); }
  });

  app.patch("/projects/:id/entry", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { from?: string; to?: string };
    if (!b?.from || !b?.to || typeof b.from !== "string" || typeof b.to !== "string")
      return reply.code(400).send({ error: "from & to wajib" });
    try { return await renameEntry(repoDir, b.from, b.to); }
    catch (e) { return entryError(reply, e); }
  });

  app.delete("/projects/:id/entry", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try { return await deleteEntry(repoDir, path); }
    catch (e) { return entryError(reply, e); }
  });
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/ide.route.test.ts server/test/agent-capabilities.test.ts --no-file-parallelism
pnpm --filter ./server typecheck
```
Expected: PASS semua.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/ide.ts server/src/services/agent-capabilities.ts server/test/ide.route.test.ts server/test/agent-capabilities.test.ts
git commit -m "feat(ide): endpoint entry — buat, rename, hapus berkas & folder"
```

---

### Task 3: Endpoint `upload` (multipart, di-stream)

**Files:**
- Modify: `server/src/routes/ide.ts`
- Test: `server/test/ide.route.test.ts`

**Interfaces:**
- Consumes: `saveUpload`, `joinRel` dari Task 1.
- Produces: `POST /api/projects/:id/upload` → `{ written: string[]; skipped: { path: string; reason: "exists" | "too-large" | "budget" | "denied" }[] }` — bentuk yang dipakai Task 4 & 7.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/ide.route.test.ts`. Helper multipart ditulis tangan karena `app.inject` tak punya pembangun multipart:

```ts
// Badan multipart minimal: field lebih dulu, lalu berkas — urutan itu bagian dari kontrak
// (manifest harus terbaca sebelum part berkas pertama).
function multipart(fields: Record<string, string>, files: { name: string; body: string }[]) {
  const B = "----hanomanTestBoundary";
  const chunks: string[] = [];
  for (const [k, v] of Object.entries(fields))
    chunks.push(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  for (const f of files)
    chunks.push(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n${f.body}\r\n`);
  chunks.push(`--${B}--\r\n`);
  return { payload: chunks.join(""), headers: { "content-type": `multipart/form-data; boundary=${B}` } };
}
const upload = (project: string, fields: Record<string, string>, files: { name: string; body: string }[]) =>
  app.inject({ method: "POST", url: `/api/projects/${project}/upload`, ...multipart(fields, files) });

// Catatan cakupan: `reason: "too-large"` (>100 MB) TIDAK diuji di lapis route — mengirim 100 MB
// lewat app.inject tak sepadan. Ia diuji di lapis service (`repo-fs.test.ts`, jalur `isTruncated`),
// dan yang tersisa di route hanya penyambungan `() => part.file.truncated === true`.

describe("unggah berkas IDE (upload)", () => {
  it("menulis berkas ke folder tujuan, struktur manifest ikut terbentuk", async () => {
    const r = await upload("entryrepo",
      { dir: "aset", manifest: JSON.stringify(["a.txt", "sub/b.txt"]) },
      [{ name: "a.txt", body: "AAA" }, { name: "b.txt", body: "BBB" }]);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ written: ["aset/a.txt", "aset/sub/b.txt"], skipped: [] });
    const tree = (await app.inject({ url: "/api/projects/entryrepo/tree" })).json().files;
    expect(tree).toContain("aset/sub/b.txt");
  });

  it("tanpa manifest, nama berkas multipart yang dipakai", async () => {
    const r = await upload("entryrepo", { dir: "" }, [{ name: "polos.txt", body: "P" }]);
    expect(r.json().written).toEqual(["polos.txt"]);
  });

  it("berkas yang sudah ada dilewati & dilaporkan, sisanya tetap ditulis", async () => {
    await upload("entryrepo", { dir: "dup" }, [{ name: "sama.txt", body: "asli" }]);
    const r = await upload("entryrepo", { dir: "dup", manifest: JSON.stringify(["sama.txt", "beda.txt"]) },
      [{ name: "sama.txt", body: "baru" }, { name: "beda.txt", body: "baru" }]);
    expect(r.json()).toEqual({ written: ["dup/beda.txt"], skipped: [{ path: "dup/sama.txt", reason: "exists" }] });
    const isi = await app.inject({ url: "/api/projects/entryrepo/file?path=dup%2Fsama.txt" });
    expect(isi.json().content).toBe("asli");
  });

  it("overwrite=1 menimpa", async () => {
    await upload("entryrepo", { dir: "ow" }, [{ name: "x.txt", body: "lama" }]);
    const r = await upload("entryrepo", { dir: "ow", overwrite: "1" }, [{ name: "x.txt", body: "baru" }]);
    expect(r.json().written).toEqual(["ow/x.txt"]);
    expect((await app.inject({ url: "/api/projects/entryrepo/file?path=ow%2Fx.txt" })).json().content).toBe("baru");
  });

  it("path berbahaya masuk skipped:denied, bukan menggagalkan unggahan", async () => {
    const r = await upload("entryrepo", { dir: "", manifest: JSON.stringify(["../keluar.txt", "aman.txt"]) },
      [{ name: "keluar.txt", body: "X" }, { name: "aman.txt", body: "Y" }]);
    expect(r.json().written).toEqual(["aman.txt"]);
    expect(r.json().skipped).toEqual([{ path: "../keluar.txt", reason: "denied" }]);
  });

  // AC-8 · anggaran total. Ceiling dibaca PER-REQUEST dari env supaya bisa diuji tanpa
  // mengirim 2 GB; default-nya tetap 2 GB dan tak ada UI/knob yang mengubahnya.
  it("total badan melewati anggaran → sisanya skipped:budget", async () => {
    process.env.HANOMAN_IDE_UPLOAD_MAX_BYTES = "3";
    try {
      const r = await upload("entryrepo", { dir: "bujet", manifest: JSON.stringify(["p.txt", "q.txt"]) },
        [{ name: "p.txt", body: "AAAA" }, { name: "q.txt", body: "B" }]);
      expect(r.json().written).toEqual(["bujet/p.txt"]);
      expect(r.json().skipped).toEqual([{ path: "bujet/q.txt", reason: "budget" }]);
    } finally { delete process.env.HANOMAN_IDE_UPLOAD_MAX_BYTES; }
  });

  it("manifest tak sepanjang daftar berkas → 400", async () => {
    const r = await upload("entryrepo", { dir: "", manifest: JSON.stringify(["satu.txt"]) },
      [{ name: "satu.txt", body: "1" }, { name: "dua.txt", body: "2" }]);
    expect(r.statusCode).toBe(400);
  });

  it("bukan multipart → 400; project tanpa repoDir → 400; project tak ada → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/projects/entryrepo/upload", payload: { a: 1 } })).statusCode).toBe(400);
    expect((await upload("nodir", { dir: "" }, [{ name: "a.txt", body: "A" }])).statusCode).toBe(400);
    expect((await upload("ghost", { dir: "" }, [{ name: "a.txt", body: "A" }])).statusCode).toBe(404);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/ide.route.test.ts --no-file-parallelism -t "unggah berkas IDE"
```
Expected: FAIL — 404, route belum ada.

- [x] **Step 3: Implementasikan route**

Tambahkan import di `server/src/routes/ide.ts` (gabungkan dengan import Task 2):

```ts
import { saveUpload, joinRel } from "../services/repo-fs";
```

Tambahkan konstanta di bawah import (sekitar baris 26):

```ts
// ADR-0121 · batas unggah IDE, PER-REQUEST. Registrasi global @fastify/multipart (app.ts:127)
// tetap 5 MB/12 berkas — itu milik lampiran gambar SPEC-816 dan tak boleh ikut naik.
const UPLOAD_LIMITS = {
  fileSize: 100 * 1024 * 1024, files: 1000, fields: 10, fieldSize: 1024 * 1024,
} as const;
const UPLOAD_TOTAL_MAX = 2 * 1024 * 1024 * 1024;
```

Tambahkan route sesudah route `entry`:

```ts
  // ADR-0121 · unggah N berkas. Urutan part adalah kontrak: dir → overwrite → manifest → berkas.
  // Manifest (array path relatif) dipakai alih-alih `filename` karena nama multipart ber-`/`
  // tak punya jaminan lintas implementasi; ia yang membawa struktur folder dari webkitRelativePath.
  app.post("/projects/:id/upload", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    // Anggaran total dibaca PER-REQUEST supaya bisa diturunkan di test tanpa mengirim 2 GB.
    // Bukan knob produk: tak ada UI maupun Setting yang menulisnya.
    const totalMax = Number(process.env.HANOMAN_IDE_UPLOAD_MAX_BYTES) || UPLOAD_TOTAL_MAX;
    let dir = "", overwrite = false, manifest: string[] | null = null, seen = 0, total = 0;
    const written: string[] = [];
    const skipped: { path: string; reason: "exists" | "too-large" | "budget" | "denied" }[] = [];

    for await (const part of (req as any).parts({ limits: UPLOAD_LIMITS })) {
      if (part.type === "field") {
        if (part.fieldname === "dir") dir = String(part.value ?? "");
        else if (part.fieldname === "overwrite") overwrite = part.value === "1" || part.value === "true";
        else if (part.fieldname === "manifest") {
          try {
            const parsed = JSON.parse(String(part.value));
            if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== "string")) throw new Error("bentuk");
            manifest = parsed as string[];
          } catch { return reply.code(400).send({ error: "manifest tak sah" }); }
        }
        continue;
      }
      const name = manifest ? manifest[seen] : (part.filename as string | undefined);
      seen++;
      if (name === undefined) {
        part.file.resume();   // kuras stream, kalau tidak busboy menggantung
        return reply.code(400).send({ error: "manifest tak cocok dengan berkas" });
      }
      // Path ditampilkan apa adanya di `skipped` supaya operator melihat yang ia kirim,
      // bukan bentuk ternormalkan yang tak ia kenali.
      let rel = name;
      try {
        rel = joinRel(dir, name);
        if (total >= totalMax) { part.file.resume(); skipped.push({ path: rel, reason: "budget" }); continue; }
        const r = await saveUpload(repoDir, rel, part.file, {
          overwrite, isTruncated: () => part.file.truncated === true });
        if (r.status === "written") { written.push(rel); total += Number(part.file.bytesRead ?? 0); }
        else skipped.push({ path: rel, reason: r.status });
      } catch {
        part.file.resume();
        skipped.push({ path: name, reason: "denied" });
      }
    }
    if (manifest && seen !== manifest.length)
      return reply.code(400).send({ error: "manifest tak cocok dengan berkas" });
    return { written, skipped };
  });
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/ide.route.test.ts --no-file-parallelism
pnpm --filter ./server typecheck
```
Expected: PASS semua, termasuk blok `entry` dari Task 2.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/ide.ts server/test/ide.route.test.ts
git commit -m "feat(ide): endpoint upload multipart — unggah berkas & folder ke checkout"
```

---

### Task 4: Klien API — path & method

**Files:**
- Modify: `shared/src/api.ts` (sesudah baris 75, bersama path IDE lain)
- Modify: `src/src/api/client.ts` (tipe di sekitar baris 60-90; method sesudah `putIdeFile` baris 263)
- Test: `src/test/api-client.test.ts`

**Interfaces:**
- Consumes: bentuk respons Task 2 & 3.
- Produces (dipakai Task 7-9):
  - `paths.ideEntry(id: string, path?: string): string`, `paths.ideUpload(id: string): string`
  - `type IdeUploadResult = { written: string[]; skipped: { path: string; reason: "exists" | "too-large" | "budget" | "denied" }[] }`
  - `api.ideCreateEntry(id: string, path: string, kind: "file" | "dir"): Promise<{ path: string }>`
  - `api.ideRenameEntry(id: string, from: string, to: string): Promise<{ from: string; to: string }>`
  - `api.ideDeleteEntry(id: string, path: string): Promise<{ path: string; kind: "file" | "dir" }>`
  - `api.ideUpload(id: string, dir: string, files: { path: string; file: File }[], overwrite?: boolean): Promise<IdeUploadResult>`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/api-client.test.ts`:

```ts
it("path operasi berkas IDE", () => {
  expect(paths.ideEntry("p1")).toBe("/api/projects/p1/entry");
  expect(paths.ideEntry("p1", "src/a b.ts")).toBe("/api/projects/p1/entry?path=src%2Fa%20b.ts");
  expect(paths.ideUpload("p1")).toBe("/api/projects/p1/upload");
});

it("ideUpload menyusun FormData: dir → overwrite → manifest → berkas", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ written: [], skipped: [] }), { status: 200 }) as any);
  await api.ideUpload("p1", "src/ds", [
    { path: "sub/a.ts", file: new File(["A"], "a.ts") },
    { path: "b.ts", file: new File(["B"], "b.ts") },
  ], true);
  const form = fetchMock.mock.calls[0]![1]!.body as FormData;
  expect([...form.keys()]).toEqual(["dir", "overwrite", "manifest", "file", "file"]);
  expect(form.get("dir")).toBe("src/ds");
  expect(form.get("overwrite")).toBe("1");
  expect(form.get("manifest")).toBe(JSON.stringify(["sub/a.ts", "b.ts"]));
});

it("ideUpload tanpa overwrite tak mengirim field-nya", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ written: [], skipped: [] }), { status: 200 }) as any);
  await api.ideUpload("p1", "", [{ path: "a.ts", file: new File(["A"], "a.ts") }]);
  const form = fetchMock.mock.calls[0]![1]!.body as FormData;
  expect([...form.keys()]).toEqual(["dir", "manifest", "file"]);
});
```

Pastikan berkas test itu mengimpor `vi`, `paths`, dan `api` (`import { paths } from "@hanoman/shared"` bila belum ada — ikuti impor yang sudah dipakai berkas itu).

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run src/test/api-client.test.ts
```
Expected: FAIL — `paths.ideEntry is not a function`.

- [x] **Step 3: Tambahkan path di `shared/src/api.ts`**

Sesudah baris `ideGit:` (baris 75):

```ts
  // ADR-0121 · operasi berkas Explorer: satu path untuk buat/rename/hapus, satu untuk unggah.
  ideEntry: (id: string, path?: string) =>
    `${API}/projects/${id}/entry${path ? `?path=${encodeURIComponent(path)}` : ""}`,
  ideUpload: (id: string) => `${API}/projects/${id}/upload`,
```

- [x] **Step 4: Tambahkan tipe & method di `src/src/api/client.ts`**

Tipe (dekat `RepoFile`/`WorkingStatus`, dan **ekspor**):

```ts
// ADR-0121 · unggahan selalu 200 selama badannya sah; kegagalan per-berkas hidup di `skipped`
// (pola POST /branches/delete), supaya satu berkas bentrok tak membatalkan 999 lainnya.
export type IdeUploadResult = {
  written: string[];
  skipped: { path: string; reason: "exists" | "too-large" | "budget" | "denied" }[];
};
```

Method, sesudah `putIdeFile` (baris 263):

```ts
  ideCreateEntry: (id: string, path: string, kind: "file" | "dir") =>
    j<{ path: string }>(paths.ideEntry(id), { method: "POST", ...body({ path, kind }) }),
  ideRenameEntry: (id: string, from: string, to: string) =>
    j<{ from: string; to: string }>(paths.ideEntry(id), { method: "PATCH", ...body({ from, to }) }),
  ideDeleteEntry: (id: string, path: string) =>
    j<{ path: string; kind: "file" | "dir" }>(paths.ideEntry(id, path), { method: "DELETE" }),
  // Urutan append ADALAH kontrak: server membaca manifest sebelum part berkas pertama.
  ideUpload: (id: string, dir: string, files: { path: string; file: File }[], overwrite = false) => {
    const form = new FormData();
    form.append("dir", dir);
    if (overwrite) form.append("overwrite", "1");
    form.append("manifest", JSON.stringify(files.map((f) => f.path)));
    for (const f of files) form.append("file", f.file, f.path.split("/").pop() || "berkas");
    return jUpload<IdeUploadResult>(paths.ideUpload(id), form);
  },
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run src/test/api-client.test.ts
pnpm --filter ./src typecheck
```
Expected: PASS. (Bila nama filter paket berbeda, pakai nama dari `package.json` paket frontend.)

- [x] **Step 6: Commit**

```bash
git add shared/src/api.ts src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(ide): klien API untuk entry & upload"
```

---

### Task 5: `ConfirmDialog` menerima `requireText`

**Files:**
- Modify: `src/src/ds/ConfirmDialog.tsx`
- Test: `src/test/confirm-dialog.test.tsx`

**Interfaces:**
- Produces: prop opsional `requireText?: string` — tombol konfirmasi nonaktif sampai isi input sama persis. Dipakai Task 9 untuk hapus folder.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/confirm-dialog.test.tsx`:

```ts
it("requireText mengunci konfirmasi sampai teksnya cocok", () => {
  const onConfirm = vi.fn();
  render(<ConfirmDialog open title="Hapus folder" requireText="src"
    onConfirm={onConfirm} onCancel={() => {}} />);
  const tombol = screen.getByRole("button", { name: "Hapus" });
  expect(tombol).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Ketik src untuk konfirmasi"), { target: { value: "sr" } });
  expect(tombol).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Ketik src untuk konfirmasi"), { target: { value: "src" } });
  expect(tombol).toBeEnabled();
  fireEvent.click(tombol);
  expect(onConfirm).toHaveBeenCalled();
});

it("tanpa requireText dialog lama tetap langsung bisa dikonfirmasi", () => {
  const onConfirm = vi.fn();
  render(<ConfirmDialog open title="Hapus" onConfirm={onConfirm} onCancel={() => {}} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
  expect(onConfirm).toHaveBeenCalled();
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run src/test/confirm-dialog.test.tsx
```
Expected: FAIL — tombol sudah enabled sejak awal / label input tak ditemukan.

- [x] **Step 3: Implementasikan**

Ganti isi `src/src/ds/ConfirmDialog.tsx`:

```tsx
// SPEC-269 · dialog konfirmasi reusable (di atas Modal). Dipakai untuk aksi hapus data.
// ADR-0121 · `requireText` untuk aksi yang tak bisa dibatalkan (hapus folder rekursif):
// tombol tetap mati sampai operator mengetik ulang namanya. Tanpa prop itu perilakunya
// identik dengan sebelumnya bagi seluruh pemakai lama.
import React from "react";
import { Modal } from "./kit";
import { Button, Input } from "./components/forms";

export function ConfirmDialog({
  open, title, message, eyebrow, confirmLabel = "Hapus", cancelLabel = "Batal",
  tone = "danger", busy = false, requireText, onConfirm, onCancel,
}: {
  open: boolean; title: React.ReactNode; message?: React.ReactNode; eyebrow?: React.ReactNode;
  confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "default"; busy?: boolean;
  requireText?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  // Dialog yang sama bisa dipakai ulang untuk target berbeda — kosongkan tiap kali ia dibuka
  // atau targetnya berganti, kalau tidak konfirmasi target lama ikut membuka target baru.
  React.useEffect(() => { setTyped(""); }, [open, requireText]);
  const locked = !!requireText && typed !== requireText;
  return (
    <Modal
      open={open} title={title} eyebrow={eyebrow} width={440}
      icon={tone === "danger" ? "trash-2" : "help-circle"}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button size="sm" variant="primary" leftIcon={tone === "danger" ? "trash-2" : "check"}
            onClick={onConfirm} disabled={busy || locked}>{confirmLabel}</Button>
        </>
      }>
      {message && <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55 }}>{message}</div>}
      {requireText && (
        <Input size="sm" value={typed} aria-label={`Ketik ${requireText} untuk konfirmasi`}
          placeholder={requireText} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
          style={{ marginTop: 12, width: "100%" }} />
      )}
    </Modal>
  );
}
```

Bila `Input` bukan ekspor `./components/forms`, ikuti jalur impor yang dipakai `IdeScreen.tsx` (`../ds`) — jangan mengimpor dari `../ds/index` di dalam `ds` sendiri karena itu impor melingkar.

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run src/test/confirm-dialog.test.tsx
```
Expected: PASS, termasuk seluruh test lama di berkas itu.

- [x] **Step 5: Commit**

```bash
git add src/src/ds/ConfirmDialog.tsx src/test/confirm-dialog.test.tsx
git commit -m "feat(ds): ConfirmDialog requireText untuk aksi tak terbatalkan"
```

---

### Task 6: Folder bisa dipilih di pohon

**Files:**
- Modify: `src/src/screens/file-tree.tsx:56-69` (cabang folder `TreeRow`)
- Test: `src/test/ide-file-ops.test.tsx` (baru)

**Interfaces:**
- Produces: `TreeRow` menerima `dirSelected?: string` dan `onSelectDir?: (p: string) => void`; keduanya opsional sehingga pemakaian di `ReviewScreen`/`ChangedSection` tak berubah.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/ide-file-ops.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildFileTree, TreeRow } from "../src/screens/file-tree";

describe("TreeRow · folder sebagai target", () => {
  it("klik folder memanggil onSelectDir dan menandainya", () => {
    const onSelectDir = vi.fn();
    const nodes = buildFileTree(["src/ds/a.ts"]);
    const { rerender } = render(
      <TreeRow node={nodes[0]!} selected="" onSelect={() => {}} dirSelected="" onSelectDir={onSelectDir} />);
    fireEvent.click(screen.getByText("src/"));
    expect(onSelectDir).toHaveBeenCalledWith("src");
    rerender(<TreeRow node={nodes[0]!} selected="" onSelect={() => {}} dirSelected="src" onSelectDir={onSelectDir} />);
    expect(screen.getByText("src/").closest("button")).toHaveStyle({ background: "var(--brass-100)" });
  });

  it("tanpa onSelectDir perilaku lama utuh: klik hanya buka-tutup", () => {
    const nodes = buildFileTree(["src/ds/a.ts"]);
    render(<TreeRow node={nodes[0]!} selected="" onSelect={() => {}} />);
    expect(screen.queryByText("ds/")).toBeNull();
    fireEvent.click(screen.getByText("src/"));
    expect(screen.getByText("ds/")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run src/test/ide-file-ops.test.tsx
```
Expected: FAIL — `onSelectDir` tak pernah dipanggil (prop belum ada).

- [x] **Step 3: Implementasikan**

Ganti cabang folder di `src/src/screens/file-tree.tsx` (baris 30-32 tanda tangan, 56-69 badan):

```tsx
export function TreeRow({ node, selected, onSelect, depth = 0, meta, defaultOpen = false, dirSelected, onSelectDir }:
  { node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number;
    meta?: Record<string, ChangedFile>; defaultOpen?: boolean;
    // ADR-0121 · folder sebagai TUJUAN operasi berkas. Opsional supaya pemakaian di Review
    // (ChangedSection) tak berubah sedikit pun.
    dirSelected?: string; onSelectDir?: (p: string) => void }) {
```

…dan badan cabang folder:

```tsx
  const dirOn = !!onSelectDir && node.path === dirSelected;
  return (
    <div>
      <button onClick={() => { setOpen((o) => !o); onSelectDir?.(node.path); }} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 6px", paddingLeft: 6 + depth * 12, border: "none",
        background: dirOn ? "var(--brass-100)" : "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color={dirOn ? "var(--brass-700)" : "var(--brass-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5,
          color: dirOn ? "var(--brass-700)" : "var(--text-strong)", fontWeight: dirOn ? 700 : 500 }}>{node.name}/</span>
      </button>
      {open && node.kids.map((k) => (
        <TreeRow key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1}
          meta={meta} defaultOpen={defaultOpen} dirSelected={dirSelected} onSelectDir={onSelectDir} />
      ))}
    </div>
  );
```

Catatan desain: satu klik **sekaligus** buka/tutup dan memilih. Memisahkan chevron jadi tombol tersendiri berarti tombol bersarang di dalam tombol — tak sah di HTML dan merusak navigasi keyboard.

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run src/test/ide-file-ops.test.tsx src/test/ide-screen.test.tsx src/test/review-screen.test.tsx
```
Expected: PASS. (Lewati berkas test yang memang tak ada di repo.)

- [x] **Step 5: Commit**

```bash
git add src/src/screens/file-tree.tsx src/test/ide-file-ops.test.tsx
git commit -m "feat(ide): folder di pohon Explorer bisa dipilih sebagai tujuan"
```

---

### Task 7: Baris aksi Explorer — buat berkas/folder & unggah

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx` (state di baris 76-101; pane Files di baris 250-275)
- Test: `src/test/ide-file-ops.test.tsx`

**Interfaces:**
- Consumes: `api.ideCreateEntry`, `api.ideUpload` (Task 4); `TreeRow` prop folder (Task 6).
- Produces: state `dirSel` + fungsi `runUpload(list, overwrite)` yang dipakai Task 8 (drop) dan `NameDialog` yang dipakai Task 9 (rename).

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/ide-file-ops.test.tsx`:

```tsx
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;
function mountIde() {
  vi.spyOn(api, "ideTree").mockResolvedValue({ ref: "", files: ["src/ds/a.ts", "README.md"] });
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main"], remotes: [] });
  vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
  return render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
}

describe("Explorer · buat & unggah", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("tujuan default root, berubah mengikuti folder terpilih", async () => {
    mountIde();
    expect(await screen.findByText("→ root")).toBeInTheDocument();
    fireEvent.click(screen.getByText("src/"));
    expect(await screen.findByText("→ src")).toBeInTheDocument();
  });

  it("File baru membuat berkas di folder terpilih lalu memuat ulang pohon", async () => {
    const create = vi.spyOn(api, "ideCreateEntry").mockResolvedValue({ path: "src/Baru.tsx" });
    mountIde();
    fireEvent.click(await screen.findByText("src/"));
    fireEvent.click(screen.getByRole("button", { name: /file baru/i }));
    fireEvent.change(screen.getByLabelText("Nama berkas"), { target: { value: "Baru.tsx" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("p1", "src/Baru.tsx", "file"));
    await waitFor(() => expect(api.ideTree).toHaveBeenCalledTimes(2));
  });

  it("Folder baru mengirim kind dir", async () => {
    const create = vi.spyOn(api, "ideCreateEntry").mockResolvedValue({ path: "kosong" });
    mountIde();
    await screen.findByText("README.md");
    fireEvent.click(screen.getByRole("button", { name: /folder baru/i }));
    fireEvent.change(screen.getByLabelText("Nama folder"), { target: { value: "kosong" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("p1", "kosong", "dir"));
  });

  it("unggah berkas memakai webkitRelativePath bila ada", async () => {
    const up = vi.spyOn(api, "ideUpload").mockResolvedValue({ written: ["src/a.txt"], skipped: [] });
    mountIde();
    await screen.findByText("README.md");
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    const f = new File(["A"], "a.txt");
    Object.defineProperty(f, "webkitRelativePath", { value: "" });
    Object.defineProperty(input, "files", { value: [f] });
    fireEvent.change(input);
    await waitFor(() => expect(up).toHaveBeenCalledWith("p1", "", [{ path: "a.txt", file: f }], false));
  });

  it("berkas bentrok memunculkan modal & Timpa semua mengirim ulang hanya yang bentrok", async () => {
    const up = vi.spyOn(api, "ideUpload")
      .mockResolvedValueOnce({ written: ["b.txt"], skipped: [{ path: "a.txt", reason: "exists" }] })
      .mockResolvedValueOnce({ written: ["a.txt"], skipped: [] });
    mountIde();
    await screen.findByText("README.md");
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    const fa = new File(["A"], "a.txt"), fb = new File(["B"], "b.txt");
    Object.defineProperty(input, "files", { value: [fa, fb] });
    fireEvent.change(input);
    fireEvent.click(await screen.findByRole("button", { name: /timpa semua/i }));
    await waitFor(() => expect(up).toHaveBeenLastCalledWith("p1", "", [{ path: "a.txt", file: fa }], true));
  });
});
```

Tambahkan `waitFor` ke impor `@testing-library/react` di berkas test itu.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run src/test/ide-file-ops.test.tsx -t "Explorer · buat & unggah"
```
Expected: FAIL — teks `→ root` dan tombol `File baru` tak ditemukan.

- [x] **Step 3: Tambahkan state & aksi di `IdeScreen`**

Impor tambahan di baris 6-14:

```tsx
import { Card, Button, Select, Icon, StateBlock, Tabs, Badge, DocDownload, DocPreviewModal, isMarkdownPath, ResponsivePanels, Modal, Input, ConfirmDialog } from "../ds";
import type { IdeUploadResult } from "../api/client";
```

State baru sesudah baris 101 (`panel`):

```tsx
  // ADR-0121 · tujuan operasi berkas. SENGAJA tak persisten: folder bisa lenyap di antara
  // kunjungan, dan memulihkan tujuan yang sudah tak ada membuat berkas mendarat entah di mana.
  const [dirSel, setDirSel] = React.useState("");
  const [nameDialog, setNameDialog] = React.useState<
    { mode: "file" | "dir" | "rename"; value: string } | null>(null);
  const [conflict, setConflict] = React.useState<{ files: { path: string; file: File }[] } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const dirInput = React.useRef<HTMLInputElement>(null);
  const canPickDir = typeof HTMLInputElement !== "undefined" && "webkitdirectory" in HTMLInputElement.prototype;
```

Fungsi, letakkan sesudah `save()` (sesudah baris 193):

```tsx
  const underDir = (p: string) => (dirSel ? `${dirSel}/${p}` : p);
  const afterWrite = () => { reloadTree(); reloadStatus(); };

  async function createEntry(kind: "file" | "dir", name: string) {
    const path = underDir(name.trim());
    if (!name.trim()) return;
    try { await api.ideCreateEntry(projectId, path, kind); afterWrite();
      onToast?.(`${kind === "dir" ? "folder" : "berkas"} dibuat · ${path}`, "ok", "file-plus"); }
    catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.(code === 409 ? `sudah ada · ${path}` : `gagal membuat ${path}`, "err", "x-circle");
    }
  }

  // Dipakai tombol unggah, drop, dan "Timpa semua". `list` memakai path RELATIF terhadap dirSel;
  // perbandingan dengan `skipped` karena itu lewat underDir(), bukan sebaliknya.
  async function runUpload(list: { path: string; file: File }[], overwrite = false) {
    if (!list.length) return;
    let r: IdeUploadResult;
    try { r = await api.ideUpload(projectId, dirSel, list, overwrite); }
    catch { onToast?.("gagal mengunggah", "err", "x-circle"); return; }
    afterWrite();
    const bentrok = new Set(r.skipped.filter((s) => s.reason === "exists").map((s) => s.path));
    const lain = r.skipped.filter((s) => s.reason !== "exists");
    if (r.written.length) onToast?.(`${r.written.length} berkas terunggah`, "ok", "upload");
    if (lain.length) onToast?.(`${lain.length} berkas dilewati · ${lain[0]!.reason}`, "warn", "alert-triangle");
    setConflict(bentrok.size ? { files: list.filter((f) => bentrok.has(underDir(f.path))) } : null);
  }

  const pickedFiles = (input: HTMLInputElement | null) => {
    const files = Array.from(input?.files ?? []);
    const list = files.map((f) => ({
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f }));
    if (input) input.value = "";   // pilih berkas yang sama dua kali harus tetap memicu change
    return list;
  };
```

- [x] **Step 4: Render baris aksi & sambungkan pohon**

Ganti header pane Files (baris 253-256) menjadi header lama **plus** baris aksi:

```tsx
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
              <span className="hn-eyebrow" style={{ flex: 1 }}>changes{status?.branch ? ` · ${status.branch}` : ""}</span>
              <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={afterWrite}>Muat ulang</Button>
            </div>
            {/* ADR-0121 · aksi berkas. Label tujuan wajib terlihat: tanpa itu folder tujuan jadi
                keadaan tersembunyi dan berkas mendarat di tempat yang tak diduga operator. */}
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
              padding: "8px 14px", borderBottom: "1px solid var(--border-hair)" }}>
              <Button size="sm" variant="ghost" leftIcon="file-plus"
                onClick={() => setNameDialog({ mode: "file", value: "" })}>File baru</Button>
              <Button size="sm" variant="ghost" leftIcon="folder-plus"
                onClick={() => setNameDialog({ mode: "dir", value: "" })}>Folder baru</Button>
              <Button size="sm" variant="ghost" leftIcon="upload"
                onClick={() => fileInput.current?.click()}>Unggah</Button>
              {canPickDir && (
                <Button size="sm" variant="ghost" leftIcon="folder-up"
                  onClick={() => dirInput.current?.click()}>Unggah folder</Button>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)" }}>
                → {dirSel || "root"}
              </span>
              <input ref={fileInput} type="file" multiple hidden
                onChange={() => void runUpload(pickedFiles(fileInput.current))} />
              <input ref={dirInput} type="file" hidden {...{ webkitdirectory: "" }}
                onChange={() => void runUpload(pickedFiles(dirInput.current))} />
            </div>
```

Sambungkan pohon (baris 271-273) supaya folder bisa dipilih:

```tsx
                : buildFileTree(files).map((n) => (
                    <TreeRow key={n.path} node={n} selected={selKind === "file" ? selected : ""}
                      onSelect={selectFile} dirSelected={dirSel} onSelectDir={setDirSel} />
                  ))}
```

Tambahkan dialog di dekat modal lain (sesudah baris 379):

```tsx
      {nameDialog && (
        <Modal open title={nameDialog.mode === "dir" ? "Folder baru" : nameDialog.mode === "file" ? "Berkas baru" : "Ganti nama"}
          eyebrow={nameDialog.mode === "rename" ? undefined : `→ ${dirSel || "root"}`}
          onClose={() => setNameDialog(null)} width={460} footer={<>
            <Button size="sm" variant="ghost" onClick={() => setNameDialog(null)}>Batal</Button>
            <Button size="sm" leftIcon="check" disabled={!nameDialog.value.trim()}
              onClick={() => { const d = nameDialog; setNameDialog(null);
                if (d.mode === "rename") void renameTarget(d.value); else void createEntry(d.mode, d.value); }}>Simpan</Button>
          </>}>
          <Input size="sm" autoFocus value={nameDialog.value}
            aria-label={nameDialog.mode === "dir" ? "Nama folder" : nameDialog.mode === "file" ? "Nama berkas" : "Path baru"}
            placeholder={nameDialog.mode === "dir" ? "komponen" : "Baru.tsx"}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNameDialog({ ...nameDialog, value: e.target.value })}
            style={{ width: "100%" }} />
        </Modal>
      )}
      {conflict && (
        <Modal open title={`${conflict.files.length} berkas sudah ada`} onClose={() => setConflict(null)} width={520}
          footer={<>
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>Biarkan</Button>
            <Button size="sm" leftIcon="alert-triangle"
              onClick={() => { const f = conflict.files; setConflict(null); void runUpload(f, true); }}>Timpa semua</Button>
          </>}>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
            Berkas berikut dilewati supaya perubahan yang belum di-commit tak hilang.
          </div>
          <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, maxHeight: 220, overflow: "auto" }}>
            {conflict.files.map((f) => underDir(f.path)).join("\n")}
          </pre>
        </Modal>
      )}
```

`renameTarget` baru lahir di Task 9. Supaya task ini berdiri sendiri, tambahkan lebih dulu bentuk minimalnya di dekat `createEntry`:

```tsx
  // Diisi penuh di task rename/hapus; sekarang cukup no-op supaya dialog nama satu bentuk.
  async function renameTarget(_to: string) { /* Task 9 */ }
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run src/test/ide-file-ops.test.tsx src/test/ide-screen.test.tsx
```
Expected: PASS semua, termasuk test IdeScreen lama.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/test/ide-file-ops.test.tsx
git commit -m "feat(ide): baris aksi Explorer — buat berkas/folder & unggah"
```

---

### Task 8: Drag & drop berkas/folder ke pohon

**Files:**
- Create: `src/src/screens/drop-entries.ts`
- Modify: `src/src/screens/IdeScreen.tsx` (pane pohon, `data-testid="ide-tree-scroll"`)
- Test: `src/test/drop-entries.test.ts` (baru), `src/test/ide-file-ops.test.tsx`

**Interfaces:**
- Produces: `readDroppedEntries(dt: DataTransfer): Promise<{ path: string; file: File }[]>` — membaca folder lewat `webkitGetAsEntry` dan jatuh ke `dt.files` bila API itu tak ada.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/drop-entries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readDroppedEntries } from "../src/screens/drop-entries";

const berkas = (name: string, body = "x") => new File([body], name);
function fileEntry(name: string, file: File) {
  return { isFile: true, isDirectory: false, name, file: (cb: (f: File) => void) => cb(file) };
}
function dirEntry(name: string, kids: unknown[]) {
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => { let sisa = kids; return { readEntries: (cb: (e: unknown[]) => void) => { const k = sisa; sisa = []; cb(k); } }; },
  };
}

describe("readDroppedEntries", () => {
  it("membaca folder bersarang jadi path relatif", async () => {
    const a = berkas("a.ts"), b = berkas("b.ts");
    const dt = { items: [{ kind: "file", webkitGetAsEntry: () => dirEntry("src", [fileEntry("a.ts", a), dirEntry("ds", [fileEntry("b.ts", b)])]) }],
      files: [] } as unknown as DataTransfer;
    expect(await readDroppedEntries(dt)).toEqual([
      { path: "src/a.ts", file: a }, { path: "src/ds/b.ts", file: b },
    ]);
  });

  it("tanpa webkitGetAsEntry jatuh ke daftar berkas datar", async () => {
    const a = berkas("a.ts");
    const dt = { items: undefined, files: [a] } as unknown as DataTransfer;
    expect(await readDroppedEntries(dt)).toEqual([{ path: "a.ts", file: a }]);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run src/test/drop-entries.test.ts
```
Expected: FAIL — modul tak ditemukan.

- [x] **Step 3: Implementasikan `drop-entries.ts`**

```ts
// ADR-0121 · membaca hasil drop jadi daftar { path relatif, File }. `webkitGetAsEntry` BUKAN
// standar — sebagian browser tak punya, karena itu daftar berkas datar (dt.files) adalah
// jalur mundurnya dan drop BERKAS selalu bekerja meski drop FOLDER tidak.
type Entry = {
  isFile: boolean; isDirectory: boolean; name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err?: (e: unknown) => void) => void };
};

const fileOf = (e: Entry) => new Promise<File | null>((res) => e.file?.((f) => res(f), () => res(null)) ?? res(null));

// readEntries memancarkan maksimal ~100 entri per panggilan; ia harus dipanggil sampai kosong.
const kidsOf = (e: Entry) => new Promise<Entry[]>((res) => {
  const reader = e.createReader?.();
  if (!reader) return res([]);
  const out: Entry[] = [];
  const baca = () => reader.readEntries((batch) => {
    if (!batch.length) return res(out);
    out.push(...batch);
    baca();
  }, () => res(out));
  baca();
});

async function walk(entry: Entry, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const f = await fileOf(entry);
    if (f) out.push({ path, file: f });
    return;
  }
  if (!entry.isDirectory) return;
  for (const kid of await kidsOf(entry)) await walk(kid, path, out);
}

export async function readDroppedEntries(dt: DataTransfer): Promise<{ path: string; file: File }[]> {
  const items = dt.items ? Array.from(dt.items as unknown as ArrayLike<DataTransferItem>) : [];
  const entries = items
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.())
    .filter((e): e is Entry => !!e);
  if (!entries.length) return Array.from(dt.files ?? []).map((f) => ({ path: f.name, file: f }));
  const out: { path: string; file: File }[] = [];
  for (const e of entries) await walk(e, "", out);
  return out;
}
```

- [x] **Step 4: Sambungkan ke pane pohon**

Di `IdeScreen.tsx`, impor `readDroppedEntries` dan tambahkan handler pada div `data-testid="ide-tree-scroll"` (baris 257):

```tsx
            <div data-testid="ide-tree-scroll"
              onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => { e.preventDefault(); setDropping(false);
                void readDroppedEntries(e.dataTransfer).then((list) => runUpload(list)); }}
              style={{ padding: 8, flex: "1 1 auto", minHeight: 0, overflow: "auto",
                outline: dropping ? "2px dashed var(--brass-500)" : "none", outlineOffset: -4 }}>
```

dengan state `const [dropping, setDropping] = React.useState(false);` di dekat `dirSel`.

Tambahkan test di `src/test/ide-file-ops.test.tsx`:

```tsx
  it("drop berkas mengunggahnya ke tujuan yang aktif", async () => {
    const up = vi.spyOn(api, "ideUpload").mockResolvedValue({ written: ["src/a.txt"], skipped: [] });
    mountIde();
    fireEvent.click(await screen.findByText("src/"));
    const f = new File(["A"], "a.txt");
    fireEvent.drop(screen.getByTestId("ide-tree-scroll"), { dataTransfer: { items: [], files: [f] } });
    await waitFor(() => expect(up).toHaveBeenCalledWith("p1", "src", [{ path: "a.txt", file: f }], false));
  });
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run src/test/drop-entries.test.ts src/test/ide-file-ops.test.tsx
```
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/src/screens/drop-entries.ts src/src/screens/IdeScreen.tsx src/test/drop-entries.test.ts src/test/ide-file-ops.test.tsx
git commit -m "feat(ide): seret berkas & folder ke pohon Explorer untuk mengunggah"
```

---

### Task 9: Rename & hapus dari Explorer

**Files:**
- Modify: `src/src/screens/IdeScreen.tsx`
- Test: `src/test/ide-file-ops.test.tsx`

**Interfaces:**
- Consumes: `api.ideRenameEntry`, `api.ideDeleteEntry` (Task 4); `ConfirmDialog requireText` (Task 5); `nameDialog` mode `"rename"` (Task 7).
- Produces: perilaku akhir fitur — tak ada task sesudah ini yang bergantung padanya.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/ide-file-ops.test.tsx`:

```tsx
describe("Explorer · rename & hapus", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rename berkas terpilih memindahkan seleksi viewer", async () => {
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
    const ren = vi.spyOn(api, "ideRenameEntry").mockResolvedValue({ from: "README.md", to: "BACA.md" });
    mountIde();
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(screen.getByRole("button", { name: /ganti nama/i }));
    fireEvent.change(screen.getByLabelText("Path baru"), { target: { value: "BACA.md" } });
    fireEvent.click(screen.getByRole("button", { name: /^simpan$/i }));
    await waitFor(() => expect(ren).toHaveBeenCalledWith("p1", "README.md", "BACA.md"));
    await waitFor(() => expect(api.ideFile).toHaveBeenCalledWith("p1", "BACA.md", ""));
  });

  it("hapus berkas cukup satu konfirmasi", async () => {
    const del = vi.spyOn(api, "ideDeleteEntry").mockResolvedValue({ path: "README.md", kind: "file" });
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
    mountIde();
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(screen.getByRole("button", { name: /hapus/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", "README.md"));
  });

  it("hapus folder menuntut nama diketik ulang", async () => {
    const del = vi.spyOn(api, "ideDeleteEntry").mockResolvedValue({ path: "src", kind: "dir" });
    mountIde();
    fireEvent.click(await screen.findByText("src/"));
    fireEvent.click(screen.getByRole("button", { name: /hapus/i }));
    const konfirm = await screen.findByRole("button", { name: "Hapus" });
    expect(konfirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Ketik src untuk konfirmasi"), { target: { value: "src" } });
    fireEvent.click(konfirm);
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1", "src"));
  });

  it("menghapus berkas yang sedang dibuka mengosongkan viewer", async () => {
    vi.spyOn(api, "ideDeleteEntry").mockResolvedValue({ path: "README.md", kind: "file" });
    vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
    mountIde();
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(screen.getByRole("button", { name: /hapus/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    expect(await screen.findByText(/pilih file dari pohon/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run src/test/ide-file-ops.test.tsx -t "rename & hapus"
```
Expected: FAIL — tombol "Ganti nama"/"Hapus" tak ada.

- [x] **Step 3: Implementasikan target, rename, dan hapus**

Ganti no-op `renameTarget` dari Task 7 dengan yang sebenarnya, dan tambahkan sesudahnya:

```tsx
  // Target aksi = berkas yang sedang dibuka bila ada, kalau tidak folder yang dipilih.
  // Diff dari Staged/Changed BUKAN target: yang ditampilkan di sana bisa berkas terhapus.
  const target = selKind === "file" && selected ? { path: selected, kind: "file" as const }
    : dirSel ? { path: dirSel, kind: "dir" as const } : null;

  async function renameTarget(to: string) {
    if (!target || !to.trim()) return;
    try {
      await api.ideRenameEntry(projectId, target.path, to.trim());
      afterWrite();
      if (target.kind === "file") setSelected(to.trim()); else setDirSel(to.trim());
      onToast?.(`diganti nama · ${to.trim()}`, "ok", "pencil");
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.(code === 409 ? "nama tujuan sudah dipakai" : "gagal mengganti nama", "err", "x-circle");
    }
  }

  async function deleteTarget() {
    if (!target) return;
    setPendingDelete(null);
    try {
      await api.ideDeleteEntry(projectId, target.path);
      afterWrite();
      if (target.kind === "file") { setSelected(""); setFile(null); } else setDirSel("");
      onToast?.(`dihapus · ${target.path}`, "ok", "trash-2");
    } catch { onToast?.(`gagal menghapus ${target.path}`, "err", "x-circle"); }
  }
```

dengan state `const [pendingDelete, setPendingDelete] = React.useState<{ path: string; kind: "file" | "dir" } | null>(null);`.

Tambahkan dua tombol di baris aksi (sesudah tombol "Unggah folder", sebelum `<span style={{ flex: 1 }} />`):

```tsx
              <Button size="sm" variant="ghost" leftIcon="pencil" disabled={!target}
                onClick={() => setNameDialog({ mode: "rename", value: target?.path ?? "" })}>Ganti nama</Button>
              <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={!target}
                onClick={() => setPendingDelete(target)}>Hapus</Button>
```

Tambahkan dialog konfirmasi di dekat modal lain:

```tsx
      {/* ADR-0121 · folder menuntut nama diketik ulang: penghapusannya rekursif dan yang belum
          di-commit tak bisa dipulihkan dari mana pun. */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.kind === "dir" ? "Hapus folder beserta isinya?" : "Hapus berkas?"}
        eyebrow={pendingDelete?.path}
        message={pendingDelete?.kind === "dir"
          ? "Seluruh isi folder ini hilang. Yang belum di-commit tak bisa dikembalikan."
          : "Yang belum di-commit tak bisa dikembalikan."}
        requireText={pendingDelete?.kind === "dir" ? pendingDelete.path.split("/").pop() : undefined}
        onConfirm={() => void deleteTarget()} onCancel={() => setPendingDelete(null)} />
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run src/test/ide-file-ops.test.tsx src/test/ide-screen.test.tsx src/test/confirm-dialog.test.tsx
pnpm --filter ./src typecheck
```
Expected: PASS semua.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/IdeScreen.tsx src/test/ide-file-ops.test.tsx
git commit -m "feat(ide): ganti nama & hapus berkas/folder dari Explorer"
```

---

### Task 10: Docs, ADR, dan uji endpoint nyata

**Files:**
- Create: `internal/docs/adr/0121-operasi-berkas-ide-explorer.md` (nomor diverifikasi di Step 1)
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/adr/README.md`

- [x] **Step 1: Pastikan nomor ADR belum direbut worktree lain**

```bash
ls internal/docs/adr/ | sort | tail -3
```
Expected: `0120-…` adalah yang tertinggi. Bila sudah ada `0121-…` milik pekerjaan lain, pakai nomor bebas berikutnya dan ganti seluruh sebutan "ADR-0121" di kode & docs (`grep -rn "ADR-0121" server/src src/src shared/src internal/docs docs`).

- [x] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0121-operasi-berkas-ide-explorer.md`:

```markdown
# ADR-0121 — Operasi berkas dari IDE Explorer

Status: accepted · 2026-08-17

## Konteks

IDE Explorer lahir sebagai viewer diff (SPEC-182/234). Permukaan tulisnya tepat satu endpoint —
`PUT /projects/:id/file` — yang hanya bisa menimpa isi berkas yang path-nya sudah diketahui.
Memasukkan berkas dari mesin operator, membuat berkas/folder, mengganti nama, dan menghapus
tak punya jalur sama sekali; satu-satunya jalan adalah sesi agen atau shell di mesin server.

## Keputusan

1. **Satu path untuk tiga operasi struktural.** `POST|PATCH|DELETE /projects/:id/entry`
   (buat · rename · hapus) plus `POST /projects/:id/upload` untuk unggahan multipart. Ketiga
   operasi struktural berbagi seluruh penjaga path yang sama; memecahnya jadi tiga endpoint
   berarti menyalin gerbang yang sama tiga kali — kelas bug SPEC-431/448/475.
2. **Logika di service murni `services/repo-fs.ts`**, di atas `safe-repo-path.ts` yang sudah
   ada. Penjaga path tak ditulis ulang. Konsekuensi yang diterima: komponen **symlink** ditolak,
   jadi berkas symlink tak bisa dihapus/di-rename lewat IDE.
3. **Otorisasi `ide:write`, bukan capability baru.** Capability itu sudah memberi hak menimpa
   isi berkas apa pun lewat `PUT /file`. Yang menjaga hapus/rename adalah **konfirmasi di UI**
   (folder menuntut namanya diketik ulang), bukan gerbang tambahan di server.
4. **Tanpa gerbang sesi aktif.** Alasan yang sama yang membebaskan `PUT /file` sejak awal: ini
   bukan operasi git dan tak memindahkan HEAD; sesi hidup di `.worktrees/<id>` yang terpisah.
   Memasangnya akan mematikan fitur ini persis pada project yang sedang dikerjakan.
5. **Folder kosong ditulis dengan `.gitkeep`.** Pohon Explorer dibangun dari `git ls-files`;
   tanpa `.gitkeep` folder baru adalah folder hantu yang hilang saat muat ulang.
6. **Unggahan di-stream, bentrok dilewati.** Part ditulis ke `.tmp` lalu di-`rename` (batas
   100 MB × 1000 berkas membuat `toBuffer` berbahaya di instance 8 GB). Berkas yang sudah ada
   dilewati kecuali `overwrite` diminta, dan dilaporkan di `skipped` pada respons 200 — pola
   `POST /branches/delete` (SPEC-360).

## Konsekuensi

- Operator bisa merusak checkout project dari dashboard tanpa sesi agen. Itu memang maksudnya;
  pagarnya konfirmasi, dan git tetap memegang segala yang sudah ter-commit.
- Tak ada undo/trash di sisi hanoman, tak ada `git add` otomatis: berkas baru muncul sebagai
  untracked di Changed dan siapa yang meng-commit tetap urusan pintu git yang sudah ada.
- Batas unggah route ini terpisah dari registrasi multipart global; menaikkan salah satunya
  tak menaikkan yang lain, dan itu disengaja (lampiran gambar SPEC-816 tetap 5 MB).
```

- [x] **Step 3: Perbarui api-contract**

Tambahkan ke `internal/docs/architecture/api-contract.md`, di bagian endpoint IDE:

```markdown
### Operasi berkas Explorer (ADR-0121)

| Method | Path | Badan | Respons |
|---|---|---|---|
| POST | `/api/projects/:id/entry` | `{ path, kind: "file" \| "dir" }` | 201 `{ path }` · 409 sudah ada |
| PATCH | `/api/projects/:id/entry` | `{ from, to }` | 200 `{ from, to }` · 404 · 409 · 400 tujuan di dalam sumber |
| DELETE | `/api/projects/:id/entry?path=<rel>` | — | 200 `{ path, kind }` · 404 |
| POST | `/api/projects/:id/upload` | multipart: `dir` → `overwrite` → `manifest` → N×`file` | 200 `{ written, skipped }` |

- Capability `ide:write` untuk keempatnya. **Tak** digerbang sesi aktif.
- `kind: "dir"` menulis `<folder>/.gitkeep` supaya foldernya terlihat git.
- `manifest` = JSON array path relatif, urutannya sama dengan urutan part berkas; tanpa
  manifest dipakai `filename` part. Jumlah tak cocok → 400.
- `skipped[].reason` ∈ `exists` · `too-large` (>100 MB) · `budget` (total >2 GB) · `denied`
  (ditolak penjaga path). Unggahan tetap 200 — kegagalan per-berkas hidup di badan.
- Path ditolak 400 bila absolut, kosong, ber-`..`, memuat komponen `.git`, atau menembus symlink.
```

- [x] **Step 4: Tautkan di index**

Di `internal/docs/README.md`, tambahkan satu baris di daftar ADR (di atas entri 0120):

```markdown
- [0121 — Operasi berkas dari IDE Explorer: satu path `entry`, unggah multipart di-stream, tanpa gerbang sesi](adr/0121-operasi-berkas-ide-explorer.md)
```

…dan satu entri di bagian **architecture**:

```markdown
- **Operasi berkas IDE Explorer (ADR-0121)** — buat/rename/hapus lewat `POST|PATCH|DELETE /projects/:id/entry`, unggah berkas & folder lewat `POST /projects/:id/upload` ([api-contract](architecture/api-contract.md)). Folder kosong ditulis dengan `.gitkeep` karena pohon Explorer dibangun dari `git ls-files`. Batas unggah route ini (100 MB/berkas, 1000 berkas, 2 GB total) terpisah dari registrasi multipart global 5 MB milik lampiran gambar SPEC-816.
```

Tambahkan juga narasi satu paragraf di `internal/docs/adr/README.md` mengikuti bentuk entri ADR di sekitarnya.

- [x] **Step 5: Uji endpoint nyata di local**

Boot server lalu curl keempat endpoint (AGENTS.md — sekali di akhir, bukan tiap task). Ganti
`<project>` dengan id project yang punya `repoDir`:

```bash
pnpm dev &   # atau: node server/dist/server.js
sleep 8
curl -s -X POST localhost:3000/api/projects/<project>/entry \
  -H 'content-type: application/json' -d '{"path":"tmp-uji/a.txt","kind":"file"}'
curl -s -X POST localhost:3000/api/projects/<project>/upload \
  -F dir=tmp-uji -F 'manifest=["b.txt"]' -F file=@README.md
curl -s -X PATCH localhost:3000/api/projects/<project>/entry \
  -H 'content-type: application/json' -d '{"from":"tmp-uji/a.txt","to":"tmp-uji/c.txt"}'
curl -s -X DELETE 'localhost:3000/api/projects/<project>/entry?path=tmp-uji'
```
Expected: `{"path":"tmp-uji/a.txt"}` · `{"written":["tmp-uji/b.txt"],"skipped":[]}` ·
`{"from":"tmp-uji/a.txt","to":"tmp-uji/c.txt"}` · `{"path":"tmp-uji","kind":"dir"}`.
Pastikan `tmp-uji` benar-benar lenyap dari checkout sesudahnya. Hentikan server per-PID
(`lsof -ti:3000 | xargs kill`) — **jangan** `pkill -f`, itu membunuh sesi agen tetangga (SPEC-402).

- [x] **Step 6: Jalankan seluruh test yang tersentuh sekali lagi**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run \
  server/test/repo-fs.test.ts server/test/ide.route.test.ts server/test/agent-capabilities.test.ts \
  src/test/ide-file-ops.test.tsx src/test/drop-entries.test.ts src/test/confirm-dialog.test.tsx \
  src/test/api-client.test.ts src/test/ide-screen.test.tsx --no-file-parallelism
```
Expected: PASS semua.

- [x] **Step 7: Commit**

```bash
git add internal/docs/
git commit -m "docs(adr-0121): operasi berkas IDE Explorer"
```
