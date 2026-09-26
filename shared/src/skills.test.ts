// shared/src/skills.test.ts
import { describe, it, expect } from "vitest";
import { parseSkillFrontmatter, skillKey, parseSkillKey, SKILL_NAME_RE } from "./skills";

describe("parseSkillFrontmatter", () => {
  it("membaca name & description satu baris", () => {
    expect(parseSkillFrontmatter("---\nname: foo\ndescription: Use when x\n---\n# body"))
      .toEqual({ name: "foo", description: "Use when x" });
  });
  it("membaca nilai berkutip dan blok folded/literal", () => {
    const t = "---\nname: \"foo\"\ndescription: >\n  baris satu\n  baris dua\n---\n";
    expect(parseSkillFrontmatter(t)).toEqual({ name: "foo", description: "baris satu baris dua" });
    const l = "---\nname: 'bar'\ndescription: |\n  a\n  b\n---\n";
    expect(parseSkillFrontmatter(l)).toEqual({ name: "bar", description: "a\nb" });
  });
  it("melaporkan frontmatter hilang atau tak tertutup", () => {
    expect(parseSkillFrontmatter("# tanpa frontmatter").error).toMatch(/frontmatter/);
    expect(parseSkillFrontmatter("---\nname: x\n").error).toMatch(/tertutup/);
  });
  it("melaporkan field wajib yang hilang", () => {
    expect(parseSkillFrontmatter("---\nname: x\n---\n").error).toMatch(/description/);
  });
});

describe("skillKey", () => {
  it("bolak-balik, termasuk source ber-titik-dua dan slash", () => {
    const k = skillKey("project", "p1", "lainnya:internal/skills", "hanoman");
    expect(parseSkillKey(k)).toEqual({ layer: "project", projectId: "p1", source: "lainnya:internal/skills", name: "hanoman" });
    expect(parseSkillKey(skillKey("user", null, ".claude", "x"))).toEqual({ layer: "user", projectId: null, source: ".claude", name: "x" });
  });
  it("menolak key rusak", () => {
    expect(parseSkillKey("zzz")).toBeNull();
    expect(parseSkillKey("bogus~-~.claude~x")).toBeNull();
  });
});

describe("SKILL_NAME_RE", () => {
  it("menerima kebab-case, menolak yang lain", () => {
    expect(SKILL_NAME_RE.test("my-skill-2")).toBe(true);
    for (const bad of ["My", "-x", "a_b", "a/b", "", "x".repeat(65)]) expect(SKILL_NAME_RE.test(bad)).toBe(false);
  });
});
