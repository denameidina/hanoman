/* file-tree — tree file dari path datar (dipakai Review & IDE, SPEC-189).
   Audit 2026-10 · pohon ARIA: `TreeRoot` memberi role="tree", navigasi panah (↑↓ Home End ←→),
   dan roving tabindex — satu tab stop, bukan satu Tab per berkas. Tiap baris memakai
   role="treeitem" + aria-expanded/aria-selected/aria-level.
   Audit UI/UX 2026-10 (3H) · `TreeRow` menerima `menu` opsional: klik-kanan, tombol ⋯ (pointer), dan
   tombol Menu / Shift+F10 (keyboard) membuka menu konteks entri. Tanpa `menu`, baris persis seperti dulu. */
import React from "react";
import { Icon } from "../ds";
import type { ChangedFile } from "../api/client";
// Gaya pohon & daftar Changed ikut modul ini, bukan dari ide.css (yang hanya termuat bersama layar IDE).
import "./styles/file-tree.css";

export type FileNode = { name: string; path: string; kids: FileNode[]; leaf: boolean };
/**
 * `dirs` menamai direktori yang harus ada SEBAGAI direktori meski tak satu pun path di `paths`
 * lewat di bawahnya — direktori terabaikan yang diruntuhkan server, yang isinya baru dimuat saat
 * dibuka. Tanpa daftar terpisah ini, "dist" berbentuk persis seperti berkas bernama dist.
 */
export function buildFileTree(paths: string[], dirs: string[] = []): FileNode[] {
  const root: FileNode = { name: "", path: "", kids: [], leaf: false };
  const add = (p: string, leafLast: boolean) => {
    let cur = root;
    const segs = p.split("/").filter(Boolean);
    segs.forEach((seg, i) => {
      const leaf = leafLast && i === segs.length - 1;
      const path = cur.path ? cur.path + "/" + seg : seg;
      let next = cur.kids.find((k) => k.name === seg && k.leaf === leaf);
      if (!next) { next = { name: seg, path, kids: [], leaf }; cur.kids.push(next); }
      cur = next;
    });
  };
  for (const p of paths) add(p, true);
  for (const d of dirs) add(d, false);
  const sort = (n: FileNode) => {
    n.kids.sort((a, b) => (a.leaf === b.leaf ? a.name.localeCompare(b.name) : a.leaf ? 1 : -1));
    n.kids.forEach(sort);
  };
  sort(root);
  return root.kids;
}

// Warna status (A/M/D) ada di ide.css lewat `data-status`. Kelas & CSS variable untuk baris pohon:
// `--depth` (kedalaman) dihitung CSS, bukan inline per properti.
const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
const cssVars = (vars: Record<string, string | number>) => vars as React.CSSProperties;

// Roving tabindex: `tabPath` = baris yang terakhir difokus (tab stop), `firstPath` = cadangan
// bila belum ada yang difokus. Dibagi lewat konteks supaya TreeRow rekursif tak perlu prop baru.
type TreeNav = { tabPath: string; firstPath: string; setTabPath: (p: string) => void };
const TreeNavCtx = React.createContext<TreeNav | null>(null);

/** Menu konteks entri: `anchor` = elemen pemicu (fokus kembali ke sini), `pos` = posisi pointer. */
export type TreeMenu = (path: string, kind: "file" | "dir", anchor: HTMLElement,
  pos?: { x: number; y: number }) => void;

/** Pembungkus pohon: role="tree", navigasi keyboard, dan satu tab stop. */
export function TreeRoot({ label, nodes, children }: { label: string; nodes: FileNode[]; children: React.ReactNode }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [tabPath, setTabPath] = React.useState("");
  const firstPath = nodes[0]?.path ?? "";
  // Tab stop yang induknya diruntuhkan / daftarnya berganti hilang dari DOM: kembali ke pertama.
  React.useEffect(() => {
    if (!tabPath) return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    if (!items.some((el) => el.dataset.path === tabPath)) setTabPath("");
  });
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const cur = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (cur?.dataset.path) setTabPath(cur.dataset.path);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const cur = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!root || !cur) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const i = items.indexOf(cur);
    const expanded = cur.getAttribute("aria-expanded");
    let go: HTMLElement | undefined;
    switch (e.key) {
      case "ArrowDown": go = items[i + 1]; break;
      case "ArrowUp": go = items[i - 1]; break;
      case "Home": go = items[0]; break;
      case "End": go = items[items.length - 1]; break;
      case "ArrowRight":
        // Folder tertutup dibuka; folder terbuka pindah ke anak pertamanya (baris berikutnya di DOM).
        if (expanded === "false") cur.click(); else if (expanded === "true") go = items[i + 1];
        break;
      case "ArrowLeft":
        // Folder terbuka ditutup; selain itu naik ke induknya (treeitem sebelum grup pembungkusnya).
        if (expanded === "true") cur.click();
        else go = cur.closest<HTMLElement>('[role="group"]')?.previousElementSibling as HTMLElement | undefined;
        break;
      default: return;
    }
    e.preventDefault();
    go?.focus();
  };
  return (
    <TreeNavCtx.Provider value={{ tabPath, firstPath, setTabPath }}>
      <div ref={rootRef} role="tree" aria-label={label} onFocus={onFocus} onKeyDown={onKeyDown}>
        {children}
      </div>
    </TreeNavCtx.Provider>
  );
}

