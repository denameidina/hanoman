import type { FastifyInstance } from "fastify";
import { QA_EXPORT_FORMATS, qaTemplateMarkdown, type QaExportFormat } from "@hanoman/shared";
import { QA_ATTACHMENT_LIMITS } from "../services/qa-attachment";
import { qaTemplateWorkbook } from "../services/qa-workbook";
import { importCases } from "../services/qa-cases-import";
import { renderExport } from "../services/qa-export-formats";
import { QaImportError, exportReport, importReport } from "../services/qa-transfer";

// Workspace QA · template, ekspor, impor. Capability `qa:*` menurut METHOD (`capabilityForRoute`).
// Batas multipart PER-REQUEST (registrasi global 5 MB milik lampiran gambar tak boleh naik): impor ZIP
// boleh sebesar kuota satu laporan (100 MB) + Markdown-nya.
const IMPORT_MAX = QA_ATTACHMENT_LIMITS.reportBytes + 5 * 1024 * 1024;

export default async function qaTransfer(app: FastifyInstance) {
  app.get("/qa/template.xlsx", async (_req, reply) => {
    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", 'attachment; filename="qa-template.xlsx"');
    return reply.send(qaTemplateWorkbook());
  });

  app.get("/qa/template.md", async (_req, reply) => {
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="qa-template.md"');
    return reply.send(qaTemplateMarkdown());
  });

  app.get("/projects/:pid/qa/reports/:rid/export", async (req, reply) => {
    const { pid, rid } = req.params as { pid: string; rid: string };
    const format = (req.query as { format?: string }).format ?? "zip";
    if (!(QA_EXPORT_FORMATS as readonly string[]).includes(format))
      return reply.code(400).send({ error: `format tak dikenal: ${format}`, formats: QA_EXPORT_FORMATS });
    // DOCX/PDF/XLSX/CSV (bagian 4) — zip & md di bawah, karena formatnya yang dibaca-balik impor.
    if (format !== "zip" && format !== "md") {
      const r = await renderExport(pid, rid, format as Exclude<QaExportFormat, "zip" | "md">);
      if (!r) return reply.code(404).send({ error: "not found" });
      reply.header("content-type", r.mime);
      reply.header("content-disposition", `attachment; filename="${r.filename}"`);
      return reply.send(r.body);
    }
    const out = await exportReport(pid, rid);
    if (!out) return reply.code(404).send({ error: "not found" });
    if (format === "md") {
      reply.header("content-type", "text/markdown; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="${out.code}.md"`);
      return reply.send(out.markdown);
    }
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="${out.code}.zip"`);
    return reply.send(out.zip);
  });

  app.post("/projects/:pid/qa/import", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });
    let file: { name: string; buf: Buffer } | null = null;
    const companions: { name: string; buf: Buffer }[] = [];
    let totalBytes = 0;
    try {
      for await (const part of (req as any).parts({ limits: { fileSize: IMPORT_MAX, files: 31 } })) {
        if (part.type !== "file") continue;
        const buf = await part.toBuffer();
        if (part.file?.truncated) return reply.code(413).send({ error: "berkas terlalu besar" });
        totalBytes += buf.length;
        if (totalBytes > IMPORT_MAX) return reply.code(413).send({ error: "total unggahan terlalu besar (maks 105 MB)" });
        const upload = { name: String(part.filename ?? "import"), buf };
        if (part.fieldname === "attachments") companions.push(upload);
        else if (file) return reply.code(400).send({ error: "pilih satu laporan Excel, ZIP, atau Markdown" });
        else file = upload;
      }
    } catch { return reply.code(400).send({ error: "unggahan tak valid" }); }
    if (!file || file.buf.length === 0) return reply.code(400).send({ error: "tak ada berkas" });
    try {
      const r = await importReport(pid, file, companions);
      return reply.code(r.created ? 201 : 200).send(r);
    } catch (e) {
      if (e instanceof QaImportError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
  // Impor matriks test case (XLSX/CSV) ke laporan ini — upsert berbasis kolom Ref. Lihat qa-cases-import.ts.
  app.post("/projects/:pid/qa/reports/:rid/cases/import", async (req, reply) => {
    const { pid, rid } = req.params as { pid: string; rid: string };
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });
    let file: { name: string; buf: Buffer } | null = null;
    try {
      for await (const part of (req as any).parts({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } })) {
        if (part.type !== "file" || file) continue;
        const buf = await part.toBuffer();
        if (part.file?.truncated) return reply.code(413).send({ error: "berkas terlalu besar (maks 8 MB)" });
        file = { name: String(part.filename ?? "matriks"), buf };
      }
    } catch { return reply.code(400).send({ error: "unggahan tak valid" }); }
    if (!file || file.buf.length === 0) return reply.code(400).send({ error: "tak ada berkas" });
    try { return await importCases(pid, rid, file); }
    catch (e) {
      if (e instanceof QaImportError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
}
