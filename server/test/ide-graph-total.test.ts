import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listGraph } from "../src/services/git-ide";

let dir = "";
const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "graph-total-"));
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(dir, `f${i}.txt`), String(i));
    git("add", "-A");
    git("commit", "-q", "-m", `c${i}`);
  }
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// SPEC-523 · graph SENGAJA tetap jendela tumbuh (SPEC-351), bukan halaman diskrit — lane butuh
// commit kontigu. Yang kurang selama ini adalah angkanya: "200 dimuat" tak menjawab sisa berapa.
describe("listGraph total (SPEC-523)", () => {
  it("menyatakan jumlah commit terjangkau meski jendelanya lebih kecil", async () => {
    const g = await listGraph(dir, 2);
    expect(g.commits.length).toBe(2);
    expect(g.total).toBe(5);
  });

  it("repo tak ada → total 0, bukan galat", async () => {
    const g = await listGraph(join(dir, "tak-ada"), 10);
    expect(g.commits).toEqual([]);
    expect(g.total).toBe(0);
  });
});
