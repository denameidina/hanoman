/* OverviewScreen — "Koran Pagi" (ADR-0220). Halaman depan surat kabar: masthead, headline template dari
   server, kotak Koreksi (project broken/drift), lalu kolom-kolom panel. Agregat datang dari grup siar
   `overview` (prop `overview`, null sampai frame pertama tiba). Susunan lewat styles/overview.css; berkas
   ini tanpa style inline. Mengamandemen susunan Fase 3B (Audit UI/UX 2026-10). */
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { Button, PageHeader, StateBlock } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, SpecSlim } from "./types";
import { Masthead } from "./overview/Masthead";
import { Headline } from "./overview/Headline";
import { Koreksi, attentionOf } from "./overview/Koreksi";
import { IndeksProject } from "./overview/IndeksProject";
import { Denyut, isWaiting, sortLive } from "./overview/Denyut";
import { Bottleneck } from "./overview/Bottleneck";
import { SungaiSpec } from "./overview/SungaiSpec";
import { Rekor } from "./overview/Rekor";
import { Bensin } from "./overview/Bensin";
import { EkonomiToken } from "./overview/EkonomiToken";
import { PetaPanas } from "./overview/PetaPanas";
import "./styles/overview.css";

export function OverviewScreen({ projects, backlog, sessions, overview = null, onOpenProject, onGoto, onOpenSession, onCreateProject }:
  { projects: ProjectVM[]; backlog: SpecSlim[]; sessions: TerminalSession[];
    /** ADR-0220 · agregat dari grup siar `overview`; null sampai frame pertama tiba. */
    overview?: OverviewDTO | null;
    onOpenProject: (p: ProjectVM) => void; onGoto: (s: string) => void;
    onOpenSession: (id: string) => void;
    /** Membuka modal project baru langsung (CTA onboarding); tanpa ini jatuh ke halaman Projects. */
    onCreateProject?: () => void }) {
  const now = Date.now();

  if (projects.length === 0) {
    return (
      <div className="hn-ov">
        <PageHeader className="hn-ov-pagehead" title="Hari ini" description="Belum ada project di workspace." />
        <section className="hn-ov-section" aria-labelledby="ov-start">
          <header className="hn-ov-head"><div className="hn-ov-head-text">
            <h3 id="ov-start" className="hn-ov-title">Selamat datang di hanoman</h3>
            <span className="hn-ov-meta">mulai di sini</span>
          </div></header>
          <StateBlock kind="empty" illustration="PST-001" illustrationDecorative
            title="Buat project pertama"
            hint="hanoman mengerjakan backlog di dalam sebuah project. Tambahkan project (folder repo) dulu; dokumen, backlog, dan sesi Claude Code-nya akan tampil di sini."
            action={() => (onCreateProject ? onCreateProject() : onGoto("projects"))} actionLabel="Buat project pertama" />
        </section>
      </div>
    );
  }

  const specById = new Map(backlog.map((s) => [s.id, s] as const));
  const live = sortLive(sessions.filter((s) => !s.exited), specById);
  const waiting = live.filter(isWaiting);
  const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
  const attentionN = projects.filter((p) => attentionOf(p) !== "none").length;
  const others = projects.filter((p) => attentionOf(p) === "none").sort((a, b) => a.coverage - b.coverage);

  const summary = [
    live.length > 0 ? `${live.length} sesi berjalan` : null,
    waiting.length > 0 ? `${waiting.length} menunggu jawabanmu` : null,
    attentionN > 0 ? `${attentionN} perlu perhatian` : null,
  ].filter(Boolean).join(" · ");

  const primary = waiting.length > 0
    ? <Button variant="primary" leftIcon="hand" onClick={() => onOpenSession(waiting[0]!.id)}>Jawab sesi yang menunggu</Button>
    : <Button variant="primary" leftIcon="list-checks" onClick={() => onGoto("backlog")}>Buka backlog</Button>;

  return (
    <div className="hn-ov hn-ovk">
      <Masthead now={now} projectCount={projects.length} />
      <PageHeader className="hn-ov-pagehead" title="Hari ini" description={summary}
        actions={<>{primary}<Button variant="ghost" leftIcon="drama" onClick={() => onGoto("dalang")}>Buka panggung</Button></>} />
      <Headline overview={overview} />
      <Koreksi projects={projects} onOpen={onOpenProject} />

      {/* Badge limit di Shell tetap memakai `LimitWindows` (LimitIndicator.tsx); di layar ini panel Bensin. */}
      <div className="hn-ovk-cols">
        <div className="hn-ovk-col hn-ovk-col--lead">
          <Denyut live={live} nameById={nameById} specById={specById} now={now} onOpen={onOpenSession} onGoto={onGoto} />
          <Bottleneck overview={overview} now={now} />
        </div>
        <div className="hn-ovk-col hn-ovk-col--mid">
          <SungaiSpec overview={overview} now={now} />
          <Rekor overview={overview} now={now} />
        </div>
        <div className="hn-ovk-col hn-ovk-col--side">
          <Bensin overview={overview} now={now} />
          <EkonomiToken overview={overview} now={now} />
        </div>
      </div>
      <PetaPanas overview={overview} now={now} />

      <IndeksProject projects={others} total={projects.length} backlog={backlog} onOpen={onOpenProject} onGoto={onGoto} />
    </div>
  );
}
