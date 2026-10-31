// server/src/services/spec-mockups.ts
// ADR-0233 · mockup UI backlog. Fase Mockup menulis `docs/mockups/<spec-id>/<NN>-<slug>.png` di worktree
// sesi dan meng-commit-nya; dashboard membacanya dari sana selama sesi hidup, lalu dari checkout project
// sesudah worktree dibersihkan. Tak ada salinan di server: berkas di git adalah satu-satunya sumber.
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import type { SpecMockups } from "@hanoman/shared";
import { resolveRepoDir } from "./local-binding";
import { worktreeDir } from "./spec-review";

export const MOCKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/i;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

type SpecRef = { id: string; projectId: string };

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };

export async function resolveMockupDir(spec: SpecRef): Promise<{ source: "worktree" | "repo"; dir: string } | null> {
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) return null;
  const rel = join("docs", "mockups", spec.id.toLowerCase());
  const worktree = join(worktreeDir(repoDir, spec.id), rel);
  if (isDir(worktree)) return { source: "worktree", dir: worktree };
  const repo = join(repoDir, rel);
  return isDir(repo) ? { source: "repo", dir: repo } : null;
}

export async function listMockups(spec: SpecRef): Promise<SpecMockups> {
  const found = await resolveMockupDir(spec);
  if (!found) return { source: null, dir: null, items: [] };
  const items = readdirSync(found.dir).filter((n) => MOCKUP_NAME.test(n)).sort().flatMap((name) => {
    try {
      const st = statSync(join(found.dir, name));
      return st.isFile() ? [{ name, size: st.size, modifiedAt: st.mtime.toISOString() }] : [];
    } catch { return []; }
  });
  return { source: found.source, dir: found.dir, items };
}

/** `null` untuk SETIAP penolakan (nama, traversal, symlink keluar, bukan berkas) — pemanggil menjawab 404. */
export async function readMockup(spec: SpecRef, name: string): Promise<{ buf: Buffer; mime: string } | null> {
  if (!MOCKUP_NAME.test(name)) return null;
  const found = await resolveMockupDir(spec);
  if (!found) return null;
  const file = join(found.dir, name);
  if (!existsSync(file)) return null;
  try {
    const root = realpathSync(found.dir);
    const real = realpathSync(file);
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) return null;
    return { buf: await readFile(real), mime: MIME[extname(real).toLowerCase()] ?? "application/octet-stream" };
  } catch { return null; }
}
