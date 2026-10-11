/* PrdScreen — dokumen PRD (SPEC-210 + perbaikan lintas-project). Two-pane: sidebar kiri daftar
   docs/prd/*.md (freshest-wins) yang bisa diklik, pane kanan preview MarkdownView inline + take ke
   backlog. Filter project punya opsi "Semua project" → listAllPrds() lintas-project, dikelompokkan
   per project. PRD adalah dokumen, bukan entitas DB (ADR-0011/0041).

   Audit 2026-10: seleksi tersimpan tak lagi dibuang saat mount; galat & loading dibedakan dari
   "Belum ada PRD" di daftar maupun isi; usulan breakdown ikut dataVersion; "Take ke backlog" jadi
   aksi utama dan "Breakdown" sekunder; status tampil dalam bahasa Indonesia. */
import React from "react";
import { PortalChatPanel } from "./PortalChatPanel";
import {
  Badge, Button, Select, Modal, Field, Input, HnTextarea, StateBlock, MarkdownView, Icon,
  DocDownload, LIST_SCREEN_STYLE, FIXED_ROW_STYLE, ResponsivePanels, useCoarsePointer,
} from "../ds";
import { api, type PrdDoc } from "../api/client";
import { PRD_STATUSES, type BreakdownItem, type PrdStatus } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { prdBranchOf } from "./branch";
import { usePersistedState, ResetViewButton, oneOf, nullableStr } from "../ui-state";
import { errorMessage } from "../lib/report-error";

export type PrdBriefForm = { title: string; context: string; outcome: string; constraints?: string };
// SPEC-244 · branchFrom = branch yang dibuat sesi PRD (prd/<slug>) — diteruskan ke brief take-to-backlog.
// SPEC-407 · `kind` memilih BENTUK backlog-nya: brief (brainstorm → … → execute) atau goal (sesi
// dua fase yang langsung mengejar goal). `goal` hanya terisi untuk kind goal.
export type PrdPrefill = {
  project: string; title: string; context: string; outcome: string; prdPath: string; branchFrom: string;
  kind?: "brief" | "goal"; goal?: string;
};

// SPEC-520 · status turunan PRD dalam bahasa Indonesia (bukan enum mentah).
export const PRD_STATUS_LABEL: Record<PrdStatus, string> = {
  draft: "Draf", dieskalasi: "Dieskalasi", terwujud: "Terwujud",
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
  // Audit 2026-10: "Buat brief" nonaktif tanpa judul dan hint menyebut sebabnya — tombol yang
  // mati tanpa alasan lebih buruk daripada galat yang jelas.
  const canSubmit = !!f.title.trim() && !!project;
  const submit = () => {
    if (!canSubmit) return;
    onCreate(project, { title: f.title.trim(), context: f.context, outcome: f.outcome, constraints: f.constraints || undefined });
  };
  const required = <span aria-hidden="true" style={{ color: "var(--clay-600)", marginLeft: 3 }}>*</span>;
  return (
    <Modal open onClose={onClose} icon="scroll-text" eyebrow="PM → hanoman" title="PRD baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="messages-square" onClick={submit} disabled={!canSubmit}>Buat brief → brainstorm PRD</Button>
      </>}>
      <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 12, lineHeight: 1.5 }}>
        hanoman membuka sesi brainstorm interaktif di terminal, lalu menulis dokumen PRD ke <code>docs/prd/</code>.
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginBottom: 12 }}>
        <span aria-hidden="true" style={{ color: "var(--clay-600)" }}>*</span> wajib diisi
      </div>
      <Field label={<>Project{required}</>} hint="Tujuan penulisan docs/prd/ — pilih di sini, tak perlu memfilter daftar dulu">
        <Select aria-label="Project untuk PRD baru" value={project} disabled={lockProject}
          onChange={(e) => setProject(e.target.value)} style={{ width: "100%" }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label={<>Judul{required}</>}
        hint={f.title.trim() ? undefined : "Wajib diisi — tanpa judul, brief tak bisa dibuat."}>
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
  const label = PRD_STATUS_LABEL[prd.status] ?? prd.status;
  return (
    <Badge tone={PRD_STATUS_TONE[prd.status]} size="sm">
      {prd.specCount > 0 ? `${label} ${prd.doneCount}/${prd.specCount}` : label}
    </Badge>
  );
}

