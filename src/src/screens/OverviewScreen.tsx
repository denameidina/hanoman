/* OverviewScreen — "Hari ini" (Audit UI/UX 2026-10 · Fase 3B). Satu kolom tanpa KPI strip dan tanpa hero:
   status satu kalimat + CTA kontekstual, sesi berjalan (yang menunggu jawabanmu di atas), perlu perhatian,
   daftar project ringkas, aktivitas terbaru (maks 5), dan satu strip limit bertab. Tiap angka dihitung
   sekali di sini; kalimat status dan seksi memakai hitungan yang sama. Pekerjaan yang berjalan adalah sesi
   claude di tmux (SPEC-162), jadi tak ada progress % atau estimasi biaya. Susunan lewat styles/overview.css. */
import React from "react";
import { Button, DenseRow, Icon, PageHeader, ProgressBar, RowList, StateBlock, StatusPill, Tabs } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, SpecSlim } from "./types";
import { LimitWindows } from "./LimitIndicator";
import { DOC_STATUS_LABEL, FLOW_LABEL, STAGE_LABEL, labelOf } from "../lib/labels";
import { relativeTime } from "../lib/time-format";
import { useLimits } from "../api/limits";
import { useCodexLimits } from "../api/codex-limits";
import "./styles/overview.css";

/** Batas baris "Aktivitas terbaru" (audit: maks 5). */
const ACTIVITY_MAX = 5;

// Dokumen rusak perlu tindakan; drift hanya tidak sinkron. Sesi tak punya status "gagal" yang terbaca dari luar.
function attentionOf(p: ProjectVM): "high" | "low" | "none" {
  return p.docStatus === "broken" ? "high" : p.docStatus === "drift" ? "low" : "none";
}
const ATTENTION_REASON: Record<string, string> = {
  broken: "Dokumen belum memenuhi standar",
  drift: "Sebagian kategori dokumen belum terindeks",
};
function coverageTone(status: string): "err" | "warn" | "ok" {
  return status === "broken" ? "err" : status === "drift" ? "warn" : "ok";
}

// Menunggu manusia: cermin pet-state.ts dan Terminal (decision && !deciding). Yang deciding dilayani lead.
const isWaiting = (s: TerminalSession) => !!s.decision && !s.deciding;

