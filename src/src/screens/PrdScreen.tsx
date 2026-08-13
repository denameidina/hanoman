/* PrdScreen — dokumen PRD (SPEC-210 + perbaikan lintas-project). Two-pane: sidebar kiri daftar
   docs/prd/*.md (freshest-wins) yang bisa diklik, pane kanan preview MarkdownView inline + take ke
   backlog. Filter project punya opsi "Semua project" → listAllPrds() lintas-project, dikelompokkan
   per project. PRD adalah dokumen, bukan entitas DB (ADR-0011/0041). */
import React from "react";
import {
  Badge, Button, Select, Modal, Field, Input, HnTextarea, StateBlock, MarkdownView, Icon,
  DocDownload, LIST_SCREEN_STYLE, FIXED_ROW_STYLE,
} from "../ds";
import { api, type PrdDoc } from "../api/client";
import { PRD_STATUSES, type BreakdownItem, type PrdStatus } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { prdBranchOf } from "./branch";
import { usePersistedState, ResetViewButton, oneOf, nullableStr } from "../ui-state";

export type PrdBriefForm = { title: string; context: string; outcome: string; constraints?: string };
// SPEC-244 · branchFrom = branch yang dibuat sesi PRD (prd/<slug>) — diteruskan ke brief take-to-backlog.
// SPEC-407 · `kind` memilih BENTUK backlog-nya: brief (brainstorm → … → execute) atau goal (sesi
// dua fase yang langsung mengejar goal). `goal` hanya terisi untuk kind goal.
export type PrdPrefill = {
  project: string; title: string; context: string; outcome: string; prdPath: string; branchFrom: string;
  kind?: "brief" | "goal"; goal?: string;
};

// SPEC-340 · ADR-0076 · di-export karena App memakainya ulang untuk eskalasi audit → PRD (brief
// ter-prefill dari rekomendasi audit). `lockProject` mengunci project ke asal auditnya.
export function NewPrdModal({ projects, defaultProject, onClose, onCreate, prefill, lockProject }:
  { projects: ProjectVM[]; defaultProject: string; onClose: () => void;
    onCreate: (project: string, brief: PrdBriefForm) => void;
    prefill?: { title?: string; context?: string; outcome?: string; constraints?: string };
    lockProject?: boolean }) {
  const [project, setProject] = React.useState(defaultProject || projects[0]?.id || "");
  const [f, setF] = React.useState({
    title: prefill?.title ?? "", context: prefill?.context ?? "",
    outcome: prefill?.outcome ?? "", constraints: prefill?.constraints ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = () => {
    if (!f.title.trim() || !project) return;
    onCreate(project, { title: f.title.trim(), context: f.context, outcome: f.outcome, constraints: f.constraints || undefined });
  };
  return (
    <Modal open onClose={onClose} icon="scroll-text" eyebrow="PM → hanoman" title="PRD baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="messages-square" onClick={submit}>Buat brief → brainstorm PRD</Button>
      </>}>
      <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 12, lineHeight: 1.5 }}>
        hanoman membuka sesi brainstorm interaktif di terminal, lalu menulis dokumen PRD ke <code>docs/prd/</code>.
      </div>
      <Field label="Project" hint="Tujuan penulisan docs/prd/ — pilih di sini, tak perlu memfilter daftar dulu">
        <Select aria-label="Project untuk PRD baru" value={project} disabled={lockProject}
          onChange={(e) => setProject(e.target.value)} style={{ width: "100%" }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label="Judul">
        <Input value={f.title} onChange={set("title")} placeholder="mis. Jadwal Invoice Berulang" style={{ width: "100%" }} />
      </Field>
      <Field label="Konteks" hint="Latar belakang & alasan fitur ini dibutuhkan">
        <HnTextarea value={f.context} onChange={set("context")} rows={3} placeholder="mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu" />
      </Field>
      <Field label="Hasil yang diharapkan">
        <HnTextarea value={f.outcome} onChange={set("outcome")} rows={2} placeholder="mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu" />
      </Field>
      <Field label="Batasan" hint="opsional">
        <Input value={f.constraints} onChange={set("constraints")} placeholder="mis. reuse queue yang ada" style={{ width: "100%" }} />
      </Field>
    </Modal>
  );
}

