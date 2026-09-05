import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseWorktreePorcelain, listWorktrees, worktreeStats, type WorktreeInputs } from "../src/services/worktree-list";

// SPEC-861 · ADR-0132 · penemuan worktree HIDUP. Modul yang diuji di sini murni: tak menyentuh DB
// maupun tmux, jadi seluruh berkas ini berjalan atas repo git sungguhan saja.
const NONE: WorktreeInputs = { specs: new Map(), sessions: [] };
const g = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

// Repo: main + worktree detached `.worktrees/spec-1`, worktree ber-branch `.worktrees/wt-feat`,
// registrasi prunable `.worktrees/gone`, dan satu entri sampah di `.worktrees/.trash/`.
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-wtlist-"));
  g(dir, "init", "-q", "-b", "main");
  g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "x");
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "base");
  g(dir, "branch", "feat");
  g(dir, "worktree", "add", "-q", "--detach", join(dir, ".worktrees", "spec-1"), "main");
  g(dir, "worktree", "add", "-q", join(dir, ".worktrees", "wt-feat"), "feat");
  g(dir, "worktree", "add", "-q", "--detach", join(dir, ".worktrees", "gone"), "main");
  rmSync(join(dir, ".worktrees", "gone"), { recursive: true, force: true });
  const trash = join(dir, ".worktrees", ".trash", "spec-9.abc");
  mkdirSync(trash, { recursive: true });
  writeFileSync(join(trash, "x.txt"), "sampah");
  return dir;
}