// Yang menunggu di atas; lalu yang lebih lama mulai; sesi tanpa waktu mulai di bawah; lalu per id.
function sortLive(live: TerminalSession[], specById: Map<string, SpecSlim>): TerminalSession[] {
  const startOf = (s: TerminalSession) => {
    const started = s.specId ? specById.get(s.specId)?.startedAt : null;
    const ms = started ? Date.parse(started) : Number.NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return [...live].sort((a, b) => (Number(!isWaiting(a)) - Number(!isWaiting(b)))
    || (startOf(a) - startOf(b)) || a.id.localeCompare(b.id));
}

/** Seksi Overview: judul <h3> yang dirujuk aria-labelledby, aksi opsional di kanan judul. */
function Section({ id, title, meta, actions, children }: {
  id: string; title: string; meta?: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="hn-ov-section" aria-labelledby={id}>
      <header className="hn-ov-head">
        <div className="hn-ov-head-text">
          <h3 id={id} className="hn-ov-title">{title}</h3>
          {meta && <span className="hn-ov-meta">{meta}</span>}
        </div>
        {actions && <div className="hn-ov-head-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function LiveRow({ s, name, spec, now, onOpen }: {
  s: TerminalSession; name: string; spec: SpecSlim | undefined; now: number; onOpen: (id: string) => void;
}) {
  const waiting = isWaiting(s);
  const fase = waiting ? "Menunggu jawabanmu"
    : spec ? labelOf(STAGE_LABEL, spec.stage) : s.flow ? labelOf(FLOW_LABEL, s.flow) : "Sesi";
  const started = relativeTime(spec?.startedAt, now);
  return (
    <DenseRow onClick={() => onOpen(s.id)}
      actions={waiting ? <Button size="sm" variant="secondary" onClick={() => onOpen(s.id)}>Jawab</Button> : undefined}>
      <StatusPill status={waiting ? "awaiting" : "running"} variant="dot" size="sm">{fase}</StatusPill>
      <span className="hn-ov-name" title={name}>{name}</span>
      <span className="hn-ov-meta">{[spec?.id, started && `dimulai ${started}`].filter(Boolean).join(" · ")}</span>
    </DenseRow>
  );
}

function AttnRow({ p, onOpen }: { p: ProjectVM; onOpen: (p: ProjectVM) => void }) {
  return (
    <DenseRow onClick={() => onOpen(p)}>
      <StatusPill status={p.docStatus} variant="dot" size="sm">{labelOf(DOC_STATUS_LABEL, p.docStatus)}</StatusPill>
      <span className="hn-ov-name" title={p.name}>{p.name}</span>
      <span className="hn-ov-meta">{ATTENTION_REASON[p.docStatus] ?? ""}</span>
    </DenseRow>
  );
}

function PrjRow({ p, onOpen }: { p: ProjectVM; onOpen: (p: ProjectVM) => void }) {
  return (
    <DenseRow onClick={() => onOpen(p)}>
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
  );
}

function ActRow({ p, live, onOpen }: { p: ProjectVM; live: boolean; onOpen: (p: ProjectVM) => void }) {
  return (
    <DenseRow onClick={() => onOpen(p)}>
      <StatusPill status={live ? "running" : "idle"} variant="dot" size="sm">{live ? "Berjalan" : "Diam"}</StatusPill>
      <span className="hn-ov-name" title={p.name}>{p.name}</span>
      <span className="hn-ov-activity" title={p.activity}>{p.activity}</span>
      <span className="hn-ov-mono" title={p.commit}>{p.commit}</span>
    </DenseRow>
  );
}

export function OverviewScreen({ projects, backlog, sessions, onOpenProject, onGoto, onOpenSession, onCreateProject }:
  { projects: ProjectVM[]; backlog: SpecSlim[]; sessions: TerminalSession[];
    onOpenProject: (p: ProjectVM) => void; onGoto: (s: string) => void;
    onOpenSession: (id: string) => void;
    /** Membuka modal project baru langsung (CTA onboarding); tanpa ini jatuh ke halaman Projects. */
    onCreateProject?: () => void }) {
  const limits = useLimits();
  const codexLimits = useCodexLimits();   // SPEC-338 · kartu limit codex (grup siar terpisah)
  const [limitTab, setLimitTab] = React.useState<"claude" | "codex">("claude");
  const now = Date.now();

  // Tanpa project tak ada yang bisa diringkas: satu jalan masuk, bukan kartu kosong "0/0".
  if (projects.length === 0) {
    return (
      <div className="hn-ov">
        <PageHeader title="Hari ini" description="Belum ada project di workspace." />
        <Section id="ov-start" title="Selamat datang di hanoman" meta="mulai di sini">
          <StateBlock kind="empty" illustration="PST-001" illustrationDecorative
            title="Buat project pertama"
            hint="hanoman mengerjakan backlog di dalam sebuah project. Tambahkan project (folder repo) dulu; dokumen, backlog, dan sesi Claude Code-nya akan tampil di sini."
            action={() => (onCreateProject ? onCreateProject() : onGoto("projects"))} actionLabel="Buat project pertama" />
        </Section>
      </div>
    );
  }

  const specById = new Map(backlog.map((s) => [s.id, s] as const));
  const liveAll = sessions.filter((s) => !s.exited);
  const live = sortLive(liveAll, specById);
  const waiting = live.filter(isWaiting);
  const liveProjects = new Set(liveAll.map((s) => s.projectId));
  const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
  const attention = projects.filter((p) => attentionOf(p) !== "none")
    .sort((a, b) => (attentionOf(a) === "high" ? 0 : 1) - (attentionOf(b) === "high" ? 0 : 1));
  const byCoverage = [...projects].sort((a, b) => a.coverage - b.coverage);
  const activity = [...projects]
    .sort((a, b) => Number(liveProjects.has(b.id)) - Number(liveProjects.has(a.id)))
    .slice(0, ACTIVITY_MAX);
  const briefN = backlog.filter((s) => s.source === "brief").length;
  const qaN = backlog.filter((s) => s.source === "qa").length;
  const hiPrio = backlog.filter((s) => s.priority === "tinggi").length;

  // Satu kalimat status. Angkanya sama dengan seksi di bawahnya (satu hitungan, bukan dua).
  const summary = [
    live.length === 0 ? "Tidak ada sesi berjalan" : `${live.length} sesi berjalan`,
    waiting.length > 0 ? `${waiting.length} menunggu jawabanmu` : null,
    attention.length > 0 ? `${attention.length} perlu perhatian` : null,
  ].filter(Boolean).join(" · ");

  // CTA primer kontekstual: jawab yang menunggu lebih dulu, lalu backlog.
  const primary = waiting.length > 0
    ? <Button variant="primary" leftIcon="hand" onClick={() => onOpenSession(waiting[0]!.id)}>Jawab sesi yang menunggu</Button>
    : <Button variant="primary" leftIcon="list-checks" onClick={() => onGoto("backlog")}>Buka backlog</Button>;

  // Limit: satu seksi. Bila codex pernah melapor kuota, tab Claude/Codex; meta mengikuti tab.
  // Codex sengaja "tercatat" (angka dari sesi terakhir), Claude "langsung" (siaran realtime).
  const codexOn = codexLimits.status !== "unavailable";
  const tab = codexOn ? limitTab : "claude";
  const limitMeta = tab === "codex"
    ? `tercatat · Codex${codexLimits.plan ? ` · ${codexLimits.plan}` : ""}`
    : "langsung · Claude";

  return (
    <div className="hn-ov">
      <PageHeader title="Hari ini" description={summary}
        actions={<>{primary}<Button variant="ghost" leftIcon="drama" onClick={() => onGoto("dalang")}>Buka panggung</Button></>} />

      <Section id="ov-live" title="Sesi berjalan"
        actions={<Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGoto("terminal")}>Buka Terminal</Button>}>
        {live.length === 0
          ? <StateBlock kind="empty" compact icon="terminal" title="Tidak ada sesi aktif"
              hint="Mulai sebuah backlog item untuk membuka sesi Claude Code interaktif." />
          : <RowList label="Sesi berjalan">
              {live.map((s) => (
                <LiveRow key={s.id} s={s} name={nameById.get(s.projectId) ?? s.projectId}
                  spec={s.specId ? specById.get(s.specId) : undefined} now={now} onOpen={onOpenSession} />
              ))}
            </RowList>}
      </Section>

      <Section id="ov-attn" title="Perlu perhatian">
        {attention.length === 0
          ? <StateBlock kind="empty" compact icon="book-open" title="Dokumen sudah sesuai standar"
              hint="Semua project tidak punya masalah dokumen yang perlu ditindak." />
          : <RowList label="Perlu perhatian" className="hn-ov-attn">
              {attention.map((p) => <AttnRow key={p.id} p={p} onOpen={onOpenProject} />)}
            </RowList>}
      </Section>

      <Section id="ov-prj" title="Project"
        actions={<Button size="sm" variant="ghost" leftIcon="layout-grid" onClick={() => onGoto("projects")}>Semua project</Button>}>
        <RowList label="Project" className="hn-ov-prj">
          {byCoverage.map((p) => <PrjRow key={p.id} p={p} onOpen={onOpenProject} />)}
        </RowList>
        <div className="hn-ov-foot">
          {/* Angka backlog membuka layarnya (aturan minimalis: tiap KPI membuka layar relevan). Bukan `Button`
              DS: lihat `.hn-ov-foot-link` di overview.css. */}
          <button type="button" className="hn-ov-foot-link" onClick={() => onGoto("backlog")}>
            <Icon name="list-checks" size={15} />
            <span>Backlog: {briefN} dari brief · {qaN} dari QA · {hiPrio} prioritas tinggi</span>
          </button>
        </div>
      </Section>

      <Section id="ov-act" title="Aktivitas terbaru">
        <RowList label="Aktivitas terbaru" className="hn-ov-act">
          {activity.map((p) => <ActRow key={p.id} p={p} live={liveProjects.has(p.id)} onOpen={onOpenProject} />)}
        </RowList>
      </Section>

      <Section id="ov-limit" title="Limit langganan" meta={limitMeta}>
        {codexOn && (
          <Tabs aria-label="Sumber limit" value={tab}
            tabs={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]}
            onChange={(v) => setLimitTab(v === "codex" ? "codex" : "claude")} />
        )}
        <div className="hn-ov-limit">
          <LimitWindows dto={tab === "codex" ? codexLimits : limits} />
        </div>
      </Section>
    </div>
  );
}
