/* DocsWorkspace — interactive Source-of-Truth browser. Ported and wired
   to the API: tree+coverage from GET /docs, file bodies from GET/PUT
   /docs/*path (server-persisted, replacing the prototype's localStorage). */
import React from "react";
import { Card, StatusPill, Badge, Button, ProgressBar, Icon, StateBlock, MarkdownView, DocDownload } from "../ds";
import { api } from "../api/client";
import { usePersistedState, scoped, isStr } from "../ui-state";

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

function DocTreeCat({ node, selected, onSelect, depth = 0 }:
  { node: TreeNode; selected: string; onSelect: (k: string) => void; depth?: number }) {
  const [open, setOpen] = React.useState(false);
  const scored = node.cat?.scored ?? true;
  const linked = node.cat?.linked ?? true;
  return (
    <div style={depth === 0 ? { borderBottom: "1px solid var(--border-hair)" } : undefined}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "9px 6px", paddingLeft: 6 + depth * 12,
        border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--text-subtle)" />
        <Icon name="folder" size={15} color={!scored ? "var(--text-subtle)" : linked ? "var(--brass-500)" : "var(--clay-500)"} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", fontWeight: 500 }}>{node.label}/</span>
        <span style={{ flex: 1 }} />
        {node.cat && scored && (node.cat.linked
          ? <Icon name="link" size={13} color="var(--leaf-600)" />
          : <Icon name="unlink" size={13} color="var(--clay-500)" />)}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingBottom: 4 }}>
          {node.kids.map((k) => <DocTreeCat key={k.path} node={k} selected={selected} onSelect={onSelect} depth={depth + 1} />)}
          {node.cat?.files.map((f) => {
            const key = node.path + "/" + f;
            const on = key === selected;
            return (
              <button key={f} onClick={() => onSelect(key)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "6px 8px", paddingLeft: 18 + depth * 12,
                borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left",
                background: on ? "var(--brass-100)" : "transparent",
              }}>
                <Icon name="file-text" size={13} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12,
                  color: on ? "var(--brass-700)" : (!scored || linked ? "var(--text-body)" : "var(--text-muted)"),
                  fontWeight: on ? 600 : 400 }}>{f}</span>
              </button>
            );
          })}
        </div>
      )}
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
  const [draft, setDraft] = React.useState("");
  const [scanning, setScanning] = React.useState(false);
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

  const nested = React.useMemo(() => buildTree(tree.filter((c) => c.scored)), [tree]);
  const unscored = React.useMemo(() => buildTree(tree.filter((c) => !c.scored)), [tree]);
  const current = cache[selected] ?? "";
  // `selected` is the full repo-relative path (cat + "/" + basename); category is
  // everything before the last slash.
  const cat = selected.includes("/") ? selected.slice(0, selected.lastIndexOf("/")) : ".";
  const node = tree.find((n) => n.cat === cat);
  const displayPath = selected;

  const covTone = docStatus === "broken" ? "err" : docStatus === "drift" ? "warn" : "ok";
  const status = docStatus === "broken" ? "broken" : docStatus === "drift" ? "drift" : "ok";

  function startEdit() { setDraft(current); setMode("edit"); }
  function cancelEdit() { setMode("preview"); }
  async function save() {
    await api.putDoc(projectId, selected, draft);
    setCache((c) => ({ ...c, [selected]: draft }));
    setMode("preview");
  }
  function selectFile(k: string) { setSelected(k); setMode("preview"); }

  async function reloadIndex() {
    const ix = await api.getDocs(projectId);
    const t = ix.tree as DocCat[];
    setTree(t); setCoverage(ix.coverage);
    // Cocokkan SELURUH file kategori, bukan cuma files[0] — versi lama memilih ulang
    // tiap kali file kedua sebuah kategori sedang dibuka.
    if (!t.some((n) => n.files.some((f) => `${n.cat}/${f}` === selected))) setSelected(firstDoc(t));
  }
  // GET /docs sudah realtime; tombolnya cuma memuat ulang, kalau-kalau file berubah
  // dari luar dashboard. Tak ada lagi POST /scan (SPEC-141).
  async function rescan() {
    if (scanning) return;
    setScanning(true);
    try { await reloadIndex(); } finally { setScanning(false); }
  }
  async function removeDoc() {
    if (!selected || !window.confirm(`Hapus ${selected}? File aslinya di disk akan dihapus.`)) return;
    await api.deleteDoc(projectId, selected);
    setCache((c) => { const n = { ...c }; delete n[selected]; return n; });
    await reloadIndex();
  }

  return (
    // SPEC-363 · tinggi pane diturunkan dari viewport lewat rantai flex Shell, bukan angka
    // tetap. Dulu `maxHeight: 620`: MELEBIHI `<main>` di layar 13" (dua scrollbar) dan cuma
    // memakai 57% tinggi di monitor 1329 px (terukur).
    // `flex-basis` WAJIB `0`, bukan `auto`: pembungkus `<main>` memakai `min-height: 100%`
    // (bukan `height`, SPEK-351), jadi item ber-basis-auto memakai tinggi ISI-nya dan justru
    // menumbuhkan halaman — terukur pane 6000 px + halaman ikut menggulir. Basis 0 membuat
    // tinggi container pasti lebih dulu, lalu item mengisi sisanya.
    <div style={{ display: "grid", gridTemplateColumns: "288px 1fr", gap: 20, alignItems: "stretch",
      flex: "1 1 0", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
        <Card padding={0}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow">docs · {projectName}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusPill status={status} size="sm" />
              <Button size="sm" variant="ghost" leftIcon={scanning ? "loader" : "radar"} onClick={rescan} disabled={scanning}>
                {scanning ? "…" : "Muat ulang"}
              </Button>
            </div>
          </div>
          <div style={{ padding: "4px 8px" }}>
            {ixStatus === "loading" ? <StateBlock kind="loading" compact title="Memuat index…" />
              : ixStatus === "error" ? <StateBlock kind="error" compact title="Gagal memuat index docs"
                  hint={projectName} action={() => setIxTry((n) => n + 1)} />
              : tree.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Belum ada docs"
                  hint="Belum ada Markdown di repo ini."
                  action={rescan} actionLabel="Muat ulang" actionIcon="radar" />
              : (<>
                  {nested.map((n) => <DocTreeCat key={n.path} node={n} selected={selected} onSelect={selectFile} />)}
                  {unscored.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-hair)" }}>
                      <div className="hn-eyebrow" style={{ padding: "4px 6px", color: "var(--text-subtle)" }}>Lainnya (tidak dinilai)</div>
                      {unscored.map((n) => <DocTreeCat key={n.path} node={n} selected={selected} onSelect={selectFile} />)}
                    </div>
                  )}
                </>)}
          </div>
        </Card>
        <Card padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span className="hn-eyebrow">SoT coverage</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{projectName}</span>
          </div>
          <ProgressBar value={coverage} showLabel label="Kategori ter-index" tone={covTone} />
        </Card>
      </div>

      {/* SPEC-393 · `fill`, BUKAN `style`: `Card` menyisipkan satu pembungkus <div> di sekitar
          `children` yang `display: block` kecuali `fill` dipasang. Rantai flex lewat `style`
          hanya mengenai div terluar, jadi pembungkus itu memutusnya — pane tumbuh setinggi isi
          lalu terpotong `overflow: hidden` milik kartu, tanpa scroller mana pun. */}
      <Card padding={0} fill>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{displayPath}</span>
          {node && node.scored && (node.linked
            ? <Badge tone="ok" size="sm" icon="link">indexed</Badge>
            : <Badge tone="err" size="sm" icon="unlink">unlinked</Badge>)}
          <span style={{ flex: 1 }} />
          {mode === "preview" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* SPEC-361 · unduh dokumen SoT; hanya di mode preview (isi tersimpan, bukan draft) */}
              <DocDownload href={(f) => api.docDownloadUrl(projectId, selected, f)}
                disabled={!selected || docLoading || docFailed} />
              <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={removeDoc} disabled={!selected}>Hapus</Button>
              <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                disabled={!selected || docLoading || docFailed}>Edit</Button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>Batal</Button>
              <Button size="sm" leftIcon="check" onClick={save}>Simpan</Button>
            </div>
          )}
        </div>

        {mode === "preview" ? (
          <div data-testid="doc-preview-scroll" style={{ padding: "8px 30px 34px", flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
            {!selected ? <StateBlock kind="empty" icon="file-text" title="Tidak ada dokumen dipilih"
                hint="Pilih file dari pohon docs di kiri." />
              : docLoading ? <StateBlock kind="loading" title="Memuat dokumen…" hint={selected} />
              : docFailed ? <StateBlock kind="error" title="Gagal memuat dokumen" hint={selected} action={retryDoc} />
              : <MarkdownView text={current} name={selected} />}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: "1 1 auto", minHeight: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-hair)", minHeight: 0 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
                <span className="hn-eyebrow">Markdown</span>
              </div>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
                placeholder={"# Judul dokumen\n\nParagraf pembuka…"} style={{
                flex: 1, width: "100%", boxSizing: "border-box", resize: "none", border: "none", outline: "none",
                padding: "16px 18px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7,
                color: "var(--text-body)", background: "var(--surface-card)",
              }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
                <span className="hn-eyebrow">Preview langsung</span>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "4px 24px 24px" }}>
                <MarkdownView text={draft} name={selected} />
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
