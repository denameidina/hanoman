// ADR-0178 · identitas repo untuk tool memori, dihitung PROSES MCP dari cwd-nya — bukan oleh model.
// Model tak pernah melihat field ini di inputSchema; ia ikut sebagai header `x-hanoman-repo` dan
// sebagai blobSha jangkar yang menimpa apa pun yang dikirim model.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoIdentity } from "@hanoman/shared";

const run = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string | null> {
  try { return (await run("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000 })).stdout.trim(); }
  catch { return null; }
}

export type RepoContext = { root: string; identity: RepoIdentity };

export async function readRepoContext(cwd: string): Promise<RepoContext | null> {
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const [remote, roots, head] = await Promise.all([
    git(root, ["remote", "get-url", "origin"]),
    git(root, ["rev-list", "--max-parents=0", "HEAD"]),
    git(root, ["rev-parse", "HEAD"]),
  ]);
  // Repo dengan beberapa root commit (hasil merge histori lain): ambil yang terurut pertama agar
  // deterministik; server menerima selama ia termasuk himpunan root checkout-nya.
  const rootCommit = roots?.split("\n").filter(Boolean).sort()[0];
  if (!remote || !rootCommit || !head) return null;
  return { root, identity: { remote, rootCommit, head } };
}

export async function enrichAnchors(ctx: RepoContext, body: unknown):
  Promise<{ ok: true; body: unknown } | { ok: false; missing: string[] }> {
  const b = body as { anchors?: { path: string; lines?: [number, number] }[] } | null;
  if (!b || !Array.isArray(b.anchors)) return { ok: true, body };
  const missing: string[] = [];
  const anchors = [];
  for (const a of b.anchors) {
    const spec = `${ctx.identity.head}:${a.path}`;
    const type = await git(ctx.root, ["cat-file", "-t", spec]);
    const sha = type === "blob" ? await git(ctx.root, ["rev-parse", "--verify", "--quiet", spec]) : null;
    if (!sha) { missing.push(a.path); continue; }
    anchors.push({ path: a.path, ...(a.lines ? { lines: a.lines } : {}), blobSha: sha });
  }
  return missing.length ? { ok: false, missing } : { ok: true, body: { ...b, anchors } };
}
