import type { FastifyInstance } from "fastify";
import { QA_OWNER_TYPES, type QaOwnerType } from "@hanoman/shared";
import { prisma } from "../db";
import { QA_ATTACHMENT_LIMITS, addQaAttachments, ownerExists, removeQaAttachments, type QaUpload } from "../services/qa-attachment";
import { notifySynced } from "../services/sync-notify";
import { readUpload } from "../services/uploads";

// Workspace QA · lampiran. Capability `qa:*` dari prefix `/projects/:id/qa` (`capabilityForRoute`).
// Batas multipart dipasang PER-REQUEST (registrasi global milik lampiran gambar SPEC-816 tak boleh naik).
const INLINE = new Set(["image/png", "image/jpeg", "image/webp"]);

export default async function qaAttachments(app: FastifyInstance) {
  type Ids = { pid: string; rid: string; aid: string };

  app.post("/projects/:pid/qa/reports/:rid/attachments", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const report = await prisma.qaReport.findFirst({ where: { id: rid, projectId: pid }, select: { id: true, projectId: true, status: true } });
    if (!report) return reply.code(404).send({ error: "not found" });
    if (report.status === "closed") return reply.code(409).send({ error: "laporan sudah closed" });

    const q = req.query as { ownerType?: string; ownerId?: string };
    if (!(QA_OWNER_TYPES as readonly string[]).includes(q.ownerType ?? "") || !q.ownerId
      || !(await ownerExists(rid, q.ownerType!, q.ownerId)))
      return reply.code(400).send({ error: "ownerType/ownerId tak valid untuk laporan ini", ownerType: q.ownerType, ownerId: q.ownerId });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const files: QaUpload[] = [];
    try {
      for await (const part of (req as any).parts({
        limits: { fileSize: QA_ATTACHMENT_LIMITS.fileBytes, files: QA_ATTACHMENT_LIMITS.perReport + 2 },
      })) {
        if (part.type !== "file") continue;
        const buf = await part.toBuffer();   // menguras stream — tanpa ini busboy menggantung
        files.push({ buf, mime: part.mimetype, name: String(part.filename ?? "lampiran"), truncated: part.file?.truncated === true });
      }
    } catch { return reply.code(400).send({ error: "unggahan tak valid" }); }
    if (!files.length) return reply.code(400).send({ error: "tak ada berkas" });

    const result = await addQaAttachments(report, { ownerType: q.ownerType as QaOwnerType, ownerId: q.ownerId }, files);
    await prisma.qaReport.update({ where: { id: rid }, data: { updatedAt: new Date() } });
    await notifySynced("qaReport", rid);     // lampiran sendiri sudah diterbitkan per berkas di addQaAttachments
    return reply.code(201).send(result);
  });

  app.get("/projects/:pid/qa/reports/:rid/attachments/:aid", async (req, reply) => {
    const { pid, rid, aid } = req.params as Ids;
    const a = await prisma.qaAttachment.findFirst({ where: { id: aid, reportId: rid, projectId: pid } });
    if (!a) return reply.code(404).send({ error: "not found" });
    const buf = await readUpload(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    const forceDownload = (req.query as { download?: string }).download === "1";
    const inline = INLINE.has(a.mimeType) && !forceDownload;
    reply.header("content-type", a.mimeType);
    reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${a.filename.replace(/["\\\r\n]/g, "_")}"`);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    return reply.send(buf);
  });

  app.delete("/projects/:pid/qa/reports/:rid/attachments/:aid", async (req, reply) => {
    const { pid, rid, aid } = req.params as Ids;
    const report = await prisma.qaReport.findFirst({ where: { id: rid, projectId: pid }, select: { status: true } });
    if (!report || !(await prisma.qaAttachment.findFirst({ where: { id: aid, reportId: rid }, select: { id: true } })))
      return reply.code(404).send({ error: "not found" });
    if (report.status === "closed") return reply.code(409).send({ error: "laporan sudah closed" });
    await removeQaAttachments({ id: aid });
    await prisma.qaReport.update({ where: { id: rid }, data: { updatedAt: new Date() } });
    await notifySynced("qaReport", rid);
    return { ok: true };
  });
}
