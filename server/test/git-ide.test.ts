import { describe, it, expect } from "vitest";
import { makeTempRepo, makeRepoWithBranches, makeRepoWithSpecCommits, makeRepoWithSpecBranch, makeRepoWithChanges } from "./factory";
import { listRepoTree, readRepoFile, repoAbsPath, listGraph, commitDetail, writeRepoFile, runGitOp, validateGitOp, workingStatus, workingFileDiff, touchesTree, repoStatus, listStashes, commitFileDiff, compareCommits, compareFile, searchCommits } from "../src/services/git-ide";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const NUL = "a" + String.fromCharCode(0) + "b";

describe("git-ide read", () => {
  it("listRepoTree working tree = tracked ∪ untracked, sorted", async () => {
    const dir = makeTempRepo({ "src/a.ts": "1", "README.md": "x" });
    expect(await listRepoTree(dir)).toEqual(["README.md", "src/a.ts"]);
  });
  it("listRepoTree at a ref = snapshot ls-tree", async () => {
    const dir = makeRepoWithBranches("dev"); // punya README.md ter-commit di main
    expect(await listRepoTree(dir, "main")).toEqual(["README.md"]);
  });
  it("listRepoTree: repoDir null / bukan repo → []", async () => {
    expect(await listRepoTree(null)).toEqual([]);
    expect(await listRepoTree(makeTempRepo({}) + "/nope")).toEqual([]);
  });
  it("readRepoFile working tree membaca isi disk", async () => {
    const dir = makeTempRepo({ "a.txt": "halo\n" });
    expect(await readRepoFile(dir, "a.txt")).toMatchObject({ content: "halo\n", binary: false });
  });
  it("readRepoFile at a ref membaca via git show", async () => {
    const dir = makeRepoWithBranches();
    expect((await readRepoFile(dir, "README.md", "main"))!.content).toBe("x");
  });
  it("readRepoFile: NUL byte → binary, content null", async () => {
    const dir = makeTempRepo({ "b.bin": NUL });
    expect(await readRepoFile(dir, "b.bin")).toMatchObject({ binary: true, content: null });
  });
  it("readRepoFile: file tak ada → null", async () => {
    expect(await readRepoFile(makeTempRepo({}), "ghost.txt")).toBeNull();
  });
  it("repoAbsPath menolak keluar repo & .git", () => {
    const dir = makeTempRepo({});
    expect(() => repoAbsPath(dir, "../etc/passwd")).toThrow();
    expect(() => repoAbsPath(dir, ".git/config")).toThrow();
    expect(repoAbsPath(dir, "src/a.ts")).toBe(`${dir}/src/a.ts`);
  });
});

describe("git-ide graph", () => {
  it("listGraph mengembalikan commit terurut + refs + current branch", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "kedua", changes: { "a.txt": "2" } }]);
    const g = await listGraph(dir);
    expect(g.commits.length).toBe(2);
    expect(g.commits[0]!.subject).toBe("kedua");
    expect(g.commits[0]!.parents.length).toBe(1);
    expect(g.commits[1]!.parents.length).toBe(0); // root
    expect(g.current).toBe("main");
    expect(g.commits.some((c) => c.refs.includes("main"))).toBe(true);
  });
  it("listGraph: repoDir null → kosong", async () => {
    // SPEC-523 · balasan graph kini membawa `total` (jumlah commit terjangkau); repo tak ada → 0.
    expect(await listGraph(null)).toEqual({ commits: [], current: "", total: 0 });
  });
  it("commitDetail: file berubah + pesan", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "ubah", changes: { "a.txt": "2\n" } }]);
    const head = (await listGraph(dir)).commits[0]!.sha;
    const d = await commitDetail(dir, head);
    expect(d!.subject).toBe("ubah");
    expect(d!.changed.map((c) => c.path)).toEqual(["a.txt"]);
    expect(d!.changed[0]!).toMatchObject({ status: "M" });
  });
  it("commitDetail: sha bukan hex → null (gerbang)", async () => {
    expect(await commitDetail(makeRepoWithSpecCommits({ "a": "1" }, []), "../etc")).toBeNull();
  });
});

