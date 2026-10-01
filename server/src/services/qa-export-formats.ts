import { casesToRows, csvEncode, type QaExportFormat, type QaReportDetail } from "@hanoman/shared";
import { reportDetail } from "./qa";
import { readQaAttachmentBytes } from "./qa-attachment";
import { writeDocx } from "./qa-docx";
import { prepareExportImages } from "./qa-export-images";
import { writeQaPdf } from "./qa-pdf";
import { writeXlsx } from "./xlsx";

// Workspace QA · bagian 4 · ekspor DOCX / PDF / XLSX / CSV (zip & md ada di qa-transfer.ts, karena
// formatnya yang dibaca-balik impor). Semuanya baca-saja KECUALI matriks test case (XLSX sheet "Test case" +
// CSV), yang memang dirancang untuk diisi lalu diimpor (`qa-cases-import.ts`).

export type RenderedExport = { filename: string; mime: string; body: Buffer | string };
export const OFFICE_MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

const sheetSummary = (d: QaReportDetail): string[][] => {
  const s = d.stats;
  return [
    ["Kolom", "Nilai"], ["Kode", d.code], ["Judul", d.title], ["Build / versi", d.buildVersion], ["Penguji", d.tester],
    ["Status", d.status], ["Keputusan", d.verdict ?? "belum diputuskan"], ["Cakupan", d.scope],
    ["Lingkungan", Object.entries(d.environment).map(([k, v]) => `${k}: ${v}`).join("\n")],
    ["Ringkasan", d.summary],
    ["Test case", `${s.cases.total} · pass ${s.cases.pass} · fail ${s.cases.fail} · blocked ${s.cases.blocked} · skipped ${s.cases.skipped} · todo ${s.cases.todo} · pass rate ${s.passRate === null ? "-" : `${Math.round(s.passRate * 100)}%`}`],
    ["Temuan", `${s.findings.total} · blocker ${s.findings.blocker} · critical ${s.findings.critical} · major ${s.findings.major} · minor ${s.findings.minor} · trivial ${s.findings.trivial} · open ${s.findings.open}`],
    ["Dibuat", d.createdAt], ["Diubah", d.updatedAt],
  ];
};

const sheetFindings = (d: QaReportDetail): string[][] => [
  ["Kode", "Judul", "Severity", "Prioritas", "Status", "Area", "Test case", "Langkah", "Expected", "Actual", "Backlog", "Stage backlog", "Lampiran", "Ref"],
  ...d.findings.map((f) => [
    f.code, f.title, f.severity, f.priority, f.status, f.area, f.caseCode ?? "",
    f.steps.map((t, i) => `${i + 1}. ${t}`).join("\n"), f.expected, f.actual,
    f.backlogId ?? "", f.spec?.stage ?? "",
    d.attachments.filter((a) => a.ownerType === "finding" && a.ownerId === f.id).map((a) => a.filename).join(", "), f.id,
  ]),
];

export async function renderExport(
  projectId: string, reportId: string, format: Exclude<QaExportFormat, "zip" | "md">,
): Promise<RenderedExport | null> {
  const d = await reportDetail(projectId, reportId);
  if (!d) return null;
  switch (format) {
    case "docx": {
      const images = await prepareExportImages(d, (a) => readQaAttachmentBytes(a.id));
      return { filename: `${d.code}.docx`, mime: OFFICE_MIME.docx, body: writeDocx(d, images) };
    }
    case "pdf": {
      const images = await prepareExportImages(d, (a) => readQaAttachmentBytes(a.id));
      return { filename: `${d.code}.pdf`, mime: "application/pdf", body: await writeQaPdf(d, images) };
    }
    case "xlsx":
      return { filename: `${d.code}.xlsx`, mime: OFFICE_MIME.xlsx, body: writeXlsx([
        { name: "Ringkasan", rows: sheetSummary(d), widths: [18, 80] },
        { name: "Test case", rows: casesToRows(d.cases), widths: [10, 34, 40, 32, 32, 11, 28] },
        { name: "Temuan", rows: sheetFindings(d), widths: [8, 34, 11, 10, 9, 14, 10, 40, 30, 30, 11, 14, 28, 28] },
      ]) };
    case "csv":
      return { filename: `${d.code}-testcase.csv`, mime: "text/csv; charset=utf-8", body: csvEncode(casesToRows(d.cases)) };
  }
}
