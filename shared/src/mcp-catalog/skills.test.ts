import { describe, it, expect } from "vitest";
import { SKILLS_TOOLS } from "./skills";

describe("SKILLS_TOOLS", () => {
  const t = (n: string) => SKILLS_TOOLS.find((x) => x.name === n)!;
  it("list: scope all tanpa project, projectId bila diisi", () => {
    expect(t("hanoman_skills_list").build({})).toMatchObject({ method: "GET", path: "/skills", query: { scope: "all" } });
    expect(t("hanoman_skills_list").build({ project: "p1" })!.query).toMatchObject({ projectId: "p1" });
    expect(t("hanoman_skills_list").capability).toBe("skills:read");
  });
  it("read tanpa path = tree; dengan path = file", () => {
    expect(t("hanoman_skill_read").build({ key: "hanoman~-~hanoman~a" })!.path).toBe("/skills/hanoman~-~hanoman~a/tree");
    expect(t("hanoman_skill_read").build({ key: "k", path: "SKILL.md" })).toMatchObject({ path: "/skills/k/file", query: { path: "SKILL.md" } });
  });
  it("write memakai PUT + baseHash, capability skills:write", () => {
    const w = t("hanoman_skill_write");
    expect(w.capability).toBe("skills:write");
    expect(w.build({ key: "k", path: "SKILL.md", content: "x", baseHash: "h" })).toMatchObject({ method: "PUT", path: "/skills/k/file", query: { path: "SKILL.md" }, body: { content: "x", baseHash: "h" } });
  });
});
