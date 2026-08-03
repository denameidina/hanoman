import type { FastifyInstance } from "fastify";
import { zChangelogRequest, defaultRange, changelogMatches } from "@hanoman/shared";
import { prisma } from "../db";
import { resolveRepoDir } from "../services/local-binding";
import { paginate } from "../services/paginate";
import { downloadFormat, sendDocDownload } from "../services/doc-export";
import { listTags } from "../services/changelog/collect";
import { generateChangelog } from "../services/changelog/generate";

// SPEC-516 · ADR-0105 · changelog per project. Capability domain `docs` (agent-capabilities.ts).
//
// Keadaan SAH yang bukan galat — rentang kosong, repo belum ditautkan, repo tanpa tag, revisi tak
// dikenal — dijawab **422 + pesan**, tak pernah 500 (constraint eksplisit brief).

const view = (c: {
  id: string; projectId: string; mode: string; title: string; params: unknown; body: string;
  generator: string; warning: string | null; itemCount: number; createdAt: Date;
}) => ({
  id: c.id, projectId: c.projectId, mode: c.mode, title: c.title, params: c.params,
  body: c.body, generator: c.generator, warning: c.warning, itemCount: c.itemCount,
  createdAt: c.createdAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  // `sources` adalah segmen STATIS dan karena itu menang atas `:cid` di router radix Fastify —
  // tapi ia tetap didaftarkan lebih dulu supaya urutannya terbaca di berkas ini juga.
  app.get("/projects/:id/changelog/sources", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.project.findUnique({ where: { id } })) return reply.code(404).send({ error: "not found" });
    const { tags, head, reason } = await listTags(await resolveRepoDir(id));
    const done = await prisma.spec.findMany({
      where: { projectId: id, stage: "done", doneAt: { not: null } },
      select: { doneAt: true }, orderBy: { doneAt: "asc" },
    });
    return {
      hasRepo: reason === null || tags.length > 0,
      tags, head, reason,
      backlog: {
        doneCount: done.length,
        earliest: done[0]?.doneAt?.toISOString() ?? null,
        latest: done[done.length - 1]?.doneAt?.toISOString() ?? null,
      },
      defaultRange: defaultRange(new Date()),
    };
  });

  app.get("/projects/:id/changelog", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.project.findUnique({ where: { id } })) return reply.code(404).send({ error: "not found" });
    // SPEC-519 · `q` disaring di layer response SEBELUM `paginate` (ADR-0038) — kalau sesudah,
    // `total` menghitung seluruh baris dan Pager menjanjikan halaman yang isinya tak pernah ada.
    const { page, limit, q } = req.query as { page?: string; limit?: string; q?: string };
    const rows = await prisma.changelog.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
    return paginate(rows.filter((r) => changelogMatches(r, q ?? "")).map(view), page, limit);
  });

  app.get("/projects/:id/changelog/:cid", async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const row = await prisma.changelog.findFirst({ where: { id: cid, projectId: id } });
    if (!row) return reply.code(404).send({ error: "not found" });
    // SPEC-361 · ADR-0078 · unduh .md mentah / .pdf lewat helper yang sama dengan dokumen lain.
    const fmt = downloadFormat(req.query);
    if (fmt) return sendDocDownload(reply, fmt, {
      content: row.body, name: `${row.title}.md`, prefix: `${id}-changelog`,
      eyebrow: `hanoman · ${id} · changelog`, path: row.title,
    });
    return view(row);
  });

  app.post("/projects/:id/changelog", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.project.findUnique({ where: { id } })) return reply.code(404).send({ error: "not found" });
    const parsed = zChangelogRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const r = await generateChangelog(id, parsed.data);
    if (!r.ok) return reply.code(422).send({ error: r.reason });
    return reply.code(201).send(view(r.row));
  });

  app.delete("/projects/:id/changelog/:cid", async (req, reply) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const { count } = await prisma.changelog.deleteMany({ where: { id: cid, projectId: id } });
    return count ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
  });
}
