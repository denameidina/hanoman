import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { changedFiles, withTempIndex, type ChangedFile, type ReviewFile } from "./spec-review";
import { assertSafeRepoPathSync, readRepoFile as readSafeRepoFile, writeRepoFileAtomic } from "./safe-repo-path";
// SPEC-908 · tiga tipe ini dulu dideklarasikan KEMBAR di sini dan di src/src/api/client.ts.
// Frame `git` di EventMsg memaksa keduanya jadi satu definisi di @hanoman/shared.
import type { GraphCommit, RepoStatus, Stash, TopicParams } from "@hanoman/shared";
export type { GraphCommit, RepoStatus, Stash } from "@hanoman/shared";

const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24 } as const;
const MAX = 256 * 1024;

const splitZ = (s: string): string[] => s.split("\0").filter(Boolean);

// Path guard umum (bukan hanya .md seperti scan.docAbsPath). Cermin logikanya: resolve,
// cegah keluar repo, cegah menyentuh .git. Throw → route menerjemahkan ke 400.
export function repoAbsPath(repoDir: string, rel: string, allowMissingFinal = false): string {
  if (rel.split(/[\\/]/).includes(".git")) throw new Error("tidak boleh menyentuh .git");
  assertSafeRepoPathSync(repoDir, rel, allowMissingFinal, true);
  return resolve(repoDir, rel);
}

// Daftar file: working tree (ref kosong, honor .gitignore) atau snapshot di ref.
export async function listRepoTree(repoDir: string | null, ref = ""): Promise<string[]> {
  if (!repoDir || !existsSync(repoDir)) return [];
  try {
    const { stdout } = ref
      ? await exec("git", ["ls-tree", "-r", "--name-only", "-z", ref], { cwd: repoDir, ...GIT })
      : await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repoDir, ...GIT });
    return [...new Set(splitZ(stdout))].sort();
  } catch { return []; }
}

export type IgnoredEntries = { files: string[]; dirs: string[] };

/**
 * Entri yang .gitignore sembunyikan dari `listRepoTree`. `--directory --no-empty-directory`
 * MERUNTUHKAN direktori yang seluruhnya diabaikan menjadi SATU entri: di repo ini 22 686 berkas
 * (2,0 MB path) menjadi 34 entri. Tanpa peruntuhan itu, menyalakan toggle berarti mengirim
 * seluruh isi node_modules ke browser setiap kali — jadi isinya dibuka belakangan, satu tingkat
 * per klik, lewat `listDirEntries`.
 *
 * Ref tak punya berkas terabaikan (yang diabaikan tak pernah masuk commit), jadi ini khusus
 * working tree — pemanggilnya yang menjaga itu.
 */
export async function listIgnoredEntries(repoDir: string | null): Promise<IgnoredEntries> {
  const empty: IgnoredEntries = { files: [], dirs: [] };
  if (!repoDir || !existsSync(repoDir)) return empty;
  try {
    const { stdout } = await exec("git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory", "-z"],
      { cwd: repoDir, ...GIT });
    const files: string[] = [], dirs: string[] = [];
    for (const e of new Set(splitZ(stdout))) {
      // git menandai direktori dengan garis miring di ekor; buildFileTree memakai path tanpa itu.
      if (e.endsWith("/")) dirs.push(e.slice(0, -1)); else files.push(e);
    }
    return { files: files.sort(), dirs: dirs.sort() };
  } catch { return empty; }
}

const DIR_ENTRY_MAX = 5000;

/**
 * Isi SATU tingkat sebuah direktori, langsung dari disk. Dipakai untuk membuka direktori
 * terabaikan yang diruntuhkan di atas: apa pun di dalamnya juga terabaikan, jadi git tak punya
 * jawaban yang lebih baik daripada readdir — dan readdir tak pernah melebar melampaui satu tingkat.
 */
export async function listDirEntries(repoDir: string | null, rel: string): Promise<IgnoredEntries & { truncated: boolean }> {
  const empty = { files: [], dirs: [], truncated: false };
  if (!repoDir) return empty;
  const abs = repoAbsPath(repoDir, rel); // throw → route 400
  let raw;
  try { raw = await readdir(abs, { withFileTypes: true }); } catch { return empty; }
  const files: string[] = [], dirs: string[] = [];
  for (const d of raw.slice(0, DIR_ENTRY_MAX)) {
    if (d.name === ".git") continue; // repoAbsPath menolaknya juga; ini menjaga daftarnya bersih
    (d.isDirectory() ? dirs : files).push(`${rel}/${d.name}`);
  }
  return { files: files.sort(), dirs: dirs.sort(), truncated: raw.length > DIR_ENTRY_MAX };
}

