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
