import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { makeRepoWithSpecBranch, makeRepoWithBranches } from "./factory";
import { listUnusedBranches, deleteBranches, LOCK_REASON } from "../src/services/branch-cleanup";

const NONE = { openSpecBranches: new Set<string>(), sessionBranches: new Set<string>() };
const g = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

// Repo dgn origin + branch hanoman/<id> yang SUDAH di-merge ke main (local & origin).
function mergedRepo(specId: string): string {
  const { repoDir } = makeRepoWithSpecBranch(specId);
  g(repoDir, "merge", "--no-ff", "--no-edit", `hanoman/${specId}`);
  g(repoDir, "push", "-q", "origin", "main");
  return repoDir;
}

describe("listUnusedBranches", () => {
  it("branch ter-merge muncul dengan local+remote true", async () => {
    const r = await listUnusedBranches(mergedRepo("s1"), NONE);
    expect(r.base).toBe("main");
    expect(r.baseRemote).toBe("origin/main");
    expect(r.current).toBe("main");
    const b = r.branches.find((x) => x.name === "hanoman/s1");
    expect(b).toBeTruthy();
    expect(b!.local).toBe(true);
    expect(b!.remote).toBe(true);
    expect(b!.locks).toEqual([]);
    expect(b!.lastCommit?.subject).toBe("feat(s1): work");
  });

  it("branch BELUM ter-merge tidak muncul sama sekali", async () => {
    const { repoDir } = makeRepoWithSpecBranch("s2"); // tak di-merge
    const r = await listUnusedBranches(repoDir, NONE);
    expect(r.branches.some((x) => x.name === "hanoman/s2")).toBe(false);
  });

  it("base & current ikut tampil tapi terkunci", async () => {
    const r = await listUnusedBranches(mergedRepo("s3"), NONE);
    const main = r.branches.find((x) => x.name === "main")!;
    expect(main.locks).toContain("base");
    expect(main.locks).toContain("current");
  });

  // GOTCHA · git memendekkan origin/HEAD jadi bare "origin"
  it("origin/HEAD maupun bare origin tak pernah jadi baris", async () => {
    const dir = mergedRepo("s4");
    g(dir, "remote", "set-head", "origin", "main"); // membuat refs/remotes/origin/HEAD
    const r = await listUnusedBranches(dir, NONE);
    expect(r.branches.some((x) => x.name === "origin")).toBe(false);
    expect(r.branches.some((x) => x.name === "HEAD")).toBe(false);
    expect(r.branches.some((x) => x.name === "origin/HEAD")).toBe(false);
  });

  // SPEC-861 · kebuntuan 'branch tak bisa dihapus karena worktree, worktree tak terlihat di mana
  // pun' butuh jalan keluar: baris branch harus menyebut worktree MANA yang menguncinya.
  it("kunci worktree menyebut path worktree yang menguncinya", async () => {
    const dir = mergedRepo("s9");
    mkdirSync(join(dir, ".worktrees"), { recursive: true });
    g(dir, "worktree", "add", "-q", join(dir, ".worktrees", "wt-s9"), "hanoman/s9");
    const r = await listUnusedBranches(dir, NONE);
    const b = r.branches.find((x) => x.name === "hanoman/s9")!;
    expect(b.locks).toContain("worktree");
    // git menjawab path FISIK (macOS: /var/folders → /private/var/folders); yang dipakai UI
    // untuk menautkan ke baris tab Worktrees adalah `basename`-nya, dan itu sama di kedua bentuk.
    expect(b.worktree).toBe(join(realpathSync(dir), ".worktrees", "wt-s9"));
  });

  it("branch tanpa worktree tak punya field worktree", async () => {
    const r = await listUnusedBranches(mergedRepo("s10"), NONE);
    expect(r.branches.find((x) => x.name === "hanoman/s10")!.worktree).toBeUndefined();
  });

  // GOTCHA · di worktree detached, git branch --merged memancarkan baris "(no branch)"
  it('detached HEAD tak memunculkan baris hantu "(no branch)"', async () => {
    const dir = mergedRepo("s5");
    g(dir, "checkout", "-q", "--detach", "HEAD");
    const r = await listUnusedBranches(dir, NONE);
    expect(r.current).toBe("HEAD");
    expect(r.branches.some((x) => x.name === "(no branch)")).toBe(false);
    expect(r.branches.some((x) => x.name === "")).toBe(false);
    expect(r.branches.some((x) => x.name === "hanoman/s5")).toBe(true); // tetap terdeteksi
  });

  it("base non-main: repo ber-default master tetap resolve", async () => {
    const dir = makeRepoWithBranches("dev");
    g(dir, "branch", "-M", "master");
    const r = await listUnusedBranches(dir, NONE);
    expect(r.base).toBe("master");
    expect(r.baseRemote).toBeNull(); // repo tanpa remote
    expect(r.branches.some((x) => x.name === "dev")).toBe(true); // commit sama → ter-merge
  });

  it("base eksplisit dipakai bila resolve", async () => {
    const r = await listUnusedBranches(makeRepoWithBranches("dev"), { ...NONE, base: "dev" });
    expect(r.base).toBe("dev");
  });

  it("base eksplisit yang tak resolve jatuh ke fallback", async () => {
    const r = await listUnusedBranches(makeRepoWithBranches("dev"), { ...NONE, base: "ghost" });
    expect(r.base).toBe("main");
  });

  it("kunci worktree: branch ter-checkout di worktree lain", async () => {
    const dir = mergedRepo("s6");
    mkdirSync(join(dir, ".worktrees"), { recursive: true });
    g(dir, "worktree", "add", join(dir, ".worktrees", "wt"), "hanoman/s6");
    const r = await listUnusedBranches(dir, NONE);
    expect(r.branches.find((x) => x.name === "hanoman/s6")!.locks).toContain("worktree");
  });

  it("kunci spec-open & session dari parameter", async () => {
    const dir = mergedRepo("s7");
    const a = await listUnusedBranches(dir, { ...NONE, openSpecBranches: new Set(["hanoman/s7"]) });
    expect(a.branches.find((x) => x.name === "hanoman/s7")!.locks).toContain("spec-open");
    const b = await listUnusedBranches(dir, { ...NONE, sessionBranches: new Set(["hanoman/s7"]) });
    expect(b.branches.find((x) => x.name === "hanoman/s7")!.locks).toContain("session");
  });

  it("repoDir null / bukan repo → laporan kosong, tak melempar", async () => {
    expect(await listUnusedBranches(null, NONE)).toEqual({ base: "", baseRemote: null, current: "", branches: [] });
    const r = await listUnusedBranches("/tmp/hanoman-tidak-ada-repo-360", NONE);
    expect(r.branches).toEqual([]);
  });

  // SPEC-859 · daftar melebar ke SELURUH branch lewat include:"all".
  it("include all memuat branch yang BELUM ter-merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("a1"); // hanoman/a1 tak di-merge
    const r = await listUnusedBranches(repoDir, { ...NONE, include: "all" });
    const b = r.branches.find((x) => x.name === "hanoman/a1")!;
    expect(b).toBeTruthy();
    expect(b.merged).toBe(false);
    expect(b.local).toBe(true);
  });

  it("include all tetap menyaring baris hantu & origin/HEAD", async () => {
    const dir = mergedRepo("a2");
    g(dir, "remote", "set-head", "origin", "main");
    g(dir, "checkout", "-q", "--detach", "HEAD");
    const r = await listUnusedBranches(dir, { ...NONE, include: "all" });
    for (const ghost of ["(no branch)", "origin", "origin/HEAD", "HEAD", ""])
      expect(r.branches.some((x) => x.name === ghost)).toBe(false);
  });

  it("default (tanpa include) tetap HANYA branch ter-merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("a3");
    const r = await listUnusedBranches(repoDir, NONE);
    expect(r.branches.some((x) => x.name === "hanoman/a3")).toBe(false);
  });

  it("merged benar per sisi: ter-merge local+origin", async () => {
    const r = await listUnusedBranches(mergedRepo("a4"), { ...NONE, include: "all" });
    const b = r.branches.find((x) => x.name === "hanoman/a4")!;
    expect(b).toMatchObject({ local: true, remote: true, mergedLocal: true, mergedRemote: true, merged: true });
  });

  it("branch lokal tanpa ref origin: remote false, merged menilai sisi lokal saja", async () => {
    const dir = mergedRepo("a5");
    g(dir, "branch", "lokal-baru"); // di commit main → ter-merge, tanpa ref origin
    const r = await listUnusedBranches(dir, { ...NONE, include: "all" });
    const b = r.branches.find((x) => x.name === "lokal-baru")!;
    expect(b).toMatchObject({ local: true, remote: false, mergedRemote: false, merged: true });
  });

  it("kunci tetap dihitung untuk branch belum ter-merge", async () => {
    const { repoDir } = makeRepoWithSpecBranch("a6");
    const r = await listUnusedBranches(repoDir, {
      ...NONE, include: "all", sessionBranches: new Set(["hanoman/a6"]) });
    expect(r.branches.find((x) => x.name === "hanoman/a6")!.locks).toContain("session");
  });

  it("LOCK_REASON punya prosa Indonesia untuk tiap kunci", () => {
    for (const k of ["current", "base", "worktree", "spec-open", "session"] as const) {
      expect(LOCK_REASON[k]).toMatch(/\S/);
    }
  });
});

