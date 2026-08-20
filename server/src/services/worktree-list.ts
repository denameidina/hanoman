import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WorktreeDeleteResult, WorktreeReport, WorktreeStats, WorktreeView } from "@hanoman/shared";
import { ownsWorktree } from "./session-worktree";

// SPEC-861 · ADR-0132 · penemuan worktree yang masih HIDUP di sebuah project — pasangan
// `branch-cleanup.ts` untuk sisi worktree. Nilai turunan penuh dari git tiap request
// (ADR-0018/0011): tak ada kolom DB, tak ada cache. Murni seperti kembarannya: sinyal non-git
// (Spec, sesi tmux) dan seluruh efek samping masuk sebagai parameter/deps, jadi modul ini bisa
// dites tanpa DB maupun tmux.
const exec = promisify(execFile);
const GIT = { timeout: 60_000, maxBuffer: 1 << 24, encoding: "utf8" as const };

// Cermin out() di branch-cleanup.ts: gagal → string kosong, TAK PERNAH melempar. Route ini
// read-only; repo rusak / tanpa commit tak boleh jadi 500.
async function out(cwd: string, args: string[]): Promise<string> {
  try { return (await exec("git", args, { cwd, ...GIT })).stdout; } catch { return ""; }
}

export type RawWorktree = {
  path: string; head: string; branch: string | null;
  prunable: boolean; locked: boolean; bare: boolean;
};

// `git worktree list --porcelain` memancarkan satu blok per worktree, dipisah baris kosong:
//   worktree <path> / HEAD <sha> / (branch refs/heads/<b> | detached) / [bare] / [locked <alasan>] /
//   [prunable <alasan>]
// `detached` sengaja tak punya cabang sendiri: ketiadaan baris `branch` SUDAH berarti detached,
// dan itulah keadaan normal sesi hanoman (ADR-0002).
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

// `git worktree list` SELALU menjawab path fisik, sementara repoDir & cwd sesi datang apa adanya
// dari DB/tmux. macOS men-symlink `/tmp` dan `/var/folders` ke `/private/**`, jadi membandingkan
// string mentah gagal palsu — dan bukan cuma di direktori test: repo yang hidup di bawah symlink
// mana pun kena hal yang sama, dan gagalnya SENYAP (baris tak pernah cocok dengan sesinya, gerbang
// `ownsWorktree` menolak worktree yang sah). Cermin `samePath` di runner/src/git.ts.
const real = (p: string): string => {
  try { return realpathSync(p); } catch { return resolve(p); }
};

// `.git` sebuah worktree tertaut adalah BERKAS yang ditulis sekali saat `worktree add` dan tak
// pernah disentuh lagi — stempel lahir yang jujur, tanpa tabel. birthtime 0 (sebagian filesystem
// Linux tak menyimpannya) → mtime. Direktorinya lenyap (prunable) → null.
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
  const baseReal = real(base);
  const text = await out(base, ["worktree", "list", "--porcelain"]);
  // `.trash` adalah wilayah reaper (SPEC-742/ADR-0116) dan sudah punya permukaannya sendiri.
  // Prefix path yang sudah dinormalkan, bukan substring: nama worktree boleh memuat ".trash".
  const trash = resolve(baseReal, ".worktrees", ".trash");
  const sessions = new Map([...inputs.sessions].map(([cwd, s]) => [real(cwd), s]));
  const rows: WorktreeView[] = [];
  for (const w of parseWorktreePorcelain(text)) {
    const path = resolve(w.path);
    if (path === trash || path.startsWith(trash + sep)) continue;
    const name = basename(path);
    // SPEC-362 · `ownsWorktree` adalah SATU-SATUNYA gerbang, dan ia menguji HUBUNGAN cwd↔repoDir,
    // bukan bentuk path. hanoman didogfood di dalam worktree-nya sendiri, sehingga sebuah project
    // bisa ter-bind ke checkout yang kebetulan berada di bawah `.worktrees/`.
    const deletable = ownsWorktree(baseReal, path);
    const spec = inputs.specs.get(name);
    rows.push({
      path, name, head: w.head, branch: w.branch,
      prunable: w.prunable, locked: w.locked,
      deletable,
      blocked: deletable ? null : path === baseReal ? "checkout project" : "di luar .worktrees project ini",
      spec: spec ? { id: spec.id, stage: spec.stage } : null,
      session: sessions.get(path) ?? null,
      createdAt: await bornAt(path),
    });
  }
  // Deterministik untuk test & UI: yang tak bisa dihapus di atas (konteks), sisanya per nama.
  rows.sort((a, b) => Number(a.deletable) - Number(b.deletable) || a.name.localeCompare(b.name));
  return { repoDir: base, worktrees: rows };
}

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
  const s = await out(w.path, ["status", "--porcelain"]);
  return s.split("\n").filter((l) => l.trim()).length;
}

// "Kerja yang akan hilang": commit reachable dari HEAD worktree ini tetapi TIDAK dari ref lain mana
// pun — dengan branch yang ter-checkout DI SINI ikut dikecualikan, karena checkbox 'hapus branch
// juga' akan ikut menghapusnya. SHA heksadesimal tak pernah terbaca sebagai flag (ADR-0032).
//
// GOTCHA terukur (git 2.50.1): pola `--exclude` untuk `--branches` relatif terhadap `refs/heads/`
// (`feat`, BUKAN `refs/heads/feat` — bentuk panjang diam-diam tak mengecualikan apa pun, jadi
// jawabannya 0 dan seluruh kerja yang akan hilang tak pernah disebut dialog konfirmasi) dan untuk
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

// SPEC-861 · ADR-0132 · orkestrasi penghapusan. Deps disuntik supaya modul ini tetap murni: tutup
// sesi (tmux+DB), lepas worktree (fs), prune (git), hapus branch (branch-cleanup) semuanya dirakit
// di routes/ide.ts, yang memang sudah boleh menyentuh DB & tmux — cermin `lockInputs()` di sana.
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
  // `withBranch`, bukan `deleteBranch`: nama itu sudah dipakai DEP-nya di bawah, dan bentuk wire
  // (`{ names, deleteBranch }`) memang berbeda dari bentuk internal.
  opts: { withBranch?: boolean } & WorktreeInputs & WorktreeDeleteDeps,
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
      // selagi worktree-nya masih di tempatnya, lalu melepasnya sendiri.
      if (w.session) {
        const closed = await opts.closeSession(w.session.id);
        row.closedSession = w.session.id;
        row.cleanup = closed?.cleanup ?? null;
      }
      if (!row.cleanup) row.cleanup = opts.release(report.repoDir, w.path);
      // Registrasi harus lenyap SEKARANG: bersamanya lepas pula kunci `BranchLock: "worktree"`
      // di tab Branches — itulah yang membuka kebuntuan yang jadi alasan SPEC-861 ada. Ia juga
      // satu-satunya yang membereskan baris `prunable` (registrasi tanpa direktori).
      await opts.prune(report.repoDir);
      if (opts.withBranch && w.branch) {
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