describe("git-ide write + mutate", () => {
  it("writeRepoFile menulis ke disk lewat path-guard", async () => {
    const dir = makeTempRepo({});
    await writeRepoFile(dir, "sub/x.ts", "isi\n");
    expect(readFileSync(`${dir}/sub/x.ts`, "utf8")).toBe("isi\n");
  });
  it("writeRepoFile menolak path keluar repo", async () => {
    await expect(writeRepoFile(makeTempRepo({}), "../evil", "x")).rejects.toThrow();
  });
  it("runGitOp checkout memindah HEAD", async () => {
    const dir = makeRepoWithBranches("dev");
    const r = await runGitOp(dir, { op: "checkout", ref: "dev" });
    expect(r.ok).toBe(true);
    expect(r.current).toBe("dev");
  });
  it("runGitOp checkout ref tak ada → ok:false + stderr (bukan throw)", async () => {
    const r = await runGitOp(makeRepoWithBranches(), { op: "checkout", ref: "ghost" });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/ghost|did not match|pathspec/i);
  });
  it("runGitOp branch + checkout membuat & pindah", async () => {
    const dir = makeRepoWithBranches();
    const r = await runGitOp(dir, { op: "branch", name: "feat-x", checkout: true });
    expect(r.ok).toBe(true);
    expect(r.current).toBe("feat-x");
  });
  it("validateGitOp menolak op tak dikenal & field kurang", () => {
    expect(validateGitOp({ op: "nuke" })).toBeTruthy();
    expect(validateGitOp({ op: "checkout" })).toBeTruthy();
    expect(validateGitOp({ op: "checkout", ref: "main" })).toBeNull();
  });
});

describe("git-ide merge fast-forward opsional (SPEC-193)", () => {
  const parentsOf = (dir: string): string[] =>
    spawnSync("git", ["rev-list", "--parents", "-n1", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim().split(" ");

  // main & dev di base yang sama, lalu dev MAJU 1 commit → dev bisa di-fast-forward ke main.
  // HEAD ditinggal di main (tertinggal 1 commit di belakang dev).
  function makeFfRepo(): string {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/on-dev.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev ahead");
    g("checkout", "-q", "main");
    return dir;
  }

  // main & dev sama-sama maju 1 commit dari base (file beda) → divergen, tak bisa fast-forward.
  function makeDivergentRepo(): string {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    writeFileSync(`${dir}/on-main.txt`, "m"); g("add", "-A"); g("commit", "-qm", "main advance");
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/on-dev.txt`, "d"); g("add", "-A"); g("commit", "-qm", "dev advance");
    g("checkout", "-q", "main");
    return dir;
  }

  it("merge --no-ff selalu buat merge commit (walau bisa ff)", async () => {
    const dir = makeFfRepo();
    const r = await runGitOp(dir, { op: "merge", ref: "dev", ff: "no-ff" });
    expect(r.ok).toBe(true);
    expect(parentsOf(dir).length).toBe(3); // commit + 2 parent = merge commit
  });

  it("merge --ff-only gagal saat divergen (ok:false, bukan throw)", async () => {
    const r = await runGitOp(makeDivergentRepo(), { op: "merge", ref: "dev", ff: "ff-only" });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/not possible to fast-forward|fast-forward/i);
  });

  it("merge tanpa ff = default (fast-forward: HEAD pindah tanpa merge commit)", async () => {
    const dir = makeFfRepo();
    const r = await runGitOp(dir, { op: "merge", ref: "dev" });
    expect(r.ok).toBe(true);
    expect(parentsOf(dir).length).toBe(2); // ff ke commit dev (1 parent) → commit + 1 parent
  });

  it("validateGitOp: ff harus no-ff/ff-only bila ada; absen valid", () => {
    expect(validateGitOp({ op: "merge", ref: "x", ff: "bogus" })).toBeTruthy();
    expect(validateGitOp({ op: "merge", ref: "x", ff: "no-ff" })).toBeNull();
    expect(validateGitOp({ op: "merge", ref: "x", ff: "ff-only" })).toBeNull();
    expect(validateGitOp({ op: "merge", ref: "x" })).toBeNull();
  });
});

describe("git-ide merge + hapus branch local & origin (SPEC-193)", () => {
  const list = (dir: string, ...a: string[]) =>
    spawnSync("git", a, { cwd: dir, encoding: "utf8" }).stdout.trim();

  it("merge deleteBranch: hapus branch local + origin setelah merge sukses", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest"); // main; branch hanoman/btest ada local + origin
    const branch = "hanoman/btest";
    const r = await runGitOp(repoDir, { op: "merge", ref: branch, deleteBranch: branch });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe("");          // local terhapus
    expect(list(repoDir, "ls-remote", "origin", branch)).toBe("");       // origin terhapus
  });

  it("merge deleteBranch tanpa origin: hapus local saja, tetap ok", async () => {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/z.txt`, "z"); g("add", "-A"); g("commit", "-qm", "dev ahead"); g("checkout", "-q", "main");
    const r = await runGitOp(dir, { op: "merge", ref: "dev", deleteBranch: "dev" });
    expect(r.ok).toBe(true);
    expect(list(dir, "branch", "--list", "dev")).toBe("");
  });

  it("merge gagal (konflik) TIDAK menghapus branch", async () => {
    // main & branch mengubah file sama → merge konflik; deleteBranch tak boleh jalan
    const { repoDir } = makeRepoWithSpecBranch("cft", { base: { "f.txt": "base\n" }, work: { "f.txt": "work\n" }, mainAdvance: { "f.txt": "main\n" } });
    const branch = "hanoman/cft";
    const r = await runGitOp(repoDir, { op: "merge", ref: branch, deleteBranch: branch });
    expect(r.ok).toBe(false);
    expect(list(repoDir, "branch", "--list", branch)).toBe(branch); // branch masih ada
  });

  it("validateGitOp: deleteBranch harus string tak kosong bila ada", () => {
    expect(validateGitOp({ op: "merge", ref: "x", deleteBranch: "" })).toBeTruthy();
    expect(validateGitOp({ op: "merge", ref: "x", deleteBranch: "dev" })).toBeNull();
  });
});

