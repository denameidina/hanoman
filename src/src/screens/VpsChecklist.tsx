/* VpsChecklistModal — detail satu VPS (SPEC-220/221 · UI modal 2026-07-17), bertab.

   Audit UI/UX 2026-10 · Fase 3J: tab Ringkasan · Checklist · Pemasangan · Akses (panel tetap ter-mount
   dan disembunyikan, supaya pilihan remediasi dan filter tak hilang saat pindah tab). Header checklist
   menempel dan ringkas: skor, lalu filter dalam popover. Badge hanya untuk item bermasalah. Alur
   perbaikan tiga langkah: pilih → pratinjau → terapkan. Terapkan hanya dari pratinjau untuk pilihan
   yang persis sama; mengubah pilihan membatalkan pratinjau. */
import React from "react";
import { Button, FilterBar, Icon, Modal, StateBlock, TabPanel, Tabs, Text, useConfirm, type FilterChip } from "../ds";
import { api } from "../api/client";
import { errorMessage, failureMessage } from "../lib/report-error";
import { relativeTime } from "../lib/time-format";
import { VPS_ITEM_STATUS_LABEL, VPS_SEVERITY_LABEL } from "../lib/labels";
import { canApplyRemediation } from "./vps-status";
import type { ChecklistView, ChecklistSection, ChecklistItem, VpsItemStatus, VpsMode, VpsSeverity, RemediateStep, VpsHealth } from "@hanoman/shared";
import "./styles/vps.css";

const STATUS_ICON: Record<VpsItemStatus, string> = {
  pass: "check", fail: "x", warn: "alert-triangle", na: "minus", unknown: "circle" };
const STATUS_COLOR: Record<VpsItemStatus, string> = {
  pass: "var(--leaf-600)", fail: "var(--clay-600)", warn: "var(--status-warn)",
  na: "var(--text-subtle)", unknown: "var(--text-subtle)" };
const SEV_COLOR: Record<VpsSeverity, string> = {
  critical: "var(--clay-600)", high: "var(--status-warn)", medium: "var(--text-subtle)", low: "var(--text-subtle)" };
// Mode checklist: label tampilan. Peta ini milik layar ini sampai dipindah ke lib/labels.ts (lihat glosarium).
const MODE_LABEL: Record<VpsMode, string> = { AUTO: "Otomatis", AUDIT: "Audit", INFO: "Info" };

export function Badge({ text, color }: { text: string; color: string }) {
  return <span className="vps-badge" style={{ color, borderColor: color }}>{text}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  const tone = score >= 90 ? "vps-tone-ok" : score >= 50 ? "vps-tone-warn" : "vps-tone-bad";
  return (
    <div className="vps-bar-wrap">
      <div className="vps-bar">
        <div className={`vps-bar-fill ${tone}`} style={{ width: `${score}%` }} />
      </div>
      <span className="vps-bar-num">{score}%</span>
    </div>
  );
}

function ItemRow({ item, busy, selected, onToggle, onNa, onAttest }: {
  item: ChecklistItem; busy: boolean; selected: boolean;
  onToggle: (item: ChecklistItem) => void;
  onNa: (item: ChecklistItem, na: boolean) => void; onAttest: (item: ChecklistItem) => void }) {
  const selectable = item.mode === "AUTO" && !item.na;
  // Lencana hanya untuk item bermasalah; mode & severity item lain tetap terbaca di tooltip baris.
  const problem = item.status === "fail" || item.status === "warn" || !!item.drifted;
  return (
    <div data-testid={`item-${item.id}`} title={`${MODE_LABEL[item.mode]} · ${VPS_SEVERITY_LABEL[item.severity]}`}
      className={`vps-item${item.na ? " vps-item-na" : ""}`}>
      {selectable
        ? <span className="vps-touch"><input type="checkbox" aria-label={`Pilih ${item.title}`} checked={selected} onChange={() => onToggle(item)} /></span>
        : <span className="vps-item-gap" />}
      <Icon name={STATUS_ICON[item.status]} size={14} color={STATUS_COLOR[item.status]} />
      <span className="vps-item-title">{item.title}</span>
      {item.drifted && <Badge text="drift" color="var(--clay-600)" />}
      {problem && <Badge text={VPS_SEVERITY_LABEL[item.severity]} color={SEV_COLOR[item.severity]} />}
      {item.mode === "INFO" && !item.attested && (
        <Button size="sm" variant="ghost" leftIcon="check-circle" loading={busy}
          onClick={() => onAttest(item)}>Tandai terpenuhi</Button>
      )}
      <Button size="sm" variant="ghost" leftIcon={item.na ? "rotate-ccw" : "minus-circle"} loading={busy}
        onClick={() => onNa(item, !item.na)}>{item.na ? "Batal N/A" : "N/A"}</Button>
    </div>
  );
}