/** Pembuka menu konteks dari keyboard (tombol Menu atau Shift+F10) dan dari klik-kanan. */
function menuFromKeyboard(e: React.KeyboardEvent<HTMLElement>, open: (anchor: HTMLElement) => void) {
  if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
    e.preventDefault();
    open(e.currentTarget);
  }
}

export function TreeRow({ node, selected, onSelect, depth = 0, meta, defaultOpen = false, dirSelected, onSelectDir,
  ignored, onExpand, menu }:
  { node: FileNode; selected: string; onSelect: (p: string) => void; depth?: number;
    meta?: Record<string, ChangedFile>; defaultOpen?: boolean;
    // ADR-0121 · folder sebagai TUJUAN operasi berkas. Opsional supaya pemakaian di Review
    // (ChangedSection) tak berubah sedikit pun.
    dirSelected?: string; onSelectDir?: (p: string) => void;
    // Entri yang .gitignore sembunyikan — diredupkan supaya toggle "tersembunyi" terbaca sebagai
    // keadaan, bukan sebagai daftar yang tiba-tiba memanjang tanpa sebab.
    ignored?: Set<string>;
    // Direktori terabaikan datang KOSONG dari server; isinya dimuat saat ia dibuka.
    onExpand?: (p: string) => void | Promise<void>;
    // Menu konteks entri (Ganti nama, Hapus, Berkas baru di folder itu). Opsional.
    menu?: TreeMenu }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [loading, setLoading] = React.useState(false);
  const nav = React.useContext(TreeNavCtx);
  const tabbable = !nav || (nav.tabPath ? nav.tabPath === node.path : nav.firstPath === node.path);
  const ignoredEntry = ignored?.has(node.path) ?? false;
  // Tombol ⋯ hanya untuk pointer: ia `aria-hidden` dan di luar tab order. Jalur keyboard-nya tombol
  // Menu/Shift+F10 pada baris itu sendiri, sehingga aksinya tetap terjangkau tanpa tombol bersarang.
  const more = (onOpen: (anchor: HTMLElement, pos: { x: number; y: number }) => void) => (
    <button type="button" className="hn-ide-row-more" tabIndex={-1} aria-hidden="true"
      title={`Aksi untuk ${node.name}`}
      onClick={(e) => { e.stopPropagation(); onOpen(e.currentTarget, { x: e.clientX, y: e.clientY }); }}>
      <Icon name="more-horizontal" size={14} color="var(--text-muted)" />
    </button>
  );
  if (node.leaf) {
    const on = node.path === selected;
    const cf = meta?.[node.path];
    const openMenu = (anchor: HTMLElement, pos?: { x: number; y: number }) => menu?.(node.path, "file", anchor, pos);
    const row = (
      // Peran treeitem hanya di dalam TreeRoot: di luar pohon, baris tetap tombol biasa (tanpa
      // treeitem yatim yang melanggar ARIA).
      <button {...(nav ? { role: "treeitem", "aria-selected": on, "aria-level": depth + 1, tabIndex: tabbable ? 0 : -1 } : {})}
        data-path={node.path} onClick={() => onSelect(node.path)}
        onContextMenu={menu ? (e) => { e.preventDefault(); openMenu(e.currentTarget, { x: e.clientX, y: e.clientY }); } : undefined}
        onKeyDown={menu ? (e) => menuFromKeyboard(e, (a) => openMenu(a)) : undefined}
        className={cls("hn-ide-tree-leaf", on && "hn-ide-sel", ignoredEntry && "hn-ide-tree-ignored", menu && "hn-ide-tree-entry")}
        style={cssVars({ "--depth": depth })}>
        {cf
          ? <span className="hn-ide-status" data-status={cf.status}>{cf.status}</span>
          : <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />}
        <span className="hn-ide-tree-name">{node.name}</span>
        {cf && !cf.binary && <span className="hn-ide-stat">
          <span className="hn-ide-add">+{cf.add}</span>{" "}
          <span className="hn-ide-del">−{cf.del}</span>
        </span>}
      </button>
    );
    if (!menu) return row;
    return (
      <div className="hn-ide-tree-row" role={nav ? "none" : undefined}>
        {row}
        {more(openMenu)}
      </div>
    );
  }
  // Satu klik sekaligus buka/tutup dan memilih: memisahkan chevron jadi tombol tersendiri
  // berarti tombol bersarang di dalam tombol — tak sah di HTML & merusak navigasi keyboard.
  const dirOn = !!onSelectDir && node.path === dirSelected;
  // Hanya direktori yang benar-benar kosong yang boleh meminta isinya; setelah termuat sekali,
  // kids-nya terisi dan klik berikutnya kembali jadi buka/tutup murni.
  const lazy = !!onExpand && node.kids.length === 0;
  async function toggle() {
    onSelectDir?.(node.path);
    const next = !open;
    // Menutup folder yang memuat tab stop menjatuhkan fokus ke folder itu, bukan ke baris yang hilang.
    if (!next && nav && nav.tabPath.startsWith(node.path + "/")) nav.setTabPath(node.path);
    setOpen(next);
    if (next && lazy && !loading) {
      setLoading(true);
      try { await onExpand?.(node.path); } finally { setLoading(false); }
    }
  }
  const openMenu = (anchor: HTMLElement, pos?: { x: number; y: number }) => menu?.(node.path, "dir", anchor, pos);
  const folder = (
    <button {...(nav ? { role: "treeitem", "aria-expanded": open, "aria-selected": dirOn, "aria-level": depth + 1, tabIndex: tabbable ? 0 : -1 } : {})}
      data-path={node.path} onClick={() => void toggle()}
      onContextMenu={menu ? (e) => { e.preventDefault(); openMenu(e.currentTarget, { x: e.clientX, y: e.clientY }); } : undefined}
      onKeyDown={menu ? (e) => menuFromKeyboard(e, (a) => openMenu(a)) : undefined}
      className={cls("hn-ide-tree-dir", dirOn && "hn-ide-sel", ignoredEntry && "hn-ide-tree-ignored", menu && "hn-ide-tree-entry")}
      style={cssVars({ "--depth": depth })}>
      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
      <Icon name="folder" size={15} color={dirOn ? "var(--brass-700)" : "var(--brass-500)"} />
      <span className="hn-ide-tree-dirname">{node.name}/</span>
      {loading && <span className="hn-ide-tree-loading">memuat…</span>}
    </button>
  );
  return (
    <div role={nav ? "none" : undefined}>
      {menu ? (
        <div className="hn-ide-tree-row" role={nav ? "none" : undefined}>
          {folder}
          {more(openMenu)}
        </div>
      ) : folder}
      {open && (
        <div role={nav ? "group" : undefined}>
          {node.kids.map((k) => (
            <TreeRow key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1}
              meta={meta} defaultOpen={defaultOpen} dirSelected={dirSelected} onSelectDir={onSelectDir}
              ignored={ignored} onExpand={onExpand} menu={menu} />
          ))}
          {!loading && node.kids.length === 0 && (
            <div role="none" className="hn-ide-tree-empty" style={cssVars({ "--depth": depth })}>kosong</div>
          )}
        </div>
      )}
    </div>
  );
}