describe("git-ide hapus branch local &/atau origin standalone (SPEC-206)", () => {
  const list = (dir: string, ...a: string[]) =>
    spawnSync("git", a, { cwd: dir, encoding: "utf8" }).stdout.trim();
  const branch = "hanoman/btest";

  it("delete-branch remote:true → hapus branch local + origin", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest"); // main; branch local + origin
    const r = await runGitOp(repoDir, { op: "delete-branch", name: branch, remote: true, force: true });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe("");        // local terhapus
    expect(list(repoDir, "ls-remote", "origin", branch)).toBe("");     // origin terhapus
  });

  it("delete-branch local:false remote:true → hapus origin saja, local tetap", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest");
    const r = await runGitOp(repoDir, { op: "delete-branch", name: branch, local: false, remote: true });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe(branch);    // local tetap
    expect(list(repoDir, "ls-remote", "origin", branch)).toBe("");     // origin terhapus
  });

  it("delete-branch default → hapus local saja, origin tetap", async () => {
    const { repoDir } = makeRepoWithSpecBranch("btest");
    const r = await runGitOp(repoDir, { op: "delete-branch", name: branch, force: true });
    expect(r.ok).toBe(true);
    expect(list(repoDir, "branch", "--list", branch)).toBe("");        // local terhapus
    expect(list(repoDir, "ls-remote", "origin", branch)).not.toBe(""); // origin tetap
  });

  it("delete-branch remote:true origin tak ada → ok:false + stderr (local tetap terhapus)", async () => {
    const dir = makeRepoWithBranches("dev"); // tanpa origin
    const r = await runGitOp(dir, { op: "delete-branch", name: "dev", remote: true });
    expect(r.ok).toBe(false);                                          // push --delete gagal (no origin)
    expect(list(dir, "branch", "--list", "dev")).toBe("");             // local sudah terhapus lebih dulu
  });
});

