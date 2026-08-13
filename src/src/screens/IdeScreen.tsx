/* IdeScreen — IDE Visual (SPEC-182): Explorer (pohon file + editor highlight) & Git Graph,
   satu toolbar (project + branch switcher). SPEC-234: section Staged/Changed + diff pane. */
import React from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { Card, Button, Select, Icon, StateBlock, Tabs, Badge, DocDownload, DocPreviewModal, isMarkdownPath } from "../ds";
import { api, ApiError, type RepoFile, type ReviewFile, type WorkingStatus, type GitOp, type Remote } from "../api/client";
import type { ProjectVM } from "./types";
import { GitGraph } from "./GitGraph";
import { BranchesPanel } from "./BranchesPanel";
import { buildFileTree, TreeRow, ChangedSection } from "./file-tree";
import { DiffView } from "./diff-view";
import { MarkdownView } from "../ds/markdown";
import { usePersistedState, scoped, isStr, oneOf } from "../ui-state";

const langOf = (p: string): string => {
  const ext = p.slice(p.lastIndexOf(".") + 1);
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "xml", sh: "bash", py: "python", yml: "yaml", yaml: "yaml", sql: "sql" };
  return map[ext] ?? "";
};

// SPEC-240 · berkas markdown mendapat toggle Preview | Source (default preview).
// SPEC-385 · predikatnya pindah ke `ds/markdown.tsx` (`isMarkdownPath`) karena kini dipakai
// bersama Git Graph & Review.

// Dialog "Paksa": muncul saat mutasi git balas 409. Mengulang op dengan force:true.
function ForceDialog({ msg, onForce, onCancel }: { msg: string; onForce: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,.35)",
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Card padding={20} style={{ maxWidth: 460 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text-strong)" }}>Operasi ditolak</div>
        <pre style={{ fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "pre-wrap",
          color: "var(--text-muted)", marginBottom: 12 }}>{msg}</pre>
        <div style={{ fontSize: 12.5, color: "var(--clay-600)", marginBottom: 14 }}>
          Paksa bisa membuang perubahan tak ter-commit &amp; mengganggu sesi Claude yang jalan.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
          <Button size="sm" leftIcon="alert-triangle" onClick={onForce}>Paksa</Button>
        </div>
      </Card>
    </div>
  );
}

// SPEC-233 · kelola remote (list/add/hapus) — modal ringkas dari toolbar IDE.
function RemotesModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [remotes, setRemotes] = React.useState<Remote[]>([]);
  const [name, setName] = React.useState(""); const [url, setUrl] = React.useState("");
  const reload = React.useCallback(() => { api.ideRemotes(projectId).then(setRemotes).catch(() => setRemotes([])); }, [projectId]);
  React.useEffect(() => { reload(); }, [reload]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Card padding={20} onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ width: "min(560px, 92vw)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="hn-eyebrow">remotes</span>
          <Button size="sm" variant="ghost" leftIcon="x" onClick={onClose}>Tutup</Button>
        </div>
        {remotes.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-subtle)", marginBottom: 10 }}>Belum ada remote.</div>}
        {remotes.map((r) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border-hair)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, width: 90 }}>{r.name}</span>
            <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.fetch}</span>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => api.ideDeleteRemote(projectId, r.name).then(setRemotes).catch(() => {})} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="origin" style={{ width: 100, padding: "5px 8px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", fontSize: 12.5 }} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/repo.git" style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", fontSize: 12.5 }} />
          <Button size="sm" leftIcon="plus" disabled={!name || !url}
            onClick={() => api.ideAddRemote(projectId, name, url).then((rs) => { setRemotes(rs); setName(""); setUrl(""); }).catch(() => {})}>Tambah</Button>
        </div>
      </Card>
    </div>
  );
}

