// server/src/services/bundled-skills.ts
// ADR-0233 · skill yang dibawa paket hanoman (`server/skills/<nama>` → `<pkg>/skills/<nama>`) di-seed ke
// lapis skill global `$HANOMAN_HOME/skills`, lalu `skill-inject.ts` menyuntiknya ke setiap sesi.
//
// Salinan ditandai `.hanoman-bundled.json` berisi sha isi bundel saat disalin. Upgrade hanya menimpa
// salinan yang isinya masih persis sha itu: begitu operator menyuntingnya (Skills library), salinan itu
// miliknya dan dibiarkan. Skill bernama sama tanpa marker juga milik operator.
// Fail-open: kegagalan apa pun jadi baris log; server tetap boot.
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hanomanSkillsDir } from "@hanoman/runner";
import { repoRoot } from "../runner/deps";

export const BUNDLED_MARKER = ".hanoman-bundled.json";

export interface SeedResult { seeded: string[]; updated: string[]; kept: string[] }

// Dua lokasi, terpaket lebih dulu — pola `scriptPath()` (vps-audit.ts). Di paket npm bundle hidup di
// <pkg>/dist/server.js dan skill di <pkg>/skills; di checkout URL ini menunjuk server/src/, jadi jatuh ke
// repoRoot() yang dijangkar ke direktori modul ini, bukan cwd.
const packagedDir = (): string => fileURLToPath(new URL("../skills", import.meta.url));
const moduleDir = (): string => fileURLToPath(new URL(".", import.meta.url));

export function bundledSkillsDir(): string {
  const packed = packagedDir();
  return existsSync(packed) ? packed : join(repoRoot(moduleDir()), "server", "skills");
}

const skillDirsIn = (source: string): string[] => {
  let names: string[];
  try { names = readdirSync(source); } catch { return []; }
  return names.filter((n) => !n.startsWith(".") && existsSync(join(source, n, "SKILL.md"))).sort();
};

export const bundledSkillNames = (): string[] => skillDirsIn(bundledSkillsDir());

export const isBundledCopy = (dir: string): boolean => existsSync(join(dir, BUNDLED_MARKER));

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      if (n === BUNDLED_MARKER || n === ".DS_Store") continue;
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** sha256 atas (path relatif, isi) setiap berkas skill, urut, tanpa marker. */
function contentSha(dir: string): string {
  const h = createHash("sha256");
  for (const f of filesUnder(dir)) {
    h.update(relative(dir, f).split(sep).join("/"));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

function markerSha(dir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, BUNDLED_MARKER), "utf8"));
    const sha = (parsed as { sha?: unknown })?.sha;
    return typeof sha === "string" ? sha : null;
  } catch { return null; }
}

// Salin ke direktori sementara di samping tujuan lalu tukar, supaya sesi yang sedang memuat skill tak
// pernah melihat direktori setengah tersalin.
function install(src: string, dest: string, sha: string): void {
  const tmp = `${dest}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(src, tmp, { recursive: true });
  // SKILL.md memanggil skrip langsung (`"$S" …`); bit eksekusi bisa hilang di jalur paket/arsip.
  for (const f of filesUnder(tmp))
    if (relative(tmp, f).split(sep)[0] === "scripts") chmodSync(f, statSync(f).mode | 0o755);
  writeFileSync(join(tmp, BUNDLED_MARKER), `${JSON.stringify({ sha, seededAt: new Date().toISOString() })}\n`);
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
}

export function seedBundledSkills(
  hanomanHome: string, o: { source?: string; log?: (m: string) => void } = {},
): SeedResult {
  const out: SeedResult = { seeded: [], updated: [], kept: [] };
  const source = o.source ?? bundledSkillsDir();
  const log = o.log ?? ((m: string) => console.warn(m));
  const names = skillDirsIn(source);
  if (!names.length) return out;
  const root = hanomanSkillsDir(hanomanHome);
  for (const name of names) {
    try {
      const src = join(source, name);
      const dest = join(root, name);
      const bundleSha = contentSha(src);
      if (!existsSync(dest)) {
        mkdirSync(root, { recursive: true });
        install(src, dest, bundleSha);
        out.seeded.push(name);
        continue;
      }
      const recorded = markerSha(dest);
      if (recorded === bundleSha) continue;
      if (recorded === null || contentSha(dest) !== recorded) {
        out.kept.push(name);
        log(`skill bundel ${name} tak diperbarui: salinan di ${dest} milik operator (tanpa marker atau sudah disunting)`);
        continue;
      }
      install(src, dest, bundleSha);
      out.updated.push(name);
    } catch (e) {
      log(`skill bundel ${name} gagal di-seed: ${(e as Error).message}`);
    }
  }
  return out;
}
