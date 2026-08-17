// ADR-0121 · buat/rename/hapus/unggah isi checkout project dari IDE Explorer.
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

const clean = (s: string) => s.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

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
