import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runGitOp } from "./git-ide";

// SPEC-360 · ADR-0077 · penemuan & pembersihan branch yang sudah ter-merge ke branch utamanya.
// Nilai turunan penuh dari git tiap request (ADR-0018/0011): tak ada kolom DB, tak ada cache.
// Murni: sinyal non-git (Spec belum done, sesi tmux aktif) masuk sebagai HIMPUNAN nama branch,
// bukan import — supaya modul ini bisa dites tanpa DB maupun tmux.
const exec = promisify(execFile);
const GIT = { timeout: 60_000, maxBuffer: 1 << 24, encoding: "utf8" as const };

export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
export type BranchScope = "local" | "remote" | "both";

// Prosa alasan; dipakai pesan error jalur write DAN (versi ringkasnya) badge UI.
export const LOCK_REASON: Record<BranchLock, string> = {
  current: "branch aktif (HEAD)",
  base: "branch base",
  worktree: "dipakai worktree lain",
  "spec-open": "backlog-nya belum selesai",
  session: "sesi aktif memakainya",
};

export type UnusedBranch = {
  name: string;
  local: boolean;
  remote: boolean;
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];
  /** SPEC-861 · path worktree yang menahannya; ada hanya saat kunci `worktree` menyala. */
  worktree?: string;
};
export type UnusedReport = { base: string; baseRemote: string | null; current: string; branches: UnusedBranch[] };
export type LockInputs = { openSpecBranches: Set<string>; sessionBranches: Set<string> };

const EMPTY: UnusedReport = { base: "", baseRemote: null, current: "", branches: [] };

// Cermin refs() di services/branches.ts: gagal → string kosong, TAK PERNAH melempar.
// Route ini read-only; repo rusak/tanpa commit tak boleh jadi 500.
async function out(repoDir: string, args: string[]): Promise<string> {
  try { return (await exec("git", args, { cwd: repoDir, ...GIT })).stdout; } catch { return ""; }
}
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

// Normalisasi satu baris refname:short → nama branch, atau "" bila harus dibuang.
// Dua hal yang WAJIB dibuang, keduanya diverifikasi terhadap git (bukan dugaan):
//   · "(no branch)" — dipancarkan `git branch --merged` saat dijalankan di worktree DETACHED.
//     Sesi hanoman selalu detached (ADR-0002), jadi ini jalur normal, bukan kasus pinggiran.
//   · "origin" — git memendekkan refs/remotes/origin/HEAD jadi bare "origin", BUKAN "origin/HEAD".
//     services/branches.ts sudah menyaring keduanya; jangan sampai modul ini lupa.
function shortName(ref: string): string {
  if (!ref || ref === "(no branch)" || ref === "HEAD" || ref === "origin" || ref === "origin/HEAD") return "";
  const name = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  return name === "HEAD" ? "" : name;
}

// SPEC-197/ADR-0032 · resolve ke SHA, bukan meneruskan nama mentah: heksadesimal tak pernah
// terbaca sebagai flag. Ini juga SATU-SATUNYA cara aman memberi base ke `--merged`, karena
// `--end-of-options` tak bisa dipakai di sana (git menelannya sebagai nilai `--merged`).
async function revSha(repoDir: string, rev: string): Promise<string> {
  return (await out(repoDir, ["rev-parse", "--verify", "-q", "--end-of-options", `${rev}^{commit}`])).trim();
}

// SPEC-227 · JANGAN hardcode "main": repo bisa ber-default master/develop. Urutan: base yang
// diminta → main → master → branch aktif → "HEAD" (repo detached/tanpa branch).
async function resolveBase(repoDir: string, want: string | undefined, current: string): Promise<string> {
  for (const c of [want, "main", "master"]) if (c && await revSha(repoDir, c)) return c;
  return current && current !== "HEAD" ? current : "HEAD";
}

// Branch yang ter-checkout di worktree lain, BESERTA path worktree-nya. Sesi hanoman lahir
// --detach (ADR-0002) jadi seringnya TAK ada baris `branch` sama sekali — itulah alasan kunci
// `session` tetap perlu, terpisah dari ini.
// SPEC-861 · path-nya ikut dibawa supaya baris branch bisa menunjuk worktree mana yang menguncinya
// (tab Branches → tab Worktrees). Blok porcelain berurutan: `worktree <path>` mendahului
// `branch <ref>` miliknya, jadi path terakhir yang terbaca selalu pemilik baris branch itu.
async function worktreeBranches(repoDir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  let path = "";
  for (const l of lines(await out(repoDir, ["worktree", "list", "--porcelain"]))) {
    if (l.startsWith("worktree ")) path = l.slice("worktree ".length);
    else if (l.startsWith("branch refs/heads/")) m.set(l.slice("branch refs/heads/".length), path);
  }
  return m;
}

