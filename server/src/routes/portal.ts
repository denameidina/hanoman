// SPEC-617 · ADR-0110 · permukaan BACA-SAJA untuk akun klien. Sumber datanya sama persis dengan
// dashboard operator — `liveSpecs()` (stage live, ADR-0038) dan `prisma.ticket` — hanya
// proyeksinya yang sempit; tak ada pipeline data kedua. Gerbang read-only ada di app.ts
// (services/client-access.ts); berkas ini menegakkan SCOPE PROJECT.
import type { FastifyInstance } from "fastify";
import {
  toPortalProject, toPortalSpec, toPortalTicket, toPortalTicketDetail,
} from "@hanoman/shared";
import { prisma } from "../db";
import { liveSpecs } from "../services/live-specs";
import { paginate } from "../services/paginate";
import { clientProjectIds, hasProjectAccess } from "../services/client-access";

// Project yang tak ditugaskan dan project yang tak ada menjawab hal yang SAMA: menjawab beda
// membuat portal jadi alat enumerasi nama project (preseden Help Center, ADR-0062).
const NOT_FOUND = { error: "not found" };

/** Stage Spec tertaut untuk sekumpulan tiket — satu query, bukan N+1. */
async function specStages(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return new Map();
  const rows = await prisma.spec.findMany({ where: { id: { in: wanted } }, select: { id: true, stage: true } });
  return new Map(rows.map((r) => [r.id, r.stage]));
}

export default async function (app: FastifyInstance) {
  app.get("/portal/projects", async (req) => {
    const ids = await clientProjectIds(req.user!.id);
    const rows = await prisma.project.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
    return { items: rows.map(toPortalProject) };
  });

  app.get("/portal/projects/:id/backlog", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const { page, limit } = req.query as { page?: string; limit?: string };
    const specs = await liveSpecs({ project: id });
    return paginate(specs.map(toPortalSpec), page, limit);
  });

  app.get("/portal/projects/:id/backlog/:specId", async (req, reply) => {
    const { id, specId } = req.params as { id: string; specId: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    // Dibaca dari set live project itu, bukan findUnique: dengan begitu stage yang dilihat klien
    // sama dengan yang dilihat operator, dan spec milik project lain tak bisa ditarik lewat id.
    const spec = (await liveSpecs({ project: id })).find((s) => s.id === specId);
    if (!spec) return reply.code(404).send(NOT_FOUND);
    return toPortalSpec(spec);
  });

  app.get("/portal/projects/:id/tickets", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const { page, limit } = req.query as { page?: string; limit?: string };
    const rows = await prisma.ticket.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
    const stages = await specStages(rows.map((t) => t.specId));
    return paginate(rows.map((t) => toPortalTicket(t, stages.get(t.specId ?? "") ?? null)), page, limit);
  });

  app.get("/portal/projects/:id/tickets/:ticketId", async (req, reply) => {
    const { id, ticketId } = req.params as { id: string; ticketId: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
    // Tiket milik project lain dijawab 404 yang sama — id tiket tak boleh jadi jalan pintas
    // melewati scope project.
    if (!t || t.projectId !== id) return reply.code(404).send(NOT_FOUND);
    const stages = await specStages([t.specId]);
    return toPortalTicketDetail(t, stages.get(t.specId ?? "") ?? null);
  });
}
