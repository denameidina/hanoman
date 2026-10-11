/* DocsWorkspace — interactive Source-of-Truth browser. Ported and wired
   to the API: tree+coverage from GET /docs, file bodies from GET/PUT
   /docs/*path (server-persisted, replacing the prototype's localStorage).
   Audit UI/UX 2026-10 (P0): draft kotor ditandai & dijaga (konfirmasi saat pindah berkas/Batal),
   simpan dengan try/catch + busy + galat inline, Ctrl/Cmd+S, pohon terbuka sampai berkas terpilih,
   filter berkas, dan label bahasa Indonesia. */
import React from "react";
import { Card, StatusPill, Badge, Button, ProgressBar, Icon, StateBlock, MarkdownView, DocDownload, ResponsivePanels, Input, useConfirm } from "../ds";
import { api } from "../api/client";
import { usePersistedState, scoped, isStr } from "../ui-state";
import { failureMessage } from "../lib/report-error";

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

/** Kunci berkas (`cat/file`) di bawah node ini — dipakai untuk membuka folder yang memuat pilihan. */
const containsSelected = (node: TreeNode, selected: string) => !!selected && selected.startsWith(node.path + "/");

function DocTreeCat({ node, selected, onSelect, depth = 0 }:
  { node: TreeNode; selected: string; onSelect: (k: string) => void; depth?: number }) {
  // Folder yang memuat berkas terpilih terbuka dari awal dan saat pilihan berpindah ke dalamnya.
  const inside = containsSelected(node, selected);
  const [open, setOpen] = React.useState(inside);
  React.useEffect(() => { if (inside) setOpen(true); }, [inside]);
  const scored = node.cat?.scored ?? true;
  const linked = node.cat?.linked ?? true;
  return (
    <div style={depth === 0 ? { borderBottom: "1px solid var(--border-hair)" } : undefined}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{
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
              <button type="button" key={f} onClick={() => onSelect(key)} aria-current={on ? "true" : undefined} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "6px 8px", paddingLeft: 18 + depth * 12, minHeight: 32,
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
  const [panel, setPanel] = React.useState<"tree" | "viewer">("tree");
  const [draft, setDraft] = React.useState("");
  const [scanning, setScanning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Galat simpan/hapus tampil inline di atas isi dokumen; draft tetap utuh saat gagal.
  const [actionErr, setActionErr] = React.useState("");
  const [query, setQuery] = React.useState("");
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
      setActionErr(""); setQuery("");
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
  // Draft kotor = mode edit dengan isi yang berbeda dari yang tersimpan.
  const dirty = mode === "edit" && draft !== current;

  // Filter berkas: daftar datar semua berkas, dicocokkan terhadap path lengkapnya.
  const allFiles = React.useMemo(() => tree.flatMap((c) => c.files.map((f) => ({
    key: `${c.cat}/${f}`, scored: c.scored, linked: c.linked,
  }))), [tree]);
  const needle = query.trim().toLowerCase();
  const matches = needle ? allFiles.filter((f) => f.key.toLowerCase().includes(needle)) : [];

  const covTone = docStatus === "broken" ? "err" : docStatus === "drift" ? "warn" : "ok";
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
    // Cocokkan SELURUH file kategori, bukan cuma files[0] — versi lama memilih ulang
    // tiap kali file kedua sebuah kategori sedang dibuka.
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

  return (
    // SPEC-363 · tinggi pane diturunkan dari viewport lewat rantai flex Shell, bukan angka
    // tetap. Dulu `maxHeight: 620`: MELEBIHI `<main>` di layar 13" (dua scrollbar) dan cuma
    // memakai 57% tinggi di monitor 1329 px (terukur).
    // `flex-basis` WAJIB `0`, bukan `auto`: pembungkus `<main>` memakai `min-height: 100%`
    // (bukan `height`, SPEK-351), jadi item ber-basis-auto memakai tinggi ISI-nya dan justru
    // menumbuhkan halaman — terukur pane 6000 px + halaman ikut menggulir. Basis 0 membuat
    // tinggi container pasti lebih dulu, lalu item mengisi sisanya.
    <>
    <ResponsivePanels
      ariaLabel="Panel Dokumen"
      active={panel}
      onActiveChange={(next) => setPanel(next as "tree" | "viewer")}
      masterWidth={288}
      className="hn-workspace-panels"
      panels={[
        { id: "tree", label: "Berkas", className: "hn-panel-flex", content: (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
        <Card padding={0}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow">dokumen · {projectName}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusPill status={status} size="sm" />
              <Button size="sm" variant="ghost" leftIcon={scanning ? "loader" : "radar"} onClick={rescan} disabled={scanning}>
                {scanning ? "Memuat…" : "Muat ulang"}
              </Button>
            </div>
          </div>
          {ixStatus === "ready" && tree.length > 0 && (
            <div style={{ padding: "8px 14px 0" }}>
              <Input size="sm" aria-label="Cari berkas dokumen" leftIcon="search" value={query}
                placeholder="mis. product/prd" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                style={{ width: "100%" }} />
            </div>
          )}
          <div style={{ padding: "4px 8px" }}>
            {ixStatus === "loading" ? <StateBlock kind="loading" compact title="Memuat indeks…" />
              : ixStatus === "error" ? <StateBlock kind="error" compact title="Gagal memuat indeks dokumen"
                  hint={projectName} action={() => setIxTry((n) => n + 1)} />
              : tree.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Belum ada dokumen"
                  hint="Belum ada Markdown di repo ini."
                  action={rescan} actionLabel="Muat ulang" actionIcon="radar" />
              : needle ? (
                  matches.length === 0
                    ? <StateBlock kind="empty" compact icon="search" title="Tak ada berkas cocok" hint={`Tak ada yang cocok dengan “${query.trim()}”.`} />
                    : <div role="list" aria-label="Hasil pencarian berkas">
                        {matches.map((m) => (
                          <button type="button" key={m.key} aria-current={m.key === selected ? "true" : undefined}
                            onClick={() => selectFile(m.key)} style={{
                              display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 32,
                              padding: "6px 8px", borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", textAlign: "left",
                              background: m.key === selected ? "var(--brass-100)" : "transparent" }}>
                            <Icon name="file-text" size={13} color="var(--text-subtle)" />
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-body)" }}>{m.key}</span>
                          </button>
                        ))}
                      </div>
                )
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
            <span className="hn-eyebrow">Cakupan SoT</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{projectName}</span>
          </div>
          <ProgressBar value={coverage} showLabel label="Kategori terindeks" tone={covTone} />
        </Card>
      </div>
        ) },

        { id: "viewer", label: "Dokumen", className: "hn-panel-flex", content: (
      /* SPEC-393 · `fill` menyambungkan rantai flex melewati pembungkus internal Card, sehingga
         viewer memakai scroller lokal dan tidak menumbuhkan halaman. */
      <Card padding={0} fill>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
          <Icon name="file-text" size={15} color="var(--text-muted)" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>{displayPath}</span>
          {node && node.scored && (node.linked
            ? <Badge tone="ok" size="sm" icon="link">terindeks</Badge>
            : <Badge tone="err" size="sm" icon="unlink">tak tertaut</Badge>)}
          {dirty && <Badge tone="warn" size="sm">belum disimpan</Badge>}
          <span style={{ flex: 1 }} />
          {mode === "preview" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* SPEC-361 · unduh dokumen SoT; hanya di mode preview (isi tersimpan, bukan draft) */}
              <DocDownload href={(f) => api.docDownloadUrl(projectId, selected, f)}
                disabled={!selected || docLoading || docFailed} />
              <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                disabled={!selected || docLoading || docFailed}>Edit</Button>
              {/* Hapus dipisah dari Edit: bukan aksi biasa, dan tombolnya merah. */}
              <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "var(--border-hair)" }} />
              <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={removeDoc} disabled={!selected}>Hapus</Button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>Batal</Button>
              <Button size="sm" leftIcon="check" onClick={() => void save()} loading={saving} disabled={saving}>Simpan</Button>
            </div>
          )}
        </div>
        {actionErr && (
          <div role="alert" style={{ flex: "0 0 auto", padding: "8px 16px", fontSize: 12.5, color: "var(--clay-600)",
            borderBottom: "1px solid var(--border-hair)" }}>{actionErr}</div>
        )}

        {mode === "preview" ? (
          <div data-testid="doc-preview-scroll" style={{ padding: "8px 30px 34px", flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
            {!selected ? <StateBlock kind="empty" icon="file-text" title="Tidak ada dokumen dipilih"
                hint="Pilih file dari pohon dokumen di kiri." />
              : docLoading ? <StateBlock kind="loading" title="Memuat dokumen…" hint={selected} />
              : docFailed ? <StateBlock kind="error" title="Gagal memuat dokumen" hint={selected} action={retryDoc} />
              : <MarkdownView text={current} name={selected} />}
          </div>
        ) : (
          <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: "1 1 auto", minHeight: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-hair)", minHeight: 0 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
                <span className="hn-eyebrow">Markdown</span>
              </div>
              <textarea aria-label={`Isi ${displayPath}`} value={draft} spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}
                placeholder={"# Judul dokumen\n\nParagraf pembuka…"} style={{
                flex: 1, width: "100%", boxSizing: "border-box", resize: "none", border: "none",
                padding: "16px 18px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7,
                color: "var(--text-body)", background: "var(--surface-card)",
              }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border-hair)", background: "var(--bone-100)" }}>
                <span className="hn-eyebrow">Pratinjau langsung</span>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "4px 24px 24px" }}>
                <MarkdownView text={draft} name={selected} />
              </div>
            </div>
          </div>
        )}
      </Card>
        ) },
      ]}
    />
    {dialog}
    </>
  );
}