// SPEC-234 · satu baris file changed (status + path + +add/−del) — list view Changed/Staged.
export function ChangedRow({ cf, selected, onSelect }:
  { cf: ChangedFile; selected: string; onSelect: (p: string) => void }) {
  const on = cf.path === selected;
  return (
    <button onClick={() => onSelect(cf.path)} className={cls("hn-ide-changed-row", on && "hn-ide-sel")}>
      <span className="hn-ide-status" data-status={cf.status}>{cf.status}</span>
      <span className="hn-ide-changed-path">{cf.path}</span>
      {!cf.binary && <span className="hn-ide-stat">
        <span className="hn-ide-add">+{cf.add}</span>{" "}
        <span className="hn-ide-del">−{cf.del}</span>
      </span>}
    </button>
  );
}

// SPEC-234 · section changed files dgn toggle List | Tree — dipakai ReviewScreen (Changed).
// IdeScreen memakai daftarnya sendiri (Perubahan dulu); berkas ini tetap melayani Review.
export function ChangedSection({ label, changed, selected, onSelect, view, onView, emptyText = "Tak ada file berubah." }:
  { label: string; changed: ChangedFile[]; selected: string; onSelect: (p: string) => void;
    view: "list" | "tree"; onView: (v: "list" | "tree") => void; emptyText?: string }) {
  const tree = React.useMemo(() => buildFileTree(changed.map((c) => c.path)), [changed]);
  const meta = React.useMemo(
    () => Object.fromEntries(changed.map((c) => [c.path, c])) as Record<string, ChangedFile>, [changed]);
  return (
    <>
      <div className="hn-eyebrow hn-ide-changed-head">
        <span className="hn-grow">{label} · {changed.length}</span>
        {changed.length > 0 && (["list", "tree"] as const).map((v) => (
          <button key={v} aria-label={`${v === "list" ? "List" : "Tree"} ${label}`} aria-pressed={view === v} onClick={() => onView(v)}
            className="hn-ide-view-btn">
            <Icon name={v === "list" ? "list" : "folder-tree"} size={14}
              color={view === v ? "var(--brass-700)" : "var(--text-subtle)"} />
          </button>
        ))}
      </div>
      {changed.length === 0
        ? <div className="hn-ide-empty-pad">{emptyText}</div>
        : view === "tree"
        ? <TreeRoot label={`Pohon ${label}`} nodes={tree}>
            {tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={onSelect} meta={meta} defaultOpen />)}
          </TreeRoot>
        : changed.map((c) => <ChangedRow key={c.path} cf={c} selected={selected} onSelect={onSelect} />)}
    </>
  );
}
