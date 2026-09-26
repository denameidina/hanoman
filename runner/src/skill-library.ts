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
