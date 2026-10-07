import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { deleteSynced } from "../services/sync-delete";
import {
  MEMORY_STATUSES, REPO_HEADER, SESSION_HEADER, SESSION_TOKEN_HEADER, zMemoryInvalidate, zMemoryPropose, zMemoryReverify, zMemoryReview,
} from "@hanoman/shared";
import { resolveMemoryScope, resolveSessionScope, type MemoryScope, type Principal } from "../services/memory/resolve";
import {
  getMemory, invalidateMemory, proposeMemory, reverifyMemory, reviewMemory, searchMemories, supersedeMemory,
  type Actor,
} from "../services/memory/store";

// ADR-0178 · memori project bersama. Project TAK PERNAH dibaca dari input agen: cookie memilih
// lewat `projectId`, agent token lewat header identitas repo yang diisi CLI MCP.
const zSearch = z.object({
  q: z.string().max(200).optional(),
  paths: z.string().max(2000).optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
  projectId: z.string().optional(),
});
const zWithProject = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => s.extend({ projectId: z.string().optional() });

function principalOf(req: FastifyRequest): Principal | null {
  if (req.user) return { kind: "user", userId: req.user.id };
  if (req.agent) return { kind: "agent", tokenId: req.agent.id, projectIds: req.agent.projectIds };
  return null;
}
const actorOf = (p: Principal): Actor => (p.kind === "user" ? { kind: "user", id: p.userId } : { kind: "token", id: p.tokenId });

async function scopeOr(req: FastifyRequest, reply: FastifyReply, projectId?: string):
  Promise<{ scope: MemoryScope; actor: Actor } | null> {
  const principal = principalOf(req);
  if (!principal) { reply.code(401).send({ error: "unauthorized" }); return null; }
  // ADR-0179 · kredensial sesi menang atas header repo dan allowlist token (keputusan B).
  const ses = await resolveSessionScope({ session: req.headers[SESSION_HEADER], token: req.headers[SESSION_TOKEN_HEADER] });
  if (ses && !ses.ok) { reply.code(ses.status).send(ses.body); return null; }
  if (ses?.ok) {
    if (projectId) { reply.code(400).send({ error: "projectId tidak diterima dari sesi; project ditentukan oleh sesi" }); return null; }
    return { scope: ses.scope, actor: { kind: "session", id: ses.session.sessionId, runtime: ses.session.runtime,
      trusted: ses.session.trusted, tokenId: req.agent?.id ?? null } };
  }
  const r = await resolveMemoryScope(principal, { repoHeader: req.headers[REPO_HEADER], projectId });
  if (!r.ok) { reply.code(r.status).send(r.body); return null; }
  return { scope: r.scope, actor: actorOf(principal) };
}

const send = (reply: FastifyReply, r: { ok: true } | { ok: false; status: number; body: unknown }, okCode: number, body: () => unknown) =>
  r.ok ? reply.code(okCode).send(body()) : reply.code(r.status).send(r.body);

export default async function (app: FastifyInstance) {
  app.get("/memories", async (req, reply) => {
    const q = zSearch.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const s = await scopeOr(req, reply, q.data.projectId);
    if (!s) return;
    const paths = q.data.paths?.split(",").map((p) => p.trim()).filter(Boolean);
    return searchMemories(s.scope.projectId, { q: q.data.q, paths, status: q.data.status });
  });

  app.get("/memories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await scopeOr(req, reply, (req.query as { projectId?: string }).projectId);
    if (!s) return;
    const r = await getMemory(s.scope.projectId, id);
    return send(reply, r, 200, () => r.ok && { memory: r.memory, events: r.events });
  });

  app.post("/memories", async (req, reply) => {
    const p = zWithProject(zMemoryPropose).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { projectId, ...input } = p.data;
    const s = await scopeOr(req, reply, projectId);
    if (!s) return;
    const r = await proposeMemory(s.scope, s.actor, input);
    return send(reply, r, 201, () => r.ok && { memory: r.memory });
  });

  app.post("/memories/:id/supersede", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zWithProject(zMemoryPropose).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { projectId, ...input } = p.data;
    const s = await scopeOr(req, reply, projectId);
    if (!s) return;
    const r = await supersedeMemory(s.scope, s.actor, id, input);
    return send(reply, r, 201, () => r.ok && { memory: r.memory });
  });

  app.post("/memories/:id/reverify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zWithProject(zMemoryReverify).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const s = await scopeOr(req, reply, p.data.projectId);
    if (!s) return;
    const r = await reverifyMemory(s.scope, s.actor, id, p.data.anchors);
    return send(reply, r, 201, () => r.ok && { memory: r.memory });
  });

  app.post("/memories/:id/invalidate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zWithProject(zMemoryInvalidate).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const s = await scopeOr(req, reply, p.data.projectId);
    if (!s) return;
    const r = await invalidateMemory(s.scope, s.actor, id, p.data.reason);
    return send(reply, r, 200, () => r.ok && { memory: r.memory });
  });

  // Review manusia. Gate global sudah menolak agent token (COOKIE_ONLY); cek `req.user` di sini
  // adalah lapis kedua bila urutan gate kelak berubah. Dua route literal (bukan loop) supaya
  // inventaris route `mcp-coverage.test.ts` membacanya — ia hanya menangkap `app.post("<literal>")`.
  const review = (decision: "activate" | "reject") => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(403).send({ error: "cookie session required" });
    const { id } = req.params as { id: string };
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) return reply.code(400).send({ error: "projectId wajib" });
    const p = zMemoryReview.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const r = await reviewMemory(projectId, req.user.id, id, decision, p.data.reason);
    return send(reply, r, 200, () => r.ok && { memory: r.memory });
  };
  app.post("/memories/:id/activate", review("activate"));
  app.post("/memories/:id/reject", review("reject"));

  // ADR-0180 · hapus permanen (mis. memori berisi secret yang lolos). Manusia saja; tombstone menang
  // tanpa syarat di semua mesin, event ikut cascade.
  app.delete("/memories/:id", async (req, reply) => {
    if (!req.user) return reply.code(403).send({ error: "cookie session required" });
    const { id } = req.params as { id: string };
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) return reply.code(400).send({ error: "projectId wajib" });
    const m = await prisma.projectMemory.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!m) return reply.code(404).send({ error: "memori tidak ditemukan" });
    await deleteSynced("projectMemory", id);
    return reply.code(204).send();
  });
}
