// ADR-0178 · siapa memanggil + dari repo mana → project yang SAH. Model tak pernah memilih project:
// cookie memilih lewat UI, agent token ditentukan identitas repo yang dihitung CLI MCP.
import { decodeRepoHeader } from "@hanoman/shared";
import { prisma } from "../../db";
import { resolveRepoDir } from "../local-binding";
import { getSessionAsync } from "../pty";
import { verifySessionEventToken } from "../session-event-token";
import { hasCommit, repoHead, rootCommits } from "./git";
import { normalizeRemote } from "./rules";

export type Principal =
  | { kind: "user"; userId: string }
  | { kind: "agent"; tokenId: string; projectIds: string[] | null };
export type MemoryScope = { projectId: string; repoDir: string | null; head: string | null; headVerified: boolean };
export type Fail = { ok: false; status: 400 | 401 | 403 | 404 | 409; body: Record<string, unknown> };
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

export type SessionPrincipal = { sessionId: string; runtime: "claude" | "codex"; trusted: boolean };
export type SessionResolveResult = { ok: true; scope: MemoryScope; session: SessionPrincipal } | Fail;

/** ADR-0179 · sesi yang menyentuh input eksternal (Help Center, tiket, issue GitHub) tak tepercaya. */
export async function sessionTrusted(specId?: string): Promise<boolean> {
  if (!specId) return true;   // sesi project-level (reverse/prd/breakdown) — input internal
  const spec = await prisma.spec.findUnique({ where: { id: specId }, select: { source: true } });
  if (spec?.source === "help") return false;
  if (await prisma.ticket.count({ where: { specId } })) return false;
  if (await prisma.githubIssue.count({ where: { specId } })) return false;
  return true;
}

const validSessionToken = (id: string, token: string): boolean => {
  try { return verifySessionEventToken(id, token); } catch { return false; }
};

/**
 * ADR-0179 · kredensial sesi → lingkup. `null` = tak ada header sesi sama sekali (jalur token/cookie).
 * Header setengah atau HMAC salah = 401, BUKAN jatuh diam-diam ke jalur lain: pemanggil yang
 * mengaku sebagai sesi tapi gagal membuktikannya tak boleh mendapat lingkup lain sebagai gantinya.
 */
export async function resolveSessionScope(h: { session?: unknown; token?: unknown }): Promise<SessionResolveResult | null> {
  if (h.session === undefined && h.token === undefined) return null;
  const id = typeof h.session === "string" ? h.session : "";
  const token = typeof h.token === "string" ? h.token : "";
  if (!id || !token || !validSessionToken(id, token)) return fail(401, "kredensial sesi tidak sah");
  const pane = await getSessionAsync(id);
  if (!pane || pane.exited) return fail(404, "sesi tidak hidup");
  const project = await prisma.project.findUnique({ where: { id: pane.projectId }, select: { id: true } });
  if (!project) return fail(400, "sesi ini tidak terikat ke project");
  const head = await repoHead(pane.cwd);
  return {
    ok: true,
    scope: { projectId: project.id, repoDir: pane.cwd, head, headVerified: head !== null },
    session: { sessionId: id, runtime: pane.agent === "codex" ? "codex" : "claude", trusted: await sessionTrusted(pane.specId) },
  };
}
