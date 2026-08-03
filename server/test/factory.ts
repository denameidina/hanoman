import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { DEFAULT_SETTING } from "../src/services/settings";
import type { Setting } from "@hanoman/shared";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

// Fresh git repo seeded with { relPath: content }. Files are untracked-but-not-ignored,
// which `git ls-files --others --exclude-standard` lists — no commit needed.
export function makeTempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-doc-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

// Git repo dengan satu commit + branch tambahan (SPEC-143). `for-each-ref refs/heads` butuh
// commit: repo yang baru di-init belum punya branch apa pun, jadi makeTempRepo tak cukup.
export function makeRepoWithBranches(...branches: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-branch-"));
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "x"); g("add", "-A"); g("commit", "-qm", "init");
  g("branch", "-M", "main");
  for (const b of branches) g("branch", b);
  return dir;
}

// Repo dengan satu commit `main` (base) + worktree `.worktrees/<id>` detached di main,
// lalu `changes` diterapkan di worktree TANPA commit (persis keadaan sesi yang bekerja).
// value null = hapus file yang ada di base. Mengembalikan repoDir. (SPEC-171)
// opts.branch (SPEC-227): nama branch default repo — default "main". Repo dunia nyata bisa
// ber-default `master`/`develop`; review tak boleh hardcode "main".
export function makeRepoWithWorktree(specId: string, base: Record<string, string>, changes: Record<string, string | null>, opts: { branch?: string } = {}): string {
  const branch = opts.branch ?? "main";
  const dir = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
  const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
  g(dir, "init", "-q"); g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
  for (const [rel, content] of Object.entries(base)) {
    const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
  }
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "base"); g(dir, "branch", "-M", branch);
  const id = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const wt = join(dir, ".worktrees", id);
  g(dir, "worktree", "add", "--detach", "-q", wt, branch);
  for (const [rel, content] of Object.entries(changes)) {
    const abs = join(wt, rel);
    if (content === null) { rmSync(abs, { force: true }); continue; }
    mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
  }
  return dir;
}

// Repo dengan commit ber-tag `(spec-N)` di pesan, TANPA worktree — persis keadaan item selesai:
// worktree & branch sudah lenyap, tapi commit-nya tinggal di history. Tiap commit menerapkan
// `changes` (null = hapus). Mengembalikan repoDir. (review done spec)
export function makeRepoWithSpecCommits(
  base: Record<string, string>,
  commits: { msg: string; changes: Record<string, string | null> }[],
): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-hist-"));
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  const apply = (changes: Record<string, string | null>) => {
    for (const [rel, content] of Object.entries(changes)) {
      const abs = join(dir, rel);
      if (content === null) { rmSync(abs, { force: true }); continue; }
      mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
    }
  };
  apply(base); g("add", "-A"); g("commit", "-qm", "base"); g("branch", "-M", "main");
  for (const c of commits) { apply(c.changes); g("add", "-A"); g("commit", "-qm", c.msg); }
  return dir;
}

// SPEC-234 · repo dengan satu commit base lalu keadaan working tree bercampur:
//   staged.txt  = tracked, dimodifikasi & `git add` (STAGED, index vs HEAD)
//   tracked.txt = tracked, dimodifikasi TANPA add (CHANGED unstaged, working tree vs index)
//   new.txt     = untracked (CHANGED unstaged, muncul via temp-index intent-to-add)
// HEAD di main. Mengembalikan repoDir.
export function makeRepoWithChanges(): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-chg-"));
  const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "staged.txt"), "one\n");
  writeFileSync(join(dir, "tracked.txt"), "keep\n");
  g("add", "-A"); g("commit", "-qm", "base");
  writeFileSync(join(dir, "staged.txt"), "one\ntwo\n"); g("add", "staged.txt"); // staged M
  writeFileSync(join(dir, "tracked.txt"), "keep\nmore\n");                       // unstaged M
  writeFileSync(join(dir, "new.txt"), "brand\nnew\n");                            // untracked → A
  return dir;
}

