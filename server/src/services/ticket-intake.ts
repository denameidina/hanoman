// SPEC-626 · SATU pipeline pembuatan tiket untuk DUA pintu: halaman Help Center publik
// (`routes/help.ts`, ADR-0062) dan portal klien yang sudah login (`routes/portal.ts`, ADR-0111).
// Diangkat dari badan `help.ts` supaya tiket kedua jalur identik SECARA KONSTRUKSI — bukan
// identik karena dua salinan kebetulan sepakat (kelas bug "satu definisi, N call site" yang sudah
// dibayar SPEC-431/448/475). Yang berbeda antar-pintu cuma otorisasi & asal `reporterEmail`.
import type { FastifyRequest } from "fastify";
import { prisma } from "../db";
import { createTicket, pruneOldTickets } from "./ticket";
import { recordNewTicket } from "./notifications";
import { notifySynced } from "./sync-notify";
import { saveUpload } from "./uploads";

export type TicketUpload = { buf: Buffer; mime: string; name: string };

export const TICKET_UPLOAD = {
  MAX_FILES: 3,
  MAX_BYTES: 5 * 1024 * 1024,
  OK_MIME: new Set(["image/png", "image/jpeg", "image/webp"]),
};

/** Multipart → field + lampiran. `null` = unggahan tak terbaca (pemanggil balas 400). */
export async function parseTicketUpload(
  req: FastifyRequest,
): Promise<{ fields: Record<string, string>; files: TicketUpload[] } | null> {
  const fields: Record<string, string> = {};
  const files: TicketUpload[] = [];
  try {
    for await (const part of (req as any).parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer(); // menguras stream file
        // truncated (fileSize terlampaui, throwFileSizeLimit:false) / mime salah / kelebihan →
        // skip, submit yang sisanya tetap jadi (AC PRD).
        if (part.file?.truncated || !TICKET_UPLOAD.OK_MIME.has(part.mimetype)
          || files.length >= TICKET_UPLOAD.MAX_FILES) continue;
        files.push({ buf, mime: part.mimetype, name: String(part.filename ?? "gambar") });
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }
  } catch {
    return null;
  }
  return { fields, files };
}

export async function intakeTicket(input: {
  projectId: string; projectName: string; category: string; title: string; detail: string;
  reporterEmail: string; files: TicketUpload[];
}) {
  const { ticket, key } = await createTicket({
    projectId: input.projectId, category: input.category, title: input.title,
    detail: input.detail, reporterEmail: input.reporterEmail,
  });
  // SPEC-382 · INDUK dulu, baru ANAK. Feed diterapkan urut seq di client, dan
  // `TicketAttachment.ticketId` punya FK ke `Ticket.id` — memancarkan lampiran lebih dulu
  // membuat client menabrak FK, lalu barisnya hilang/menghentikan siklus (audit SPEC-382).
  await notifySynced("ticket", ticket.id); // SPEC-268 · tiket baru → feed (metadata)
  for (const f of input.files) {
    const { storageKey, size } = await saveUpload(f.buf, f.mime);
    const att = await prisma.ticketAttachment.create({
      data: {
        ticketId: ticket.id, projectId: input.projectId, filename: f.name.slice(0, 200),
        mimeType: f.mime, size, storageKey,
      },
    });
    await notifySynced("ticketAttachment", att.id); // SPEC-272 · metadata lampiran → feed
  }
  await recordNewTicket(ticket.id, input.projectId, input.projectName, input.category, input.title);
  void pruneOldTickets(); // retensi opportunistic-on-write (tanpa scheduler global)
  return { ticket, key };
}
