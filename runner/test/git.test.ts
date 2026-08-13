import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { realGit } from "../src/git";
const g = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" });
function seedRepo() {
  const remote = mkdtempSync(join(tmpdir(), "remote-")); g(remote, "init", "--bare", "-q");
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  g(repo, "init", "-q"); g(repo, "config", "user.email", "t@t"); g(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "x"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "init");
  g(repo, "branch", "-M", "main"); g(repo, "remote", "add", "origin", remote); g(repo, "push", "-q", "origin", "main");
  return { repo, remote };
}

// commitAndPush dan switchBase hilang bersama runner headless (SPEC-162): agen sendiri yang
// commit dan push dari dalam sesi interaktifnya.
describe("git worktree ops", () => {
  it("membangun worktree lalu membuangnya", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-1");
    realGit.addWorktree(repo, wt, "main");
    expect(existsSync(wt)).toBe(true);
    realGit.removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
  });

  it("addWorktree mengembalikan baseSha", () => {
    const { repo } = seedRepo();
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    const wt = join(repo, ".worktrees", "spec-sha");
    expect(realGit.addWorktree(repo, wt, "main")).toBe(head);
    realGit.removeWorktree(repo, wt);
  });

  // SPEC-176 · headSha dibaca sebelum removeWorktree untuk menyimpan ujung range review.
  it("headSha mengembalikan HEAD worktree", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-head");
    const base = realGit.addWorktree(repo, wt, "main"); // detached di base, belum commit
    expect(realGit.headSha(wt)).toBe(base);
    realGit.removeWorktree(repo, wt);
  });

  // Worktree yang tertinggal dari sesi mati tak boleh memblokir sesi berikutnya: id backlog
  // item bisa dipakai ulang, dan "already exists" akan menyandera Start selamanya.
  it("merebut kembali .worktrees/<id> yang tertinggal", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-ulang");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "kerja-lama.txt"), "x");
    expect(() => realGit.addWorktree(repo, wt, "main")).not.toThrow();
    expect(existsSync(join(wt, "kerja-lama.txt"))).toBe(false);  // pohon lama benar-benar dibuang
    realGit.removeWorktree(repo, wt);
  });

  // Worktree lahir detached: `main` boleh tetap ter-checkout di working tree utama (ADR-0002).
  it("worktree lahir detached, jadi branchFrom yang sedang dipakai tetap boleh", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-detach");
    realGit.addWorktree(repo, wt, "main");   // `main` ter-checkout di repo utama
    expect(g(wt, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim()).toBe("HEAD");
    realGit.removeWorktree(repo, wt);
  });

  // SPEC-143. `refs/heads/--force` adalah refname yang sah, jadi sebuah branch boleh bernama
  // `--force`: ia lolos whitelist (memang ada di repo) lalu `git worktree add --detach <path>
  // --force` membacanya sebagai OPSI. resolveCommit menyerahkan SHA, bukan nama.
  it("accepts a branch whose name looks like a flag", () => {
    const { repo } = seedRepo();
    // Branch bernama flag menunjuk commit PERTAMA, sementara HEAD sudah maju ke commit kedua.
    // Tanpa resolveCommit, git menelan `--force` sebagai opsi dan diam-diam memakai HEAD —
    // worktree terbangun di pohon yang salah tanpa satu pun error. Dua commit berbeda inilah
    // yang membedakan "branch dihormati" dari "branch diabaikan".
    const first = g(repo, "rev-parse", "HEAD").stdout.trim();
    g(repo, "update-ref", "refs/heads/--force", first);
    writeFileSync(join(repo, "kedua.txt"), "2"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "second");
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    expect(head).not.toBe(first);

    const wt = join(repo, ".worktrees", "spec-flag");
    realGit.addWorktree(repo, wt, "--force");
    expect(existsSync(wt)).toBe(true);
    expect(g(wt, "rev-parse", "HEAD").stdout.trim()).toBe(first); // bukan head
    realGit.removeWorktree(repo, wt);
  });

  // SPEC-244 · branch PRD/audit di-push dari worktree detached → hanya refs/remotes/origin/<b>
  // tersisa di mesin. resolveCommit harus fallback ke origin/<rev>.
  it("resolves a branchFrom that exists only on origin", () => {
    const { repo } = seedRepo();
    writeFileSync(join(repo, "f.txt"), "1"); g(repo, "add", "-A"); g(repo, "commit", "-qm", "c");
    const sha = g(repo, "rev-parse", "HEAD").stdout.trim();
    g(repo, "branch", "prd/x"); g(repo, "push", "-q", "origin", "prd/x");
    g(repo, "branch", "-D", "prd/x");                 // lokal hilang; origin/prd/x tetap
    const wt = join(repo, ".worktrees", "spec-origin");
    expect(realGit.addWorktree(repo, wt, "prd/x")).toBe(sha);
    realGit.removeWorktree(repo, wt);
  });

  // ADR-0009: branch yang dihapus sebelum sesi dibuka gagal keras dan menyebut namanya,
  // bukan mundur diam-diam ke main.
  it("fails loud and names the missing branch", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-hantu");
    expect(() => realGit.addWorktree(repo, wt, "tidak-ada")).toThrow(/tidak-ada/);
  });

  // SPEC-197 · worktree bisa lenyap di tengah run (dipangkas sesi sibling). removeWorktree harus
  // toleran — DELETE /terminal/sessions tak boleh 500 hanya karena pohonnya sudah tak ada.
  // SPEC-362 · `git worktree remove` di bawahnya memakai tryGit (gagal-diam), jadi rmSync di baris
  // terakhir tetap jalan meski git menolak. Satu pemanggil yang salah karenanya bisa menghapus
  // seluruh checkout — itu benar-benar terjadi. Jaring pengaman terakhir: tolak repo itu sendiri.
  it("removeWorktree MENOLAK menghapus repo itu sendiri, dan isinya selamat", () => {
    const { repo } = seedRepo();
    expect(() => realGit.removeWorktree(repo, repo)).toThrow(/repo itu sendiri/);
    expect(existsSync(join(repo, "README.md"))).toBe(true);
    // path relatif yang menunjuk balik ke repo ditolak juga (dinormalkan dulu).
    expect(() => realGit.removeWorktree(repo, ".")).toThrow(/repo itu sendiri/);
    expect(existsSync(join(repo, "README.md"))).toBe(true);
  });

  it("removeWorktree pada path yang sudah hilang tak throw", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-lenyap");
    realGit.addWorktree(repo, wt, "main");
    rmSync(wt, { recursive: true, force: true });     // pohonnya raib, registrasi git masih stale
    expect(() => realGit.removeWorktree(repo, wt)).not.toThrow();
    expect(() => realGit.removeWorktree(repo, wt)).not.toThrow(); // dobel-panggil pun aman
  });
});

