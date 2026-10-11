// Skills library · daftar ringkas: nama, deskripsi satu baris, dan lapis sebagai chip filter
// (Global · Project · Plugin). Redesign 3K: tak ada grup lipat; pencarian dan chip menyaring satu daftar.
import React from "react";
import type { SkillEntry, SkillLibraryView } from "@hanoman/shared";
import { Badge, Callout, Icon, Input, StateBlock } from "../../ds";
import "../styles/skills.css";
import "../styles/projects.css";

export const sourceLabel = (s: SkillEntry) => s.source.startsWith("lainnya:") ? "lainnya" : s.source;

/** Lapis yang ditampilkan sebagai chip. `hanoman` dan `user` keduanya "Global". */
export type SkillLayerChip = "all" | "global" | "project" | "plugin";
const CHIP_LABEL: Record<SkillLayerChip, string> = { all: "Semua", global: "Global", project: "Project", plugin: "Plugin" };
const CHIP_ORDER: SkillLayerChip[] = ["all", "global", "project", "plugin"];
export const layerChipOf = (s: SkillEntry): Exclude<SkillLayerChip, "all"> =>
  s.layer === "project" ? "project" : s.layer === "plugin" ? "plugin" : "global";
// Nama project di banner galat: dipotong agar tak memenuhi baris; nama lengkapnya tetap di `title`.
export const ringkasNama = (nama: string, maks = 40): string =>
  nama.length > maks ? `${nama.slice(0, maks - 1).trimEnd()}…` : nama;

function Row({ s, selected, onSelect, projectName }: { s: SkillEntry; selected: boolean; onSelect: (s: SkillEntry) => void; projectName?: string }) {
  // Maks dua lencana per baris: status yang perlu diperhatikan lebih dulu, lalu sumber bila ada.
  const flags: React.ReactNode[] = [];
  if (s.frontmatterError) flags.push(<Badge key="fm" size="sm" tone="err" icon="alert-triangle">frontmatter</Badge>);
  if (s.shadowedBy) flags.push(<Badge key="sh" size="sm" tone="warn">tertimpa</Badge>);
  if (s.loadedBy.length === 0) flags.push(<Badge key="nl" size="sm" tone="neutral">tidak dimuat</Badge>);
  return (
    <li>
      <button type="button" className={`hn-skill-row${selected ? " is-selected" : ""}`}
        aria-current={selected ? "true" : undefined} onClick={() => onSelect(s)}>
        <span className="hn-skill-row-head">
          <span className="hn-skill-row-name">{s.name}</span>
          {!s.editable && <Icon name="lock" size={12} color="var(--text-subtle)" aria-label="Hanya baca" />}
        </span>
        {s.description && <span className="hn-skill-row-desc">{s.description}</span>}
        <span className="hn-skill-row-meta">
          <span className="hn-prj-mono">{sourceLabel(s)}</span>
          {s.layer === "project" && projectName && <span>{projectName}</span>}
          {flags.slice(0, 2)}
        </span>
      </button>
    </li>
  );
}

export function SkillsList({ library, selected, onSelect, projectFirst = false }:
  { library: SkillLibraryView; selected?: string; onSelect: (s: SkillEntry) => void; projectFirst?: boolean }) {
  const [q, setQ] = React.useState("");
  const [chip, setChip] = React.useState<SkillLayerChip>("all");
  const everything: SkillEntry[] = [
    ...library.global,
    ...library.projects.flatMap((p) => p.skills),
  ];
  const counts: Record<SkillLayerChip, number> = {
    all: everything.length,
    global: everything.filter((s) => layerChipOf(s) === "global").length,
    project: everything.filter((s) => layerChipOf(s) === "project").length,
    plugin: everything.filter((s) => layerChipOf(s) === "plugin").length,
  };
  const match = (s: SkillEntry) => (chip === "all" || layerChipOf(s) === chip)
    && (!q || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const globalRows = library.global.filter(match);
  const projectBlocks = library.projects.map((p) => ({ project: p, rows: p.skills.filter(match) }));
  const shownRows = projectFirst
    ? [...projectBlocks.flatMap((b) => b.rows), ...globalRows]
    : [...globalRows, ...projectBlocks.flatMap((b) => b.rows)];
  const searching = q !== "" || chip !== "all";
  const failedProjects = library.projects.filter((p) => p.error);
  return (
    <div className="hn-skill-list">
      <div className="hn-skill-list-tools">
        <Input aria-label="Cari skill" placeholder="mis. deploy" value={q} leftIcon="search" size="sm"
          className="hn-prj-full" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
        <div role="group" aria-label="Lapis skill" className="hn-prj-chips">
          {CHIP_ORDER.map((c) => (
            <button key={c} type="button" className="hn-prj-chip hn-touch-target" aria-pressed={chip === c}
              onClick={() => setChip(c)}>
              {CHIP_LABEL[c]}<span className="hn-prj-chip-count">{counts[c]}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Galat pemuatan project adalah banner di atas daftar, bukan item di dalamnya (role=alert dari Callout). */}
      {failedProjects.length > 0 && (
        <Callout tone="err" title="Sebagian skill belum bisa dimuat">
          {failedProjects.map((p) => <div key={p.projectId} title={p.name}>{ringkasNama(p.name)}: {p.error}</div>)}
          <div>Periksa lokasi repo project itu di Projects.</div>
        </Callout>
      )}
      <div className="hn-skill-list-scroll">
        {shownRows.length > 0 && (
          <ul role="list" aria-label="Daftar skill" className="hn-skill-rows">
            {shownRows.map((s) => <Row key={s.key} s={s} selected={s.key === selected} onSelect={onSelect}
              projectName={library.projects.find((p) => p.projectId === s.projectId)?.name ?? (s.projectId ?? undefined)} />)}
          </ul>
        )}
        {shownRows.length === 0 && (searching
          ? <StateBlock kind="empty" compact icon="search" title="Tak ada skill cocok pencarian" hint="Coba kata lain, atau pilih lapis Semua." />
          : <StateBlock kind="empty" compact icon="sparkles" title="Belum ada skill" />)}
      </div>
    </div>
  );
}
