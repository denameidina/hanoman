/* DocsWorkspace — penjelajah dokumen Source-of-Truth. Pohon + cakupan dari GET /docs; isi berkas dari
   GET/PUT /docs/*path (tersimpan di server).
   Audit UI/UX 2026-10 (P0): draft kotor ditandai & dijaga (konfirmasi saat pindah berkas/Baca),
   simpan dengan try/catch + busy + galat inline, Ctrl/Cmd+S, pohon terbuka sampai berkas terpilih.

   Redesign 3P (Docs): satu toggle Baca | Edit; mode Edit memakai bar status sticky ("belum disimpan",
   Batal, Simpan). Pencarian lintas dokumen di atas pohon. Chip kategori (PRD · Spec · ADR · Lainnya)
   diturunkan dari path kategori — tanpa API baru. Cakupan tampil sebagai chip di header pohon.
   Pohon memakai role="tree" dengan navigasi panah. Hapus dan unduh pindah ke menu ⋯. */
import React from "react";
import { StatusPill, Badge, Button, Icon, StateBlock, MarkdownView, DocDownload, ResponsivePanels, Input,
  OverflowActions, useConfirm } from "../ds";
import { api } from "../api/client";
import { usePersistedState, scoped, isStr } from "../ui-state";
import { failureMessage } from "../lib/report-error";
import "./styles/docs.css";
import "./styles/projects.css";

type DocCat = { cat: string; files: string[]; linked: boolean; scored: boolean; root?: boolean };

type TreeNode = { path: string; label: string; cat?: DocCat; kids: TreeNode[] };

// A folder that owns no files and has a single child is just a longer path
// (`internal` + `docs`), so fold it into one row.
function collapse(n: TreeNode): TreeNode {
  let m: TreeNode = { ...n, kids: n.kids.map(collapse) };
  while (!m.cat && m.kids.length === 1) {
    const only = m.kids[0]!;
    m = { ...only, label: m.label + "/" + only.label };
  }
  return m;
}

// The API's `tree` is a flat list of full dir paths; nest it so siblings under
// the same parent live in one group.
export function buildTree(cats: DocCat[]): TreeNode[] {
  const root: TreeNode = { path: "", label: "", kids: [] };
  for (const c of cats) {
    if (c.cat === ".") { root.kids.push({ path: ".", label: ".", cat: c, kids: [] }); continue; }
    let cur = root;
    for (const seg of c.cat.split("/")) {
      const path = cur.path ? cur.path + "/" + seg : seg;
      let next = cur.kids.find((k) => k.path === path);
      if (!next) { next = { path, label: seg, kids: [] }; cur.kids.push(next); }
      cur = next;
    }
    cur.cat = c;
  }
  return root.kids.map(collapse);
}

// Preselect: kategori SoT yang ter-link dulu, lalu kategori SoT mana pun. Jangan
// pernah membuka file yang tidak dinilai kalau ada yang dinilai.
export function firstDoc(cats: DocCat[]): string {
  const pick = cats.find((c) => c.scored && c.linked) ?? cats.find((c) => c.scored) ?? cats[0];
  return pick && pick.files[0] ? `${pick.cat}/${pick.files[0]}` : "";
}

/** Kategori dokumen dari path kategori (tanpa API baru). Urutan: ADR, PRD, Spec, lalu Lainnya. */
export type DocKind = "PRD" | "Spec" | "ADR" | "Lainnya";
export function docKind(cat: string): DocKind {
  if (/(^|\/)adr(s)?(\/|$)/i.test(cat)) return "ADR";
  if (/(^|\/)prd(s)?(\/|$)/i.test(cat)) return "PRD";
  if (/(^|\/)spec(s|ification)?(\/|$)/i.test(cat)) return "Spec";
  return "Lainnya";
}
const KIND_CHIPS: readonly DocKind[] = ["PRD", "Spec", "ADR", "Lainnya"];
type KindFilter = "all" | DocKind;

/** Kunci node pohon: folder diawali `dir:` supaya tak bentrok dengan kunci berkas (`cat/file`). */
const dirKey = (path: string) => `dir:${path}`;

/** Kunci berkas (`cat/file`) di bawah node ini — dipakai untuk membuka folder yang memuat pilihan. */
const containsSelected = (node: TreeNode, selected: string) => !!selected && selected.startsWith(node.path + "/");

type TreeCtx = { selected: string; onSelect: (k: string) => void; tabbable: string; setFocusKey: (k: string) => void };

