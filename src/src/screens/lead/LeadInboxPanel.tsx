/* ADR-0228 · Inbox sesi lead — apa yang sedang (atau gagal) diputuskan pane lead. Event mana pun
   boleh diambil manusia; sesudah itu jawaban lead untuknya ditolak server. Event `late` = lewat
   tenggat dan kini menunggu kamu. */
import React from "react";
import type { LeadEventView } from "@hanoman/shared";
import { Badge, Button } from "../../ds";
import { agoLabel, untilLabel } from "../sched-lead-shared";

type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
const KIND_LABEL: Record<string, string> = {
  ask: "pertanyaan sesi", "session-ended": "sesi selesai/gagal", pulse: "pilih backlog",
  human: "permintaan", rejected: "penolakan manusia", "integrate-failed": "integrasi gagal",
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "menunggu diantar", tone: "neutral" },
  delivered: { label: "di pane lead", tone: "info" },
  late: { label: "lewat tenggat · menunggu kamu", tone: "err" },
  human: { label: "diambil manusia", tone: "neutral" },
  done: { label: "selesai", tone: "ok" },
};
const QUESTION_MAX = 240;

export type LeadInboxPanelProps = {
  events: LeadEventView[];
  projectName: (id: string) => string;
  busyId: string | null;
  onTake: (e: LeadEventView) => void;
  onGoto: (sessionId: string) => void;
};

export function LeadInboxPanel({ events, projectName, busyId, onTake, onGoto }: LeadInboxPanelProps) {
  if (!events.length) return <p className="hn-lead-note">Inbox lead kosong.</p>;
  return (
    <ul className="hn-lead-timeline" aria-label="Inbox sesi lead">
      {events.map((e) => {
        const st = STATUS[e.status] ?? { label: e.status, tone: "neutral" as Tone };
        const open = e.status === "open" || e.status === "delivered";
        const q = e.question.length > QUESTION_MAX ? `${e.question.slice(0, QUESTION_MAX - 1)}…` : e.question;
        return (
          <li key={e.id} className="hn-lead-item">
            <div className="hn-lead-item-head">
              <Badge tone="brass" size="sm">{KIND_LABEL[e.kind] ?? e.kind}</Badge>
              <Badge tone={st.tone} size="sm">{st.label}</Badge>
              <span className="hn-lead-item-time">{agoLabel(e.createdAt)}</span>
            </div>
            <span className="hn-lead-item-question">{q}</span>
            <div className="hn-lead-item-foot">
              <span className="hn-lead-item-meta">
                <span>{projectName(e.projectId)}</span>
                {e.specId && <span>{e.specId}</span>}
                {open && e.deadlineAt && <span>tenggat {untilLabel(e.deadlineAt)}</span>}
              </span>
              <span className="hn-lead-chips">
                {e.sessionId && (
                  <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGoto(e.sessionId!)}>Buka sesi</Button>
                )}
                {open && (
                  <Button size="sm" variant="secondary" disabled={busyId === e.id} onClick={() => onTake(e)}>
                    Ambil alih
                  </Button>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
