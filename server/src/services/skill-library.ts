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
