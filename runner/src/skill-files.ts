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
