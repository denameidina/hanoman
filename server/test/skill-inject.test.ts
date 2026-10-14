// server/test/skill-inject.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync, chmodSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupInjectedSkills, injectGlobalSkills, unexcludeInjected, INJECT_MARKER } from "../src/services/skill-inject";

const skill = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
};
let root: string, home: string, repo: string, tmp: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inj-"));
  home = join(root, "hanoman"); repo = join(root, "repo"); tmp = join(root, "tmp");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  skill(join(home, "skills/g1"), "g1");
  skill(join(home, "skills/dup"), "dup");
  skill(join(repo, ".claude/skills/dup"), "dup");
});

describe("claude", () => {
  it("membuat add-dir berisi symlink, melewati nama tertimpa, tak menyentuh worktree", () => {
    const r = injectGlobalSkills({ agent: "claude", cwd: repo, tempDir: tmp, hanomanHome: home });
    expect(r.addDir).toBe(join(tmp, "skills-root"));
    expect(readlinkSync(join(tmp, "skills-root/.claude/skills/g1"))).toBe(join(home, "skills/g1"));
    expect(existsSync(join(tmp, "skills-root/.claude/skills/dup"))).toBe(false);
    expect(r.injected).toEqual(["g1"]);
    expect(existsSync(join(repo, ".agents"))).toBe(false);
  });
  it("tanpa skill global → tak ada addDir", () => {
    const r = injectGlobalSkills({ agent: "claude", cwd: repo, tempDir: tmp, hanomanHome: join(root, "kosong") });
    expect(r.addDir).toBeUndefined();
  });
});

describe("codex", () => {
  it("symlink ke .agents/skills + exclude idempoten di common dir", () => {
    injectGlobalSkills({ agent: "codex", cwd: repo, tempDir: tmp, hanomanHome: home });
    injectGlobalSkills({ agent: "codex", cwd: repo, tempDir: tmp, hanomanHome: home });
    expect(lstatSync(join(repo, ".agents/skills/g1")).isSymbolicLink()).toBe(true);
    const ex = readFileSync(join(repo, ".git/info/exclude"), "utf8");
    expect(ex.match(/\/\.agents\/skills\/g1$/gm)).toHaveLength(1);
    expect(ex).toContain(INJECT_MARKER);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).not.toContain(".agents");
  });
  it("tak menimpa entri .agents/skills yang sudah ada", () => {
    skill(join(repo, ".agents/skills/g1"), "g1");
    const r = injectGlobalSkills({ agent: "codex", cwd: repo, tempDir: tmp, hanomanHome: home });
    expect(lstatSync(join(repo, ".agents/skills/g1")).isSymbolicLink()).toBe(false);
    expect(r.injected).not.toContain("g1");
  });
  it("bukan repo git → dilewati dengan peringatan, tak melempar", () => {
    const plain = join(root, "plain"); mkdirSync(plain);
    const r = injectGlobalSkills({ agent: "codex", cwd: plain, tempDir: tmp, hanomanHome: home });
    expect(r.injected).toEqual([]);
    expect(r.warnings[0]).toMatch(/git/);
  });
  it("unexcludeInjected mencabut baris nama itu saja", () => {
    injectGlobalSkills({ agent: "codex", cwd: repo, tempDir: tmp, hanomanHome: home });
    skill(join(home, "skills/g2"), "g2");
    injectGlobalSkills({ agent: "codex", cwd: repo, tempDir: tmp, hanomanHome: home });
    unexcludeInjected(repo, "g1");
    const ex = readFileSync(join(repo, ".git/info/exclude"), "utf8");
    expect(ex).not.toMatch(/\/\.agents\/skills\/g1$/m);
    expect(ex).toMatch(/\/\.agents\/skills\/g2$/m);
  });
});

describe("fail-open", () => {
  it("tempDir tak bisa ditulis → peringatan, tak melempar", () => {
    const ro = join(root, "ro"); mkdirSync(ro); chmodSync(ro, 0o500);
    const r = injectGlobalSkills({ agent: "claude", cwd: repo, tempDir: join(ro, "x"), hanomanHome: home });
    expect(r.addDir).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThan(0);
    chmodSync(ro, 0o700);
  });
});

