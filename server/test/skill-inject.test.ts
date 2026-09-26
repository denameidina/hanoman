// server/test/skill-inject.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectGlobalSkills, unexcludeInjected, INJECT_MARKER } from "../src/services/skill-inject";

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