// Repo dengan bare origin + branch main (base) + branch hanoman/<id> berisi kerja spec, keduanya
// di-push ke origin (refs/remotes/origin/* terisi). Persis keadaan sebuah done spec: kerja ada di
// origin/hanoman/<id>. Opsi:
//   base        = file di commit base main (default { "file.txt": "base\n" })
//   work        = perubahan di branch hanoman/<id>, satu commit (default { "work.txt": "work\n" })
//   mainAdvance = commit tambahan di main SETELAH bercabang; file yang sama dgn `work` → konflik,
//                 file lain → maju bersih (default: tak ada)
//   localBranches = branch lokal tambahan dari tip main saat itu, TAK di-checkout (uji merge→lokal)
export function makeRepoWithSpecBranch(
  specId: string,
  opts: {
    base?: Record<string, string>;
    work?: Record<string, string | null>;
    mainAdvance?: Record<string, string | null>;
    localBranches?: string[];
  } = {},
): { repoDir: string; origin: string } {
  const base = opts.base ?? { "file.txt": "base\n" };
  const work = opts.work ?? { "work.txt": "work\n" };
  const origin = mkdtempSync(join(tmpdir(), "hanoman-origin-"));
  const repoDir = mkdtempSync(join(tmpdir(), "hanoman-src-"));
  const g = (cwd: string, ...a: string[]) => {
    const r = spawnSync("git", a, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const apply = (dir: string, changes: Record<string, string | null>) => {
    for (const [rel, content] of Object.entries(changes)) {
      const abs = join(dir, rel);
      if (content === null) { rmSync(abs, { force: true }); continue; }
      mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content);
    }
  };
  g(origin, "init", "-q", "--bare", "-b", "main");
  g(repoDir, "init", "-q", "-b", "main");
  g(repoDir, "config", "user.email", "t@t"); g(repoDir, "config", "user.name", "t");
  g(repoDir, "remote", "add", "origin", origin);
  apply(repoDir, base); g(repoDir, "add", "-A"); g(repoDir, "commit", "-qm", "base");
  const branch = `hanoman/${specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  g(repoDir, "checkout", "-q", "-b", branch);
  apply(repoDir, work); g(repoDir, "add", "-A"); g(repoDir, "commit", "-qm", `feat(${specId}): work`);
  g(repoDir, "checkout", "-q", "main");
  if (opts.mainAdvance) { apply(repoDir, opts.mainAdvance); g(repoDir, "add", "-A"); g(repoDir, "commit", "-qm", "main advance"); }
  for (const b of opts.localBranches ?? []) g(repoDir, "branch", b);
  g(repoDir, "push", "-q", "origin", "main", branch); // memperbarui refs/remotes/origin/*
  return { repoDir, origin };
}

// Truncate every table in FK-safe order (mirrors the deleted seed()).
export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.changelog.deleteMany(),   // SPEC-516 · ADR-0105
    prisma.notification.deleteMany(),
    prisma.spec.deleteMany(), prisma.setting.deleteMany(), prisma.project.deleteMany(),
    prisma.vps.deleteMany(),
  ]);
}

export function makeVps(over: Partial<Prisma.VpsCreateInput> = {}) {
  return prisma.vps.create({ data: {
    name: "vps1", host: "203.0.113.10", user: "deploy", ...over } });
}

export function makeProject(over: Partial<Prisma.ProjectCreateManyInput> = {}) {
  return prisma.project.create({ data: {
    id: "p1", name: "p1", desc: "test project", kind: "existing",
    stack: "", ...over } });
}

export function makeSpec(over: Partial<Prisma.SpecCreateManyInput> = {}) {
  return prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "test spec", source: "brief",
    stage: "planned", author: "Rangga", priority: "sedang", objective: "", ...over } });
}

export function makeSetting(over: Partial<Setting> = {}) {
  const data = { ...DEFAULT_SETTING, ...over } as unknown as Prisma.InputJsonValue;
  return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}
