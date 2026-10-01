import { basename } from "node:path";
import {
  QaMarkdownError, parseQaMarkdown, renderQaMarkdown, type QaParsedReport,
} from "@hanoman/shared";
import { prisma } from "../db";
import { asJson, reportDetail } from "./qa";
import { QA_ATTACHMENT_LIMITS, addQaAttachments, type QaUpload } from "./qa-attachment";
import { readUpload } from "./uploads";
import { ZipError, readZip, writeZip } from "./zip";

// Workspace QA · ekspor ZIP (report.md + attachments/) dan impor (upsert). Bentuk Markdown-nya milik
// `shared/qa-markdown.ts`; di sini hanya I/O: baca byte lampiran, tulis/baca ZIP, tulis DB.

export class QaImportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf",
  md: "text/markdown", txt: "text/plain", log: "text/plain", json: "application/json", csv: "text/csv",
};
/** Nama hasil ekspor `F-01-1-layar.png` → `layar.png`, supaya ekspor→impor berulang tak menumpuk awalan. */
const originalName = (path: string) => basename(path).replace(/^(?:QA-\d+|F-\d+|TC-\d+)-\d+-/, "");

export async function exportReport(projectId: string, reportId: string) {
  const full = await reportDetail(projectId, reportId);
  if (!full) return null;
  const codeOf = (type: string, id: string) =>
    type === "report" ? full.code
      : type === "case" ? full.cases.find((c) => c.id === id)?.code ?? "TC-00"
      : full.findings.find((f) => f.id === id)?.code ?? "F-00";

  const paths: Record<string, string> = {};
  const files: { name: string; data: Buffer }[] = [];
  const seq = new Map<string, number>();
  const present = [];
  for (const a of full.attachments) {
    const row = await prisma.qaAttachment.findUnique({ where: { id: a.id }, select: { storageKey: true } });
    const data = row ? await readUpload(row.storageKey).catch(() => null) : null;
    if (!data) continue;                       // byte hilang dari disk — jangan tautkan yang tak ada
    const owner = codeOf(a.ownerType, a.ownerId);
    const n = (seq.get(owner) ?? 0) + 1;
    seq.set(owner, n);
    paths[a.id] = `attachments/${owner}-${n}-${safe(a.filename)}`;
    files.push({ name: paths[a.id]!, data });
    present.push(a);
  }
  const markdown = renderQaMarkdown({ ...full, attachments: present }, paths);
  const zip = writeZip([{ name: "report.md", data: Buffer.from(markdown, "utf8"), deflate: true }, ...files]);
  return { code: full.code, markdown, zip };
}

export type QaImportResult = {
  reportId: string; created: boolean; cases: number; findings: number;
  attachments: { saved: number; rejected: { filename: string; reason: string }[] };
};

