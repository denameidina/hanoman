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
