import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { makeRepoWithWorktree } from "./factory";
import { collectOrphanWorktrees, type WorktreeInputs } from "../src/services/worktree-list";

function fixture() {
  const repoDir = makeRepoWithWorktree("spec-1", { "a.txt": "a" }, { "kerja.txt": "belum" });
  const cwd = join(repoDir, ".worktrees", "spec-1");
  const input: WorktreeInputs = { specs: new Map(), sessions: [], history: [{
    id: "h1", sessionId: "spec-1", cwd, startedAt: new Date(0),
    endedAt: new Date(1), endedReason: "reconciled",
  }] };
  const trash = join(repoDir, ".worktrees", ".trash", "spec-1.test");
  const deps = {
    inputs: async () => input,
    sessionsNow: (): WorktreeInputs["sessions"] => [],
    release: (_repo: string, path: string) => {
      mkdirSync(join(repoDir, ".worktrees", ".trash"), { recursive: true });
      renameSync(path, trash);
      return "spec-1.test";
    },
    prune: async () => {},
  };
  return { repoDir, cwd, input, trash, deps };
}

describe("pemungutan yatim setelah konfirmasi", () => {
  it("hanya memindahkan kandidat ke trash dan mempertahankan byte sampai reaper", async () => {
    const f = fixture();
    const r = await collectOrphanWorktrees(f.repoDir, ["spec-1"], f.deps);
    expect(r.results[0]).toEqual({ name: "spec-1", ok: true, cleanup: "spec-1.test" });
    expect(existsSync(f.cwd)).toBe(false);
    expect(existsSync(join(f.trash, "kerja.txt"))).toBe(true);
  });

  it.each(["id", "cwd", "tmux-error"])("%s berubah sebelum rename: checkout tetap utuh", async (kind) => {
    const f = fixture();
    f.deps.sessionsNow = () => {
      if (kind === "tmux-error") throw new Error("tmux unreadable");
      return [{ cwd: kind === "id" ? f.repoDir : f.cwd,
        id: kind === "id" ? "spec-1" : "new-session", specId: null }];
    };
    const r = await collectOrphanWorktrees(f.repoDir, ["spec-1"], f.deps);
    expect(r.results[0]?.ok).toBe(false);
    expect(existsSync(join(f.cwd, "kerja.txt"))).toBe(true);
  });

  it("tanpa history atau history terbaru closed bukan kandidat pemungutan", async () => {
    for (const history of [[], [{ endedReason: "closed" }]]) {
      const f = fixture();
      f.input.history = history.map((h) => ({ ...f.input.history![0]!, ...h }));
      const r = await collectOrphanWorktrees(f.repoDir, ["spec-1"], f.deps);
      expect(r.results[0]?.ok).toBe(false);
      expect(existsSync(f.cwd)).toBe(true);
    }
  });

  it("nama ambigu ditolak meskipun salah satunya yatim", async () => {
    const f = fixture();
    const other = join(f.repoDir, ".worktrees", "group", "spec-1");
    spawnSync("git", ["worktree", "add", "--detach", other, "HEAD"], { cwd: f.repoDir });
    const r = await collectOrphanWorktrees(f.repoDir, ["spec-1"], f.deps);
    expect(r.results[0]?.ok).toBe(false);
    expect(existsSync(f.cwd)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it("gagal rename dilaporkan tanpa menghapus path asal", async () => {
    const f = fixture();
    f.deps.release = () => { throw new Error("EXDEV rename"); };
    const r = await collectOrphanWorktrees(f.repoDir, ["spec-1"], f.deps);
    expect(r.results[0]).toMatchObject({ ok: false, error: "EXDEV rename" });
    expect(existsSync(join(f.cwd, "kerja.txt"))).toBe(true);
  });

  it("checkout project dan nama di luar daftar tidak dipungut", async () => {
    const f = fixture();
    const name = f.repoDir.split("/").pop()!;
    f.input.history!.push({ ...f.input.history![0]!, cwd: f.repoDir, id: "root" });
    const r = await collectOrphanWorktrees(f.repoDir, [name, "../../outside"], f.deps);
    expect(r.results.map((row) => row.ok)).toEqual([false, false]);
    expect(existsSync(join(f.repoDir, "a.txt"))).toBe(true);
  });
});
