import { renderQaMarkdown, type QaReportDetail } from "@hanoman/shared";
import { Button, MarkdownView } from "../../ds";
import { useApi } from "../../api/instance";

// Pratinjau baca-saja = dokumen Markdown yang SAMA dengan yang diekspor (satu renderer, bukan dua
// yang bisa berselisih), dengan tautan lampiran diarahkan ke URL penyajian server supaya gambar tampil.
export function QaPreview({ detail, projectId }: { detail: QaReportDetail; projectId: string }) {
  const api = useApi();
  const paths = Object.fromEntries(detail.attachments.map((a) => [a.id, api.qaAttachmentUrl(projectId, detail.id, a.id)]));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id)}>Unduh ZIP (laporan + lampiran)</Button>
        <Button variant="ghost" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id, "md")}>Unduh .md</Button>
      </div>
      <MarkdownView text={renderQaMarkdown(detail, paths)} name={`${detail.code}.md`} />
    </div>
  );
}