export type RepoFile = { path: string; content: string | null; binary: boolean; truncated: boolean };

// Isi file: disk (ref kosong) atau `git show <ref>:<path>`. Path buruk → throw (route 400).
// File tak ada → null (route 404). NUL byte → binary (heuristik).
// ponytail: deteksi biner via NUL byte; cukup untuk viewer, upgrade ke gitattributes bila perlu.
export async function readRepoFile(repoDir: string | null, rel: string, ref = ""): Promise<RepoFile | null> {
  if (!repoDir) return null;
  repoAbsPath(repoDir, rel, !!ref); // snapshots may contain a path absent from the working tree
  let raw: string;
  try {
    raw = ref
      ? (await exec("git", ["show", `${ref}:${rel}`], { cwd: repoDir, ...GIT })).stdout
      : (await readSafeRepoFile(repoDir, rel)).toString("utf8");
  } catch { return null; }
  if (raw.includes("\u0000")) return { path: rel, content: null, binary: true, truncated: false };
  return { path: rel, content: raw.slice(0, MAX), binary: false, truncated: raw.length > MAX };
}

const US = "\x1f"; // unit separator dalam satu baris commit


async function currentBranch(repoDir: string): Promise<string> {
  return exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir, ...GIT })
    .then((r) => r.stdout.trim()).catch(() => "");
}

// SPEC-233 · status working tree untuk baris "uncommitted changes" di graph. `git status --porcelain=v1
// -z -b`: record `## <branch>...<up> [ahead N, behind M]` lalu tiap entri `XY<space>path` (rename →
// path sumber di token NUL berikut, dilewati). X=index (staged), Y=worktree (unstaged), ?? = untracked.
export async function repoStatus(repoDir: string | null): Promise<RepoStatus> {
  const empty: RepoStatus = { branch: "", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], clean: true };
  if (!repoDir || !existsSync(repoDir)) return empty;
  try {
    const { stdout } = await exec("git", ["status", "--porcelain=v1", "-z", "-b"], { cwd: repoDir, ...GIT });
    const parts = stdout.split("\0");
    let branch = "", ahead = 0, behind = 0;
    const staged: string[] = [], unstaged: string[] = [], untracked: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const rec = parts[i]; if (!rec) continue;
      if (rec.startsWith("## ")) {
        const head = rec.slice(3);
        const am = head.match(/ahead (\d+)/); if (am) ahead = Number(am[1]);
        const bm = head.match(/behind (\d+)/); if (bm) behind = Number(bm[1]);
        branch = head.replace(/^No commits yet on /, "").split(/\.\.\.| \[/)[0]!.trim();
        continue;
      }
      const x = rec[0], y = rec[1], path = rec.slice(3);
      if (x === "R" || y === "R") i++; // lewati token path sumber untuk rename
      if (x === "?" && y === "?") { untracked.push(path); continue; }
      if (x !== " " && x !== "?") staged.push(path);
      if (y !== " " && y !== "?") unstaged.push(path);
    }
    return { branch, ahead, behind, staged, unstaged, untracked, clean: !staged.length && !unstaged.length && !untracked.length };
  } catch { return empty; }
}

// SPEC-233 · daftar stash. %gd = selektor reflog (stash@{0}); %s = subjek; %aI = tanggal ISO.
export async function listStashes(repoDir: string | null): Promise<Stash[]> {
  if (!repoDir || !existsSync(repoDir)) return [];
  try {
    const { stdout } = await exec("git", ["stash", "list", `--format=%gd${US}%s${US}%aI`], { cwd: repoDir, ...GIT });
    return stdout.split("\n").filter(Boolean).map((line) => {
      const [ref, message, at] = line.split(US);
      return { ref: ref ?? "", message: message ?? "", at: at ?? "" };
    });
  } catch { return []; }
}

