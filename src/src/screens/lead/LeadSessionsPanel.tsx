/* ADR-0228 · Sesi lead — satu pane `lead-<proyek>` per proyek yang diurus lead. Manusia bisa
   membuka terminalnya dan mengetik langsung; selama ia mengetik, server menahan event baru. */
import React from "react";
import type { LeadSessionView } from "@hanoman/shared";
import { Badge, Button, DenseRow, RowList } from "../../ds";

export type LeadSessionOp = "start" | "stop" | "rotate";
export type LeadSessionsPanelProps = {
  sessions: LeadSessionView[];
  projectName: (id: string) => string;
  busyId: string | null;
  onGoto: (sessionId: string) => void;
  onOp: (projectId: string, op: LeadSessionOp) => void;
};

function state(s: LeadSessionView): { label: string; tone: "neutral" | "ok" | "info" | "warn" } {
  if (!s.alive) return { label: "mati", tone: "neutral" };
  if (s.humanActive) return { label: "kamu sedang mengetik", tone: "warn" };
  return s.idle ? { label: "diam · siap", tone: "ok" } : { label: "sedang bekerja", tone: "info" };
}

export function LeadSessionsPanel({ sessions, projectName, busyId, onGoto, onOp }: LeadSessionsPanelProps) {
  if (!sessions.length) return <p className="hn-lead-note">Belum ada project yang diurus lead.</p>;
  return (
    <RowList label="Sesi lead per project">
      {sessions.map((s) => {
        const st = state(s);
        const busy = busyId === `session:${s.projectId}`;
        return (
          <DenseRow key={s.projectId} actions={s.alive
            ? <>
                <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGoto(s.sessionId)}>Buka terminal</Button>
                <Button size="sm" variant="ghost" leftIcon="refresh-cw" disabled={busy} onClick={() => onOp(s.projectId, "rotate")}>Rotasi</Button>
                <Button size="sm" variant="ghost" leftIcon="ban" disabled={busy} onClick={() => onOp(s.projectId, "stop")}>Hentikan</Button>
              </>
            : <Button size="sm" leftIcon="play" disabled={busy} onClick={() => onOp(s.projectId, "start")}>Mulai</Button>}>
            <span className="hn-lead-project-name">{projectName(s.projectId)}</span>
            <span className="hn-lead-project-meta">
              {s.delivered} event diantar sejak lahir · {s.restarts} kali lahir
            </span>
            <Badge tone={st.tone} size="sm">{st.label}</Badge>
          </DenseRow>
        );
      })}
    </RowList>
  );
}