// SPEC-222 · project from-scratch lahir tanpa repo; scaffold butuh worktree berbasis HEAD.
describe("git initRepo", () => {
  it("membuat repo dengan satu HEAD commit di direktori kosong", () => {
    const dir = mkdtempSync(join(tmpdir(), "init-"));
    realGit.initRepo(dir);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(g(dir, "rev-parse", "HEAD").status).toBe(0);          // HEAD resolves
    const wt = join(dir, ".worktrees", "scaffold-x");
    expect(() => realGit.addWorktree(dir, wt, "HEAD")).not.toThrow();
    realGit.removeWorktree(dir, wt);
  });

  it("membuat direktori bila belum ada", () => {
    const parent = mkdtempSync(join(tmpdir(), "init-parent-"));
    const dir = join(parent, "nested", "proj");
    realGit.initRepo(dir);
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });

  it("idempoten: repo yang sudah punya commit tak berubah HEAD-nya", () => {
    const { repo } = seedRepo();
    const before = g(repo, "rev-parse", "HEAD").stdout.trim();
    realGit.initRepo(repo);
    expect(g(repo, "rev-parse", "HEAD").stdout.trim()).toBe(before); // no new commit
  });
});

// SPEC-394 · jalur "melanjutkan" harus bisa bertanya ke git tanpa efek samping: apakah
// worktree-nya masih sah, dan apakah sebuah rev masih resolve.
describe("git · pembacaan untuk resume (SPEC-394)", () => {
  it("worktreeAlive true untuk worktree yang sah, false sesudah dihapus", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-alive");
    realGit.addWorktree(repo, wt, "main");
    expect(realGit.worktreeAlive(wt)).toBe(true);
    realGit.removeWorktree(repo, wt);
    expect(realGit.worktreeAlive(wt)).toBe(false);
  });

  it("worktreeAlive false untuk direktori biasa DI DALAM repo", () => {
    const { repo } = seedRepo();
    const plain = join(repo, ".worktrees", "bukan-worktree");
    mkdirSync(plain, { recursive: true });
    // `rev-parse --is-inside-work-tree` di sini menjawab true (ia di dalam repo induk);
    // yang membedakan hanya toplevel-nya, dan itulah yang wajib diuji.
    expect(realGit.worktreeAlive(plain)).toBe(false);
  });

  it("worktreeAlive false untuk path yang tak ada", () => {
    const { repo } = seedRepo();
    expect(realGit.worktreeAlive(join(repo, ".worktrees", "tak-pernah-ada"))).toBe(false);
  });

  it("revParse mengembalikan sha untuk rev yang ada, null untuk yang tidak", () => {
    const { repo } = seedRepo();
    const head = g(repo, "rev-parse", "HEAD").stdout.trim();
    expect(realGit.revParse(repo, "main")).toBe(head);
    expect(realGit.revParse(repo, "hanoman/tidak-ada")).toBeNull();
    expect(realGit.revParse(repo, "--upload-pack=jahat")).toBeNull();   // ADR-0032: argumen berbentuk flag
  });

  it("revParse melihat branch yang di-push dari worktree detached", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-push");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "a.txt"), "x");
    g(wt, "add", "-A"); g(wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "kerja");
    const tip = g(wt, "rev-parse", "HEAD").stdout.trim();
    g(wt, "push", "-q", "origin", "HEAD:refs/heads/hanoman/spec-push");
    realGit.removeWorktree(repo, wt);
    expect(realGit.revParse(repo, "origin/hanoman/spec-push")).toBe(tip);
  });
});

