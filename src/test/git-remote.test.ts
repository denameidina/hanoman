// SPEC-867 · turunan murni dari URL remote & bentuk galat endpoint clone. Diuji langsung
// (tanpa render) karena tiga call site-nya — modal Project baru, kartu tanpa-dir, dan toast
// kegagalan — harus sepakat soal nilai yang sama.
import { describe, it, expect } from "vitest";
import { repoBasename, cloneTargetInto, cloneErrorText } from "../src/screens/git-remote";

describe("git-remote (SPEC-867)", () => {
  it("repoBasename menurunkan nama repo dari https maupun ssh", () => {
    expect(repoBasename("https://github.com/org/repo.git")).toBe("repo");
    expect(repoBasename("git@github.com:org/repo.git")).toBe("repo");
    expect(repoBasename("https://gitlab.com/grup/sub/proyek")).toBe("proyek");
    expect(repoBasename("  ")).toBe("repo");
  });

  it("cloneTargetInto memperlakukan folder pilihan sebagai INDUK", () => {
    expect(cloneTargetInto("/home/dena/code", "https://github.com/org/repo.git"))
      .toBe("/home/dena/code/repo");
    expect(cloneTargetInto("/home/dena/code/", "git@github.com:org/arta.git"))
      .toBe("/home/dena/code/arta");
  });

  it("cloneErrorText mengangkat stderr endpoint, bukan 'POST … → 409'", () => {
    const e = Object.assign(new Error("POST /api/projects/x/clone → 409"),
      { detail: { error: "git clone gagal", detail: "fatal: repository not found\n" } });
    expect(cloneErrorText(e)).toEqual({ error: "git clone gagal", stderr: "fatal: repository not found" });
  });

  it("cloneErrorText tetap memberi kalimat saat galat bukan dari endpoint", () => {
    expect(cloneErrorText(new Error("boom"))).toEqual({ error: "boom", stderr: "" });
    expect(cloneErrorText(null)).toEqual({ error: "clone gagal", stderr: "" });
  });
});
