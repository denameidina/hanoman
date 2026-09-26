// runner/src/skill-files.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkillError, safeJoin, skillTree, readSkillFile, writeSkillFile, createSkillEntry, deleteSkillEntry,
  createSkillDir, copySkillDir, deleteSkillDir,
} from "./skill-files";

let root: string, dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skf-"));
  dir = join(root, "my-skill");
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: my-skill\ndescription: d\n---\n");
  writeFileSync(join(dir, "references/api.md"), "# api");
});
const status = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as SkillError).status; } return 0; };

describe("safeJoin", () => {
  it("menolak traversal, path absolut, dan symlink yang keluar", () => {
    expect(status(() => safeJoin(dir, "../x"))).toBe(400);
    expect(status(() => safeJoin(dir, "/etc/passwd"))).toBe(400);
    writeFileSync(join(root, "rahasia"), "s");
    symlinkSync(join(root, "rahasia"), join(dir, "bocor"));
    expect(status(() => safeJoin(dir, "bocor"))).toBe(400);
    expect(safeJoin(dir, "references/api.md")).toBe(join(dir, "references/api.md"));
  });
});

describe("skillTree & readSkillFile", () => {
  it("mengembalikan berkas + direktori relatif", () => {
    const t = skillTree(dir);
    expect(t.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "references/api.md"]);
    expect(t.dirs).toEqual(["references"]);
  });
  it("membaca isi + hash; biner & besar hanya metadata; hilang → 404", () => {
    const f = readSkillFile(dir, "SKILL.md");
    expect(f.content).toContain("name: my-skill");
    expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(dir, "img.png"), Buffer.from([0x89, 0x50, 0, 0, 1]));
    expect(readSkillFile(dir, "img.png")).toMatchObject({ binary: true, content: null });
    writeFileSync(join(dir, "big.md"), "x".repeat(1_048_577));
    expect(readSkillFile(dir, "big.md")).toMatchObject({ tooLarge: true, content: null });
    expect(status(() => readSkillFile(dir, "nope.md"))).toBe(404);
  });
});

describe("writeSkillFile", () => {
  it("menulis dengan baseHash cocok, 409 bila berubah", () => {
    const { hash } = readSkillFile(dir, "references/api.md");
    const r = writeSkillFile(dir, "references/api.md", "# baru", hash);
    expect(readFileSync(join(dir, "references/api.md"), "utf8")).toBe("# baru");
    expect(status(() => writeSkillFile(dir, "references/api.md", "# lagi", hash))).toBe(409);
    expect(writeSkillFile(dir, "references/api.md", "# lagi", r.hash).hash).not.toBe(r.hash);
  });
  it("baseHash null = berkas baru; 409 bila sudah ada", () => {
    writeSkillFile(dir, "scripts/run.sh", "echo", null);
    expect(existsSync(join(dir, "scripts/run.sh"))).toBe(true);
    expect(status(() => writeSkillFile(dir, "scripts/run.sh", "x", null))).toBe(409);
  });
});

describe("entry & skill lifecycle", () => {
  it("membuat/menghapus entri; SKILL.md tak boleh dihapus", () => {
    createSkillEntry(dir, "assets", "dir");
    createSkillEntry(dir, "assets/a.txt", "file");
    expect(existsSync(join(dir, "assets/a.txt"))).toBe(true);
    expect(status(() => createSkillEntry(dir, "assets/a.txt", "file"))).toBe(409);
    deleteSkillEntry(dir, "assets");
    expect(existsSync(join(dir, "assets"))).toBe(false);
    expect(status(() => deleteSkillEntry(dir, "SKILL.md"))).toBe(400);
  });
  it("createSkillDir menulis kerangka, 409 bila nama terpakai, 400 bila nama tak sah", () => {
    const d = createSkillDir(root, "baru", "Use when y");
    expect(readFileSync(join(d, "SKILL.md"), "utf8")).toMatch(/^---\nname: baru\ndescription: Use when y\n---/);
    expect(status(() => createSkillDir(root, "baru", "z"))).toBe(409);
    expect(status(() => createSkillDir(root, "Bad Name", "z"))).toBe(400);
  });
  it("copySkillDir menyalin rekursif dan menulis ulang name di frontmatter", () => {
    const d = copySkillDir(dir, join(root, "dest"), "salinan");
    expect(readFileSync(join(d, "references/api.md"), "utf8")).toBe("# api");
    expect(readFileSync(join(d, "SKILL.md"), "utf8")).toContain("name: salinan");
  });
  it("deleteSkillDir menghapus folder", () => {
    deleteSkillDir(dir);
    expect(existsSync(dir)).toBe(false);
  });
});
