/* file-tree — tree file dari path datar (dipakai Review & IDE Explorer, SPEC-189). */
import React from "react";
import { Icon } from "../ds";
import type { ChangedFile } from "../api/client";

export type FileNode = { name: string; path: string; kids: FileNode[]; leaf: boolean };
export function buildFileTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", path: "", kids: [], leaf: false };
  for (const p of paths) {
    let cur = root;
    const segs = p.split("/");
    segs.forEach((seg, i) => {
      const leaf = i === segs.length - 1;
      const path = cur.path ? cur.path + "/" + seg : seg;
      let next = cur.kids.find((k) => k.name === seg && k.leaf === leaf);
      if (!next) { next = { name: seg, path, kids: [], leaf }; cur.kids.push(next); }
      cur = next;
    });
  }
  const sort = (n: FileNode) => {
    n.kids.sort((a, b) => (a.leaf === b.leaf ? a.name.localeCompare(b.name) : a.leaf ? 1 : -1));
    n.kids.forEach(sort);
  };
  sort(root);
  return root.kids;
}

export const ST_COLOR: Record<string, string> = { A: "var(--leaf-600)", M: "var(--brass-600)", D: "var(--clay-500)" };

export function TreeRow({ node, selected, onSelect, depth = 0, meta, defaultOpen = false, dirSelected, onSelectDir }:
  { node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number;
    meta?: Record<string, ChangedFile>; defaultOpen?: boolean;
    // ADR-0121 · folder sebagai TUJUAN operasi berkas. Opsional supaya pemakaian di Review
    // (ChangedSection) tak berubah sedikit pun.
    dirSelected?: string; onSelectDir?: (p: string) => void }) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (node.leaf) {
    const on = node.path === selected;
    const cf = meta?.[node.path];
    return (
      <button onClick={() => onSelect(node.path)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 8px", paddingLeft: 22 + depth * 12, border: "none", cursor: "pointer",
        textAlign: "left", background: on ? "var(--brass-100)" : "transparent",
      }}>
        {cf
          ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: ST_COLOR[cf.status] }}>{cf.status}</span>
          : <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />}
        <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: on ? "var(--brass-700)" : "var(--text-body)", fontWeight: on ? 600 : 400 }}>{node.name}</span>
        {cf && !cf.binary && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <span style={{ color: "var(--leaf-600)" }}>+{cf.add}</span>{" "}
          <span style={{ color: "var(--clay-500)" }}>−{cf.del}</span>
        </span>}
      </button>
    );
  }
  // Satu klik sekaligus buka/tutup dan memilih: memisahkan chevron jadi tombol tersendiri
  // berarti tombol bersarang di dalam tombol — tak sah di HTML & merusak navigasi keyboard.
  const dirOn = !!onSelectDir && node.path === dirSelected;
  return (
    <div>
      <button onClick={() => { setOpen((o) => !o); onSelectDir?.(node.path); }} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "5px 6px", paddingLeft: 6 + depth * 12, border: "none",
        background: dirOn ? "var(--brass-100)" : "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color={dirOn ? "var(--brass-700)" : "var(--brass-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5,
          color: dirOn ? "var(--brass-700)" : "var(--text-strong)", fontWeight: dirOn ? 700 : 500 }}>{node.name}/</span>
      </button>
      {open && node.kids.map((k) => (
        <TreeRow key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1}
          meta={meta} defaultOpen={defaultOpen} dirSelected={dirSelected} onSelectDir={onSelectDir} />
      ))}
    </div>
  );
}

// SPEC-234 · satu baris file changed (status + path + +add/−del) — list view Changed/Staged.
export function ChangedRow({ cf, selected, onSelect }:
  { cf: ChangedFile; selected: string; onSelect: (p: string) => void }) {
  const on = cf.path === selected;
  return (
    <button onClick={() => onSelect(cf.path)} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 10px",
      border: "none", cursor: "pointer", textAlign: "left",
      background: on ? "var(--brass-100)" : "transparent",
    }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: ST_COLOR[cf.status] }}>{cf.status}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 12,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        color: on ? "var(--brass-700)" : "var(--text-body)" }}>{cf.path}</span>
      {!cf.binary && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        <span style={{ color: "var(--leaf-600)" }}>+{cf.add}</span>{" "}
        <span style={{ color: "var(--clay-500)" }}>−{cf.del}</span>
      </span>}
    </button>
  );
}

// SPEC-234 · section changed files dgn toggle List | Tree — dipakai ReviewScreen (Changed) &
// IdeScreen (Staged + Changed). Tree = buildFileTree + TreeRow (meta+defaultOpen); list = ChangedRow.
export function ChangedSection({ label, changed, selected, onSelect, view, onView, emptyText = "Tak ada file berubah." }:
  { label: string; changed: ChangedFile[]; selected: string; onSelect: (p: string) => void;
    view: "list" | "tree"; onView: (v: "list" | "tree") => void; emptyText?: string }) {
  const tree = React.useMemo(() => buildFileTree(changed.map((c) => c.path)), [changed]);
  const meta = React.useMemo(
    () => Object.fromEntries(changed.map((c) => [c.path, c])) as Record<string, ChangedFile>, [changed]);
  return (
    <>
      <div className="hn-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
        <span style={{ flex: 1 }}>{label} · {changed.length}</span>
        {changed.length > 0 && (["list", "tree"] as const).map((v) => (
          <button key={v} aria-label={`${v === "list" ? "List" : "Tree"} ${label}`} onClick={() => onView(v)}
            style={{ display: "flex", padding: 3, border: "none", cursor: "pointer", borderRadius: 4,
              background: view === v ? "var(--brass-100)" : "transparent" }}>
            <Icon name={v === "list" ? "list" : "folder-tree"} size={14}
              color={view === v ? "var(--brass-700)" : "var(--text-subtle)"} />
          </button>
        ))}
      </div>
      {changed.length === 0
        ? <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--text-subtle)" }}>{emptyText}</div>
        : view === "tree"
        ? tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={onSelect} meta={meta} defaultOpen />)
        : changed.map((c) => <ChangedRow key={c.path} cf={c} selected={selected} onSelect={onSelect} />)}
    </>
  );
}