// git log seluruh ref (default --all). `%D` = ref names ("HEAD -> main, origin/main, tag: v1"); buang
// prefix "HEAD -> ". Satu commit = satu baris (subject/refs tanpa newline).
// SPEC-233 · opts: `branches` batasi ke ref tertentu (bukan --all); `showRemote`/`showTags` false →
// exclude glob ref dari walk (default = perilaku lama).
export type GraphOpts = { branches?: string[]; showRemote?: boolean; showTags?: boolean };
export async function listGraph(repoDir: string | null, limit = 200, opts: GraphOpts = {}): Promise<{ commits: GraphCommit[]; current: string; total: number }> {
  if (!repoDir || !existsSync(repoDir)) return { commits: [], current: "", total: 0 };
  try {
    const fmt = ["%H", "%P", "%an", "%aI", "%s", "%D"].join(US);
    // ref selector: branch spesifik (--end-of-options cegah flag-injection) atau --all + exclude glob.
    const refArgs = opts.branches?.length
      ? ["--end-of-options", ...opts.branches]
      : [...(opts.showRemote === false ? ["--exclude=refs/remotes/*"] : []),
         ...(opts.showTags === false ? ["--exclude=refs/tags/*"] : []), "--all"];
    const { stdout } = await exec("git",
      ["log", "--date-order", `--max-count=${limit}`, `--pretty=format:${fmt}`, ...refArgs], { cwd: repoDir, ...GIT });
    const commits = stdout.split("\n").filter(Boolean).map((line) => {
      const [sha, parents, author, at, subject, refs] = line.split(US);
      // SPEC-233 · pisahkan tag (`tag: v1`) dari ref branch agar client bisa merender/menuinya beda.
      const tags: string[] = [], branchRefs: string[] = [];
      for (const d of (refs ?? "").split(",").map((r) => r.trim()).filter(Boolean)) {
        const clean = d.replace(/^HEAD -> /, "");
        if (clean === "HEAD") continue;
        if (clean.startsWith("tag: ")) tags.push(clean.slice(5));
        else branchRefs.push(clean);
      }
      return {
        sha: sha!, parents: parents ? parents.split(" ") : [], author: author ?? "", at: at ?? "",
        subject: subject ?? "", refs: branchRefs, tags,
      };
    });
    // SPEC-523 · graph SENGAJA tetap jendela tumbuh (SPEC-351), bukan halaman diskrit: lane
    // dihitung dari daftar commit KONTIGU, jadi memenggalnya per halaman memutus tautan
    // induk–anak di batas halaman. Yang kurang selama ini bukan halamannya melainkan angkanya —
    // "200 dimuat" tak memberi tahu apakah tersisa 3 atau 30.000. `rev-list --count` menjawabnya
    // dengan ref selector yang SAMA, jadi ia tak pernah menghitung ref yang tak digambar.
    let total = commits.length;
    try {
      const c = await exec("git", ["rev-list", "--count", ...refArgs], { cwd: repoDir, ...GIT });
      const n = Number(c.stdout.trim());
      if (Number.isFinite(n)) total = n;
    } catch { /* repo tanpa commit / ref aneh: jatuh ke jumlah yang benar-benar dimuat */ }

    return { commits, current: await currentBranch(repoDir), total };
  } catch { return { commits: [], current: "", total: 0 }; }
}

export type CommitDetail = {
  sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[];
  // SPEC-233 · signature GPG/X.509 (bukan "N") + committer + email author (gravatar).
  signed: boolean; committer: string; committedAt: string; authorEmail: string;
};

