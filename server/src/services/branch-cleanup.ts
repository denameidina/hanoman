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

export type BranchInclude = "merged" | "all";

export type UnusedBranch = {
  name: string;
  // SPEC-859 · `local`/`remote` = ref itu ADA, bukan "ref itu ter-merge": badge scope di UI harus
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

// Branch yang ter-checkout di worktree lain. Sesi hanoman lahir --detach (ADR-0002) jadi seringnya
// TAK ada baris `branch` sama sekali — itulah alasan kunci `session` tetap perlu, terpisah dari ini.
async function worktreeBranches(repoDir: string): Promise<Set<string>> {
  const s = new Set<string>();
  for (const l of lines(await out(repoDir, ["worktree", "list", "--porcelain"])))
    if (l.startsWith("branch refs/heads/")) s.add(l.slice("branch refs/heads/".length));
  return s;
}

// U+001F unit separator: tak pernah muncul di subject commit, jadi aman jadi pemisah field.
// Ditulis sebagai ESCAPE, bukan karakter mentah — 0x1F tak terlihat di editor & mudah hilang
// saat disalin. Dan jangan pernah "" (string kosong): split("") memecah per-karakter.
const SEP = "\u001f";
type CommitMeta = { sha: string; at: string; subject: string };
type RefIndex = { locals: Set<string>; remotes: Set<string>; meta: Map<string, CommitMeta> };

// Satu for-each-ref memasok himpunan ref DAN commit terakhir. `%(refname)` penuh dibaca lebih dulu
// karena `refname:short` sudah kehilangan info sisi mana ref itu hidup (SPEC-859 butuh keduanya).
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

// SPEC-859 · `include: "all"` memancarkan SELURUH ref (local ∪ origin), ter-merge maupun belum.
// Default tetap `"merged"` supaya himpunan barisnya identik dengan sebelum SPEC-859.
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

export type DeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; forced?: true; error?: string };

// Scope efektif = irisan yang DIMINTA dengan ref yang benar-benar ADA pada branch itu.
function effectiveScope(want: BranchScope, b: UnusedBranch): BranchScope | "none" {
  const local = b.local && want !== "remote";
  const remote = b.remote && want !== "local";
  if (local && remote) return "both";
  if (local) return "local";
  if (remote) return "remote";
  return "none";
}

// SPEC-360 · ADR-0077 · hapus batch. Menurunkan daftar branch lebih dulu, lalu MEMVALIDASI ULANG
// tiap nama terhadap daftar itu: klien tak bisa menyelundupkan branch sembarang lewat body, dan
// kunci proteksi ditegakkan di jalur tulis (bukan sekadar petunjuk UI). Eksekusi didelegasikan ke
// runGitOp `delete-branch` (SPEC-206) — satu-satunya jalur hapus branch di codebase, jadi tak ada
// implementasi kedua yang bisa drift.
//
// SPEC-859 (amandemen ADR-0077) · daftarnya kini `include:"all"`, jadi premis lama "semua kandidat
// sudah ter-merge" gugur dan larangan mutlak `-D` ikut gugur bersamanya. Gerbangnya `allowUnmerged`,
// yang hanya dikirim dialog konfirmasi risiko: tanpa itu baris belum-ter-merge ditolak apa adanya.
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