export async function importReport(projectId: string, file: { name: string; buf: Buffer }): Promise<QaImportResult> {
  if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })))
    throw new QaImportError(404, "project tak ditemukan");

  let markdown: string;
  let assets = new Map<string, Buffer>();
  let dir = "";
  const isZip = file.buf.length >= 4 && file.buf.readUInt32LE(0) === 0x04034b50;
  if (isZip) {
    try {
      const entries = readZip(file.buf);
      const mdName = [...entries.keys()].find((k) => /(^|\/)report\.md$/i.test(k))
        ?? [...entries.keys()].find((k) => /\.md$/i.test(k) && !/(^|\/)attachments\//.test(k));
      if (!mdName) throw new QaImportError(400, "ZIP tak memuat report.md");
      markdown = entries.get(mdName)!.toString("utf8");
      dir = mdName.includes("/") ? mdName.slice(0, mdName.lastIndexOf("/") + 1) : "";
      assets = entries;
    } catch (e) {
      if (e instanceof ZipError) throw new QaImportError(400, `ZIP tak valid: ${e.message}`);
      throw e;
    }
  } else {
    markdown = file.buf.toString("utf8");
  }

  let parsed: QaParsedReport;
  try { parsed = parseQaMarkdown(markdown); }
  catch (e) { if (e instanceof QaMarkdownError) throw new QaImportError(400, e.message); throw e; }
  if ((parsed.status === "submitted" || parsed.status === "closed") && !parsed.verdict)
    throw new QaImportError(400, "verdict wajib diisi untuk laporan berstatus submitted/closed");

  const existing = parsed.reportId
    ? await prisma.qaReport.findFirst({ where: { id: parsed.reportId, projectId } }) : null;
  if (existing?.status === "closed") throw new QaImportError(409, "laporan target sudah closed — buka kembali sebelum mengimpor");

  const now = Date.now();
  const owners: { ownerType: "report" | "case" | "finding"; ownerId: string; paths: string[] }[] = [];
  const out = await prisma.$transaction(async (tx) => {
    const data = {
      title: parsed.title, buildVersion: parsed.buildVersion, environment: asJson(parsed.environment),
      scope: parsed.scope, tester: parsed.tester, summary: parsed.summary, status: parsed.status, verdict: parsed.verdict,
    };
    const report = existing
      ? await tx.qaReport.update({ where: { id: existing.id }, data })
      : await tx.qaReport.create({ data: { projectId, ...data, createdAt: new Date(now) } });
    owners.push({ ownerType: "report", ownerId: report.id, paths: parsed.attachments });

    const knownCases = new Set((await tx.qaCase.findMany({ where: { reportId: report.id }, select: { id: true } })).map((c) => c.id));
    const caseByFileId = new Map<string, string>();
    const caseByCode = new Map<string, string>();
    for (const [idx, c] of parsed.cases.entries()) {
      const fields = { title: c.title, steps: c.steps, expected: c.expected, actual: c.actual, status: c.status, order: idx + 1 };
      const row = c.id && knownCases.has(c.id)
        ? await tx.qaCase.update({ where: { id: c.id }, data: fields })
        // createdAt bergeser 1 ms per baris: nomor TC-nn deterministik = urutan di berkas
        : await tx.qaCase.create({ data: { reportId: report.id, ...fields, createdAt: new Date(now + 1 + idx) } });
      if (c.id) caseByFileId.set(c.id, row.id);
      caseByCode.set(c.code, row.id);
      owners.push({ ownerType: "case", ownerId: row.id, paths: c.attachments });
    }

    const knownFindings = new Set((await tx.qaFinding.findMany({ where: { reportId: report.id }, select: { id: true } })).map((f) => f.id));
    for (const [idx, f] of parsed.findings.entries()) {
      const caseId = (f.caseId && caseByFileId.get(f.caseId)) || (f.caseCode && caseByCode.get(f.caseCode)) || null;
      const fields = {
        caseId, title: f.title, severity: f.severity, priority: f.priority, area: f.area,
        steps: asJson(f.steps), expected: f.expected, actual: f.actual,
        status: f.status === "sent" ? "open" : f.status,   // `sent` tanpa backlogId di mesin ini tak bermakna
      };
      const row = f.id && knownFindings.has(f.id)
        ? await tx.qaFinding.update({ where: { id: f.id }, data: fields })
        : await tx.qaFinding.create({ data: { reportId: report.id, ...fields, createdAt: new Date(now + 1 + idx) } });
      owners.push({ ownerType: "finding", ownerId: row.id, paths: f.attachments });
    }
    return report;
  });

  // Lampiran SESUDAH transaksi: byte lewat pipeline unggahan (async + pemindaian), tak boleh menahan DB.
  let saved = 0;
  const rejected: { filename: string; reason: string }[] = [];
  const have = await prisma.qaAttachment.findMany({ where: { reportId: out.id }, select: { ownerType: true, ownerId: true, filename: true } });
  for (const o of owners) {
    const uploads: QaUpload[] = [];
    for (const path of o.paths) {
      const buf = assets.get(dir + path);
      const name = originalName(path);
      if (!buf) { rejected.push({ filename: name, reason: "missing" }); continue; }
      if (have.some((h) => h.ownerType === o.ownerType && h.ownerId === o.ownerId && h.filename === name)) continue;  // sudah ada
      const mime = MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""];
      if (!mime) { rejected.push({ filename: name, reason: "type" }); continue; }
      uploads.push({ buf, mime, name, truncated: buf.length > QA_ATTACHMENT_LIMITS.fileBytes });
    }
    if (!uploads.length) continue;
    const r = await addQaAttachments({ id: out.id, projectId }, { ownerType: o.ownerType, ownerId: o.ownerId }, uploads);
    saved += r.saved.length;
    rejected.push(...r.rejected);
  }
  return {
    reportId: out.id, created: !existing, cases: parsed.cases.length, findings: parsed.findings.length,
    attachments: { saved, rejected },
  };
}
