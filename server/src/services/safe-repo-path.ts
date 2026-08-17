import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export class PathContainmentError extends Error {
  readonly code = "PATH_CONTAINMENT";
}
const denied = (detail: string): never => { throw new PathContainmentError(`repository path ditolak: ${detail}`); };

function components(rel: string): string[] {
  if (!rel || isAbsolute(rel) || rel.includes("\0")) denied("path invalid");
  const parts = rel.replace(/\\/g, "/").split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) denied("parent/empty component");
  return parts;
}

async function canonicalRoot(root: string): Promise<string> {
  const out = await realpath(root).catch(() => denied("root tidak ada"));
  const stat = await lstat(out);
  if (!stat.isDirectory() || stat.isSymbolicLink()) denied("root bukan direktori regular");
  return out;
}

function beneath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export async function ensureRepoParents(root: string, rel: string): Promise<void> {
  const base = await canonicalRoot(root);
  const parts = components(rel).slice(0, -1);
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) denied("parent tidak aman");
    const canonical = await realpath(current);
    if (!beneath(base, canonical) || canonical !== current) denied("parent keluar root");
  }
}

function ensureRepoParentsSync(root: string, rel: string): void {
  const base = realpathSync(root);
  const parts = components(rel).slice(0, -1);
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) denied("parent tidak aman");
    if (realpathSync(current) !== current || !beneath(base, current)) denied("parent keluar root");
  }
}

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

export function assertSafeRepoPathSync(root: string, rel: string, allowMissingFinal = false, allowMissingTail = false): string {
  const base = realpathSync(root);
  const parts = components(rel);
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) denied("symlink");
      if (i < parts.length - 1 && !stat.isDirectory()) denied("parent bukan direktori");
    } catch (error) {
      if (allowMissingTail && (error as NodeJS.ErrnoException).code === "ENOENT") break;
      if (allowMissingFinal && (error as NodeJS.ErrnoException).code === "ENOENT" && i === parts.length - 1) break;
      throw error;
    }
  }
  if (!beneath(base, resolve(current))) denied("keluar root");
  return current;
}

export function readRepoFileSync(root: string, rel: string): Buffer {
  const path = assertSafeRepoPathSync(root, rel);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) denied("bukan file regular");
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

export function writeRepoFileAtomicSync(root: string, rel: string, data: Buffer | string): void {
  ensureRepoParentsSync(root, rel);
  const path = assertSafeRepoPathSync(root, rel, true);
  const parent = resolve(path, "..");
  const parentRel = relative(realpathSync(root), parent);
  if (parentRel) assertSafeRepoPathSync(root, parentRel);
  const temp = join(parent, `.hanoman-${randomUUID()}.tmp`);
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { writeFileSync(fd, data); }
  finally { closeSync(fd); }
  try {
    const final = (() => { try { return lstatSync(path); } catch { return null; } })();
    if (final?.isSymbolicLink() || (final && !final.isFile())) denied("target berubah");
    renameSync(temp, path);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* already gone */ }
    throw error;
  }
}

export async function readRepoFile(root: string, rel: string): Promise<Buffer> {
  const entry = await resolveRepoEntry(root, rel);
  const handle = await open(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    .catch(() => denied("final component tidak aman"));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) denied("bukan file regular");
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function writeRepoFileAtomic(root: string, rel: string, data: Buffer | string): Promise<void> {
  await ensureRepoParents(root, rel);
  const entry = await resolveRepoEntry(root, rel, { allowMissingFinal: true });
  const current = await lstat(entry.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    return denied("final component tak terbaca");
  });
  if (current?.isSymbolicLink() || (current && !current.isFile())) denied("target bukan file regular");
  await mkdir(entry.parent, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const temp = join(entry.parent, `.hanoman-${randomUUID()}.tmp`);
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(data); await handle.sync(); }
  finally { await handle.close(); }
  try {
    const parentAgain = await realpath(entry.parent);
    if (parentAgain !== entry.parent || !beneath(entry.root, parentAgain)) denied("parent berubah");
    const finalAgain = await lstat(entry.path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : denied("target berubah"));
    if (finalAgain?.isSymbolicLink() || (finalAgain && !finalAgain.isFile())) denied("target berubah");
    await rename(temp, entry.path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
