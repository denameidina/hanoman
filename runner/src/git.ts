import { spawnSync } from "node:child_process";
import { rmSync, mkdirSync, realpathSync, existsSync, renameSync } from "node:fs";
import { basename, isAbsolute, resolve, sep } from "node:path";
import type { GitOps } from "./types";

// SPEC-742 · ADR-0116 · bebaskan path worktree dalam waktu O(1) dengan MEMINDAHKANNYA, bukan
// menghapusnya: `renameSync` terukur 1 ms sementara `rmSync` atas pohon yang sama 1 370 ms — dan
// selama itu event loop server terblokir penuh. Penghapusan byte-nya milik penyapu latar
// (server/src/services/worktree-reaper.ts), yang domainnya `.trash/**` saja dan karena itu tak
// pernah bisa menyentuh worktree hidup.
let trashSeq = 0;
function trashWorktree(repo: string, path: string): string | null {
  const target = isAbsolute(path) ? resolve(path) : resolve(repo, path);
  // Cermin jaring pengaman removeWorktree (SPEC-362): `rename` sama merusaknya dengan `rm` bila
  // targetnya checkout project itu sendiri, dan pemanggil yang sampai ke sini punya bug.
  if (target === resolve(repo)) {
    throw new Error(`trashWorktree menolak memindahkan repo itu sendiri: ${target}`);
  }
  const trash = resolve(repo, ".worktrees", ".trash");
  // Sudah di dalam trash = sudah jadi sampah. Memindahkannya lagi hanya membuat entri kedua yang
  // menunjuk pekerjaan yang sama.
  if (target === trash || target.startsWith(trash + sep) || !existsSync(target)) return null;
  mkdirSync(trash, { recursive: true });
  // Nama entri memuat id sesinya (id sesi disanitasi ke `[a-z0-9_-]` → tak pernah bertitik), jadi
  // "milik sesi mana" bisa dipulihkan dari disk saja sesudah restart — tanpa tabel (ADR-0116).
  // `trashSeq` memisahkan dua pemindahan yang jatuh di milidetik yang sama.
  const dest = resolve(trash, `${basename(target)}.${Date.now().toString(36)}-${(trashSeq++).toString(36)}`);
  renameSync(target, dest);
  return dest;
}
function git(cwd: string, args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout || r.error?.message || "gagal spawn"}`);
  return r.stdout;
}
const tryGit = (cwd: string, args: string[]) => { spawnSync("git", args, { cwd, encoding: "utf8" }); };
// Nama branch boleh berbentuk flag — `refs/heads/--force` adalah refname yang sah — dan git membaca
// opsi di posisi mana pun. `git worktree add --detach <path> --force` tidak menolaknya: ia menelan
// `--force` sebagai opsi dan diam-diam memakai HEAD, membangun worktree di pohon yang salah tanpa
// satu pun error. Resolusikan ke commit SHA dulu; heksadesimal tak pernah jadi opsi. Urutan mengikat:
// `--verify` harus mendahului `--end-of-options` (diverifikasi terhadap git 2.50.1). Melempar dengan
// stderr git yang menyebut revisinya bila tidak resolve (ADR-0009), dan tetap menjaga DWIM sehingga
// branch remote-tracking masih resolve.
const resolveCommit = (repo: string, rev: string) => {
  // SPEC-244 · lokal dulu (DWIM refs/heads), lalu origin/<rev> untuk branch remote-only (worktree
  // PRD/audit di-push detached, ADR-0059). Cermin resolveSource di services/integrate.ts. Prefix
  // `origin/` konstan → tak bisa terbaca sebagai flag; keamanan argumen ADR-0032 utuh.
  const tryRev = (r: string) => {
    const res = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${r}^{commit}`], { cwd: repo, encoding: "utf8" });
    return res.status === 0 ? res.stdout.trim() : null;
  };
  // Gagal keras menyebut rev asli (ADR-0009) bila lokal maupun origin tak resolve.
  return tryRev(rev) ?? tryRev(`origin/${rev}`) ??
    git(repo, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).trim();
};

// macOS men-symlink /tmp → /private/tmp, dan `git rev-parse --show-toplevel` selalu menjawab
// path fisik. Membandingkan string mentah karenanya gagal palsu di direktori test.
const samePath = (a: string, b: string): boolean => {
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
};

