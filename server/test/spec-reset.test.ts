import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSpecReset, applySpecReset } from "../src/services/spec-reset";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

// ADR-0149 · repo git SUNGGUHAN, bukan mock: yang diuji di sini justru interaksinya dengan git —
// worktree yang benar-benar lepas dan branch yang benar-benar hilang. Mock git hanya menguji mock,
// dan kelas bug yang mahal di sini (branch terkunci worktree, urutan operasi) cuma muncul di git.
function repoWithSpecWorktree(specId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-reset-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "docs/superpowers/plans"), { recursive: true });
  writeFileSync(join(dir, "docs/superpowers/plans", `${specId.toLowerCase()}-plan.md`), "# plan\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const sid = specId.toLowerCase();
  git("worktree", "add", "-q", "-b", `hanoman/${sid}`, join(dir, ".worktrees", sid));
  return dir;
}

const branchesOf = (repo: string) =>
  execFileSync("git", ["branch", "--format=%(refname:short)"], { cwd: repo, encoding: "utf8" });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "pr" });
});

describe("ADR-0149 · reset item saat type pindah lintas-alur", () => {
  it("planSpecReset melaporkan dokumen fase, worktree, dan branch — tanpa menghapus apa pun", async () => {
    const repo = repoWithSpecWorktree("SPEC-810");
    await prisma.project.update({ where: { id: "pr" }, data: { repoDir: repo } });
    await makeSpec({ id: "SPEC-810", projectId: "pr", stage: "executing", baseSha: "abc" });

    const plan = await planSpecReset({ id: "SPEC-810", projectId: "pr", stage: "executing" });
    expect(plan.wouldDelete).toContain("docs/superpowers/plans/spec-810-plan.md");
    expect(plan.worktree).toBe(join(repo, ".worktrees", "spec-810"));
    expect(plan.branch).toBe("hanoman/spec-810");
    // Dry-run: semuanya masih di tempatnya.
    expect(existsSync(join(repo, "docs/superpowers/plans/spec-810-plan.md"))).toBe(true);
    expect(existsSync(plan.worktree!)).toBe(true);
    expect(branchesOf(repo)).toContain("hanoman/spec-810");
  });

  it("applySpecReset membuang ketiganya", async () => {
    const repo = repoWithSpecWorktree("SPEC-811");
    await prisma.project.update({ where: { id: "pr" }, data: { repoDir: repo } });
    await makeSpec({ id: "SPEC-811", projectId: "pr", stage: "executing", baseSha: "abc" });

    const plan = await planSpecReset({ id: "SPEC-811", projectId: "pr", stage: "executing" });
    await applySpecReset({ id: "SPEC-811", projectId: "pr" }, plan);

    expect(existsSync(join(repo, "docs/superpowers/plans/spec-811-plan.md"))).toBe(false);
    expect(existsSync(join(repo, ".worktrees", "spec-811"))).toBe(false);
    expect(branchesOf(repo)).not.toContain("hanoman/spec-811");
  });

  it("item tanpa worktree & branch: rencana kosong, apply tak melempar", async () => {
    const repo = repoWithSpecWorktree("SPEC-812");
    await prisma.project.update({ where: { id: "pr" }, data: { repoDir: repo } });
    await makeSpec({ id: "SPEC-813", projectId: "pr", stage: "planned" });

    const plan = await planSpecReset({ id: "SPEC-813", projectId: "pr", stage: "planned" });
    expect(plan.worktree).toBeNull();
    expect(plan.branch).toBeNull();
    await expect(applySpecReset({ id: "SPEC-813", projectId: "pr" }, plan)).resolves.toBeUndefined();
    // Milik spec LAIN tak ikut terbawa — id yang mirip tak boleh saling menghapus.
    expect(existsSync(join(repo, ".worktrees", "spec-812"))).toBe(true);
  });

  it("project tanpa repoDir: rencana kosong, apply tak melempar", async () => {
    await makeProject({ id: "nodir", repoDir: null });
    await makeSpec({ id: "SPEC-814", projectId: "nodir", stage: "executing", baseSha: "x" });
    const plan = await planSpecReset({ id: "SPEC-814", projectId: "nodir", stage: "executing" });
    expect(plan).toEqual({ wouldDelete: [], worktree: null, branch: null });
    await expect(applySpecReset({ id: "SPEC-814", projectId: "nodir" }, plan)).resolves.toBeUndefined();
  });
});