type Filter = { section: string; mode: string; status: string; severity: string };
const BLANK_FILTER: Filter = { section: "", mode: "", status: "", severity: "" };
type DetailTab = "ringkasan" | "checklist" | "pemasangan" | "akses";
type Preview = { steps: RemediateStep[]; forIds: string[] };

function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="vps-select vps-touch-select">
      <option value="">{label}: semua</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

// Ringkasan status dari item PENUH seksi (indikator kesehatan stabil, tak terpengaruh filter).
function sectionSummary(items: ChecklistItem[]): { text: string; drift: number } {
  let fail = 0, warn = 0, unknown = 0, drift = 0;
  for (const i of items) {
    if (i.status === "fail") fail++;
    else if (i.status === "warn") warn++;
    else if (i.status === "unknown") unknown++;
    if (i.drifted) drift++;
  }
  const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const parts = [
    fail && `${fail} ${low(VPS_ITEM_STATUS_LABEL.fail)}`,
    warn && `${warn} ${low(VPS_ITEM_STATUS_LABEL.warn)}`,
    unknown && `${unknown} ${low(VPS_ITEM_STATUS_LABEL.unknown)}`,
  ].filter(Boolean) as string[];
  return { text: parts.length ? parts.join(" · ") : `semua ${low(VPS_ITEM_STATUS_LABEL.pass)}`, drift };
}

function SectionGroup({ section, items, expanded, onToggle, busy, selected, onToggleItem, onNa, onAttest, onSectionNa }: {
  section: ChecklistSection; items: ChecklistItem[]; expanded: boolean; onToggle: (id: string) => void;
  busy: string | null; selected: Set<string>;
  onToggleItem: (i: ChecklistItem) => void; onNa: (i: ChecklistItem, na: boolean) => void;
  onAttest: (i: ChecklistItem) => void; onSectionNa: (s: ChecklistSection) => void }) {
  const sum = sectionSummary(section.items);
  const suggestNa = !!section.suggestion && !section.suggestion.applicable;
  return (
    <div className="vps-section">
      <button data-testid={`section-${section.id}`} aria-expanded={expanded} onClick={() => onToggle(section.id)}
        className={`vps-section-head${expanded ? " vps-section-open" : ""}`}>
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={15} color="var(--text-subtle)" />
        <span className="vps-section-icon">{section.icon}</span>
        <span className="vps-section-title">{section.title}</span>
        <span className="vps-section-sum">{sum.text}</span>
        {sum.drift > 0 && <Badge text="drift" color="var(--clay-600)" />}
        {suggestNa && <Badge text="saran N/A" color="var(--brass-700)" />}
        <ScoreBar score={section.score} />
      </button>
      {expanded && (
        <div className="vps-section-body">
          {suggestNa && (
            <div data-testid={`suggestion-${section.id}`} className="vps-suggest">
              <Icon name="info" size={13} color="var(--brass-700)" />
              <span className="vps-suggest-text">Stack tak terdeteksi ({section.suggestion!.detail}) — kemungkinan N/A. Cek Docker manual bila ragu.</span>
              <Button size="sm" variant="ghost" leftIcon="minus-circle" loading={busy === `section:${section.id}`}
                onClick={() => onSectionNa(section)}>Tandai seksi N/A</Button>
            </div>
          )}
          {items.map((i) => (
            <ItemRow key={i.id} item={i} busy={busy === i.id} selected={selected.has(i.id)}
              onToggle={onToggleItem} onNa={onNa} onAttest={onAttest} />
          ))}
        </div>
      )}
    </div>
  );
}

