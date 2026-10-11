/* OverviewScreen — ringkasan workspace. Pekerjaan yang berjalan adalah sesi claude di
   tmux, bukan baris Run (SPEC-162): tak ada progress %, tak ada estimasi biaya.
   Setiap angka hanya tampil di satu tempat (judul/eyebrow kartu); tak ada KPI yang
   mengulang kartu di bawahnya (audit 2026-10, Overview: duplikasi). */
import React from "react";
import { Card, StatusPill, Badge, ProgressBar, Icon, Button, StateBlock, Tabs } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, SpecSlim } from "./types";
import { LimitWindows } from "./LimitIndicator";
import { DalangStage, FLOW_LABEL, STAGE_LABEL } from "./DalangStage";
import { useLimits } from "../api/limits";
import { useCodexLimits } from "../api/codex-limits";

// Satu sumber untuk kata status dokumen — dipakai pill, badge, dan judul baris.
const DOC_LABEL: Record<string, string> = { ok: "Sesuai standar", drift: "Tidak sinkron", broken: "Belum sesuai" };
function oCovTone(s: string) { return s === "broken" ? "err" : s === "drift" ? "warn" : "ok"; }
// Sesi tak punya status "failed" yang terbaca dari luar — yang gagal terlihat di terminalnya.
function oAttention(p: ProjectVM): "high" | "low" | "none" {
  if (p.docStatus === "broken") return "high";
  if (p.docStatus === "drift") return "low";
  return "none";
}
const O_ATT: Record<string, { bar: string; tint: string; text: string; label: string; reason: string }> = {
  high: { bar: "var(--clay-500)", tint: "var(--clay-100)", text: "var(--clay-600)", label: "Dokumentasi belum sesuai",
    reason: "Dokumen belum memenuhi standar" },
  low: { bar: "var(--amber-500)", tint: "var(--amber-100)", text: "var(--status-warn)", label: "Dokumentasi tidak sinkron",
    reason: "Sebagian kategori dokumen belum ter-index" },
};

// Urutan sesi hidup: yang sudah lebih lama mulai di atas; sesi tanpa waktu mulai di bawah, lalu per id.
function sortLive(live: TerminalSession[], backlog: SpecSlim[]): TerminalSession[] {
  const startedById = new Map(backlog.map((x) => [x.id, x.startedAt] as const));
  const startOf = (s: TerminalSession) => {
    const ms = s.specId && startedById.get(s.specId) ? Date.parse(startedById.get(s.specId)!) : NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return [...live].sort((a, b) => (startOf(a) - startOf(b)) || a.id.localeCompare(b.id));
}

function AttnRow({ p, onOpen }: { p: ProjectVM; onOpen: (p: ProjectVM) => void }) {
  const att = oAttention(p);
  const meta = O_ATT[att]!;
  return (
    // SPEC-763 · tanpa `hn-dense-row` tombol "Buka dokumen" menahan lebarnya di 390px dan menyisakan
    // ~67px untuk nama project — terukur: `crm-tumbuh-ai` pecah jadi 3 baris (4 karakter/baris).
    <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: "1px solid var(--border-hair)", borderLeft: `3px solid ${meta.bar}`, paddingLeft: 12 }}>
      <div className="hn-grow" style={{ minWidth: 0, flex: 1 }}>
        <div className="hn-wrap-mobile" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="box" size={13} color="var(--text-muted)" />
          <span title={p.name} style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{p.name}</span>
          <Badge tone={att === "high" ? "err" : "warn"} size="sm">{meta.label}</Badge>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{meta.reason} · {p.coverage}% ter-index</div>
      </div>
      <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => onOpen(p)}>Buka dokumen</Button>
    </div>
  );
}

/* Baris sesi = sesi tmux HIDUP dari siaran WS, bukan `ProjectView.session` yang hanya dimuat saat
   login. Label tahap memakai `Spec.stage` (overlay live) — fase sesi tak ada di wire ini. Baris
   memakai <button> asli: klik dan Enter/Spasi datang gratis, dan konsisten dengan baris lain. */
