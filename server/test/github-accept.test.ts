import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { zCreateSpec } from "@hanoman/shared";
import { acceptGithubIssue } from "../src/services/github-accept";

const mkIssue = async (over: Partial<{ number: number; labels: string[]; title: string; body: string }> = {}) => {
  const number = over.number ?? 9;
  return prisma.githubIssue.create({
    data: {
      id: `acc-p:denameidina/hanoman#${number}`, projectId: "acc-p",
      repoSlug: "denameidina/hanoman", number,
      title: over.title ?? "History purge deletes transcript files before DB commit",
      body: over.body ?? "## Severity\nMajor\n\nLangkah reproduksi …",
      authorLogin: "wulanrlestari", labels: over.labels ?? [],
      url: `https://github.com/denameidina/hanoman/issues/${number}`,
      issueState: "open", status: "new", specId: null,
      issueCreatedAt: new Date("2026-07-30T11:57:43Z"),
      issueUpdatedAt: new Date("2026-07-30T11:57:43Z"),
      pulledAt: new Date("2026-08-01T00:00:00Z"),
    },
  });
};

const clean = async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeAll(clean);
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "acc-p", name: "P", desc: "", kind: "existing",
    gitRemote: "https://github.com/denameidina/hanoman" } });
});
afterAll(clean);

describe("SPEC-471 · acceptGithubIssue", () => {
  it("issue tanpa label → source qa, payload qa-shaped, backlink issue ada", async () => {
    const issue = await mkIssue();
    const { spec, created } = await acceptGithubIssue(issue, { author: "dena@x.co" });
    expect(created).toBe(true);
    expect(spec.source).toBe("qa");
    expect(spec.author).toBe("GitHub · dena@x.co");
    const p = spec.payload as { severity: string; actual: string; constraints: string };
    expect(p.severity).toBe("major");
    expect(p.constraints).toBe("");   // SPEC-826
    expect(p.actual).toContain("Langkah reproduksi");
    expect(p.actual).toContain("denameidina/hanoman#9");
    expect(p.actual).toContain("https://github.com/denameidina/hanoman/issues/9");
    expect(spec.objective).toContain("denameidina/hanoman#9");
  });

  it("label enhancement → source brief, payload brief-shaped", async () => {
    const issue = await mkIssue({ number: 5, labels: ["enhancement"] });
    const { spec } = await acceptGithubIssue(issue, { author: "dena@x.co" });
    expect(spec.source).toBe("brief");
    expect(spec.payload as Record<string, unknown>).toHaveProperty("context");
    expect(spec.payload as Record<string, unknown>).not.toHaveProperty("severity");
  });

  it("override source oleh operator menang atas label", async () => {
    const issue = await mkIssue({ number: 4, labels: ["bug"] });
    const { spec } = await acceptGithubIssue(issue, { author: "d@x.co", source: "brief" });
    expect(spec.source).toBe("brief");
    expect(spec.payload as Record<string, unknown>).toHaveProperty("context");
  });

  // Bentuk payload diikat ke source oleh zCreateSpec.superRefine (kelas jebakan SPEC-197).
  it("payload yang dihasilkan LOLOS zCreateSpec untuk source-nya", async () => {
    for (const [n, labels] of [[9, []], [8, ["enhancement"]], [7, ["question"]]] as const) {
      const issue = await mkIssue({ number: n, labels: [...labels] });
      const { spec } = await acceptGithubIssue(issue, { author: "d@x.co" });
      const parsed = zCreateSpec.safeParse({
        project: spec.projectId, source: spec.source, title: spec.title,
        priority: spec.priority, payload: spec.payload,
      });
      expect(parsed.success, `source ${spec.source} payload ditolak`).toBe(true);
    }
  });

  it("accept dua kali → SATU Spec, created:false di panggilan kedua", async () => {
    const issue = await mkIssue();
    const first = await acceptGithubIssue(issue, { author: "d@x.co" });
    const again = await prisma.githubIssue.findUnique({ where: { id: issue.id } });
    const second = await acceptGithubIssue(again!, { author: "d@x.co" });
    expect(second.created).toBe(false);
    expect(second.spec.id).toBe(first.spec.id);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("menandai issue accepted + menautkan specId dua arah", async () => {
    const issue = await mkIssue();
    const { spec } = await acceptGithubIssue(issue, { author: "d@x.co" });
    const row = await prisma.githubIssue.findUnique({ where: { id: issue.id } });
    expect(row?.status).toBe("accepted");
    expect(row?.specId).toBe(spec.id);
  });

  it("prioritas manual dipakai untuk source non-qa", async () => {
    const issue = await mkIssue({ number: 3, labels: ["enhancement"] });
    const { spec } = await acceptGithubIssue(issue, { author: "d@x.co", priority: "rendah" });
    expect(spec.priority).toBe("rendah");
  });
});
