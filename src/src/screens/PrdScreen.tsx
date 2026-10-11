/* PrdScreen — dokumen PRD (SPEC-210 + perbaikan lintas-project). Dua panel: indeks kiri dan halaman
   baca kanan. PRD adalah dokumen, bukan entitas DB (ADR-0011/0041).

   Audit 2026-10: seleksi tersimpan tak lagi dibuang saat mount; galat & loading dibedakan dari
   "Belum ada PRD" di daftar maupun isi; usulan breakdown ikut dataVersion.

   Redesign 3P (PRD): status filter diganti indeks yang dikelompokkan per status (Draf · Dieskalasi
   · Terwujud), tiap grup bisa dilipat. Halaman baca dibatasi lebarnya (~68ch). Satu bar aksi sticky:
   primer "Jadikan backlog" membuka sheet tiga pilihan (brief, goal, atau breakdown dengan checklist
   usulan). Unduh pindah ke menu ⋯. Usulan breakdown tampil sebagai panel lipat di halaman. */
import React from "react";
import { PortalChatPanel } from "./PortalChatPanel";
import { PRD_STATUS_LABEL, labelOf } from "../lib/labels";
import {
  Badge, Button, Select, Modal, Field, Input, HnTextarea, StateBlock, MarkdownView, Icon,
  DocDownload, OverflowActions, LIST_SCREEN_STYLE, FIXED_ROW_STYLE, ResponsivePanels,
} from "../ds";
import { api, type PrdDoc } from "../api/client";
import { PRD_STATUSES, type BreakdownItem, type PrdStatus } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { prdBranchOf } from "./branch";
import { usePersistedState, ResetViewButton, nullableStr } from "../ui-state";
import { errorMessage } from "../lib/report-error";
import "./styles/projects.css";

export type PrdBriefForm = { title: string; context: string; outcome: string; constraints?: string };
// SPEC-244 · branchFrom = branch yang dibuat sesi PRD (prd/<slug>) — diteruskan ke brief take-to-backlog.
// SPEC-407 · `kind` memilih BENTUK backlog-nya: brief (brainstorm → … → execute) atau goal (sesi
// dua fase yang langsung mengejar goal). `goal` hanya terisi untuk kind goal.
export type PrdPrefill = {
  project: string; title: string; context: string; outcome: string; prdPath: string; branchFrom: string;
  kind?: "brief" | "goal"; goal?: string;
};

// SPEC-520 · status turunan PRD dalam bahasa Indonesia (bukan enum mentah). Petanya di lib/labels.ts.
export { PRD_STATUS_LABEL };

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
  // Audit 2026-10: "Buat brief" nonaktif tanpa judul dan hint menyebut sebabnya.
  const canSubmit = !!f.title.trim() && !!project;
  const submit = () => {
    if (!canSubmit) return;
    onCreate(project, { title: f.title.trim(), context: f.context, outcome: f.outcome, constraints: f.constraints || undefined });
  };
  const required = <span aria-hidden="true" className="hn-prj-required">*</span>;
  return (
    <Modal open onClose={onClose} icon="scroll-text" eyebrow="PM → hanoman" title="PRD baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="messages-square" onClick={submit} disabled={!canSubmit}>Buat brief → brainstorm PRD</Button>
      </>}>
      <p className="hn-prj-note">
        hanoman membuka sesi brainstorm interaktif di terminal, lalu menulis dokumen PRD ke <code>docs/prd/</code>.
      </p>
      <p className="hn-prj-note">
        <span aria-hidden="true" className="hn-prj-required">*</span> wajib diisi
      </p>
      <Field label={<>Project{required}</>} hint="Tujuan penulisan docs/prd/ — pilih di sini, tak perlu memfilter daftar dulu">
        <Select aria-label="Project untuk PRD baru" value={project} disabled={lockProject}
          onChange={(e) => setProject(e.target.value)} className="hn-prj-full"
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label={<>Judul{required}</>}
        hint={f.title.trim() ? undefined : "Wajib diisi — tanpa judul, brief tak bisa dibuat."}>
        <Input value={f.title} onChange={set("title")} placeholder="mis. Jadwal Invoice Berulang" className="hn-prj-full" />
      </Field>
      <Field label="Konteks" hint="Latar belakang & alasan fitur ini dibutuhkan">
        <HnTextarea value={f.context} onChange={set("context")} rows={3} placeholder="mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu" />
      </Field>
      <Field label="Hasil yang diharapkan">
        <HnTextarea value={f.outcome} onChange={set("outcome")} rows={2} placeholder="mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu" />
      </Field>
      <Field label="Batasan" hint="opsional">
        <Input value={f.constraints} onChange={set("constraints")} placeholder="mis. reuse queue yang ada" className="hn-prj-full" />
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

