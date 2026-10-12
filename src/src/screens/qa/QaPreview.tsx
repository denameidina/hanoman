import { renderQaMarkdown, type QaReportDetail } from "@hanoman/shared";
import { MarkdownView } from "../../ds";
import { useApi } from "../../api/instance";

// Pratinjau baca-saja = renderer Markdown yang SAMA dengan ekspor (satu sumber, bukan dua yang bisa
// berselisih) dalam mode `preview`: tanpa front-matter YAML dan kolom Ref (id cuid), yang hanya berguna
// untuk impor. Tautan lampiran diarahkan ke URL penyajian server supaya gambar tampil. Format ekspor
// (ZIP, DOCX, PDF, …) ada di menu ⋯ editor, bukan di sini: satu pintu, tak ada dua tempat yang sama.
export function QaPreview({ detail, projectId }: { detail: QaReportDetail; projectId: string }) {
  const api = useApi();
  const paths = Object.fromEntries(detail.attachments.map((a) => [a.id, api.qaAttachmentUrl(projectId, detail.id, a.id)]));
  return (
    <div className="hn-qa-preview">
      <MarkdownView text={renderQaMarkdown(detail, paths, { preview: true })} name={`${detail.code}.md`} />
    </div>
  );
}