describe("git-ide working status (SPEC-234)", () => {
  it("memisah staged (index vs HEAD) dari unstaged (working tree vs index) + untracked", async () => {
    const s = await workingStatus(makeRepoWithChanges());
    expect(s.branch).toBe("main");
    expect(s.staged.map((c) => c.path)).toEqual(["staged.txt"]);
    expect(s.staged[0]!).toMatchObject({ status: "M", add: 1, del: 0, binary: false });
    // unstaged terurut path: new.txt (untracked→A), tracked.txt (M)
    expect(s.unstaged.map((c) => c.path)).toEqual(["new.txt", "tracked.txt"]);
    expect(s.unstaged.find((c) => c.path === "new.txt")!).toMatchObject({ status: "A", add: 2, del: 0 });
    expect(s.unstaged.find((c) => c.path === "tracked.txt")!).toMatchObject({ status: "M", add: 1, del: 0 });
  });
  it("repoDir null / bukan repo → kosong, tak throw", async () => {
    expect(await workingStatus(null)).toEqual({ branch: "", staged: [], unstaged: [] });
    expect(await workingStatus(makeTempRepo({}) + "/nope")).toEqual({ branch: "", staged: [], unstaged: [] });
  });
  it("working tree bersih → staged & unstaged kosong", async () => {
    expect(await workingStatus(makeRepoWithBranches())).toMatchObject({ branch: "main", staged: [], unstaged: [] });
  });
});

describe("git-ide working file-diff (SPEC-234)", () => {
  it("staged: diff index vs HEAD + isi index", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "staged.txt", true);
    expect(f!.status).toBe("M");
    expect(f!.diff).toMatch(/\+two/);
    expect(f!.content).toBe("one\ntwo\n");
  });
  it("unstaged untracked: diff new-file penuh + isi disk", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "new.txt", false);
    expect(f!.status).toBe("A");
    expect(f!.diff).toMatch(/\+brand/);
    expect(f!.diff).toMatch(/\+new/);
    expect(f!.content).toBe("brand\nnew\n");
  });
  it("unstaged tracked: diff working tree vs index", async () => {
    const f = await workingFileDiff(makeRepoWithChanges(), "tracked.txt", false);
    expect(f!.status).toBe("M");
    expect(f!.diff).toMatch(/\+more/);
  });
  it("file tak dalam changeset → null (gerbang 404)", async () => {
    expect(await workingFileDiff(makeRepoWithChanges(), "staged.txt", false)).toBeNull();
    expect(await workingFileDiff(makeRepoWithChanges(), "ghost.txt", true)).toBeNull();
  });
  it("path keluar repo / .git → throw (gerbang 400)", async () => {
    await expect(workingFileDiff(makeRepoWithChanges(), "../evil", true)).rejects.toThrow();
    await expect(workingFileDiff(makeRepoWithChanges(), ".git/config", false)).rejects.toThrow();
  });
});

describe("git-ide reset (SPEC-233)", () => {
  const headMsg = (dir: string) => spawnSync("git", ["log", "-1", "--format=%s"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  it("reset --soft memindah HEAD, jaga index+worktree", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "kedua", changes: { "a.txt": "2" } }]);
    const root = (await listGraph(dir)).commits[1]!.sha;
    const r = await runGitOp(dir, { op: "reset", sha: root, mode: "soft" });
    expect(r.ok).toBe(true);
    expect(headMsg(dir)).toBe("base");
    expect(readFileSync(`${dir}/a.txt`, "utf8")).toBe("2"); // worktree utuh
  });
  it("reset --hard membuang perubahan worktree", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "kedua", changes: { "a.txt": "2" } }]);
    const root = (await listGraph(dir)).commits[1]!.sha;
    const r = await runGitOp(dir, { op: "reset", sha: root, mode: "hard" });
    expect(r.ok).toBe(true);
    expect(readFileSync(`${dir}/a.txt`, "utf8")).toBe("1"); // kembali ke base
  });
  it("validateGitOp reset butuh sha + mode valid", () => {
    expect(validateGitOp({ op: "reset", sha: "abc123" })).toBeTruthy();
    expect(validateGitOp({ op: "reset", sha: "abc123", mode: "bogus" })).toBeTruthy();
    expect(validateGitOp({ op: "reset", sha: "abc123", mode: "hard" })).toBeNull();
  });
  it("touchesTree: reset menyentuh tree, tag/rename/fetch tidak", () => {
    expect(touchesTree({ op: "reset", sha: "x", mode: "hard" })).toBe(true);
    expect(touchesTree({ op: "checkout", ref: "main" })).toBe(true);
    expect(touchesTree({ op: "fetch" })).toBe(false);
  });
});

