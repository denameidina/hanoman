import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { readRepoFile, writeRepoFileAtomic } from "../src/services/safe-repo-path";

const roots: string[] = [];
const fresh = () => { const p = mkdtempSync(join(tmpdir(), "hanoman-safe-path-")); roots.push(p); return p; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("safe repository path", () => {
  it.each(["file", "directory", "nested", "dangling"])("rejects %s symlink escapes for read and write", async (shape) => {
    const base = fresh(); const repo = join(base, "repo"); const outside = join(base, "outside");
    mkdirSync(repo); mkdirSync(outside); writeFileSync(join(outside, "sentinel.txt"), "sentinel");
    let rel = "link";
    if (shape === "file") symlinkSync(join(outside, "sentinel.txt"), join(repo, "link"));
    if (shape === "directory") { symlinkSync(outside, join(repo, "dir")); rel = "dir/sentinel.txt"; }
    if (shape === "nested") { mkdirSync(join(repo, "a")); symlinkSync(outside, join(repo, "a", "b")); rel = "a/b/sentinel.txt"; }
    if (shape === "dangling") symlinkSync(join(outside, "missing"), join(repo, "link"));
    await expect(readRepoFile(repo, rel)).rejects.toMatchObject({ code: "PATH_CONTAINMENT" });
    await expect(writeRepoFileAtomic(repo, rel, Buffer.from("owned"))).rejects.toMatchObject({ code: "PATH_CONTAINMENT" });
    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("sentinel");
  });

  it("reads regular files and writes a new regular file atomically with mode 0600", async () => {
    const repo = fresh(); mkdirSync(join(repo, "docs")); writeFileSync(join(repo, "docs", "a.md"), "a");
    expect((await readRepoFile(repo, "docs/a.md")).toString()).toBe("a");
    await writeRepoFileAtomic(repo, "docs/b.md", Buffer.from("b"));
    expect(readFileSync(join(repo, "docs", "b.md"), "utf8")).toBe("b");
    await writeRepoFileAtomic(repo, "new/nested/c.md", Buffer.from("c"));
    expect(readFileSync(join(repo, "new", "nested", "c.md"), "utf8")).toBe("c");
  });
});
