import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { blobShaAt, hasCommit, repoHead, rootCommits } from "../src/services/memory/git";

let dir = ""; let first = ""; let second = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-git-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), "one\n"); g("add", "."); g("commit", "-qm", "1"); first = g("rev-parse", "HEAD");
  writeFileSync(join(dir, "src/a.ts"), "two\n"); g("commit", "-qam", "2"); second = g("rev-parse", "HEAD");
});

describe("git memori", () => {
  it("HEAD dan root commit", async () => {
    expect(await repoHead(dir)).toBe(second);
    expect(await rootCommits(dir)).toEqual([first]);
  });
  it("hasCommit: ada / tak ada / bukan sha", async () => {
    expect(await hasCommit(dir, first)).toBe(true);
    expect(await hasCommit(dir, "f".repeat(40))).toBe(false);
    expect(await hasCommit(dir, "HEAD; rm -rf /")).toBe(false);
  });
  it("blobShaAt mengikuti commit, bukan working tree", async () => {
    const a = await blobShaAt(dir, first, "src/a.ts");
    const b = await blobShaAt(dir, second, "src/a.ts");
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toBe(b);
    expect(b).toBe(g("rev-parse", `${second}:src/a.ts`));
  });
  it("path tak ada / direktori / path berbahaya → null", async () => {
    expect(await blobShaAt(dir, second, "src/none.ts")).toBeNull();
    expect(await blobShaAt(dir, second, "src")).toBeNull();
    expect(await blobShaAt(dir, second, "../etc/passwd")).toBeNull();
  });
  it("direktori bukan repo → null / []", async () => {
    const plain = mkdtempSync(join(tmpdir(), "mem-plain-"));
    expect(await repoHead(plain)).toBeNull();
    expect(await rootCommits(plain)).toEqual([]);
  });
});
