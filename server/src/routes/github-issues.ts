import type { FastifyInstance } from "fastify";
import type { GithubIssue } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { pullIssues } from "../services/github-issues";
import { acceptGithubIssue } from "../services/github-accept";
import { notifySynced } from "../services/sync-notify";
import { paginate } from "../services/paginate";

// SPEC-471 · ADR-0095 · permukaan HTTP tarik & triase issue GitHub. Cermin routes/tickets.ts.
// hanoman TIDAK PERNAH menulis ke GitHub (keputusan 3): tak ada endpoint komentar/close.

const zPull = z.object({
  state: z.enum(["open", "all"]).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
}).default({});
const zAccept = z.object({
  priority: z.enum(["tinggi", "sedang", "rendah"]).optional(),
  source: z.enum(["qa", "brief", "audit"]).optional(),
}).default({});
const zAcceptMany = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  priority: z.enum(["tinggi", "sedang", "rendah"]).optional(),
  source: z.enum(["qa", "brief", "audit"]).optional(),
});

// Kegagalan resolusi/ambil dipetakan ke status yang membedakan "salah konfigurasi project"
// (400 — operator bisa memperbaikinya) dari "tak ada di GitHub" (404).
const STATUS: Record<string, number> = {
  "no-project": 404, "not-found": 404,
  "no-remote": 400, "not-github": 400, "issues-disabled": 400,
  unauthorized: 401, other: 502,
};

const view = (i: GithubIssue) => ({
  id: i.id, projectId: i.projectId, repoSlug: i.repoSlug, number: i.number,
  title: i.title, body: i.body, authorLogin: i.authorLogin,
  labels: Array.isArray(i.labels) ? (i.labels as string[]) : [],
  url: i.url, issueState: i.issueState, status: i.status, specId: i.specId,
  issueCreatedAt: i.issueCreatedAt.toISOString(),
  issueUpdatedAt: i.issueUpdatedAt.toISOString(),
  pulledAt: i.pulledAt.toISOString(),
});

export default async function githubIssues(app: FastifyInstance): Promise<void> {
  app.post("/projects/:id/github/pull", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zPull.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const r = await pullIssues(id, parsed.data);
    if (!r.ok) return reply.code(STATUS[r.kind] ?? 400).send({ error: r.error });
    return reply.code(200).send(r);
  });

  app.get("/projects/:id/github/issues", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status, page, limit } = req.query as Record<string, string | undefined>;
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: "not found" });
    const items = await prisma.githubIssue.findMany({
      where: { projectId: id, ...(status ? { status } : {}) },
      orderBy: [{ number: "desc" }],
    });
    // SPEC-523 · amplop Paginated. Cermin routes/tickets.ts; issue adalah baris mati tanpa overlay,
    // jadi memotong di layer response (paginate) memadai dan menjaga satu bentuk.
    return reply.send(paginate(items.map(view), page, limit));
  });

  // Massal DULU: Fastify mencocokkan segmen literal sebelum parameter, tapi menulisnya lebih
  // dulu membuat urutannya eksplisit bagi pembaca.
  app.post("/github-issues/accept", async (req, reply) => {
    const parsed = zAcceptMany.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { ids, priority, source } = parsed.data;
    const author = req.user?.email ?? "system";
    const created: unknown[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
      const issue = await prisma.githubIssue.findUnique({ where: { id } });
      if (!issue) { failed.push({ id, error: "not found" }); continue; }
      // Satu issue gagal tak menghentikan sisanya — cermin checkTriase.
      try { created.push((await acceptGithubIssue(issue, { author, priority, source })).spec); }
      catch (e) { failed.push({ id, error: (e as Error).message }); }
    }
    return reply.code(201).send({ created, failed });
  });

  app.post("/github-issues/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zAccept.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const issue = await prisma.githubIssue.findUnique({ where: { id } });
    if (!issue) return reply.code(404).send({ error: "not found" });
    const { spec, created } = await acceptGithubIssue(issue, {
      author: req.user?.email ?? "system", priority: parsed.data.priority, source: parsed.data.source });
    return reply.code(created ? 201 : 200).send(created ? { spec } : { spec, alreadyPromoted: true });
  });

  app.post("/github-issues/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const issue = await prisma.githubIssue.findUnique({ where: { id } });
    if (!issue) return reply.code(404).send({ error: "not found" });
    const row = await prisma.githubIssue.update({ where: { id }, data: { status: "rejected" } });
    await notifySynced("githubIssue", id);
    return reply.send({ id: row.id, status: row.status });
  });

  app.post("/github-issues/:id/unlink", async (req, reply) => {
    const { id } = req.params as { id: string };
    const issue = await prisma.githubIssue.findUnique({ where: { id } });
    if (!issue) return reply.code(404).send({ error: "not found" });
    const row = await prisma.githubIssue.update({ where: { id }, data: { status: "new", specId: null } });
    await notifySynced("githubIssue", id);
    return reply.send({ id: row.id, status: row.status, specId: row.specId });
  });
}
