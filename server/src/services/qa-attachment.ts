// Workspace QA · lampiran per laporan/test case/temuan. Memakai ulang PIPELINE unggahan
// (`upload-pipeline.ts`: magic bytes, normalisasi gambar, pemindaian) seperti lampiran backlog
// (ADR-0124) — bukan salinan yang bisa berselisih. Kuota/limit-nya milik QA sendiri.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { QaAttachmentView, QaOwnerType } from "@hanoman/shared";
import { prisma } from "../db";
import { deleteUpload, readUpload } from "./uploads";
import { DOCUMENT_TYPES, UploadError, processDocumentUpload, processUpload, type SafeUpload } from "./upload-pipeline";
import { IMAGE_TYPES, attachmentExt, type RejectReason, type SpecUpload } from "./spec-attachment";
import { attachmentView } from "./qa";

export const QA_ATTACHMENT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  perReport: 30,
  reportBytes: 100 * 1024 * 1024,
} as const;

export type QaUpload = SpecUpload;
export type QaOwner = { ownerType: QaOwnerType; ownerId: string };

// Kode pemindai & kuota TIDAK diciutkan jadi "type" (alasan sama dengan lampiran backlog).
const reasonFor = (code: UploadError["code"]): RejectReason =>
  code === "UPLOAD_QUOTA" ? "quota" : code === "UPLOAD_SCAN" ? "scan" : "type";

export async function ownerExists(reportId: string, type: string, id: string): Promise<boolean> {
  if (type === "report") return id === reportId;
  if (type === "case") return !!(await prisma.qaCase.findFirst({ where: { id, reportId }, select: { id: true } }));
  if (type === "finding") return !!(await prisma.qaFinding.findFirst({ where: { id, reportId }, select: { id: true } }));
  return false;
}

export async function addQaAttachments(
  report: { id: string; projectId: string }, owner: QaOwner, files: QaUpload[],
): Promise<{ saved: QaAttachmentView[]; rejected: { filename: string; reason: RejectReason }[] }> {
  const existing = await prisma.qaAttachment.findMany({ where: { reportId: report.id }, select: { size: true } });
  let count = existing.length;
  let bytes = existing.reduce((n, a) => n + a.size, 0);

  const saved: QaAttachmentView[] = [];
  const rejected: { filename: string; reason: RejectReason }[] = [];
  for (const f of files) {
    const name = f.name || "lampiran";
    if (count >= QA_ATTACHMENT_LIMITS.perReport) { rejected.push({ filename: name, reason: "count" }); continue; }
    // `truncated` datang dari @fastify/multipart: berkas oversize tiba TERPOTONG, bukan sebagai error.
    if (f.truncated || f.buf.byteLength === 0 || f.buf.byteLength > QA_ATTACHMENT_LIMITS.fileBytes) {
      rejected.push({ filename: name, reason: "size" }); continue;
    }
    if (bytes + f.buf.byteLength > QA_ATTACHMENT_LIMITS.reportBytes) { rejected.push({ filename: name, reason: "quota" }); continue; }
    const ext = attachmentExt(name);
    let safe: SafeUpload;
    try {
      const image = IMAGE_TYPES[f.mime];
      if (image) {
        if (!image.includes(ext)) throw new UploadError("UPLOAD_TYPE", "extension mismatch");
        safe = await processUpload({ buffer: f.buf, clientName: name, clientMime: f.mime, projectId: report.projectId, parentBytes: bytes });
      } else if (DOCUMENT_TYPES[f.mime]) {
        safe = await processDocumentUpload({ buffer: f.buf, clientName: name, clientMime: f.mime, clientExt: ext });
      } else {
        throw new UploadError("UPLOAD_TYPE", "unsupported type");
      }
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      rejected.push({ filename: name, reason: reasonFor(error.code) });
      continue;
    }
    try {
      // sha256 dari byte TERSIMPAN (gambar sudah didekode-ulang), bukan byte kiriman: itulah kunci
      // dedup yang dipakai bagian 3 (sync lampiran).
      const sha256 = createHash("sha256").update(await readUpload(safe.storageKey)).digest("hex");
      const row = await prisma.qaAttachment.create({ data: {
        reportId: report.id, projectId: report.projectId, ownerType: owner.ownerType, ownerId: owner.ownerId,
        filename: safe.filename, mimeType: safe.mimeType, size: safe.size, sha256, storageKey: safe.storageKey,
      } });
      saved.push(attachmentView(row));
    } catch (error) {
      await deleteUpload(safe.storageKey);   // byte sudah mendarat; tanpa ini jadi yatim tanpa baris
      throw error;
    }
    count += 1;
    bytes += safe.size;
  }
  return { saved, rejected };
}

/** Hapus baris DAN byte. Cascade DB tak menyentuh disk, jadi pemanggil menghapus pemilik SESUDAH ini. */
export async function removeQaAttachments(where: Prisma.QaAttachmentWhereInput): Promise<number> {
  const rows = await prisma.qaAttachment.findMany({ where, select: { id: true, storageKey: true } });
  if (!rows.length) return 0;
  await prisma.qaAttachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  for (const r of rows) await deleteUpload(r.storageKey).catch(() => { /* sudah tak ada */ });
  return rows.length;
}
