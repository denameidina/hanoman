import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { enrichAnchors, readRepoContext } from "../src/mcp/repo-context";

let dir = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-repo-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  g("remote", "add", "origin", "git@github.com:acme/alpha.git");
  mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src/a.ts"), "1\n");
  g("add", "."); g("commit", "-qm", "1");
});

describe("readRepoContext", () => {
  it("dari subdirektori: root, remote, root commit, HEAD", async () => {
    const ctx = await readRepoContext(join(dir, "src"));
    const head = g("rev-parse", "HEAD");
    expect(ctx?.identity).toEqual({ remote: "git@github.com:acme/alpha.git", rootCommit: head, head });
  });
  it("bukan repo / tanpa origin → null", async () => {
    expect(await readRepoContext(mkdtempSync(join(tmpdir(), "plain-")))).toBeNull();
    const noOrigin = mkdtempSync(join(tmpdir(), "noorigin-"));
    execFileSync("git", ["-C", noOrigin, "init", "-q"]);
    expect(await readRepoContext(noOrigin)).toBeNull();
  });
});

describe("enrichAnchors", () => {
  it("mengisi blobSha dari HEAD dan MENIMPA nilai yang dikirim model", async () => {
    const ctx = (await readRepoContext(dir))!;
    const r = await enrichAnchors(ctx, { content: "x", anchors: [{ path: "src/a.ts", blobSha: "f".repeat(40) }] });
    expect(r).toEqual({ ok: true, body: { content: "x", anchors: [{ path: "src/a.ts", blobSha: g("rev-parse", "HEAD:src/a.ts") }] } });
  });
  it("path tak ada di HEAD → missing", async () => {
    const ctx = (await readRepoContext(dir))!;
    expect(await enrichAnchors(ctx, { anchors: [{ path: "src/none.ts" }] })).toEqual({ ok: false, missing: ["src/none.ts"] });
  });
  it("body tanpa anchors → apa adanya", async () => {
    const ctx = (await readRepoContext(dir))!;
    expect(await enrichAnchors(ctx, { reason: "r" })).toEqual({ ok: true, body: { reason: "r" } });
  });
});