// Gabung numstat (-z) + name-status (-z) → ChangedFile[]. Dipakai commit tunggal (git show) &
// compare dua commit (git diff). `git show/diff --format=` menyisakan bodi diff saja.
function mergeNumName(numOut: string, nameOut: string): ChangedFile[] {
  const map = new Map<string, ChangedFile>();
  for (const rec of splitZ(numOut)) {
    const t1 = rec.indexOf("\t"), t2 = rec.indexOf("\t", t1 + 1);
    const add = rec.slice(0, t1), del = rec.slice(t1 + 1, t2), path = rec.slice(t2 + 1);
    const binary = add === "-" && del === "-";
    map.set(path, { path, add: binary ? 0 : Number(add), del: binary ? 0 : Number(del), status: "M", binary });
  }
  const toks = splitZ(nameOut);
  for (let i = 0; i + 1 < toks.length; i += 2) {
    const st = toks[i]![0] as "A" | "M" | "D", path = toks[i + 1]!;
    const cf = map.get(path) ?? { path, add: 0, del: 0, status: st, binary: false };
    cf.status = st; map.set(path, cf);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function changedOf(repoDir: string, sha: string): Promise<ChangedFile[]> {
  const [num, name] = await Promise.all([
    exec("git", ["show", "--format=", "--numstat", "-z", "--no-renames", sha], { cwd: repoDir, ...GIT }),
    exec("git", ["show", "--format=", "--name-status", "-z", "--no-renames", sha], { cwd: repoDir, ...GIT }),
  ]);
  return mergeNumName(num.stdout, name.stdout);
}

// SPEC-233 · compare dua commit: file yang beda + per-file diff (reuse DiffView). from/to bisa
// ref/sha; `--end-of-options` cegah flag-injection.
export async function compareCommits(repoDir: string | null, from: string, to: string): Promise<{ from: string; to: string; changed: ChangedFile[] }> {
  const empty = { from, to, changed: [] as ChangedFile[] };
  if (!repoDir || !existsSync(repoDir)) return empty;
  try {
    const [num, name] = await Promise.all([
      exec("git", ["diff", "--numstat", "-z", "--no-renames", "--end-of-options", from, to], { cwd: repoDir, ...GIT }),
      exec("git", ["diff", "--name-status", "-z", "--no-renames", "--end-of-options", from, to], { cwd: repoDir, ...GIT }),
    ]);
    return { from, to, changed: mergeNumName(num.stdout, name.stdout) };
  } catch { return empty; }
}

// SPEC-233 · cari commit lintas semua ref. by=message (grep, fixed+case-insensitive), author,
// hash (prefix sha), all (gabungan, dedup urutan). Kembalikan daftar sha. q kosong → [].
export async function searchCommits(repoDir: string | null, q: string, by: "all" | "message" | "author" | "hash" = "all"): Promise<string[]> {
  if (!repoDir || !existsSync(repoDir) || !q) return [];
  const run = async (extra: string[]): Promise<string[]> => {
    try { return (await exec("git", ["log", "--all", "--format=%H", ...extra], { cwd: repoDir, ...GIT })).stdout.split("\n").filter(Boolean); }
    catch { return []; }
  };
  const byMessage = () => run(["-i", "-F", `--grep=${q}`]);
  const byAuthor = () => run(["-i", `--author=${q}`]);
  const byHash = async () => (await run([])).filter((h) => h.toLowerCase().startsWith(q.toLowerCase()));
  if (by === "message") return byMessage();
  if (by === "author") return byAuthor();
  if (by === "hash") return byHash();
  const [m, a, h] = await Promise.all([byMessage(), byAuthor(), byHash()]);
  return [...new Set([...m, ...a, ...h])];
}

export async function compareFile(repoDir: string | null, from: string, to: string, rel: string): Promise<ReviewFile | null> {
  if (!repoDir) return null;
  repoAbsPath(repoDir, rel, true); // path may exist only in the selected commits
  try {
    const diff = (await exec("git", ["diff", "--no-renames", "--end-of-options", from, to, "--", rel], { cwd: repoDir, ...GIT })).stdout;
    const contentRaw = await exec("git", ["show", `${to}:${rel}`], { cwd: repoDir, ...GIT }).then((r) => r.stdout).catch(() => null);
    const binary = /Binary files/.test(diff) || (contentRaw?.includes("\u0000") ?? false);
    const status: "A" | "M" | "D" = contentRaw === null ? "D" : "M";
    return { path: rel, status, binary, truncated: (contentRaw?.length ?? 0) > MAX, diff: diff.slice(0, MAX), content: binary || contentRaw === null ? null : contentRaw.slice(0, MAX) };
  } catch { return null; }
}

export async function commitDetail(repoDir: string | null, sha: string): Promise<CommitDetail | null> {
  if (!repoDir) return null;
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return null; // gerbang: hanya sha hex
  try {
    // %G? = status signature (N = tak ditandatangani); %cn/%cI = committer + tanggalnya; %ae = email author.
    const fmt = ["%H", "%P", "%an", "%aI", "%s", "%G?", "%cn", "%cI", "%ae", "%b"].join(US);
    const parts = (await exec("git", ["show", "-s", `--pretty=format:${fmt}`, sha], { cwd: repoDir, ...GIT })).stdout.split(US);
    const [h, parents, author, at, subject, gsig, committer, committedAt, authorEmail] = parts;
    return {
      sha: h!, parents: parents ? parents.split(" ") : [], author: author ?? "", at: at ?? "",
      subject: subject ?? "", body: parts.slice(9).join(US), changed: await changedOf(repoDir, sha),
      signed: !!gsig && gsig !== "N", committer: committer ?? "", committedAt: committedAt ?? "", authorEmail: authorEmail ?? "",
    };
  } catch { return null; }
}

// SPEC-233 · diff satu file di sebuah commit (vs parent) + isinya, untuk viewer detail commit.
// Bentuk = ReviewFile (reuse DiffView). Path-guard cermin readRepoFile (throw → route 400).
export async function commitFileDiff(repoDir: string | null, sha: string, rel: string): Promise<ReviewFile | null> {
  if (!repoDir) return null;
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return null;
  repoAbsPath(repoDir, rel, true); // deleted files are still valid commit paths
  try {
    const [diffR, nameR] = await Promise.all([
      exec("git", ["show", "--format=", "--no-renames", "--end-of-options", sha, "--", rel], { cwd: repoDir, ...GIT }),
      exec("git", ["show", "--format=", "--name-status", "--no-renames", "--end-of-options", sha, "--", rel], { cwd: repoDir, ...GIT }),
    ]);
    const status = ((nameR.stdout.trim()[0] as "A" | "M" | "D") || "M");
    const contentRaw = await exec("git", ["show", `${sha}:${rel}`], { cwd: repoDir, ...GIT }).then((r) => r.stdout).catch(() => null);
    const binary = /Binary files/.test(diffR.stdout) || (contentRaw?.includes("\u0000") ?? false);
    return {
      path: rel, status, binary, truncated: (contentRaw?.length ?? 0) > MAX,
      diff: diffR.stdout.slice(0, MAX), content: binary || contentRaw === null ? null : contentRaw.slice(0, MAX),
    };
  } catch { return null; }
}

export async function writeRepoFile(repoDir: string | null, rel: string, content: string): Promise<void> {
  if (!repoDir) throw new Error("project tidak punya repoDir");
  await writeRepoFileAtomic(repoDir, rel, content);
}

export type GitOp =
  | { op: "checkout"; ref: string; force?: boolean }
  | { op: "branch"; name: string; at?: string; checkout?: boolean }
  | { op: "merge"; ref: string; ff?: "no-ff" | "ff-only"; deleteBranch?: string }
  | { op: "cherry-pick"; sha: string }
  | { op: "revert"; sha: string }
  // SPEC-206 · hapus branch mandiri: local (`local` default true), origin (`remote`), atau keduanya.
  | { op: "delete-branch"; name: string; force?: boolean; local?: boolean; remote?: boolean }
  // SPEC-233 · reset branch current ke sebuah commit (soft: HEAD saja; mixed: +index; hard: +worktree).
  | { op: "reset"; sha: string; mode: "soft" | "mixed" | "hard" }
  // SPEC-233 · tag: annotated bila `message`, di `at` bila ada; `push` → dorong ke origin sesudahnya.
  | { op: "tag"; name: string; message?: string; at?: string; push?: boolean }
  | { op: "delete-tag"; name: string; remote?: boolean }
  | { op: "push-tag"; name: string }
  // SPEC-233 · operasi baris uncommitted: reset working tree ke HEAD, atau clean untracked.
  | { op: "reset-worktree"; mode: "mixed" | "hard" }
  | { op: "clean"; directories?: boolean; ignored?: boolean }
  // SPEC-233 · stash: simpan/terapkan/pop/buang/branch-dari-stash.
  | { op: "stash"; message?: string; includeUntracked?: boolean }
  | { op: "stash-apply"; ref: string; index?: boolean }
  | { op: "stash-pop"; ref: string; index?: boolean }
  | { op: "stash-drop"; ref: string }
  | { op: "stash-branch"; ref: string; name: string }
  // SPEC-233 · branch ref-only: rename, push (dgn upstream/force-with-lease), fetch (prune).
  | { op: "rename-branch"; from: string; to: string }
  | { op: "push-branch"; name: string; setUpstream?: boolean; force?: boolean }
  | { op: "fetch"; prune?: boolean; pruneTags?: boolean };

export type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string };

// Field wajib per-op. force di-cek terpisah di route (gerbang sesi). null = valid.
export function validateGitOp(op: unknown): string | null {
  const o = op as Record<string, unknown>;
  if (!o || typeof o !== "object") return "body wajib";
  const need = (k: string) => (typeof o[k] === "string" && o[k] ? null : `${k} wajib`);
  switch (o.op) {
    case "checkout": return need("ref");
    case "branch": return need("name");
    case "merge": {
      const e = need("ref"); if (e) return e;
      if (o.ff !== undefined && o.ff !== "no-ff" && o.ff !== "ff-only") return "ff harus no-ff atau ff-only";
      if (o.deleteBranch !== undefined && !(typeof o.deleteBranch === "string" && o.deleteBranch)) return "deleteBranch harus string tak kosong";
      return null;
    }
    case "cherry-pick": return need("sha");
    case "revert": return need("sha");
    case "delete-branch": return need("name");
    case "reset": {
      const e = need("sha"); if (e) return e;
      return o.mode === "soft" || o.mode === "mixed" || o.mode === "hard" ? null : "mode harus soft/mixed/hard";
    }
    case "tag": case "delete-tag": case "push-tag": return need("name");
    case "reset-worktree": return o.mode === "mixed" || o.mode === "hard" ? null : "mode harus mixed/hard";
    case "clean": return null;
    case "stash": return null;
    case "stash-apply": case "stash-pop": case "stash-drop": return need("ref");
    case "stash-branch": return need("ref") || need("name");
    case "rename-branch": return need("from") || need("to");
    case "push-branch": return need("name");
    case "fetch": return null;
    default: return `op tak dikenal: ${String(o.op)}`;
  }
}

// SPEC-233 · op yang TIDAK menyentuh working tree (ref/remote murni) → tak digerbang sesi aktif
// di POST /projects/:id/git (ADR-0055). Signature longgar agar op yang belum masuk union pun bisa
// diklasifikasi saat ditambah PR berikutnya.
const REF_ONLY_OPS = new Set(["tag", "delete-tag", "push-tag", "rename-branch", "push-branch", "fetch", "stash-drop"]);
export function touchesTree(op: GitOp | { op: string }): boolean {
  return !REF_ONLY_OPS.has(op.op);
}

// SPEC-197 · `--end-of-options` sebelum ref/name yang berasal dari data: refname berbentuk
// `-`/`--x` sah, dan git membaca opsi di posisi mana pun → flag confusion. Cegah sekali di sini,
// cermin runner/src/git.ts yang sudah menjaga kelas bug ini di addWorktree.
function gitArgs(op: GitOp): string[] {
  switch (op.op) {
    case "checkout": return ["checkout", ...(op.force ? ["-f"] : []), "--end-of-options", op.ref];
    case "branch": return ["branch", "--end-of-options", op.name, ...(op.at ? [op.at] : [])];
    case "merge": return ["merge", "--no-edit", ...(op.ff ? [`--${op.ff}`] : []), "--end-of-options", op.ref];
    case "cherry-pick": return ["cherry-pick", "--end-of-options", op.sha];
    case "revert": return ["revert", "--no-edit", "--end-of-options", op.sha];
    case "delete-branch": return ["branch", op.force ? "-D" : "-d", "--end-of-options", op.name];
    case "reset": return ["reset", `--${op.mode}`, "--end-of-options", op.sha];
    case "tag": return ["tag", ...(op.message ? ["-a", "-m", op.message] : []), "--end-of-options", op.name, ...(op.at ? [op.at] : [])];
    case "delete-tag": return ["tag", "-d", "--end-of-options", op.name];
    case "push-tag": return ["push", "origin", "--end-of-options", op.name];
    case "reset-worktree": return ["reset", `--${op.mode}`];
    case "clean": return ["clean", "-f", ...(op.directories ? ["-d"] : []), ...(op.ignored ? ["-x"] : [])];
    case "stash": return ["stash", "push", ...(op.includeUntracked ? ["-u"] : []), ...(op.message ? ["-m", op.message] : [])];
    case "stash-apply": return ["stash", "apply", ...(op.index ? ["--index"] : []), "--end-of-options", op.ref];
    case "stash-pop": return ["stash", "pop", ...(op.index ? ["--index"] : []), "--end-of-options", op.ref];
    case "stash-drop": return ["stash", "drop", "--end-of-options", op.ref];
    case "stash-branch": return ["stash", "branch", "--end-of-options", op.name, op.ref];
    case "rename-branch": return ["branch", "-m", "--end-of-options", op.from, op.to];
    case "push-branch": return ["push", ...(op.setUpstream ? ["-u"] : []), ...(op.force ? ["--force-with-lease"] : []), "origin", "--end-of-options", op.name];
    case "fetch": return ["fetch", "--all", ...(op.prune ? ["--prune"] : []), ...(op.pruneTags ? ["--prune-tags"] : [])];
  }
}

// Setelah merge sukses: hapus branch yang baru di-merge, lokal (-D, aman karena sudah ter-merge)
// lalu origin bila remote-tracking-nya ada (`git push origin --delete`). Gagal di salah satu langkah
// → ok:false + stderr; merge-nya sendiri tetap terjadi (graph reload menunjukkan keadaan sebenarnya).
async function afterMergeDelete(repoDir: string, branch: string, mergeOut: string, mergeErr: string): Promise<GitOpResult> {
  const out = [mergeOut], err = [mergeErr];
  const step = async (args: string[]) => { const r = await exec("git", args, { cwd: repoDir, ...GIT }); out.push(r.stdout); err.push(r.stderr); };
  try {
    await step(["branch", "-D", branch]);
    const hasOrigin = await exec("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], { cwd: repoDir, ...GIT }).then(() => true).catch(() => false);
    if (hasOrigin) await step(["push", "origin", "--delete", branch]);
    return { ok: true, stdout: out.join("\n").trim(), stderr: err.join("\n").trim(), current: await currentBranch(repoDir) };
  } catch (e) {
    const ee = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: [...out, ee.stdout ?? ""].join("\n").trim(), stderr: [...err, ee.stderr ?? String(e)].join("\n").trim(), current: await currentBranch(repoDir) };
  }
}

// SPEC-206 · hapus branch mandiri (bukan lewat merge): local (`git branch -d/-D`) dan/atau origin
// (`git push origin --delete`). `local` default true; set false untuk hapus origin saja (mis. ref
// origin/<b> tanpa branch lokal). Reuse gitArgs untuk langkah lokal. Gagal salah satu langkah →
// ok:false + stderr (langkah sebelumnya sudah terjadi; graph reload menunjukkan keadaan sebenarnya).
async function runDeleteBranch(repoDir: string, op: Extract<GitOp, { op: "delete-branch" }>): Promise<GitOpResult> {
  const out: string[] = [], err: string[] = [];
  const step = async (args: string[]) => { const r = await exec("git", args, { cwd: repoDir, ...GIT }); out.push(r.stdout); err.push(r.stderr); };
  try {
    if (op.local !== false) await step(gitArgs({ op: "delete-branch", name: op.name, force: op.force }));
    if (op.remote) await step(["push", "origin", "--delete", "--end-of-options", op.name]);
    return { ok: true, stdout: out.join("\n").trim(), stderr: err.join("\n").trim(), current: await currentBranch(repoDir) };
  } catch (e) {
    const ee = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: [...out, ee.stdout ?? ""].join("\n").trim(), stderr: [...err, ee.stderr ?? String(e)].join("\n").trim(), current: await currentBranch(repoDir) };
  }
}

