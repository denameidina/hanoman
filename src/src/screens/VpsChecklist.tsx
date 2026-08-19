/* VpsChecklistModal — modal detail checklist kepatuhan per-VPS (SPEC-220/221 · UI modal 2026-07-17).
   Seksi collapse/expand (default collapsed agar mudah di-track), search + filter existing,
   aksi N/A/attest/remediasi selektif. Data dari GET /vps/:id/checklist (server menghidrasi penuh). */
import React from "react";
import { Button, Modal, StateBlock, Icon, useConfirm } from "../ds";
import { api } from "../api/client";
import type { ChecklistView, ChecklistSection, ChecklistItem, VpsItemStatus, VpsMode, VpsSeverity, RemediateStep, VpsHealth } from "@hanoman/shared";

const STATUS_ICON: Record<VpsItemStatus, string> = {
  pass: "check", fail: "x", warn: "alert-triangle", na: "minus", unknown: "circle" };
const STATUS_COLOR: Record<VpsItemStatus, string> = {
  pass: "var(--leaf-600)", fail: "var(--clay-600)", warn: "var(--amber-600)",
  na: "var(--text-subtle)", unknown: "var(--text-subtle)" };
const MODE_COLOR: Record<VpsMode, string> = {
  AUTO: "var(--brass-700)", AUDIT: "var(--amber-600)", INFO: "var(--text-subtle)" };
const SEV_COLOR: Record<VpsSeverity, string> = {
  critical: "var(--clay-600)", high: "var(--amber-600)", medium: "var(--text-subtle)", low: "var(--text-subtle)" };

export function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
    color, border: `1px solid ${color}`, borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap" }}>{text}</span>;
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 90 ? "var(--leaf-600)" : score >= 50 ? "var(--amber-600)" : "var(--clay-600)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 90 }}>
      <div style={{ flex: 1, height: 6, background: "var(--bone-200)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-subtle)", minWidth: 28, textAlign: "right" }}>{score}%</span>
    </div>
  );
}

