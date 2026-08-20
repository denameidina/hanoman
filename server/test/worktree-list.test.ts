import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseWorktreePorcelain, listWorktrees, type WorktreeInputs } from "../src/services/worktree-list";

// SPEC-861 · ADR-0132 · penemuan worktree HIDUP. Modul yang diuji di sini murni: tak menyentuh DB
// maupun tmux, jadi seluruh berkas ini berjalan atas repo git sungguhan saja.
const NONE: WorktreeInputs = { specs: new Map(), sessions: new Map() };
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
      sessions: new Map(),
    });
    const w = r.worktrees.find((x) => x.name === "spec-1")!;
    expect(w.spec).toEqual({ id: "SPEC-1", stage: "executing" });
    expect(r.worktrees.find((x) => x.name === "wt-feat")!.spec).toBeNull();
  });

  it("menandai sesi tmux hidup di worktree itu", async () => {
    const dir = repo();
    const r = await listWorktrees(dir, {
      specs: new Map(),
      sessions: new Map([[resolve(dir, ".worktrees", "spec-1"), { id: "spec-1", specId: "SPEC-1" }]]),
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
