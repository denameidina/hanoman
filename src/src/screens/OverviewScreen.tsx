/* OverviewScreen — "Koran Pagi" (ADR-0220). Halaman depan surat kabar: masthead, headline template dari
   server, kotak Koreksi (project broken/drift), lalu kolom-kolom panel. Agregat datang dari grup siar
   `overview` (prop `overview`, null sampai frame pertama tiba). Susunan lewat styles/overview.css; berkas
   ini tanpa style inline. Mengamandemen susunan Fase 3B (Audit UI/UX 2026-10). */
import React from "react";
import type { OverviewDTO } from "@hanoman/shared";
import { Button, PageHeader, StateBlock, Tabs } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, SpecSlim } from "./types";
import { LimitWindows } from "./LimitIndicator";
import { useLimits } from "../api/limits";
import { useCodexLimits } from "../api/codex-limits";
import { Masthead } from "./overview/Masthead";
import { Headline } from "./overview/Headline";
import { Koreksi, attentionOf } from "./overview/Koreksi";
import { IndeksProject } from "./overview/IndeksProject";
import { Denyut, isWaiting, sortLive } from "./overview/Denyut";
import "./styles/overview.css";

export function OverviewScreen({ projects, backlog, sessions, overview = null, onOpenProject, onGoto, onOpenSession, onCreateProject }:
  { projects: ProjectVM[]; backlog: SpecSlim[]; sessions: TerminalSession[];
    /** ADR-0220 · agregat dari grup siar `overview`; null sampai frame pertama tiba. */
    overview?: OverviewDTO | null;
    onOpenProject: (p: ProjectVM) => void; onGoto: (s: string) => void;
    onOpenSession: (id: string) => void;
    /** Membuka modal project baru langsung (CTA onboarding); tanpa ini jatuh ke halaman Projects. */
    onCreateProject?: () => void }) {
  const limits = useLimits();
  const codexLimits = useCodexLimits();
  const [limitTab, setLimitTab] = React.useState<"claude" | "codex">("claude");
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

  const codexOn = codexLimits.status !== "unavailable";
  const tab = codexOn ? limitTab : "claude";
  const limitMeta = tab === "codex"
    ? `tercatat · Codex${codexLimits.plan ? ` · ${codexLimits.plan}` : ""}`
    : "langsung · Claude";

  return (
    <div className="hn-ov hn-ovk">
      <Masthead now={now} projectCount={projects.length} />
      <PageHeader className="hn-ov-pagehead" title="Hari ini" description={summary}
        actions={<>{primary}<Button variant="ghost" leftIcon="drama" onClick={() => onGoto("dalang")}>Buka panggung</Button></>} />
      <Headline overview={overview} />
      <Koreksi projects={projects} onOpen={onOpenProject} />

      <div className="hn-ovk-cols">
        <div className="hn-ovk-col hn-ovk-col--lead">
          <Denyut live={live} nameById={nameById} specById={specById} now={now} onOpen={onOpenSession} onGoto={onGoto} />
        </div>
        <div className="hn-ovk-col hn-ovk-col--side">
          <section className="hn-ov-section" aria-labelledby="ov-limit">
            <header className="hn-ov-head"><div className="hn-ov-head-text">
              <h3 id="ov-limit" className="hn-ovk-kicker">Limit langganan</h3>
              <span className="hn-ov-meta">{limitMeta}</span>
            </div></header>
            {codexOn && (
              <Tabs aria-label="Sumber limit" value={tab}
                tabs={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]}
                onChange={(v) => setLimitTab(v === "codex" ? "codex" : "claude")} />
            )}
            <div className="hn-ov-limit"><LimitWindows dto={tab === "codex" ? codexLimits : limits} /></div>
          </section>
        </div>
      </div>

      <IndeksProject projects={others} total={projects.length} backlog={backlog} onOpen={onOpenProject} onGoto={onGoto} />
    </div>
  );
}
