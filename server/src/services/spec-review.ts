import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { readRepoFile as readSafeRepoFile } from "./safe-repo-path";

// SPEC-171 · review worktree backlog item: all files (ls-files) + file changed
// (diff atas merge-base). Diturunkan dari git tiap request, tak disimpan. Mekanik
// diff mengikuti SPEC-144 (index sementara + `git add -A -N` untuk untracked).
//
// execFile di-promisify, maxBuffer 1<<24: preseden services/scan.ts — spawn blocking
// akan menghentikan seluruh event loop server.
const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const MAX = 256 * 1024;

export type ChangedFile = { path: string; add: number; del: number; status: "A" | "M" | "D"; binary: boolean };
export type SpecReview = { base: string; files: string[]; changed: ChangedFile[] };
export type ReviewFile = {
  path: string; status: "A" | "M" | "D" | null; binary: boolean;
  truncated: boolean; diff: string | null; content: string | null;
};

// ponytail: normalisasi id sama dengan pty.ts idFor & terminal.ts; ekstrak kalau muncul consumer keempat.
export const worktreeDir = (repoDir: string, specId: string): string =>
  join(repoDir, ".worktrees", specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));

// `git add -A -N` (intent-to-add) di salinan index sementara: file untracked masuk hitungan
// diff TANPA menghash isi ke object database, dan index worktree hidup tak tersentuh (SPEC-144).
export async function withTempIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const idx = (await exec("git", ["rev-parse", "--git-path", "index"], { cwd: wt, ...GIT })).stdout.trim();
  const dir = await mkdtemp(join(tmpdir(), "hanoman-idx-"));
  const tmp = join(dir, "index");
  await copyFile(resolve(wt, idx), tmp);
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try { await exec("git", ["add", "-A", "-N"], { cwd: wt, env, ...GIT }); return await fn(env); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const splitZ = (s: string): string[] => s.split("\0").filter(Boolean);

// SPEC-176 · ADR-0030 · apakah SHA masih ada di object database? `cat-file -e` exit 0 = ada.
// Menjaga review done tak crash bila objek head/base sudah di-`git gc` (branch run dibuang
// sebelum di-merge) — pemanggil jatuh ke fallback/409, bukan 500.
export async function shaResolvable(repoDir: string, sha: string): Promise<boolean> {
  return exec("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoDir, ...GIT })
    .then(() => true).catch(() => false);
}

// SPEC-197 · --end-of-options: rev bisa dari DB (baseSha/branchFrom) & berbentuk `-`; --verify
// mendahului --end-of-options (urutan mengikat, cermin runner/src/git.ts). exit≠0 → tak resolve.
async function revOk(wt: string, rev: string): Promise<boolean> {
  return exec("git", ["rev-parse", "--verify", "-q", "--end-of-options", `${rev}^{commit}`], { cwd: wt, ...GIT })
    .then(() => true).catch(() => false);
}

// SPEC-227 · basis diff worktree hidup, prioritas: baseSha (commit detach worktree, SPEC-176/
// ADR-0030 — titik fork sesi yang tepat & selalu resolve) → branchFrom eksplisit → default repo
// `main`/`master`. TAK PERNAH hardcode "main": repo target belum tentu punya branch itu (default
// bisa master/develop), sama seperti fallback HEAD di terminal.ts (SPEC-197). HEAD = jaring
// pengaman terakhir: merge-base(HEAD, HEAD) = HEAD → diff perubahan tak-commit, bukan 500.
async function mergeBase(wt: string, baseSha: string | null, branchFrom: string | null): Promise<string> {
  const candidates = [baseSha, branchFrom, "main", "master"].filter((c): c is string => !!c);
  let base = "HEAD";
  for (const c of candidates) if (await revOk(wt, c)) { base = c; break; }
  const { stdout } = await exec("git", ["merge-base", "--end-of-options", base, "HEAD"], { cwd: wt, ...GIT });
  return stdout.trim();
}

// File yang ADA di worktree = tracked ∪ untracked-tak-ignored, minus yang dihapus dari
// working tree (masih di index, jadi `ls-files` polos tetap menyebutnya). Cermin explorer
// VSCode: file yang dihapus tampil di panel Changed, bukan di pohon file.
async function allFiles(wt: string): Promise<string[]> {
  const [tracked, untracked, deleted] = await Promise.all([
    exec("git", ["ls-files", "-z"], { cwd: wt, ...GIT }),
    exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: wt, ...GIT }),
    exec("git", ["ls-files", "--deleted", "-z"], { cwd: wt, ...GIT }),
  ]);
  const gone = new Set(splitZ(deleted.stdout));
  return [...new Set([...splitZ(tracked.stdout), ...splitZ(untracked.stdout)])]
    .filter((p) => !gone.has(p)).sort();
}

