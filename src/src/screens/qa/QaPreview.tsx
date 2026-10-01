import { renderQaMarkdown, type QaReportDetail } from "@hanoman/shared";
import { Button, MarkdownView } from "../../ds";
import { useApi } from "../../api/instance";

// Pratinjau baca-saja = renderer Markdown yang SAMA dengan ekspor (satu sumber, bukan dua yang bisa
// berselisih) dalam mode `preview` — tanpa front-matter YAML dan kolom Ref (id cuid), yang hanya berguna
// untuk impor dan di layar sempit justru menyesakkan tabel. Tautan lampiran diarahkan ke URL penyajian
// server supaya gambar tampil. Tabel boleh di-scroll mendatar daripada menjepit kolomnya (terukur di 390 px).
export function QaPreview({ detail, projectId }: { detail: QaReportDetail; projectId: string }) {
  const api = useApi();
  const paths = Object.fromEntries(detail.attachments.map((a) => [a.id, api.qaAttachmentUrl(projectId, detail.id, a.id)]));
  return (
    <div className="qa-preview" style={{ display: "grid", gap: 12 }}>
      <style>{".qa-preview .hn-md table{display:block;overflow-x:auto;max-width:100%}"}</style>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id)}>Unduh ZIP (laporan + lampiran)</Button>
        <Button variant="ghost" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id, "md")}>Unduh .md</Button>
      </div>
      <MarkdownView text={renderQaMarkdown(detail, paths, { preview: true })} name={`${detail.code}.md`} />
    </div>
  );
}