describe("git-ide tag (SPEC-233)", () => {
  const tags = (dir: string) => spawnSync("git", ["tag", "--list"], { cwd: dir, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  it("tag lightweight di commit + graph memuat tags terpisah dari refs", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const head = (await listGraph(dir)).commits[0]!.sha;
    const r = await runGitOp(dir, { op: "tag", name: "v1", at: head });
    expect(r.ok).toBe(true);
    expect(tags(dir)).toContain("v1");
    const g = await listGraph(dir);
    expect(g.commits[0]!.tags).toContain("v1");
    expect(g.commits[0]!.refs).not.toContain("v1"); // tag tak bocor ke refs branch
  });
  it("tag annotated menyimpan pesan", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const r = await runGitOp(dir, { op: "tag", name: "v2", message: "rilis dua" });
    expect(r.ok).toBe(true);
    expect(spawnSync("git", ["tag", "-n", "--list", "v2"], { cwd: dir, encoding: "utf8" }).stdout).toMatch(/rilis dua/);
  });
  it("delete-tag menghapus tag", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    await runGitOp(dir, { op: "tag", name: "v1" });
    const r = await runGitOp(dir, { op: "delete-tag", name: "v1" });
    expect(r.ok).toBe(true);
    expect(tags(dir)).not.toContain("v1");
  });
  it("validateGitOp tag/delete-tag/push-tag butuh name", () => {
    expect(validateGitOp({ op: "tag" })).toBeTruthy();
    expect(validateGitOp({ op: "tag", name: "v1" })).toBeNull();
    expect(validateGitOp({ op: "delete-tag", name: "v1" })).toBeNull();
    expect(validateGitOp({ op: "push-tag", name: "v1" })).toBeNull();
  });
});

describe("git-ide status + worktree ops (SPEC-233)", () => {
  it("repoStatus melaporkan untracked + unstaged + clean flag", async () => {
    const dir = makeRepoWithBranches(); // README.md ter-commit, main
    writeFileSync(`${dir}/README.md`, "berubah"); writeFileSync(`${dir}/baru.txt`, "x");
    const s = await repoStatus(dir);
    expect(s.branch).toBe("main");
    expect(s.clean).toBe(false);
    expect(s.untracked).toContain("baru.txt");
    expect(s.unstaged).toContain("README.md");
  });
  it("repoStatus repo bersih → clean:true", async () => {
    expect((await repoStatus(makeRepoWithBranches())).clean).toBe(true);
    expect((await repoStatus(null)).clean).toBe(true);
  });
  it("reset-worktree hard mengembalikan file terlacak", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/README.md`, "berubah");
    const r = await runGitOp(dir, { op: "reset-worktree", mode: "hard" });
    expect(r.ok).toBe(true);
    expect(readFileSync(`${dir}/README.md`, "utf8")).toBe("x");
  });
  it("clean membuang untracked", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/sampah.txt`, "x");
    const r = await runGitOp(dir, { op: "clean", directories: true });
    expect(r.ok).toBe(true);
    expect(existsSync(`${dir}/sampah.txt`)).toBe(false);
  });
  it("validateGitOp reset-worktree butuh mode mixed/hard; clean valid", () => {
    expect(validateGitOp({ op: "reset-worktree", mode: "soft" })).toBeTruthy();
    expect(validateGitOp({ op: "reset-worktree", mode: "hard" })).toBeNull();
    expect(validateGitOp({ op: "clean" })).toBeNull();
  });
});