// SPEC-520 · lencana status turunan (draft · dieskalasi · terwujud). Yang punya backlog turunan
// membawa hitungannya supaya "dieskalasi" tak perlu diklik untuk tahu seberapa jauh.
const PRD_STATUS_TONE: Record<PrdStatus, "neutral" | "info" | "ok"> = {
  draft: "neutral", dieskalasi: "info", terwujud: "ok",
};
function PrdStatusBadge({ prd }: { prd: PrdDoc }) {
  return (
    <Badge tone={PRD_STATUS_TONE[prd.status]} size="sm">
      {prd.specCount > 0 ? `${prd.status} ${prd.doneCount}/${prd.specCount}` : prd.status}
    </Badge>
  );
}

// Preview inline (pane kanan) — baca isi PRD, take single ATAU breakdown ke banyak backlog (SPEC-273).
function PrdPreviewPane({ prd, projectId, onTake, onStartBreakdown, onMaterialize }:
  { prd: PrdDoc; projectId: string; onTake: (p: PrdPrefill) => void;
    onStartBreakdown: (project: string, prdPath: string) => void;
    onMaterialize: (project: string, prdPath: string, items: BreakdownItem[]) => Promise<number>; }) {
  const [content, setContent] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<BreakdownItem[]>([]);
  const [include, setInclude] = React.useState<boolean[]>([]);
  const [busy, setBusy] = React.useState(false);
  // SPEC-407 · ADR-0089 · "Take ke backlog" kini pemilih: brief atau goal.
  const [takeOpen, setTakeOpen] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setContent(null);
    api.getPrd(projectId, prd.path)
      .then((r) => { if (alive) setContent(r.content); })
      .catch(() => { if (alive) setContent(""); });
    return () => { alive = false; };
  }, [projectId, prd.path]);

  // SPEC-273 · muat manifest breakdown (bila sesi breakdown sudah menuliskannya) untuk PRD ini.
  React.useEffect(() => {
    let alive = true;
    api.getBreakdown(projectId, prd.path)
      .then((r) => { if (alive) { setItems(r.items); setInclude(r.items.map(() => true)); } })
      .catch(() => { if (alive) { setItems([]); setInclude([]); } });
    return () => { alive = false; };
  }, [projectId, prd.path]);

  // SPEC-244 · branchFrom = branch sesi PRD-nya, dipakai kedua jalur take-to-backlog.
  const takeBase = { project: projectId, title: prd.title, prdPath: prd.path, branchFrom: prdBranchOf(prd.path) };
  const chosen = items.filter((_, i) => include[i]);
  const materialize = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try { await onMaterialize(projectId, prd.path, chosen); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div className="hn-eyebrow" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", marginBottom: 4 }}>{prd.path}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 18, fontWeight: 700, color: "var(--text-strong)" }}>{prd.title}</div>
            <PrdStatusBadge prd={prd} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
          {/* SPEC-361 · unduh PRD sebagai .md / .pdf untuk dibagikan ke tim */}
          <DocDownload href={(f) => api.prdDownloadUrl(projectId, prd.path, f)} disabled={content === null} />
          <Button size="sm" variant="ghost" leftIcon="list-checks" onClick={() => setTakeOpen(true)}>
            Take ke backlog
          </Button>
          <Button size="sm" leftIcon="split"
            onClick={() => onStartBreakdown(projectId, prd.path)}>
            Breakdown ke backlog
          </Button>
        </div>
      </div>

      {items.length > 0 && (
        <div style={{ border: "1px solid var(--brass-200)", borderRadius: "var(--radius-sm)", background: "var(--brass-50)", padding: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, color: "var(--brass-700)" }}>
              Usulan backlog paralel ({chosen.length}/{items.length})
            </div>
            <Button size="sm" leftIcon="plus" disabled={!chosen.length || busy} onClick={materialize}>
              {busy ? "Membuat…" : `Buat ${chosen.length} backlog`}
            </Button>
          </div>
          {items.map((it, i) => (
            <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: i ? "1px solid var(--border-hair)" : "none", cursor: "pointer" }}>
              <input type="checkbox" checked={include[i] ?? false}
                onChange={(e) => setInclude((s) => s.map((v, j) => (j === i ? e.target.checked : v)))} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {it.title} <Badge tone="brass" size="sm">{it.priority}</Badge>
                </div>
                {it.outcome && <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>{it.outcome}</div>}
              </div>
            </label>
          ))}
        </div>
      )}

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        {content === null ? <StateBlock kind="loading" title="Memuat PRD…" />
          : <MarkdownView text={content} name={prd.name} />}
      </div>

      {/* SPEC-407 · ADR-0089 · dua jalur PRD → backlog, dipisah eksplisit karena keduanya
          melahirkan sesi berbentuk beda: brief menjalankan pipeline perencanaan penuh, goal
          langsung mengejar goal-nya dalam dua fase. Manusia yang memutuskan. */}
      {takeOpen && (
        <Modal open onClose={() => setTakeOpen(false)} icon="list-checks"
          eyebrow="PRD → backlog" title="Take PRD ke backlog"
          footer={<Button variant="ghost" size="sm" onClick={() => setTakeOpen(false)}>Batal</Button>}>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <Button leftIcon="lightbulb" onClick={() => {
                setTakeOpen(false);
                onTake({ ...takeBase, kind: "brief", context: `Dari PRD: ${prd.path}`, outcome: "" });
              }}>Sebagai feature brief</Button>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                Sesi menjalankan pipeline penuh: brainstorm → objective → spec → plan → execute.
              </div>
            </div>
            <div>
              <Button leftIcon="target" variant="secondary" onClick={() => {
                setTakeOpen(false);
                onTake({ ...takeBase, kind: "goal", context: "", outcome: "", goal: `Wujudkan PRD ${prd.path}` });
              }}>Sebagai goal</Button>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                Sesi dua fase (Goal → Verifikasi) yang langsung mengejar goal-nya, tanpa brainstorm,
                spec, maupun plan. Mode goal selalu aktif.
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

type PrdGroup = { projectId: string; projectName: string; items: PrdDoc[] };
function groupByProject(items: PrdDoc[]): PrdGroup[] {
  const order: string[] = [];
  const map = new Map<string, PrdGroup>();
  for (const it of items) {
    let g = map.get(it.projectId);
    if (!g) { g = { projectId: it.projectId, projectName: it.projectName, items: [] }; map.set(it.projectId, g); order.push(it.projectId); }
    g.items.push(it);
  }
  return order.map((id) => map.get(id)!);
}

function PrdSidebarItem({ prd, active, onSelect }:
  { prd: PrdDoc; active: boolean; onSelect: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onSelect} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "block", width: "100%", textAlign: "left", cursor: "pointer",
        border: "none", borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: 2,
        background: active ? "var(--brass-100)" : hover ? "var(--bone-200)" : "transparent",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
        <Icon name="scroll-text" size={13} color={active ? "var(--brass-700)" : "var(--brass-500)"} />
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: active ? "var(--brass-700)" : "var(--text-strong)" }}>{prd.title}</span>
        <PrdStatusBadge prd={prd} />
        {/* SPEC-520 · dulu berbunyi "draft hidup"; kata "draft" kini milik status, dan PRD yang
            hidup SEKALIGUS sudah dieskalasi akan memakai dua lencana yang saling membantah. */}
        {prd.live && <Badge tone="brass" size="sm">sesi hidup</Badge>}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{prd.path}</div>
    </button>
  );
}