/* Sheet "Jadikan backlog": tiga pilihan. Breakdown memuat checklist usulan bila manifest-nya ada. */
function TakeSheet({ open, onClose, prd, takeBase, items, include, setInclude, busy, onTake, onStartBreakdown, onMaterialize, projectId }:
  { open: boolean; onClose: () => void; prd: PrdDoc; takeBase: { project: string; title: string; prdPath: string; branchFrom: string };
    items: BreakdownItem[]; include: boolean[]; setInclude: React.Dispatch<React.SetStateAction<boolean[]>>; busy: boolean;
    onTake: (p: PrdPrefill) => void; onStartBreakdown: (project: string, prdPath: string) => void;
    onMaterialize: () => void; projectId: string }) {
  const chosen = items.filter((_, i) => include[i]).length;
  return (
    <Modal open={open} onClose={onClose} icon="list-checks" width={600}
      eyebrow="PRD → backlog" title="Jadikan backlog"
      footer={<Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>}>
      <p className="hn-prj-note">Pilih bentuk backlog untuk <b>{prd.title}</b>. Manusia yang memutuskan.</p>
      <div className="hn-prj-sheet-options">
        {/* SPEC-407 · ADR-0089 · dua jalur brief dan goal melahirkan sesi berbentuk beda. */}
        <div className="hn-prj-sheet-option">
          <Button leftIcon="lightbulb" onClick={() => {
            onClose();
            onTake({ ...takeBase, kind: "brief", context: `Dari PRD: ${prd.path}`, outcome: "" });
          }}>Sebagai feature brief</Button>
          <p className="hn-prj-hint">Sesi menjalankan pipeline penuh: brainstorm → objective → spec → plan → execute.</p>
        </div>
        <div className="hn-prj-sheet-option">
          <Button leftIcon="target" variant="secondary" onClick={() => {
            onClose();
            onTake({ ...takeBase, kind: "goal", context: "", outcome: "", goal: `Wujudkan PRD ${prd.path}` });
          }}>Sebagai goal</Button>
          <p className="hn-prj-hint">
            Sesi dua fase (Goal → Verifikasi) yang langsung mengejar goal-nya, tanpa brainstorm,
            spec, maupun plan. Mode goal selalu aktif.
          </p>
        </div>
        <div className="hn-prj-sheet-option">
          {items.length > 0 ? (
            <>
              <div className="hn-prj-sheet-head">
                <span className="hn-prj-sheet-title">Breakdown · {items.length} item</span>
                <span className="hn-prj-hint">{chosen}/{items.length} dipilih</span>
              </div>
              <ul className="hn-prj-checklist">
                {items.map((it, i) => (
                  <li key={i}>
                    <label className="hn-prj-check">
                      <input type="checkbox" checked={include[i] ?? false}
                        className="hn-prj-check-input"
                        onChange={(e) => setInclude((s) => s.map((v, j) => (j === i ? e.target.checked : v)))} />
                      <span className="hn-prj-check-text">
                        <span className="hn-prj-check-title">{it.title} <Badge tone="brass" size="sm">{it.priority}</Badge></span>
                        {it.outcome && <span className="hn-prj-hint">{it.outcome}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button size="sm" leftIcon="plus" disabled={!chosen || busy} onClick={onMaterialize}>
                {busy ? "Membuat…" : `Buat ${chosen} backlog`}
              </Button>
            </>
          ) : (
            <>
              <Button leftIcon="split" variant="secondary" onClick={() => { onClose(); onStartBreakdown(projectId, prd.path); }}>
                Breakdown ke backlog
              </Button>
              <p className="hn-prj-hint">Mulai sesi breakdown yang menulis usulan backlog paralel dari PRD ini.</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Halaman baca PRD: bar aksi sticky, usulan breakdown (lipat), lalu isi dokumen dengan lebar baca.
function PrdPreviewPane({ prd, projectId, dataVersion, onTake, onStartBreakdown, onMaterialize }:
  { prd: PrdDoc; projectId: string; dataVersion?: number; onTake: (p: PrdPrefill) => void;
    onStartBreakdown: (project: string, prdPath: string) => void;
    onMaterialize: (project: string, prdPath: string, items: BreakdownItem[]) => Promise<number>; }) {
  const [content, setContent] = React.useState<string | null>(null);
  const [contentError, setContentError] = React.useState("");
  const [contentRetry, setContentRetry] = React.useState(0);
  const [items, setItems] = React.useState<BreakdownItem[]>([]);
  const [include, setInclude] = React.useState<boolean[]>([]);
  const [breakdownError, setBreakdownError] = React.useState("");
  const [breakdownRetry, setBreakdownRetry] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setContent(null); setContentError("");
    api.getPrd(projectId, prd.path)
      .then((r) => { if (alive) setContent(r.content); })
      .catch((e: unknown) => { if (alive) setContentError(errorMessage(e, "tidak diketahui")); });
    return () => { alive = false; };
  }, [projectId, prd.path, contentRetry]);

  // SPEC-273 · muat manifest breakdown (bila sesi breakdown sudah menuliskannya) untuk PRD ini.
  // Manifest yang belum ada (404) = belum ada usulan, bukan galat.
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
    try { await onMaterialize(projectId, prd.path, chosen); setSheetOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="hn-prd-pane">
      {/* Bar aksi sticky: judul ringkas, primer "Jadikan backlog", dan ⋯ berisi Unduh (sekunder). */}
      <div className="hn-prd-actionbar" role="toolbar" aria-label="Aksi PRD">
        <span className="hn-prd-actionbar-title">{prd.title}</span>
        <Button size="sm" leftIcon="list-checks" onClick={() => setSheetOpen(true)}>Jadikan backlog</Button>
        <OverflowActions label="Aksi lain PRD" icon="ellipsis" items={[]}>
          {/* SPEC-361 · unduh PRD sebagai .md / .pdf untuk dibagikan ke tim */}
          <DocDownload href={(f) => api.prdDownloadUrl(projectId, prd.path, f)} disabled={content === null} />
        </OverflowActions>
      </div>

      <div className="hn-prd-read">
        <header className="hn-prd-head">
          <div className="hn-prj-mono hn-prd-path">{prd.path}</div>
          <div className="hn-prd-head-row">
            <h2 className="hn-prd-title">{prd.title}</h2>
            <PrdStatusBadge prd={prd} />
          </div>
        </header>

        {breakdownError && (
          <div role="alert" className="hn-prj-stale">
            <span className="hn-prj-stale-text">Usulan breakdown gagal dimuat: {breakdownError}</span>
            <Button size="sm" variant="secondary" leftIcon="rotate-ccw" onClick={() => setBreakdownRetry((k) => k + 1)}>Coba lagi</Button>
          </div>
        )}

        {items.length > 0 && (
          <details className="hn-prd-breakdown">
            <summary className="hn-prd-breakdown-summary">Usulan breakdown · {items.length} item</summary>
            <ul className="hn-prd-breakdown-list">
              {items.map((it, i) => (
                <li key={i}>
                  <span className="hn-prd-breakdown-item">{it.title}</span>
                  <Badge tone="brass" size="sm">{it.priority}</Badge>
                </li>
              ))}
            </ul>
            <p className="hn-prj-hint">Pilih item yang dibuat lewat “Jadikan backlog”.</p>
          </details>
        )}

        {contentError ? (
          <StateBlock kind="error" title="Gagal memuat isi PRD" hint={contentError}
            action={() => setContentRetry((k) => k + 1)} />
        ) : content === null ? <StateBlock kind="loading" title="Memuat PRD…" />
        // Lebar baca dibatasi di sini (kelas `hn-prd-doc`, ~68ch), bukan di `.hn-md` milik app.css.
        : <div className="hn-prd-doc"><MarkdownView text={content} name={prd.name} /></div>}
      </div>

      <TakeSheet open={sheetOpen} onClose={() => setSheetOpen(false)} prd={prd} takeBase={takeBase}
        items={items} include={include} setInclude={setInclude} busy={busy} onTake={onTake}
        onStartBreakdown={onStartBreakdown} onMaterialize={() => { void materialize(); }} projectId={projectId} />
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

function PrdSidebarItem({ prd, active, showProject, onSelect }:
  { prd: PrdDoc; active: boolean; showProject: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined}
      className={`hn-prd-item${active ? " is-active" : ""}`}>
      <span className="hn-prd-item-head">
        <Icon name="scroll-text" size={13} color={active ? "var(--brass-700)" : "var(--brass-500)"} />
        <span className="hn-prd-item-title">{prd.title}</span>
        {/* SPEC-520 · "sesi hidup" = PRD yang sedang dikerjakan sesi; status ada di nama grupnya. */}
        {prd.live && <Badge tone="brass" size="sm">sesi hidup</Badge>}
      </span>
      <span className="hn-prd-item-meta">
        {showProject && <span>{prd.projectName} · </span>}
        {prd.specCount > 0 && <span>{prd.doneCount}/{prd.specCount} item selesai · </span>}
        <span className="hn-prj-mono">{prd.path}</span>
      </span>
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
  // SPEC-740 · ADR-0115 · yang disimpan slug-nya saja, bukan dokumennya.
  const [selSlug, setSelSlug] = usePersistedState<string | null>("prd", "sel", null, nullableStr);
  const [panel, setPanel] = React.useState<"list" | "detail">("list");
  const sel = React.useMemo(() => items.find((p) => p.slug === selSlug) ?? null, [items, selSlug]);
  const setSel = React.useCallback((p: PrdDoc | null) => setSelSlug(p ? p.slug : null), [setSelSlug]);
  const [creating, setCreating] = React.useState(false);
  const all = projectFilter === "all";
  const activeProject = all ? "" : projectFilter; // project target untuk "PRD baru" (perlu satu project)

  // Ganti project → buang seleksi (item terpilih bisa tak ada lagi di daftar).
  // BUKAN saat mount (lihat audit 2026-10): pembanding dicatat di ref.
  const lastFilterKey = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastFilterKey.current !== null && lastFilterKey.current !== projectFilter) setSel(null);
    lastFilterKey.current = projectFilter;
  }, [projectFilter, setSel]);

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

  // SPEC-854 · ADR-0129 · draft PRD yang lahir dari obrolan portal klien hidup di baris SESI.
  const [portalOpen, setPortalOpen] = React.useState(false);
  const selProject = sel ? (sel.projectId || activeProject) : "";
  const selOpts = [{ value: "all", label: "Semua project" }].concat(projects.map((p) => ({ value: p.id, label: p.name })));
  // Indeks: dikelompokkan per status, urutan tetap (Draf → Dieskalasi → Terwujud). Status yang
  // tak dikenal (data server lebih baru dari klien) tetap tampil di grup sendiri, tak hilang diam-diam.
  const knownStatuses: string[] = [...PRD_STATUSES];
  const statusGroups = [
    ...PRD_STATUSES.map((s) => ({ status: s, label: labelOf(PRD_STATUS_LABEL, s), items: items.filter((p) => p.status === s) })),
    ...Array.from(new Set(items.map((p) => p.status).filter((s) => !knownStatuses.includes(s)))).map((s) => ({
      status: s, label: labelOf(PRD_STATUS_LABEL, s), items: items.filter((p) => p.status === s),
    })),
  ];

  const listBody = listState === "loading" && items.length === 0
    ? <StateBlock kind="loading" compact title="Memuat daftar PRD…" />
    : listState === "error" && items.length === 0
      ? <StateBlock kind="error" compact title="Gagal memuat daftar PRD" hint={listError}
          action={() => setListRetry((k) => k + 1)} />
    : items.length === 0
      ? <StateBlock kind="empty" icon="scroll-text" title="Belum ada PRD"
          hint="Buat PRD dari brief + brainstorm; hanoman menulisnya ke docs/prd/ lalu bisa di-take jadi backlog."
          action={() => setCreating(true)} actionLabel="PRD baru" />
    : <>
        {listState === "error" && (
          <div role="alert" className="hn-prj-stale hn-prd-stale">
            <span className="hn-prj-stale-text">Gagal memuat ulang — daftar dari muatan terakhir.</span>
            <Button size="sm" variant="secondary" onClick={() => setListRetry((k) => k + 1)}>Coba lagi</Button>
          </div>
        )}
        {statusGroups.filter((g) => g.items.length > 0).map((g) => (
          <details key={g.status} open className="hn-prd-group">
            <summary className="hn-prd-group-summary">
              {g.label}
              <span className="hn-prj-chip-count">{g.items.length}</span>
            </summary>
            {groupByProject(g.items).map((pg) => (
              <div key={pg.projectId} className="hn-prd-group-body">
                {all && <div className="hn-eyebrow hn-prd-project-label">{pg.projectName}</div>}
                {pg.items.map((p) => (
                  <PrdSidebarItem key={`${p.projectId}:${p.path}`} prd={p} showProject={false}
                    active={sel?.path === p.path && sel?.projectId === p.projectId}
                    onSelect={() => { setSel(p); setPanel("detail"); }} />
                ))}
              </div>
            ))}
          </details>
        ))}
      </>;

  return (
    <div style={LIST_SCREEN_STYLE}>
      <div style={FIXED_ROW_STYLE} className="hn-prd-toolbar">
        <Select size="sm" value={projectFilter} aria-label="Project"
          onChange={(e) => onProjectFilter(e.target.value)} options={selOpts} />
        <ResetViewButton screen="prd" active={all ? 0 : 1} />
        <span className="hn-prd-toolbar-spacer" />
        {!all && (
          <Button size="sm" variant={portalOpen ? "primary" : "ghost"} leftIcon="messages-square"
            aria-expanded={portalOpen}
            onClick={() => setPortalOpen((v) => !v)}>Draft dari portal klien</Button>
        )}
        <Button size="sm" leftIcon="plus" onClick={() => setCreating(true)}>PRD baru</Button>
      </div>
      {portalOpen && !all && (
        <div style={FIXED_ROW_STYLE} className="hn-prd-portal">
          <PortalChatPanel projectId={projectFilter} />
        </div>
      )}
      <ResponsivePanels
        ariaLabel="Panel PRD"
        active={panel}
        onActiveChange={(next) => setPanel(next as "list" | "detail")}
        masterWidth={288}
        panels={[
          { id: "list", label: "Indeks", className: "hn-panel-flex", content: (
        <aside aria-label="Indeks PRD" className="hn-prd-index">
          {listBody}
        </aside>
          ) },
          { id: "detail", label: "Isi", className: "hn-panel-flex", content: (
        <section aria-label="Isi PRD" className="hn-prd-detail">
          {sel ? (
            <PrdPreviewPane prd={sel} projectId={selProject} dataVersion={dataVersion}
              onTake={(pf) => onTakeToBacklog(pf)}
              onStartBreakdown={onStartBreakdown} onMaterialize={onMaterialize} />
          ) : (
            <StateBlock kind="empty" icon="scroll-text" title="Pilih PRD"
              hint="Klik dokumen di indeks kiri untuk membacanya, lalu jadikan backlog." />
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
