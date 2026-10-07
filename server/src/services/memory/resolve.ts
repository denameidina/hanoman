// ADR-0178 · siapa memanggil + dari repo mana → project yang SAH. Model tak pernah memilih project:
// cookie memilih lewat UI, agent token ditentukan identitas repo yang dihitung CLI MCP.
import { decodeRepoHeader } from "@hanoman/shared";
import { prisma } from "../../db";
import { resolveRepoDir } from "../local-binding";
import { hasCommit, repoHead, rootCommits } from "./git";
import { normalizeRemote } from "./rules";

export type Principal =
  | { kind: "user"; userId: string }
  | { kind: "agent"; tokenId: string; projectIds: string[] | null };
export type MemoryScope = { projectId: string; repoDir: string | null; head: string | null; headVerified: boolean };
export type Fail = { ok: false; status: 400 | 403 | 404 | 409; body: Record<string, unknown> };
export type ResolveResult = { ok: true; scope: MemoryScope } | Fail;

const fail = (status: Fail["status"], error: string, extra: Record<string, unknown> = {}): Fail =>
  ({ ok: false, status, body: { error, ...extra } });

export async function resolveMemoryScope(
  p: Principal, input: { repoHeader?: unknown; projectId?: string },
): Promise<ResolveResult> {
  if (p.kind === "user") {
    if (!input.projectId) return fail(400, "projectId wajib");
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) return fail(404, "project tidak ditemukan");
    const repoDir = await resolveRepoDir(project.id);
    const head = repoDir ? await repoHead(repoDir) : null;
    return { ok: true, scope: { projectId: project.id, repoDir, head, headVerified: head !== null } };
  }

  if (input.projectId)
    return fail(400, "projectId tidak diterima dari agent token; project ditentukan dari identitas repo");
  if (!p.projectIds?.length)
    return fail(403, "agent token tanpa allowlist project", { need: "projectIds" });
  const repo = decodeRepoHeader(input.repoHeader);
  if (!repo) return fail(400, "header x-hanoman-repo wajib (diisi CLI MCP hanoman dari direktori kerja)");
  const want = normalizeRemote(repo.remote);
  if (!want) return fail(404, "remote repo tidak dikenali");

  const candidates = await prisma.project.findMany({ where: { gitRemote: { not: null } }, select: { id: true, gitRemote: true } });
  const matches = candidates.filter((c) => normalizeRemote(c.gitRemote!) === want).map((c) => c.id);
  if (!matches.length) return fail(404, "tidak ada project dengan remote ini");
  const allowed = matches.filter((id) => p.projectIds!.includes(id));
  if (!allowed.length) return fail(403, "project repo ini tidak diizinkan untuk token ini", { need: "projectIds" });
  if (allowed.length > 1) return fail(409, "remote cocok dengan lebih dari satu project", { candidates: allowed });

  const projectId = allowed[0]!;
  const repoDir = await resolveRepoDir(projectId);
  let headVerified = false;
  if (repoDir) {
    const roots = await rootCommits(repoDir);
    // Remote bisa disalin siapa saja; root commit tidak. Checkout yang ada adalah pembanding.
    if (roots.length && !roots.includes(repo.rootCommit)) return fail(404, "root commit tidak cocok dengan checkout project");
    headVerified = await hasCommit(repoDir, repo.head);
  }
  return { ok: true, scope: { projectId, repoDir, head: repo.head, headVerified } };
}
