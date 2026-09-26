# Skills Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman dapat melihat, menelusuri struktur, dan menyunting skill dari semua sumber (global hanoman, user, plugin, project) dalam satu halaman `/skills`, dan menyuntikkan skill global hanoman ke setiap sesi agen.

**Architecture:** Skill tetap folder di disk (tanpa Prisma). `runner` memindai & mengoperasikan berkas skill (node-only), `shared` memegang tipe + parser frontmatter (browser-safe), server mengekspos REST `/api/skills*` + tool MCP, `pty.ts` menyuntik skill global hanoman per sesi (claude lewat `--add-dir`, codex lewat symlink + exclude). Frontend `SkillsWorkspace` satu komponen untuk `/skills` dan `/skills/<projectId>`.

**Tech Stack:** TypeScript strict, Fastify, Vitest, React + Vite, komponen `src/src/ds`.

Desain: `docs/superpowers/specs/2026-09-26-skills-library-design.md`.

## Global Constraints

- Tanpa migration / model Prisma baru.
- Nama skill: `^[a-z0-9][a-z0-9-]{0,63}$`.
- Berkas > 1 MB atau biner → hanya metadata, tak dikirim isinya.
- Project scan: kedalaman maks 6; kecualikan `node_modules`, `.git`, `.worktrees`, `dist`, `build`, `.next`, `coverage`; tak menembus direktori yang sudah memuat `SKILL.md`; abaikan symlink yang menunjuk ke `$HANOMAN_HOME/skills`.
- Sumber project: `.claude/skills/*` → `loadedBy ["claude"]`; `.agents/skills/*` dan `.codex/skills/*` → `["codex"]`; selain itu `lainnya:<rel>` → `[]`.
- Plugin baca-saja (403 untuk tulis/hapus).
- Fail-open per akar pemindaian dan pada penyuntikan.
- Capability baru `skills:read` / `skills:write`, dipetakan MENURUT METHOD.
- Pemakai skill project menulis ke checkout utama project (`resolveRepoDir`).
- Test server: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run <path> --no-file-parallelism`.
- Setiap task: centang checkbox di plan ini, jalankan test yang tersentuh, commit dengan `git add <path eksplisit>` (JANGAN `-A`, JANGAN `git stash`).
- Kerjakan di worktree terpisah (bukan checkout utama); sesudah membuat worktree: `pnpm install && pnpm --filter @hanoman/server exec prisma generate`.

---

### Task 1: Tipe & parser frontmatter di `shared`

**Files:**
- Create: `shared/src/skills.ts`
- Create: `shared/src/skills.test.ts`
- Modify: `shared/src/index.ts` (tambah `export * from "./skills";`)

**Interfaces:**
- Produces:
  - `type SkillLayer = "hanoman" | "user" | "plugin" | "project"`
  - `type SkillRuntime = "claude" | "codex"`
  - `interface SkillEntry { key; name; description: string|null; layer; source; projectId: string|null; dir; loadedBy: SkillRuntime[]; editable: boolean; shadowedBy?: string; frontmatterError?: string }`
  - `interface SkillProjectGroup { projectId: string; name: string; skills: SkillEntry[]; error?: string }`
  - `interface SkillLibraryView { global: SkillEntry[]; projects: SkillProjectGroup[] }`
  - `interface SkillTreeView { files: { path: string; size: number }[]; dirs: string[] }`
  - `interface SkillFileView { path: string; size: number; hash: string | null; content: string | null; binary: boolean; tooLarge: boolean }`
  - `const SKILL_NAME_RE: RegExp`, `const SKILL_FILE_MAX_BYTES = 1_048_576`
  - `function skillKey(layer, projectId: string|null, source: string, name: string): string`
  - `function parseSkillKey(key: string): { layer: SkillLayer; projectId: string|null; source: string; name: string } | null`
  - `function parseSkillFrontmatter(text: string): { name?: string; description?: string; error?: string }`

- [x] **Step 1: Tulis test yang gagal**

```ts
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
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/skills.test.ts`
Expected: FAIL — `Cannot find module './skills'`.

- [x] **Step 3: Implementasi**

```ts
// shared/src/skills.ts
// Skills library (desain 2026-09-26). Tipe + parser MURNI — ikut dibundel ke browser, jadi tanpa node:*.

export const SKILL_LAYERS = ["hanoman", "user", "plugin", "project"] as const;
export type SkillLayer = (typeof SKILL_LAYERS)[number];
export type SkillRuntime = "claude" | "codex";

export interface SkillEntry {
  key: string;
  name: string;
  description: string | null;
  layer: SkillLayer;
  /** ".claude" | ".agents" | ".codex" | "plugin:<pkg>" | "lainnya:<rel>" | "hanoman" */
  source: string;
  projectId: string | null;
  dir: string;
  loadedBy: SkillRuntime[];
  editable: boolean;
  shadowedBy?: string;
  frontmatterError?: string;
}
export interface SkillProjectGroup { projectId: string; name: string; skills: SkillEntry[]; error?: string }
export interface SkillLibraryView { global: SkillEntry[]; projects: SkillProjectGroup[] }
export interface SkillTreeView { files: { path: string; size: number }[]; dirs: string[] }
export interface SkillFileView {
  path: string; size: number; hash: string | null; content: string | null; binary: boolean; tooLarge: boolean;
}

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SKILL_FILE_MAX_BYTES = 1_048_576;

// Pemisah `~` : tak pernah muncul di nama skill (SKILL_NAME_RE) maupun id project (cuid), dan
// source boleh memuat `:`/`/` (plugin:pkg, lainnya:internal/skills). Source dipasang TERAKHIR
// sebelum nama supaya split dari kiri/kanan tetap tunggal-makna.
const SEP = "~";
export function skillKey(layer: SkillLayer, projectId: string | null, source: string, name: string): string {
  return [layer, projectId ?? "-", source, name].join(SEP);
}
export function parseSkillKey(key: string): { layer: SkillLayer; projectId: string | null; source: string; name: string } | null {
  const first = key.indexOf(SEP);
  const second = first < 0 ? -1 : key.indexOf(SEP, first + 1);
  const last = key.lastIndexOf(SEP);
  if (first < 0 || second < 0 || last <= second) return null;
  const layer = key.slice(0, first);
  if (!(SKILL_LAYERS as readonly string[]).includes(layer)) return null;
  const pid = key.slice(first + 1, second);
  return { layer: layer as SkillLayer, projectId: pid === "-" ? null : pid, source: key.slice(second + 1, last), name: key.slice(last + 1) };
}

const unquote = (v: string): string => {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  return t;
};

/**
 * Parser frontmatter MINIMAL: hanya `name` & `description` top-level, nilai satu baris / berkutip /
 * blok `>` (folded) / `|` (literal). Menyeret parser YAML penuh ke bundel browser demi dua field
 * tak sepadan; field lain diabaikan, bukan galat.
 */
export function parseSkillFrontmatter(text: string): { name?: string; description?: string; error?: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { error: "SKILL.md tanpa frontmatter (--- di baris pertama)" };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { error: "frontmatter tak tertutup (--- penutup hilang)" };
  const out: { name?: string; description?: string } = {};
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const [, k, raw] = m as unknown as [string, string, string];
    if (k !== "name" && k !== "description") continue;
    let value: string;
    if (raw.trim() === ">" || raw.trim() === "|" || raw.trim() === ">-" || raw.trim() === "|-") {
      const block: string[] = [];
      while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1]!.trim() === "")) block.push(lines[++i]!.trim());
      value = raw.trim().startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n").trim();
    } else value = unquote(raw);
    out[k] = value;
  }
  if (!out.name) return { ...out, error: "frontmatter tanpa name" };
  if (!out.description) return { ...out, error: "frontmatter tanpa description" };
  return out;
}
```

Tambah ke `shared/src/index.ts`: `export * from "./skills";`

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run shared/src/skills.test.ts`
Expected: PASS (semua).

- [x] **Step 5: Commit**

```bash
git add shared/src/skills.ts shared/src/skills.test.ts shared/src/index.ts docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): tipe SkillEntry + parser frontmatter di shared"
```

---

### Task 2: Pemindai skill library di `runner`

**Files:**
- Create: `runner/src/skill-library.ts`
- Create: `runner/src/skill-library.test.ts`
- Modify: `runner/src/skills.ts` (ekspor `skillsUnder`: ganti `function skillsUnder(` → `export function skillsUnder(`)
- Modify: `runner/src/index.ts` (tambah `export * from "./skill-library";`)

**Interfaces:**
- Consumes: `SkillEntry`, `skillKey`, `parseSkillFrontmatter` (Task 1); `agentSkillHome`, `agentsSkillHome`, `scanAgentSkills`, `skillsUnder`, `EnvLike` dari runner.
- Produces:
  - `interface SkillScanOpts { hanomanHome: string; env?: EnvLike; osHome?: string }`
  - `function hanomanSkillsDir(hanomanHome: string): string` → `join(hanomanHome, "skills")`
  - `function scanGlobalSkills(o: SkillScanOpts): SkillEntry[]`
  - `function scanProjectSkills(projectId: string, repoDir: string, o: SkillScanOpts): SkillEntry[]`
  - `function markShadowed(global: SkillEntry[], project: SkillEntry[]): SkillEntry[]` (salinan global; entri `hanoman` yang namanya ada di project diberi `shadowedBy` = key project)

- [x] **Step 1: Tulis test yang gagal**

```ts
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
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run runner/src/skill-library.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implementasi**

```ts
// runner/src/skill-library.ts
// Skills library (desain 2026-09-26) — pemindaian TIGA lapis untuk ditampilkan & disunting.
// Berbeda dari `skills.ts` (ADR-0114, pencocokan prasyarat metode): di sini tiap skill adalah
// entri yang bisa dibuka, dengan asal-usul & runtime pemuatnya. Fail-open per akar.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { parseSkillFrontmatter, skillKey, type SkillEntry, type SkillLayer, type SkillRuntime } from "@hanoman/shared";
import { agentSkillHome, agentsSkillHome, scanAgentSkills, skillsUnder } from "./skills";
import type { EnvLike } from "./paths";

export interface SkillScanOpts { hanomanHome: string; env?: EnvLike; osHome?: string }

export const hanomanSkillsDir = (hanomanHome: string): string => join(hanomanHome, "skills");

const PROJECT_EXCLUDES = new Set(["node_modules", ".git", ".worktrees", "dist", "build", ".next", "coverage"]);
const PROJECT_MAX_DEPTH = 6;