// SPEC-233 · tag multi-langkah: buat tag (lightweight/annotated) lalu opsional push ke origin;
// atau hapus tag lokal lalu opsional hapus di origin. Gagal salah satu langkah → ok:false + stderr
// (langkah sebelumnya sudah terjadi; graph reload menunjukkan keadaan sebenarnya).
async function runTagOp(repoDir: string, op: Extract<GitOp, { op: "tag" | "delete-tag" }>): Promise<GitOpResult> {
  const out: string[] = [], err: string[] = [];
  const step = async (args: string[]) => { const r = await exec("git", args, { cwd: repoDir, ...GIT }); out.push(r.stdout); err.push(r.stderr); };
  try {
    await step(gitArgs(op));
    if (op.op === "tag" && op.push) await step(["push", "origin", "--end-of-options", op.name]);
    if (op.op === "delete-tag" && op.remote) await step(["push", "origin", "--delete", "--end-of-options", op.name]);
    return { ok: true, stdout: out.join("\n").trim(), stderr: err.join("\n").trim(), current: await currentBranch(repoDir) };
  } catch (e) {
    const ee = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: [...out, ee.stdout ?? ""].join("\n").trim(), stderr: [...err, ee.stderr ?? String(e)].join("\n").trim(), current: await currentBranch(repoDir) };
  }
}

