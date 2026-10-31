import { describe, it, expect, beforeEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_MARKER, bundledSkillNames, bundledSkillsDir, isBundledCopy, seedBundledSkills,
} from "../src/services/bundled-skills";

// ADR-0233 · skill bundel paket di-seed ke $HANOMAN_HOME/skills. Bundel & home tiruan di dir sementara.
let root = "";
let source = "";
let home = "";
const skillMd = (body: string) => `---\nname: demo\ndescription: demo skill\n---\n\n${body}\n`;
function bundle(body: string) {
  mkdirSync(join(source, "demo", "scripts"), { recursive: true });
  writeFileSync(join(source, "demo", "SKILL.md"), skillMd(body));
  writeFileSync(join(source, "demo", "scripts", "run.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
}
const dest = () => join(home, "skills", "demo");
const logs: string[] = [];
const seed = () => seedBundledSkills(home, { source, log: (m) => logs.push(m) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hanoman-bundled-"));
  source = join(root, "bundle");
  home = join(root, "home");
  mkdirSync(source, { recursive: true });
  logs.length = 0;
});

describe("seedBundledSkills (ADR-0233)", () => {
  it("menyalin skill yang belum ada beserta marker dan bit eksekusi skrip", () => {
    bundle("v1");
    expect(seed()).toEqual({ seeded: ["demo"], updated: [], kept: [] });
    expect(readFileSync(join(dest(), "SKILL.md"), "utf8")).toContain("v1");
    expect(statSync(join(dest(), "scripts", "run.sh")).mode & 0o111).not.toBe(0);
    expect(isBundledCopy(dest())).toBe(true);
    expect(JSON.parse(readFileSync(join(dest(), BUNDLED_MARKER), "utf8")).sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skrip di scripts/ tetap executable walau bit-nya hilang di bundel", () => {
    bundle("v1");
    writeFileSync(join(source, "demo", "scripts", "run.sh"), "#!/bin/sh\n", { mode: 0o644 });
    chmodSync(join(source, "demo", "scripts", "run.sh"), 0o644);
    seed();
    expect(statSync(join(dest(), "scripts", "run.sh")).mode & 0o111).not.toBe(0);
  });

  it("seed ulang tanpa perubahan tak menyentuh apa pun", () => {
    bundle("v1");
    seed();
    expect(seed()).toEqual({ seeded: [], updated: [], kept: [] });
  });

  it("memperbarui salinan yang belum diubah operator saat bundel berubah", () => {
    bundle("v1");
    seed();
    bundle("v2");
    expect(seed()).toEqual({ seeded: [], updated: ["demo"], kept: [] });
    expect(readFileSync(join(dest(), "SKILL.md"), "utf8")).toContain("v2");
    expect(isBundledCopy(dest())).toBe(true);
  });

  it("tak menimpa salinan yang sudah diubah operator", () => {
    bundle("v1");
    seed();
    writeFileSync(join(dest(), "SKILL.md"), skillMd("suntingan operator"));
    bundle("v2");
    expect(seed()).toEqual({ seeded: [], updated: [], kept: ["demo"] });
    expect(readFileSync(join(dest(), "SKILL.md"), "utf8")).toContain("suntingan operator");
    expect(logs.join("\n")).toContain("demo");
  });

  it("tak menimpa skill bernama sama tanpa marker (milik operator)", () => {
    bundle("v1");
    mkdirSync(dest(), { recursive: true });
    writeFileSync(join(dest(), "SKILL.md"), skillMd("buatan operator"));
    expect(seed()).toEqual({ seeded: [], updated: [], kept: ["demo"] });
    expect(readFileSync(join(dest(), "SKILL.md"), "utf8")).toContain("buatan operator");
    expect(isBundledCopy(dest())).toBe(false);
  });

  it("sumber bundel tak ada → hasil kosong tanpa melempar", () => {
    expect(seedBundledSkills(home, { source: join(root, "tak-ada") }))
      .toEqual({ seeded: [], updated: [], kept: [] });
    expect(existsSync(join(home, "skills"))).toBe(false);
  });
});

describe("bundel paket", () => {
  it("codex-image ada di bundel repo dan SKILL.md-nya tak menyebut ~/.claude/skills", () => {
    expect(bundledSkillNames()).toContain("codex-image");
    const md = readFileSync(join(bundledSkillsDir(), "codex-image", "SKILL.md"), "utf8");
    expect(md).not.toContain("~/.claude/skills");
    expect(md).toContain("${HANOMAN_HOME:-$HOME/.hanoman}/skills/codex-image/scripts/codex-image.sh");
    expect(md).toContain("Pick the engine first");
    expect(statSync(join(bundledSkillsDir(), "codex-image", "scripts", "codex-image.sh")).mode & 0o111).not.toBe(0);
  });
});
