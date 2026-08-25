import { describe, expect, it } from "vitest";
import { IDE_TOOLS } from "./mcp-catalog/ide";

const by = (n: string) => IDE_TOOLS.find((t) => t.name === n)!;

describe("katalog ide", () => {
  it("27 tool", () => expect(IDE_TOOLS).toHaveLength(27));

  it("tujuh tool git menuntut ide:git dan SEMUANYA bermode danger", () => {
    const git = IDE_TOOLS.filter((t) => t.capability === "ide:git");
    expect(git.map((t) => t.name).sort()).toEqual([
      "hanoman_ide_branch_delete", "hanoman_ide_git_drop", "hanoman_ide_git_merge",
      "hanoman_ide_git_pull", "hanoman_ide_git_rebase", "hanoman_ide_git_run",
      "hanoman_ide_worktree_delete",
    ]);
    for (const t of git) expect(t.mode, t.name).toBe("danger");
  });

  it("membaca TIDAK menuntut ide:git", () => {
    for (const n of ["hanoman_ide_worktrees_list", "hanoman_ide_git_status", "hanoman_ide_tree"])
      expect(by(n).capability, n).toBe("ide:read");
  });

  // Diverifikasi terhadap kode: `branches` sengaja BUKAN anggota IDE_SUBS (SPEC-360), jadi seluruh
  // `branches/*` yang membaca tetap permukaan project. Hanya `branches/delete` yang pindah.
  it("membaca daftar branch adalah permukaan project, bukan ide", () => {
    expect(by("hanoman_ide_branches_unused").capability).toBe("projects:read");
    expect(by("hanoman_ide_branch_delete").capability).toBe("ide:git");
  });

  it("graph memilih /graph/search HANYA saat q diisi", () => {
    expect(by("hanoman_ide_graph").build({ project: "p" })?.path).toBe("/projects/p/graph");
    expect(by("hanoman_ide_graph").build({ project: "p", q: "fix" })?.path).toBe("/projects/p/graph/search");
    // Parameter milik cabang lain tak ikut menyeberang.
    expect(by("hanoman_ide_graph").build({ project: "p", q: "fix", limit: 50 })?.query)
      .toEqual({ q: "fix", by: "all" });
  });

  it("commit & compare memilih varian /file HANYA saat path diisi", () => {
    expect(by("hanoman_ide_commit").build({ project: "p", sha: "abc" })?.path).toBe("/projects/p/commit/abc");
    expect(by("hanoman_ide_commit").build({ project: "p", sha: "abc", path: "a.ts" })?.path)
      .toBe("/projects/p/commit/abc/file");
    expect(by("hanoman_ide_compare").build({ project: "p", from: "a", to: "b" })?.path)
      .toBe("/projects/p/compare");
    expect(by("hanoman_ide_compare").build({ project: "p", from: "a", to: "b", path: "x.ts" })?.path)
      .toBe("/projects/p/compare/file");
  });

  it("worktrees memilih /stats HANYA saat name diisi", () => {
    expect(by("hanoman_ide_worktrees_list").build({ project: "p" })?.path).toBe("/projects/p/worktrees");
    expect(by("hanoman_ide_worktrees_list").build({ project: "p", name: "w1" })?.path)
      .toBe("/projects/p/worktrees/stats");
  });

  it("staged dikirim sebagai string '1', bukan boolean yang diabaikan senyap", () => {
    expect(by("hanoman_ide_file_diff").build({ project: "p", path: "a.ts", staged: true })?.query)
      .toMatchObject({ staged: "1" });
    expect(by("hanoman_ide_file_diff").build({ project: "p", path: "a.ts", staged: false })?.query?.staged)
      .toBeUndefined();
  });

  it("branch_delete & worktree_delete menuntut names sebagai array", () => {
    expect(by("hanoman_ide_branch_delete").inputSchema.properties.names?.type).toBe("array");
    expect(by("hanoman_ide_branch_delete").inputSchema.required).toContain("names");
    expect(by("hanoman_ide_worktree_delete").inputSchema.required).toContain("names");
  });

  it("git_run mengikat tiap op ke field wajibnya lewat allOf", () => {
    const t = by("hanoman_ide_git_run");
    expect((t.inputSchema.allOf ?? []).length).toBeGreaterThan(10);
    expect(t.build({ project: "p", op: "checkout", ref: "main" })?.body)
      .toEqual({ op: "checkout", ref: "main" });
    // Field milik op lain tak ikut terkirim meski agen mengirimkannya.
    expect(t.build({ project: "p", op: "checkout", ref: "main", sha: "abc" })?.body)
      .toEqual({ op: "checkout", ref: "main" });
  });

  it("setiap tool danger membuka deskripsinya dengan penandaan", () => {
    for (const t of IDE_TOOLS.filter((x) => x.mode === "danger"))
      expect(t.description.slice(0, 12), t.name).toMatch(/BERBAHAYA/);
  });

  it("nol tool menyentuh upload atau archive — keduanya multipart/biner", () => {
    for (const t of IDE_TOOLS) expect(t.samplePath, t.name).not.toMatch(/upload|archive/);
  });
});
