// Skills library · daftar skill dikelompokkan Global (Hanoman/User/Plugin) + satu section per project.
import React from "react";
import type { SkillEntry, SkillLibraryView } from "@hanoman/shared";
import { Badge, Icon, Input, StateBlock } from "../../ds";

const LAYER_LABEL: Record<string, string> = { hanoman: "Hanoman", user: "User", plugin: "Plugin" };
export const sourceLabel = (s: SkillEntry) => s.source.startsWith("lainnya:") ? "lainnya" : s.source;

function Row({ s, selected, onSelect }: { s: SkillEntry; selected: boolean; onSelect: (s: SkillEntry) => void }) {
  return (
    <button type="button" className={`hn-skill-row${selected ? " is-selected" : ""}`} onClick={() => onSelect(s)}
      style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "6px 10px", textAlign: "left",
        background: selected ? "var(--brass-50)" : "transparent", border: 0, borderRadius: 6, cursor: "pointer" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
      {s.source !== "hanoman" && <Badge size="sm">{sourceLabel(s)}</Badge>}
      {s.loadedBy.length === 0 && <Badge size="sm" tone="neutral">tidak dimuat</Badge>}
      {s.shadowedBy && <Badge size="sm" tone="warn">tertimpa</Badge>}
      {s.frontmatterError && <Badge size="sm" tone="err" icon="alert-triangle">frontmatter</Badge>}
      {!s.editable && <Badge size="sm" icon="lock">baca</Badge>}
    </button>
  );
}

// Grup besar (mis. 117 skill plugin) terlipat default supaya section project tak tenggelam di
// dasar halaman; pencarian membuka semua grup.
const FOLD_OVER = 8;

function Group({ title, items, selected, onSelect, error, searching }:
  { title: string; items: SkillEntry[]; selected?: string; onSelect: (s: SkillEntry) => void; error?: string; searching: boolean }) {
  const [open, setOpen] = React.useState(items.length <= FOLD_OVER);
  const shown = open || searching || items.some((s) => s.key === selected);
  return (
    <section style={{ marginBottom: 12 }}>
      <button type="button" className="hn-eyebrow" aria-expanded={shown} onClick={() => setOpen(!shown)}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 10px", border: 0,
          background: "transparent", cursor: "pointer", textAlign: "left" }}>
        <Icon name={shown ? "chevron-down" : "chevron-right"} size={12} color="var(--text-subtle)" />
        {title} ({items.length})
      </button>
      {error ? <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--clay-600)" }}>{error}</div>
        : shown && items.map((s) => <Row key={s.key} s={s} selected={s.key === selected} onSelect={onSelect} />)}
    </section>
  );
}

export function SkillsList({ library, selected, onSelect, projectFirst = false }:
  { library: SkillLibraryView; selected?: string; onSelect: (s: SkillEntry) => void; projectFirst?: boolean }) {
  const [q, setQ] = React.useState("");
  const match = (s: SkillEntry) => !q || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const searching = q !== "";
  const global = library.global.filter(match);
  const globalBlock = (
    <div key="global">
      <h3 className="hn-eyebrow" style={{ padding: "4px 10px", fontSize: 12 }}>Global</h3>
      {(["hanoman", "user", "plugin"] as const).map((layer) => (
        <Group key={layer} title={LAYER_LABEL[layer]!} items={global.filter((s) => s.layer === layer)}
          selected={selected} onSelect={onSelect} searching={searching} />
      ))}
    </div>
  );
  const projectBlocks = library.projects.map((p) => (
    <div key={p.projectId}>
      <h3 className="hn-eyebrow" style={{ padding: "4px 10px", fontSize: 12 }}>{p.name}</h3>
      <Group title="Project" items={p.skills.filter(match)} selected={selected} onSelect={onSelect} error={p.error} searching={searching} />
    </div>
  ));
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" }}>
      <div style={{ padding: 8 }}><Input placeholder="Cari skill…" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} leftIcon="search" /></div>
      <div style={{ overflow: "auto", flex: "1 1 auto", padding: "0 4px 8px" }}>
        {projectFirst ? [...projectBlocks, globalBlock] : [globalBlock, ...projectBlocks]}
        {global.length === 0 && library.projects.every((p) => p.skills.length === 0) &&
          <StateBlock kind="empty" compact icon="sparkles" title="Belum ada skill" />}
      </div>
    </div>
  );
}
