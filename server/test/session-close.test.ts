import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetDb, makeProject, makeRepoWithWorktree } from "./factory";
import { createSession, getSession, killAll } from "../src/services/pty";
import { closeSession } from "../src/services/session-close";
import { trashDirOf, __resetReaper } from "../src/services/worktree-reaper";

// SPEC-861 · ADR-0132 · badan penutupan sesi kini SATU definisi, dipakai
// `DELETE /terminal/sessions/:id` DAN `POST /projects/:id/worktrees/delete`.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

beforeEach(async () => {
  await resetDb();
  __resetReaper();
  process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;   // pane nyata tanpa memanggil `claude` asli
});
afterAll(() => { killAll(); });

describe("closeSession", () => {
  it("sesi tak ada → null", async () => {
    expect(await closeSession("tak-ada")).toBeNull();
  });

  it("melepas worktree sesi ke .trash dan mematikan pane-nya", async () => {
    const repoDir = makeRepoWithWorktree("spec-c1", { "a.txt": "a" }, {});
    await makeProject({ id: "closep", repoDir });
    const wt = join(repoDir, ".worktrees", "spec-c1");
    createSession("closep", wt, { id: "spec-c1" });

    const r = await closeSession("spec-c1");
    expect(r?.cleanup).toBeTruthy();
    expect(getSession("spec-c1")?.exited ?? true).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(trashDirOf(repoDir), r!.cleanup!))).toBe(true);
  });

  // SPEC-362 · terminal biasa punya cwd === repoDir; melepasnya berarti menghapus checkout project.
  it("terminal biasa (cwd = repoDir) TIDAK melepas apa pun", async () => {
    const repoDir = makeRepoWithWorktree("spec-c2", { "a.txt": "a" }, {});
    await makeProject({ id: "closep2", repoDir });
    createSession("closep2", repoDir, { id: "term-c2" });

    const r = await closeSession("term-c2");
    expect(r).toEqual({ cleanup: null });
    expect(existsSync(join(repoDir, "a.txt"))).toBe(true);
  });
});
