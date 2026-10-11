// Skills library · daftar skill dikelompokkan Global (Hanoman/User/Plugin) + satu section per project.
import React from "react";
import type { SkillEntry, SkillLibraryView } from "@hanoman/shared";
import { Badge, Icon, Input, StateBlock } from "../../ds";

const LAYER_LABEL: Record<string, string> = { hanoman: "Hanoman", user: "User", plugin: "Plugin" };
export const sourceLabel = (s: SkillEntry) => s.source.startsWith("lainnya:") ? "lainnya" : s.source;

function Row({ s, selected, onSelect }: { s: SkillEntry; selected: boolean; onSelect: (s: SkillEntry) => void }) {
  return (
    <button type="button" className={`hn-skill-row${selected ? " is-selected" : ""}`} aria-current={selected ? "true" : undefined} onClick={() => onSelect(s)}
      style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "6px 10px", textAlign: "left",
        background: selected ? "var(--brass-050)" : "transparent", border: 0, borderRadius: 6, cursor: "pointer",
        boxShadow: selected ? "inset 3px 0 0 var(--brass-500)" : "none" }}>
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
// dasar halaman; pencarian membuka semua grup. Pilihan operator (buka/lipat) selalu menang atas
// default itu, termasuk untuk grup yang berisi skill terpilih.
const FOLD_OVER = 8;

function Group({ title, items, selected, onSelect, error, searching }:
  { title: string; items: SkillEntry[]; selected?: string; onSelect: (s: SkillEntry) => void; error?: string; searching: boolean }) {
  const [manual, setManual] = React.useState<boolean | null>(null);
  const shown = manual ?? (items.length <= FOLD_OVER || searching);
  return (
    <section style={{ marginBottom: 12 }}>
      <button type="button" className="hn-eyebrow" aria-expanded={shown} onClick={() => setManual(!shown)}
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
  const projectSkills = library.projects.map((p) => p.skills.filter(match));
  const empty = global.length === 0 && projectSkills.every((list) => list.length === 0);
  const projectBlocks = library.projects.map((p, i) => (
    <div key={p.projectId}>
      <h3 className="hn-eyebrow" style={{ padding: "4px 10px", fontSize: 12 }}>{p.name}</h3>
      <Group title="Project" items={projectSkills[i]!} selected={selected} onSelect={onSelect} error={p.error} searching={searching} />
    </div>
  ));
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" }}>
      <div style={{ padding: 8 }}><Input aria-label="Cari skill" placeholder="mis. deploy" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} leftIcon="search" /></div>
      <div style={{ overflow: "auto", flex: "1 1 auto", padding: "0 4px 8px" }}>
        {projectFirst ? [...projectBlocks, globalBlock] : [globalBlock, ...projectBlocks]}
        {empty && (searching
          ? <StateBlock kind="empty" compact icon="search" title="Tak ada skill cocok pencarian" hint={`Tidak ada skill yang cocok dengan “${q}”.`} />
          : <StateBlock kind="empty" compact icon="sparkles" title="Belum ada skill" />)}
      </div>
    </div>
  );
}