describe("antigravity", () => {
  it("preserves instructions and project skills, excludes once, cleans only owned links", () => {
    writeFileSync(join(repo, "AGENTS.md"), "agents original"); writeFileSync(join(repo, "GEMINI.md"), "gemini original");
    skill(join(repo, ".agents/skills/local"), "local");
    const config = join(repo, ".agents/mcp_config.json"); writeFileSync(config, "operator MCP original");
    const original = readFileSync(join(repo, ".claude/skills/dup/SKILL.md"), "utf8");
    execFileSync("git", ["add", "AGENTS.md", "GEMINI.md", ".agents", ".claude"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "project originals"], { cwd: repo });
    const args = { agent: "antigravity" as const, cwd: repo, tempDir: tmp, hanomanHome: home };
    expect(injectGlobalSkills(args).injected).toEqual(["g1"]); injectGlobalSkills(args);
    expect(readlinkSync(join(repo, ".agents/skills/g1"))).toBe(join(home, "skills/g1"));
    const exclude = readFileSync(join(repo, ".git/info/exclude"), "utf8");
    expect(exclude.match(/^\/\.agents\/skills\/g1$/gm)).toHaveLength(1);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    cleanupInjectedSkills(tmp);
    expect(existsSync(join(repo, ".agents/skills/g1"))).toBe(false);
    expect(readFileSync(join(repo, ".git/info/exclude"), "utf8")).not.toContain("/.agents/skills/g1");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("agents original");
    expect(readFileSync(join(repo, "GEMINI.md"), "utf8")).toBe("gemini original");
    expect(readFileSync(config, "utf8")).toBe("operator MCP original");
    expect(readFileSync(join(repo, ".claude/skills/dup/SKILL.md"), "utf8")).toBe(original);
    expect(existsSync(join(repo, ".agents/skills/local/SKILL.md"))).toBe(true);
  });
  it("cleanup after manifest reread preserves operator-replaced links and exclude", () => {
    const args = { agent: "antigravity" as const, cwd: repo, tempDir: tmp, hanomanHome: home };
    injectGlobalSkills(args); unlinkSync(join(repo, ".agents/skills/g1"));
    skill(join(root, "operator"), "operator"); symlinkSync(join(root, "operator"), join(repo, ".agents/skills/g1"));
    cleanupInjectedSkills(tmp);
    expect(readlinkSync(join(repo, ".agents/skills/g1"))).toBe(join(root, "operator"));
    expect(readFileSync(join(repo, ".git/info/exclude"), "utf8")).toContain("/.agents/skills/g1");
  });
  it("never claims ownership of an existing operator exclude", () => {
    const f = join(repo, ".git/info/exclude"); writeFileSync(f, "# operator\n/.agents/skills/g1\n");
    injectGlobalSkills({ agent: "antigravity", cwd: repo, tempDir: tmp, hanomanHome: home }); cleanupInjectedSkills(tmp);
    expect(readFileSync(f, "utf8")).toBe("# operator\n/.agents/skills/g1\n");
  });
  it("preserves an operator replacement even when its target matches the owned link", () => {
    injectGlobalSkills({ agent: "antigravity", cwd: repo, tempDir: tmp, hanomanHome: home });
    const link = join(repo, ".agents/skills/g1");
    // Rename the old inode away so the replacement cannot reuse its identity.
    const old = join(root, "old-link");
    execFileSync("mv", [link, old]); symlinkSync(join(home, "skills/g1"), link);
    cleanupInjectedSkills(tmp);
    expect(readlinkSync(link)).toBe(join(home, "skills/g1"));
    expect(readFileSync(join(repo, ".git/info/exclude"), "utf8")).toContain("/.agents/skills/g1");
  });
  it("keeps the second worktree ignored after the first session cleans its common-dir exclude", () => {
    execFileSync("git", ["add", ".claude"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "project skill"], { cwd: repo });
    const first = join(root, "first"), second = join(root, "second");
    for (const path of [first, second]) execFileSync("git", ["worktree", "add", "--detach", path, "HEAD"], { cwd: repo, stdio: "ignore" });
    const exclude = join(repo, ".git/info/exclude"), original = "# operator keeps this\n/operator-kept\n";
    writeFileSync(exclude, original);
    const tempA = join(tmp, "first"), tempB = join(tmp, "second");
    try {
      injectGlobalSkills({ agent: "antigravity", cwd: first, tempDir: tempA, hanomanHome: home });
      injectGlobalSkills({ agent: "antigravity", cwd: second, tempDir: tempB, hanomanHome: home });
      cleanupInjectedSkills(tempA);
      expect(existsSync(join(first, ".agents/skills/g1"))).toBe(false);
      expect(readlinkSync(join(second, ".agents/skills/g1"))).toBe(join(home, "skills/g1"));
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: second, encoding: "utf8" })).toBe("");
      cleanupInjectedSkills(tempB);
      expect(existsSync(join(second, ".agents/skills/g1"))).toBe(false);
      expect(readFileSync(exclude, "utf8")).toBe(original);
    } finally {
      for (const path of [first, second]) execFileSync("git", ["worktree", "remove", "--force", path], { cwd: repo });
    }
  });
  it("non-repo and blocked .agents fail open with runtime warning", () => {
    writeFileSync(join(repo, ".agents"), "blocked");
    const result = injectGlobalSkills({ agent: "antigravity", cwd: repo, tempDir: tmp, hanomanHome: home });
    expect(result.injected).toEqual([]); expect(result.warnings.join(" ")).toContain("antigravity");
  });
});