function ItemRow({ item, busy, selected, onToggle, onNa, onAttest }: {
  item: ChecklistItem; busy: boolean; selected: boolean;
  onToggle: (item: ChecklistItem) => void;
  onNa: (item: ChecklistItem, na: boolean) => void; onAttest: (item: ChecklistItem) => void }) {
  const selectable = item.mode === "AUTO" && !item.na;
  return (
    <div data-testid={`item-${item.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
      borderBottom: "1px solid var(--border-hair)", fontSize: 13, opacity: item.na ? 0.55 : 1 }}>
      {selectable
        ? <input type="checkbox" aria-label={`pilih ${item.id}`} checked={selected} onChange={() => onToggle(item)} />
        : <span style={{ display: "inline-block", width: 13 }} />}
      <Icon name={STATUS_ICON[item.status]} size={14} color={STATUS_COLOR[item.status]} />
      <span style={{ flex: 1, minWidth: 0 }}>{item.title}</span>
      {item.drifted && <Badge text="drift" color="var(--clay-600)" />}
      <Badge text={item.mode} color={MODE_COLOR[item.mode]} />
      <Badge text={item.severity} color={SEV_COLOR[item.severity]} />
      {item.mode === "INFO" && !item.attested && (
        <Button size="sm" variant="ghost" leftIcon="check-circle" loading={busy}
          onClick={() => onAttest(item)}>Attest</Button>
      )}
      <Button size="sm" variant="ghost" leftIcon={item.na ? "rotate-ccw" : "minus-circle"} loading={busy}
        onClick={() => onNa(item, !item.na)}>{item.na ? "Batal N/A" : "N/A"}</Button>
    </div>
  );
}

type Filter = { section: string; mode: string; status: string; severity: string };
const BLANK_FILTER: Filter = { section: "", mode: "", status: "", severity: "" };

function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-sm)", background: "var(--bone-50)", color: "var(--text)" }}>
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
  const parts = [fail && `${fail} fail`, warn && `${warn} warn`, unknown && `${unknown} unknown`].filter(Boolean) as string[];
  return { text: parts.length ? parts.join(" ") : "semua pass", drift };
}

function SectionGroup({ section, items, expanded, onToggle, busy, selected, onToggleItem, onNa, onAttest, onSectionNa }: {
  section: ChecklistSection; items: ChecklistItem[]; expanded: boolean; onToggle: (id: string) => void;
  busy: string | null; selected: Set<string>;
  onToggleItem: (i: ChecklistItem) => void; onNa: (i: ChecklistItem, na: boolean) => void;
  onAttest: (i: ChecklistItem) => void; onSectionNa: (s: ChecklistSection) => void }) {
  const sum = sectionSummary(section.items);
  const suggestNa = !!section.suggestion && !section.suggestion.applicable;
  return (
    <div style={{ marginBottom: 8, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      <button data-testid={`section-${section.id}`} aria-expanded={expanded} onClick={() => onToggle(section.id)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", textAlign: "left",
          background: expanded ? "var(--bone-100)" : "transparent", border: "none", cursor: "pointer" }}>
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={15} color="var(--text-subtle)" />
        <span style={{ fontSize: 14 }}>{section.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{section.title}</span>
        <span style={{ fontSize: 11, color: "var(--text-subtle)", whiteSpace: "nowrap" }}>{sum.text}</span>
        {sum.drift > 0 && <Badge text="drift" color="var(--clay-600)" />}
        {suggestNa && <Badge text="saran N/A" color="var(--brass-700)" />}
        <ScoreBar score={section.score} />
      </button>
      {expanded && (
        <div style={{ padding: "2px 10px 8px" }}>
          {suggestNa && (
            <div data-testid={`suggestion-${section.id}`} style={{ display: "flex", alignItems: "center", gap: 8,
              margin: "6px 0", padding: "6px 10px", fontSize: 12, color: "var(--text-subtle)",
              background: "var(--bone-50)", border: "1px dashed var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
              <Icon name="info" size={13} color="var(--brass-700)" />
              <span style={{ flex: 1 }}>Stack tak terdeteksi ({section.suggestion!.detail}) — kemungkinan N/A. Cek Docker manual bila ragu.</span>
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

export function VpsChecklistModal({ vpsId, vpsName, lastAuditAt, health, onClose, onToast }:
  { vpsId: string; vpsName?: string; lastAuditAt?: string | null; health?: VpsHealth | null;
    onClose: () => void; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [view, setView] = React.useState<ChecklistView | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = React.useState<Filter>(BLANK_FILTER);
  const [search, setSearch] = React.useState("");
  const [expandedManual, setExpandedManual] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<RemediateStep[] | null>(null);
  const [action, setAction] = React.useState<"" | "preview" | "apply">("");

  const load = React.useCallback(() => {
    setStatus("loading");
    api.vpsChecklist(vpsId).then((v) => { setView(v); setStatus("ready"); }).catch(() => setStatus("error"));
  }, [vpsId]);
  React.useEffect(() => {
    load();
    setSelected(new Set()); setPreview(null);
    setExpandedManual(new Set()); setSearch(""); setFilter(BLANK_FILTER);
  }, [load]);

  const toggleItem = (item: ChecklistItem) => setSelected((s) => {
    const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
  const clearSel = () => { setSelected(new Set()); setPreview(null); };
  const toggleSection = (id: string) => setExpandedManual((e) => {
    const n = new Set(e); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // SPEC-847 · ADR-0125 · konfirmasi mutasi VPS memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();

  async function doPreview() {
    setAction("preview");
    try { setPreview((await api.remediatePreview(vpsId, [...selected])).steps); }
    catch { onToast("Preview remediasi gagal", "err", "x-circle"); }
    finally { setAction(""); }
  }
  async function doApply() {
    if (!await confirm({
      title: `Terapkan ${selected.size} item AUTO ke VPS ini?`,
      message: "Remediasi dijalankan langsung di server yang terdaftar.",
      impact: ["Langkahnya idempoten dan anti-lockout.", "Checklist diaudit ulang setelah selesai."],
      confirmLabel: "Terapkan",
      icon: "shield",
    })) return;
    setAction("apply");
    try { await api.remediate(vpsId, [...selected]); clearSel(); load(); onToast("Remediasi diterapkan · audit ulang", "ok", "shield"); }
    catch { onToast("Remediasi gagal", "err", "x-circle"); }
    finally { setAction(""); }
  }
  async function act(item: ChecklistItem, fn: () => Promise<unknown>, msg: string) {
    setBusy(item.id);
    try { await fn(); load(); onToast(msg, "ok", "shield"); }
    catch { onToast(`Gagal memperbarui ${item.id}`, "err", "x-circle"); }
    finally { setBusy(null); }
  }
  const onNa = (item: ChecklistItem, na: boolean) =>
    act(item, () => api.markNa(vpsId, item.id, na, na ? "ditandai dari checklist" : undefined),
      na ? `${item.id} ditandai N/A` : `${item.id} kembali applicable`);
  const onAttest = (item: ChecklistItem) =>
    act(item, () => api.attestItem(vpsId, item.id), `${item.id} di-attest`);
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
    } catch { onToast("Gagal tandai seksi N/A", "err", "x-circle"); }
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

  function body() {
    if (status === "loading") return <StateBlock kind="loading" compact title="Memuat checklist…" />;
    if (status === "error" || !view) return <StateBlock kind="error" compact title="Gagal memuat checklist" action={load} />;

    const driftCount = view.sections.reduce((a, s) => a + s.items.filter((i) => i.drifted).length, 0);
    const rows = view.sections
      .map((s) => ({ section: s, matched: s.items.filter(matchItem) }))
      .filter((r) => !filtering || r.matched.length > 0);

    return (
      <div>
        <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--surface-card)", paddingBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div data-testid="score-total" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{view.scoreTotal}%</div>
            <div style={{ flex: 1 }}><ScoreBar score={view.scoreTotal} /></div>
            <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>skor kepatuhan</span>
          </div>
          {driftCount > 0 && (
            <div data-testid="drift-summary" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
              padding: "6px 10px", fontSize: 12, color: "var(--clay-700)",
              background: "var(--clay-50, var(--bone-100))", border: "1px solid var(--clay-600)", borderRadius: "var(--radius-sm)" }}>
              <Icon name="alert-triangle" size={14} color="var(--clay-600)" />
              {driftCount} item drift (regresi) sejak audit sebelumnya
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 180px",
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: "2px 8px", background: "var(--bone-50)" }}>
              <Icon name="search" size={13} color="var(--text-subtle)" />
              <input aria-label="cari item" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="mis. ssh atau 5.2.1"
                style={{ flex: 1, border: "none", background: "transparent", fontSize: 12, color: "var(--text)", outline: "none" }} />
            </div>
            <Select label="seksi" value={filter.section} onChange={set("section")}
              options={view.sections.map((s) => [s.id, s.title])} />
            <Select label="mode" value={filter.mode} onChange={set("mode")}
              options={[["AUTO", "AUTO"], ["AUDIT", "AUDIT"], ["INFO", "INFO"]]} />
            <Select label="status" value={filter.status} onChange={set("status")}
              options={[["pass", "pass"], ["fail", "fail"], ["warn", "warn"], ["na", "na"], ["unknown", "unknown"]]} />
            <Select label="severity" value={filter.severity} onChange={set("severity")}
              options={[["critical", "critical"], ["high", "high"], ["medium", "medium"], ["low", "low"]]} />
            {filtering && <Button size="sm" variant="ghost" onClick={() => { setFilter(BLANK_FILTER); setSearch(""); }}>Reset</Button>}
          </div>
          {selected.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "8px 10px",
              background: "var(--bone-100)", border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)" }}>
              <span style={{ fontSize: 12, flex: 1 }}>{selected.size} item AUTO dipilih</span>
              <Button size="sm" variant="secondary" leftIcon="eye" loading={action === "preview"} onClick={doPreview}>Preview</Button>
              <Button size="sm" leftIcon="shield" loading={action === "apply"} onClick={doApply}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={clearSel}>Batal</Button>
            </div>
          )}
          {preview && (
            <div data-testid="remediate-preview" style={{ marginTop: 10, padding: "8px 10px", fontSize: 12,
              fontFamily: "var(--font-mono)", background: "var(--bone-50)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Pratinjau (dry-run) — belum diterapkan:</div>
              {preview.map((s) => (
                <div key={s.item} style={{ color: "var(--text-subtle)" }}>{s.item} · {s.status} {s.detail}</div>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0
          ? <StateBlock kind="empty" compact title="Tak ada item cocok" hint="Ubah kata kunci atau reset filter." />
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
    <Modal open width={960} icon="clipboard-list" eyebrow={vpsName ?? "VPS"} title="Checklist kepatuhan" onClose={onClose}>
      {/* Detail VPS (bekas side panel VpsScreen) — kini menyatu di modal ini. UI 2026-07-18. */}
      <div data-testid="vps-detail" style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 12,
        paddingBottom: 10, borderBottom: "1px solid var(--border-hair)" }}>
        {lastAuditAt ? `Audit terakhir ${new Date(lastAuditAt).toLocaleString()}` : "Belum pernah diaudit"}
        {health && ` · disk ${health.disk} · mem ${health.mem} · load ${health.load}`}
      </div>
      {body()}
      {dialog}
    </Modal>
  );
}