function entry(dir: string, layer: SkillLayer, source: string, projectId: string | null,
  loadedBy: SkillRuntime[], editable: boolean): SkillEntry {
  let fm: ReturnType<typeof parseSkillFrontmatter>;
  try { fm = parseSkillFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8")); }
  catch { fm = { error: "SKILL.md tak terbaca" }; }
  const name = basename(dir);
  const e: SkillEntry = {
    key: skillKey(layer, projectId, source, name),
    name, description: fm.description ?? null, layer, source, projectId, dir, loadedBy, editable,
  };
  if (fm.error) e.frontmatterError = fm.error;
  return e;
}

export function scanGlobalSkills(o: SkillScanOpts): SkillEntry[] {
  const env = o.env ?? process.env;
  const osHome = o.osHome ?? homedir();
  const out: SkillEntry[] = [];
  const seen = new Set<string>();
  const push = (e: SkillEntry) => { if (!seen.has(e.key)) { seen.add(e.key); out.push(e); } };

  for (const s of skillsUnder(hanomanSkillsDir(o.hanomanHome), null, 1))
    push(entry(s.dir, "hanoman", "hanoman", null, ["claude", "codex"], true));

  const claudeHome = agentSkillHome("claude", env, osHome);
  const codexHome = agentSkillHome("codex", env, osHome);
  const agentsHome = agentsSkillHome(env, osHome);
  for (const [dir, source, rt] of [
    [join(claudeHome, "skills"), ".claude", "claude"],
    [join(codexHome, "skills"), ".codex", "codex"],
    [join(agentsHome, "skills"), ".agents", "codex"],
  ] as const) for (const s of skillsUnder(dir, null)) push(entry(s.dir, "user", source, null, [rt], true));

  for (const agent of ["claude", "codex"] as const) {
    let found: ReturnType<typeof scanAgentSkills>["skills"] = [];
    try { found = scanAgentSkills(agent, env, osHome).skills; } catch { found = []; }
    for (const s of found) {
      // Hanya skill berpaket yang BUKAN dari ~/.agents (alamat ganda lock) — sisanya lapis user.
      if (!s.pkg || s.dir.startsWith(agentsHome + sep)) continue;
      push(entry(s.dir, "plugin", `plugin:${s.pkg}`, null, [agent], false));
    }
  }
  return out;
}

function projectSource(rel: string): { source: string; loadedBy: SkillRuntime[] } {
  const parts = rel.split(sep);
  const root = parts.slice(0, 2).join("/");
  if (parts.length === 3 && root === ".claude/skills") return { source: ".claude", loadedBy: ["claude"] };
  if (parts.length === 3 && root === ".agents/skills") return { source: ".agents", loadedBy: ["codex"] };
  if (parts.length === 3 && root === ".codex/skills") return { source: ".codex", loadedBy: ["codex"] };
  return { source: `lainnya:${parts.slice(0, -1).join("/")}`, loadedBy: [] };
}

export function scanProjectSkills(projectId: string, repoDir: string, o: SkillScanOpts): SkillEntry[] {
  if (!existsSync(repoDir)) return [];
  let injectRoot = hanomanSkillsDir(o.hanomanHome);
  try { injectRoot = realpathSync(injectRoot); } catch { /* belum ada: tak ada suntikan */ }
  const out: SkillEntry[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (PROJECT_EXCLUDES.has(name)) continue;
      const full = join(dir, name);
      let st;
      try { st = lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) {
        let real: string;
        try { real = realpathSync(full); } catch { continue; }
        if (real === injectRoot || real.startsWith(injectRoot + sep)) continue;   // suntikan hanoman
        try { st = lstatSync(real); } catch { continue; }
      }
      if (!st.isDirectory()) continue;
      if (existsSync(join(full, "SKILL.md"))) {
        const { source, loadedBy } = projectSource(relative(repoDir, full));
        out.push(entry(full, "project", source, projectId, loadedBy, true));
        continue;   // berkas pendukung skill bukan skill bersarang
      }
      if (depth < PROJECT_MAX_DEPTH) walk(full, depth + 1);
    }
  };
  walk(repoDir, 1);
  return out.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
}

export function markShadowed(global: SkillEntry[], project: SkillEntry[]): SkillEntry[] {
  const byName = new Map(project.map((p) => [p.name, p.key]));
  return global.map((g) => g.layer === "hanoman" && byName.has(g.name) ? { ...g, shadowedBy: byName.get(g.name)! } : g);
}
```

Catatan: `skillsUnder(dir, pkg, depth = 2)` sudah ada di `runner/src/skills.ts:88`; ubah hanya kata kunci `export`.

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run runner/src/skill-library.test.ts runner/src/skills.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add runner/src/skill-library.ts runner/src/skill-library.test.ts runner/src/skills.ts runner/src/index.ts docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): pemindai tiga lapis skill library di runner"
```

---

### Task 3: Operasi berkas skill (aman-path) di `runner`

**Files:**
- Create: `runner/src/skill-files.ts`
- Create: `runner/src/skill-files.test.ts`
- Modify: `runner/src/index.ts` (tambah `export * from "./skill-files";`)

**Interfaces:**
- Consumes: `SKILL_FILE_MAX_BYTES`, `SkillTreeView`, `SkillFileView` (Task 1).
- Produces:
  - `class SkillError extends Error { status: 400 | 403 | 404 | 409 }`
  - `function safeJoin(dir: string, rel: string): string`
  - `function skillTree(dir: string): SkillTreeView`
  - `function readSkillFile(dir: string, rel: string): SkillFileView`
  - `function writeSkillFile(dir: string, rel: string, content: string, baseHash: string | null): { hash: string }`
  - `function createSkillEntry(dir: string, rel: string, kind: "file" | "dir"): void`
  - `function deleteSkillEntry(dir: string, rel: string): void`
  - `function createSkillDir(parent: string, name: string, description: string): string` (kembalikan dir baru)
  - `function copySkillDir(src: string, parent: string, name: string): string`
  - `function deleteSkillDir(dir: string): void`

- [x] **Step 1: Tulis test yang gagal**

```ts
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
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run runner/src/skill-files.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implementasi**

```ts
// runner/src/skill-files.ts
// Skills library · operasi berkas di DALAM satu direktori skill. Setiap path relatif di-resolve
// lewat `safeJoin` (realpath) — pola route IDE: tak ada `..`, path absolut, atau symlink yang
// keluar dari direktori skill.
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { SKILL_FILE_MAX_BYTES, SKILL_NAME_RE, type SkillFileView, type SkillTreeView } from "@hanoman/shared";

export class SkillError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) { super(message); }
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export function safeJoin(dir: string, rel: string): string {
  if (!rel || isAbsolute(rel)) throw new SkillError(400, "path harus relatif terhadap skill");
  const norm = normalize(rel);
  if (norm === ".." || norm.startsWith(".." + sep)) throw new SkillError(400, "path keluar dari skill");
  const full = join(dir, norm);
  // Cek realpath dari entri terdalam yang SUDAH ada — berkas baru belum punya realpath.
  let probe = full;
  while (!existsSync(probe) && probe !== dir) probe = dirname(probe);
  const realDir = realpathSync(dir);
  const realProbe = realpathSync(probe);
  if (realProbe !== realDir && !realProbe.startsWith(realDir + sep)) throw new SkillError(400, "path keluar dari skill (symlink)");
  return full;
}

export function skillTree(dir: string): SkillTreeView {
  const files: SkillTreeView["files"] = [];
  const dirs: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === ".git" || name === ".DS_Store") continue;
      const full = join(d, name);
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      const rel = relative(dir, full).split(sep).join("/");
      if (st.isDirectory()) { dirs.push(rel); walk(full); }
      else files.push({ path: rel, size: st.size });
    }
  };
  if (!existsSync(dir)) throw new SkillError(404, "skill tidak ditemukan");
  walk(dir);
  return { files, dirs };
}

export function readSkillFile(dir: string, rel: string): SkillFileView {
  const full = safeJoin(dir, rel);
  const st = statSync(full, { throwIfNoEntry: false });
  if (!st || !st.isFile()) throw new SkillError(404, "berkas tidak ditemukan");
  if (st.size > SKILL_FILE_MAX_BYTES) return { path: rel, size: st.size, hash: null, content: null, binary: false, tooLarge: true };
  const buf = readFileSync(full);
  const binary = buf.subarray(0, 8000).includes(0);
  return { path: rel, size: st.size, hash: sha(buf), content: binary ? null : buf.toString("utf8"), binary, tooLarge: false };
}

export function writeSkillFile(dir: string, rel: string, content: string, baseHash: string | null): { hash: string } {
  const full = safeJoin(dir, rel);
  const exists = existsSync(full);
  if (baseHash === null && exists) throw new SkillError(409, "berkas sudah ada");
  if (baseHash !== null) {
    if (!exists) throw new SkillError(409, "berkas sudah dihapus di tempat lain");
    if (sha(readFileSync(full)) !== baseHash) throw new SkillError(409, "berkas berubah di tempat lain");
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return { hash: sha(content) };
}

export function createSkillEntry(dir: string, rel: string, kind: "file" | "dir"): void {
  const full = safeJoin(dir, rel);
  if (existsSync(full)) throw new SkillError(409, "entri sudah ada");
  if (kind === "dir") mkdirSync(full, { recursive: true });
  else { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, ""); }
}

export function deleteSkillEntry(dir: string, rel: string): void {
  const full = safeJoin(dir, rel);
  if (normalize(rel) === "SKILL.md") throw new SkillError(400, "SKILL.md tak boleh dihapus — hapus skill-nya");
  if (!existsSync(full) && !lstatSync(full, { throwIfNoEntry: false })) throw new SkillError(404, "entri tidak ditemukan");
  rmSync(full, { recursive: true, force: true });
}

const skeleton = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n# ${name}\n\n`;

export function createSkillDir(parent: string, name: string, description: string): string {
  if (!SKILL_NAME_RE.test(name)) throw new SkillError(400, "nama skill harus kebab-case (a-z, 0-9, -), maks 64");
  const dir = join(parent, name);
  if (existsSync(dir)) throw new SkillError(409, "nama skill sudah dipakai di tujuan");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skeleton(name, description));
  return dir;
}

export function copySkillDir(src: string, parent: string, name: string): string {
  if (!SKILL_NAME_RE.test(name)) throw new SkillError(400, "nama skill harus kebab-case (a-z, 0-9, -), maks 64");
  if (!existsSync(join(src, "SKILL.md"))) throw new SkillError(404, "skill sumber tidak ditemukan");
  const dir = join(parent, name);
  if (existsSync(dir)) throw new SkillError(409, "nama skill sudah dipakai di tujuan");
  mkdirSync(parent, { recursive: true });
  cpSync(src, dir, { recursive: true, dereference: true });
  const md = join(dir, "SKILL.md");
  writeFileSync(md, readFileSync(md, "utf8").replace(/^(---\n(?:.*\n)*?)name:.*$/m, `$1name: ${name}`));
  return dir;
}