export function IdeScreen({ projects, projectId, onProject, onToast, onGotoTerminal }:
  { projects: ProjectVM[]; projectId: string; onProject: (id: string) => void;
    onToast?: (msg: string, tone: "ok" | "warn" | "err" | "info", icon?: string) => void;
    onGotoTerminal?: (sessionId?: string) => void }) {
  // SPEC-740 · ADR-0115 · seluruh state tampilan IDE ber-scope project: tab, ref yang
  // dilihat, berkas terpilih, dan mode tiap pane. `mode`/`draft` sengaja TIDAK persisten —
  // draft editor bukan parameter tampilan, dan memulihkan mode edit tanpa draft-nya menyesatkan.
  const ui = scoped("ide", projectId);
  const [tab, setTab] = usePersistedState(ui, "tab", "explorer", isStr);
  const [viewRef, setViewRef] = usePersistedState(ui, "viewRef", "", isStr);   // kosong = working tree
  const [branches, setBranches] = React.useState<{ branches: string[]; remotes: string[] }>({ branches: [], remotes: [] });
  const [files, setFiles] = React.useState<string[]>([]);
  const [treeState, setTreeState] = React.useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = usePersistedState(ui, "selected", "", isStr);
  const [selKind, setSelKind] = usePersistedState<"file" | "staged" | "unstaged">(
    ui, "selKind", "file", oneOf("file", "staged", "unstaged"));   // sumber seleksi → viewer vs diff
  const [file, setFile] = React.useState<RepoFile | null>(null);
  const [mode, setMode] = React.useState<"view" | "edit">("view");
  const [draft, setDraft] = React.useState("");
  const [mdView, setMdView] = usePersistedState<"preview" | "source">(
    ui, "mdView", "preview", oneOf("preview", "source"));   // SPEC-240 · .md preview vs source
  const [pendingForce, setPendingForce] = React.useState<{ op: GitOp; msg: string } | null>(null);
  // SPEC-234 · status working tree (staged/unstaged) + diff file terpilih.
  const [status, setStatus] = React.useState<WorkingStatus | null>(null);
  const [stagedView, setStagedView] = usePersistedState<"list" | "tree">(ui, "stagedView", "list", oneOf("list", "tree"));
  const [changedView, setChangedView] = usePersistedState<"list" | "tree">(ui, "changedView", "list", oneOf("list", "tree"));
  const [diff, setDiff] = React.useState<ReviewFile | null>(null);
  const [diffTab, setDiffTab] = usePersistedState<"diff" | "source">(ui, "diffTab", "diff", oneOf("diff", "source"));
  const [showRemotes, setShowRemotes] = React.useState(false); // SPEC-233 · kelola remote
  // SPEC-385 · ruang baca lebar untuk .md — di mode file toggle SPEC-240 tetap ada (preview
  // sempit di samping tree), di mode diff inilah satu-satunya cara membacanya terender.
  const [preview, setPreview] = React.useState(false);

  const reloadTree = React.useCallback(() => {
    setTreeState("loading");
    api.ideTree(projectId, viewRef).then((t) => { setFiles(t.files); setTreeState("ready"); })
      .catch(() => setTreeState("error"));
  }, [projectId, viewRef]);
  // Status working tree independen dari ref yang dilihat (staged/unstaged inheren milik working tree).
  const reloadStatus = React.useCallback(() => {
    api.ideWorkingStatus(projectId).then(setStatus).catch(() => setStatus(null));
  }, [projectId]);

  React.useEffect(() => { reloadTree(); }, [reloadTree]);
  React.useEffect(() => { reloadStatus(); }, [reloadStatus]);
  React.useEffect(() => { api.listBranches(projectId).then(setBranches).catch(() => {}); }, [projectId]);
  // selKind "file" → isi file (editable, honor viewRef). staged/unstaged → diff read-only.
  React.useEffect(() => {
    if (!selected) { setFile(null); setDiff(null); return; }
    let alive = true;
    setPreview(false); // SPEC-385 · pratinjau selalu mengikuti berkas yang sedang dipilih
    if (selKind === "file") {
      setDiff(null);
      api.ideFile(projectId, selected, viewRef).then((f) => { if (alive) { setFile(f); setMode("view"); setMdView("preview"); } })
        .catch(() => { if (alive) setFile(null); });
    } else {
      setFile(null); setDiffTab("diff");
      api.ideFileDiff(projectId, selected, selKind === "staged").then((d) => { if (alive) setDiff(d); })
        .catch(() => { if (alive) setDiff(null); });
    }
    return () => { alive = false; };
  }, [selected, selKind, projectId, viewRef]);

  const selectFile = (p: string) => { setSelKind("file"); setSelected(p); };
  const selectStaged = (p: string) => { setSelKind("staged"); setSelected(p); };
  const selectChanged = (p: string) => { setSelKind("unstaged"); setSelected(p); };

  // Semua ref: local + origin (prefix "origin/") untuk dilihat/checkout.
  const refOptions = [
    { value: "", label: "· working tree ·" },
    ...branches.branches.map((b) => ({ value: b, label: b })),
    ...branches.remotes.map((b) => ({ value: `origin/${b}`, label: `origin/${b}` })),
  ];

  async function runGit(op: GitOp) {
    try {
      const r = await api.ideGit(projectId, op);
      setViewRef(""); reloadTree(); reloadStatus();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setPendingForce({ op, msg: e.message });
      throw e;
    }
  }
  async function checkout() { if (viewRef) await runGit({ op: "checkout", ref: viewRef }).catch(() => {}); }
  // SPEC-229 · merge via git graph: konflik → pindah Terminal (sesi claude), bersih → toast + reload.
  async function mergeGraph(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    try {
      const r = await api.ideGitMerge(projectId, { source, ...opts });
      if (r.status === "conflict") { onGotoTerminal?.(r.sessionId); onToast?.("konflik merge — selesaikan di Terminal", "warn", "git-merge"); }
      else { setViewRef(""); reloadTree(); reloadStatus(); onToast?.(`merge berhasil · ${r.detail}`, "ok", "git-merge"); }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.("gagal merge" + (code === 409 ? " · cek branch/target" : ""), "err", "x-circle");
      throw e;
    }
  }
  // SPEC-233 · rebase/pull/drop via git graph: pola mergeGraph — konflik → Terminal, bersih → toast+reload.
  async function graphIsolated(kind: "rebase" | "pull" | "drop", arg: string) {
    try {
      const r = kind === "rebase" ? await api.ideGitRebase(projectId, arg)
        : kind === "pull" ? await api.ideGitPull(projectId, { source: arg })
        : await api.ideGitDrop(projectId, arg);
      if (r.status === "conflict") { onGotoTerminal?.(r.sessionId); onToast?.(`konflik ${kind} — selesaikan di Terminal`, "warn", "git-merge"); }
      else { setViewRef(""); reloadTree(); onToast?.(`${kind} berhasil · ${r.detail}`, "ok", "git-branch"); }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.(`gagal ${kind}` + (code === 409 ? " · cek working tree/branch" : ""), "err", "x-circle");
      throw e;
    }
  }
  async function confirmForce() {
    if (!pendingForce) return;
    const op = { ...pendingForce.op, force: true } as GitOp;
    setPendingForce(null);
    await api.ideGit(projectId, op).then(() => { setViewRef(""); reloadTree(); reloadStatus(); }).catch(() => {});
  }

  function startEdit() { setDraft(file?.content ?? ""); setMode("edit"); }
  async function save() {
    await api.putIdeFile(projectId, selected, draft);
    setFile((f) => (f ? { ...f, content: draft } : f)); setMode("view");
    reloadStatus(); // menyimpan file mengubah status working tree
  }

  const highlighted = React.useMemo(() => {
    if (!file || file.content === null) return "";
    const lang = langOf(selected);
    try { return lang ? hljs.highlight(file.content, { language: lang }).value : hljs.highlightAuto(file.content).value; }
    catch { return file.content; }
  }, [file, selected]);

  // SPEC-385 · sumber pratinjau mengikuti pane yang aktif: mode file = isi berkas di ref yang
  // dilihat, mode diff = isi SESUDAH perubahan (bukan diff-nya). Unduhannya menunjuk endpoint
  // yang sama dengan isinya, jadi yang diunduh persis yang dibaca.
  const previewSrc = ((): { text: string; download: (f: "md" | "pdf") => string } | null => {
    const isDiff = selKind !== "file";
    const rf = isDiff ? diff : file;
    if (!rf || rf.binary || rf.content === null || !isMarkdownPath(selected)) return null;
    return {
      text: rf.content,
      download: isDiff
        ? (f: "md" | "pdf") => api.ideFileDiffDownloadUrl(projectId, selected, selKind === "staged", f)
        : (f: "md" | "pdf") => api.ideFileDownloadUrl(projectId, selected, viewRef, f),
    };
  })();

  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <Select size="sm" value={projectId} onChange={(e) => onProject(e.target.value)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      <Select size="sm" value={viewRef} onChange={(e) => setViewRef(e.target.value)} options={refOptions} />
      <Button size="sm" variant="secondary" leftIcon="git-branch" onClick={checkout} disabled={!viewRef}>Checkout</Button>
      {/* SPEC-233 · fetch --all --prune; ref-only → tak digerbang sesi */}
      <Button size="sm" variant="ghost" leftIcon="download-cloud" onClick={() => { void runGit({ op: "fetch", prune: true }).then(() => api.listBranches(projectId).then(setBranches)).catch(() => {}); }}>Fetch</Button>
      <Button size="sm" variant="ghost" leftIcon="git-branch" onClick={() => setShowRemotes(true)}>Remotes</Button>
    </div>
  );

  const inDiff = selKind !== "file"; // pane kanan mode diff (dari Staged/Changed)

  return (
    // SPEC-363 · hanya tab Explorer yang ikut rantai flex (dua pane-nya menggulir sendiri);
    // Git Graph & Branches tetap tumbuh mengikuti isi seperti sebelumnya — graph bergantung
    // pada `<main>` yang menggulir untuk auto-load `IntersectionObserver` (SPEC-351).
    <div style={{ display: "flex", flexDirection: "column", gap: 16,
      ...(tab === "explorer" ? { flex: "1 1 0", minHeight: 0 } : null) }}>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Tabs tabs={[{ value: "explorer", label: "Explorer" }, { value: "graph", label: "Git Graph" },
          { value: "branches", label: "Branches" }]} value={tab} onChange={setTab} />
        {toolbar}
      </div>

      {tab === "explorer" ? (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "stretch",
          flex: "1 1 auto", minHeight: 0 }}>
          {/* SPEC-393 · `fill`, BUKAN `style`: `Card` menyisipkan satu pembungkus <div> di sekitar
              `children` yang `display: block` kecuali `fill` dipasang. Rantai flex lewat `style`
              hanya mengenai div terluar, jadi pembungkus itu memutusnya — pane tumbuh setinggi isi
              lalu terpotong `overflow: hidden` milik kartu, tanpa scroller mana pun. */}
          <Card padding={0} fill>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-hair)" }}>
              <span className="hn-eyebrow" style={{ flex: 1 }}>changes{status?.branch ? ` · ${status.branch}` : ""}</span>
              <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={() => { reloadTree(); reloadStatus(); }}>Muat ulang</Button>
            </div>
            <div data-testid="ide-tree-scroll" style={{ padding: 8, flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
              <ChangedSection label="Staged" changed={status?.staged ?? []}
                selected={selKind === "staged" ? selected : ""} onSelect={selectStaged}
                view={stagedView} onView={setStagedView} emptyText="Tak ada file staged." />
              <div style={{ borderTop: "1px solid var(--border-hair)", margin: "6px 0" }} />
              <ChangedSection label="Changed" changed={status?.unstaged ?? []}
                selected={selKind === "unstaged" ? selected : ""} onSelect={selectChanged}
                view={changedView} onView={setChangedView} emptyText="Tak ada file berubah." />
              <div className="hn-eyebrow" style={{ padding: "6px 8px", marginTop: 8, borderTop: "1px solid var(--border-hair)" }}>
                Files · {viewRef || "working tree"}
              </div>
              {treeState === "loading" ? <StateBlock kind="loading" compact title="Memuat file…" />
                : treeState === "error" ? <StateBlock kind="error" compact title="Gagal memuat file" action={reloadTree} />
                : files.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Tak ada file" />
                : buildFileTree(files).map((n) => (
                    <TreeRow key={n.path} node={n} selected={selKind === "file" ? selected : ""} onSelect={selectFile} />
                  ))}
            </div>
          </Card>
          <Card padding={0} fill>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
              <Icon name="file-text" size={15} color="var(--text-muted)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-strong)" }}>{selected || "—"}</span>
              {!inDiff && file?.truncated && <Badge tone="warn" size="sm">terpotong</Badge>}
              {inDiff && diff?.status && <Badge tone={diff.status === "D" ? "err" : diff.status === "A" ? "ok" : "brass"} size="sm">{diff.status}</Badge>}
              <span style={{ flex: 1 }} />
              {inDiff
                ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* SPEC-385 · pane diff dulu hanya bisa membaca .md sebagai <pre> mentah */}
                    {previewSrc && (
                      <Button size="sm" variant="secondary" leftIcon="book-open"
                        onClick={() => setPreview(true)}>Preview lebar</Button>
                    )}
                    <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
                      {(["diff", "source"] as const).map((t) => (
                        <button key={t} onClick={() => setDiffTab(t)} style={{
                          padding: "4px 12px", border: "none", cursor: "pointer", borderRadius: "var(--radius-pill)",
                          fontSize: 12, textTransform: "capitalize",
                          background: diffTab === t ? "var(--surface-card)" : "transparent",
                          color: diffTab === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: diffTab === t ? 600 : 400,
                        }}>{t}</button>
                      ))}
                    </div>
                  </div>
                : mode === "view"
                  ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* SPEC-240 · toggle Preview | Source hanya untuk .md */}
                      {file && !file.binary && isMarkdownPath(selected) && (
                        <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
                          {(["preview", "source"] as const).map((t) => (
                            <button key={t} onClick={() => setMdView(t)} style={{
                              padding: "4px 12px", border: "none", cursor: "pointer", borderRadius: "var(--radius-pill)",
                              fontSize: 12,
                              background: mdView === t ? "var(--surface-card)" : "transparent",
                              color: mdView === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: mdView === t ? 600 : 400,
                            }}>{t === "preview" ? "Preview" : "Source"}</button>
                          ))}
                        </div>
                      )}
                      {/* SPEC-385 · toggle di atas hanya memakai sisa lebar di samping tree;
                          tombol ini membuka dokumen yang sama di ruang baca lebar */}
                      {previewSrc && (
                        <Button size="sm" variant="secondary" leftIcon="book-open"
                          onClick={() => setPreview(true)}>Preview lebar</Button>
                      )}
                      {/* SPEC-361 · unduh berkas teks yang sedang dibuka (biner tak ditawari) */}
                      <DocDownload href={(f) => api.ideFileDownloadUrl(projectId, selected, viewRef, f)}
                        disabled={!file || file.binary} />
                      <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                        disabled={!file || file.binary}>Edit</Button>
                    </div>
                  : <div style={{ display: "flex", gap: 8 }}>
                      <Button size="sm" variant="ghost" onClick={() => setMode("view")}>Batal</Button>
                      <Button size="sm" leftIcon="check" onClick={save}>Simpan</Button>
                    </div>}
            </div>
            <div data-testid="doc-preview-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
              {inDiff
                ? (!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari Staged/Changed" />
                    : diff === null ? <StateBlock kind="loading" title="Memuat…" hint={selected} />
                    : diff.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint={selected} />
                    : diffTab === "diff" ? <div style={{ padding: "10px 0" }}><DiffView diff={diff.diff ?? ""} />
                        {diff.truncated && <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-subtle)" }}>… dipotong pada 256 KB.</div>}</div>
                    : diff.content === null ? <StateBlock kind="empty" icon="trash-2" title="File dihapus" hint="Tak ada isi untuk ditampilkan." />
                    : <pre style={{ margin: 0, padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                        lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)" }}>{diff.content}</pre>)
                : (!selected ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari pohon di kiri" />
                    : file === null ? <StateBlock kind="loading" title="Memuat…" hint={selected} />
                    : file.binary ? <StateBlock kind="empty" icon="file" title="File biner" hint={selected} />
                    : mode === "edit"
                      /* placeholder-exempt: isi berkas apa pun bahasanya — tak ada satu contoh yang benar lintas .ts/.json/.sh */
                      ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} style={{
                          width: "100%", minHeight: 560, boxSizing: "border-box", resize: "vertical", border: "none",
                          outline: "none", padding: "16px 18px", fontFamily: "var(--font-mono)", fontSize: 12.5,
                          lineHeight: 1.7, color: "var(--text-body)", background: "var(--surface-card)" }} />
                      : isMarkdownPath(selected) && mdView === "preview"
                        ? <div style={{ padding: "16px 20px" }}><MarkdownView text={file.content ?? ""} name={selected} /></div>
                        : <pre style={{ margin: 0, padding: "16px 18px", overflow: "auto" }}>
                            <code className="hljs" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}
                              dangerouslySetInnerHTML={{ __html: highlighted }} />
                          </pre>)}
            </div>
          </Card>
        </div>
      ) : tab === "graph" ? (
        <GitGraph projectId={projectId} onRunGit={runGit} onMerge={mergeGraph}
          onRebase={(onto) => graphIsolated("rebase", onto)} onPull={(src) => graphIsolated("pull", src)} onDrop={(sha) => graphIsolated("drop", sha)}
          onOpenFile={(p, ref) => { setViewRef(ref); selectFile(p); setTab("explorer"); }} />
      ) : (
        /* SPEC-360 · ADR-0077 · bersihkan branch yang sudah ter-merge ke branch utamanya. */
        <BranchesPanel projectId={projectId} />
      )}

      {preview && previewSrc && (
        <DocPreviewModal path={selected} text={previewSrc.text} eyebrow={viewRef || status?.branch || projectId}
          download={previewSrc.download} onClose={() => setPreview(false)} />
      )}
      {pendingForce && <ForceDialog msg={pendingForce.msg} onForce={confirmForce} onCancel={() => setPendingForce(null)} />}
      {showRemotes && <RemotesModal projectId={projectId} onClose={() => setShowRemotes(false)} />}
    </div>
  );
}
