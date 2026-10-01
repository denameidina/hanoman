import React from "react";
import type { QaReportView } from "@hanoman/shared";
import { Badge, Card, StateBlock } from "../../ds";
import { REPORT_LABEL, REPORT_TONE, VERDICT_LABEL, VERDICT_TONE, pct } from "./qa-ui";

export function QaReportList({ reports, onOpen }: { reports: QaReportView[]; onOpen: (id: string) => void }) {
  if (reports.length === 0)
    return <StateBlock kind="empty" title="Belum ada laporan QA" hint="Buat laporan baru, atau impor dari template Excel." />;
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" }}>
      {reports.map((r) => (
        <Card key={r.id} interactive padding={16} onClick={() => onOpen(r.id)} style={{ cursor: "pointer" }}
          role="button" tabIndex={0} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <Badge tone="brass" variant="outline" size="sm">{r.code}</Badge>
            <Badge tone={REPORT_TONE[r.status]} size="sm">{REPORT_LABEL[r.status]}</Badge>
            {r.verdict && <Badge tone={VERDICT_TONE[r.verdict]} size="sm">{VERDICT_LABEL[r.verdict]}</Badge>}
          </div>
          <div style={{ fontWeight: 600, color: "var(--text-strong)", marginBottom: 4, overflowWrap: "anywhere" }}>{r.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>
            {[r.buildVersion && `Versi ${r.buildVersion}`, r.tester].filter(Boolean).join(" · ") || "—"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>
            {r.stats.cases.pass}/{r.stats.cases.total} lulus ({pct(r.stats.passRate)}) · {r.stats.findings.total} temuan ({r.stats.findings.open} belum ditangani)
          </div>
        </Card>
      ))}
    </div>
  );
}