// U+001F unit separator: tak pernah muncul di subject commit, jadi aman jadi pemisah field.
// Ditulis sebagai ESCAPE, bukan karakter mentah — 0x1F tak terlihat di editor & mudah hilang
// saat disalin. Dan jangan pernah "" (string kosong): split("") memecah per-karakter.
const SEP = "\u001f";
type CommitMeta = { sha: string; at: string; subject: string };
async function lastCommits(repoDir: string): Promise<Map<string, CommitMeta>> {
  const fmt = ["%(refname:short)", "%(objectname)", "%(committerdate:iso-strict)", "%(contents:subject)"].join(SEP);
  const m = new Map<string, CommitMeta>();
  for (const l of lines(await out(repoDir, ["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes/origin"]))) {
    const [ref, sha, at, ...rest] = l.split(SEP);
    const name = shortName(ref ?? "");
    if (!name || !sha) continue;
    if (!m.has(name)) m.set(name, { sha, at: at ?? "", subject: rest.join(SEP) });
  }
  return m;
}

export async function listUnusedBranches(
  repoDir: string | null,
  opts: { base?: string } & LockInputs,
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

  const [localMerged, remoteMerged, wt, meta] = await Promise.all([
    out(repoDir, ["branch", "--merged", baseSha, "--format=%(refname:short)"]),
    out(repoDir, ["branch", "-r", "--merged", baseRemoteSha, "--format=%(refname:short)"]),
    worktreeBranches(repoDir),
    lastCommits(repoDir),
  ]);

  const locals = new Set(lines(localMerged).map(shortName).filter(Boolean));
  const remotes = new Set(
    lines(remoteMerged).filter((r) => r.startsWith("origin/")).map(shortName).filter(Boolean));

  const names = [...new Set([...locals, ...remotes])].sort();
  const branches = names.map<UnusedBranch>((name) => {
    const locks: BranchLock[] = [];
    if (name === current) locks.push("current");
    if (name === base) locks.push("base");
    if (wt.has(name)) locks.push("worktree");
    if (opts.openSpecBranches.has(name)) locks.push("spec-open");
    if (opts.sessionBranches.has(name)) locks.push("session");
    const wtPath = wt.get(name);
    return { name, local: locals.has(name), remote: remotes.has(name),
      lastCommit: meta.get(name) ?? null, locks, ...(wtPath ? { worktree: wtPath } : {}) };
  });
  return { base, baseRemote, current, branches };
}

export type DeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; error?: string };

// Scope efektif = irisan yang DIMINTA dengan ref yang benar-benar ADA pada branch itu.
function effectiveScope(want: BranchScope, b: UnusedBranch): BranchScope | "none" {
  const local = b.local && want !== "remote";
  const remote = b.remote && want !== "local";
  if (local && remote) return "both";
  if (local) return "local";
  if (remote) return "remote";
  return "none";
}

// SPEC-360 · ADR-0077 · hapus batch. Menurunkan daftar ter-merge lebih dulu, lalu MEMVALIDASI ULANG
// tiap nama terhadap daftar itu: klien tak bisa menyelundupkan branch sembarang lewat body, dan
// kunci proteksi ditegakkan di jalur tulis (bukan sekadar petunjuk UI). Eksekusi didelegasikan ke
// runGitOp `delete-branch` (SPEC-206) — satu-satunya jalur hapus branch di codebase, jadi tak ada
// implementasi kedua yang bisa drift. Force TAK PERNAH dipakai: semua kandidat sudah ter-merge.
export async function deleteBranches(
  repoDir: string,
  names: string[],
  opts: { scope: BranchScope; base?: string } & LockInputs,
): Promise<{ base: string; results: DeleteResult[] }> {
  const report = await listUnusedBranches(repoDir, opts);
  const byName = new Map(report.branches.map((b) => [b.name, b]));
  const results: DeleteResult[] = [];
  for (const name of names) {
    const b = byName.get(name);
    if (!b) {
      results.push({ name, ok: false, scope: "none",
        error: `branch tak ditemukan di daftar ter-merge ke ${report.base}` });
      continue;
    }
    if (b.locks.length) {
      results.push({ name, ok: false, scope: "none",
        error: `terkunci: ${b.locks.map((l) => LOCK_REASON[l]).join(", ")}` });
      continue;
    }
    const scope = effectiveScope(opts.scope, b);
    if (scope === "none") {
      results.push({ name, ok: false, scope: "none",
        error: opts.scope === "remote" ? "branch tak punya ref origin" : "branch tak punya ref lokal" });
      continue;
    }
    const r = await runGitOp(repoDir, {
      op: "delete-branch", name, local: scope !== "remote", remote: scope !== "local" });
    results.push(r.ok ? { name, ok: true, scope } : { name, ok: false, scope, error: r.stderr || "hapus branch gagal" });
  }
  return { base: report.base, results };
}
