/* GitGraph — DAG commit read + aksi (SPEC-182). Lane dihitung computeLanes (nol dep).
   Baris = grid [svg lane | subject | refs | meta]; klik = detail; klik-kanan = context-menu. */
import React from "react";
import { Card, Button, StateBlock, Badge, Icon, DocDownload, MarkdownView, isMarkdownPath } from "../ds";
import { api, type GraphCommit, type CommitDetail, type GitOp, type RepoStatus, type Stash, type ReviewFile } from "../api/client";
import { computeLanes, rowEdges, type GraphRow, type Edge } from "./git-graph";
import { buildFileTree, TreeRow } from "./file-tree";
import { DiffView } from "./diff-view";
import { emojify, renderMessage, gravatarUrl } from "./git-graph-render";

const LANE_W = 14, ROW_H = 30, DOT = 4;
const POLL_MS = 4000; // SPEC-245 · kadens live-refresh git graph (HTTP polling, ADR-stack)
const PAGE = 200;     // SPEC-351 · besar satu halaman commit; jendela tumbuh kelipatan ini
const COLORS = ["#a9791c", "#3b7a57", "#8a5a44", "#4a6fa5", "#7d5ba6", "#b0503a"]; // brass-leaf-clay-ink
const laneColor = (i: number, palette: string[] = COLORS) => palette[i % palette.length];
const rel = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
};

// Segmen edge → path SVG. SPEC-233 · style "rounded" (bezier) atau "angular" (siku) saat pindah lane.
function edgePath(e: Edge, style: "rounded" | "angular"): string {
  const x = (i: number) => LANE_W / 2 + i * LANE_W;
  const y1 = e.half === "bottom" ? ROW_H / 2 : 0;
  const y2 = e.half === "top" ? ROW_H / 2 : ROW_H;
  const x1 = x(e.fromLane), x2 = x(e.toLane), ym = (y1 + y2) / 2;
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  return style === "angular"
    ? `M${x1} ${y1}V${ym}H${x2}V${y2}`
    : `M${x1} ${y1}C${x1} ${ym},${x2} ${ym},${x2} ${y2}`;
}

function RowSvg({ row, edges, maxLanes, style, palette }: { row: GraphRow; edges: Edge[]; maxLanes: number; style: "rounded" | "angular"; palette: string[] }) {
  const cx = LANE_W / 2 + row.lane * LANE_W;
  return (
    <svg width={maxLanes * LANE_W} height={ROW_H} style={{ flex: "0 0 auto" }}>
      {edges.map((e, i) => (
        <path key={i} d={edgePath(e, style)} fill="none" stroke={laneColor(e.colorLane, palette)} strokeWidth={1.5} />
      ))}
      <circle cx={cx} cy={ROW_H / 2} r={DOT} fill={laneColor(row.lane, palette)} stroke="var(--surface-card)" strokeWidth={1.5} />
    </svg>
  );
}