// SPEC-447 · "sudah ter-merge?" adalah pertanyaan ke git, bukan kolom DB (ADR-0019).
describe("realGit.isAncestor", () => {
  function repoWithBranch(): { dir: string; baseSha: string; featSha: string } {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-anc-"));
    g(dir, "init", "-q");
    g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "1"); g(dir, "add", "-A"); g(dir, "commit", "-qm", "base");
    g(dir, "branch", "-M", "main");
    const baseSha = g(dir, "rev-parse", "HEAD").stdout.trim();
    g(dir, "checkout", "-q", "-b", "feat");
    writeFileSync(join(dir, "b.txt"), "2"); g(dir, "add", "-A"); g(dir, "commit", "-qm", "feat");
    const featSha = g(dir, "rev-parse", "HEAD").stdout.trim();
    g(dir, "checkout", "-q", "main");
    return { dir, baseSha, featSha };
  }

  it("false selama commit branch belum ter-merge, true sesudahnya", () => {
    const { dir, featSha } = repoWithBranch();
    expect(realGit.isAncestor(dir, featSha, "main")).toBe(false);
    g(dir, "merge", "-q", "--no-ff", "-m", "merge feat", "feat");
    expect(realGit.isAncestor(dir, featSha, "main")).toBe(true);
  });

  it("commit dianggap leluhur dirinya sendiri", () => {
    const { dir, baseSha } = repoWithBranch();
    expect(realGit.isAncestor(dir, baseSha, "main")).toBe(true);
  });

  // Fail-closed: "tak bisa dipastikan" tak boleh terbaca sebagai "aman".
  it("false (tanpa melempar) untuk ref/sha yang tak resolve dan repo yang tak ada", () => {
    const { dir, featSha } = repoWithBranch();
    expect(realGit.isAncestor(dir, featSha, "tak-ada-branch")).toBe(false);
    expect(realGit.isAncestor(dir, "0".repeat(40), "main")).toBe(false);
    expect(realGit.isAncestor(join(dir, "bukan-repo"), featSha, "main")).toBe(false);
  });
});