export function PrdScreen({ projects, projectFilter, onProjectFilter, onNewPrd, onTakeToBacklog, onStartBreakdown, onMaterialize, dataVersion }:
  {
    projects: ProjectVM[]; projectFilter: string; onProjectFilter: (id: string) => void;
    onNewPrd: (project: string, brief: PrdBriefForm) => void;
    onTakeToBacklog: (p: PrdPrefill) => void;
    // SPEC-273 · breakdown: mulai sesi breakdown & materialize usulan jadi N backlog independen.
    onStartBreakdown: (project: string, prdPath: string) => void;
    onMaterialize: (project: string, prdPath: string, items: BreakdownItem[]) => Promise<number>;
    dataVersion?: number;
  }) {
  const [items, setItems] = React.useState<PrdDoc[]>([]);
  // SPEC-740 · ADR-0115 · yang disimpan slug-nya saja, bukan dokumennya: storage hanya
  // untuk parameter tampilan.
  const [selSlug, setSelSlug] = usePersistedState<string | null>("prd", "sel", null, nullableStr);
  const sel = React.useMemo(() => items.find((p) => p.slug === selSlug) ?? null, [items, selSlug]);
  const setSel = React.useCallback((p: PrdDoc | null) => setSelSlug(p ? p.slug : null), [setSelSlug]);
  const [creating, setCreating] = React.useState(false);
  // SPEC-520 · filter status disaring di KLIEN: daftar PRD tak berpaginasi server (pola yang
  // sama dengan filter project di sebelahnya). Guard ketat dari katalog yang sama — status
  // yang sudah tak ada di `PRD_STATUSES` jatuh ke "all", bukan menyaring daftar jadi kosong.
  const [statusFilter, setStatusFilter] = usePersistedState<"all" | PrdStatus>(
    "prd", "status", "all", oneOf<"all" | PrdStatus>("all", ...PRD_STATUSES));
  const all = projectFilter === "all";
  const activeProject = all ? "" : projectFilter; // project target untuk "PRD baru" (perlu satu project)

  // Ganti project / status → buang seleksi (item terpilih bisa tak ada lagi di daftar).
  // Refresh data (dataVersion) tak membuangnya agar preview stabil.
  React.useEffect(() => { setSel(null); }, [projectFilter, statusFilter]);

  React.useEffect(() => {
    let alive = true;
    const load = all ? api.listAllPrds()
      : activeProject ? api.listPrds(activeProject)
      : Promise.resolve({ items: [] as PrdDoc[] });
    load.then((r) => { if (alive) setItems(r.items); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [projectFilter, dataVersion]);

  const visible = statusFilter === "all" ? items : items.filter((p) => p.status === statusFilter);
  const groups = groupByProject(visible);
  const selProject = sel ? (sel.projectId || activeProject) : "";
  const selOpts = [{ value: "all", label: "Semua project" }].concat(projects.map((p) => ({ value: p.id, label: p.name })));

  return (
    <div style={LIST_SCREEN_STYLE}>
      <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Select size="sm" value={projectFilter} aria-label="Project"
            onChange={(e) => onProjectFilter(e.target.value)} options={selOpts} />
          {/* SPEC-520 · memilah mana PRD yang masih perlu ditindaklanjuti tanpa membaca satu per satu. */}
          <Select size="sm" value={statusFilter} aria-label="Status PRD"
            onChange={(e) => setStatusFilter(e.target.value as "all" | PrdStatus)}
            options={[{ value: "all", label: "Semua status" }]
              .concat(PRD_STATUSES.map((s) => ({ value: s, label: s })))} />
          <ResetViewButton screen="prd" active={statusFilter === "all" ? 0 : 1} />
        </div>
        <Button size="sm" leftIcon="plus"
          onClick={() => setCreating(true)}>PRD baru</Button>
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", gap: 16 }}>
        <aside aria-label="Daftar PRD" style={{
          flex: "0 0 264px", minHeight: 0, overflowY: "auto",
          borderRight: "1px solid var(--border-hair)", paddingRight: 12,
        }}>
          {items.length === 0 ? (
            <StateBlock kind="empty" icon="scroll-text" title="Belum ada PRD"
              hint="Buat PRD dari brief + brainstorm; hanoman menulisnya ke docs/prd/ lalu bisa di-take jadi backlog."
              action={() => setCreating(true)} actionLabel="PRD baru" />
          ) : visible.length === 0 ? (
            /* SPEC-520 · tersaring habis ≠ belum ada PRD — menyebut statusnya supaya operator
               tahu filter mana yang harus dilonggarkan. */
            <StateBlock kind="empty" icon="filter" compact
              title={`Tak ada PRD berstatus "${statusFilter}"`}
              hint="Longgarkan filter status untuk melihat PRD lainnya."
              action={() => setStatusFilter("all")} actionLabel="Semua status" />
          ) : groups.map((g) => (
            <div key={g.projectId} style={{ marginBottom: 10 }}>
              {all && (
                <div className="hn-eyebrow" style={{
                  fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
                  textTransform: "uppercase", color: "var(--text-subtle)", padding: "6px 10px 4px",
                }}>{g.projectName}</div>
              )}
              {g.items.map((p) => (
                <PrdSidebarItem key={`${p.projectId}:${p.path}`} prd={p}
                  active={sel?.path === p.path && sel?.projectId === p.projectId}
                  onSelect={() => setSel(p)} />
              ))}
            </div>
          ))}
        </aside>
        <section style={{ flex: "1 1 auto", minHeight: 0 }}>
          {sel ? (
            <PrdPreviewPane prd={sel} projectId={selProject}
              onTake={(pf) => onTakeToBacklog(pf)}
              onStartBreakdown={onStartBreakdown} onMaterialize={onMaterialize} />
          ) : (
            <StateBlock kind="empty" icon="scroll-text" title="Pilih PRD"
              hint="Klik dokumen di daftar kiri untuk melihat isinya, lalu take ke backlog." />
          )}
        </section>
      </div>
      {creating && <NewPrdModal projects={projects} defaultProject={activeProject}
        onClose={() => setCreating(false)}
        onCreate={(project, brief) => { setCreating(false); onNewPrd(project, brief); }} />}
    </div>
  );
}
