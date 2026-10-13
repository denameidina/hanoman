/* ADR-0220 · Denyut armada: satu jejak EKG per sesi hidup di panel gelap (`--term-*`). Ritme mengikuti
   KEADAAN, bukan `activityAt` (tak ada di SessionDTO; menambahkannya membuat frame `sessions` terkirim
   tiap detik): berjalan = berdetak, menunggu = garis datar putus-putus. Animasi CSS murni (overview.css);
   reduced-motion mematikannya, dan browser menjedanya sendiri di tab tersembunyi. */
import React from "react";
import { Button, DenseRow, Icon, RowList, StatusPill } from "../../ds";
import type { TerminalSession } from "../../api/client";
import type { SpecSlim } from "../types";
import { FLOW_LABEL, STAGE_LABEL, labelOf } from "../../lib/labels";
import { relativeTime } from "../../lib/time-format";

export const DENYUT_MAX = 8;

// Menunggu manusia: cermin pet-state.ts dan Terminal (decision && !deciding). Yang deciding dilayani lead.
export const isWaiting = (s: TerminalSession) => !!s.decision && !s.deciding;

// Yang menunggu di atas; lalu yang lebih lama mulai; sesi tanpa waktu mulai di bawah; lalu per id.
export function sortLive(live: TerminalSession[], specById: Map<string, SpecSlim>): TerminalSession[] {
  const startOf = (s: TerminalSession) => {
    const started = s.specId ? specById.get(s.specId)?.startedAt : null;
    const ms = started ? Date.parse(started) : Number.NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return [...live].sort((a, b) => (Number(!isWaiting(a)) - Number(!isWaiting(b)))
    || (startOf(a) - startOf(b)) || a.id.localeCompare(b.id));
}

// Empat periode detak selebar 100 unit. viewBox menampilkan 200, dan animasi menggeser -50%,
// jadi putarannya mulus tanpa sambungan.
const BEAT = (x: number) => `L${x + 38},12 L${x + 42},3 L${x + 46},21 L${x + 50},12 L${x + 100},12`;
const BEAT_PATH = `M0,12 ${[0, 100, 200, 300].map(BEAT).join(" ")}`;

// Tiga tempo agar baris tak berdetak serempak; dipilih stabil dari id sesi.
const tempoOf = (id: string) => ["a", "b", "c"][[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 3];

function Trace({ id, waiting }: { id: string; waiting: boolean }) {
  return (
    <span className={`hn-ovk-trace hn-ovk-trace--${waiting ? "flat" : tempoOf(id)}`}>
      <svg viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <g className="hn-ovk-trace-run">
          {waiting ? <path d="M0,12 L400,12" /> : <path d={BEAT_PATH} />}
        </g>
      </svg>
    </span>
  );
}

export function Denyut({ live, nameById, specById, now, onOpen, onGoto }: {
  live: TerminalSession[]; nameById: Map<string, string>; specById: Map<string, SpecSlim>; now: number;
  onOpen: (id: string) => void; onGoto: (s: string) => void;
}) {
  const shown = live.slice(0, DENYUT_MAX);
  const rest = live.length - shown.length;
  return (
    <section className="hn-ov-section hn-ovk-denyut" aria-labelledby="ov-live">
      <header className="hn-ov-head">
        <div className="hn-ov-head-text">
          <h3 id="ov-live" className="hn-ovk-kicker">Denyut armada</h3>
          {live.length > 0 && <span className="hn-ov-meta">{live.length} sesi hidup</span>}
        </div>
        <div className="hn-ov-head-actions">
          <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGoto("terminal")}>Buka Terminal</Button>
        </div>
      </header>
      {live.length === 0
        ? <p className="hn-ov-empty">
            <Icon name="terminal" size={14} />
            <span>Tidak ada sesi berjalan</span>
            <span className="hn-ov-meta">Mulai sebuah backlog item untuk membuka sesi Claude Code interaktif.</span>
          </p>
        : <RowList label="Sesi berjalan">
            {shown.map((s) => {
              const waiting = isWaiting(s);
              const spec = s.specId ? specById.get(s.specId) : undefined;
              const fase = waiting ? "Menunggu jawabanmu"
                : spec ? labelOf(STAGE_LABEL, spec.stage) : s.flow ? labelOf(FLOW_LABEL, s.flow) : "Sesi";
              const started = relativeTime(spec?.startedAt, now);
              const name = nameById.get(s.projectId) ?? s.projectId;
              return (
                <DenseRow key={s.id} onClick={() => onOpen(s.id)}
                  actions={waiting ? <Button size="sm" variant="secondary" onClick={() => onOpen(s.id)}>Jawab</Button> : undefined}>
                  <StatusPill status={waiting ? "awaiting" : "running"} variant="dot" size="sm">{fase}</StatusPill>
                  <span className="hn-ov-name" title={name}>{name}</span>
                  <span className="hn-ov-meta">{[spec?.id, started && `dimulai ${started}`].filter(Boolean).join(" · ")}</span>
                  <Trace id={s.id} waiting={waiting} />
                </DenseRow>
              );
            })}
          </RowList>}
      {rest > 0 && (
        <button type="button" className="hn-ov-foot-link hn-ovk-more" onClick={() => onGoto("terminal")}>+{rest} lainnya</button>
      )}
    </section>
  );
}
