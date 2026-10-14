import React from "react";
// Daftar laporan QA (RowList). Satu baris = satu laporan: kode, status, judul, versi/penguji, angka lulus,
// ringkasan temuan, dan keputusan. Ekspor ZIP adalah satu-satunya pintu unduh di daftar; format lain ada
// di menu ⋯ editor.
import type { QaReportView } from "@hanoman/shared";
import { Badge, Button, DenseRow, RowList, StateBlock } from "../../ds";
import { useApi } from "../../api/instance";
import { relativeTime } from "../../lib/time-format";
import { REPORT_LABEL, REPORT_TONE, VERDICT_LABEL, pct } from "./qa-ui";

/** `projects` terisi = mode "Semua project": baris dikelompokkan per project (urutan project, lalu urutan masuk). */
export function QaReportList({ projects, reports, onOpen }:
  { projects?: { id: string; name: string }[]; reports: QaReportView[]; onOpen: (r: QaReportView) => void }) {
  const api = useApi();
  if (reports.length === 0)
    return <StateBlock kind="empty" title="Belum ada laporan QA" hint="Buat laporan baru, atau impor dari template Excel." />;
  const now = Date.now();
  return (
    <RowList label="Daftar laporan QA">
      {reports.map((r, i) => (
        <React.Fragment key={r.id}>
        {projects && r.projectId !== reports[i - 1]?.projectId && (
          <h4 className="hn-qa-group-title">{projects.find((p) => p.id === r.projectId)?.name ?? "Project lain"}</h4>
        )}
        <DenseRow onClick={() => onOpen(r)}
          actions={<Button as="a" size="sm" variant="ghost" leftIcon="download" href={api.qaExportUrl(r.projectId, r.id)}
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
        </React.Fragment>
      ))}
    </RowList>
  );
}
