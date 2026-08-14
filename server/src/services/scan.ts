import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { coverageOf, linkedSetFrom, zHanomanConfig } from "@hanoman/shared";
import { assertSafeRepoPathSync, readRepoFileSync, writeRepoFileAtomicSync } from "./safe-repo-path";

const exec = promisify(execFile);

export type DocCat = { cat: string; files: string[]; linked: boolean; root: boolean; scored: boolean };

// All markdown in the repo — tracked or new — with .gitignore honored (skips
// node_modules/.worktrees/dist for free). Posix rel paths.
//
// execFile, not spawnSync: GET /projects scans once per project, and a blocking
// fork would stall the whole server. Not a git repo -> reject -> [].
export async function listRepoDocs(repoDir: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
      { cwd: repoDir, maxBuffer: 1 << 24 });   // default 1 MB ~ 10k path
    return [...new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
  } catch { return []; }
}

// ponytail: 3 baris; angkat ke adapter node bersama kalau muncul consumer ketiga.
// Barrel shared harus bebas node:*, jadi loadConfig tak bisa tinggal di sana.
function docsDirOf(repoDir: string): string {
  try {
    const raw = readRepoFileSync(repoDir, "hanoman.config.json").toString("utf8");
    return zHanomanConfig.parse(JSON.parse(raw)).docsDir;
  } catch { return zHanomanConfig.parse({}).docsDir; }
}

// Index SoT = docsDir/README.md. Root README.md repo adalah entrypoint, bukan index.
export function resolveIndex(repoDir: string, docsDir: string): string {
  const rel = `${docsDir}/README.md`;
  return existsSync(resolve(repoDir, rel)) ? rel : "";
}

const catOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".");
const nameOf = (rel: string) => (rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel);

// ponytail: full re-scan tiap panggilan, tanpa cache. Terukur 19 ms — spawn git 18.8 ms,
// baca 48 file 0.8 ms — jadi HANYA spawn-nya yang dibuat async. `readFileSync` tetap sync
// karena `linkedSetFrom` menerima `read` sinkron dan harus tetap pure di @hanoman/shared.
// Tambah cache HEAD/mtime hanya kalau GET /projects melewati ~200 ms.
//
// Dua korpus, sengaja dipisah: `files` untuk dibrowse (semua .md repo), `corpus`
// untuk dinilai (di bawah docsDir). Kategori di luar docsDir -> scored:false.
export async function scanRepoDocs(repoDir: string | null): Promise<{ coverage: number; tree: DocCat[] }> {
  if (!repoDir || !existsSync(repoDir)) return { coverage: 0, tree: [] };
  const files = await listRepoDocs(repoDir);
  const docsDir = docsDirOf(repoDir);
  const index = resolveIndex(repoDir, docsDir);
  const read = (rel: string): string | null => {
    try { return readRepoFileSync(repoDir, rel).toString("utf8"); } catch { return null; }
  };
  // README sub-index ikut korpus BFS; hanya index root yang dikeluarkan dari denominator.
  const corpus = files.filter((f) => f.startsWith(docsDir + "/"));
  const inDocs = new Set(corpus);
  const linked = index ? linkedSetFrom(index, corpus, read) : new Set<string>();
  const byCat = new Map<string, DocCat>();
  for (const f of files) {
    const cat = catOf(f);
    const c = byCat.get(cat) ?? { cat, files: [], linked: true, root: cat === ".", scored: inDocs.has(f) };
    c.files.push(nameOf(f));
    c.linked = c.linked && linked.has(f);
    byCat.set(cat, c);
  }
  const scored = corpus.filter((f) => f !== index);
  const coverage = coverageOf(scored.map((f) => ({ category: catOf(f), linked: linked.has(f) })));
  return { coverage, tree: [...byCat.values()] };
}

// Guarded absolute path for a repo-relative doc. `cat + "/" + name` from the tree
// round-trips straight to `rel`, so no prefix juggling.
export function docAbsPath(repoDir: string, rel: string): string {
  assertDocRel(rel);
  return assertSafeRepoPathSync(repoDir, rel);
}

function assertDocRel(rel: string): void {
  if (!rel.endsWith(".md")) throw new Error("hanya file .md yang diizinkan");
  if (rel.split("/").includes(".git")) throw new Error("tidak boleh menyentuh .git");
}

export function readDocFile(repoDir: string, rel: string): string | null {
  try { assertDocRel(rel); return readRepoFileSync(repoDir, rel).toString("utf8"); } catch { return null; }
}
export function writeDocFile(repoDir: string, rel: string, content: string): void {
  assertDocRel(rel);
  writeRepoFileAtomicSync(repoDir, rel, content);
}
export function deleteDocFile(repoDir: string, rel: string): boolean {
  const abs = docAbsPath(repoDir, rel);
  if (!existsSync(abs)) return false;
  rmSync(abs);
  return true;
}
