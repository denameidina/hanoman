/* IdeScreen — IDE (SPEC-182 · Audit UI/UX 2026-10 · Fase 3H "Perubahan dulu").
   Empat tab, tersimpan per project: Perubahan (default: Staged/Changed + diff) · Riwayat (git graph) ·
   Cabang (branch & worktree dalam satu daftar) · Berkas (pohon, isi, editor, CRUD, unggah).
   Toolbar atas ≤6 kontrol. Seleksi tunggal: `selKind` "file" → tab Berkas; staged/unstaged → Perubahan. */
import React from "react";
// ADR-0160 · `highlight.js/lib/core` + bahasa yang memang dipetakan `langOf` di bawah, bukan paket
// utuh: bundel penuh ±190 bahasa terukur 940 KB (312 KB gzip) — lebih besar dari seluruh sisa
// dashboard — hanya untuk mewarnai belasan ekstensi yang pernah dibuka di Explorer.
import hljs from "highlight.js/lib/core";
import langTypescript from "highlight.js/lib/languages/typescript";
import langJavascript from "highlight.js/lib/languages/javascript";
import langJson from "highlight.js/lib/languages/json";
import langMarkdown from "highlight.js/lib/languages/markdown";
import langCss from "highlight.js/lib/languages/css";
import langXml from "highlight.js/lib/languages/xml";
import langBash from "highlight.js/lib/languages/bash";
import langPython from "highlight.js/lib/languages/python";
import langYaml from "highlight.js/lib/languages/yaml";
import langSql from "highlight.js/lib/languages/sql";
import langDiff from "highlight.js/lib/languages/diff";
import "highlight.js/styles/github.css";
for (const [name, def] of Object.entries({
  typescript: langTypescript, javascript: langJavascript, json: langJson, markdown: langMarkdown,
  css: langCss, xml: langXml, bash: langBash, python: langPython, yaml: langYaml, sql: langSql, diff: langDiff,
})) hljs.registerLanguage(name, def);
import { Card, Button, Select, Icon, StateBlock, Tabs, Badge, DocDownload, DocPreviewModal, isMarkdownPath, ResponsivePanels,
  Modal, Input, useConfirm, RowList, DenseRow, Text, OverflowActions, useResponsiveTier } from "../ds";
import { api, ApiError, type RepoFile, type ReviewFile, type WorkingStatus, type GitOp, type Remote, type IdeUploadResult,
  type ChangedFile } from "../api/client";
import type { ProjectVM } from "./types";
import { GitGraph } from "./GitGraph";
import { CabangPanel } from "./CabangPanel";
import { buildFileTree, TreeRow, TreeRoot, type TreeMenu } from "./file-tree";
import { readDroppedEntries } from "./drop-entries";
import { DiffView } from "./diff-view";
import { Menu, type MenuItem } from "./ide-menu";
import { MarkdownView } from "../ds/markdown";
import { usePersistedState, scoped, isStr, isBool, oneOf } from "../ui-state";
import { failureMessage } from "../lib/report-error";
import "./styles/ide.css";

type IdeTab = "perubahan" | "riwayat" | "cabang" | "berkas";
const IDE_TABS: readonly IdeTab[] = ["perubahan", "riwayat", "cabang", "berkas"];
// Jalur lama: nilai tab yang tersimpan sebelum 3H (explorer/graph/branches/worktrees) tetap membuka
// tempat yang sama. Peta, bukan objek: kunci seperti "constructor" tak boleh lolos sebagai tab.
const LEGACY_TAB = new Map<string, IdeTab>([
  ["explorer", "berkas"], ["graph", "riwayat"], ["branches", "cabang"], ["worktrees", "cabang"],
]);
function tabOf(v: string): IdeTab {
  if ((IDE_TABS as readonly string[]).includes(v)) return v as IdeTab;
  return LEGACY_TAB.get(v) ?? "perubahan";
}

const TREE_MIN = 220, TREE_MAX = 560, TREE_DEFAULT = 300;
const isWidth = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clampTree = (n: number) => Math.min(TREE_MAX, Math.max(TREE_MIN, Math.round(n)));
const STATUS_TONE: Record<string, "ok" | "err" | "brass" | "warn"> = { A: "ok", D: "err", M: "brass" };

/** Nama berkas/folder dari path relatif: segmen terakhir. */
const baseName = (p: string) => p.split("/").pop() ?? p;
/** Folder induk dari path relatif; kosong = root. */
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
/** Path `p` setelah `from` diganti nama ke `to`, bila `p` adalah `from` itu sendiri atau berada di bawahnya. */
const remapPath = (p: string, from: string, to: string) =>
  p === from || p.startsWith(from + "/") ? to + p.slice(from.length) : p;

const langOf = (p: string): string => {
  const ext = p.slice(p.lastIndexOf(".") + 1);
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "xml", sh: "bash", py: "python", yml: "yaml", yaml: "yaml", sql: "sql" };
  return map[ext] ?? "";
};

// Dialog "Paksa": muncul saat mutasi git balas 409. Mengulang op dengan force:true.
function ForceDialog({ msg, onForce, onCancel }: { msg: string; onForce: () => void; onCancel: () => void }) {
  return (
    <Modal open title="Operasi ditolak" onClose={onCancel} width={460} footer={<>
      <Button size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
      <Button size="sm" leftIcon="alert-triangle" onClick={onForce}>Paksa</Button>
    </>}>
        <pre className="hn-ide-pre-msg">{msg}</pre>
        <div className="hn-ide-warn-line">
          Paksa bisa membuang perubahan tak ter-commit &amp; mengganggu sesi Claude yang jalan.
        </div>
    </Modal>
  );
}

