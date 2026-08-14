// SPEC-253 · ADR-0062 · antrean triase (di belakang gate cookie). Query selalu ber-scope projectId
// (isolasi antar-project). Accept = jembatan ke Spec (source help) — cermin errors/escalate.
import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { paginate } from "../services/paginate";
import { notifySynced } from "../services/sync-notify";
import { readUploadOrFetch, deleteUpload } from "../services/uploads";
import { generateShareToken } from "../services/ticket";
import { acceptTicket } from "../services/ticket-accept";
import { zTicketEditInput } from "@hanoman/shared";
import type { Ticket } from "@prisma/client";
import { launchPrincipal } from "../services/launch-authority";

const view = (t: Ticket & { _count?: { attachments: number } }) => ({
  id: t.id, projectId: t.projectId, number: t.number, category: t.category, title: t.title,
  reporterEmail: t.reporterEmail, status: t.status, specId: t.specId,
  attachmentCount: t._count?.attachments ?? 0, createdAt: t.createdAt.toISOString(),
});

export default async function (app: FastifyInstance) {
  app.get("/tickets", async (req) => {
    const { project, status, q, page, limit } = req.query as Record<string, string | undefined>;
    const where: { projectId?: string; status?: string } = {};
    if (project) where.projectId = project;
    if (status) where.status = status;
    let rows = await prisma.ticket.findMany({
      where, orderBy: { createdAt: "desc" }, include: { _count: { select: { attachments: true } } },
    });
    if (q) {
      const n = q.toLowerCase();
      rows = rows.filter((t) => `${t.title} ${t.reporterEmail}`.toLowerCase().includes(n));
    }
    const unreviewed = rows.filter((t) => t.status === "new").length;
    return { ...paginate(rows.map(view), page, limit), unreviewed };
  });

  app.get("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({
      where: { id }, include: { attachments: true, _count: { select: { attachments: true } } },
    });
    if (!t) return reply.code(404).send({ error: "not found" });
    const spec = t.specId ? await prisma.spec.findUnique({ where: { id: t.specId } }) : null;
    // SPEC-293 · backfill shareToken untuk tiket lama (idempoten, tanpa notifySynced → tak
    // menambah noise feed sync). Tiket baru sudah punya token sejak createTicket.
    let shareToken = t.shareToken;
    if (!shareToken) {
      shareToken = generateShareToken();
      await prisma.ticket.update({ where: { id }, data: { shareToken } });
    }
    const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    const publicStatusUrl = `${base}/help/${encodeURIComponent(t.projectId)}/status/${shareToken}`;
    return {
      ...view(t), detail: t.detail,
      attachments: t.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
      spec, publicStatusUrl,
    };
  });

  // Sajikan berkas lampiran (ber-auth, di belakang gate). 404 bila att bukan milik tiket.
  app.get("/tickets/:id/attachments/:attId", async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const a = await prisma.ticketAttachment.findUnique({ where: { id: attId } });
    if (!a || a.ticketId !== id) return reply.code(404).send({ error: "not found" });
    const buf = await readUploadOrFetch(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", a.mimeType);
    reply.header("content-disposition", `attachment; filename="${a.filename.replace(/["\\\r\n]/g, "_")}"`);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    return reply.send(buf);
  });

  // SPEC-253/291/297 · ADR-0062 · Terima → Spec (inti di services/ticket-accept.ts, dipakai ulang
  // scheduler source-checker triase). Idempoten via ticket.specId (cermin escalate errors).
  app.post("/tickets/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id }, include: { attachments: true } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const priority = (req.body as { priority?: string } | undefined)?.priority ?? "sedang";
    const { spec, created } = await acceptTicket(t, {
      author: req.user?.email ?? "system", priority, launchApprovedBy: launchPrincipal(req),
    });
    return created
      ? reply.code(201).send({ spec })
      : reply.code(200).send({ alreadyPromoted: true, spec });
  });

  // SPEC-271 · lepas tautan tiket dari backlog (kebalikan accept). Non-destruktif: Spec
  // dibiarkan (bisa dihapus manual). Reset status→"new" agar tiket bisa diterima lagi. Idempoten.
  app.post("/tickets/:id/unlink", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({ where: { id }, data: { status: "new", specId: null } });
    await notifySynced("ticket", id); // SPEC-268 · perubahan status tiket ke feed
    return { id: updated.id, status: updated.status, specId: updated.specId };
  });

  // Tolak → tutup tiket tanpa Spec, tanpa memengaruhi backlog.
  app.post("/tickets/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({ where: { id }, data: { status: "rejected" } });
    await notifySynced("ticket", id); // SPEC-268 · perubahan status tiket ke feed
    return { id: updated.id, status: updated.status };
  });

  // SPEC-269 · edit isi tiket (triase). Field opsional; minimal satu (divalidasi zod).
  app.patch("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zTicketEditInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: "not found" });
    const updated = await prisma.ticket.update({
      where: { id }, data: parsed.data,
      include: { attachments: true, _count: { select: { attachments: true } } },
    });
    const spec = updated.specId ? await prisma.spec.findUnique({ where: { id: updated.specId } }) : null;
    return {
      ...view(updated), detail: updated.detail,
      attachments: updated.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
      spec,
    };
  });

  // SPEC-269 · hapus tiket + lampiran (rows cascade; file fisik dibersihkan best-effort).
  app.delete("/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.ticket.findUnique({ where: { id }, include: { attachments: true } });
    if (!t) return reply.code(404).send({ error: "not found" });
    for (const a of t.attachments) await deleteUpload(a.storageKey);
    await prisma.ticket.delete({ where: { id } });
    return { ok: true };
  });
}
