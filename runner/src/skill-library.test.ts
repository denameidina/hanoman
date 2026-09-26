// runner/src/skill-library.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanGlobalSkills, scanProjectSkills, markShadowed, hanomanSkillsDir } from "./skill-library";

const skill = (dir: string, name: string, desc = "Use when x") => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`);
};

let root: string, home: string, osHome: string, repo: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skl-"));
  home = join(root, "hanoman"); osHome = join(root, "home"); repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
});
const opts = () => ({ hanomanHome: home, osHome, env: {} });

describe("scanGlobalSkills", () => {
  it("memindai lapis hanoman, user (.claude/.codex/.agents) dan plugin", () => {
    skill(join(hanomanSkillsDir(home), "shared-a"), "shared-a");
    skill(join(osHome, ".claude/skills/cl"), "cl");
    skill(join(osHome, ".codex/skills/cx"), "cx");
    skill(join(osHome, ".agents/skills/ag"), "ag");
    skill(join(osHome, ".claude/plugins/cache/mkt/pkg/1.0.0/skills/pl"), "pl");
    const all = scanGlobalSkills(opts());
    const by = (n: string) => all.find((s) => s.name === n)!;
    expect(by("shared-a")).toMatchObject({ layer: "hanoman", source: "hanoman", editable: true, loadedBy: ["claude", "codex"] });
    expect(by("cl")).toMatchObject({ layer: "user", source: ".claude", loadedBy: ["claude"], editable: true });
    expect(by("cx")).toMatchObject({ layer: "user", source: ".codex", loadedBy: ["codex"] });
    expect(by("ag")).toMatchObject({ layer: "user", source: ".agents", loadedBy: ["codex"] });
    expect(by("pl")).toMatchObject({ layer: "plugin", source: "plugin:pkg", editable: false, loadedBy: ["claude"] });
  });
  it("fail-open: akar hilang menyumbang nol, tak melempar", () => {
    expect(scanGlobalSkills(opts())).toEqual([]);
  });
  it("frontmatter rusak tetap muncul dengan frontmatterError", () => {
    mkdirSync(join(hanomanSkillsDir(home), "rusak"), { recursive: true });
    writeFileSync(join(hanomanSkillsDir(home), "rusak/SKILL.md"), "# tanpa frontmatter");
    const [s] = scanGlobalSkills(opts());
    expect(s).toMatchObject({ name: "rusak", description: null });
    expect(s!.frontmatterError).toMatch(/frontmatter/);
  });
});

describe("scanProjectSkills", () => {
  it("mengenali .claude/.agents/.codex/lainnya dan mengecualikan direktori berat", () => {
    skill(join(repo, ".claude/skills/a"), "a");
    skill(join(repo, ".agents/skills/b"), "b");
    skill(join(repo, ".codex/skills/c"), "c");
    skill(join(repo, "internal/skills/hanoman"), "hanoman");
    skill(join(repo, "node_modules/x/skills/nm"), "nm");
    skill(join(repo, ".worktrees/w/.claude/skills/wt"), "wt");
    const got = scanProjectSkills("p1", repo, opts());
    const by = (n: string) => got.find((s) => s.name === n);
    expect(by("a")).toMatchObject({ layer: "project", projectId: "p1", source: ".claude", loadedBy: ["claude"], editable: true });
    expect(by("b")).toMatchObject({ source: ".agents", loadedBy: ["codex"] });
    expect(by("c")).toMatchObject({ source: ".codex", loadedBy: ["codex"] });
    expect(by("hanoman")).toMatchObject({ source: "lainnya:internal/skills", loadedBy: [] });
    expect(by("nm")).toBeUndefined();
    expect(by("wt")).toBeUndefined();
  });
  it("tak menembus direktori skill (berkas pendukung bukan skill bersarang)", () => {
    skill(join(repo, ".claude/skills/a"), "a");
    skill(join(repo, ".claude/skills/a/examples/inner"), "inner");
    expect(scanProjectSkills("p1", repo, opts()).map((s) => s.name)).toEqual(["a"]);
  });
  it("mengabaikan symlink suntikan yang menunjuk ke $HANOMAN_HOME/skills", () => {
    skill(join(hanomanSkillsDir(home), "g"), "g");
    mkdirSync(join(repo, ".agents/skills"), { recursive: true });
    symlinkSync(join(hanomanSkillsDir(home), "g"), join(repo, ".agents/skills/g"));
    expect(scanProjectSkills("p1", repo, opts())).toEqual([]);
  });
  it("repo tak ada → array kosong", () => {
    expect(scanProjectSkills("p1", join(root, "nope"), opts())).toEqual([]);
  });
});

describe("markShadowed", () => {
  it("menandai skill hanoman yang ditimpa skill project bernama sama", () => {
    skill(join(hanomanSkillsDir(home), "dup"), "dup");
    skill(join(repo, ".claude/skills/dup"), "dup");
    const g = markShadowed(scanGlobalSkills(opts()), scanProjectSkills("p1", repo, opts()));
    expect(g[0]!.shadowedBy).toContain("project~p1~.claude~dup");
  });
});