// revs = [base] (base vs working-tree lewat temp index) ATAU [base, head] (dua commit).
export async function changedFiles(cwd: string, revs: string[], env?: NodeJS.ProcessEnv): Promise<ChangedFile[]> {
  const opts = { cwd, ...(env ? { env } : {}), ...GIT };
  const [num, name] = await Promise.all([
    exec("git", ["diff", "--numstat", "-z", "--no-renames", ...revs], opts),
    exec("git", ["diff", "--name-status", "-z", "--no-renames", ...revs], opts),
  ]);
  const map = new Map<string, ChangedFile>();
  // --numstat -z: `add \t del \t path` \0. Binary = `-`/`-` — cek SEBELUM Number() (kalau tidak: NaN).
  for (const rec of splitZ(num.stdout)) {
    const tab = rec.indexOf("\t"), tab2 = rec.indexOf("\t", tab + 1);
    const add = rec.slice(0, tab), del = rec.slice(tab + 1, tab2), path = rec.slice(tab2 + 1);
    const binary = add === "-" && del === "-";
    map.set(path, { path, add: binary ? 0 : Number(add), del: binary ? 0 : Number(del), status: "M", binary });
  }
  // --name-status -z: `status` \0 `path` \0. status[0] = A|M|D (--no-renames → tak ada R/C).
  const toks = splitZ(name.stdout);
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const st = toks[i]![0] as "A" | "M" | "D";
    const path = toks[i + 1]!;
    const cf = map.get(path) ?? { path, add: 0, del: 0, status: st, binary: false };
    cf.status = st;
    map.set(path, cf);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function specReview(repoDir: string, specId: string, baseSha: string | null, branchFrom: string | null): Promise<SpecReview> {
  const wt = worktreeDir(repoDir, specId);
  const base = await mergeBase(wt, baseSha, branchFrom);
  const files = await allFiles(wt);
  const changed = await withTempIndex(wt, (env) => changedFiles(wt, [base], env));
  return { base, files, changed };
}

// ── Done spec: worktree & branch sudah lenyap, tapi commit-nya ada di history dengan konvensi
// pesan `type(spec-N): …` (CLAUDE.md). Range `oldest^..newest` = tepat yang diubah spec ini
// SELAMA commit-nya kontigu (satu run per backlog, merge berurutan — terverifikasi di repo ini).
// ponytail: asumsi kontigu. History terjalin (dua spec dikerjakan berselang) akan over-report;
//           upgrade-nya simpan base/head commit di Spec saat run selesai.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git hash-object -t tree /dev/null

export async function specCommitRange(
  repoDir: string, specId: string,
): Promise<{ base: string; head: string } | null> {
  const { stdout } = await exec(
    "git", ["log", "--all", "-i", "-F", `--grep=(${specId})`, "--format=%H"], { cwd: repoDir, ...GIT });
  const shas = stdout.split("\n").map((s) => s.trim()).filter(Boolean); // newest → oldest
  if (!shas.length) return null;
  const oldest = shas[shas.length - 1]!;
  const base = await exec("git", ["rev-parse", "--verify", "-q", `${oldest}^`], { cwd: repoDir, ...GIT })
    .then((r) => r.stdout.trim())
    .catch(() => EMPTY_TREE); // commit pertama = root → diff atas pohon kosong (semua "added")
  return { base, head: shas[0]! };
}

async function filesAt(repoDir: string, head: string): Promise<string[]> {
  const { stdout } = await exec("git", ["ls-tree", "-r", "--name-only", "-z", head], { cwd: repoDir, ...GIT });
  return splitZ(stdout).sort();
}

export async function specReviewRange(repoDir: string, base: string, head: string): Promise<SpecReview> {
  const [files, changed] = await Promise.all([
    filesAt(repoDir, head),
    changedFiles(repoDir, [base, head]),
  ]);
  return { base, files, changed };
}

export async function reviewFileRange(
  repoDir: string, base: string, head: string, path: string,
): Promise<ReviewFile | null> {
  const { files, changed } = await specReviewRange(repoDir, base, head);
  const cf = changed.find((c) => c.path === path);
  if (!cf && !files.includes(path)) return null; // gerbang path → route 404
  if (cf?.binary) return { path, status: cf.status, binary: true, truncated: false, diff: null, content: null };
  const status = cf?.status ?? null;
  const diffRaw = (await exec("git", ["diff", base, head, "--", path], { cwd: repoDir, ...GIT })).stdout;
  let contentRaw: string | null = null;
  if (status !== "D") {
    try { contentRaw = (await exec("git", ["show", `${head}:${path}`], { cwd: repoDir, ...GIT })).stdout; }
    catch { contentRaw = null; }
  }
  return {
    path, status, binary: false,
    truncated: diffRaw.length > MAX || (contentRaw?.length ?? 0) > MAX,
    diff: diffRaw.slice(0, MAX),
    content: contentRaw === null ? null : contentRaw.slice(0, MAX),
  };
}

export async function reviewFile(
  repoDir: string, specId: string, baseSha: string | null, branchFrom: string | null, path: string,
): Promise<ReviewFile | null> {
  const wt = worktreeDir(repoDir, specId);
  const { base, files, changed } = await specReview(repoDir, specId, baseSha, branchFrom);
  const cf = changed.find((c) => c.path === path);
  if (!cf && !files.includes(path)) return null; // gerbang path → route 404
  if (cf?.binary) return { path, status: cf.status, binary: true, truncated: false, diff: null, content: null };
  const status = cf?.status ?? null;
  const diffRaw = await withTempIndex(wt, async (env) =>
    (await exec("git", ["diff", base, "--", path], { cwd: wt, env, ...GIT })).stdout);
  let contentRaw: string | null = null;
  if (status !== "D") { try { contentRaw = (await readSafeRepoFile(wt, path)).toString("utf8"); } catch { contentRaw = null; } }
  return {
    path, status, binary: false,
    truncated: diffRaw.length > MAX || (contentRaw?.length ?? 0) > MAX,
    diff: diffRaw.slice(0, MAX),
    content: contentRaw === null ? null : contentRaw.slice(0, MAX),
  };
}