function DocTreeNode({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeCtx }) {
  // Folder yang memuat berkas terpilih terbuka dari awal dan saat pilihan berpindah ke dalamnya.
  const inside = containsSelected(node, ctx.selected);
  const [open, setOpen] = React.useState(inside);
  React.useEffect(() => { if (inside) setOpen(true); }, [inside]);
  const scored = node.cat?.scored ?? true;
  const linked = node.cat?.linked ?? true;
  const key = dirKey(node.path);
  const toggle = () => setOpen((o) => !o);
  const onFolderKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight" && !open) { e.preventDefault(); setOpen(true); }
    else if (e.key === "ArrowLeft" && open) { e.preventDefault(); setOpen(false); }
  };
  return (
    <>
      <div role="treeitem" aria-level={depth + 1} aria-expanded={open} tabIndex={ctx.tabbable === key ? 0 : -1}
        className="hn-docs-node hn-docs-node-dir" style={{ paddingLeft: 6 + depth * 12 }}
        onClick={toggle} onKeyDown={onFolderKey} onFocus={() => ctx.setFocusKey(key)}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color={!scored ? "var(--text-subtle)" : linked ? "var(--brass-500)" : "var(--clay-500)"} />
        <span className="hn-docs-dir-label">{node.label}/</span>
        {node.cat && scored && (node.cat.linked
          ? <Icon name="link" size={13} color="var(--leaf-600)" />
          : <Icon name="unlink" size={13} color="var(--clay-500)" />)}
      </div>
      {open && (
        <div role="group" className="hn-docs-group">
          {node.kids.map((k) => <DocTreeNode key={k.path} node={k} depth={depth + 1} ctx={ctx} />)}
          {node.cat?.files.map((f) => {
            const fileKey = node.path + "/" + f;
            const on = fileKey === ctx.selected;
            return (
              <div role="treeitem" key={f} aria-level={depth + 2} aria-selected={on}
                aria-current={on ? "true" : undefined} tabIndex={ctx.tabbable === fileKey ? 0 : -1}
                className={`hn-docs-node hn-docs-node-file${on ? " is-selected" : ""}`}
                style={{ paddingLeft: 18 + depth * 12 }}
                onClick={() => ctx.onSelect(fileKey)} onFocus={() => ctx.setFocusKey(fileKey)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.onSelect(fileKey); } }}>
                <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                <span className={`hn-docs-file-label${!scored || linked ? "" : " is-unlinked"}`}>{f}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Pohon berkas (role=tree). Panah atas/bawah memindahkan fokus antar item yang terlihat. */
function DocTree({ label, nodes, selected, onSelect }:
  { label: string; nodes: TreeNode[]; selected: string; onSelect: (k: string) => void }) {
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  // Satu tab stop: item terpilih (atau item terakhir yang difokus), lalu item pertama.
  const first = nodes[0] ? dirKey(nodes[0].path) : "";
  const tabbable = focusKey ?? (selected || first);
  const ctx: TreeCtx = { selected, onSelect, tabbable, setFocusKey: (k) => setFocusKey(k) };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
  };
  return (
    <div role="tree" aria-label={label} className="hn-docs-tree" onKeyDown={onKeyDown}>
      {nodes.map((n) => <DocTreeNode key={n.path} node={n} depth={0} ctx={ctx} />)}
    </div>
  );
}

export function DocsWorkspace({ projectId, projectName, docStatus }:
  { projectId: string; projectName: string; docStatus: string }) {
  const [tree, setTree] = React.useState<DocCat[]>([]);
  const [coverage, setCoverage] = React.useState(0);
  // SPEC-740 · ADR-0115 · ber-scope project: dokumen yang dibuka di project A tak boleh
  // muncul saat project B dibuka.
  const [selected, setSelected] = usePersistedState(scoped("docs", projectId), "selected", "", isStr);
  // null = fetch-nya gagal (bukan "isi kosong"), supaya error state bisa dibedakan.
  const [cache, setCache] = React.useState<Record<string, string | null>>({});
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [panel, setPanel] = React.useState<"tree" | "viewer">("tree");
  const [draft, setDraft] = React.useState("");
  const [scanning, setScanning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Galat simpan/hapus tampil inline di atas isi dokumen; draft tetap utuh saat gagal.
  const [actionErr, setActionErr] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  // SPEC-847 · ADR-0127 · konfirmasi hapus dokumen memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();
  const [ixStatus, setIxStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [ixTry, setIxTry] = React.useState(0);

  // load index when the project changes
  React.useEffect(() => {
    let alive = true;
    setIxStatus("loading");
    api.getDocs(projectId).then((ix) => {
      if (!alive) return;
      const t = ix.tree as DocCat[];
      setTree(t); setCoverage(ix.coverage); setCache({}); setMode("preview"); setIxStatus("ready");
      setActionErr(""); setQuery(""); setKindFilter("all");
      setSelected(firstDoc(t));
    }).catch(() => { if (alive) { setTree([]); setSelected(""); setIxStatus("error"); } });
    return () => { alive = false; };
  }, [projectId, ixTry]);

  // load file content when selection changes (once, cached)
  React.useEffect(() => {
    if (!selected || selected in cache) return;
    let alive = true;
    api.getDoc(projectId, selected)
      .then((d) => { if (alive) setCache((c) => ({ ...c, [selected]: d.content })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [selected]: null })); });
    return () => { alive = false; };
  }, [selected, projectId, cache]);

  const docLoading = !!selected && !(selected in cache);
  const docFailed = selected ? cache[selected] === null : false;
  const retryDoc = () => setCache((c) => { const n = { ...c }; delete n[selected]; return n; });

  // Chip kategori menyaring kategori (folder) sebelum pohon dibangun.
  const inKind = (c: DocCat) => kindFilter === "all" || docKind(c.cat) === kindFilter;
  const nested = buildTree(tree.filter((c) => c.scored && inKind(c)));
  const unscored = buildTree(tree.filter((c) => !c.scored && inKind(c)));
  const current = cache[selected] ?? "";
  // `selected` is the full repo-relative path (cat + "/" + basename); category is
  // everything before the last slash.
  const cat = selected.includes("/") ? selected.slice(0, selected.lastIndexOf("/")) : ".";
  const node = tree.find((n) => n.cat === cat);
  const displayPath = selected;
  // Draft kotor = mode edit dengan isi yang berbeda dari yang tersimpan.
  const dirty = mode === "edit" && draft !== current;

  // Filter berkas: daftar datar semua berkas, dicocokkan terhadap path lengkapnya.
  const allFiles = React.useMemo(() => tree.flatMap((c) => c.files.map((f) => ({
    key: `${c.cat}/${f}`, scored: c.scored, linked: c.linked, kind: docKind(c.cat),
  }))), [tree]);
  const needle = query.trim().toLowerCase();
  const matches = needle ? allFiles.filter((f) => (kindFilter === "all" || f.kind === kindFilter) && f.key.toLowerCase().includes(needle)) : [];
  const kindCounts = React.useMemo(() => {
    const counts: Record<DocKind, number> = { PRD: 0, Spec: 0, ADR: 0, Lainnya: 0 };
    for (const f of allFiles) counts[f.kind] += 1;
    return counts;
  }, [allFiles]);

  const status = docStatus === "broken" ? "broken" : docStatus === "drift" ? "drift" : "ok";

  /** Jalankan `run` setelah draft kotor dikonfirmasi dibuang; tanpa draft kotor langsung jalan. */
  function whenClean(run: () => void) {
    if (!dirty) { setMode("preview"); run(); return; }
    void confirm({
      title: "Buang perubahan?", eyebrow: selected,
      message: "Isi dokumen yang kamu ubah belum disimpan.",
      impact: ["Perubahan di editor hilang dan tak bisa dikembalikan dari dashboard."],
      confirmLabel: "Buang perubahan", cancelLabel: "Lanjut mengedit", tone: "danger", icon: "trash-2",
    }).then((ok) => { if (ok) { setMode("preview"); run(); } });
  }
  function startEdit() { setActionErr(""); setDraft(current); setMode("edit"); }
  const cancelEdit = () => whenClean(() => undefined);
  async function save() {
    if (saving || !selected) return;
    setSaving(true); setActionErr("");
    try {
      await api.putDoc(projectId, selected, draft);
      setCache((c) => ({ ...c, [selected]: draft }));
      setMode("preview");
    } catch (e) {
      // Draft dipertahankan: operator bisa mencoba lagi tanpa mengetik ulang.
      setActionErr(failureMessage("menyimpan dokumen", e));
    } finally { setSaving(false); }
  }
  function selectFile(k: string) { whenClean(() => { setSelected(k); setMode("preview"); setPanel("viewer"); }); }

  async function reloadIndex() {
    const ix = await api.getDocs(projectId);
    const t = ix.tree as DocCat[];
    setTree(t); setCoverage(ix.coverage);
    // Cocokkan SELURUH file kategori, bukan cuma files[0].
    if (!t.some((n) => n.files.some((f) => `${n.cat}/${f}` === selected))) setSelected(firstDoc(t));
  }
  // GET /docs sudah realtime; tombolnya cuma memuat ulang, kalau-kalau file berubah
  // dari luar dashboard. Tak ada lagi POST /scan (SPEC-141).
  async function rescan() {
    if (scanning) return;
    setScanning(true);
    try { await reloadIndex(); }
    catch { setIxStatus("error"); }   // indeks gagal dibaca → error + "Coba lagi", bukan daftar kosong
    finally { setScanning(false); }
  }
  async function removeDoc() {
    if (!selected) return;
    const path = selected;
    let ok = false;
    try {
      ok = await confirm({
        title: `Hapus ${path}?`, eyebrow: "Source of Truth",
        message: "Dokumen ini adalah Source of Truth project. Berkas aslinya di disk ikut dihapus.",
        impact: ["Berkas di disk dihapus dan tak bisa dikembalikan dari dashboard.", "Kategori indeks dihitung ulang setelah penghapusan."],
        confirmLabel: "Hapus dokumen", tone: "danger", icon: "trash-2",
        run: () => api.deleteDoc(projectId, path),
      });
    } catch (e) { setActionErr(failureMessage("menghapus dokumen", e)); return; }
    if (!ok) return;
    setCache((c) => { const n = { ...c }; delete n[path]; return n; });
    try { await reloadIndex(); } catch { setIxStatus("error"); }
  }

  const indexBody = ixStatus === "loading" ? <StateBlock kind="loading" compact title="Memuat indeks…" />
    : ixStatus === "error" ? <StateBlock kind="error" compact title="Gagal memuat indeks dokumen"
        hint={projectName} action={() => setIxTry((n) => n + 1)} />
    : tree.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Belum ada dokumen"
        hint="Belum ada Markdown di repo ini."
        action={rescan} actionLabel="Muat ulang" actionIcon="radar" />
    : needle ? (
        matches.length === 0
          ? <StateBlock kind="empty" compact icon="search" title="Tak ada berkas cocok" hint={`Tak ada yang cocok dengan “${query.trim()}”.`} />
          : <div role="list" aria-label="Hasil pencarian berkas" className="hn-docs-results">
              {matches.map((m) => (
                <button type="button" key={m.key} aria-current={m.key === selected ? "true" : undefined}
                  onClick={() => selectFile(m.key)} className={`hn-docs-result${m.key === selected ? " is-selected" : ""}`}>
                  <Icon name="file-text" size={13} color="var(--text-subtle)" />
                  <span className="hn-prj-mono">{m.key}</span>
                  <span className="hn-docs-result-kind">{m.kind}</span>
                </button>
              ))}
            </div>
      )
    : (<>
        <DocTree label="Berkas dokumen" nodes={nested} selected={selected} onSelect={selectFile} />
        {unscored.length > 0 && (
          <div className="hn-docs-unscored">
            <div className="hn-eyebrow hn-docs-unscored-label">Lainnya (tidak dinilai)</div>
            <DocTree label="Dokumen tidak dinilai" nodes={unscored} selected={selected} onSelect={selectFile} />
          </div>
        )}
      </>);

  return (
    <>
    <ResponsivePanels
      ariaLabel="Panel Dokumen"
      active={panel}
      onActiveChange={(next) => setPanel(next as "tree" | "viewer")}
      masterWidth={288}
      className="hn-workspace-panels"
      panels={[
        { id: "tree", label: "Indeks", className: "hn-panel-flex", content: (
      <aside aria-label="Indeks dokumen" className="hn-docs-index">
        <div className="hn-docs-index-head">
          <span className="hn-eyebrow">dokumen · {projectName}</span>
          <div className="hn-docs-index-actions">
            <StatusPill status={status} size="sm" />
            <Button size="sm" variant="ghost" leftIcon={scanning ? "loader" : "radar"} onClick={rescan} disabled={scanning}>
              {scanning ? "Memuat…" : "Muat ulang"}
            </Button>
          </div>
        </div>
        {ixStatus === "ready" && tree.length > 0 && (
          <div className="hn-docs-index-tools">
            <Input size="sm" aria-label="Cari berkas dokumen" leftIcon="search" value={query}
              placeholder="mis. product/prd" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              className="hn-prj-full" />
            <div role="group" aria-label="Kategori dokumen" className="hn-prj-chips">
              <button type="button" className="hn-prj-chip hn-touch-target" aria-pressed={kindFilter === "all"}
                onClick={() => setKindFilter("all")}>Semua</button>
              {KIND_CHIPS.map((k) => (
                <button key={k} type="button" className="hn-prj-chip hn-touch-target" aria-pressed={kindFilter === k}
                  onClick={() => setKindFilter(k)}>
                  {k}<span className="hn-prj-chip-count">{kindCounts[k]}</span>
                </button>
              ))}
            </div>
            <span className="hn-docs-cov" title="Persentase kategori yang terindeks">
              Cakupan {Math.round(coverage)}%
            </span>
          </div>
        )}
        <div className="hn-docs-tree-scroll">{indexBody}</div>
      </aside>
        ) },

        { id: "viewer", label: "Dokumen", className: "hn-panel-flex", content: (
      /* SPEC-393 · `fill` menyambungkan rantai flex: viewer memakai scroller lokal dan tidak
         menumbuhkan halaman. */
      /* Rantai flex SPEC-363/393: pane menggulir hanya bila setiap leluhur menjadi flex dan boleh
         menyusut. Nilainya inline karena kontrak itu diuji lewat style (jsdom tak memuat CSS);
         ia struktural, bukan presentasi, dan tetap berupa nilai flex/overflow tanpa angka tetap. */
      <section aria-label="Isi dokumen" className="hn-docs-viewer" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="hn-docs-viewer-head">
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span className="hn-prj-mono hn-docs-path">{displayPath}</span>
          {node && node.scored && (node.linked
            ? <Badge tone="ok" size="sm" icon="link">terindeks</Badge>
            : <Badge tone="err" size="sm" icon="unlink">tak tertaut</Badge>)}
          <span className="hn-grow" />
          {/* Satu toggle Baca | Edit. Pindah ke Baca dari draft kotor melewati konfirmasi. */}
          <div role="group" aria-label="Mode dokumen" className="hn-prj-seg">
            <button type="button" aria-pressed={mode === "preview"} className="hn-touch-target"
              onClick={() => { if (mode === "edit") cancelEdit(); }}>Baca</button>
            <button type="button" aria-pressed={mode === "edit"} className="hn-touch-target"
              onClick={() => { if (mode !== "edit") startEdit(); }}
              disabled={!selected || docLoading || docFailed}>Edit</button>
          </div>
          {mode === "preview" && (
            // SPEC-361 · unduh (isi tersimpan, bukan draft) dan hapus ada di ⋯ — hapus bukan aksi biasa.
            <OverflowActions label="Aksi untuk dokumen" icon="ellipsis" items={[
              { key: "delete", label: "Hapus dokumen…", icon: "trash-2", tone: "danger",
                disabled: !selected, onSelect: () => { void removeDoc(); } },
            ]}>
              <DocDownload href={(f) => api.docDownloadUrl(projectId, selected, f)}
                disabled={!selected || docLoading || docFailed} />
            </OverflowActions>
          )}
        </div>

        {mode === "edit" && (
          // Bar status sticky: indikator draf kotor dan dua aksi. Selalu di atas isi editor.
          <div role="region" aria-label="Simpan perubahan" className="hn-docs-savebar">
            {dirty ? <Badge tone="warn" size="sm">belum disimpan</Badge>
              : <span className="hn-prj-hint">Tak ada perubahan</span>}
            <span className="hn-grow" />
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>Batal</Button>
            <Button size="sm" leftIcon="check" onClick={() => void save()} loading={saving} disabled={saving || !dirty}>Simpan</Button>
          </div>
        )}
        {actionErr && <div role="alert" className="hn-docs-error">{actionErr}</div>}

        {mode === "preview" ? (
          <div data-testid="doc-preview-scroll" className="hn-docs-body" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
            {!selected ? <StateBlock kind="empty" icon="file-text" title="Tidak ada dokumen dipilih"
                hint="Pilih file dari indeks di kiri." />
              : docLoading ? <StateBlock kind="loading" title="Memuat dokumen…" hint={selected} />
              : docFailed ? <StateBlock kind="error" title="Gagal memuat dokumen" hint={selected} action={retryDoc} />
              : <div className="hn-docs-read"><MarkdownView text={current} name={selected} /></div>}
          </div>
        ) : (
          <div className="hn-docs-edit">
            <div className="hn-docs-edit-pane">
              <div className="hn-docs-edit-label"><span className="hn-eyebrow">Markdown</span></div>
              <textarea aria-label={`Isi ${displayPath}`} value={draft} spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}
                placeholder={"# Judul dokumen\n\nParagraf pembuka…"} className="hn-docs-textarea" />
            </div>
            <div className="hn-docs-edit-pane">
              <div className="hn-docs-edit-label"><span className="hn-eyebrow">Pratinjau langsung</span></div>
              <div className="hn-docs-preview">
                <MarkdownView text={draft} name={selected} />
              </div>
            </div>
          </div>
        )}
      </section>
        ) },
      ]}
    />
    {dialog}
    </>
  );
}