export function deleteSkillDir(dir: string): void {
  if (!existsSync(join(dir, "SKILL.md"))) throw new SkillError(404, "skill tidak ditemukan");
  rmSync(dir, { recursive: true, force: true });
}
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run runner/src/skill-files.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add runner/src/skill-files.ts runner/src/skill-files.test.ts runner/src/index.ts docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): operasi berkas skill aman-path (tree/read/write/create/fork/delete)"
```

---

### Task 4: Route `/api/skills*` + capability `skills:*`

**Files:**
- Create: `server/src/services/skill-library.ts`
- Create: `server/src/routes/skills.ts`
- Create: `server/test/skills.route.test.ts`
- Modify: `server/src/app.ts` (import + `await api.register(skills);` sesudah `api.register(customAgents)` — cari baris register customAgents)
- Modify: `server/src/services/agent-capabilities.ts` (sesudah blok `custom-agents` ±baris 77)
- Modify: `shared/src/agent.ts` (daftar capability ±baris 23, `CAPABILITIES` ±baris 71, `CAPABILITY_DOMAINS` ±baris 99)
- Modify: `shared/src/api.ts` (tambah path di objek paths dekat `customAgents` ±baris 217)

**Interfaces:**
- Consumes: Task 1–3; `resolveRepoDir(projectId)` dari `server/src/services/local-binding.ts`; `resolveHome()` dari `@hanoman/runner`; `prisma.project`.
- Produces (paths di `shared/src/api.ts`):
  - `skills: \`${API}/skills\``
  - `skill: (key: string) => \`${API}/skills/${encodeURIComponent(key)}\``
  - `skillTree`, `skillFile`, `skillEntry`, `skillFork`: `(key) => \`${API}/skills/${encodeURIComponent(key)}/tree|file|entry|fork\``
- Produces (service):
  - `function skillsHome(): string` (= `resolveHome(process.env)`)
  - `async function libraryAll(): Promise<SkillLibraryView>`
  - `async function libraryForProject(projectId: string): Promise<SkillEntry[]>` (global ber-`shadowedBy` + project)
  - `async function resolveSkill(key: string): Promise<SkillEntry>` (melempar `SkillError(404)`)
  - `async function targetParent(layer: "hanoman"|"user"|"project", source: string|undefined, projectId: string|undefined): Promise<string>`
  - (Pencabutan exclude suntikan codex saat membuat skill project disambungkan di Task 5 Step 5, bukan di sini.)

- [x] **Step 1: Tulis test yang gagal**

```ts
// server/test/skills.route.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const root = mkdtempSync(join(tmpdir(), "skr-"));
const home = join(root, "hanoman"), osHome = join(root, "home"), repo = join(root, "repo");
process.env.HANOMAN_HOME = home;
process.env.HANOMAN_CLAUDE_HOME = join(osHome, ".claude");
process.env.HANOMAN_CODEX_HOME = join(osHome, ".codex");
process.env.HANOMAN_AGENTS_HOME = join(osHome, ".agents");

const app = buildApp({ requireAuth: false });
const skill = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Use when x\n---\n`);
};
const k = encodeURIComponent;

beforeEach(async () => {
  await prisma.project.deleteMany();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web", repoDir: repo } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "web", repoDir: join(root, "hilang") } });
});
afterAll(async () => { await prisma.project.deleteMany(); });

describe("capabilityForRoute · skills", () => {
  it("dipetakan menurut method", () => {
    expect(capabilityForRoute("GET", "/api/skills")).toBe("skills:read");
    expect(capabilityForRoute("PUT", "/api/skills/x/file")).toBe("skills:write");
    expect(capabilityForRoute("POST", "/api/skills")).toBe("skills:write");
    expect(capabilityForRoute("DELETE", "/api/skills/x")).toBe("skills:write");
  });
});