describe("git-ide stash (SPEC-233)", () => {
  it("stash create bersihkan worktree, list menampilkan, apply mengembalikan", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/README.md`, "wip");
    expect((await runGitOp(dir, { op: "stash", message: "kerjaan" })).ok).toBe(true);
    expect(readFileSync(`${dir}/README.md`, "utf8")).toBe("x"); // worktree bersih
    const list = await listStashes(dir);
    expect(list[0]!.ref).toBe("stash@{0}");
    expect(list[0]!.message).toMatch(/kerjaan/);
    expect((await runGitOp(dir, { op: "stash-apply", ref: "stash@{0}" })).ok).toBe(true);
    expect(readFileSync(`${dir}/README.md`, "utf8")).toBe("wip");
  });
  it("stash-drop menghapus entri stash", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/README.md`, "wip"); await runGitOp(dir, { op: "stash" });
    expect((await listStashes(dir)).length).toBe(1);
    expect((await runGitOp(dir, { op: "stash-drop", ref: "stash@{0}" })).ok).toBe(true);
    expect((await listStashes(dir)).length).toBe(0);
  });
  it("stash-branch membuat branch dari stash", async () => {
    const dir = makeRepoWithBranches();
    writeFileSync(`${dir}/README.md`, "wip"); await runGitOp(dir, { op: "stash" });
    const r = await runGitOp(dir, { op: "stash-branch", ref: "stash@{0}", name: "wip-b" });
    expect(r.ok).toBe(true); expect(r.current).toBe("wip-b");
  });
  it("validateGitOp stash-* butuh ref/name sesuai", () => {
    expect(validateGitOp({ op: "stash" })).toBeNull();
    expect(validateGitOp({ op: "stash-apply" })).toBeTruthy();
    expect(validateGitOp({ op: "stash-apply", ref: "stash@{0}" })).toBeNull();
    expect(validateGitOp({ op: "stash-branch", ref: "stash@{0}" })).toBeTruthy();
    expect(validateGitOp({ op: "stash-branch", ref: "stash@{0}", name: "b" })).toBeNull();
  });
  it("touchesTree: stash-drop ref-only, stash-apply menyentuh tree", () => {
    expect(touchesTree({ op: "stash-drop", ref: "stash@{0}" })).toBe(false);
    expect(touchesTree({ op: "stash-apply", ref: "stash@{0}" })).toBe(true);
  });
});

describe("git-ide branch ops (SPEC-233)", () => {
  const branches = (dir: string) => spawnSync("git", ["branch", "--format=%(refname:short)"], { cwd: dir, encoding: "utf8" }).stdout.trim().split("\n");
  it("rename-branch mengganti nama", async () => {
    const dir = makeRepoWithBranches("dev");
    const r = await runGitOp(dir, { op: "rename-branch", from: "dev", to: "develop" });
    expect(r.ok).toBe(true);
    expect(branches(dir)).toContain("develop"); expect(branches(dir)).not.toContain("dev");
  });
  it("push-branch ke origin memperbarui remote", async () => {
    const { repoDir } = makeRepoWithSpecBranch("pb"); // punya origin
    const g = (...a: string[]) => spawnSync("git", a, { cwd: repoDir, encoding: "utf8" });
    g("checkout", "-q", "-b", "extra"); writeFileSync(`${repoDir}/e.txt`, "e"); g("add", "-A"); g("commit", "-qm", "e");
    const r = await runGitOp(repoDir, { op: "push-branch", name: "extra", setUpstream: true });
    expect(r.ok).toBe(true);
    expect(spawnSync("git", ["ls-remote", "origin", "extra"], { cwd: repoDir, encoding: "utf8" }).stdout).toMatch(/extra/);
  });
  it("fetch prune tak melempar", async () => {
    const { repoDir } = makeRepoWithSpecBranch("fp");
    expect((await runGitOp(repoDir, { op: "fetch", prune: true })).ok).toBe(true);
  });
  it("validateGitOp rename/push/fetch", () => {
    expect(validateGitOp({ op: "rename-branch", from: "a" })).toBeTruthy();
    expect(validateGitOp({ op: "rename-branch", from: "a", to: "b" })).toBeNull();
    expect(validateGitOp({ op: "push-branch", name: "x" })).toBeNull();
    expect(validateGitOp({ op: "fetch" })).toBeNull();
  });
});