export function VpsChecklistModal({ vpsId, vpsName, lastAuditAt, health, summary, provisioning, access, onScore, onClose, onToast }:
  { vpsId: string; vpsName?: string; lastAuditAt?: string | null; health?: VpsHealth | null;
    /** Ringkasan tambahan di tab Ringkasan (status langkah, komponen), disuntik VpsScreen. */
    summary?: React.ReactNode;
    /** Panel provisioning, disuntik VpsScreen supaya modal ini tetap soal kepatuhan saja. */
    provisioning?: React.ReactNode;
    /** Isi tab Akses: alamat, dan aksi koneksi (uji, console, sesi). Disuntik VpsScreen. */
    access?: React.ReactNode;
    /** Dipanggil saat checklist termuat, supaya daftar VPS bisa menampilkan skor yang sama. */
    onScore?: (scoreTotal: number) => void;
    onClose: () => void; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [view, setView] = React.useState<ChecklistView | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [loadErr, setLoadErr] = React.useState("");
  const [tab, setTab] = React.useState<DetailTab>("ringkasan");
  const [filter, setFilter] = React.useState<Filter>(BLANK_FILTER);
  const [search, setSearch] = React.useState("");
  const [expandedManual, setExpandedManual] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [action, setAction] = React.useState<"" | "preview" | "apply">("");
  // Ref, bukan dependensi: pemanggil yang meneruskan fungsi baru tiap render tak memicu muat ulang.
  const onScoreRef = React.useRef(onScore);
  onScoreRef.current = onScore;

  const load = React.useCallback(() => {
    setStatus("loading");
    api.vpsChecklist(vpsId).then((v) => {
      setView(v); setStatus("ready");
      onScoreRef.current?.(v.scoreTotal);
    }).catch((e) => { setLoadErr(errorMessage(e, "tak diketahui")); setStatus("error"); });
  }, [vpsId]);
  React.useEffect(() => {
    load();
    setSelected(new Set()); setPreview(null);
    setExpandedManual(new Set()); setSearch(""); setFilter(BLANK_FILTER);
  }, [load]);

  // Mengubah pilihan membatalkan pratinjau lama: pratinjau menggambarkan SET yang sudah tak berlaku.
  const toggleItem = (item: ChecklistItem) => {
    setPreview(null);
    setSelected((s) => {
      const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n;
    });
  };
  const clearSel = () => { setSelected(new Set()); setPreview(null); };
  const toggleSection = (id: string) => setExpandedManual((e) => {
    const n = new Set(e); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // SPEC-847 · ADR-0127 · konfirmasi mutasi VPS memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();

  const previewIds = preview?.forIds ?? null;
  const applyOk = canApplyRemediation([...selected], previewIds);

  async function doPreview() {
    const ids = [...selected];
    setAction("preview");
    try { setPreview({ steps: (await api.remediatePreview(vpsId, ids)).steps, forIds: ids }); }
    catch (e) { onToast(failureMessage("membuat pratinjau remediasi", e), "err", "x-circle"); }
    finally { setAction(""); }
  }
  async function doApply() {
    const ids = [...selected];
    if (!canApplyRemediation(ids, previewIds)) return;
    // Konfirmasi menyebut PERSIS item yang akan dijalankan, bukan hitungan saja.
    const all = view?.sections.flatMap((s) => s.items) ?? [];
    const picked = all.filter((i) => selected.has(i.id));
    if (!await confirm({
      title: `Terapkan ${ids.length} item AUTO ke VPS ini?`,
      message: "Remediasi dijalankan langsung di server yang terdaftar.",
      impact: [
        ...picked.map((i) => `${i.id} · ${i.title}`),
        "Langkahnya idempoten dan anti-lockout.",
        "Checklist diaudit ulang setelah selesai.",
      ],
      confirmLabel: "Terapkan",
      icon: "shield",
    })) return;
    setAction("apply");
    try { await api.remediate(vpsId, ids); clearSel(); load(); onToast("Remediasi diterapkan · audit ulang", "ok", "shield"); }
    catch (e) { onToast(failureMessage("menerapkan remediasi", e), "err", "x-circle"); }
    finally { setAction(""); }
  }
  async function act(item: ChecklistItem, fn: () => Promise<unknown>, msg: string) {
    setBusy(item.id);
    try { await fn(); load(); onToast(msg, "ok", "shield"); }
    catch (e) { onToast(failureMessage(`memperbarui ${item.id}`, e), "err", "x-circle"); }
    finally { setBusy(null); }
  }
  const onNa = (item: ChecklistItem, na: boolean) =>
    act(item, () => api.markNa(vpsId, item.id, na, na ? "ditandai dari checklist" : undefined),
      na ? `${item.id} ditandai N/A` : `${item.id} kembali applicable`);
  const onAttest = (item: ChecklistItem) =>
    act(item, () => api.attestItem(vpsId, item.id), `${item.id} ditandai terpenuhi`);
  async function onSectionNa(section: ChecklistSection) {
    const ids = section.items.map((i) => i.id);
    if (!await confirm({
      title: `Tandai ${ids.length} item seksi "${section.title}" sebagai N/A?`,
      message: "Stack-nya tak terdeteksi — cek Docker manual bila ragu.",
      confirmLabel: "Tandai N/A",
      icon: "shield",
    })) return;
    setBusy(`section:${section.id}`);
    try {
      await api.markNaBulk(vpsId, ids, true, "app-layer: stack tak terdeteksi");
      load(); onToast(`Seksi ${section.title} ditandai N/A`, "ok", "shield");
    } catch (e) { onToast(failureMessage(`menandai seksi ${section.title} sebagai N/A`, e), "err", "x-circle"); }
    finally { setBusy(null); }
  }

  const searchQ = search.trim().toLowerCase();
  const filterActive = !!(filter.section || filter.mode || filter.status || filter.severity);
  const filtering = filterActive || searchQ !== "";
  const matchItem = (i: ChecklistItem) =>
    (!filter.section || i.section === filter.section) &&
    (!filter.mode || i.mode === filter.mode) &&
    (!filter.status || i.status === filter.status) &&
    (!filter.severity || i.severity === filter.severity) &&
    (!searchQ || i.title.toLowerCase().includes(searchQ)
      || i.id.toLowerCase().includes(searchQ) || (i.code ?? "").toLowerCase().includes(searchQ));
  const set = (k: keyof Filter) => (v: string) => setFilter((f) => ({ ...f, [k]: v }));

  // Filter aktif tampil sebagai chip yang bisa dilepas satu per satu di luar popover.
  const sectionTitle = (id: string) => view?.sections.find((s) => s.id === id)?.title ?? id;
  const chips: FilterChip[] = [
    ...(filter.section ? [{ key: "section", label: `Seksi: ${sectionTitle(filter.section)}`, onRemove: () => set("section")("") }] : []),
    ...(filter.mode ? [{ key: "mode", label: `Mode: ${MODE_LABEL[filter.mode as VpsMode]}`, onRemove: () => set("mode")("") }] : []),
    ...(filter.status ? [{ key: "status", label: `Status: ${VPS_ITEM_STATUS_LABEL[filter.status as VpsItemStatus]}`, onRemove: () => set("status")("") }] : []),
    ...(filter.severity ? [{ key: "severity", label: `Severity: ${VPS_SEVERITY_LABEL[filter.severity as VpsSeverity]}`, onRemove: () => set("severity")("") }] : []),
  ];
  const resetAll = () => { setFilter(BLANK_FILTER); setSearch(""); };

  function checklistBody() {
    if (status === "loading") return <StateBlock kind="loading" compact title="Memuat checklist…" />;
    if (status === "error" || !view) return <StateBlock kind="error" compact title="Gagal memuat checklist" hint={loadErr} action={load} />;

    const driftCount = view.sections.reduce((a, s) => a + s.items.filter((i) => i.drifted).length, 0);
    const rows = view.sections
      .map((s) => ({ section: s, matched: s.items.filter(matchItem) }))
      .filter((r) => !filtering || r.matched.length > 0);

    return (
      <div>
        <div className="vps-check-head">
          <div className="vps-check-score">
            <span data-testid="score-total" className="vps-check-score-num">{view.scoreTotal}%</span>
            <div className="vps-check-score-bar"><ScoreBar score={view.scoreTotal} /></div>
            <Text size={11} tone="subtle">skor kepatuhan</Text>
          </div>
          {driftCount > 0 && (
            <div data-testid="drift-summary" className="vps-drift">
              <Icon name="alert-triangle" size={14} color="var(--clay-600)" />
              {driftCount} item drift (regresi) sejak audit sebelumnya
            </div>
          )}
          <FilterBar label="Filter checklist"
            search={{ value: search, onChange: setSearch, label: "cari item", placeholder: "mis. ssh atau 5.2.1" }}
            chips={chips} filtersLabel="Filter" onReset={resetAll}
            filters={
              <div className="vps-filter-fields">
                <Select label="seksi" value={filter.section} onChange={set("section")}
                  options={view.sections.map((s) => [s.id, s.title])} />
                <Select label="mode" value={filter.mode} onChange={set("mode")}
                  options={[["AUTO", MODE_LABEL.AUTO], ["AUDIT", MODE_LABEL.AUDIT], ["INFO", MODE_LABEL.INFO]]} />
                <Select label="status" value={filter.status} onChange={set("status")}
                  options={[["pass", VPS_ITEM_STATUS_LABEL.pass], ["fail", VPS_ITEM_STATUS_LABEL.fail],
                    ["warn", VPS_ITEM_STATUS_LABEL.warn], ["na", VPS_ITEM_STATUS_LABEL.na],
                    ["unknown", VPS_ITEM_STATUS_LABEL.unknown]]} />
                <Select label="severity" value={filter.severity} onChange={set("severity")}
                  options={[["critical", VPS_SEVERITY_LABEL.critical], ["high", VPS_SEVERITY_LABEL.high],
                    ["medium", VPS_SEVERITY_LABEL.medium], ["low", VPS_SEVERITY_LABEL.low]]} />
              </div>
            } />
          {selected.size > 0 && (
            <div className="vps-remedi" role="group" aria-label="Alur perbaikan">
              <ol className="vps-remedi-steps">
                <li data-state="done">1 Pilih · {selected.size} item AUTO</li>
                <li data-state={preview ? "done" : "active"}>2 Pratinjau</li>
                <li data-state={applyOk ? "active" : "todo"}>3 Terapkan</li>
              </ol>
              <div className="vps-remedi-actions">
                <Button size="sm" variant="secondary" leftIcon="eye" loading={action === "preview"} onClick={doPreview}>Pratinjau</Button>
                <Button size="sm" leftIcon="shield" loading={action === "apply"} disabled={!applyOk} onClick={doApply}>Terapkan</Button>
                <Button size="sm" variant="ghost" onClick={clearSel}>Batal</Button>
              </div>
              {!applyOk && <div className="vps-remedi-hint">Buat pratinjau dulu. Terapkan hanya memakai pratinjau untuk pilihan ini.</div>}
            </div>
          )}
          {preview && (
            <div data-testid="remediate-preview" className="vps-preview">
              <div className="vps-preview-title">Pratinjau (dry-run) — belum diterapkan. Mengubah pilihan membatalkannya.</div>
              {preview.steps.map((s) => (
                <div key={s.item} className="vps-preview-line">{s.item} · {s.status} {s.detail}</div>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0
          ? <StateBlock kind="empty" compact title="Tidak ada item cocok" hint="Ubah kata kunci atau reset filter." />
          : rows.map(({ section, matched }) => (
              <SectionGroup key={section.id} section={section}
                items={filtering ? matched : section.items}
                expanded={filtering ? true : expandedManual.has(section.id)}
                onToggle={toggleSection} busy={busy} selected={selected}
                onToggleItem={toggleItem} onNa={onNa} onAttest={onAttest} onSectionNa={onSectionNa} />
            ))}
      </div>
    );
  }

  return (
    <Modal open width={960} icon="clipboard-list" eyebrow="Detail server" title={vpsName ?? "VPS"} onClose={onClose}>
      <Tabs aria-label="Bagian detail VPS" value={tab} className="vps-tabs"
        tabs={[
          { value: "ringkasan", label: "Ringkasan" },
          { value: "checklist", label: "Checklist" },
          { value: "pemasangan", label: "Pemasangan" },
          { value: "akses", label: "Akses" },
        ]}
        onChange={(v) => setTab(v as DetailTab)}>
        <TabPanel value="ringkasan">
          {/* Detail VPS (bekas side panel VpsScreen) — kini ringkasan tab pertama. */}
          <div className="vps-summary">
            <div data-testid="vps-detail" className="vps-detail-meta">
              {lastAuditAt ? `Audit terakhir ${relativeTime(lastAuditAt) || "—"}` : "Belum pernah diaudit"}
              {health && ` · disk ${health.disk} · mem ${health.mem} · load ${health.load}`}
            </div>
            {view && (
              <div className="vps-summary-score">
                <Text size={12} tone="muted">Skor kepatuhan</Text>
                <span data-testid="ringkasan-score" className="vps-summary-score-num">{view.scoreTotal}%</span>
              </div>
            )}
            {summary}
          </div>
        </TabPanel>
        <TabPanel value="checklist">{checklistBody()}</TabPanel>
        <TabPanel value="pemasangan">
          <div data-testid="vps-provisioning">
            {provisioning ?? <StateBlock kind="empty" compact title="Pemasangan belum tersedia" />}
          </div>
        </TabPanel>
        <TabPanel value="akses">
          {access ?? <StateBlock kind="empty" compact title="Akses belum tersedia" />}
        </TabPanel>
      </Tabs>
      {dialog}
    </Modal>
  );
}
