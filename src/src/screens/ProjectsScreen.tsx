/* ProjectsScreen — multi-project monitor. Kolom "trigger" hilang bersama subsistem
   trigger; yang berjalan adalah sesi claude di tmux (SPEC-162). */
import React from "react";
import { Card, StatusPill, Badge, ProgressBar, Icon, IconButton, StateBlock, serverPage, Pager,
  LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE } from "../ds";
import { api } from "../api/client";
import { usePersistedState, useScrollRestore, isNum } from "../ui-state";
import type { ProjectVM } from "./types";

function hnCovTone(s: string) { return s === "broken" ? "err" : s === "drift" ? "warn" : "ok"; }
function hnAttention(p: ProjectVM): "high" | "low" | "none" {
  if (p.docStatus === "broken") return "high";
  if (p.docStatus === "drift") return "low";
  return "none";
}
const HN_ATT: Record<string, { bar: string; tint: string; text: string }> = {
  high: { bar: "var(--clay-500)", tint: "var(--clay-100)", text: "var(--clay-600)" },
  low: { bar: "var(--amber-500)", tint: "var(--amber-100)", text: "var(--amber-600)" },
};

function StatStrip({ projects }: { projects: ProjectVM[] }) {
  const activeRuns = projects.filter((p) => p.session.status === "running").length;
  const backlog = projects.reduce((n, p) => n + p.backlog, 0);
  const onConv = projects.filter((p) => p.docStatus === "ok").length;
  const attention = projects.filter((p) => hnAttention(p) === "high").length;
  const stats = [
    { label: "Run aktif", value: activeRuns, dot: "var(--brass-500)" },
    { label: "Total di backlog", value: backlog, dot: "var(--wind-600)" },
    { label: "On convention", value: onConv + "/" + projects.length, dot: "var(--leaf-600)" },
    { label: "Perlu perhatian", value: attention, dot: "var(--clay-600)" },
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1,
      background: "var(--border-hair)", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 20,
    }}>
      {stats.map((s) => (
        <div key={s.label} style={{ background: "var(--surface-card)", padding: "15px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 27, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>{s.value}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function ProjectRow({ p, onOpen, onDelete }:
  { p: ProjectVM; onOpen?: (p: ProjectVM) => void; onDelete?: (p: ProjectVM) => void }) {
  const att = hnAttention(p);
  const running = p.session.status === "running";
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onOpen ? () => onOpen(p) : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "1.7fr 1.2fr 1.5fr 1.1fr 1.4fr",
        alignItems: "center", gap: 12, padding: "11px 14px 11px 12px",
        borderBottom: "1px solid var(--border-hair)",
        borderLeft: `3px solid ${att === "none" ? "transparent" : HN_ATT[att]!.bar}`,
        cursor: onOpen ? "pointer" : "default",
        background: hover && onOpen ? "var(--bone-100)" : "transparent",
        transition: "background 120ms ease",
      }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="box" size={13} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{p.name}</span>
          <Badge tone={p.kind === "from-scratch" ? "brass" : "neutral"} size="sm">{p.kind}</Badge>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</div>
      </div>
      <div><StatusPill status={p.session.status} size="sm">{running && p.session.phase ? p.session.phase : undefined}</StatusPill></div>
      <div style={{ paddingRight: 8 }}><ProgressBar value={p.coverage} showLabel tone={hnCovTone(p.docStatus)} size="sm" /></div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>{p.backlog} · {p.topStage}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.activity}</span>
        {onDelete && (
          <span onClick={(e) => { e.stopPropagation(); onDelete(p); }}>
            <IconButton size="sm" variant="ghost" icon="trash-2" label={"Hapus project " + p.name} />
          </span>
        )}
        {onOpen && <Icon name="chevron-right" size={14} color="var(--text-subtle)" />}
      </div>
    </div>
  );
}

export function ProjectsScreen({ projects, onOpen, onDelete, pageSize, search = "", dataVersion, onClearSearch }:
  { projects: ProjectVM[]; variant?: string; onOpen?: (p: ProjectVM) => void;
    onDelete?: (p: ProjectVM) => void; pageSize?: number;
    search?: string; dataVersion?: number; onClearSearch?: () => void }) {
  const cols = ["Project", "Status", "Docs · SoT", "Backlog", "Aktivitas"];
  const tmpl = "1.7fr 1.2fr 1.5fr 1.1fr 1.4fr";
  // SPEC-198 · search + paginasi via API. StatStrip tetap dari `projects` PENUH (statistik global).
  // Baris = potongan server; seed dari prop utk render instan + tahan mock parsial di test.
  const [rows, setRows] = React.useState<ProjectVM[]>(projects);
  const [total, setTotal] = React.useState(projects.length);
  // SPEC-740 · ADR-0115 · nomor halaman & posisi scroll bertahan; `pageSize` tetap prop.
  const [page, setPage] = usePersistedState("projects", "page", 1, isNum);
  const listRef = useScrollRestore("projects", "scroll", rows.length > 0);
  React.useEffect(() => { setPage(1); }, [search]);
  React.useEffect(() => {
    if (!pageSize) { setRows(projects); setTotal(projects.length); return; }
    let alive = true;
    const p = api.listProjects?.({ q: search || undefined, page, limit: pageSize });
    p?.then((r) => { if (alive) { setRows(r.items as ProjectVM[]); setTotal(r.total); } }).catch(() => { });
    return () => { alive = false; };
  }, [search, page, pageSize, dataVersion, projects]);
  const sp = serverPage(total, page, pageSize || total || 1);
  return (
    <div style={LIST_SCREEN_STYLE}>
      <div style={FIXED_ROW_STYLE}><StatStrip projects={projects} /></div>
      {rows.length === 0 && search ? (
        <StateBlock kind="empty" icon="search" title={`Tidak ada project cocok dengan “${search}”`}
          hint="Coba kata kunci lain, atau kosongkan pencarian."
          action={onClearSearch} actionLabel="Hapus pencarian" actionIcon="x" />
      ) : (
        <Card padding={0} fill>
          <div style={{ ...FIXED_ROW_STYLE, display: "grid", gridTemplateColumns: tmpl, gap: 12, padding: "10px 14px 10px 15px", borderBottom: "1px solid var(--border-hair)" }}>
            {cols.map((c) => <span key={c} className="hn-eyebrow">{c}</span>)}
          </div>
          <div ref={listRef} data-testid="projects-scroll" style={LIST_SCROLL_STYLE}>
            {rows.map((p) => <ProjectRow key={p.id} p={p} onOpen={onOpen} onDelete={onDelete} />)}
          </div>
          {pageSize && <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="project" />}
        </Card>
      )}
    </div>
  );
}
