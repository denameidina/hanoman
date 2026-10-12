// Daftar laporan QA (RowList). Satu baris = satu laporan: kode, status, judul, versi/penguji, angka lulus,
// ringkasan temuan, dan keputusan. Ekspor ZIP adalah satu-satunya pintu unduh di daftar; format lain ada
// di menu ⋯ editor.
import type { QaReportView } from "@hanoman/shared";
import { Badge, Button, DenseRow, RowList, StateBlock } from "../../ds";
import { useApi } from "../../api/instance";
import { relativeTime } from "../../lib/time-format";
import { REPORT_LABEL, REPORT_TONE, VERDICT_LABEL, pct } from "./qa-ui";

export function QaReportList({ projectId, reports, onOpen }: { projectId: string; reports: QaReportView[]; onOpen: (id: string) => void }) {
  const api = useApi();
  if (reports.length === 0)
    return <StateBlock kind="empty" title="Belum ada laporan QA" hint="Buat laporan baru, atau impor dari template Excel." />;
  const now = Date.now();
  return (
    <RowList label="Daftar laporan QA">
      {reports.map((r) => (
        <DenseRow key={r.id} onClick={() => onOpen(r.id)}
          actions={<Button as="a" size="sm" variant="ghost" leftIcon="download" href={api.qaExportUrl(projectId, r.id)}
            aria-label={`Unduh ZIP ${r.code}`}>Unduh ZIP</Button>}>
          <span className="hn-qa-row-body">
            <span className="hn-qa-row-head">
              <span className="hn-qa-code">{r.code}</span>
              <Badge tone={REPORT_TONE[r.status]} variant="dot" size="sm">{REPORT_LABEL[r.status]}</Badge>
            </span>
            <span className="hn-qa-row-title">{r.title}</span>
            <span className="hn-qa-row-line">
              <span>{[r.buildVersion && `Versi ${r.buildVersion}`, r.tester].filter(Boolean).join(" · ") || "Belum ada versi atau penguji"}</span>
              <span className="hn-qa-row-stat">{r.stats.cases.pass}/{r.stats.cases.total} lulus ({pct(r.stats.passRate)}) · {r.stats.findings.total} temuan ({r.stats.findings.open} belum ditangani)</span>
              {r.verdict && <span>Keputusan: {VERDICT_LABEL[r.verdict]}</span>}
              <span>Diubah {relativeTime(r.updatedAt, now) || "—"}</span>
            </span>
          </span>
        </DenseRow>
      ))}
    </RowList>
  );
}