// SPEC-742 · ADR-0116 · path worktree dibebaskan dengan `rename` (1 ms), bukan dihapus (1 370 ms
// yang memblokir SELURUH event loop). Byte-nya dihapus penyapu latar di server.
describe("realGit.trashWorktree", () => {
  const trashDir = (repo: string) => join(repo, ".worktrees", ".trash");

  it("memindahkan worktree keluar dari path-nya, isinya utuh", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-742");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "PENANDA.txt"), "isi");

    const moved = realGit.trashWorktree(repo, wt);

    expect(moved).not.toBeNull();
    expect(existsSync(wt)).toBe(false);                        // path bebas SEKARANG
    expect(moved!.startsWith(trashDir(repo) + "/")).toBe(true);
    expect(existsSync(join(moved!, "PENANDA.txt"))).toBe(true); // dipindah, bukan dihapus
  });

  // Nama entri memuat id sesinya: satu-satunya cara GET /terminal/cleanups memulihkan
  // "milik sesi mana" sesudah restart, tanpa tabel (gotcha 5 ADR-0116).
  it("nama entri berawalan id sesi dan unik antar-pemindahan", () => {
    const { repo } = seedRepo();
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      const wt = join(repo, ".worktrees", "spec-742");
      mkdirSync(wt, { recursive: true });
      names.push(basename(realGit.trashWorktree(repo, wt)!));
    }
    expect(names.every((n) => n.split(".")[0] === "spec-742")).toBe(true);
    expect(new Set(names).size).toBe(3);
  });

  it("path yang tak ada → null (penutupan ganda idempoten)", () => {
    const { repo } = seedRepo();
    expect(realGit.trashWorktree(repo, join(repo, ".worktrees", "tak-ada"))).toBeNull();
  });

  // Cermin jaring pengaman removeWorktree (SPEC-362): rename sama merusaknya dengan rm bila
  // targetnya checkout project itu sendiri.
  it("menolak memindahkan repo itu sendiri", () => {
    const { repo } = seedRepo();
    expect(() => realGit.trashWorktree(repo, repo)).toThrow(/repo itu sendiri/);
  });

  it("target yang sudah di dalam .trash → null (tak pernah di-trash dua kali)", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-dua-kali");
    realGit.addWorktree(repo, wt, "main");
    const moved = realGit.trashWorktree(repo, wt)!;
    expect(realGit.trashWorktree(repo, moved)).toBeNull();
    expect(existsSync(moved)).toBe(true);
  });

  // SPEC-742 · reclaim `addWorktree` dulu `worktree remove --force` + `rmSync` — sinkron, atas
  // worktree penuh. Membuka lagi backlog `done` (SPEC-172) melewatinya setiap kali.
  it("addWorktree merebut path lewat .trash, bukan menghapus sinkron", () => {
    const { repo } = seedRepo();
    const wt = join(repo, ".worktrees", "spec-rebut");
    realGit.addWorktree(repo, wt, "main");
    writeFileSync(join(wt, "LAMA.txt"), "kerja sebelumnya");

    realGit.addWorktree(repo, wt, "main");

    expect(existsSync(wt)).toBe(true);                 // worktree baru lahir di path yang sama
    expect(existsSync(join(wt, "LAMA.txt"))).toBe(false);
    const kept = readdirSync(trashDir(repo)).map((n) => join(trashDir(repo), n, "LAMA.txt"));
    expect(kept.some(existsSync)).toBe(true);          // isi lama mendarat di trash
  });
});