describe("GET /api/skills", () => {
  it("scope=all mengelompokkan global + per project; repo hilang → error per section", async () => {
    skill(join(home, "skills/g1"), "g1");
    skill(join(repo, ".claude/skills/p-a"), "p-a");
    const r = await app.inject({ method: "GET", url: "/api/skills?scope=all" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.global.map((s: { name: string }) => s.name)).toContain("g1");
    const p1 = body.projects.find((p: { projectId: string }) => p.projectId === "p1");
    expect(p1.skills.map((s: { name: string }) => s.name)).toEqual(["p-a"]);
    const p2 = body.projects.find((p: { projectId: string }) => p.projectId === "p2");
    expect(p2.error).toMatch(/repo/);
  });
  it("projectId menggabung global + project dengan shadowedBy", async () => {
    skill(join(home, "skills/dup"), "dup");
    skill(join(repo, ".agents/skills/dup"), "dup");
    const r = await app.inject({ method: "GET", url: "/api/skills?projectId=p1" });
    const g = r.json().find((s: { layer: string; name: string }) => s.layer === "hanoman" && s.name === "dup");
    expect(g.shadowedBy).toBe("project~p1~.agents~dup");
  });
});

describe("berkas skill", () => {
  it("tree, baca, tulis dengan hash, 409 bila basi", async () => {
    skill(join(home, "skills/ed"), "ed");
    const key = k("hanoman~-~hanoman~ed");
    const t = await app.inject({ method: "GET", url: `/api/skills/${key}/tree` });
    expect(t.json().files[0].path).toBe("SKILL.md");
    const f = await app.inject({ method: "GET", url: `/api/skills/${key}/file?path=SKILL.md` });
    const { hash } = f.json();
    const w = await app.inject({ method: "PUT", url: `/api/skills/${key}/file?path=SKILL.md`, payload: { content: "---\nname: ed\ndescription: baru\n---\n", baseHash: hash } });
    expect(w.statusCode).toBe(200);
    const stale = await app.inject({ method: "PUT", url: `/api/skills/${key}/file?path=SKILL.md`, payload: { content: "x", baseHash: hash } });
    expect(stale.statusCode).toBe(409);
  });
  it("traversal → 400, skill tak dikenal → 404", async () => {
    skill(join(home, "skills/ed"), "ed");
    const bad = await app.inject({ method: "GET", url: `/api/skills/${k("hanoman~-~hanoman~ed")}/file?path=../../x` });
    expect(bad.statusCode).toBe(400);
    const nf = await app.inject({ method: "GET", url: `/api/skills/${k("hanoman~-~hanoman~nope")}/tree` });
    expect(nf.statusCode).toBe(404);
  });
  it("plugin baca-saja → 403", async () => {
    skill(join(osHome, ".claude/plugins/cache/m/pkg/1/skills/pl"), "pl");
    const key = k("plugin~-~plugin:pkg~pl");
    const r = await app.inject({ method: "PUT", url: `/api/skills/${key}/file?path=SKILL.md`, payload: { content: "x", baseHash: null } });
    expect(r.statusCode).toBe(403);
    const d = await app.inject({ method: "DELETE", url: `/api/skills/${key}` });
    expect(d.statusCode).toBe(403);
  });
  it("entry: buat & hapus berkas", async () => {
    skill(join(home, "skills/ed"), "ed");
    const key = k("hanoman~-~hanoman~ed");
    expect((await app.inject({ method: "POST", url: `/api/skills/${key}/entry`, payload: { path: "references/a.md", kind: "file" } })).statusCode).toBe(201);
    expect(existsSync(join(home, "skills/ed/references/a.md"))).toBe(true);
    expect((await app.inject({ method: "DELETE", url: `/api/skills/${key}/entry?path=references` })).statusCode).toBe(204);
  });
});

describe("siklus hidup skill", () => {
  it("POST membuat skill di lapis hanoman / user / project", async () => {
    const a = await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "baru", description: "Use when z" } });
    expect(a.statusCode).toBe(201);
    expect(a.json().key).toBe("hanoman~-~hanoman~baru");
    const b = await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "user", source: ".agents", name: "u1", description: "d" } });
    expect(existsSync(join(osHome, ".agents/skills/u1/SKILL.md"))).toBe(true);
    expect(b.json().source).toBe(".agents");
    const c = await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "project", projectId: "p1", source: ".codex", name: "pc", description: "d" } });
    expect(existsSync(join(repo, ".codex/skills/pc/SKILL.md"))).toBe(true);
    expect(c.json().key).toBe("project~p1~.codex~pc");
  });
  it("POST menolak nama tak sah (400), nama terpakai (409), layer plugin (400)", async () => {
    expect((await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "Bad", description: "d" } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "dua", description: "d" } });
    expect((await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "dua", description: "d" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "plugin", name: "x", description: "d" } })).statusCode).toBe(400);
  });
  it("fork plugin → hanoman; delete", async () => {
    skill(join(osHome, ".claude/plugins/cache/m/pkg/1/skills/pl"), "pl");
    const f = await app.inject({ method: "POST", url: `/api/skills/${k("plugin~-~plugin:pkg~pl")}/fork`, payload: { layer: "hanoman", name: "pl-saya" } });
    expect(f.statusCode).toBe(201);
    expect(readFileSync(join(home, "skills/pl-saya/SKILL.md"), "utf8")).toContain("name: pl-saya");
    expect((await app.inject({ method: "DELETE", url: `/api/skills/${k("hanoman~-~hanoman~pl-saya")}` })).statusCode).toBe(204);
    expect(existsSync(join(home, "skills/pl-saya"))).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/skills.route.test.ts --no-file-parallelism`
Expected: FAIL — 404 pada semua route / capability `undefined`.

- [x] **Step 3: Implementasi — capability, paths, service, route**

`shared/src/agent.ts` — di daftar id capability, sesudah `"agents:read", "agents:write",`:

```ts
  // Skills library · domain TERSENDIRI, MENURUT METHOD: menulis skill mengubah instruksi yang
  // dibaca SETIAP sesi berikutnya (global hanoman disuntik ke semua project).
  "skills:read", "skills:write",
```

Di `CAPABILITIES`, sesudah entri `agents:write`:

```ts
  { id: "skills:read", domain: "skills", access: "read", label: "Skills — baca", desc: "Lihat skill global, plugin & per project beserta isi berkasnya." },
  { id: "skills:write", domain: "skills", access: "write", label: "Skills — tulis", desc: "Buat/ubah/hapus skill; skill global hanoman disuntik ke setiap sesi baru.", risk: "exec" },
```

Di `CAPABILITY_DOMAINS`, sesudah domain `agents`:

```ts
  { domain: "skills", label: "Skills", desc: "Skill global hanoman, user, plugin & per project." },
```

`server/src/services/agent-capabilities.ts` — sesudah blok `if (top === "custom-agents") {…}`:

```ts
  // Skills library · MENURUT METHOD (kelas bug SPEC-405): skill global hanoman disuntik ke setiap
  // sesi baru, jadi izin baca tak pernah cukup untuk menulisnya.
  if (top === "skills") return rw("skills");
```

`shared/src/api.ts` — di objek paths, sesudah `customAgent: …`:

```ts
  skills: `${API}/skills`,
  skill: (key: string) => `${API}/skills/${encodeURIComponent(key)}`,
  skillTree: (key: string) => `${API}/skills/${encodeURIComponent(key)}/tree`,
  skillFile: (key: string) => `${API}/skills/${encodeURIComponent(key)}/file`,
  skillEntry: (key: string) => `${API}/skills/${encodeURIComponent(key)}/entry`,
  skillFork: (key: string) => `${API}/skills/${encodeURIComponent(key)}/fork`,
```

```ts
// server/src/services/skill-library.ts
// Skills library · perakit tampilan dari pemindai runner + resolusi key → entri. Tanpa cache:
// memindai direktori murah, dan cache akan basi terhadap suntingan di luar hanoman.
import { join } from "node:path";
import {
  SkillError, agentSkillHome, agentsSkillHome, hanomanSkillsDir, markShadowed, resolveHome,
  scanGlobalSkills, scanProjectSkills,
} from "@hanoman/runner";
import { parseSkillKey, type SkillEntry, type SkillLibraryView } from "@hanoman/shared";
import { prisma } from "../db";
import { resolveRepoDir } from "./local-binding";
import { existsSync } from "node:fs";

export const skillsHome = (): string => resolveHome(process.env);
const opts = () => ({ hanomanHome: skillsHome(), env: process.env });

export async function libraryAll(): Promise<SkillLibraryView> {
  const global = scanGlobalSkills(opts());
  const projects = await prisma.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const groups = await Promise.all(projects.map(async (p) => {
    const repo = await resolveRepoDir(p.id);
    if (!repo || !existsSync(repo)) return { projectId: p.id, name: p.name, skills: [], error: "repo tidak ditemukan" };
    return { projectId: p.id, name: p.name, skills: scanProjectSkills(p.id, repo, opts()) };
  }));
  return { global, projects: groups };
}

export async function libraryForProject(projectId: string): Promise<SkillEntry[]> {
  const repo = await resolveRepoDir(projectId);
  const project = repo ? scanProjectSkills(projectId, repo, opts()) : [];
  return [...markShadowed(scanGlobalSkills(opts()), project), ...project];
}

export async function resolveSkill(key: string): Promise<SkillEntry> {
  const k = parseSkillKey(key);
  if (!k) throw new SkillError(400, "key skill tidak sah");
  const pool = k.layer === "project" && k.projectId
    ? await libraryForProject(k.projectId) : scanGlobalSkills(opts());
  const hit = pool.find((s) => s.key === key);
  if (!hit) throw new SkillError(404, "skill tidak ditemukan");
  return hit;
}

const USER_SOURCES = [".claude", ".codex", ".agents"] as const;
const PROJECT_SOURCES = [".claude", ".agents", ".codex"] as const;

/** Direktori INDUK tempat skill baru/fork diletakkan. */
export async function targetParent(layer: string, source: string | undefined, projectId: string | undefined): Promise<string> {
  if (layer === "hanoman") return hanomanSkillsDir(skillsHome());
  if (layer === "user") {
    const s = source ?? ".claude";
    if (!(USER_SOURCES as readonly string[]).includes(s)) throw new SkillError(400, "source user harus .claude/.codex/.agents");
    if (s === ".agents") return join(agentsSkillHome(process.env), "skills");
    return join(agentSkillHome(s === ".codex" ? "codex" : "claude", process.env), "skills");
  }
  if (layer === "project") {
    if (!projectId) throw new SkillError(400, "projectId wajib untuk lapis project");
    const s = source ?? ".claude";
    if (!(PROJECT_SOURCES as readonly string[]).includes(s)) throw new SkillError(400, "source project harus .claude/.agents/.codex");
    const repo = await resolveRepoDir(projectId);
    if (!repo || !existsSync(repo)) throw new SkillError(404, "repo project tidak ditemukan");
    return join(repo, s, "skills");
  }
  throw new SkillError(400, "layer harus hanoman, user, atau project");
}
```

```ts
// server/src/routes/skills.ts
// Skills library (desain 2026-09-26) · lihat & sunting skill tiga lapis. Tulis ke plugin → 403.
import type { FastifyInstance, FastifyReply } from "fastify";
import { basename } from "node:path";
import {
  SkillError, copySkillDir, createSkillDir, createSkillEntry, deleteSkillDir, deleteSkillEntry,
  readSkillFile, skillTree, writeSkillFile,
} from "@hanoman/runner";
import { skillKey } from "@hanoman/shared";
import { libraryAll, libraryForProject, resolveSkill, targetParent } from "../services/skill-library";

const fail = (reply: FastifyReply, e: unknown) => {
  if (e instanceof SkillError) return reply.code(e.status).send({ error: e.message });
  throw e;
};
const editable = async (key: string) => {
  const s = await resolveSkill(key);
  if (!s.editable) throw new SkillError(403, "skill plugin baca-saja — fork untuk menyunting");
  return s;
};
const created = (layer: "hanoman" | "user" | "project", source: string | undefined, projectId: string | undefined, dir: string) =>
  skillKey(layer, layer === "project" ? projectId! : null, layer === "hanoman" ? "hanoman" : (source ?? ".claude"), basename(dir));

export default async function skills(app: FastifyInstance) {
  app.get("/skills", async (req) => {
    const q = req.query as { scope?: string; projectId?: string };
    if (q.projectId) return libraryForProject(q.projectId);
    const all = await libraryAll();
    return q.scope === "all" ? all : all.global;
  });

  app.get("/skills/:key/tree", async (req, reply) => {
    try { return skillTree((await resolveSkill((req.params as { key: string }).key)).dir); }
    catch (e) { return fail(reply, e); }
  });

  app.get("/skills/:key/file", async (req, reply) => {
    try {
      const s = await resolveSkill((req.params as { key: string }).key);
      return readSkillFile(s.dir, String((req.query as { path?: string }).path ?? ""));
    } catch (e) { return fail(reply, e); }
  });

  app.put("/skills/:key/file", async (req, reply) => {
    try {
      const s = await editable((req.params as { key: string }).key);
      const b = req.body as { content?: unknown; baseHash?: unknown };
      if (typeof b?.content !== "string") return reply.code(400).send({ error: "content wajib string" });
      const base = typeof b.baseHash === "string" ? b.baseHash : null;
      return writeSkillFile(s.dir, String((req.query as { path?: string }).path ?? ""), b.content, base);
    } catch (e) { return fail(reply, e); }
  });

  app.post("/skills/:key/entry", async (req, reply) => {
    try {
      const s = await editable((req.params as { key: string }).key);
      const b = req.body as { path?: unknown; kind?: unknown };
      if (typeof b?.path !== "string" || (b.kind !== "file" && b.kind !== "dir")) return reply.code(400).send({ error: "path & kind (file|dir) wajib" });
      createSkillEntry(s.dir, b.path, b.kind);
      return reply.code(201).send({ ok: true });
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/skills/:key/entry", async (req, reply) => {
    try {
      const s = await editable((req.params as { key: string }).key);
      deleteSkillEntry(s.dir, String((req.query as { path?: string }).path ?? ""));
      return reply.code(204).send();
    } catch (e) { return fail(reply, e); }
  });

  app.post("/skills", async (req, reply) => {
    try {
      const b = req.body as { layer?: string; source?: string; projectId?: string; name?: string; description?: string };
      if (typeof b?.name !== "string" || typeof b.description !== "string") return reply.code(400).send({ error: "name & description wajib" });
      const layer = b.layer as "hanoman" | "user" | "project";
      const dir = createSkillDir(await targetParent(String(b.layer), b.source, b.projectId), b.name, b.description);
      return reply.code(201).send(await resolveSkill(created(layer, b.source, b.projectId, dir)));
    } catch (e) { return fail(reply, e); }
  });

  app.post("/skills/:key/fork", async (req, reply) => {
    try {
      const src = await resolveSkill((req.params as { key: string }).key);
      const b = req.body as { layer?: string; source?: string; projectId?: string; name?: string };
      const layer = (b?.layer ?? "hanoman") as "hanoman" | "user" | "project";
      const dir = copySkillDir(src.dir, await targetParent(layer, b?.source, b?.projectId), b?.name ?? src.name);
      return reply.code(201).send(await resolveSkill(created(layer, b?.source, b?.projectId, dir)));
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/skills/:key", async (req, reply) => {
    try {
      deleteSkillDir((await editable((req.params as { key: string }).key)).dir);
      return reply.code(204).send();
    } catch (e) { return fail(reply, e); }
  });
}
```

`server/src/app.ts`: tambah `import skills from "./routes/skills";` di dekat `import customAgents …` (baris 42) dan `await api.register(skills);` tepat sesudah `await api.register(customAgents);` (cari dengan `grep -n "register(customAgents)" server/src/app.ts`).

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/skills.route.test.ts server/test/custom-agents.route.test.ts --no-file-parallelism`
Expected: PASS. Bila ada test capability katalog yang menghitung jumlah capability/domain (cari: `grep -rn "CAPABILITY_DOMAINS\|CAPABILITIES.length" server/test shared/src src/src --include=*.test.*`), perbarui angka/daftarnya dan sertakan di run ini.

- [x] **Step 5: Commit**

```bash
git add shared/src/agent.ts shared/src/api.ts server/src/services/agent-capabilities.ts server/src/services/skill-library.ts server/src/routes/skills.ts server/src/app.ts server/test/skills.route.test.ts docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): route /api/skills* + capability skills:read/write"
```

---

### Task 5: Penyuntikan skill global hanoman ke sesi

**Files:**
- Create: `server/src/services/skill-inject.ts`
- Create: `server/test/skill-inject.test.ts`
- Modify: `server/src/services/pty.ts` (dekat perakitan argv, ±baris 1034)
- Modify: `server/src/routes/skills.ts` (cabut exclude saat membuat/fork skill project)

**Interfaces:**
- Consumes: `scanGlobalSkills`, `scanProjectSkills`, `hanomanSkillsDir` (Task 2); `skillsHome()` (Task 4); `agentTempDir(id)` di `pty.ts:289`.
- Produces:
  - `interface InjectResult { addDir?: string; injected: string[]; warnings: string[] }`
  - `function injectGlobalSkills(o: { agent: "claude" | "codex"; cwd: string; tempDir: string; hanomanHome: string }): InjectResult`
  - `function unexcludeInjected(repoDir: string, name: string): void`
  - `const INJECT_MARKER = "# hanoman:skill-inject"`

- [x] **Step 1: Tulis test yang gagal**

```ts
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
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run server/test/skill-inject.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implementasi**

```ts
// server/src/services/skill-inject.ts
// Skills library · menyuntik skill global hanoman ($HANOMAN_HOME/skills) ke satu sesi agen.
//
// claude: `--add-dir <tmp>/skills-root` yang memuat `.claude/skills/<n>` → symlink. Docs Claude
//   Code: skill di `.claude/skills/` direktori --add-dir dimuat, dengan live reload. Worktree
//   tak disentuh.
// codex: tak ada akar skill tambahan resmi → symlink `<cwd>/.agents/skills/<n>` + baris exclude.
//   `info/exclude` tinggal di COMMON dir git (dipakai semua worktree + checkout utama), maka
//   barisnya ditandai dan dicabut `unexcludeInjected` saat skill project bernama sama dibuat.
// Fail-open: setiap kegagalan jadi peringatan; sesi tak pernah gagal lahir karenanya.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { scanGlobalSkills, scanProjectSkills } from "@hanoman/runner";

export const INJECT_MARKER = "# hanoman:skill-inject";
export interface InjectResult { addDir?: string; injected: string[]; warnings: string[] }

const excludeLine = (name: string) => `/.agents/skills/${name}`;

function excludeFile(repoDir: string): string {
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repoDir, encoding: "utf8" }).trim();
  return join(isAbsolute(common) ? common : join(repoDir, common), "info", "exclude");
}

export function injectGlobalSkills(o: { agent: "claude" | "codex"; cwd: string; tempDir: string; hanomanHome: string }): InjectResult {
  const out: InjectResult = { injected: [], warnings: [] };
  const opts = { hanomanHome: o.hanomanHome, env: process.env };
  const global = scanGlobalSkills(opts).filter((s) => s.layer === "hanoman");
  if (!global.length) return out;
  const taken = new Set(scanProjectSkills("session", o.cwd, opts).map((s) => s.name));
  const todo = global.filter((s) => !taken.has(s.name));
  if (!todo.length) return out;

  if (o.agent === "claude") {
    const root = join(o.tempDir, "skills-root");
    try {
      mkdirSync(join(root, ".claude", "skills"), { recursive: true });
      for (const s of todo) {
        const link = join(root, ".claude", "skills", s.name);
        if (!lstatSync(link, { throwIfNoEntry: false })) symlinkSync(s.dir, link);
        out.injected.push(s.name);
      }
      out.addDir = root;
    } catch (e) {
      out.warnings.push(`skill global tak disuntik (claude): ${(e as Error).message}`);
    }
    return out;
  }

  let exclude: string;
  try { exclude = excludeFile(o.cwd); }
  catch { out.warnings.push("skill global tak disuntik (codex): cwd bukan repo git"); return out; }
  for (const s of todo) {
    try {
      const link = join(o.cwd, ".agents", "skills", s.name);
      if (lstatSync(link, { throwIfNoEntry: false })) continue;
      mkdirSync(join(o.cwd, ".agents", "skills"), { recursive: true });
      symlinkSync(s.dir, link);
      mkdirSync(join(exclude, ".."), { recursive: true });
      const cur = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
      const line = excludeLine(s.name);
      if (!cur.split("\n").includes(line)) {
        const head = cur.includes(INJECT_MARKER) ? "" : `${cur && !cur.endsWith("\n") ? "\n" : ""}${INJECT_MARKER}\n`;
        appendFileSync(exclude, `${head}${line}\n`);
      }
      out.injected.push(s.name);
    } catch (e) {
      out.warnings.push(`skill ${s.name} tak disuntik (codex): ${(e as Error).message}`);
    }
  }
  return out;
}

export function unexcludeInjected(repoDir: string, name: string): void {
  try {
    const f = excludeFile(repoDir);
    if (!existsSync(f)) return;
    const line = excludeLine(name);
    writeFileSync(f, readFileSync(f, "utf8").split("\n").filter((l) => l !== line).join("\n"));
  } catch { /* fail-open: bukan repo git */ }
}
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run server/test/skill-inject.test.ts`
Expected: PASS.

- [x] **Step 5: Sambungkan ke `pty.ts` dan route**

`server/src/services/pty.ts` — impor di bagian atas:

```ts
import { injectGlobalSkills } from "./skill-inject";
import { skillsHome } from "./skill-library";
```

Tepat sebelum `const agentsArg = agentsFile ? …` (±baris 1034), di dalam cabang yang sama (bukan `opts.command`):

```ts
    // Skills library · skill global hanoman ke sesi agen. Fail-open: peringatan stderr saja.
    let skillsArg = "";
    try {
      const inj = injectGlobalSkills({ agent: agent === "codex" ? "codex" : "claude", cwd, tempDir: agentTempDir(id), hanomanHome: skillsHome() });
      for (const w of inj.warnings) process.stderr.write(`hanoman: ${w}\n`);
      if (agent === "claude" && inj.addDir) skillsArg = `--add-dir ${sq(inj.addDir)}`;
    } catch (e) {
      process.stderr.write(`hanoman: penyuntikan skill global gagal: ${(e as Error).message}\n`);
    }
```

dan ubah perakitan argv menjadi:

```ts
    argv = [sq(agentBin(agent)), promptArg, flags, agentsArg, nativeAgentArgs, skillsArg]
      .filter(Boolean).join(" ");
```

Verifikasi dulu bahwa variabel `cwd`, `agent`, `id`, `sq` ada dalam scope di titik itu (`grep -n "const cwd\|const sq\|function sq" server/src/services/pty.ts`); bila `cwd` bernama lain, pakai nama yang dipakai `selectionContext` (±baris 842).

`server/src/routes/skills.ts` — sesudah `createSkillDir`/`copySkillDir` sukses untuk `layer === "project"`, cabut exclude suntikan bernama sama:

```ts
import { unexcludeInjected } from "../services/skill-inject";
import { resolveRepoDir } from "../services/local-binding";
// … di handler POST /skills dan POST /skills/:key/fork, sesudah dir dibuat:
      if (layer === "project" && b?.projectId) {
        const repo = await resolveRepoDir(b.projectId);
        if (repo) unexcludeInjected(repo, basename(dir));
      }
```

Tambah test di `server/test/custom-agents.pty.test.ts`-gaya? Tidak — cukup jalankan test pty yang ada untuk memastikan argv tak rusak:

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/skill-inject.test.ts server/test/skills.route.test.ts server/test/custom-agents.pty.test.ts --no-file-parallelism`
Expected: PASS. (Bila `custom-agents.pty.test.ts` gagal karena env tmux/askpass, lihat memori "pty.test gagal palsu"; bandingkan dengan run di base sebelum menyimpulkan regresi.)

- [x] **Step 6: Commit**

```bash
git add server/src/services/skill-inject.ts server/test/skill-inject.test.ts server/src/services/pty.ts server/src/routes/skills.ts docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): suntik skill global hanoman ke sesi (claude --add-dir, codex symlink+exclude)"
```

---

### Task 6: Tool MCP skills

**Files:**
- Create: `shared/src/mcp-catalog/skills.ts`
- Modify: `shared/src/mcp-catalog/index.ts` (gabungkan `SKILLS_TOOLS` seperti `AGENTS_TOOLS`)
- Test: test katalog MCP yang ada (cari: `grep -rln "AGENTS_TOOLS\|hanoman_agents_list" shared/src server/test cli/src --include=*.test.ts`)

**Interfaces:**
- Consumes: `obj`, `str` dari `../mcp-schema`; `enc`, `query`, `s` dari `./helpers`; `McpToolDef`.
- Produces: `SKILLS_TOOLS: readonly McpToolDef[]` berisi `hanoman_skills_list`, `hanoman_skill_read`, `hanoman_skill_write`.

- [x] **Step 1: Tulis test yang gagal** — tambahkan ke test katalog MCP yang ditemukan (atau buat `shared/src/mcp-catalog/skills.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { SKILLS_TOOLS } from "./skills";

describe("SKILLS_TOOLS", () => {
  const t = (n: string) => SKILLS_TOOLS.find((x) => x.name === n)!;
  it("list: scope all tanpa project, projectId bila diisi", () => {
    expect(t("hanoman_skills_list").build({})).toMatchObject({ method: "GET", path: "/skills", query: { scope: "all" } });
    expect(t("hanoman_skills_list").build({ project: "p1" }).query).toMatchObject({ projectId: "p1" });
    expect(t("hanoman_skills_list").capability).toBe("skills:read");
  });
  it("read tanpa path = tree; dengan path = file", () => {
    expect(t("hanoman_skill_read").build({ key: "hanoman~-~hanoman~a" }).path).toBe("/skills/hanoman~-~hanoman~a/tree");
    expect(t("hanoman_skill_read").build({ key: "k", path: "SKILL.md" })).toMatchObject({ path: "/skills/k/file", query: { path: "SKILL.md" } });
  });
  it("write memakai PUT + baseHash, capability skills:write", () => {
    const w = t("hanoman_skill_write");
    expect(w.capability).toBe("skills:write");
    expect(w.build({ key: "k", path: "SKILL.md", content: "x", baseHash: "h" })).toMatchObject({ method: "PUT", path: "/skills/k/file", query: { path: "SKILL.md" }, body: { content: "x", baseHash: "h" } });
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/mcp-catalog/skills.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implementasi**

Periksa dulu bentuk `build` return (`body`/`query`) dan helper `enc` di `shared/src/mcp-catalog/helpers.ts` & `agents.ts` (tool `hanoman_agent_update` memakai path ber-id). Lalu:

```ts
// shared/src/mcp-catalog/skills.ts
// Skills library · tool domain `skills`. MENURUT METHOD: skill global hanoman disuntik ke setiap
// sesi baru, jadi izin baca tak pernah cukup untuk menulisnya.
import { obj, str } from "../mcp-schema";
import { enc, query, s } from "./helpers";
import type { McpToolDef } from "./types";

export const SKILLS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_skills_list",
    title: "Daftar skill",
    description:
      "Skill dari semua sumber: global hanoman ($HANOMAN_HOME/skills, disuntik ke setiap sesi), user (~/.claude|~/.codex|~/.agents), plugin (baca-saja), dan per project (.claude/.agents/.codex/skills + folder lain berisi SKILL.md). Tanpa `project`: global + satu grup per project. Dengan `project`: global (bertanda shadowedBy bila ditimpa) + skill project itu.",
    inputSchema: obj({ properties: { project: str("Id project. Kosongkan untuk semua grup.") } }),
    mode: "read", capability: "skills:read",
    samplePath: "/skills", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/skills", query: query(s(a.project) ? { projectId: s(a.project) } : { scope: "all" }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_read",
    title: "Baca skill",
    description: "Tanpa `path`: pohon berkas skill. Dengan `path`: isi berkas + `hash` (dipakai sebagai baseHash saat menulis). Berkas biner/>1 MB hanya metadata.",
    inputSchema: obj({
      properties: { key: str("Key skill dari hanoman_skills_list."), path: str("Path relatif berkas, mis. SKILL.md.") },
      required: ["key"],
    }),
    mode: "read", capability: "skills:read",
    samplePath: "/skills/{key}/tree", sampleMethod: "GET",
    build: (a) => s(a.path)
      ? { method: "GET", path: `/skills/${enc(String(a.key))}/file`, query: query({ path: s(a.path) }) }
      : { method: "GET", path: `/skills/${enc(String(a.key))}/tree` },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_write",
    title: "Tulis berkas skill",
    description: "Menulis satu berkas di skill. `baseHash` = hash dari hanoman_skill_read (409 bila berkas berubah sejak dibaca); kosongkan untuk berkas baru. Skill plugin → 403. Menyunting skill global hanoman mempengaruhi SETIAP sesi berikutnya di semua project.",
    inputSchema: obj({
      properties: {
        key: str("Key skill."), path: str("Path relatif berkas."), content: str("Isi berkas lengkap."),
        baseHash: str("Hash saat dibaca; kosongkan untuk berkas baru."),
      },
      required: ["key", "path", "content"],
    }),
    mode: "write", capability: "skills:write",
    samplePath: "/skills/{key}/file", sampleMethod: "PUT",
    build: (a) => ({
      method: "PUT", path: `/skills/${enc(String(a.key))}/file`, query: query({ path: String(a.path) }),
      body: { content: String(a.content), baseHash: s(a.baseHash) ?? null },
    }),
    shape: (raw) => raw,
  },
];
```

Sesuaikan nama field `body` bila `McpToolDef.build` memakai nama lain (lihat `agents.ts` tool create). Daftarkan di `shared/src/mcp-catalog/index.ts` di samping `AGENTS_TOOLS`.

- [x] **Step 4: Jalankan, pastikan lulus** — termasuk test katalog MCP yang sudah ada (mis. test yang memvalidasi setiap tool punya capability sah dan `samplePath` terpeta oleh `capabilityForRoute`):

Run: `pnpm vitest --run shared/src/mcp-catalog/skills.test.ts <test-katalog-mcp-yang-ditemukan>`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/mcp-catalog/skills.ts shared/src/mcp-catalog/skills.test.ts shared/src/mcp-catalog/index.ts docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): tool MCP hanoman_skills_list/skill_read/skill_write"
```

---

### Task 7: Klien API + `SkillsWorkspace` (daftar, struktur, editor)

**Files:**
- Modify: `src/src/api/client.ts` (sesudah `deleteCustomAgent` ±baris 757)
- Create: `src/src/screens/skills/SkillsList.tsx`
- Create: `src/src/screens/skills/SkillEditor.tsx`
- Create: `src/src/screens/skills/SkillsWorkspace.tsx`
- Create: `src/src/screens/skills/SkillsWorkspace.test.tsx`

**Interfaces:**
- Consumes: paths Task 4; tipe Task 1; `buildFileTree`, `TreeRow` dari `../file-tree`; `MarkdownView` dari `../../ds/markdown`; `Card`, `Badge`, `Button`, `Input`, `StateBlock`, `ResponsivePanels`, `Modal`, `Field`, `useConfirm` dari `../../ds`.
- Produces:
  - api: `listSkills(projectId?)`, `listAllSkills()`, `skillTree(key)`, `skillFile(key, path)`, `writeSkillFile(key, path, content, baseHash)`, `createSkillEntry(key, path, kind)`, `deleteSkillEntry(key, path)`, `createSkill(b)`, `forkSkill(key, b)`, `deleteSkill(key)`
  - `export function SkillsWorkspace({ projectId, onToast }: { projectId?: string; onToast?: (m: string) => void })`

- [x] **Step 1: Klien API**

```ts
  // Skills library · tanpa projectId → semua grup (global + per project); dengan projectId →
  // global (ber-shadowedBy) + skill project itu.
  listAllSkills: () => j<SkillLibraryView>(paths.skills + qs({ scope: "all" })),
  listSkills: (projectId: string) => j<SkillEntry[]>(paths.skills + qs({ projectId })),
  skillTree: (key: string) => j<SkillTreeView>(paths.skillTree(key)),
  skillFile: (key: string, path: string) => j<SkillFileView>(paths.skillFile(key) + qs({ path })),
  writeSkillFile: (key: string, path: string, content: string, baseHash: string | null) =>
    j<{ hash: string }>(paths.skillFile(key) + qs({ path }), { method: "PUT", ...body({ content, baseHash }) }),
  createSkillEntry: (key: string, path: string, kind: "file" | "dir") =>
    j<{ ok: true }>(paths.skillEntry(key), { method: "POST", ...body({ path, kind }) }),
  deleteSkillEntry: (key: string, path: string) => j<void>(paths.skillEntry(key) + qs({ path }), { method: "DELETE" }),
  createSkill: (b: { layer: "hanoman" | "user" | "project"; source?: string; projectId?: string; name: string; description: string }) =>
    j<SkillEntry>(paths.skills, { method: "POST", ...body(b) }),
  forkSkill: (key: string, b: { layer: "hanoman" | "project"; projectId?: string; source?: string; name?: string }) =>
    j<SkillEntry>(paths.skillFork(key), { method: "POST", ...body(b) }),
  deleteSkill: (key: string) => j<void>(paths.skill(key), { method: "DELETE" }),
```

Impor tipe `SkillEntry, SkillLibraryView, SkillTreeView, SkillFileView` dari `@hanoman/shared` di kepala `client.ts`. Periksa bahwa `j` melempar error ber-`status` untuk 409 (lihat implementasi `j` di berkas yang sama); editor memakai `(e as { status?: number }).status === 409`.

- [x] **Step 2: Tulis test komponen yang gagal**

```tsx
// src/src/screens/skills/SkillsWorkspace.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsWorkspace } from "./SkillsWorkspace";

const e = (o: Record<string, unknown>) => ({
  description: "Use when x", projectId: null, dir: "/d", loadedBy: ["claude"], editable: true, ...o,
});
const library = {
  global: [
    e({ key: "hanoman~-~hanoman~shared-a", name: "shared-a", layer: "hanoman", source: "hanoman", loadedBy: ["claude", "codex"] }),
    e({ key: "plugin~-~plugin:pkg~pl", name: "pl", layer: "plugin", source: "plugin:pkg", editable: false }),
  ],
  projects: [
    { projectId: "p1", name: "Alpha", skills: [e({ key: "project~p1~.agents~deploy", name: "deploy", layer: "project", source: ".agents", projectId: "p1", loadedBy: ["codex"] })] },
    { projectId: "p2", name: "Beta", skills: [], error: "repo tidak ditemukan" },
  ],
};
const json = (v: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v } as Response);

function mockFetch(extra: (u: string, init?: RequestInit) => Promise<Response> | null = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const u = String(url);
    const x = extra(u, init);
    if (x) return x;
    if (u.includes("/api/skills?scope=all")) return json(library);
    if (u.endsWith("/tree")) return json({ files: [{ path: "SKILL.md", size: 10 }, { path: "references/api.md", size: 3 }], dirs: ["references"] });
    if (u.includes("/file?")) return json({ path: "SKILL.md", size: 10, hash: "h1", content: "---\nname: shared-a\ndescription: Use when x\n---\n# isi", binary: false, tooLarge: false });
    return json({});
  });
}
afterEach(() => vi.restoreAllMocks());

describe("SkillsWorkspace (/skills)", () => {
  it("mengelompokkan Global dan satu section per project, termasuk error repo", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    expect(await screen.findByText("shared-a")).toBeTruthy();
    expect(screen.getByText("Global")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("deploy")).toBeTruthy();
    expect(screen.getByText(/repo tidak ditemukan/)).toBeTruthy();
    expect(screen.getByText(".agents")).toBeTruthy();
  });

  it("memilih skill memuat struktur dan SKILL.md, lalu menyimpan dengan baseHash", async () => {
    const put = vi.fn();
    mockFetch((u, init) => {
      if (init?.method === "PUT") { put(u, JSON.parse(String(init.body))); return json({ hash: "h2" }); }
      return null;
    });
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    expect(await screen.findByText("references")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const ta = await screen.findByRole("textbox", { name: /isi berkas/i });
    fireEvent.change(ta, { target: { value: "---\nname: shared-a\ndescription: baru\n---\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![1]).toMatchObject({ baseHash: "h1" });
  });

  it("skill plugin baca-saja: tanpa tombol Edit, ada Fork", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("pl"));
    expect(await screen.findByRole("button", { name: /Fork/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("409 saat simpan menampilkan pesan konflik", async () => {
    mockFetch((u, init) => init?.method === "PUT" ? json({ error: "berkas berubah di tempat lain" }, 409) : null);
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /isi berkas/i }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await screen.findByText(/berubah di tempat lain/)).toBeTruthy();
  });
});
```

- [x] **Step 3: Jalankan, pastikan gagal**

Run: `pnpm vitest --run src/src/screens/skills/SkillsWorkspace.test.tsx`
Expected: FAIL — module not found.

- [x] **Step 4: Implementasi komponen**

Sebelum menulis, baca props `Card`, `Badge`, `Button`, `Input`, `StateBlock`, `ResponsivePanels`, `Modal`, `Field`, `useConfirm` di `src/src/ds/**` dan pola `IdeReadPanel.tsx:55-120`; ikuti design system `internal/docs/design-system/**`. Bila `useApi()` membutuhkan provider di test, cek cara `CustomAgentsPanel.test.tsx`/`SettingsScreen.test.tsx` merender (mereka memakai `fetch` mock langsung — ikuti itu).

```tsx
// src/src/screens/skills/SkillsList.tsx
import React from "react";
import type { SkillEntry, SkillLibraryView } from "@hanoman/shared";
import { Badge, Input, StateBlock } from "../../ds";

const LAYER_LABEL: Record<string, string> = { hanoman: "Hanoman", user: "User", plugin: "Plugin" };
export const sourceLabel = (s: SkillEntry) => s.source.startsWith("lainnya:") ? "lainnya" : s.source.startsWith("plugin:") ? s.source : s.source;

function Row({ s, selected, onSelect }: { s: SkillEntry; selected: boolean; onSelect: (s: SkillEntry) => void }) {
  return (
    <button type="button" className={`hn-skill-row${selected ? " is-selected" : ""}`} onClick={() => onSelect(s)}
      style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "6px 10px", textAlign: "left",
        background: selected ? "var(--brass-50)" : "transparent", border: 0, borderRadius: 6, cursor: "pointer" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
      {s.source !== "hanoman" && <Badge size="sm">{sourceLabel(s)}</Badge>}
      {s.loadedBy.length === 0 && <Badge size="sm" tone="neutral">tidak dimuat</Badge>}
      {s.shadowedBy && <Badge size="sm" tone="warn">tertimpa</Badge>}
      {s.frontmatterError && <Badge size="sm" tone="err" icon="alert-triangle">frontmatter</Badge>}
      {!s.editable && <Badge size="sm" icon="lock">baca</Badge>}
    </button>
  );
}

function Group({ title, items, selected, onSelect, error }:
  { title: string; items: SkillEntry[]; selected?: string; onSelect: (s: SkillEntry) => void; error?: string }) {
  return (
    <section style={{ marginBottom: 12 }}>
      <div className="hn-eyebrow" style={{ padding: "6px 10px" }}>{title} ({items.length})</div>
      {error ? <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--clay-600)" }}>{error}</div>
        : items.map((s) => <Row key={s.key} s={s} selected={s.key === selected} onSelect={onSelect} />)}
    </section>
  );
}

export function SkillsList({ library, selected, onSelect }:
  { library: SkillLibraryView; selected?: string; onSelect: (s: SkillEntry) => void }) {
  const [q, setQ] = React.useState("");
  const match = (s: SkillEntry) => !q || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const global = library.global.filter(match);
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: 8 }}><Input placeholder="Cari skill…" value={q} onChange={(e) => setQ(e.target.value)} leftIcon="search" /></div>
      <div style={{ overflow: "auto", flex: "1 1 auto", padding: "0 4px 8px" }}>
        <h3 className="hn-eyebrow" style={{ padding: "4px 10px", fontSize: 12 }}>Global</h3>
        {(["hanoman", "user", "plugin"] as const).map((layer) => (
          <Group key={layer} title={LAYER_LABEL[layer]!} items={global.filter((s) => s.layer === layer)} selected={selected} onSelect={onSelect} />
        ))}
        {library.projects.map((p) => (
          <div key={p.projectId}>
            <h3 className="hn-eyebrow" style={{ padding: "4px 10px", fontSize: 12 }}>{p.name}</h3>
            <Group title="Project" items={p.skills.filter(match)} selected={selected} onSelect={onSelect} error={p.error} />
          </div>
        ))}
        {global.length === 0 && library.projects.every((p) => p.skills.length === 0) &&
          <StateBlock kind="empty" compact icon="sparkles" title="Belum ada skill" />}
      </div>
    </div>
  );
}
```

```tsx
// src/src/screens/skills/SkillEditor.tsx
import React from "react";
import { parseSkillFrontmatter, type SkillEntry, type SkillFileView, type SkillTreeView } from "@hanoman/shared";
import { Badge, Button, Card, StateBlock, isMarkdownPath } from "../../ds";
import { MarkdownView } from "../../ds/markdown";
import { useApi } from "../../api/instance";
import { buildFileTree, TreeRow } from "../file-tree";

export function SkillStructure({ skill, tree, selected, onSelect, onChanged, onToast }:
  { skill: SkillEntry; tree: SkillTreeView | null; selected: string; onSelect: (p: string) => void; onChanged: () => void; onToast?: (m: string) => void }) {
  const api = useApi();
  const add = async (kind: "file" | "dir") => {
    const path = window.prompt(kind === "file" ? "Path berkas baru (mis. references/api.md)" : "Path folder baru");
    if (!path) return;
    try { await api.createSkillEntry(skill.key, path, kind); onChanged(); }
    catch (e) { onToast?.((e as Error).message); }
  };
  return (
    <Card padding={0} fill>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="hn-eyebrow">{skill.name}/</span>
      </div>
      <div style={{ padding: 8, flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
        {!tree ? <StateBlock kind="loading" compact title="Memuat struktur…" />
          : buildFileTree(tree.files.map((f) => f.path), tree.dirs).map((n) => (
              <TreeRow key={n.path} node={n} selected={selected} onSelect={onSelect} defaultOpen />
            ))}
      </div>
      {skill.editable && (
        <div style={{ display: "flex", gap: 8, padding: 8, borderTop: "1px solid var(--border-hair)" }}>
          <Button size="sm" variant="ghost" leftIcon="file-plus" onClick={() => add("file")}>Berkas</Button>
          <Button size="sm" variant="ghost" leftIcon="folder-plus" onClick={() => add("dir")}>Folder</Button>
        </div>
      )}
    </Card>
  );
}

export function SkillFileEditor({ skill, path, onFork, onToast }:
  { skill: SkillEntry; path: string; onFork: () => void; onToast?: (m: string) => void }) {
  const api = useApi();
  const [file, setFile] = React.useState<SkillFileView | null>(null);
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [draft, setDraft] = React.useState("");
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(() => {
    setFile(null); setConflict(null);
    api.skillFile(skill.key, path).then((f) => { setFile(f); setDraft(f.content ?? ""); }).catch(() => setFile(null));
  }, [api, skill.key, path]);
  React.useEffect(() => { setMode("preview"); load(); }, [load]);

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const r = await api.writeSkillFile(skill.key, path, draft, file.hash);
      setFile({ ...file, content: draft, hash: r.hash }); setConflict(null); onToast?.("Tersimpan");
    } catch (e) {
      const status = (e as { status?: number }).status;
      setConflict(status === 409 ? "Berkas berubah di tempat lain — muat ulang atau timpa." : (e as Error).message);
    } finally { setSaving(false); }
  };
  const overwrite = async () => {
    const fresh = await api.skillFile(skill.key, path);
    setFile({ ...fresh }); await api.writeSkillFile(skill.key, path, draft, fresh.hash);
    setConflict(null); onToast?.("Tersimpan (menimpa)");
  };

  const fm = path === "SKILL.md" && file?.content != null ? parseSkillFrontmatter(mode === "edit" ? draft : file.content) : null;
  const dirty = file?.content != null && draft !== file.content;

  return (
    <Card padding={0} fill>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, flex: "1 1 auto" }}>{path}</span>
        {skill.editable ? (
          <>
            <Button size="sm" variant={mode === "preview" ? "secondary" : "ghost"} onClick={() => setMode("preview")}>Pratinjau</Button>
            <Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")}>Edit</Button>
          </>
        ) : <Button size="sm" leftIcon="git-fork" onClick={onFork}>Fork ke global hanoman / project</Button>}
      </div>
      {fm && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", background: "var(--paper-100)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>name: {fm.name ?? "—"}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{fm.description ?? "—"}</div>
          {fm.error && <Badge tone="err" size="sm">{fm.error}</Badge>}
        </div>
      )}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: mode === "edit" ? 0 : 16 }}>
        {!file ? <StateBlock kind="loading" compact title="Memuat berkas…" />
          : file.binary || file.tooLarge ? <StateBlock kind="empty" compact icon="file" title={file.binary ? "Berkas biner" : "Berkas terlalu besar"} hint={`${file.size} B`} />
          : mode === "edit" ? (
            <textarea aria-label="Isi berkas" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
              style={{ width: "100%", height: "100%", minHeight: 320, border: 0, padding: 16, fontFamily: "var(--font-mono)", fontSize: 13, background: "transparent", resize: "none" }} />
          ) : isMarkdownPath(path) ? <MarkdownView source={file.content ?? ""} />
          : <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre-wrap" }}>{file.content}</pre>}
      </div>
      {skill.editable && mode === "edit" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderTop: "1px solid var(--border-hair)" }}>
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>Simpan</Button>
          {dirty && <span style={{ fontSize: 12, color: "var(--brass-700)" }}>belum disimpan</span>}
          {conflict && (
            <span style={{ fontSize: 12, color: "var(--clay-600)", display: "flex", gap: 8, alignItems: "center" }}>
              {conflict}
              <Button size="sm" variant="ghost" onClick={load}>Muat ulang</Button>
              <Button size="sm" variant="ghost" onClick={overwrite}>Timpa</Button>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
```

Periksa nama prop `MarkdownView` (`source` vs `markdown`/`children`) di `src/src/ds/markdown.tsx` dan sesuaikan.

```tsx
// src/src/screens/skills/SkillsWorkspace.tsx
// Skills library (desain 2026-09-26) · satu komponen untuk /skills (semua grup) dan
// /skills/<projectId> (global warisan + skill project itu). Pola CustomAgentsPanel.
import React from "react";
import type { SkillEntry, SkillLibraryView, SkillTreeView } from "@hanoman/shared";
import { Button, Field, Input, Modal, ResponsivePanels, StateBlock, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { SkillsList } from "./SkillsList";
import { SkillFileEditor, SkillStructure } from "./SkillEditor";

type NewSkill = { layer: "hanoman" | "user" | "project"; source: string; name: string; description: string };

export function SkillsWorkspace({ projectId, onToast }: { projectId?: string; onToast?: (m: string) => void }) {
  const api = useApi();
  const confirm = useConfirm();
  const [library, setLibrary] = React.useState<SkillLibraryView | null>(null);
  const [error, setError] = React.useState(false);
  const [skill, setSkill] = React.useState<SkillEntry | null>(null);
  const [tree, setTree] = React.useState<SkillTreeView | null>(null);
  const [path, setPath] = React.useState("SKILL.md");
  const [panel, setPanel] = React.useState<"list" | "tree" | "editor">("list");
  const [creating, setCreating] = React.useState<NewSkill | null>(null);

  const reload = React.useCallback(async () => {
    setError(false);
    try {
      if (!projectId) { setLibrary(await api.listAllSkills()); return; }
      const rows = await api.listSkills(projectId);
      const project = rows.filter((s) => s.layer === "project");
      setLibrary({ global: rows.filter((s) => s.layer !== "project"), projects: [{ projectId, name: "Project ini", skills: project }] });
    } catch { setError(true); }
  }, [api, projectId]);
  React.useEffect(() => { void reload(); }, [reload]);

  const loadTree = React.useCallback((s: SkillEntry) => {
    setTree(null);
    api.skillTree(s.key).then(setTree).catch(() => setTree({ files: [], dirs: [] }));
  }, [api]);
  const select = (s: SkillEntry) => { setSkill(s); setPath("SKILL.md"); loadTree(s); setPanel("tree"); };

  const fork = async () => {
    if (!skill) return;
    try {
      const made = await api.forkSkill(skill.key, projectId ? { layer: "project", projectId } : { layer: "hanoman" });
      onToast?.(`Di-fork ke ${made.layer === "project" ? "project" : "global hanoman"}`);
      await reload(); select(made);
    } catch (e) { onToast?.((e as Error).message); }
  };
  const remove = async () => {
    if (!skill || !(await confirm({ title: `Hapus skill ${skill.name}?`, body: skill.dir, tone: "danger", confirmLabel: "Hapus" }))) return;
    try { await api.deleteSkill(skill.key); setSkill(null); setPanel("list"); await reload(); }
    catch (e) { onToast?.((e as Error).message); }
  };
  const create = async () => {
    if (!creating) return;
    try {
      const made = await api.createSkill({ ...creating, ...(creating.layer === "project" ? { projectId } : {}), source: creating.layer === "hanoman" ? undefined : creating.source });
      setCreating(null); await reload(); select(made);
    } catch (e) { onToast?.((e as Error).message); }
  };

  if (error) return <StateBlock kind="error" title="Gagal memuat skill" action={() => void reload()} actionLabel="Coba lagi" />;
  if (!library) return <StateBlock kind="loading" title="Memuat skill…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 0", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {skill?.editable && <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={remove}>Hapus skill</Button>}
        <Button size="sm" leftIcon="plus" onClick={() => setCreating({ layer: projectId ? "project" : "hanoman", source: ".claude", name: "", description: "" })}>Skill baru</Button>
      </div>
      <ResponsivePanels ariaLabel="Skills" active={panel} onActiveChange={(n) => setPanel(n as typeof panel)} masterWidth={300}
        panels={[
          { id: "list", label: "Skill", className: "hn-panel-flex", content: <SkillsList library={library} selected={skill?.key} onSelect={select} /> },
          { id: "tree", label: "Struktur", className: "hn-panel-flex", content: skill
              ? <SkillStructure skill={skill} tree={tree} selected={path} onSelect={(p) => { setPath(p); setPanel("editor"); }} onChanged={() => loadTree(skill)} onToast={onToast} />
              : <StateBlock kind="empty" compact icon="folder-tree" title="Pilih skill" /> },
          { id: "editor", label: "Editor", className: "hn-panel-flex", content: skill
              ? <SkillFileEditor skill={skill} path={path} onFork={fork} onToast={onToast} />
              : <StateBlock kind="empty" compact icon="file-text" title="Pilih skill untuk melihat isinya" /> },
        ]} />
      <Modal open={!!creating} title="Skill baru" onClose={() => setCreating(null)}
        footer={<Button onClick={create} disabled={!creating?.name || !creating?.description}>Buat</Button>}>
        {creating && (
          <>
            <Field label="Lapis">
              <select aria-label="Lapis" value={creating.layer} onChange={(e) => setCreating({ ...creating, layer: e.target.value as NewSkill["layer"] })}>
                <option value="hanoman">Global hanoman (disuntik ke semua sesi)</option>
                <option value="user">User (~/.claude, ~/.codex, ~/.agents)</option>
                {projectId && <option value="project">Project ini</option>}
              </select>
            </Field>
            {creating.layer !== "hanoman" && (
              <Field label="Sumber">
                <select aria-label="Sumber" value={creating.source} onChange={(e) => setCreating({ ...creating, source: e.target.value })}>
                  <option value=".claude">.claude (claude)</option>
                  <option value=".agents">.agents (codex)</option>
                  <option value=".codex">.codex (codex)</option>
                </select>
              </Field>
            )}
            <Field label="Nama" hint="kebab-case, maks 64"><Input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} mono /></Field>
            <Field label="Deskripsi" hint="diawali kapan skill dipakai, mis. “Use when …”"><Input value={creating.description} onChange={(e) => setCreating({ ...creating, description: e.target.value })} /></Field>
          </>
        )}
      </Modal>
    </div>
  );
}
```

Sesuaikan signature `useConfirm()` (baca `src/src/ds/useConfirm.tsx:30`) dan pakai `Select` dari `ds` alih-alih `<select>` bila ada (App.tsx mengimpor `Select` dari `./ds`).

- [x] **Step 5: Jalankan, pastikan lulus**

Run: `pnpm vitest --run src/src/screens/skills/SkillsWorkspace.test.tsx`
Expected: PASS. (Node 25 + jsdom localStorage: lihat memori bila test lain di file gagal karena localStorage.)

- [x] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/skills docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): SkillsWorkspace — daftar grup global/project, struktur, editor"
```

---

### Task 8: Navigasi `/skills`, `/skills/<projectId>`, pintu di halaman project

**Files:**
- Modify: `src/src/ds/shell.tsx:22-43` (item nav)
- Modify: `src/src/routes.ts` (rute `skills` ber-projectId)
- Modify: `src/src/routes.test.ts` (atau test rute yang ada: `grep -rln "parseRoute" src/src --include=*.test.ts`)
- Modify: `src/src/App.tsx` (render section `skills` dekat cabang `settings` ±baris 1736; prop pintu ProjectDetail ±baris 1558)
- Modify: `src/src/screens/ProjectDetailScreen.tsx:105-186` (prop `onGotoSkills` + `Door`)

**Interfaces:**
- Consumes: `SkillsWorkspace` (Task 7).
- Produces: `Route.projectId` terisi untuk section `skills` bila path `/skills/<id>`.

- [x] **Step 1: Tulis test rute yang gagal**

```ts
// tambahkan ke test parseRoute yang ada
it("skills: global dan per project, bolak-balik", () => {
  const keys = [...NAV_KEYS_FIXTURE, "skills"];   // pakai fixture nav keys yang sudah dipakai file test itu
  expect(parseRoute("/skills", keys)).toEqual({ section: "skills" });
  expect(parseRoute("/skills/p1", keys)).toEqual({ section: "skills", projectId: "p1" });
  expect(routePath({ section: "skills", projectId: "p 1" })).toBe("/skills/p%201");
  expect(routePath({ section: "skills" })).toBe("/skills");
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run src/src/routes.test.ts`
Expected: FAIL — `/skills/p1` → `null`.

- [x] **Step 3: Implementasi**

`src/src/routes.ts` — komentar bentuk URL tambah `//   /skills[/<projectId>]              skill global + per project, atau satu project`; di `routePath`:

```ts
    case "skills": return r.projectId ? `/skills/${seg(r.projectId)}` : "/skills";
```

di `parseRoute`, sebelum `return null` terakhir:

```ts
  if (head === "skills" && parts.length === 2) return { section: "skills", projectId: a };
```

`src/src/ds/shell.tsx` — sesudah item `ide`:

```ts
  // Skills library · skill global hanoman/user/plugin + skill per project dalam satu halaman.
  { key: "skills", label: "Skills", icon: "sparkles" },
```

`src/src/screens/ProjectDetailScreen.tsx` — tambah prop `onGotoSkills: () => void;` di tipe props dan destrukturisasi, lalu sesudah Door Changelog:

```tsx
        <Door icon="sparkles" title="Skills" hint="skill project & global warisan" onClick={onGotoSkills} />
```

`src/src/App.tsx` — di render ProjectDetailScreen (±baris 1558):

```tsx
              onGotoSkills={() => navigate(routePath({ section: "skills", projectId: proj.id }))}
```

(gunakan nama variabel project yang dipakai di situ; `proj` terlihat di baris 1712). Tambah cabang section sebelum `} else if (section === "settings") {`:

```tsx
  } else if (section === "skills") {
    const skillsProject = route?.projectId ? projects.find((p) => p.id === route.projectId) : undefined;
    screen = (
      <Shell active="skills" title="Skills" wide onNavigate={setSection}
        breadcrumb={skillsProject ? `skills · ${skillsProject.name}` : "skills · global & project"}
        actions={route?.projectId
          ? <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => goProject(route.projectId!)}>Kembali ke project</Button>
          : undefined}>
        {gate(<SkillsWorkspace key={route?.projectId ?? "all"} projectId={route?.projectId} onToast={showToast} />)}
      </Shell>
    );
```

Impor `SkillsWorkspace` dari `./screens/skills/SkillsWorkspace`. Cek nama `projects` state & helper `gate`/`suspend` yang dipakai cabang lain; pakai yang sama dengan cabang `settings`/`review`. Bila `projects` tak ada di scope, kirim `projectId` saja dan breadcrumb `skills · project`.

- [x] **Step 4: Jalankan test tersentuh**

Run: `pnpm vitest --run src/src/routes.test.ts src/src/screens/skills/SkillsWorkspace.test.tsx $(grep -rln "HN_NAV\|NAV_KEYS\|ProjectDetailScreen" src/src --include=*.test.tsx --include=*.test.ts | tr '\n' ' ')`
Expected: PASS (perbarui snapshot/daftar nav di test yang menghitung item nav bila ada).

- [x] **Step 5: Commit**

```bash
git add src/src/ds/shell.tsx src/src/routes.ts src/src/routes.test.ts src/src/App.tsx src/src/screens/ProjectDetailScreen.tsx docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "feat(skills): nav /skills, rute /skills/<projectId>, pintu Skills di halaman project"
```

---

### Task 9: Docs SoT + verifikasi nyata (boot + curl + render)

**Files:**
- Create: `internal/docs/adr/<NNNN>-skill-library-tiga-lapis-suntik-global.md` (NNNN = maks ADR di SEMUA branch + 1: `for b in $(git branch --format='%(refname:short)'); do git ls-tree --name-only "$b" internal/docs/adr/; done | grep -o '^[0-9]\{4\}' | sort -n | tail -1`)
- Create/Modify: berkas SPEC sesuai konvensi `internal/docs/README.md` (nomor SPEC dialokasikan server: buat backlog lewat `mcp__hanoman__hanoman_backlog_create` atau `POST /specs`, JANGAN menebak dari repo)
- Modify: `internal/docs/architecture/stack.md` (bagian skill/agen: tambah skill library + penyuntikan)
- Modify: `internal/skills/hanoman/SKILL.md` (sebut `/api/skills`, tool MCP baru, `$HANOMAN_HOME/skills`)
- Modify: `internal/docs/README.md` (tautkan ADR & SPEC baru)

- [x] **Step 1: Alokasikan SPEC & ADR, tulis ADR**

ADR memuat: Konteks (skill hanya terlihat sebagai prasyarat metode, ADR-0114; tak ada tampilan/penyuntingan; tak ada skill bersama lintas project); Keputusan (tiga lapis tanpa DB; key `layer~projectId~source~name`; plugin baca-saja + fork; project scan generik; capability `skills:*` menurut method; penyuntikan claude `--add-dir` — dikutip dari docs Claude Code; codex symlink + exclude common dir dengan marker dan `unexcludeInjected`; skill project menang atas global); Konsekuensi (skill global tak aktif di luar hanoman; baris exclude codex terlihat di checkout utama; tak ada watcher — refetch); Amandemen ADR-0114.

- [x] **Step 2: Perbarui stack.md, SKILL.md hanoman, README index** — satu paragraf/baris masing-masing, tautan relatif ke ADR/SPEC.

- [ ] **Step 3: Jalankan semua test tersentuh sekaligus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$(git merge-base HEAD main)" --no-file-parallelism`
Expected: PASS. Bandingkan kegagalan apa pun dengan base (memori "base merah") sebelum menyebutnya regresi.

- [ ] **Step 4: Boot server lokal & curl endpoint (DB & HANOMAN_HOME sekali-pakai)**

```bash
H=$(mktemp -d); export HANOMAN_HOME=$H HANOMAN_DATABASE_URL="file:$H/hanoman.db"
mkdir -p $H/skills/demo && printf -- '---\nname: demo\ndescription: Use when demo\n---\n# demo\n' > $H/skills/demo/SKILL.md
pnpm --filter @hanoman/server build && (node server/dist/server.js > $H/server.log 2>&1 &) ; sleep 5
PORT=$(grep -o 'listening on [^ ]*' $H/server.log | grep -o '[0-9]*$' | tail -1)
curl -s "http://127.0.0.1:${PORT:-8787}/api/skills?scope=all" | head -c 600; echo
curl -s "http://127.0.0.1:${PORT:-8787}/api/skills/$(node -e 'console.log(encodeURIComponent("hanoman~-~hanoman~demo"))')/tree"; echo
```

Expected: JSON `global` memuat `demo`; tree memuat `SKILL.md`. Bila auth memblokir (401), ikuti memori "Live smoke: DB khusus" / setup token lokal. Hentikan server dengan PID-nya sendiri (JANGAN `pkill -f` — memori SPEC-402).

- [ ] **Step 5: Render UI** — buka `/skills` dan `/skills/<projectId>` lewat CDP/Playwright (memori "Smoke browser lewat CDP"), pastikan section Global + per project tampil, pilih skill → struktur + editor, dan tampilan sempit (≤ 720 px) berpindah panel tanpa terpotong.

- [ ] **Step 6: Commit**

```bash
git add internal/docs/adr/<NNNN>-skill-library-tiga-lapis-suntik-global.md internal/docs/architecture/stack.md internal/skills/hanoman/SKILL.md internal/docs/README.md <berkas-SPEC> docs/superpowers/plans/2026-09-26-skills-library.md
git commit -m "docs(skills): ADR skill library tiga lapis + penyuntikan global, SPEC, stack, SKILL.md"
```