describe("parseWorktreePorcelain", () => {
  it("membaca branch, detached, prunable, dan locked", () => {
    const rows = parseWorktreePorcelain([
      "worktree /r", "HEAD aaa", "branch refs/heads/main", "",
      "worktree /r/.worktrees/spec-1", "HEAD bbb", "detached", "",
      "worktree /r/.worktrees/gone", "HEAD ccc", "detached",
      "prunable gitdir file points to non-existent location", "",
      "worktree /r/.worktrees/held", "HEAD ddd", "detached", "locked alasan", "",
    ].join("\n"));
    expect(rows.map((r) => r.branch)).toEqual(["main", null, null, null]);
    expect(rows[2]!.prunable).toBe(true);
    expect(rows[3]!.locked).toBe(true);
    expect(rows[0]!.head).toBe("aaa");
  });

  it("keluaran kosong → nol baris", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("listWorktrees", () => {
  it("menemukan riwayat reconciled lama dan riwayat terbuka sebagai yatim", async () => {
    const dir = repo();
    for (const endedReason of ["reconciled", null]) {
      const r = await listWorktrees(dir, { ...NONE, history: [{
        id: "h1", sessionId: "spec-1", cwd: join(dir, ".worktrees", "spec-1"),
        startedAt: new Date(0), endedAt: endedReason ? new Date(1) : null, endedReason,
      }] });
      expect(r.worktrees.find((w) => w.name === "spec-1")?.orphan)
        .toEqual({ historyId: "h1", sessionId: "spec-1" });
      expect(r.worktrees.find((w) => w.name === "wt-feat")?.orphan).toBeUndefined();
    }
  });

  it("history terbaru closed membatalkan klaim yatim riwayat lama", async () => {
    const dir = repo();
    const h = { id: "old", sessionId: "spec-1", cwd: join(dir, ".worktrees", "spec-1"),
      startedAt: new Date(0), endedAt: new Date(1), endedReason: "reconciled" };
    const r = await listWorktrees(dir, { ...NONE, history: [
      { ...h, id: "new", startedAt: new Date(2), endedReason: "closed" }, h,
    ] });
    expect(r.worktrees.find((w) => w.name === "spec-1")?.orphan).toBeUndefined();
  });

  it("pane dengan id lama atau cwd yang dipakai ulang melindungi checkout", async () => {
    const dir = repo();
    const cwd = join(dir, ".worktrees", "spec-1");
    for (const [path, id] of [[dir, "spec-1"], [cwd, "new-session"], [join(cwd, "src"), "nested"]]) {
      const r = await listWorktrees(dir, { ...NONE,
        sessions: [{ cwd: path!, id: id!, specId: null }],
        history: [{ id: "h1", sessionId: "spec-1", cwd, startedAt: new Date(0),
          endedAt: new Date(1), endedReason: "reconciled" }],
      });
      expect(r.worktrees.find((w) => w.name === "spec-1")?.orphan).toBeUndefined();
    }
  });

  it("mendaftar worktree hidup dengan branch atau detached", async () => {
    const dir = repo();
    const r = await listWorktrees(dir, NONE);
    const byName = new Map(r.worktrees.map((w) => [w.name, w]));
    expect(byName.get("spec-1")!.branch).toBeNull();
    expect(byName.get("spec-1")!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(byName.get("wt-feat")!.branch).toBe("feat");
    expect(byName.get("gone")!.prunable).toBe(true);
  });

  it("entri .trash TIDAK pernah muncul", async () => {
    const r = await listWorktrees(repo(), NONE);
    expect(r.worktrees.some((w) => w.path.includes("/.trash/"))).toBe(false);
    expect(r.worktrees.some((w) => w.name === "spec-9.abc")).toBe(false);
  });

  it("repoDir sendiri tampil tapi TAK PERNAH deletable", async () => {
    const dir = repo();
    const r = await listWorktrees(dir, NONE);
    // git SELALU menjawab path fisik; /var/folders di macOS adalah symlink ke /private/**.
    const self = r.worktrees.find((w) => w.path === realpathSync(dir))!;
    expect(self.deletable).toBe(false);
    expect(self.blocked).toBe("checkout project");
    expect(r.worktrees.find((w) => w.name === "spec-1")!.deletable).toBe(true);
  });

  // GOTCHA · hanoman didogfood DI DALAM worktree-nya sendiri: sebuah project bisa ter-bind ke
  // checkout yang kebetulan berada di bawah `.worktrees/`. Menguji bentuk path saja pernah membuat
  // removeWorktree(repoDir, repoDir) menghapus checkout project itu sendiri (SPEC-362).
  it("project ter-bind ke checkout DI BAWAH .worktrees → tak ada baris yang deletable", async () => {
    const dir = repo();
    const bound = join(dir, ".worktrees", "spec-1");
    const r = await listWorktrees(bound, NONE);
    expect(r.worktrees.length).toBeGreaterThan(1);
    expect(r.worktrees.every((w) => !w.deletable)).toBe(true);
  });

  it("memetakan worktree ke SPEC lewat id sesi & stage-nya", async () => {
    const r = await listWorktrees(repo(), {
      specs: new Map([["spec-1", { id: "SPEC-1", stage: "executing" }]]),
      sessions: [],
    });
    const w = r.worktrees.find((x) => x.name === "spec-1")!;
    expect(w.spec).toEqual({ id: "SPEC-1", stage: "executing" });
    expect(r.worktrees.find((x) => x.name === "wt-feat")!.spec).toBeNull();
  });

  it("menandai sesi tmux hidup di worktree itu", async () => {
    const dir = repo();
    const r = await listWorktrees(dir, {
      specs: new Map(),
      sessions: [{ cwd: resolve(dir, ".worktrees", "spec-1"), id: "spec-1", specId: "SPEC-1" }],
    });
    expect(r.worktrees.find((w) => w.name === "spec-1")!.session).toEqual({ id: "spec-1", specId: "SPEC-1" });
    expect(r.worktrees.find((w) => w.name === "wt-feat")!.session).toBeNull();
  });

  it("createdAt terisi untuk worktree hidup, null untuk prunable", async () => {
    const r = await listWorktrees(repo(), NONE);
    expect(r.worktrees.find((w) => w.name === "spec-1")!.createdAt).toMatch(/^\d{4}-/);
    expect(r.worktrees.find((w) => w.name === "gone")!.createdAt).toBeNull();
  });

  // Cermin out() di branch-cleanup.ts: route ini read-only, repo rusak tak boleh jadi 500.
  it("bukan repo git / repoDir null → daftar kosong, tak melempar", async () => {
    expect((await listWorktrees(null, NONE)).worktrees).toEqual([]);
    const plain = mkdtempSync(join(tmpdir(), "hanoman-notrepo-"));
    expect((await listWorktrees(plain, NONE)).worktrees).toEqual([]);
  });
});

describe("worktreeStats", () => {
  const find = async (dir: string, name: string) =>
    (await listWorktrees(dir, NONE)).worktrees.find((w) => w.name === name)!;

  it("git gagal dibaca menghasilkan dampak tidak diketahui, bukan nol", async () => {
    const dir = repo();
    const w = await find(dir, "spec-1");
    const invalid = await worktreeStats("/repo-does-not-exist", { ...w, path: "/worktree-does-not-exist" });
    expect(invalid.dirtyFiles).toBeNull();
    expect(invalid.orphanCommits).toBeNull();
  });

  it("menghitung berkas yang belum tersimpan", async () => {
    const dir = repo();
    writeFileSync(join(dir, ".worktrees", "spec-1", "baru.txt"), "kerja");
    const s = await worktreeStats(dir, await find(dir, "spec-1"));
    expect(s.dirtyFiles).toBe(1);
    expect(s.sizeBytes).toBeGreaterThan(0);
  });

  it("commit yang juga ada di branch lain BUKAN yatim", async () => {
    const dir = repo();
    expect((await worktreeStats(dir, await find(dir, "wt-feat"))).orphanCommits).toBe(0);
  });

  // GOTCHA git 2.50.1 · pola --exclude untuk --branches RELATIF terhadap refs/heads/:
  // `--exclude=feat` bekerja, `--exclude=refs/heads/feat` diam-diam tak mengecualikan apa pun.
  // Untuk --remotes ia relatif terhadap refs/remotes/ → `*/feat`. Dan --exclude di-RESET sesudah
  // tiap --branches/--remotes/--tags, jadi wajib ditulis ulang sebelum masing-masing.
  it("commit di branch worktree ini SENDIRI dihitung yatim (ia ikut hilang bila branch dihapus)", async () => {
    const dir = repo();
    const wt = join(dir, ".worktrees", "wt-feat");
    writeFileSync(join(wt, "kerja.txt"), "satu");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "kerja");
    expect((await worktreeStats(dir, await find(dir, "wt-feat"))).orphanCommits).toBe(1);
  });

  it("commit detached yang lepas dari semua ref dihitung yatim", async () => {
    const dir = repo();
    const wt = join(dir, ".worktrees", "spec-1");
    writeFileSync(join(wt, "lepas.txt"), "x");
    g(wt, "add", "-A"); g(wt, "commit", "-qm", "lepas");
    expect((await worktreeStats(dir, await find(dir, "spec-1"))).orphanCommits).toBe(1);
  });

  it("baris prunable tak melempar dan menjawab nol", async () => {
    const dir = repo();
    const s = await worktreeStats(dir, await find(dir, "gone"));
    expect(s.dirtyFiles).toBe(0);
    expect(s.sizeBytes).toBeNull();
  });
});
