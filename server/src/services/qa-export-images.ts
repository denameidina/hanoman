import sharp from "sharp";
import type { QaAttachmentView, QaReportDetail } from "@hanoman/shared";
import type { DocxImage } from "./qa-docx";

// Workspace QA · bagian 4 · menyiapkan screenshot untuk DOCX/PDF: keduanya hanya menanam png/jpeg (webp
// dikonversi ke png) dan butuh dimensi piksel untuk menjaga rasio. Satu gambar rusak TAK menggagalkan
// ekspor — ia dilewati (dicantumkan sebagai berkas biasa oleh penulisnya).
const MAX_IMAGES = 60;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;

export async function prepareExportImages(
  d: QaReportDetail, load: (a: QaAttachmentView) => Promise<Buffer | null>,
): Promise<Map<string, DocxImage>> {
  const out = new Map<string, DocxImage>();
  let total = 0;
  for (const a of d.attachments) {
    if (out.size >= MAX_IMAGES || total >= MAX_TOTAL_BYTES) break;
    if (!/^image\/(png|jpeg|webp)$/.test(a.mimeType)) continue;
    try {
      const raw = await load(a);
      if (!raw) continue;
      const needsPng = a.mimeType === "image/webp";
      const data = needsPng ? await sharp(raw).png().toBuffer() : raw;
      const meta = await sharp(data).metadata();
      if (!meta.width || !meta.height) continue;
      out.set(a.id, { data, ext: a.mimeType === "image/jpeg" ? "jpeg" : "png", w: meta.width, h: meta.height });
      total += data.length;
    } catch { /* gambar rusak: dilewati */ }
  }
  return out;
}