// Jalankan satu op git. Exit ≠ 0 → { ok:false, stderr } (route ubah jadi 409), tak throw.
// `branch` dengan checkout:true → buat lalu checkout (dua exec). `merge` dengan deleteBranch →
// merge lalu bersihkan branch lokal+origin (SPEC-193). `delete-branch` → runDeleteBranch (SPEC-206).
export async function runGitOp(repoDir: string, op: GitOp): Promise<GitOpResult> {
  if (op.op === "delete-branch") return runDeleteBranch(repoDir, op);
  if (op.op === "tag" || op.op === "delete-tag") return runTagOp(repoDir, op);
  try {
    const { stdout, stderr } = await exec("git", gitArgs(op), { cwd: repoDir, ...GIT });
    if (op.op === "branch" && op.checkout) return runGitOp(repoDir, { op: "checkout", ref: op.name });
    if (op.op === "merge" && op.deleteBranch) return afterMergeDelete(repoDir, op.deleteBranch, stdout, stderr);
    return { ok: true, stdout, stderr, current: await currentBranch(repoDir) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? String(e), current: await currentBranch(repoDir) };
  }
}

// SPEC-234 · status working tree utama, diturunkan dari git (tak dipersist). staged = index vs HEAD;
// unstaged = working tree vs index memakai pola temp-index specReview (SPEC-144) → file untracked
// tampil "A" dgn hitungan baris nyata, index asli tak tersentuh. Independen dari ref yang dilihat.
export async function workingStatus(
  repoDir: string | null,
): Promise<{ branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] }> {
  if (!repoDir || !existsSync(repoDir)) return { branch: "", staged: [], unstaged: [] };
  const [branch, staged, unstaged] = await Promise.all([
    currentBranch(repoDir),
    changedFiles(repoDir, ["--cached"]),
    withTempIndex(repoDir, (env) => changedFiles(repoDir, [], env)),
  ]);
  return { branch, staged, unstaged };
}