const branchList = (dir: string) =>
  g(dir, "branch", "--format=%(refname:short)").split("\n").map((s) => s.trim()).filter(Boolean);
const originList = (dir: string) =>
  g(dir, "branch", "-r", "--format=%(refname:short)").split("\n").map((s) => s.trim()).filter(Boolean);

describe("deleteBranches", () => {
  it("scope both menghapus local DAN origin", async () => {
    const dir = mergedRepo("d1");
    const r = await deleteBranches(dir, ["hanoman/d1"], { scope: "both", ...NONE });
    expect(r.results).toEqual([{ name: "hanoman/d1", ok: true, scope: "both" }]);
    expect(branchList(dir)).not.toContain("hanoman/d1");
    expect(originList(dir)).not.toContain("origin/hanoman/d1");
  });

  it("scope local menyisakan ref origin", async () => {
    const dir = mergedRepo("d2");
    const r = await deleteBranches(dir, ["hanoman/d2"], { scope: "local", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: true, scope: "local" });
    expect(branchList(dir)).not.toContain("hanoman/d2");
    expect(originList(dir)).toContain("origin/hanoman/d2");
  });

  it("scope remote menyisakan branch local", async () => {
    const dir = mergedRepo("d3");
    const r = await deleteBranches(dir, ["hanoman/d3"], { scope: "remote", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: true, scope: "remote" });
    expect(branchList(dir)).toContain("hanoman/d3");
    expect(originList(dir)).not.toContain("origin/hanoman/d3");
  });

  it("branch terkunci ditolak dengan alasan, git tak dipanggil", async () => {
    const dir = mergedRepo("d4");
    const r = await deleteBranches(dir, ["hanoman/d4"], {
      scope: "both", openSpecBranches: new Set(["hanoman/d4"]), sessionBranches: new Set() });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toContain(LOCK_REASON["spec-open"]);
    expect(branchList(dir)).toContain("hanoman/d4"); // masih ada
  });

  it("base & current tak bisa dihapus", async () => {
    const dir = mergedRepo("d5");
    const r = await deleteBranches(dir, ["main"], { scope: "both", ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(branchList(dir)).toContain("main");
  });

  it("branch belum ter-merge tak bisa diselundupkan lewat body", async () => {
    const { repoDir } = makeRepoWithSpecBranch("d6"); // hanoman/d6 BELUM ter-merge
    const r = await deleteBranches(repoDir, ["hanoman/d6"], { scope: "both", ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toContain("ter-merge");
    expect(branchList(repoDir)).toContain("hanoman/d6");
  });

  it("scope menyempit per branch: minta both pada branch tanpa origin → local saja", async () => {
    const dir = mergedRepo("d7");
    g(dir, "branch", "lokal-saja"); // di commit main → ter-merge, tanpa ref origin
    const r = await deleteBranches(dir, ["lokal-saja"], { scope: "both", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: true, scope: "local" });
    expect(branchList(dir)).not.toContain("lokal-saja");
  });

  it("minta remote pada branch tanpa origin → scope none, git tak dipanggil", async () => {
    const dir = mergedRepo("d8");
    g(dir, "branch", "lokal2");
    const r = await deleteBranches(dir, ["lokal2"], { scope: "remote", ...NONE });
    expect(r.results[0]).toMatchObject({ ok: false, scope: "none" });
    expect(branchList(dir)).toContain("lokal2");
  });

  it("satu gagal tak menjatuhkan sisanya", async () => {
    const dir = mergedRepo("d9");
    g(dir, "branch", "ikut");
    const r = await deleteBranches(dir, ["main", "ikut"], { scope: "local", ...NONE });
    expect(r.results.find((x) => x.name === "main")!.ok).toBe(false);
    expect(r.results.find((x) => x.name === "ikut")!.ok).toBe(true);
    expect(branchList(dir)).not.toContain("ikut");
  });

  // SPEC-859 · amandemen ADR-0077 — branch belum ter-merge boleh dihapus, tapi HANYA lewat
  // gerbang eksplisit `allowUnmerged` (dikirim dialog konfirmasi risiko di UI).
  it("branch belum ter-merge DITOLAK tanpa allowUnmerged, alasannya menyebut risiko", async () => {
    const { repoDir } = makeRepoWithSpecBranch("u1");
    const r = await deleteBranches(repoDir, ["hanoman/u1"], { scope: "both", ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toMatch(/belum ter-merge/);
    expect(r.results[0]!.error).toMatch(/hilang/);
    expect(branchList(repoDir)).toContain("hanoman/u1");
  });

  it("allowUnmerged menghapus branch belum ter-merge dan menandainya forced", async () => {
    const { repoDir } = makeRepoWithSpecBranch("u2");
    const r = await deleteBranches(repoDir, ["hanoman/u2"], {
      scope: "local", allowUnmerged: true, ...NONE });
    expect(r.results[0]).toEqual({ name: "hanoman/u2", ok: true, scope: "local", forced: true });
    expect(branchList(repoDir)).not.toContain("hanoman/u2");
  });

  it("branch ter-merge TAK PERNAH dipaksa meski allowUnmerged menyala", async () => {
    const dir = mergedRepo("u3");
    const r = await deleteBranches(dir, ["hanoman/u3"], {
      scope: "both", allowUnmerged: true, ...NONE });
    expect(r.results[0]).toEqual({ name: "hanoman/u3", ok: true, scope: "both" });
  });

  it("kunci menang atas allowUnmerged", async () => {
    const { repoDir } = makeRepoWithSpecBranch("u4");
    const r = await deleteBranches(repoDir, ["hanoman/u4"], {
      scope: "both", allowUnmerged: true,
      openSpecBranches: new Set(["hanoman/u4"]), sessionBranches: new Set() });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toContain(LOCK_REASON["spec-open"]);
    expect(branchList(repoDir)).toContain("hanoman/u4");
  });

  it("nama yang bukan branch nyata tetap ditolak meski allowUnmerged menyala", async () => {
    const dir = mergedRepo("u5");
    const r = await deleteBranches(dir, ["tidak-ada-branch-ini"], {
      scope: "both", allowUnmerged: true, ...NONE });
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toMatch(/tak ditemukan/);
  });

  it("names kosong → results kosong, base tetap dilaporkan", async () => {
    const r = await deleteBranches(mergedRepo("d10"), [], { scope: "both", ...NONE });
    expect(r.results).toEqual([]);
    expect(r.base).toBe("main");
  });
});
