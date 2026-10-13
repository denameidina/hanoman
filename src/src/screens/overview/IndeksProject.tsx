import React from "react";
import { Button, DenseRow, Icon, ProgressBar, RowList, StatusPill } from "../../ds";
import { DOC_STATUS_LABEL, labelOf } from "../../lib/labels";
import type { ProjectVM, SpecSlim } from "../types";

function coverageTone(status: string): "err" | "warn" | "ok" {
  return status === "broken" ? "err" : status === "drift" ? "warn" : "ok";
}

/** Tabel bursa project. `projects` = yang TIDAK ada di Koreksi, urut cakupan terendah. */
export function IndeksProject({ projects, total, backlog, onOpen, onGoto }: {
  projects: ProjectVM[]; total: number; backlog: SpecSlim[];
  onOpen: (p: ProjectVM) => void; onGoto: (s: string) => void;
}) {
  const briefN = backlog.filter((s) => s.source === "brief").length;
  const qaN = backlog.filter((s) => s.source === "qa").length;
  const hiPrio = backlog.filter((s) => s.priority === "tinggi").length;
  return (
    <section className="hn-ov-section hn-ovk-indeks" aria-labelledby="ovk-indeks">
      <header className="hn-ov-head">
        <div className="hn-ov-head-text">
          <h3 id="ovk-indeks" className="hn-ovk-kicker">Indeks project</h3>
          {projects.length < total && <span className="hn-ov-meta">{`${projects.length} dari ${total} · sisanya di Koreksi`}</span>}
        </div>
        <div className="hn-ov-head-actions">
          <Button size="sm" variant="ghost" leftIcon="layout-grid" onClick={() => onGoto("projects")}>Semua project</Button>
        </div>
      </header>
      {projects.length === 0
        ? <p className="hn-ov-meta hn-ov-none">Semua project ada di Koreksi.</p>
        : <RowList label="Indeks project" className="hn-ov-prj">
            {projects.map((p) => (
              <DenseRow key={p.id} onClick={() => onOpen(p)}>
                <span className="hn-ov-name" title={p.name}>{p.name}</span>
                <span className="hn-ov-cov">
                  <ProgressBar className="hn-ov-bar" value={p.coverage} tone={coverageTone(p.docStatus)} size="sm"
                    aria-label={`Cakupan dokumen ${p.name}`} valueText={`${p.coverage}%`} />
                  <span className="hn-ov-pct">{p.coverage}%</span>
                </span>
                <span className="hn-ov-prj-status">
                  <StatusPill status={p.docStatus} variant="dot" size="sm">{labelOf(DOC_STATUS_LABEL, p.docStatus)}</StatusPill>
                </span>
                <span className="hn-ov-meta hn-ov-prj-meta">{p.backlog} item terbuka</span>
              </DenseRow>
            ))}
          </RowList>}
      <div className="hn-ov-foot">
        <button type="button" className="hn-ov-foot-link" onClick={() => onGoto("backlog")}>
          <Icon name="list-checks" size={15} />
          <span>Backlog: {briefN} dari brief · {qaN} dari QA · {hiPrio} prioritas tinggi</span>
        </button>
      </div>
    </section>
  );
}
