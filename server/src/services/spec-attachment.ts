// SPEC-843 · ADR-0124 · lampiran per backlog item. Domain-nya di sini; route tinggal tipis.
//
// Sengaja TIDAK memakai ulang jalur lampiran tiket: tiket adalah pintu publik dengan aturan sync dan
// tingkat kepercayaan yang berbeda (ADR-0124 §1). Yang dipakai ulang adalah PIPELINE unggahnya
// (`upload-pipeline.ts`) — gerbang magic bytes, normalisasi gambar, karantina, dan pemindaian
// malware yang sama, bukan salinan yang bisa berselisih.
import { extname } from "node:path";
import { prisma } from "../db";
import { deleteUpload } from "./uploads";
import {
  DOCUMENT_TYPES, UploadError, processDocumentUpload, processUpload, type SafeUpload,
} from "./upload-pipeline";

export const SPEC_ATTACHMENT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  perSpec: 10,
  specBytes: 40 * 1024 * 1024,
} as const;

// Gambar dipisah dari `DOCUMENT_TYPES` karena perlakuannya berbeda: ia didekode & di-encode ulang
// `sharp` (membuang metadata dan payload yang ditempel di ekornya), dan itu hanya masuk akal untuk
// raster.
export const IMAGE_TYPES: Record<string, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

export type SpecUpload = { buf: Buffer; mime: string; name: string; truncated?: boolean };
export type SavedAttachment = {
  id: string; filename: string; mimeType: string; size: number; createdAt: string;
};
export type RejectReason = "type" | "size" | "count" | "quota" | "scan";

export const attachmentExt = (filename: string): string => extname(filename).toLowerCase();

type Row = { id: string; filename: string; mimeType: string; size: number; createdAt: Date };
const view = (a: Row): SavedAttachment =>
  ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt.toISOString() });

// UploadError → alasan yang terbaca operator. Kode pemindai & kuota TIDAK diciutkan jadi "type":
// operator yang melihat "tipe tak didukung" untuk berkas yang sebenarnya kena kuota akan mencoba
// lagi selamanya.
const reasonFor = (code: UploadError["code"]): RejectReason =>
  code === "UPLOAD_QUOTA" ? "quota" : code === "UPLOAD_SCAN" ? "scan" : "type";

export async function addSpecAttachments(
  spec: { id: string; projectId: string }, files: SpecUpload[],
): Promise<{ saved: SavedAttachment[]; rejected: { filename: string; reason: RejectReason }[] }> {
  const existing = await prisma.specAttachment.findMany({
    where: { specId: spec.id }, select: { size: true },
  });
  let count = existing.length;
  let bytes = existing.reduce((n, a) => n + a.size, 0);

  const saved: SavedAttachment[] = [];
  const rejected: { filename: string; reason: RejectReason }[] = [];
  for (const f of files) {
    const name = f.name || "lampiran";
    if (count >= SPEC_ATTACHMENT_LIMITS.perSpec) { rejected.push({ filename: name, reason: "count" }); continue; }
    // `truncated` datang dari @fastify/multipart (`throwFileSizeLimit:false`): berkas oversize tiba
    // TERPOTONG, bukan sebagai error. Tanpa gerbang ini ia tersimpan sebagai berkas rusak yang
    // ukurannya justru lolos batas.
    if (f.truncated || f.buf.byteLength === 0 || f.buf.byteLength > SPEC_ATTACHMENT_LIMITS.fileBytes) {
      rejected.push({ filename: name, reason: "size" }); continue;
    }
    if (bytes + f.buf.byteLength > SPEC_ATTACHMENT_LIMITS.specBytes) {
      rejected.push({ filename: name, reason: "quota" }); continue;
    }
    const ext = attachmentExt(name);
    let safe: SafeUpload;
    try {
      const image = IMAGE_TYPES[f.mime];
      if (image) {
        if (!image.includes(ext)) throw new UploadError("UPLOAD_TYPE", "extension mismatch");
        safe = await processUpload({
          buffer: f.buf, clientName: name, clientMime: f.mime,
          projectId: spec.projectId, parentBytes: bytes,
        });
      } else if (DOCUMENT_TYPES[f.mime]) {
        safe = await processDocumentUpload({
          buffer: f.buf, clientName: name, clientMime: f.mime, clientExt: ext,
        });
      } else {
        throw new UploadError("UPLOAD_TYPE", "unsupported type");
      }
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      rejected.push({ filename: name, reason: reasonFor(error.code) });
      continue;
    }
    let row: Row;
    try {
      row = await prisma.specAttachment.create({ data: {
        specId: spec.id, projectId: spec.projectId, filename: safe.filename,
        mimeType: safe.mimeType, size: safe.size, storageKey: safe.storageKey,
      } });
    } catch (error) {
      // Byte sudah mendarat di upload dir; tanpa ini ia jadi yatim yang tak punya baris.
      await deleteUpload(safe.storageKey);
      throw error;
    }
    count += 1;
    bytes += safe.size;
    saved.push(view(row));
  }
  return { saved, rejected };
}

export async function listSpecAttachments(specId: string): Promise<SavedAttachment[]> {
  const rows = await prisma.specAttachment.findMany({
    where: { specId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(view);
}

export async function deleteSpecAttachment(specId: string, attId: string): Promise<boolean> {
  const a = await prisma.specAttachment.findUnique({ where: { id: attId } });
  if (!a || a.specId !== specId) return false;
  await prisma.specAttachment.delete({ where: { id: attId } });
  await deleteUpload(a.storageKey);
  return true;
}

// Baris ikut `onDelete: Cascade`, byte-nya TIDAK — cascade DB tak menyentuh disk. Dipanggil SEBELUM
// Spec dihapus, selagi barisnya masih bisa dibaca.
export async function dropSpecAttachments(specId: string): Promise<void> {
  const rows = await prisma.specAttachment.findMany({ where: { specId }, select: { storageKey: true } });
  for (const a of rows) await deleteUpload(a.storageKey);
}