// SPEC-234 · diff satu file working tree. staged=true → git diff --cached (index vs HEAD), isi = index
// (`git show :path`). staged=false → working tree vs index lewat temp-index (untracked jadi diff
// new-file), isi = disk. status D → content null. Bentuk = ReviewFile (dipakai DiffView bersama).
export async function workingFileDiff(
  repoDir: string | null, path: string, staged: boolean,
): Promise<ReviewFile | null> {
  if (!repoDir || !existsSync(repoDir)) return null;
  repoAbsPath(repoDir, path, true); // deletion has no final filesystem entry
  const changed = staged
    ? await changedFiles(repoDir, ["--cached"])
    : await withTempIndex(repoDir, (env) => changedFiles(repoDir, [], env));
  const cf = changed.find((c) => c.path === path);
  if (!cf) return null; // file bukan bagian changeset → route 404
  if (cf.binary) return { path, status: cf.status, binary: true, truncated: false, diff: null, content: null };
  const diffRaw = staged
    ? (await exec("git", ["diff", "--cached", "--", path], { cwd: repoDir, ...GIT })).stdout
    : await withTempIndex(repoDir, async (env) =>
        (await exec("git", ["diff", "--", path], { cwd: repoDir, env, ...GIT })).stdout);
  let contentRaw: string | null = null;
  if (cf.status !== "D") {
    try {
      contentRaw = staged
        ? (await exec("git", ["show", `:${path}`], { cwd: repoDir, ...GIT })).stdout
        : (await readSafeRepoFile(repoDir, path)).toString("utf8");
    } catch { contentRaw = null; }
  }
  return {
    path, status: cf.status, binary: false,
    truncated: diffRaw.length > MAX || (contentRaw?.length ?? 0) > MAX,
    diff: diffRaw.slice(0, MAX),
    content: contentRaw === null ? null : contentRaw.slice(0, MAX),
  };
}

// SPEC-908 · muatan layar GitGraph dalam SATU tarikan — cermin `load()`-nya. Dibundel karena
// ketiganya hari ini satu render: tiga frame terpisah akan menampilkan campuran dua generasi data.
export async function buildGitLive(repoDir: string | null, p: TopicParams["git"]): Promise<{
  graph: { commits: GraphCommit[]; current: string; total: number };
  status: RepoStatus; stashes: Stash[];
}> {
  const [graph, status, stashes] = await Promise.all([
    listGraph(repoDir, p.limit, {
      branches: p.branch ? [p.branch] : undefined,
      showRemote: p.showRemote ? undefined : false,
      showTags: p.showTags ? undefined : false,
    }),
    repoStatus(repoDir),
    listStashes(repoDir),
  ]);
  return { graph, status, stashes };
}
