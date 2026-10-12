// Linimasa 4 langkah satu keluhan. Dipakai bersama oleh Beranda Klien (ClientPortal) dan halaman
// status Help Center publik (PublicHelpApp), supaya keduanya berbicara dengan kosakata yang sama.
import React from "react";
import { ticketNote, ticketTimeline, type StepState } from "./ticket-timeline";
import "./portal.css";

// Teks pembaca layar untuk tiap keadaan: dibaca bersama nama langkahnya, tak bergantung warna.
const SR: Record<StepState, string> = {
  done: "sudah",
  current: "sekarang",
  pending: "belum",
  closed: "tidak dilanjutkan",
};

export function TicketTimeline({ status, compact = false }: { status: string; compact?: boolean }) {
  return (
    <ol className={compact ? "hn-timeline hn-timeline-compact" : "hn-timeline"} aria-label={`Perkembangan laporan: ${status}`}>
      {ticketTimeline(status).map((s) => (
        <li key={s.label} className="hn-timeline-step" data-state={s.state}
          aria-current={s.state === "current" ? "step" : undefined}>
          <span className="hn-timeline-dot" aria-hidden="true" />
          <span className="hn-timeline-label">{s.label}</span>
          <span className="hn-sr-only"> ({SR[s.state]})</span>
        </li>
      ))}
    </ol>
  );
}

/** Kalimat keadaan di bawah linimasa. Dipisah agar kedua layar menulisnya dengan cara yang sama. */
export function TicketNote({ status }: { status: string }) {
  return <p className="hn-timeline-note">{ticketNote(status)}</p>;
}
