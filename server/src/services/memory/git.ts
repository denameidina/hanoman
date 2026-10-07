// ADR-0178 · git untuk verifikasi jangkar memori. ASYNC dengan sengaja: dipanggil di jalur request,
// dan `execFileSync` di sana memblokir event loop (SPEC-878). Setiap kegagalan → null/[]/false;
// pemanggil yang memutuskan arti "tak bisa memverifikasi".
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeRepoPath } from "./rules";

const run = promisify(execFile);
const SHA = /^[0-9a-f]{7,64}$/;

async function git(dir: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 5000 });
    return stdout.trim();
  } catch { return null; }
}

export const repoHead = (dir: string): Promise<string | null> => git(dir, ["rev-parse", "HEAD"]);

export async function rootCommits(dir: string): Promise<string[]> {
  const out = await git(dir, ["rev-list", "--max-parents=0", "HEAD"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

export async function hasCommit(dir: string, sha: string): Promise<boolean> {
  if (!SHA.test(sha)) return false;
  return (await git(dir, ["cat-file", "-e", `${sha}^{commit}`])) !== null;
}

/** Blob SHA berkas `path` pada `commit`; null bila path tak ada, bukan berkas, atau tak aman. */
export async function blobShaAt(dir: string, commit: string, path: string): Promise<string | null> {
  if (!SHA.test(commit) || !safeRepoPath(path)) return null;
  const spec = `${commit}:${path}`;
  if ((await git(dir, ["cat-file", "-t", spec])) !== "blob") return null;
  return git(dir, ["rev-parse", "--verify", "--quiet", spec]);
}

/** Seluruh berkas pada `commit` → blob SHA, SATU subproses (verifikasi massal saat sesi lahir). */
export async function treeBlobs(dir: string, commit: string): Promise<Map<string, string> | null> {
  if (!SHA.test(commit)) return null;
  try {
    const { stdout } = await run("git", ["-C", dir, "ls-tree", "-r", "-z", "--full-tree", commit],
      { encoding: "utf8", timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
    const out = new Map<string, string>();
    for (const rec of stdout.split("\0")) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(rec);
      if (m) out.set(m[2]!, m[1]!);
    }
    return out;
  } catch { return null; }
}