function LiveSessionRow({ s, name, stage, onOpenSession }: {
  s: TerminalSession; name: string; stage: string | null; onOpenSession: (id: string) => void;
}) {
  return (
    <button type="button" className="hn-dense-row" onClick={() => onOpenSession(s.id)} style={rowBtn}>
      <StatusPill status="running" size="sm">{stage ?? FLOW_LABEL[s.flow ?? ""] ?? "Sesi"}</StatusPill>
      <span className="hn-grow" title={name} style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{s.specId ?? ""}</span>
    </button>
  );
}

const rowBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 4px",
  background: "none", border: 0, borderBottom: "1px solid var(--border-hair)", cursor: "pointer",
  textAlign: "left", font: "inherit", color: "inherit",
};

function CoverageRow({ p, onOpen }: { p: ProjectVM; onOpen: (p: ProjectVM) => void }) {
  return (
    <button type="button" className="hn-grid-mobile" onClick={() => onOpen(p)}
      style={{ ...rowBtn, display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 136px", alignItems: "center", gap: 12, padding: "9px 4px" }}>
      <span title={p.name} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
      <ProgressBar value={p.coverage} tone={oCovTone(p.docStatus)} size="sm" />
      {/* kolom 136px memuat "Sesuai standar" (~121px dengan dot & padding); justifySelf:end bikin
          pill seukuran konten & rata kanan — bukan stretch yang bikin teks tumpah dari pill. */}
      <StatusPill status={p.docStatus} size="sm" style={{ justifySelf: "end" }}>{DOC_LABEL[p.docStatus] ?? p.docStatus}</StatusPill>
    </button>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: string; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)", background: "var(--bone-100)" }}>
      <span style={{ width: 30, height: 30, borderRadius: "var(--radius-sm)", flex: "0 0 auto", background: "var(--surface-card)", border: "1px solid var(--border-hair)", color: tone || "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={15} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>{label}</div>
      </div>
    </div>
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

  // Sesi hidup dari siaran WS `t:"sessions"` — `ProjectView.session` basi sejak login.
  const live = sortLive(sessions.filter((s) => !s.exited), backlog);
  const liveProjects = new Set(live.map((s) => s.projectId));
  const attention = projects.filter((p) => oAttention(p) !== "none")
    .sort((a, b) => (oAttention(a) === "high" ? 0 : 1) - (oAttention(b) === "high" ? 0 : 1));
  const coverageSorted = [...projects].sort((a, b) => a.coverage - b.coverage);
  const briefN = backlog.filter((s) => s.source === "brief").length;
  const qaN = backlog.filter((s) => s.source === "qa").length;
  const hiPrio = backlog.filter((s) => s.priority === "tinggi").length;

  // Tanpa project tak ada yang bisa diringkas: tampilkan jalan masuk, bukan kartu kosong "0/0".
  if (projects.length === 0) {
    return (
      <Card eyebrow="mulai di sini" title="Selamat datang di hanoman">
        <StateBlock kind="empty" illustration="PST-001" illustrationDecorative
          title="Buat project pertama"
          hint="hanoman mengerjakan backlog di dalam sebuah project. Tambahkan project (folder repo) dulu; dokumen, backlog, dan sesi Claude Code-nya akan tampil di sini."
          action={() => (onCreateProject ? onCreateProject() : onGoto("projects"))} actionLabel="Buat project pertama" />
      </Card>
    );
  }

  // Limit: satu kartu. Bila codex pernah melapor kuota, tab Claude/Codex; eyebrow mengikuti tab.
  // Codex sengaja "tercatat" (angka dari sesi terakhir), Claude "langsung" (siaran realtime).
  const codexOn = codexLimits.status !== "unavailable";
  const tab = codexOn ? limitTab : "claude";
  const limitEyebrow = tab === "codex"
    ? `tercatat · Codex${codexLimits.plan ? ` · ${codexLimits.plan}` : ""}`
    : "langsung · Claude";

  const activity = projects.map((p) => ({ project: p, text: p.activity, commit: p.commit, live: liveProjects.has(p.id) }));
  const stageOf = (s: TerminalSession) => {
    const spec = s.specId ? backlog.find((x) => x.id === s.specId) : undefined;
    return spec ? (STAGE_LABEL[spec.stage] ?? spec.stage) : null;
  };

  return (
    <div>
      <DalangStage projects={projects} backlog={backlog} sessions={sessions}
        onOpenSession={onOpenSession} onOpenProject={onOpenProject} />
      <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 20, alignItems: "start", marginTop: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card eyebrow={`dokumen · ${attention.length} project`} title="Perlu perhatian"
            actions={<Button size="sm" variant="ghost" leftIcon="layout-grid" onClick={() => onGoto("projects")}>Semua project</Button>}>
            {attention.length === 0
              ? <StateBlock kind="empty" compact icon="book-open" title="Dokumen sudah sesuai standar"
                  hint="Semua project tidak punya masalah dokumen yang perlu ditindak." />
              : <div style={{ marginTop: 4 }}>{attention.map((p) => <AttnRow key={p.id} p={p} onOpen={onOpenProject} />)}</div>}
          </Card>
          <Card eyebrow={`sesi · ${live.length} berjalan`} title="Claude Code sedang jalan"
            actions={<Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGoto("terminal")}>Buka Terminal</Button>}>
            {live.length === 0
              ? <StateBlock kind="empty" compact icon="terminal" title="Tidak ada sesi aktif"
                  hint="Mulai sebuah backlog item untuk membuka sesi Claude Code interaktif." />
              : <ul data-testid="live-list" style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
                  {live.map((s) => {
                    const name = projects.find((p) => p.id === s.projectId)?.name ?? s.projectId;
                    return <li key={s.id}><LiveSessionRow s={s} name={name} stage={stageOf(s)} onOpenSession={onOpenSession} /></li>;
                  })}
                </ul>}
          </Card>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card eyebrow={limitEyebrow} title="Limit langganan">
            {codexOn && (
              <Tabs aria-label="Sumber limit" value={tab}
                tabs={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]}
                onChange={(v) => setLimitTab(v === "codex" ? "codex" : "claude")} />
            )}
            <div style={{ marginTop: 10 }}>
              <LimitWindows dto={tab === "codex" ? codexLimits : limits} />
            </div>
          </Card>
          <Card eyebrow="dokumen" title="Cakupan dokumen"
            actions={<Button size="sm" variant="ghost" leftIcon="book-open" onClick={() => onGoto("docs")}>Dokumen</Button>}>
            <div style={{ marginTop: 4 }}>{coverageSorted.map((p) => <CoverageRow key={p.id} p={p} onOpen={onOpenProject} />)}</div>
          </Card>
          <Card eyebrow="dari brief sampai eksekusi" title="Backlog"
            actions={<Button size="sm" variant="ghost" leftIcon="list-checks" onClick={() => onGoto("backlog")}>Buka</Button>}>
            <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              <MiniStat icon="lightbulb" label="dari brief" value={briefN} tone="var(--brass-700)" />
              <MiniStat icon="bug" label="dari QA" value={qaN} tone="var(--clay-500)" />
              <MiniStat icon="flame" label="prioritas tinggi" value={hiPrio} tone="var(--clay-500)" />
            </div>
          </Card>
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <Card eyebrow="per project" title="Aktivitas terbaru">
          {/* Daftar semantik: tiap baris membuka project-nya, sama seperti baris cakupan & perhatian. */}
          <ul data-testid="activity-list" style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
            {activity.map((a) => (
              <li key={a.project.id}>
                <button type="button" className="hn-dense-row" onClick={() => onOpenProject(a.project)}
                  style={{ ...rowBtn, alignItems: "center", gap: 12, padding: "9px 4px" }}>
                  <StatusPill status={a.live ? "running" : "idle"} size="sm">{a.live ? "Berjalan" : "Diam"}</StatusPill>
                  <span title={a.project.name} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", width: 120, flex: "0 0 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.project.name}</span>
                  <span className="hn-grow" title={a.text} style={{ fontSize: 12.5, color: "var(--text-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.text}</span>
                  <span title={a.commit} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{a.commit}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
