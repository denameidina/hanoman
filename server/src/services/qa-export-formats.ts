import { casesToRows, csvEncode, type QaExportFormat } from "@hanoman/shared";
import { reportDetail } from "./qa";
import { readQaAttachmentBytes } from "./qa-attachment-transfer";
import { writeDocx } from "./qa-docx";
import { prepareExportImages } from "./qa-export-images";
import { writeQaPdf } from "./qa-pdf";
import { writeQaWorkbook } from "./qa-workbook";

// Excel dapat diimpor sebagai laporan lengkap atau matriks test case; DOCX/PDF untuk dibaca.

export type RenderedExport = { filename: string; mime: string; body: Buffer | string };
export const OFFICE_MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

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
      return { filename: `${d.code}.xlsx`, mime: OFFICE_MIME.xlsx, body: writeQaWorkbook(d) };
    case "csv":
      return { filename: `${d.code}-testcase.csv`, mime: "text/csv; charset=utf-8", body: csvEncode(casesToRows(d.cases)) };
  }
}