describe("git-ide commit detail diff + signature (SPEC-233)", () => {
  it("commitFileDiff mengembalikan diff satu file vs parent", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "satu\n" }, [{ msg: "ubah", changes: { "a.txt": "dua\n" } }]);
    const head = (await listGraph(dir)).commits[0]!.sha;
    const f = await commitFileDiff(dir, head, "a.txt");
    expect(f!.diff).toMatch(/-satu/); expect(f!.diff).toMatch(/\+dua/);
    expect(f!.status).toBe("M");
  });
  it("commitFileDiff sha bukan hex → null; path keluar repo → throw", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    expect(await commitFileDiff(dir, "../etc", "a")).toBeNull();
    const head = (await listGraph(dir)).commits[0]!.sha;
    await expect(async () => { await commitFileDiff(dir, head, "../evil"); }).rejects.toThrow();
  });
  it("commitDetail memuat signed(false unsigned) + committer", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const head = (await listGraph(dir)).commits[0]!.sha;
    const d = await commitDetail(dir, head);
    expect(d!.signed).toBe(false);
    expect(typeof d!.committer).toBe("string");
    expect(d!.subject).toBe("base");
  });
});

describe("git-ide compare (SPEC-233)", () => {
  it("compareCommits mendaftar file yang beda antar dua commit", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "1" }, [{ msg: "c2", changes: { "b.txt": "2" } }, { msg: "c3", changes: { "c.txt": "3" } }]);
    const cs = (await listGraph(dir)).commits; const from = cs[2]!.sha, to = cs[0]!.sha;
    const r = await compareCommits(dir, from, to);
    expect(r.changed.map((c) => c.path).sort()).toEqual(["b.txt", "c.txt"]);
  });
  it("compareFile mengembalikan diff terarah from→to", async () => {
    const dir = makeRepoWithSpecCommits({ "a.txt": "satu\n" }, [{ msg: "c2", changes: { "a.txt": "dua\n" } }]);
    const cs = (await listGraph(dir)).commits;
    const f = await compareFile(dir, cs[1]!.sha, cs[0]!.sha, "a.txt");
    expect(f!.diff).toMatch(/-satu/); expect(f!.diff).toMatch(/\+dua/);
  });
});

describe("git-ide search (SPEC-233)", () => {
  it("searchCommits by message & author", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, [{ msg: "tambah fitur X", changes: { "x": "1" } }, { msg: "perbaiki bug", changes: { "y": "1" } }]);
    expect((await searchCommits(dir, "fitur", "message")).length).toBe(1);
    expect((await searchCommits(dir, "t@t", "author")).length).toBeGreaterThan(0);
  });
  it("searchCommits by hash prefix", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const head = (await listGraph(dir)).commits[0]!.sha;
    expect(await searchCommits(dir, head.slice(0, 6), "hash")).toContain(head);
  });
  it("searchCommits q kosong → []", async () => {
    expect(await searchCommits(makeRepoWithSpecCommits({ "a": "1" }, []), "", "all")).toEqual([]);
  });
});

describe("git-ide graph filter (SPEC-233)", () => {
  it("listGraph branches filter membatasi ke ref tertentu", async () => {
    const dir = makeRepoWithBranches("dev");
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    g("checkout", "-q", "dev"); writeFileSync(`${dir}/d.txt`, "d"); g("add", "-A"); g("commit", "-qm", "hanya dev"); g("checkout", "-q", "main");
    const only = await listGraph(dir, 200, { branches: ["main"] });
    expect(only.commits.some((c) => c.subject === "hanya dev")).toBe(false);
    const all = await listGraph(dir, 200);
    expect(all.commits.some((c) => c.subject === "hanya dev")).toBe(true);
  });
  it("listGraph showTags:false mengecualikan commit yang hanya dijangkau tag", async () => {
    const dir = makeRepoWithSpecCommits({ "a": "1" }, []);
    const g = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
    // commit lepas hanya ditunjuk tag (tak di branch mana pun)
    g("checkout", "-q", "--detach"); writeFileSync(`${dir}/loose.txt`, "x"); g("add", "-A"); g("commit", "-qm", "loose commit");
    g("tag", "onlytag"); g("checkout", "-q", "main");
    expect((await listGraph(dir, 200)).commits.some((c) => c.subject === "loose commit")).toBe(true);
    expect((await listGraph(dir, 200, { showTags: false })).commits.some((c) => c.subject === "loose commit")).toBe(false);
  });
});
