import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resetDb, makeProject, makeRepoWithWorktree } from "./factory";
import { beginSession, reconcileHistory } from "../src/services/session-history";
import { detectOrphanWorktrees, projectWorktreeInputs } from "../src/services/worktree-project";
import * as pty from "../src/services/pty";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("deteksi worktree saat boot", () => {
  it("dua pane dengan cwd sama tidak menghilangkan perlindungan id sesi yang pertama", async () => {
    const repoDir = makeRepoWithWorktree("spec-1", { "a.txt": "a" }, {});
    await makeProject({ id: "p1", repoDir });
    await beginSession({ sessionId: "spec-1", projectId: "p1", cwd: join(repoDir, ".worktrees", "spec-1"),
      kind: "terminal", agent: "claude" });
    await reconcileHistory([]);
    vi.spyOn(pty, "listSessions").mockReturnValue([
      { id: "spec-1", cwd: repoDir, specId: "SPEC-1", exited: false },
      { id: "other", cwd: repoDir, exited: true },
    ] as ReturnType<typeof pty.listSessions>);
    expect(await detectOrphanWorktrees({
      repos: async () => [{ projectId: "p1", repoDir }], inputs: projectWorktreeInputs,
    })).toEqual([]);
  });

  it("riwayat yang sudah reconciled tetap ditemukan pada boot berikutnya tanpa melepas checkout", async () => {
    const repoDir = makeRepoWithWorktree("spec-1", { "a.txt": "a" }, { "belum.txt": "kerja" });
    await makeProject({ id: "p1", repoDir });
    const cwd = join(repoDir, ".worktrees", "spec-1");
    await beginSession({ sessionId: "spec-1", projectId: "p1", cwd, kind: "terminal", agent: "claude" });
    await reconcileHistory([]);
    for (let i = 0; i < 2; i++) {
      const result = await detectOrphanWorktrees({
        repos: async () => [{ projectId: "p1", repoDir }],
        inputs: (id) => projectWorktreeInputs(id, () => []),
      });
      expect(result).toEqual([{ projectId: "p1", count: 1 }]);
      expect(existsSync(join(cwd, "belum.txt"))).toBe(true);
    }
  });

  it("tmux tak terbaca menghentikan deteksi, bukan dianggap tak ada sesi", async () => {
    await makeProject({ id: "p1" });
    await expect(detectOrphanWorktrees({
      repos: async () => [{ projectId: "p1", repoDir: "/repo" }],
      inputs: (id) => projectWorktreeInputs(id, () => { throw new Error("tmux unreadable"); }),
    })).rejects.toThrow("tmux unreadable");
  });
});