function Menu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; run: () => void }[]; onClose: () => void }) {
  React.useEffect(() => { const h = () => onClose(); window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, [onClose]);
  return (
    <div style={{ position: "fixed", left: x, top: y, zIndex: 150, background: "var(--surface-card)",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-pop, 0 6px 24px rgba(0,0,0,.15))",
      padding: 4, minWidth: 180 }}>
      {items.map((it) => (
        <button key={it.label} onClick={it.run} style={{ display: "block", width: "100%", textAlign: "left",
          padding: "7px 10px", border: "none", background: "transparent", cursor: "pointer",
          fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-body)", borderRadius: 4 }}>{it.label}</button>
      ))}
    </div>
  );
}

type MenuItem = { label: string; run: () => void };

// Item context-menu untuk satu commit. Aksi hapus branch sadar local vs origin (SPEC-206):
// ref `origin/<b>` dikelompokkan dengan branch lokal `<b>` bila keduanya menunjuk commit ini.
// SPEC-229 · aksi merge lewat `merge` (jalur worktree isolasi + sesi claude), bukan `act`/onRunGit.
type MergeFn = (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => void;
type RefFn = (ref: string) => void; // rebase(onto) / drop(sha) / pull(source)
function menuItems(c: GraphCommit, current: string, act: (op: GitOp) => void, merge: MergeFn, rebase: RefFn, drop: RefFn): MenuItem[] {
  const locals = c.refs.filter((r) => !r.startsWith("origin/"));
  const origins = c.refs.filter((r) => r.startsWith("origin/") && r !== "origin/HEAD").map((r) => r.slice("origin/".length));
  const names = [...new Set([...locals, ...origins])];
  const copy = (t: string) => { void navigator.clipboard?.writeText(t); };
  return [
    { label: `Checkout ${c.sha.slice(0, 7)}`, run: () => act({ op: "checkout", ref: c.sha }) },
    { label: "Merge (fast-forward bila bisa)", run: () => merge(c.sha) },
    { label: "Merge tanpa fast-forward", run: () => merge(c.sha, { ff: "no-ff" }) },
    { label: "Merge fast-forward saja", run: () => merge(c.sha, { ff: "ff-only" }) },
    { label: "Cherry-pick", run: () => act({ op: "cherry-pick", sha: c.sha }) },
    { label: "Revert", run: () => act({ op: "revert", sha: c.sha }) },
    // SPEC-233 · rebase current ke commit ini / buang commit ini (isolasi + konflik → sesi claude)
    { label: "Rebase current → sini", run: () => rebase(c.sha) },
    { label: "Drop commit", run: () => drop(c.sha) },
    // SPEC-233 · reset branch current ke commit ini (soft/mixed/hard). hard ireversibel → gate force.
    { label: "Reset current → sini (soft)", run: () => act({ op: "reset", sha: c.sha, mode: "soft" }) },
    { label: "Reset current → sini (mixed)", run: () => act({ op: "reset", sha: c.sha, mode: "mixed" }) },
    { label: "Reset current → sini (hard)", run: () => act({ op: "reset", sha: c.sha, mode: "hard" }) },
    { label: "Copy hash", run: () => copy(c.sha) },
    { label: "Copy subject", run: () => copy(c.subject) },
    { label: "Buat branch di sini…", run: () => { const name = window.prompt("Nama branch baru:"); if (name) act({ op: "branch", name, at: c.sha, checkout: true }); } },
    // SPEC-233 · buat tag di commit ini. Pesan kosong = lightweight; terisi = annotated. Konfirmasi push.
    { label: "Add tag…", run: () => {
      const name = window.prompt("Nama tag:"); if (!name) return;
      const message = window.prompt("Pesan (kosong = lightweight):") || undefined;
      const push = window.confirm("Dorong tag ke origin?");
      act({ op: "tag", name, message, at: c.sha, push });
    } },
    // Merge branch ini lalu hapus (local + origin bila ada). Hanya branch lokal selain yang aktif.
    ...locals.filter((r) => r !== current).map((r) => ({
      label: `Merge ${r} lalu hapus (local${origins.includes(r) ? " + origin" : ""})`,
      run: () => merge(r, { deleteBranch: r }),
    })),
    // Hapus mandiri per branch: local &/atau origin. Local tak boleh branch aktif; origin selalu boleh.
    ...names.flatMap((r) => {
      const localOk = locals.includes(r) && r !== current, hasOrigin = origins.includes(r);
      const items: MenuItem[] = [];
      if (localOk && hasOrigin) items.push({ label: `Hapus ${r} (local + origin)`, run: () => act({ op: "delete-branch", name: r, remote: true }) });
      if (localOk) items.push({ label: `Hapus ${r} (local)`, run: () => act({ op: "delete-branch", name: r }) });
      if (hasOrigin) items.push({ label: `Hapus origin/${r}`, run: () => act({ op: "delete-branch", name: r, local: false, remote: true }) });
      return items;
    }),
  ];
}

// SPEC-233 · menu klik-kanan pada pill branch. Local vs origin dibedakan prefix `origin/`.
// Branch aktif (== current) hanya Rename/Push/Copy (tak boleh checkout/merge/hapus diri sendiri).
function branchMenuItems(ref: string, current: string, allRefs: string[], act: (op: GitOp) => void, merge: MergeFn, rebase: RefFn, pull: RefFn, pr: RefFn, archive: RefFn): MenuItem[] {
  const isOrigin = ref.startsWith("origin/");
  const name = isOrigin ? ref.slice("origin/".length) : ref;
  const copy = () => { void navigator.clipboard?.writeText(ref); };
  if (isOrigin) return [
    { label: `Checkout ${ref}`, run: () => act({ op: "checkout", ref }) },
    { label: `Merge ${ref} → current`, run: () => merge(ref) },
    { label: `Pull ${name} → current`, run: () => pull(name) },
    { label: "Create Pull Request", run: () => pr(name) },
    { label: "Create archive", run: () => archive(ref) },
    { label: `Hapus origin/${name}`, run: () => act({ op: "delete-branch", name, local: false, remote: true }) },
    { label: "Copy nama branch", run: copy },
  ];
  const self = ref === current;
  const hasOrigin = allRefs.includes(`origin/${name}`);
  const items: MenuItem[] = [];
  if (!self) items.push({ label: `Checkout ${ref}`, run: () => act({ op: "checkout", ref }) });
  items.push({ label: "Rename…", run: () => { const to = window.prompt(`Nama baru untuk ${ref}:`, ref); if (to && to !== ref) act({ op: "rename-branch", from: ref, to }); } });
  items.push({ label: "Push ke origin", run: () => act({ op: "push-branch", name: ref, setUpstream: true }) });
  if (!self) items.push({ label: `Merge ${ref} → current`, run: () => merge(ref) });
  if (!self) items.push({ label: `Rebase current → ${ref}`, run: () => rebase(ref) });
  items.push({ label: "Create Pull Request", run: () => pr(ref) });
  items.push({ label: "Create archive", run: () => archive(ref) });
  if (!self) {
    items.push({ label: hasOrigin ? `Hapus ${ref} (local + origin)` : `Hapus ${ref} (local)`, run: () => act({ op: "delete-branch", name: ref, remote: hasOrigin }) });
    if (hasOrigin) items.push({ label: `Hapus ${ref} (local saja)`, run: () => act({ op: "delete-branch", name: ref }) });
  }
  items.push({ label: "Copy nama branch", run: copy });
  return items;
}

export function GitGraph({ projectId, onRunGit, onMerge, onRebase, onPull, onDrop, onOpenFile }:
  { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>;
    onMerge: (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => Promise<void>;
    onRebase: (onto: string) => Promise<void>;
    onPull: (source: string) => Promise<void>;
    onDrop: (sha: string) => Promise<void>;
    onOpenFile: (path: string, ref: string) => void }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<GraphRow[]>([]);
  // SPEC-351 · jendela commit berhalaman: `hasMore` = halaman terakhir balas penuh, `paging` = halaman
  // berikutnya sedang diambil, `moreRef` = baris penutup yang jadi sentinel auto-load.
  const [hasMore, setHasMore] = React.useState(false);
  // SPEC-523 · jumlah commit terjangkau dari ref yang sedang digambar (git rev-list --count).
  const [total, setTotal] = React.useState(0);
  const [paging, setPaging] = React.useState(false);
  const moreRef = React.useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = React.useState("");
  const [detail, setDetail] = React.useState<CommitDetail | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; c: GraphCommit } | null>(null);
  const [tagMenu, setTagMenu] = React.useState<{ x: number; y: number; tag: string } | null>(null);
  const [status, setStatus] = React.useState<RepoStatus | null>(null);
  const [uncMenu, setUncMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [stashes, setStashes] = React.useState<Stash[]>([]);
  const [stashMenu, setStashMenu] = React.useState<{ x: number; y: number; s: Stash } | null>(null);
  const [branchMenu, setBranchMenu] = React.useState<{ x: number; y: number; ref: string } | null>(null);
  const allRefs = React.useMemo(() => rows.flatMap((r) => r.commit.refs), [rows]);
  // SPEC-233 · detail commit: toggle tree/flat + diff per-file (modal, reuse DiffView).
  const [detailView, setDetailView] = React.useState<"list" | "tree">("list");
  // SPEC-385 · tab ketiga `preview` untuk .md. Permukaan ini SUDAH modal, jadi pratinjaunya
  // tab — bukan DocPreviewModal di atas modal (Escape jadi ambigu, dua backdrop menumpuk).
  const [fileDiff, setFileDiff] = React.useState<{ path: string; sha: string; from?: string; data: ReviewFile | null; tab: "diff" | "source" | "preview" } | null>(null);
  const openFileDiff = React.useCallback((path: string, sha: string, from?: string) => {
    setFileDiff({ path, sha, from, data: null, tab: "diff" });
    const p = from ? api.ideCompareFile(projectId, from, sha, path) : api.ideCommitFile(projectId, sha, path);
    p.then((d) => setFileDiff((s) => (s && s.path === path ? { ...s, data: d } : s))).catch(() => {});
  }, [projectId]);
  // SPEC-233 · compare dua commit: Ctrl/Cmd-klik commit kedua. compareFrom = commit pertama.
  const [compareFrom, setCompareFrom] = React.useState<string | null>(null);
  const [compare, setCompare] = React.useState<{ from: string; to: string; changed: import("../api/client").ChangedFile[] } | null>(null);
  // SPEC-233 · find widget + center HEAD. rowRefs → scrollIntoView per sha.
  const rowRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const [findOpen, setFindOpen] = React.useState(false);
  const [find, setFind] = React.useState("");
  const [findIdx, setFindIdx] = React.useState(0);
  const scrollToSha = React.useCallback((sha: string) => {
    rowRefs.current.get(sha)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  const findHits = React.useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [] as string[];
    return rows.filter((r) => {
      const c = r.commit;
      return c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.sha.toLowerCase().startsWith(q)
        || c.refs.some((x) => x.toLowerCase().includes(q)) || c.tags.some((x) => x.toLowerCase().includes(q));
    }).map((r) => r.commit.sha);
  }, [find, rows]);
  const gotoHit = React.useCallback((idx: number) => {
    if (!findHits.length) return;
    const i = ((idx % findHits.length) + findHits.length) % findHits.length;
    setFindIdx(i); scrollToSha(findHits[i]!);
  }, [findHits, scrollToSha]);
  const centerHead = React.useCallback(() => {
    const r = rows.find((x) => x.commit.refs.includes(current));
    if (r) scrollToSha(r.commit.sha);
  }, [rows, current, scrollToSha]);
  // SPEC-233 · kontrol tampilan: filter branch, show/hide remote/tag (refetch), muted & style (client).
  // SPEC-351 · `limit` ikut di sini supaya perubahan opsi me-reset jendela ke halaman pertama dalam
  // SATU update state — kalau limit hidup di state terpisah, ganti filter memicu dua fetch (jendela
  // lama lalu jendela reset).
  const [gopts, setGopts] = React.useState<{ branch: string; showRemote: boolean; showTags: boolean; limit: number }>(
    { branch: "", showRemote: true, showTags: true, limit: PAGE });
  const setView = React.useCallback((patch: Partial<typeof gopts>) => setGopts((o) => ({ ...o, ...patch, limit: PAGE })), []);
  const [muted, setMuted] = React.useState(true);
  const [style, setStyle] = React.useState<"rounded" | "angular">("rounded");
  const localBranches = React.useMemo(() => [...new Set(rows.flatMap((r) => r.commit.refs).filter((x) => !x.startsWith("origin/")))].sort(), [rows]);
  // SPEC-233 · preferensi dari CONFIG_REGISTRY grup gitGraph (ADR-0049): warna/emoji/markdown/issue/avatar.
  const [cfg, setCfg] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    api.getConfig().then((r) => {
      const m: Record<string, string> = {};
      for (const e of r.entries) { const v = (e as { value?: string | null }).value; if (e.key.startsWith("gitGraph.") && v != null) m[e.key] = v; }
      setCfg(m);
      if (m["gitGraph.style"]) setStyle(m["gitGraph.style"] === "angular" ? "angular" : "rounded");
      if (m["gitGraph.muteMergeCommits"]) setMuted(m["gitGraph.muteMergeCommits"] !== "0");
      // SPEC-351 · sengaja BUKAN `setView`: ini inisialisasi preferensi, bukan perubahan pilihan
      // manusia. `getConfig` bisa balas setelah operator sempat memuat halaman berikutnya, dan
      // reset jendela di sini akan menariknya balik ke 200 tanpa sebab.
      setGopts((o) => ({ ...o, showRemote: m["gitGraph.showRemoteBranches"] !== "0", showTags: m["gitGraph.showTags"] !== "0" }));
    }).catch(() => {});
  }, []);
  const palette = React.useMemo(() => {
    const c = cfg["gitGraph.colours"]?.split(",").map((s) => s.trim()).filter(Boolean);
    return c && c.length ? c : COLORS;
  }, [cfg]);
  const msgOpts = { emoji: cfg["gitGraph.emoji"] !== "0", markdown: cfg["gitGraph.markdown"] !== "0", issuePattern: cfg["gitGraph.issueLinkPattern"] || undefined };
  const fetchAvatars = cfg["gitGraph.fetchAvatars"] === "1";
  const onRowClick = React.useCallback((e: React.MouseEvent, sha: string) => {
    if (e.metaKey || e.ctrlKey) {
      if (!compareFrom) { setCompareFrom(sha); return; }
      if (compareFrom !== sha) { api.ideCompare(projectId, compareFrom, sha).then((c) => { setCompare(c); setDetail(null); }).catch(() => {}); }
      setCompareFrom(null); return;
    }
    api.ideCommit(projectId, sha).then(setDetail).catch(() => {});
  }, [projectId, compareFrom]);

  // SPEC-245 · `silent` = live-refresh (poll): jangan flip ke loading/error supaya
  // graph yang sudah tampil tak berkedip/tertutup StateBlock tiap tick, dan kegagalan
  // poll transien tak menghapus data yang ada.
  const load = React.useCallback((silent = false) => {
    if (!silent) setState("loading");
    api.ideGraph(projectId, gopts.limit, { branches: gopts.branch ? [gopts.branch] : undefined, showRemote: gopts.showRemote ? undefined : false, showTags: gopts.showTags ? undefined : false })
      // SPEC-351 · git memotong tepat di `--max-count`, jadi "balasan sepenuh yang diminta" =
      // "kemungkinan masih ada lanjutannya". Halaman berikutnya yang balas lebih sedikit
      // menutup sendiri penandanya — tak perlu hitungan total yang mahal.
      .then((g) => { setRows(computeLanes(g.commits)); setCurrent(g.current); setTotal(g.total ?? 0); setHasMore(g.commits.length >= gopts.limit); setState("ready"); })
      .catch(() => { if (!silent) setState("error"); })
      .finally(() => setPaging(false));
    api.ideStatus(projectId).then(setStatus).catch(() => { if (!silent) setStatus(null); });
    api.ideStashes(projectId).then(setStashes).catch(() => { if (!silent) setStashes([]); });
  }, [projectId, gopts]);
  // SPEC-351 · penambahan halaman dimuat DIAM: user sedang berdiri di kaki daftar, mengganti
  // baris yang sudah tampil dengan StateBlock "Memuat…" akan melempar posisi gulirnya.
  const pagingRef = React.useRef(false);
  React.useEffect(() => { load(pagingRef.current); pagingRef.current = false; }, [load]);
  const more = React.useCallback(() => {
    if (pagingRef.current) return;
    pagingRef.current = true; setPaging(true);
    setGopts((o) => ({ ...o, limit: o.limit + PAGE }));
  }, []);
  // SPEC-351 · baris penutup jadi sentinel: begitu ia tergulir masuk viewport, halaman
  // berikutnya dimuat sendiri — "scroll ke bawah sampai tahu history" tanpa klik beruntun.
  // Tombolnya tetap ada untuk lingkungan tanpa IntersectionObserver dan untuk pilihan manual.
  React.useEffect(() => {
    const el = moreRef.current;
    if (!el || !hasMore || paging || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, paging, more]);
  // SPEC-245 · live-refresh: perubahan repo yang datang di luar aksi sinkron sendiri
  // (sesi claude yang commit, konflik merge/rebase diselesaikan di Terminal, commit
  // dari terminal) muncul tanpa refresh manual. Poll diam tiap POLL_MS; berhenti saat
  // tab browser tak aktif (hemat) dan saat unmount.
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  // SPEC-233 · shortcut: Esc tutup panel; Ctrl/Cmd-F find; Ctrl/Cmd-H center HEAD.
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFileDiff(null); setCompare(null); setCompareFrom(null); setFindOpen(false); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setFindOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h") { e.preventDefault(); centerHead(); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [centerHead]);

  function openMenu(e: React.MouseEvent, c: GraphCommit) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, c });
  }
  // SPEC-245 · `() => load()` (bukan `.then(load)`) supaya nilai resolve tak tersalur ke param `silent`.
  async function act(op: GitOp) { setMenu(null); await onRunGit(op).then(() => load()).catch(() => {}); }
  // SPEC-229 · merge lewat jalur isolasi; sukses → reload graph, konflik/error ditangani onMerge (toast/nav).
  async function mergeAct(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    setMenu(null); await onMerge(source, opts).then(() => load()).catch(() => {});
  }
  // SPEC-233 · rebase/pull/drop lewat jalur isolasi (pola merge); konflik/error ditangani host (toast/nav).
  async function rebaseAct(onto: string) { setMenu(null); setBranchMenu(null); await onRebase(onto).then(() => load()).catch(() => {}); }
  async function pullAct(source: string) { setMenu(null); setBranchMenu(null); await onPull(source).then(() => load()).catch(() => {}); }
  async function dropAct(sha: string) { setMenu(null); await onDrop(sha).then(() => load()).catch(() => {}); }
  // SPEC-233 · Create PR (buka URL provider dari origin) & Create archive (unduh git archive).
  function prAct(branch: string) {
    setBranchMenu(null);
    api.idePrUrl(projectId, branch).then((r) => { if (r.url) window.open(r.url, "_blank", "noreferrer"); else window.alert("origin bukan github/gitlab/bitbucket — tak bisa buat PR otomatis"); }).catch(() => {});
  }
  function archiveAct(ref: string) { setBranchMenu(null); window.open(api.ideArchiveUrl(projectId, ref), "_blank"); }

  const maxLanes = Math.max(1, ...rows.map((r) => r.width));
  const allEdges = React.useMemo(() => rowEdges(rows), [rows]);

  if (state === "loading") return <StateBlock kind="loading" title="Memuat git graph…" />;
  if (state === "error") return <StateBlock kind="error" title="Gagal memuat git graph" action={load} />;
  if (rows.length === 0) return <StateBlock kind="empty" icon="git-commit" title="Belum ada commit" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: (detail || compare) ? "1fr 340px" : "1fr", gap: 16, alignItems: "start" }}>
      <Card padding={0}>
        {/* SPEC-233 · find widget (Ctrl/Cmd-F) + center HEAD (Ctrl/Cmd-H) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border-hair)" }}>
          {findOpen ? (
            <>
              <Icon name="search" size={13} color="var(--text-subtle)" />
              <input autoFocus value={find} onChange={(e) => { setFind(e.target.value); setFindIdx(0); }}
                onKeyDown={(e) => { if (e.key === "Enter") gotoHit(findIdx + (e.shiftKey ? -1 : 1)); if (e.key === "Escape") setFindOpen(false); }}
                placeholder="mis. auto-merge, 3a3e7e0, atau hanoman/spec-490"
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 12.5, fontFamily: "var(--font-ui)", color: "var(--text-body)" }} />
              <span style={{ fontSize: 11, color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }}>
                {findHits.length ? `${findIdx + 1}/${findHits.length}` : find ? "0" : ""}
              </span>
              <Button size="sm" variant="ghost" leftIcon="chevron-up" disabled={!findHits.length} onClick={() => gotoHit(findIdx - 1)} />
              <Button size="sm" variant="ghost" leftIcon="chevron-down" disabled={!findHits.length} onClick={() => gotoHit(findIdx + 1)} />
              <Button size="sm" variant="ghost" leftIcon="x" onClick={() => { setFindOpen(false); setFind(""); }} />
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" leftIcon="search" onClick={() => setFindOpen(true)}>Cari</Button>
              <Button size="sm" variant="ghost" leftIcon="crosshair" onClick={centerHead}>HEAD</Button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>⌘F cari · ⌘H center HEAD</span>
            </>
          )}
        </div>
        {/* SPEC-233 · kontrol tampilan: filter branch, show/hide remote/tag, muted, style */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "6px 12px", borderBottom: "1px solid var(--border-hair)", fontSize: 12 }}>
          <select value={gopts.branch} onChange={(e) => setView({ branch: e.target.value })}
            style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", color: "var(--text-body)" }}>
            <option value="">semua branch</option>
            {localBranches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "var(--text-muted)" }}>
            <input type="checkbox" checked={gopts.showRemote} onChange={(e) => setView({ showRemote: e.target.checked })} /> remote
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "var(--text-muted)" }}>
            <input type="checkbox" checked={gopts.showTags} onChange={(e) => setView({ showTags: e.target.checked })} /> tag
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "var(--text-muted)" }}>
            <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> muted merge
          </label>
          <button onClick={() => setStyle((s) => (s === "rounded" ? "angular" : "rounded"))}
            style={{ border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", cursor: "pointer", padding: "3px 8px", fontSize: 12, color: "var(--text-muted)" }}>
            style: {style}
          </button>
        </div>
        {/* SPEC-233 · baris uncommitted changes (lingkaran terbuka) di puncak bila working tree kotor */}
        {status && !status.clean && (() => {
          const n = status.staged.length + status.unstaged.length + status.untracked.length;
          const first = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
          return (
            <div onClick={() => { if (first) onOpenFile(first, ""); }}
              onContextMenu={(e) => { e.preventDefault(); setUncMenu({ x: e.clientX, y: e.clientY }); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bone-100)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              style={{ display: "flex", alignItems: "center", gap: 10, height: ROW_H, padding: "0 12px",
                cursor: "pointer", borderBottom: "1px solid var(--border-hair)" }}>
              <svg width={maxLanes * LANE_W} height={ROW_H} style={{ flex: "0 0 auto" }}>
                <circle cx={LANE_W / 2} cy={ROW_H / 2} r={DOT} fill="none" stroke={laneColor(0)} strokeWidth={1.5} />
              </svg>
              <span style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--text-muted)", flex: 1 }}>
                Uncommitted changes · {n} file
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 auto", width: 88, textAlign: "right" }}>working tree</span>
              <span style={{ width: 40, flex: "0 0 auto" }} />
            </div>
          );
        })()}
        {/* SPEC-233 · stash sebagai chip di puncak; klik-kanan → apply/pop/drop/branch/copy */}
        {stashes.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "6px 12px", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="hn-eyebrow" style={{ marginRight: 4 }}>stash</span>
            {stashes.map((s) => (
              <span key={s.ref} title={s.message}
                onClick={(e) => { e.stopPropagation(); setStashMenu({ x: e.clientX, y: e.clientY, s }); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setStashMenu({ x: e.clientX, y: e.clientY, s }); }}
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "2px 8px", borderRadius: 999,
                  cursor: "pointer", background: "var(--ink-100, #e7e6e1)", color: "var(--text-muted)", flex: "0 0 auto" }}>
                {s.ref}: {s.message.length > 40 ? s.message.slice(0, 40) + "…" : s.message}
              </span>
            ))}
          </div>
        )}
        {rows.map((r, i) => {
          const c = r.commit;
          const isHead = c.refs.includes(current);
          const sel = detail?.sha === c.sha;
          const hit = findHits.includes(c.sha);
          const activeHit = findHits[findIdx] === c.sha;
          const rowBg = sel ? "var(--brass-100)" : activeHit ? "var(--brass-200, #ecd9ac)" : hit ? "var(--bone-100)" : "transparent";
          return (
            <div key={c.sha} ref={(el) => { if (el) rowRefs.current.set(c.sha, el); }}
              onClick={(e) => onRowClick(e, c.sha)}
              onContextMenu={(e) => openMenu(e, c)}
              title={compareFrom ? "Ctrl/Cmd-klik untuk bandingkan dengan commit pertama" : "Ctrl/Cmd-klik untuk mulai compare"}
              onMouseEnter={(e) => { if (!sel && !activeHit) e.currentTarget.style.background = "var(--bone-100)"; }}
              onMouseLeave={(e) => { if (!sel && !activeHit) e.currentTarget.style.background = hit ? "var(--bone-100)" : "transparent"; }}
              style={{ display: "flex", alignItems: "center", gap: 10, height: ROW_H, padding: "0 12px",
                cursor: "pointer", borderBottom: "1px solid var(--border-hair)",
                background: rowBg }}>
              <RowSvg row={r} edges={allEdges[i] ?? []} maxLanes={maxLanes} style={style} palette={palette} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                {c.refs.map((ref) => (
                  <span key={ref} title="branch — klik-kanan untuk aksi"
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setBranchMenu({ x: e.clientX, y: e.clientY, ref }); }}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "1px 6px", cursor: "context-menu",
                    borderRadius: 999, background: isHead && ref === current ? "var(--brass-500)" : "var(--brass-100)",
                    color: isHead && ref === current ? "#fff" : "var(--brass-700)", flex: "0 0 auto" }}>{ref}</span>
                ))}
                {/* SPEC-233 · tag = pill terpisah (warna leaf, ikon tag); klik-kanan → menu tag */}
                {c.tags.map((t) => (
                  <span key={`tag:${t}`} title="tag — klik-kanan untuk aksi"
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setTagMenu({ x: e.clientX, y: e.clientY, tag: t }); }}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "1px 6px 1px 4px", borderRadius: 999,
                      display: "inline-flex", alignItems: "center", gap: 3, background: "var(--leaf-100, #e6efe9)",
                      color: "var(--leaf-600, #3b7a57)", flex: "0 0 auto" }}>⌂{t}</span>
                ))}
                <span style={{ fontSize: 12.5, color: muted && c.parents.length > 1 ? "var(--text-subtle)" : "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msgOpts.emoji ? emojify(c.subject) : c.subject}</span>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
                flex: "0 0 auto", width: 88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{c.author}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
                flex: "0 0 auto", width: 40, textAlign: "right" }}>{rel(c.at)}</span>
            </div>
          );
        })}
        {/* SPEC-351 · baris penutup: daftar tak pernah lagi berhenti tanpa kabar. Menyatakan
            berapa yang dimuat, apakah masih ada lanjutannya, dan jadi sentinel auto-load. */}
        <div ref={moreRef} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          padding: "9px 12px", borderTop: "1px solid var(--border-hair)" }}>
          <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
            {/* SPEC-523 · sisa dinyatakan. "200 commit dimuat" tak memberi tahu apakah tersisa
                3 atau 30.000 — dan itulah yang membuat plafonnya terbaca sebagai bug. */}
            {total > 0 ? `${rows.length} dari ${total} commit` : `${rows.length} commit dimuat`}
            {hasMore ? "" : " · seluruh history"}
          </span>
          {hasMore && (
            <Button size="sm" variant="ghost" leftIcon="chevron-down" disabled={paging} onClick={more}>
              {paging ? "Memuat…" : `Muat ${PAGE} lagi`}
            </Button>
          )}
        </div>
      </Card>

      {detail && (
        <Card padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="hn-eyebrow">commit {detail.sha.slice(0, 8)}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {detail.signed && <Badge tone="ok" size="sm">signed</Badge>}
              <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => void navigator.clipboard?.writeText(detail.sha)}>Hash</Button>
              <Button size="sm" variant="ghost" leftIcon="x" onClick={() => setDetail(null)}>Tutup</Button>
            </div>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 600, marginBottom: 4 }}>{msgOpts.emoji ? emojify(detail.subject) : detail.subject}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-subtle)", marginBottom: 6 }}>
            {fetchAvatars && detail.authorEmail && <img src={gravatarUrl(detail.authorEmail, 20)} width={18} height={18} alt="" style={{ borderRadius: 999 }} />}
            <span>{detail.author}{detail.committer && detail.committer !== detail.author ? ` · committed by ${detail.committer}` : ""}</span>
          </div>
          {detail.body && <pre style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, whiteSpace: "pre-wrap", color: "var(--text-muted)", marginBottom: 10 }}>{renderMessage(detail.body, msgOpts)}</pre>}
          <div className="hn-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{detail.changed.length} file berubah</span>
            {(["list", "tree"] as const).map((v) => (
              <button key={v} aria-label={v} onClick={() => setDetailView(v)} style={{ display: "flex", padding: 3, border: "none",
                cursor: "pointer", borderRadius: 4, background: detailView === v ? "var(--brass-100)" : "transparent" }}>
                <Icon name={v === "list" ? "list" : "folder-tree"} size={13} color={detailView === v ? "var(--brass-700)" : "var(--text-subtle)"} />
              </button>
            ))}
          </div>
          {detailView === "tree"
            ? buildFileTree(detail.changed.map((f) => f.path)).map((nd) =>
                <TreeRow key={nd.path} node={nd} selected={fileDiff?.path ?? ""} onSelect={(p) => openFileDiff(p, detail.sha)} defaultOpen />)
            : detail.changed.map((f) => (
              <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px" }}>
                <Badge tone={f.status === "A" ? "ok" : f.status === "D" ? "err" : "warn"} size="sm">{f.status}</Badge>
                <button onClick={() => openFileDiff(f.path, detail.sha)} title="lihat diff" style={{ flex: 1, minWidth: 0, textAlign: "left",
                  border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11.5,
                  color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</button>
                <Icon name="git-commit" size={12} color="var(--text-subtle)" title="view at revision"
                  onClick={() => onOpenFile(f.path, detail.sha)} style={{ cursor: "pointer" }} />
                <Icon name="external-link" size={12} color="var(--text-subtle)" title="open (working tree)"
                  onClick={() => onOpenFile(f.path, "")} style={{ cursor: "pointer" }} />
                <Icon name="copy" size={12} color="var(--text-subtle)" title="copy path"
                  onClick={() => void navigator.clipboard?.writeText(f.path)} style={{ cursor: "pointer" }} />
              </div>
            ))}
        </Card>
      )}

      {compare && (
        <Card padding={16}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="hn-eyebrow">compare {compare.from.slice(0, 7)} … {compare.to.slice(0, 7)}</span>
            <Button size="sm" variant="ghost" leftIcon="x" onClick={() => setCompare(null)}>Tutup</Button>
          </div>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{compare.changed.length} file berbeda</div>
          {compare.changed.length === 0 && <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>Tak ada perbedaan.</div>}
          {compare.changed.map((f) => (
            <div key={f.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px" }}>
              <Badge tone={f.status === "A" ? "ok" : f.status === "D" ? "err" : "warn"} size="sm">{f.status}</Badge>
              <button onClick={() => openFileDiff(f.path, compare.to, compare.from)} style={{ flex: 1, minWidth: 0, textAlign: "left",
                border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11.5,
                color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</button>
            </div>
          ))}
        </Card>
      )}

      {compareFrom && (
        <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 140,
          background: "var(--brass-500)", color: "#fff", padding: "6px 14px", borderRadius: 999, fontSize: 12.5,
          boxShadow: "var(--shadow-pop, 0 6px 24px rgba(0,0,0,.15))", display: "flex", alignItems: "center", gap: 10 }}>
          Compare dari {compareFrom.slice(0, 7)} — Ctrl/Cmd-klik commit kedua
          <button onClick={() => setCompareFrom(null)} style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", fontWeight: 700 }}>✕</button>
        </div>
      )}

      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.c, current, act, mergeAct, rebaseAct, dropAct)} />}
      {tagMenu && <Menu x={tagMenu.x} y={tagMenu.y} onClose={() => setTagMenu(null)} items={[
        { label: `Hapus tag ${tagMenu.tag} (local)`, run: () => { setTagMenu(null); void act({ op: "delete-tag", name: tagMenu.tag }); } },
        { label: `Hapus tag ${tagMenu.tag} (local + origin)`, run: () => { setTagMenu(null); void act({ op: "delete-tag", name: tagMenu.tag, remote: true }); } },
        { label: "Push tag ke origin", run: () => { setTagMenu(null); void act({ op: "push-tag", name: tagMenu.tag }); } },
        { label: "Copy nama tag", run: () => { setTagMenu(null); void navigator.clipboard?.writeText(tagMenu.tag); } },
      ]} />}
      {uncMenu && <Menu x={uncMenu.x} y={uncMenu.y} onClose={() => setUncMenu(null)} items={[
        // SPEC-233 · aksi baris uncommitted. reset --hard & clean ireversibel → gate force via act.
        { label: "Stash perubahan…", run: () => { setUncMenu(null); const m = window.prompt("Pesan stash (opsional):") || undefined; void act({ op: "stash", message: m, includeUntracked: true }); } },
        { label: "Reset working tree (mixed — unstage)", run: () => { setUncMenu(null); void act({ op: "reset-worktree", mode: "mixed" }); } },
        { label: "Reset working tree (hard — buang semua)", run: () => { setUncMenu(null); void act({ op: "reset-worktree", mode: "hard" }); } },
        { label: "Clean untracked", run: () => { setUncMenu(null); void act({ op: "clean", directories: true }); } },
      ]} />}
      {stashMenu && <Menu x={stashMenu.x} y={stashMenu.y} onClose={() => setStashMenu(null)} items={[
        { label: "Apply (jaga stash)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-apply", ref: s.ref }); } },
        { label: "Pop (apply + buang)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-pop", ref: s.ref }); } },
        { label: "Drop (buang stash)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-drop", ref: s.ref }); } },
        { label: "Buat branch dari stash…", run: () => { const s = stashMenu.s; setStashMenu(null); const name = window.prompt("Nama branch baru:"); if (name) void act({ op: "stash-branch", ref: s.ref, name }); } },
        { label: "Copy nama stash", run: () => { const s = stashMenu.s; setStashMenu(null); void navigator.clipboard?.writeText(s.ref); } },
      ]} />}
      {branchMenu && <Menu x={branchMenu.x} y={branchMenu.y} onClose={() => setBranchMenu(null)}
        items={branchMenuItems(branchMenu.ref, current, allRefs, act, mergeAct, rebaseAct, pullAct, prAct, archiveAct)} />}

      {/* SPEC-233 · modal diff satu file di commit (reuse DiffView), tab Diff|Source */}
      {fileDiff && (
        <div onClick={() => setFileDiff(null)} style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(0,0,0,.35)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          {/* SPEC-393 · `fill` meneruskan rantai flex ke pembungkus anak `Card` juga; dengan
              `style` saja pembungkus itu tetap `display: block` dan badan modal menggantung
              setinggi isinya lalu terpotong `maxHeight: 86vh` + `overflow: hidden`.
              `flex: 0 1 auto` mengembalikan default yang ditimpa `fill`: overlay ini flex
              ber-arah BARIS, jadi `flex-grow: 1` bawaan `fill` melebarkan panel mengisi layar
              (terukur 900 → 1464 px). Di Docs/IDE hal ini tak terjadi — kartunya grid item. */}
          <Card padding={0} fill onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ width: "min(900px, 92vw)", maxHeight: "86vh", flex: "0 1 auto" }}>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-hair)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {fileDiff.path} <span style={{ color: "var(--text-subtle)" }}>@ {fileDiff.sha.slice(0, 8)}</span>
              </span>
              <div style={{ display: "flex", gap: 2, background: "var(--bone-100)", borderRadius: "var(--radius-pill)", padding: 2 }}>
                {(isMarkdownPath(fileDiff.path)
                  ? (["diff", "source", "preview"] as const)
                  : (["diff", "source"] as const)
                ).map((t) => (
                  <button key={t} onClick={() => setFileDiff((s) => (s ? { ...s, tab: t } : s))} style={{ padding: "4px 12px", border: "none",
                    cursor: "pointer", borderRadius: "var(--radius-pill)", fontSize: 12, textTransform: "capitalize",
                    background: fileDiff.tab === t ? "var(--surface-card)" : "transparent",
                    color: fileDiff.tab === t ? "var(--text-strong)" : "var(--text-muted)", fontWeight: fileDiff.tab === t ? 600 : 400 }}>{t}</button>
                ))}
              </div>
              {/* SPEC-385 · ADR-0078 · pratinjau baru wajib bisa dibawa pergi sebagai .md/.pdf */}
              {isMarkdownPath(fileDiff.path) && !fileDiff.data?.binary && fileDiff.data?.content != null && (
                <DocDownload href={(f) => (fileDiff.from
                  ? api.ideCompareFileDownloadUrl(projectId, fileDiff.from, fileDiff.sha, fileDiff.path, f)
                  : api.ideCommitFileDownloadUrl(projectId, fileDiff.sha, fileDiff.path, f))} />
              )}
              <Button size="sm" variant="ghost" leftIcon="x" onClick={() => setFileDiff(null)}>Tutup</Button>
            </div>
            <div data-testid="gitgraph-file-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "10px 0" }}>
              {!fileDiff.data ? <StateBlock kind="loading" title="Memuat diff…" hint={fileDiff.path} />
                : fileDiff.data.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" />
                : fileDiff.tab === "diff" ? <DiffView diff={fileDiff.data.diff ?? ""} emptyHint="File tak berubah di commit ini." />
                : fileDiff.tab === "preview"
                  ? <div style={{ padding: "0 16px" }}>
                      <MarkdownView text={fileDiff.data.content ?? ""} name={fileDiff.path} />
                    </div>
                : <pre style={{ margin: 0, padding: "0 16px", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6,
                    whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)" }}>{fileDiff.data.content ?? "(kosong / dihapus)"}</pre>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