// SPEC-233 · kelola remote (list/add/hapus) — modal ringkas dari toolbar IDE.
function RemotesModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [remotes, setRemotes] = React.useState<Remote[]>([]);
  const [name, setName] = React.useState(""); const [url, setUrl] = React.useState("");
  // Galat ditampilkan di dalam modal (bukan ditelan): gagal memuat ≠ "Belum ada remote".
  const [err, setErr] = React.useState("");
  const reload = React.useCallback(() => {
    api.ideRemotes(projectId)
      .then((rs) => { setRemotes(rs); setErr(""); })
      .catch((e: unknown) => { setRemotes([]); setErr(failureMessage("memuat remote", e)); });
  }, [projectId]);
  React.useEffect(() => { reload(); }, [reload]);
  return (
    <Modal open title="Remote" onClose={onClose} width={560}>
        {err && <div role="alert" className="hn-ide-warn-line">{err}</div>}
        {remotes.length === 0 && !err && <div className="hn-ide-muted-line">Belum ada remote.</div>}
        {remotes.map((r) => (
          <div key={r.name} className="hn-dense-row hn-ide-remote-row">
            <span className="hn-ide-remote-name">{r.name}</span>
            <span className="hn-grow hn-ide-remote-url">{r.fetch}</span>
            <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus remote ${r.name}`}
              onClick={() => api.ideDeleteRemote(projectId, r.name)
                .then((rs) => { setRemotes(rs); setErr(""); })
                .catch((e: unknown) => setErr(failureMessage(`menghapus remote ${r.name}`, e)))} />
          </div>
        ))}
        <div className="hn-stack-mobile hn-ide-remote-add">
          <Input size="sm" value={name} aria-label="Nama remote" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="origin" style={{ width: 100 }} />
          <Input size="sm" value={url} aria-label="URL remote" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)} placeholder="https://github.com/org/repo.git" style={{ flex: 1 }} />
          <Button size="sm" leftIcon="plus" disabled={!name || !url}
            onClick={() => api.ideAddRemote(projectId, name, url)
              .then((rs) => { setRemotes(rs); setName(""); setUrl(""); setErr(""); })
              .catch((e: unknown) => setErr(failureMessage("menambah remote", e)))}>Tambah</Button>
        </div>
    </Modal>
  );
}

/** Daftar perubahan satu bagian (Staged atau Changed): RowList berbadge M/A/D, atau pohon. */
function ChangeSection({ label, changed, selected, onSelect, view, onView, emptyText }: {
  label: string; changed: ChangedFile[]; selected: string; onSelect: (p: string) => void;
  view: "list" | "tree"; onView: (v: "list" | "tree") => void; emptyText: string;
}) {
  const tree = React.useMemo(() => buildFileTree(changed.map((c) => c.path)), [changed]);
  const meta = React.useMemo(
    () => Object.fromEntries(changed.map((c) => [c.path, c])) as Record<string, ChangedFile>, [changed]);
  return (
    <section aria-label={label}>
      <div className="hn-ide-section-head">
        <span className="hn-eyebrow">{label} · {changed.length}</span>
        {changed.length > 0 && (["list", "tree"] as const).map((v) => (
          <button key={v} type="button" className="hn-ide-view-toggle" aria-label={`${v === "list" ? "List" : "Tree"} ${label}`}
            aria-pressed={view === v} onClick={() => onView(v)}>
            <Icon name={v === "list" ? "list" : "folder-tree"} size={14}
              color={view === v ? "var(--brass-700)" : "var(--text-subtle)"} />
          </button>
        ))}
      </div>
      {changed.length === 0 ? <div className="hn-ide-empty-line">{emptyText}</div>
        : view === "tree"
          ? <TreeRoot label={`Pohon ${label}`} nodes={tree}>
              {tree.map((n) => <TreeRow key={n.path} node={n} selected={selected} onSelect={onSelect} meta={meta} defaultOpen />)}
            </TreeRoot>
          : <RowList label={`Berkas ${label}`}>
              {changed.map((c) => (
                <DenseRow key={c.path} selected={c.path === selected} onClick={() => onSelect(c.path)}>
                  <Badge size="sm" tone={STATUS_TONE[c.status] ?? "brass"}>{c.status}</Badge>
                  <span className="hn-ide-change-path">{c.path}</span>
                  {!c.binary && <span className="hn-ide-change-count">+{c.add} −{c.del}</span>}
                </DenseRow>
              ))}
            </RowList>}
    </section>
  );
}

export function IdeScreen({ projects, projectId, onProject, onToast, onGotoTerminal }:
  { projects: ProjectVM[]; projectId: string; onProject: (id: string) => void;
    onToast?: (msg: string, tone: "ok" | "warn" | "err" | "info", icon?: string) => void;
    onGotoTerminal?: (sessionId?: string) => void }) {
  // SPEC-740 · ADR-0115 · seluruh state tampilan IDE ber-scope project. `mode`/`draft` sengaja TIDAK
  // persisten — draft editor bukan parameter tampilan, dan memulihkan mode edit tanpa draft-nya menyesatkan.
  const ui = scoped("ide", projectId);
  const [rawTab, setRawTab] = usePersistedState<string>(ui, "tab", "perubahan", isStr);
  const tab = tabOf(rawTab);
  const setTab = (next: IdeTab) => setRawTab(next);
  const [viewRef, setViewRef] = usePersistedState(ui, "viewRef", "", isStr);   // kosong = working tree
  const [branches, setBranches] = React.useState<{ branches: string[]; remotes: string[] }>({ branches: [], remotes: [] });
  const [files, setFiles] = React.useState<string[]>([]);
  // Direktori terabaikan yang diruntuhkan server (isinya belum dimuat) + entri yang .gitignore
  // sembunyikan, untuk ditandai redup. Keduanya kosong selama toggle "tersembunyi" mati.
  const [dirs, setDirs] = React.useState<string[]>([]);
  const [ignored, setIgnored] = React.useState<Set<string>>(new Set());
  const [hidden, setHidden] = usePersistedState(ui, "hidden", false, isBool);
  const [treeState, setTreeState] = React.useState<"loading" | "ready" | "error">("loading");
  // Satu seleksi untuk dua tab: "file" = berkas di Berkas; staged/unstaged = diff di Perubahan.
  const [selected, setSelected] = usePersistedState(ui, "selected", "", isStr);
  const [selKind, setSelKind] = usePersistedState<"file" | "staged" | "unstaged">(
    ui, "selKind", "file", oneOf("file", "staged", "unstaged"));
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
  // SPEC-385 · ruang baca lebar untuk .md; di mode diff inilah satu-satunya cara membacanya terender.
  const [preview, setPreview] = React.useState(false);
  // Panel mobile (selector) untuk tiap tab. Tak persisten: ia hanya soal ruang layar, bukan data.
  const [panel, setPanel] = React.useState<"files" | "viewer">("files");
  const [changesPanel, setChangesPanel] = React.useState<"daftar" | "diff">("daftar");
  // Lebar panel berkas: split dipakai di tablet/desktop dan bisa diatur keyboard atau pointer.
  const [treeW, setTreeW] = usePersistedState(ui, "treeW", TREE_DEFAULT, isWidth);
  const tier = useResponsiveTier();
  // ADR-0121 · tujuan operasi berkas. SENGAJA tak persisten: folder bisa lenyap di antara kunjungan.
  const [dirSel, setDirSel] = React.useState("");
  const [nameDialog, setNameDialog] = React.useState<
    { mode: "file" | "dir" | "rename"; value: string } | null>(null);
  const [conflict, setConflict] = React.useState<{ files: { path: string; file: File }[] } | null>(null);
  // Entri yang DIKLIK di pohon (berkas atau folder) — satu-satunya target Ganti nama & Hapus.
  // Tak persisten, sama seperti dirSel (ADR-0121).
  const [treeSel, setTreeSel] = React.useState<{ path: string; kind: "file" | "dir" } | null>(null);
  const [treeMenu, setTreeMenu] = React.useState<{ x: number; y: number; anchor: HTMLElement; path: string; kind: "file" | "dir" } | null>(null);
  const { confirm, dialog } = useConfirm();
  const [viewErr, setViewErr] = React.useState("");   // galat memuat isi berkas/diff yang dibuka
  const [viewNonce, setViewNonce] = React.useState(0); // naik = muat ulang isi berkas/diff
  const [dropping, setDropping] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const dirInput = React.useRef<HTMLInputElement>(null);
  const canPickDir = typeof HTMLInputElement !== "undefined" && "webkitdirectory" in HTMLInputElement.prototype;
  const dragRef = React.useRef<{ x: number; w: number } | null>(null);

  const reloadTree = React.useCallback(() => {
    setTreeState("loading");
    api.ideTree(projectId, viewRef, { hidden })
      .then((t) => {
        setFiles(t.files); setDirs(t.dirs ?? []); setIgnored(new Set(t.ignored ?? []));
        setTreeState("ready");
      })
      .catch(() => setTreeState("error"));
  }, [projectId, viewRef, hidden]);
  /**
   * Membuka direktori terabaikan yang diruntuhkan server. Isinya digabung ke state pohon yang
   * sama — bukan disimpan terpisah — supaya seleksi, tujuan operasi berkas, dan buildFileTree
   * bekerja atas satu daftar.
   */
  const expandDir = React.useCallback(async (path: string) => {
    try {
      const t = await api.ideTree(projectId, "", { under: path });
      setFiles((f) => [...new Set([...f, ...t.files])].sort());
      setDirs((d) => [...new Set([...d, ...(t.dirs ?? [])])].sort());
      setIgnored((g) => new Set([...g, ...t.files, ...(t.dirs ?? [])]));
    } catch { onToast?.("Gagal membuka folder", "err", "x-circle"); }
  }, [projectId, onToast]);
  // Status working tree independen dari ref yang dilihat (staged/unstaged inheren milik working tree).
  const reloadStatus = React.useCallback(() => {
    api.ideWorkingStatus(projectId).then(setStatus).catch(() => setStatus(null));
  }, [projectId]);

  React.useEffect(() => { reloadTree(); }, [reloadTree]);
  React.useEffect(() => { reloadStatus(); }, [reloadStatus]);
  React.useEffect(() => {
    api.listBranches(projectId).then(setBranches)
      .catch((e: unknown) => onToast?.(failureMessage("memuat daftar branch", e), "err", "x-circle"));
  }, [projectId]);
  // selKind "file" → isi file (editable, honor viewRef). staged/unstaged → diff read-only.
  // Galat memuat tampil sebagai error + "Coba lagi" (viewNonce), bukan "Memuat…" selamanya.
  React.useEffect(() => {
    setViewErr("");
    if (!selected) { setFile(null); setDiff(null); return; }
    let alive = true;
    setPreview(false); // SPEC-385 · pratinjau selalu mengikuti berkas yang sedang dipilih
    if (selKind === "file") {
      setDiff(null);
      api.ideFile(projectId, selected, viewRef).then((f) => { if (alive) { setFile(f); setMode("view"); setMdView("preview"); } })
        .catch((e: unknown) => { if (alive) { setFile(null); setViewErr(failureMessage("membuka berkas", e)); } });
    } else {
      setFile(null); setDiffTab("diff");
      api.ideFileDiff(projectId, selected, selKind === "staged").then((d) => { if (alive) setDiff(d); })
        .catch((e: unknown) => { if (alive) { setDiff(null); setViewErr(failureMessage("memuat diff", e)); } });
    }
    return () => { alive = false; };
  }, [selected, selKind, projectId, viewRef, viewNonce]);
  // Pratinjau modal tak ikut terbawa saat berpindah tab.
  React.useEffect(() => { setPreview(false); }, [tab]);

  // Draft kotor = mode edit dengan isi yang berbeda dari berkas. Memilih berkas lain, mengganti
  // ref, atau membatalkan dari keadaan itu meminta konfirmasi — dulu draft hilang diam-diam.
  const dirty = mode === "edit" && !!file && draft !== (file.content ?? "");
  /** Jalankan `run` setelah draft kotor dikonfirmasi dibuang; tanpa draft kotor langsung jalan. */
  function whenClean(run: () => void) {
    if (!dirty) { setMode("view"); run(); return; }
    void confirm({
      title: "Buang perubahan?", eyebrow: selected || undefined,
      message: "Isi berkas yang kamu ubah di editor belum disimpan.",
      impact: ["Perubahan di editor hilang dan tak bisa dikembalikan dari hanoman."],
      confirmLabel: "Buang perubahan", cancelLabel: "Lanjut mengedit", tone: "danger", icon: "trash-2",
    }).then((ok) => { if (ok) { setMode("view"); run(); } });
  }
  const selectStaged = (p: string) => whenClean(() => { setSelKind("staged"); setSelected(p); setChangesPanel("diff"); });
  const selectChanged = (p: string) => whenClean(() => { setSelKind("unstaged"); setSelected(p); setChangesPanel("diff"); });
  /** Klik berkas di pohon: jadi target Ganti nama/Hapus sekaligus membukanya. */
  const pickTreeFile = (p: string) => whenClean(() => {
    setTreeSel({ path: p, kind: "file" }); setSelKind("file"); setSelected(p); setPanel("viewer");
  });
  /** Klik folder: tujuan unggah/buat (dirSel) sekaligus target Ganti nama/Hapus. */
  const pickTreeDir = (p: string) => { setDirSel(p); setTreeSel({ path: p, kind: "dir" }); };

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
  // Galat git selalu tampil sebagai toast, kecuali 409 — itu dijawab dialog "Paksa" (pendingForce).
  const gitFail = (action: string, e: unknown) => {
    if (e instanceof ApiError && e.status === 409) return;
    onToast?.(failureMessage(action, e), "err", "x-circle");
  };
  async function checkout() { if (viewRef) await runGit({ op: "checkout", ref: viewRef }).catch((e: unknown) => gitFail("checkout", e)); }
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
    await api.ideGit(projectId, op).then(() => { setViewRef(""); reloadTree(); reloadStatus(); })
      .catch((e: unknown) => onToast?.(failureMessage("menjalankan operasi paksa", e), "err", "x-circle"));
  }

  // Edit hanya untuk working tree: isi ref lain tak boleh ditimpa oleh draft-nya (audit P0).
  function startEdit() { if (!file || file.binary || viewRef) return; setDraft(file.content ?? ""); setMode("edit"); }
  async function save() {
    if (!selected || viewRef) return;
    try {
      await api.putIdeFile(projectId, selected, draft);
      setFile((f) => (f ? { ...f, content: draft } : f)); setMode("view");
      reloadStatus(); // menyimpan file mengubah status working tree
    } catch (e) {
      // Draft dipertahankan dan mode edit tetap: operator bisa mencoba lagi tanpa mengetik ulang.
      onToast?.(failureMessage("menyimpan berkas", e), "err", "x-circle");
    }
  }
  const cancelEdit = () => whenClean(() => undefined);

  // ADR-0121 · operasi berkas Explorer.
  const underDir = (p: string) => (dirSel ? `${dirSel}/${p}` : p);
  const afterWrite = () => { reloadTree(); reloadStatus(); };

  /** Buka dialog nama baru di `parent` (root bila kosong). Tujuannya ikut diset, bukan hanya dialognya. */
  function openNameDialog(kind: "file" | "dir", parent: string) {
    setDirSel(parent);
    setNameDialog({ mode: kind, value: "" });
  }

  async function createEntry(kind: "file" | "dir", name: string) {
    if (!name.trim()) return;
    const path = underDir(name.trim());
    try {
      await api.ideCreateEntry(projectId, path, kind);
      afterWrite();
      onToast?.(`${kind === "dir" ? "folder" : "berkas"} dibuat · ${path}`, "ok", "file-plus");
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.(code === 409 ? `sudah ada · ${path}` : `gagal membuat ${path}`, "err", "x-circle");
    }
  }

  // Dipakai tombol unggah, drop, dan "Timpa semua". `list` memakai path RELATIF terhadap dirSel;
  // perbandingan dengan `skipped` karena itu lewat underDir(), bukan sebaliknya.
  async function runUpload(list: { path: string; file: File }[], overwrite = false) {
    if (!list.length) return;
    let r: IdeUploadResult;
    try { r = await api.ideUpload(projectId, dirSel, list, overwrite); }
    catch { onToast?.("gagal mengunggah", "err", "x-circle"); return; }
    afterWrite();
    const bentrok = new Set(r.skipped.filter((s) => s.reason === "exists").map((s) => s.path));
    const lain = r.skipped.filter((s) => s.reason !== "exists");
    if (r.written.length) onToast?.(`${r.written.length} berkas terunggah`, "ok", "upload");
    if (lain.length) onToast?.(`${lain.length} berkas dilewati · ${lain[0]!.reason}`, "warn", "alert-triangle");
    setConflict(bentrok.size ? { files: list.filter((f) => bentrok.has(underDir(f.path))) } : null);
  }

  // Target Ganti nama & Hapus = entri yang dipilih dari pohon (treeSel) atau dari menu konteksnya,
  // BUKAN berkas yang terbuka. Diff dari Perubahan tak pernah jadi target.
  async function renameTarget(to: string) {
    const t = treeSel;
    if (!t || !to.trim()) return;
    const from = t.path, dest = to.trim();
    try {
      await api.ideRenameEntry(projectId, from, dest);
      afterWrite();
      setTreeSel({ path: dest, kind: t.kind });
      // Berkas terbuka / folder tujuan yang berada di bawah entri ini ikut pindah namanya.
      if (selKind === "file" && remapPath(selected, from, dest) !== selected) setSelected(remapPath(selected, from, dest));
      if (dirSel && remapPath(dirSel, from, dest) !== dirSel) setDirSel(remapPath(dirSel, from, dest));
      onToast?.(`diganti nama · ${dest}`, "ok", "pencil");
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      onToast?.(code === 409 ? "nama tujuan sudah dipakai" : failureMessage(`mengganti nama ${baseName(from)}`, e), "err", "x-circle");
    }
  }

  /** Hapus entri lewat dialog DS: nama objeknya disebut, dampak terdaftar, aksi eksplisit. */
  function requestDelete(target: { path: string; kind: "file" | "dir" } | null = treeSel) {
    const t = target;
    if (!t) return;
    const isDir = t.kind === "dir";
    setTreeSel(t);
    void confirm({
      title: isDir ? "Hapus folder beserta isinya?" : "Hapus berkas?",
      eyebrow: t.path,
      impact: isDir
        ? [`Folder ${baseName(t.path)}/ dan seluruh isinya dihapus dari working tree.`, "Yang belum di-commit tak bisa dikembalikan dari hanoman."]
        : [`Berkas ${baseName(t.path)} dihapus dari working tree.`, "Yang belum di-commit tak bisa dikembalikan dari hanoman."],
      confirmLabel: "Hapus", tone: "danger", icon: "trash-2",
      requireText: isDir ? baseName(t.path) : undefined,
      run: () => deleteTarget(t),
    });
  }

  async function deleteTarget(t: { path: string; kind: "file" | "dir" }) {
    try {
      await api.ideDeleteEntry(projectId, t.path);
      afterWrite();
      setTreeSel(null);
      // Berkas terbuka di dalam entri yang hilang ikut ditutup; folder tujuan yang hilang dilepas.
      if (selKind === "file" && remapPath(selected, t.path, "") !== selected) { setSelected(""); setFile(null); setMode("view"); }
      if (dirSel && remapPath(dirSel, t.path, "") !== dirSel) setDirSel("");
      onToast?.(`dihapus · ${t.path}`, "ok", "trash-2");
    } catch (e) { onToast?.(failureMessage(`menghapus ${baseName(t.path)}`, e), "err", "x-circle"); }
  }

  // Menu konteks baris pohon: aksi berkas tinggal di sini (Berkas baru di folder itu, Ganti nama, Hapus).
  const openTreeMenu: TreeMenu = (path, kind, anchor, pos) => {
    const r = anchor.getBoundingClientRect();
    setTreeMenu({ x: pos?.x ?? r.left, y: pos?.y ?? r.bottom, anchor, path, kind });
  };
  function treeMenuItems(t: { path: string; kind: "file" | "dir" }): MenuItem[] {
    const parent = t.kind === "dir" ? t.path : parentOf(t.path);
    const where = parent ? `${parent}/` : "root";
    const items: MenuItem[] = [
      { label: `Berkas baru di ${where}`, run: () => openNameDialog("file", parent) },
    ];
    if (t.kind === "dir") items.push({ label: `Folder baru di ${where}`, run: () => openNameDialog("dir", parent) });
    items.push({ label: "Ganti nama…", run: () => { setTreeSel(t); setNameDialog({ mode: "rename", value: t.path }); } });
    items.push({ label: t.kind === "dir" ? "Hapus folder…" : "Hapus berkas…", run: () => requestDelete(t) });
    return items;
  }

  const pickedFiles = (input: HTMLInputElement | null) => {
    const picked = Array.from(input?.files ?? []);
    const list = picked.map((f) => ({
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f }));
    if (input) input.value = "";   // memilih berkas yang sama dua kali harus tetap memicu change
    return list;
  };

  const fileTree = React.useMemo(() => buildFileTree(files, dirs), [files, dirs]);
  const highlighted = React.useMemo(() => {
    if (!file || file.content === null) return "";
    const lang = langOf(selected);
    try { return lang ? hljs.highlight(file.content, { language: lang }).value : hljs.highlightAuto(file.content).value; }
    catch { return file.content; }
  }, [file, selected]);

  // Seleksi dibagi dua: berkas (Berkas) dan diff (Perubahan). Masing-masing hanya tampil di tab-nya.
  const fileSel = selKind === "file" ? selected : "";
  const diffSel = selKind !== "file" ? selected : "";
  // SPEC-385 · pratinjau lebar per tab: diff menampilkan isi SESUDAH perubahan, berkas isi di ref-nya.
  const diffPreview = diffSel && diff && !diff.binary && diff.content !== null && isMarkdownPath(diffSel)
    ? { text: diff.content, download: (f: "md" | "pdf") => api.ideFileDiffDownloadUrl(projectId, diffSel, selKind === "staged", f) }
    : null;
  const filePreview = fileSel && file && !file.binary && file.content !== null && isMarkdownPath(fileSel)
    ? { text: file.content, download: (f: "md" | "pdf") => api.ideFileDownloadUrl(projectId, fileSel, viewRef, f) }
    : null;
  const previewSrc = tab === "perubahan" ? diffPreview : tab === "berkas" ? filePreview : null;
  const previewPath = tab === "perubahan" ? diffSel : fileSel;

  const changedCount = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0);
  const toolbar = (
    <div className="hn-ide-toolbar">
      <Select size="sm" aria-label="Proyek" value={projectId} onChange={(e) => onProject(e.target.value)}
        options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      <Select size="sm" aria-label="Ref yang dilihat" value={viewRef}
        onChange={(e) => { const next = e.target.value; whenClean(() => setViewRef(next)); }} options={refOptions} />
      {/* SPEC-233 · fetch --all --prune; ref-only → tak digerbang sesi */}
      <Button size="sm" variant="ghost" leftIcon="download-cloud" onClick={() => {
        void runGit({ op: "fetch", prune: true })
          .then(() => api.listBranches(projectId).then(setBranches))
          .catch((e: unknown) => gitFail("fetch", e));
      }}>Fetch</Button>
      {/* Entri terabaikan hanya ada di working tree — togglenya mati saat melihat ref. */}
      <Button size="sm" variant={hidden ? "secondary" : "ghost"} leftIcon={hidden ? "eye" : "eye-off"}
        disabled={!!viewRef} aria-pressed={hidden}
        title={viewRef ? "Hanya di working tree" : "Tampilkan berkas & folder yang .gitignore sembunyikan"}
        onClick={() => setHidden(!hidden)}>Tersembunyi</Button>
      <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={afterWrite}>Muat ulang</Button>
      <OverflowActions label="Aksi lain IDE" items={[
        { key: "checkout", label: viewRef ? `Checkout ${viewRef}` : "Checkout", icon: "git-branch",
          disabled: !viewRef, onSelect: () => void checkout() },
        { key: "remotes", label: "Kelola remote", icon: "git-branch", onSelect: () => setShowRemotes(true) },
      ]} />
    </div>
  );

  // Panel Perubahan: daftar di kiri (mobile: selector), diff di kanan.
  const changesBody = (
    <ResponsivePanels
      ariaLabel="Panel perubahan"
      active={changesPanel}
      onActiveChange={(next) => setChangesPanel(next as "daftar" | "diff")}
      masterWidth={320}
      panels={[
        { id: "daftar", label: "Daftar", className: "hn-panel-flex", content: (
          <Card padding={0} fill>
            <div className="hn-ide-changes-bar">
              <Text size={12} tone="muted" as="span" className="hn-ide-changes-legend">
                M diubah · A ditambah · D dihapus
              </Text>
              {/* Satu aksi primer. Commit belum bisa dibuat dari dashboard (tak ada endpoint tulisnya),
                  jadi aksinya membawa ke sesi Terminal, tempat git commit dijalankan seperti biasa. */}
              <Button size="sm" variant="primary" leftIcon="git-commit" disabled={!onGotoTerminal}
                onClick={() => onGotoTerminal?.()}>Commit dari Terminal</Button>
            </div>
            <p className="hn-ide-changes-hint">
              Commit dibuat dari sesi Terminal, supaya pesan commit dan hook git berjalan seperti biasa.
            </p>
            <div data-testid="ide-changes-scroll" className="hn-ide-scroll">
              <ChangeSection label="Staged" changed={status?.staged ?? []}
                selected={diffSel} onSelect={selectStaged}
                view={stagedView} onView={setStagedView} emptyText="Tak ada file staged." />
              <div className="hn-ide-section-gap" />
              <ChangeSection label="Changed" changed={status?.unstaged ?? []}
                selected={diffSel} onSelect={selectChanged}
                view={changedView} onView={setChangedView} emptyText="Tak ada file berubah." />
            </div>
          </Card>
        ) },
        { id: "diff", label: "Diff", className: "hn-panel-flex", content: (
          <Card padding={0} fill>
            <div className="hn-ide-viewer-bar">
              <Icon name="file-text" size={15} color="var(--text-muted)" />
              <span className="hn-ide-viewer-path">{diffSel || "—"}</span>
              {diff?.status && <Badge tone={STATUS_TONE[diff.status] ?? "brass"} size="sm">{diff.status}</Badge>}
              <span className="hn-grow" />
              {/* SPEC-385 · pane diff dulu hanya bisa membaca .md sebagai <pre> mentah */}
              {diffPreview && (
                <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => setPreview(true)}>Preview lebar</Button>
              )}
              <div className="hn-ide-seg">
                {(["diff", "source"] as const).map((t) => (
                  <button key={t} type="button" aria-pressed={diffTab === t} onClick={() => setDiffTab(t)}>{t}</button>
                ))}
              </div>
            </div>
            <div data-testid="doc-preview-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
              {!diffSel ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari daftar Perubahan" />
                : diff === null ? (viewErr
                    ? <StateBlock kind="error" title="Diff belum bisa dibuka" hint={viewErr} action={() => setViewNonce((n) => n + 1)} />
                    : <StateBlock kind="loading" title="Memuat…" hint={diffSel} />)
                : diff.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" hint={diffSel} />
                : diffTab === "diff" ? <div className="hn-ide-diff-pad"><DiffView diff={diff.diff ?? ""} />
                    {diff.truncated && <div className="hn-ide-truncated">… dipotong pada 256 KB.</div>}</div>
                : diff.content === null ? <StateBlock kind="empty" icon="trash-2" title="File dihapus" hint="Tak ada isi untuk ditampilkan." />
                : <pre className="hn-ide-source-pre">{diff.content}</pre>}
            </div>
          </Card>
        ) },
      ]}
    />
  );

  // Panel Berkas: pohon dengan satu baris kontrol (mobile: + menu ⋯), isi/editor di kanan.
  const filesMore: MenuItem[] = [
    { label: "Folder baru", run: () => openNameDialog("dir", dirSel) },
    ...(canPickDir ? [{ label: "Unggah folder", run: () => dirInput.current?.click() }] : []),
  ];
  const filesBody = (
    <ResponsivePanels
      ariaLabel="Panel IDE"
      active={panel}
      onActiveChange={(next) => setPanel(next as "files" | "viewer")}
      masterWidth={treeW}
      panels={[
        { id: "files", label: "Berkas", className: "hn-panel-flex", content: (
          <div className="hn-ide-files-pane" style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
            <Card padding={0} fill>
              {/* ADR-0121 · satu baris kontrol. Tujuan unggah/buat wajib terlihat (→ folder). */}
              <div className="hn-ide-files-bar">
                <span className="hn-eyebrow hn-ide-files-eyebrow">berkas · {viewRef || "working tree"}</span>
                <Button size="sm" variant="ghost" leftIcon="file-plus" onClick={() => openNameDialog("file", dirSel)}>Berkas baru</Button>
                <Button size="sm" variant="ghost" leftIcon="upload" onClick={() => fileInput.current?.click()}>Unggah</Button>
                <OverflowActions label="Aksi lain berkas" items={filesMore.map((m, i) => ({
                  key: `more-${i}`, label: m.label, onSelect: m.run }))} />
                <span data-testid="ide-entry-dest" className="hn-ide-dest">→ {dirSel || "root"}</span>
                <input ref={fileInput} type="file" multiple hidden
                  onChange={() => void runUpload(pickedFiles(fileInput.current))} />
                <input ref={dirInput} type="file" hidden {...{ webkitdirectory: "" }}
                  onChange={() => void runUpload(pickedFiles(dirInput.current))} />
              </div>
              <div data-testid="ide-tree-scroll"
                onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
                onDragLeave={() => setDropping(false)}
                onDrop={(e) => { e.preventDefault(); setDropping(false);
                  void readDroppedEntries(e.dataTransfer).then((list) => runUpload(list)); }}
                style={{ padding: 8, flex: "1 1 auto", minHeight: 0, overflow: "auto",
                  outline: dropping ? "2px dashed var(--brass-500)" : "none", outlineOffset: -4 }}>
                {treeState === "loading" ? <StateBlock kind="loading" compact title="Memuat file…" />
                  : treeState === "error" ? <StateBlock kind="error" compact title="Gagal memuat file" action={() => reloadTree()} />
                  : files.length === 0 ? <StateBlock kind="empty" compact icon="folder-open" title="Tak ada file" />
                  : (
                    <TreeRoot label="Pohon berkas" nodes={fileTree}>
                      {fileTree.map((n) => (
                        <TreeRow key={n.path} node={n} selected={fileSel}
                          onSelect={pickTreeFile} dirSelected={dirSel} onSelectDir={pickTreeDir}
                          ignored={ignored} onExpand={hidden ? expandDir : undefined} menu={openTreeMenu} />
                      ))}
                    </TreeRoot>
                  )}
              </div>
            </Card>
            {/* Pemisah lebar: keyboard (←/→, Shift untuk langkah besar, Home/End) dan pointer. */}
            {tier !== "mobile" && (
              <div role="separator" aria-orientation="vertical" aria-label="Lebar panel berkas" tabIndex={0}
                aria-valuemin={TREE_MIN} aria-valuemax={TREE_MAX} aria-valuenow={treeW} className="hn-ide-split"
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 48 : 16;
                  const next = e.key === "ArrowLeft" ? treeW - step : e.key === "ArrowRight" ? treeW + step
                    : e.key === "Home" ? TREE_MIN : e.key === "End" ? TREE_MAX : null;
                  if (next === null) return;
                  e.preventDefault(); setTreeW(clampTree(next));
                }}
                onPointerDown={(e) => { dragRef.current = { x: e.clientX, w: treeW }; e.currentTarget.setPointerCapture?.(e.pointerId); }}
                onPointerMove={(e) => { const d = dragRef.current; if (d) setTreeW(clampTree(d.w + (e.clientX - d.x))); }}
                onPointerUp={() => { dragRef.current = null; }}
                onPointerCancel={() => { dragRef.current = null; }} />
            )}
          </div>
        ) },
        { id: "viewer", label: "Isi", className: "hn-panel-flex", content: (
          <Card padding={0} fill>
            <div className="hn-ide-viewer-bar">
              <Icon name="file-text" size={15} color="var(--text-muted)" />
              <span className="hn-ide-viewer-path">{fileSel || "—"}</span>
              {file?.truncated && <Badge tone="warn" size="sm">terpotong</Badge>}
              <span className="hn-grow" />
              {mode === "view"
                ? <div className="hn-ide-viewer-actions">
                    {/* SPEC-240 · toggle Preview | Source hanya untuk .md */}
                    {file && !file.binary && isMarkdownPath(fileSel) && (
                      <div className="hn-ide-seg">
                        {(["preview", "source"] as const).map((t) => (
                          <button key={t} type="button" aria-pressed={mdView === t} onClick={() => setMdView(t)}>
                            {t === "preview" ? "Preview" : "Source"}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* SPEC-385 · toggle di atas hanya memakai sisa lebar di samping pohon;
                        tombol ini membuka dokumen yang sama di ruang baca lebar */}
                    {filePreview && (
                      <Button size="sm" variant="secondary" leftIcon="book-open" onClick={() => setPreview(true)}>Preview lebar</Button>
                    )}
                    {/* SPEC-361 · unduh berkas teks yang sedang dibuka (biner tak ditawari) */}
                    <DocDownload href={(f) => api.ideFileDownloadUrl(projectId, fileSel, viewRef, f)}
                      disabled={!file || file.binary} />
                    {/* Edit hanya untuk working tree: isi ref lain tak boleh ditimpa draft-nya. */}
                    <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}
                      disabled={!file || file.binary || !!viewRef}
                      title={viewRef ? "Edit hanya di working tree — pilih working tree dulu" : undefined}>Edit</Button>
                  </div>
                : <div className="hn-ide-viewer-actions">
                    {dirty && <Badge tone="warn" size="sm">belum disimpan</Badge>}
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>Batal</Button>
                    <Button size="sm" leftIcon="check" onClick={() => void save()}>Simpan</Button>
                  </div>}
            </div>
            <div data-testid="doc-preview-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
              {!fileSel ? <StateBlock kind="empty" icon="file-text" title="Pilih file dari pohon di kiri" />
                : file === null ? (viewErr
                    ? <StateBlock kind="error" title="Berkas belum bisa dibuka" hint={viewErr} action={() => setViewNonce((n) => n + 1)} />
                    : <StateBlock kind="loading" title="Memuat…" hint={fileSel} />)
                : file.binary ? <StateBlock kind="empty" icon="file" title="File biner" hint={fileSel} />
                : mode === "edit"
                  /* placeholder-exempt: isi berkas apa pun bahasanya — tak ada satu contoh yang benar lintas .ts/.json/.sh */
                  ? <textarea aria-label={`Isi ${baseName(fileSel)}`} value={draft} spellCheck={false}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}
                      className="hn-ide-editor" />
                  : isMarkdownPath(fileSel) && mdView === "preview"
                    ? <div className="hn-ide-md-pad"><MarkdownView text={file.content ?? ""} name={fileSel} /></div>
                    : <pre className="hn-ide-code-pre">
                        <code className="hljs hn-ide-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
                      </pre>}
            </div>
          </Card>
        ) },
      ]}
    />
  );

  return (
    // SPEC-363 · Perubahan dan Berkas memakai rantai flex (dua pane menggulir sendiri); Riwayat dan
    // Cabang tetap tumbuh mengikuti isi — graph bergantung pada `<main>` yang menggulir (SPEC-351).
    <div className="hn-ide-screen" style={{ display: "flex", flexDirection: "column", gap: 16,
      ...(tab === "perubahan" || tab === "berkas" ? { flex: "1 1 0", minHeight: 0 } : null) }}>
      <div className="hn-ide-head">
        <Tabs aria-label="Bagian IDE" tabs={[
          { value: "perubahan", label: "Perubahan", count: changedCount || undefined },
          { value: "riwayat", label: "Riwayat" },
          { value: "cabang", label: "Cabang" },
          { value: "berkas", label: "Berkas" },
        ]} value={tab} onChange={(v) => setTab(tabOf(v))} />
        {toolbar}
      </div>

      {tab === "perubahan" ? changesBody
        : tab === "riwayat" ? (
          <GitGraph projectId={projectId} onRunGit={runGit} onMerge={mergeGraph}
            onRebase={(onto) => graphIsolated("rebase", onto)} onPull={(src) => graphIsolated("pull", src)} onDrop={(sha) => graphIsolated("drop", sha)}
            onToast={onToast}
            onOpenFile={(p, ref) => whenClean(() => { setViewRef(ref); setSelKind("file"); setSelected(p); setPanel("viewer"); setTab("berkas"); })}
            onOpenCabang={() => setTab("cabang")} />
        ) : tab === "cabang" ? <CabangPanel projectId={projectId} />
        : filesBody}

      {previewSrc && preview && (
        <DocPreviewModal path={previewPath} text={previewSrc.text} eyebrow={viewRef || status?.branch || projectId}
          download={previewSrc.download} onClose={() => setPreview(false)} />
      )}
      {nameDialog && (
        <Modal open title={nameDialog.mode === "dir" ? "Folder baru" : nameDialog.mode === "file" ? "Berkas baru" : "Ganti nama"}
          eyebrow={nameDialog.mode === "rename" ? `Dari ${treeSel?.path ?? ""}` : `→ ${dirSel || "root"}`}
          onClose={() => setNameDialog(null)} width={460} footer={<>
            <Button size="sm" variant="ghost" onClick={() => setNameDialog(null)}>Batal</Button>
            <Button size="sm" leftIcon="check" disabled={!nameDialog.value.trim()}
              onClick={() => { const d = nameDialog; setNameDialog(null);
                if (d.mode === "rename") void renameTarget(d.value); else void createEntry(d.mode, d.value); }}>Simpan</Button>
          </>}>
          <Input size="sm" autoFocus value={nameDialog.value}
            aria-label={nameDialog.mode === "dir" ? "Nama folder" : nameDialog.mode === "file" ? "Nama berkas" : "Path baru"}
            placeholder={nameDialog.mode === "dir" ? "komponen" : "Baru.tsx"}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNameDialog({ ...nameDialog, value: e.target.value })}
            style={{ width: "100%" }} />
        </Modal>
      )}
      {conflict && (
        <Modal open title={`${conflict.files.length} berkas sudah ada`} onClose={() => setConflict(null)} width={520}
          footer={<>
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>Biarkan</Button>
            <Button size="sm" leftIcon="alert-triangle"
              onClick={() => { const f = conflict.files; setConflict(null); void runUpload(f, true); }}>Timpa semua</Button>
          </>}>
          <div className="hn-ide-muted-line">
            Berkas berikut dilewati supaya perubahan yang belum di-commit tak hilang.
          </div>
          <pre className="hn-ide-conflict-list">
            {conflict.files.map((f) => underDir(f.path)).join("\n")}
          </pre>
        </Modal>
      )}
      {treeMenu && (
        <Menu x={treeMenu.x} y={treeMenu.y} returnFocus={treeMenu.anchor} onClose={() => setTreeMenu(null)}
          items={treeMenuItems({ path: treeMenu.path, kind: treeMenu.kind })} />
      )}
      {/* ADR-0121 · folder menuntut nama diketik ulang (requireText): penghapusannya rekursif dan
          yang belum di-commit tak bisa dipulihkan. Dialog DS lewat useConfirm (requestDelete). */}
      {dialog}
      {pendingForce && <ForceDialog msg={pendingForce.msg} onForce={confirmForce} onCancel={() => setPendingForce(null)} />}
      {showRemotes && <RemotesModal projectId={projectId} onClose={() => setShowRemotes(false)} />}
    </div>
  );
}