export const realGit: GitOps = {
  // --detach: checkout commit milik branchFrom dalam detached HEAD, sehingga sebuah sesi bisa
  // bercabang dari `main` bahkan saat `main` sedang ter-checkout di working tree utama (git
  // menolak meng-checkout branch yang sudah dipakai). Agen sendiri yang mem-push HEAD ke
  // branchTo saat pekerjaannya selesai (SPEC-162).
  addWorktree: (repo, path, branchFrom) => {
    // Rebut kembali .worktrees/<id> yang tertinggal dari sesi yang mati atau dibunuh: id sebuah
    // backlog item bisa dipakai ulang, dan "already exists" tak boleh memblokirnya.
    //
    // SPEC-742 · ADR-0116 · perebutannya PEMINDAHAN, bukan penghapusan. Bentuk lama
    // (`worktree remove --force` + `rmSync`) menghapus pohon penuh secara SINKRON — terukur 1 370 ms
    // dengan event loop terblokir 1 364 ms di antaranya, dua kali karena git sudah menghapusnya
    // lebih dulu. Membuka lagi backlog yang sudah `done` (SPEC-172) melewati jalur ini setiap kali,
    // jadi ia membekukan server persis di titik "buka sesi baru". `prune` di bawah yang membatalkan
    // registrasi worktree lamanya. Gagal memindah → jalur lama apa adanya.
    try {
      trashWorktree(repo, path);
    } catch {
      tryGit(repo, ["worktree", "remove", "--force", path]);
      rmSync(isAbsolute(path) ? path : resolve(repo, path), { recursive: true, force: true });
    }
    tryGit(repo, ["worktree", "prune"]);
    const base = resolveCommit(repo, branchFrom);
    git(repo, ["worktree", "add", "--detach", path, base]);
    return base;
  },
  // Best-effort (cermin addWorktree reclaim): worktree bisa sudah dipangkas/dihapus di tengah run
  // (mis. sesi sibling menyelesaikan kerja yang sama). `git worktree remove` telanjang akan throw
  // `fatal: not a working tree` → membuat DELETE /terminal/sessions balas 500. remove+prune+rm
  // semuanya toleran, jadi penutupan sesi selalu 204 dan registrasi worktree tak stale (SPEC-197).
  removeWorktree: (repo, path) => {
    const target = isAbsolute(path) ? resolve(path) : resolve(repo, path);
    // SPEC-362 · jaring pengaman terakhir. `git worktree remove` di bawah ini memakai tryGit
    // (gagal-diam), jadi `rmSync` tetap jalan meski git MENOLAK — dan git memang menolak saat
    // path-nya bukan worktree tertaut melainkan checkout itu sendiri. Satu pemanggil yang salah
    // karenanya bisa menghapus seluruh checkout project; itu benar-benar pernah terjadi (lihat
    // gerbang `ownsWorktree` di routes/terminal.ts). Melempar, bukan diam: pemanggil yang sampai
    // ke sini punya bug, dan menyembunyikannya hanya menunda kerusakan berikutnya.
    if (target === resolve(repo)) {
      throw new Error(`removeWorktree menolak menghapus repo itu sendiri: ${target}`);
    }
    tryGit(repo, ["worktree", "remove", "--force", target]);
    tryGit(repo, ["worktree", "prune"]);
    rmSync(target, { recursive: true, force: true });
  },
  trashWorktree,
  // Dibaca di worktree sesi (bukan repo utama) tepat sebelum removeWorktree: HEAD-nya =
  // ujung range diff review sesudah item selesai (SPEC-176, ADR-0030).
  headSha: (worktree) => git(worktree, ["rev-parse", "HEAD"]).trim(),
  // SPEC-222 · project from-scratch lahir tanpa repo; scaffold butuh worktree berbasis HEAD.
  // git init (bila belum repo) + satu commit --allow-empty (bila belum ada HEAD), identitas
  // eksplisit agar tak gagal di mesin tanpa git identity global. Idempoten: repo dengan commit
  // dibiarkan apa adanya.
  initRepo: (dir) => {
    mkdirSync(dir, { recursive: true });
    const isRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8" });
    if (isRepo.status !== 0) git(dir, ["init", "-q", "-b", "main"]);
    const hasHead = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: dir, encoding: "utf8" });
    if (hasHead.status !== 0)
      git(dir, ["-c", "user.email=hanoman@local", "-c", "user.name=hanoman",
        "commit", "-qm", "init: hanoman scaffold", "--allow-empty"]);
  },
  // SPEC-394 · "boleh dipakai ulang?" harus dijawab git, bukan filesystem. Dua pertanyaan, dan
  // keduanya wajib: (1) apakah ini di dalam work tree — menyingkirkan direktori yang gitdir-nya
  // sudah dipangkas; (2) apakah toplevel-nya path ini SENDIRI — menyingkirkan direktori telanjang
  // di dalam repo induk, yang menjawab "true" untuk pertanyaan pertama. cwd yang tak ada membuat
  // spawnSync gagal (`status` null), dan itu sudah tertangkap `!== 0`.
  worktreeAlive: (path) => {
    const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: path, encoding: "utf8" });
    if (inside.status !== 0 || inside.stdout.trim() !== "true") return false;
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: path, encoding: "utf8" });
    return top.status === 0 && samePath(top.stdout.trim(), path);
  },
  // SPEC-394 · cermin `tryRev` di resolveCommit, tapi LITERAL: pemanggil yang memilih urutan
  // (origin/<branch> → <branch> → headSha), jadi DWIM `origin/` di sini justru menyamarkan
  // "branch lokal tak ada" jadi "ada". `--end-of-options` menjaga ADR-0032.
  revParse: (repo, rev) => {
    const r = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`],
      { cwd: repo, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  },
  // SPEC-447 · `git merge-base --is-ancestor A B` = exit 0 (ya) / 1 (tidak) / lainnya (error).
  // `--end-of-options` menjaga ADR-0032: sha & ref datang dari DB/kolom, jangan sampai terbaca
  // sebagai flag. Ref yang tak resolve membuat git exit 128 → dibaca sebagai "belum" (fail-closed).
  isAncestor: (repo, sha, ref) => {
    const r = spawnSync("git", ["merge-base", "--is-ancestor", "--end-of-options", sha, ref],
      { cwd: repo, encoding: "utf8" });
    return r.status === 0;
  },
};
