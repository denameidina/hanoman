// server/src/services/skill-inject.ts
// Skills library · menyuntik skill global hanoman ($HANOMAN_HOME/skills) ke satu sesi agen.
//
// claude: `--add-dir <tmp>/skills-root` yang memuat `.claude/skills/<n>` → symlink. Docs Claude
//   Code: skill di `.claude/skills/` direktori --add-dir dimuat, dengan live reload. Worktree
//   tak disentuh.
// codex/antigravity: symlink `<cwd>/.agents/skills/<n>` + baris exclude.
//   `info/exclude` tinggal di COMMON dir git (dipakai semua worktree + checkout utama), maka
//   barisnya ditandai dan dicabut `unexcludeInjected` saat skill project bernama sama dibuat.
// Fail-open: setiap kegagalan jadi peringatan; sesi tak pernah gagal lahir karenanya.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { scanGlobalSkills, scanProjectSkills } from "@hanoman/runner";

export const INJECT_MARKER = "# hanoman:skill-inject";
export interface InjectResult { addDir?: string; injected: string[]; warnings: string[] }

const excludeLine = (name: string) => `/.agents/skills/${name}`;

function excludeFile(repoDir: string): string {
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repoDir, encoding: "utf8" }).trim();
  return join(isAbsolute(common) ? common : join(repoDir, common), "info", "exclude");
}

interface OwnedSkill { link: string; target: string; exclude: string; pair: string; ino: number; dev: number }
const manifestPath = (tempDir: string) => join(tempDir, "antigravity-skills.json");
function ownedSkills(tempDir: string): OwnedSkill[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(tempDir), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((row): row is OwnedSkill => row && typeof row.link === "string"
      && typeof row.target === "string" && typeof row.exclude === "string" && typeof row.pair === "string"
      && typeof row.ino === "number" && typeof row.dev === "number") : [];
  } catch { return []; }
}

export function cleanupInjectedSkills(tempDir: string): void {
  for (const own of ownedSkills(tempDir)) {
    try {
      const st = lstatSync(own.link);
      if (!st.isSymbolicLink() || st.ino !== own.ino || st.dev !== own.dev || readlinkSync(own.link) !== own.target) continue;
      unlinkSync(own.link);
      if (own.pair) {
        const bytes = readFileSync(own.exclude, "utf8");
        if (bytes.includes(own.pair)) writeFileSync(own.exclude, bytes.replace(own.pair, ""));
      }
    } catch { /* operator changes or missing files are preserved */ }
  }
}

export function injectGlobalSkills(o: { agent: "claude" | "codex" | "antigravity"; cwd: string; tempDir: string; hanomanHome: string }): InjectResult {
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
  catch { out.warnings.push(`skill global tak disuntik (${o.agent}): cwd bukan repo git`); return out; }
  for (const s of todo) {
    let ownedLink: string | undefined;
    let ownedPair = "";
    try {
      const link = join(o.cwd, ".agents", "skills", s.name);
      if (o.agent === "antigravity") {
        for (const dir of [join(o.cwd, ".agents"), join(o.cwd, ".agents", "skills")]) {
          const st = lstatSync(dir, { throwIfNoEntry: false });
          if (st && (!st.isDirectory() || st.isSymbolicLink())) throw new Error("akar skill bukan direktori aman");
        }
      }
      if (lstatSync(link, { throwIfNoEntry: false })) continue;
      mkdirSync(join(o.cwd, ".agents", "skills"), { recursive: true });
      symlinkSync(s.dir, link);
      ownedLink = link;
      mkdirSync(join(exclude, ".."), { recursive: true });
      const cur = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
      const line = excludeLine(s.name);
      const lines = cur.split("\n");
      // info/exclude is shared by worktrees: each owned link needs its own removable pair.
      const hasOperatorLine = lines.some((entry, index) => entry === line
        && !lines[index - 1]?.startsWith(`${INJECT_MARKER}:antigravity:`));
      if (o.agent === "antigravity" ? !hasOperatorLine : !lines.includes(line)) {
        if (o.agent === "antigravity") {
          const hash = createHash("sha256").update(`${link}\0${s.dir}`).digest("hex");
          ownedPair = `${INJECT_MARKER}:antigravity:${hash}\n${line}\n`;
          appendFileSync(exclude, `${cur && !cur.endsWith("\n") ? "\n" : ""}${ownedPair}`);
        } else {
          const head = cur.includes(INJECT_MARKER) ? "" : `${cur && !cur.endsWith("\n") ? "\n" : ""}${INJECT_MARKER}\n`;
          appendFileSync(exclude, `${head}${line}\n`);
        }
      }
      if (o.agent === "antigravity") {
        mkdirSync(o.tempDir, { recursive: true, mode: 0o700 });
        const st = lstatSync(link);
        writeFileSync(manifestPath(o.tempDir), JSON.stringify([...ownedSkills(o.tempDir), { link, target: s.dir, exclude, pair: ownedPair, ino: st.ino, dev: st.dev }]), { mode: 0o600 });
      }
      out.injected.push(s.name);
    } catch (e) {
      if (o.agent === "antigravity" && ownedLink) {
        try { if (readlinkSync(ownedLink) === s.dir) unlinkSync(ownedLink); } catch { /* cleanup best effort */ }
        try { if (ownedPair) writeFileSync(exclude, readFileSync(exclude, "utf8").replace(ownedPair, "")); } catch { /* cleanup best effort */ }
      }
      out.warnings.push(`skill ${s.name} tak disuntik (${o.agent}): ${(e as Error).message}`);
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