// Preview inline (pane kanan) — baca isi PRD, take single ATAU breakdown ke banyak backlog (SPEC-273).
function PrdPreviewPane({ prd, projectId, dataVersion, onTake, onStartBreakdown, onMaterialize }:
  { prd: PrdDoc; projectId: string; dataVersion?: number; onTake: (p: PrdPrefill) => void;
    onStartBreakdown: (project: string, prdPath: string) => void;
    onMaterialize: (project: string, prdPath: string, items: BreakdownItem[]) => Promise<number>; }) {
  const coarse = useCoarsePointer();
  const [content, setContent] = React.useState<string | null>(null);
  const [contentError, setContentError] = React.useState("");
  const [contentRetry, setContentRetry] = React.useState(0);
  const [items, setItems] = React.useState<BreakdownItem[]>([]);
  const [include, setInclude] = React.useState<boolean[]>([]);
  const [breakdownError, setBreakdownError] = React.useState("");
  const [breakdownRetry, setBreakdownRetry] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  // SPEC-407 · ADR-0089 · "Take ke backlog" kini pemilih: brief atau goal.
  const [takeOpen, setTakeOpen] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setContent(null); setContentError("");
    api.getPrd(projectId, prd.path)
      .then((r) => { if (alive) setContent(r.content); })
      .catch((e: unknown) => { if (alive) setContentError(errorMessage(e, "tidak diketahui")); });
    return () => { alive = false; };
  }, [projectId, prd.path, contentRetry]);

  // SPEC-273 · muat manifest breakdown (bila sesi breakdown sudah menuliskannya) untuk PRD ini.
  // Audit 2026-10: ikut `dataVersion` — sesi breakdown yang baru selesai menulis manifest-nya,
  // dan itu harus terlihat tanpa memilih ulang PRD. Manifest yang belum ada (404) = belum ada
  // usulan, bukan galat.
  React.useEffect(() => {
    let alive = true;
    api.getBreakdown(projectId, prd.path)
      .then((r) => {
        if (!alive) return;
        setItems(r.items); setInclude(r.items.map(() => true)); setBreakdownError("");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if ((e as { status?: number } | null)?.status === 404) {
          setItems([]); setInclude([]); setBreakdownError("");
          return;
        }
        setBreakdownError(errorMessage(e, "tidak diketahui"));
      });
    return () => { alive = false; };
  }, [projectId, prd.path, dataVersion, breakdownRetry]);

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
      {/* Header dibungkus (flex-wrap): pada lebar sempit aksi turun ke baris sendiri, judul tak terjepit. */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div className="hn-eyebrow" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", marginBottom: 4, overflowWrap: "anywhere" }}>{prd.path}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 18, fontWeight: 700, color: "var(--text-strong)", overflowWrap: "anywhere" }}>{prd.title}</h2>
            <PrdStatusBadge prd={prd} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* SPEC-361 · unduh PRD sebagai .md / .pdf untuk dibagikan ke tim */}
          <DocDownload href={(f) => api.prdDownloadUrl(projectId, prd.path, f)} disabled={content === null} />
          {/* Audit 2026-10: "Take" adalah aksi utama; "Breakdown" sekunder. */}
          <Button size="sm" leftIcon="list-checks" onClick={() => setTakeOpen(true)}>
            Take ke backlog
          </Button>
          <Button size="sm" variant="secondary" leftIcon="split"
            onClick={() => onStartBreakdown(projectId, prd.path)}>
            Breakdown ke backlog
          </Button>
        </div>
      </div>

      {breakdownError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5,
          color: "var(--text-body)", marginBottom: 14 }}>
          <span style={{ flex: "1 1 auto", minWidth: 0 }}>Usulan breakdown gagal dimuat: {breakdownError}</span>
          <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={() => setBreakdownRetry((k) => k + 1)}>Coba lagi</Button>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)", background: "var(--brass-050)", padding: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 8, gap: 8 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, color: "var(--brass-700)" }}>
              Usulan backlog paralel ({chosen.length}/{items.length})
            </div>
            <Button size="sm" leftIcon="plus" disabled={!chosen.length || busy} onClick={materialize}>
              {busy ? "Membuat…" : `Buat ${chosen.length} backlog`}
            </Button>
          </div>
          {items.map((it, i) => (
            <label key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0",
              minHeight: coarse ? 44 : undefined,
              borderTop: i ? "1px solid var(--border-hair)" : "none", cursor: "pointer" }}>
              <input type="checkbox" checked={include[i] ?? false}
                style={coarse ? { width: 20, height: 20, flex: "0 0 auto" } : undefined}
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
        {contentError ? (
          <StateBlock kind="error" title="Gagal memuat isi PRD" hint={contentError}
            action={() => setContentRetry((k) => k + 1)} />
        ) : content === null ? <StateBlock kind="loading" title="Memuat PRD…" />
        // Audit 2026-10: lebar baca dibatasi di sini, bukan di `.hn-md` (milik app.css).
        : <div style={{ maxWidth: "68ch" }}><MarkdownView text={content} name={prd.name} /></div>}
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
    <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
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
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{prd.path}</div>
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
  // Audit 2026-10 · daftar: `loading` sebelum muatan pertama, `error` bila muat gagal. Muatan
  // lama tetap dipegang saat muat ulang gagal — tak dikosongkan diam-diam.
  const [listState, setListState] = React.useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = React.useState("");
  const [listRetry, setListRetry] = React.useState(0);
  // SPEC-740 · ADR-0115 · yang disimpan slug-nya saja, bukan dokumennya: storage hanya
  // untuk parameter tampilan.
  const [selSlug, setSelSlug] = usePersistedState<string | null>("prd", "sel", null, nullableStr);
  const [panel, setPanel] = React.useState<"list" | "detail">("list");
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
  // Audit 2026-10: BUKAN saat mount. Effect lama memanggil setSel(null) di run pertama dan
  // menghapus seleksi tersimpan setiap halaman dibuka. Pembanding dicatat di ref supaya run
  // pertama (dan run kedua di StrictMode) hanya mencatat, tak membuang.
  // Refresh data (dataVersion) tak membuangnya agar preview stabil.
  const filterKey = JSON.stringify([projectFilter, statusFilter]);
  const lastFilterKey = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastFilterKey.current !== null && lastFilterKey.current !== filterKey) setSel(null);
    lastFilterKey.current = filterKey;
  }, [filterKey, setSel]);

  React.useEffect(() => {
    let alive = true;
    const load = all ? api.listAllPrds()
      : activeProject ? api.listPrds(activeProject)
      : Promise.resolve({ items: [] as PrdDoc[] });
    load
      .then((r) => { if (alive) { setItems(r.items); setListState("ready"); setListError(""); } })
      .catch((e: unknown) => { if (alive) { setListState("error"); setListError(errorMessage(e, "tidak diketahui")); } });
    return () => { alive = false; };
  }, [projectFilter, dataVersion, listRetry]);

  // SPEC-854 · ADR-0129 · draft PRD yang lahir dari obrolan portal klien hidup di baris SESI,
  // bukan di docs/prd/ — jadi ia tak muncul di daftar dokumen sampai operator
  // memateralisasinya. Panel ini pintunya, dan ia butuh satu project terpilih.
  const [portalOpen, setPortalOpen] = React.useState(false);
  const visible = statusFilter === "all" ? items : items.filter((p) => p.status === statusFilter);
  const groups = groupByProject(visible);
  const selProject = sel ? (sel.projectId || activeProject) : "";
  const selOpts = [{ value: "all", label: "Semua project" }].concat(projects.map((p) => ({ value: p.id, label: p.name })));

  const listBody = listState === "loading" && items.length === 0
    ? <StateBlock kind="loading" compact title="Memuat daftar PRD…" />
    : listState === "error" && items.length === 0
      ? <StateBlock kind="error" compact title="Gagal memuat daftar PRD" hint={listError}
          action={() => setListRetry((k) => k + 1)} />
    : items.length === 0
      ? <StateBlock kind="empty" icon="scroll-text" title="Belum ada PRD"
          hint="Buat PRD dari brief + brainstorm; hanoman menulisnya ke docs/prd/ lalu bisa di-take jadi backlog."
          action={() => setCreating(true)} actionLabel="PRD baru" />
    : visible.length === 0
      ? /* SPEC-520 · tersaring habis ≠ belum ada PRD — menyebut statusnya supaya operator
           tahu filter mana yang harus dilonggarkan. */
        <StateBlock kind="empty" icon="filter" compact
          title={`Tak ada PRD berstatus "${PRD_STATUS_LABEL[statusFilter as PrdStatus] ?? statusFilter}"`}
          hint="Longgarkan filter status untuk melihat PRD lainnya."
          action={() => setStatusFilter("all")} actionLabel="Semua status" />
    : <>
        {listState === "error" && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12,
            color: "var(--text-body)", padding: "6px 10px", marginBottom: 8 }}>
            <span style={{ flex: "1 1 auto", minWidth: 0 }}>Gagal memuat ulang — daftar dari muatan terakhir.</span>
            <Button size="sm" variant="secondary" onClick={() => setListRetry((k) => k + 1)}>Coba lagi</Button>
          </div>
        )}
        {groups.map((g) => (
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
                onSelect={() => { setSel(p); setPanel("detail"); }} />
            ))}
          </div>
        ))}
      </>;

  return (
    <div style={LIST_SCREEN_STYLE}>
      <div className="hn-stack-mobile" style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div className="hn-wrap-mobile" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Select size="sm" value={projectFilter} aria-label="Project"
            onChange={(e) => onProjectFilter(e.target.value)} options={selOpts} />
          {/* SPEC-520 · memilah mana PRD yang masih perlu ditindaklanjuti tanpa membaca satu per satu. */}
          <Select size="sm" value={statusFilter} aria-label="Status PRD"
            onChange={(e) => setStatusFilter(e.target.value as "all" | PrdStatus)}
            options={[{ value: "all", label: "Semua status" }]
              .concat(PRD_STATUSES.map((s) => ({ value: s, label: PRD_STATUS_LABEL[s] ?? s })))} />
          <ResetViewButton screen="prd" active={statusFilter === "all" ? 0 : 1} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!all && (
            <Button size="sm" variant={portalOpen ? "primary" : "ghost"} leftIcon="messages-square"
              aria-expanded={portalOpen}
              onClick={() => setPortalOpen((v) => !v)}>Draft dari portal klien</Button>
          )}
          <Button size="sm" leftIcon="plus"
            onClick={() => setCreating(true)}>PRD baru</Button>
        </div>
      </div>
      {portalOpen && !all && (
        <div style={{ ...FIXED_ROW_STYLE, marginBottom: 18 }}>
          <PortalChatPanel projectId={projectFilter} />
        </div>
      )}
      <ResponsivePanels
        ariaLabel="Panel PRD"
        active={panel}
        onActiveChange={(next) => setPanel(next as "list" | "detail")}
        masterWidth={264}
        panels={[
          { id: "list", label: "Daftar", className: "hn-panel-flex", content: (
        <aside aria-label="Daftar PRD" style={{
          width: "100%", minHeight: 0, overflowY: "auto",
          borderRight: "1px solid var(--border-hair)", paddingRight: 12,
        }}>
          {listBody}
        </aside>
          ) },
          { id: "detail", label: "Detail", className: "hn-panel-flex", content: (
        <section aria-label="Isi PRD" style={{ flex: "1 1 auto", minHeight: 0 }}>
          {sel ? (
            <PrdPreviewPane prd={sel} projectId={selProject} dataVersion={dataVersion}
              onTake={(pf) => onTakeToBacklog(pf)}
              onStartBreakdown={onStartBreakdown} onMaterialize={onMaterialize} />
          ) : (
            <StateBlock kind="empty" icon="scroll-text" title="Pilih PRD"
              hint="Klik dokumen di daftar kiri untuk melihat isinya, lalu take ke backlog." />
          )}
        </section>
          ) },
        ]}
      />
      {creating && <NewPrdModal projects={projects} defaultProject={activeProject}
        onClose={() => setCreating(false)}
        onCreate={(project, brief) => { setCreating(false); onNewPrd(project, brief); }} />}
    </div>
  );
}
