import { renderQaMarkdown, type QaExportFormat, type QaReportDetail } from "@hanoman/shared";
import { Button, MarkdownView } from "../../ds";
import { useApi } from "../../api/instance";

// Pratinjau baca-saja = renderer Markdown yang SAMA dengan ekspor (satu sumber, bukan dua yang bisa
// berselisih) dalam mode `preview` — tanpa front-matter YAML dan kolom Ref (id cuid), yang hanya berguna
// untuk impor dan di layar sempit justru menyesakkan tabel. Tautan lampiran diarahkan ke URL penyajian
// server supaya gambar tampil. Tabel boleh di-scroll mendatar daripada menjepit kolomnya (terukur di 390 px).
// ZIP = laporan + lampiran (bisa diimpor kembali) · MD/CSV = teks · DOCX/PDF = untuk dibaca & diserahkan ·
// XLSX = ringkasan + matriks test case (sheet "Test case" bisa diisi lalu diimpor lewat tab Test case).
const EXPORTS: { format: QaExportFormat; label: string }[] = [
  { format: "zip", label: "Unduh ZIP (laporan + lampiran)" }, { format: "docx", label: "Unduh DOCX" }, { format: "pdf", label: "Unduh PDF" },
  { format: "xlsx", label: "Unduh XLSX" }, { format: "csv", label: "Unduh CSV (test case)" }, { format: "md", label: "Unduh .md" },
];

export function QaPreview({ detail, projectId }: { detail: QaReportDetail; projectId: string }) {
  const api = useApi();
  const paths = Object.fromEntries(detail.attachments.map((a) => [a.id, api.qaAttachmentUrl(projectId, detail.id, a.id)]));
  // minmax(0, 1fr): kolom `auto` melebar mengikuti konten tabel dan mendorong SELURUH pratinjau melewati viewport
  // (halaman tak scroll karena leluhur memotong — "lulus tapi terpotong"); kolom 0-min membuat tabelnya yang scroll.
  return (
    <div className="qa-preview" style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <style>{[
        ".qa-preview .hn-md table{display:block;overflow-x:auto;max-width:100%}",
        // Sel punya lebar minimum supaya tabel di layar sempit di-SCROLL mendatar, bukan diperas sampai header
        // terpecah per huruf ("KO DE") — terukur di 390 px.
        ".qa-preview .hn-md th{white-space:nowrap}",
        ".qa-preview .hn-md td{min-width:112px;overflow-wrap:break-word;word-break:normal}",
      ].join("")}</style>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {EXPORTS.map((x) => (
          <Button key={x.format} variant={x.format === "zip" ? "secondary" : "ghost"} leftIcon="download" as="a"
            href={api.qaExportUrl(projectId, detail.id, x.format)}>{x.label}</Button>
        ))}
      </div>
      <MarkdownView text={renderQaMarkdown(detail, paths, { preview: true })} name={`${detail.code}.md`} />
    </div>
  );
}
