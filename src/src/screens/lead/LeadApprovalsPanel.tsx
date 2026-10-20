/* ADR-0228 · Menunggu izin — tindakan hanoman-lead yang ditahan gerbang server. Kartu memperlihatkan
   PERSIS apa yang akan dijalankan: tindakan, target, alasan lead, bukti yang ia periksa, dan laporan
   gerbang server. Setujui menjalankannya apa adanya; Tolak mengirim catatan kembali ke lead. */
import React from "react";
import type { LeadApprovalView } from "@hanoman/shared";
import { Badge, Button, Input } from "../../ds";
import { agoLabel } from "../sched-lead-shared";
import { LEAD_ACTION_LABEL as ACTION_LABEL, labelOf } from "../../lib/labels";

export type LeadApprovalsPanelProps = {
  approvals: LeadApprovalView[];
  projectName: (id: string) => string;
  busyId: string | null;
  onDecide: (id: string, approve: boolean, note?: string) => void;
};

export function LeadApprovalsPanel({ approvals, projectName, busyId, onDecide }: LeadApprovalsPanelProps) {
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  if (!approvals.length) return <p className="hn-lead-note">Tidak ada tindakan lead yang menunggu izinmu.</p>;
  return (
    <ul className="hn-lead-waits" aria-label="Tindakan lead yang menunggu izin">
      {approvals.map((a) => {
        const busy = busyId === a.id;
        return (
          <li key={a.id} className="hn-lead-wait">
            <div className="hn-lead-wait-head">
              <span className="hn-lead-wait-title">
                {labelOf(ACTION_LABEL, a.action)}{a.target ? ` · ${a.target}` : ""}
              </span>
              <Badge tone="warn" size="sm">minta izin</Badge>
            </div>
            <p className="hn-lead-wait-question">{a.reason}</p>
            {a.evidence.length > 0 && (
              <div className="hn-lead-refs" aria-label="Bukti yang diperiksa lead">
                {a.evidence.map((e) => <span key={e} className="hn-lead-ref">{e}</span>)}
              </div>
            )}
            {a.gateReport.length > 0 && (
              <p className="hn-lead-note">Gerbang server: {a.gateReport.join(" · ")}</p>
            )}
            <div className="hn-lead-item-meta">
              <span>{projectName(a.projectId)}</span>
              <span>{agoLabel(a.createdAt)}</span>
            </div>
            {rejecting === a.id ? (
              <div className="hn-lead-change">
                <div className="hn-lead-change-row">
                  <Input className="hn-lead-change-input" size="sm" aria-label="Catatan untuk lead"
                    placeholder="Kenapa ditolak? (opsional, dikirim ke lead)" value={note}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)} />
                  <Button size="sm" variant="danger" disabled={busy}
                    onClick={() => { onDecide(a.id, false, note.trim() || undefined); setRejecting(null); setNote(""); }}>
                    Kirim penolakan
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRejecting(null); setNote(""); }}>Batal</Button>
                </div>
              </div>
            ) : (
              <div className="hn-lead-wait-foot">
                <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busy} onClick={() => setRejecting(a.id)}>Tolak</Button>
                <Button size="sm" leftIcon="check" disabled={busy} onClick={() => onDecide(a.id, true)}>Setujui</Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
