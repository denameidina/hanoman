/* GitGraph — DAG commit read + aksi (SPEC-182). Lane dihitung computeLanes (nol dep).
   Baris = grid [svg lane | subject | refs | meta]; klik = detail; klik-kanan = context-menu. */
import React from "react";
import { Card, Button, Checkbox, StateBlock, Badge, Icon, DocDownload, MarkdownView, isMarkdownPath, Tabs, LocalOverflow, Modal, Input, Field, useCoarsePointer, useResponsiveTier, LiveConnectionBadge, useConfirm, type ConfirmOptions } from "../ds";
import { api, ApiError, type GraphCommit, type CommitDetail, type GitOp, type RepoStatus, type Stash, type ReviewFile } from "../api/client";
import { useLiveTopic } from "../api/live";
import { computeLanes, rowEdges, type GraphRow, type Edge } from "./git-graph";
import { buildFileTree, TreeRow, TreeRoot } from "./file-tree";
import { DiffView } from "./diff-view";
import { emojify, renderMessage, gravatarUrl } from "./git-graph-render";
import { failureMessage } from "../lib/report-error";
import { Menu, type MenuItem } from "./ide-menu";
import "./styles/ide.css";

type Toast = (msg: string, tone: "ok" | "warn" | "err" | "info", icon?: string) => void;

// Audit UI/UX 2026-10 · input teks (nama branch/tag/pesan) lewat Modal DS, bukan window.prompt.
// `second` menambah field kedua + pilihan dorong (dipakai dialog tag). Penutupan selalu lewat
// `onClose`; submit kosong dicegah, tak ada promise yang menggantung.
type Ask = {
  title: string; eyebrow?: string; label: string; initial?: string; placeholder?: string; submit: string;
  second?: { label: string; placeholder?: string; hint?: string; pushLabel: string };
  onSubmit: (value: string, extra?: { message: string; push: boolean }) => void;
};

function GitAskDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [value, setValue] = React.useState(ask.initial ?? "");
  const [message, setMessage] = React.useState("");
  const [push, setPush] = React.useState(false);
  const ok = value.trim().length > 0;
  const submit = () => {
    if (!ok) return;
    onClose();
    ask.onSubmit(value.trim(), ask.second ? { message: message.trim(), push } : undefined);
  };
  return (
    <Modal open title={ask.title} eyebrow={ask.eyebrow} onClose={onClose} width={460} footer={<>
      <Button size="sm" variant="ghost" onClick={onClose}>Batal</Button>
      <Button size="sm" leftIcon="check" disabled={!ok} onClick={submit}>{ask.submit}</Button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={ask.label}>
          <Input size="sm" autoFocus value={value} aria-label={ask.label} placeholder={ask.placeholder}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)} className="hn-ide-input-full" />
        </Field>
        {ask.second && (<>
          <Field label={ask.second.label} hint={ask.second.hint}>
            <Input size="sm" value={message} aria-label={ask.second.label} placeholder={ask.second.placeholder}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)} className="hn-ide-input-full" />
          </Field>
          <Checkbox checked={push} onChange={setPush} label={ask.second.pushLabel} />
        </>)}
      </form>
    </Modal>
  );
}

// Label operasi untuk pesan galat ("Gagal reset branch: …"), bukan nama enum git mentah.
const OP_LABEL: Partial<Record<GitOp["op"], string>> = {
  checkout: "checkout", branch: "membuat branch", merge: "merge", "cherry-pick": "cherry-pick", revert: "revert",
  "delete-branch": "menghapus branch", reset: "reset", tag: "membuat tag", "delete-tag": "menghapus tag",
  "push-tag": "push tag", "reset-worktree": "reset working tree", clean: "membersihkan berkas untracked",
  stash: "stash", "stash-apply": "apply stash", "stash-pop": "pop stash", "stash-drop": "drop stash",
  "stash-branch": "membuat branch dari stash", "rename-branch": "mengganti nama branch",
  "push-branch": "push branch", fetch: "fetch",
};

/** Daftar nama berkas untuk dampak konfirmasi: tiga pertama, sisanya dihitung. */
function fileList(names: string[]): string {
  const head = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${head} dan ${names.length - 3} lainnya` : head;
}

const LANE_W = 14, ROW_H = 30, DOT = 4;
// SPEC-879 · lebar minimum region baris: subject 238 + author 88 + tanggal 40 + aksi ⋮ 44 + gap &
// padding 50. Di bawah ini kolom subject yang `flex: 1` runtuh ke 0px dan pill ref (yang
// `flex: 0 0 auto`) meluber menimpa kolom author — terukur 200 tombol subject `0×44` di 390px.
// Di ≤640px ide.css mengurangi lantai ini sebesar 148px: penulis dan kolom tanggal samping dilepas (tanggal
// pindah ke baris kecil di bawah subjek, `.hn-git-text`).
const GRAPH_ROW_MIN = 460;
// Lantai lebar kolom subject (160px) ada di `.hn-git-subject` (ide.css) dan hanya berlaku di desktop: di
// pointer kasar atau ≤767px aturan `button:not(...)` app.css (0,1,1) menimpanya ke 44px. Pill ref `flex: 0 0 auto`
// memakan kolom fleksibel lebih dulu, jadi di ponsel lebar subjek = sisa setelah pill (lihat ide.css).
// SPEC-245 · kadens live-refresh git graph. SPEC-908 · tinggal kadens FALLBACK; jalur
// normalnya langganan berparameter di `/events/ws`.
const POLL_MS = 4000;
const PAGE = 200;     // SPEC-351 · besar satu halaman commit; jendela tumbuh kelipatan ini
// Palet bawaan: enam CSS variable (brass, leaf, clay, ink, plum, rust), nilainya di ide.css. Palet dari
// config menimpa lewat --lane per elemen. Lane dibedakan juga oleh bentuk simpul (merge = berongga).
const COLORS = ["var(--graph-lane-0)", "var(--graph-lane-1)", "var(--graph-lane-2)", "var(--graph-lane-3)", "var(--graph-lane-4)", "var(--graph-lane-5)"];
const laneColor = (i: number, palette: string[] = COLORS) => palette[i % palette.length] ?? COLORS[0]!;
// Gaya dinamis lewat CSS variable (ide.css). Cast karena TS tak mengenal nama `--*` di CSSProperties.
const cssVars = (vars: Record<string, string | number>) => vars as React.CSSProperties;
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
function edgePath(e: Edge, style: "rounded" | "angular", height: number): string {
  const x = (i: number) => LANE_W / 2 + i * LANE_W;
  const y1 = e.half === "bottom" ? height / 2 : 0;
  const y2 = e.half === "top" ? height / 2 : height;
  const x1 = x(e.fromLane), x2 = x(e.toLane), ym = (y1 + y2) / 2;
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  return style === "angular"
    ? `M${x1} ${y1}V${ym}H${x2}V${y2}`
    : `M${x1} ${y1}C${x1} ${ym},${x2} ${ym},${x2} ${y2}`;
}

function RowSvg({ row, edges, maxLanes, style, palette, height }: { row: GraphRow; edges: Edge[]; maxLanes: number; style: "rounded" | "angular"; palette: string[]; height: number }) {
  const cx = LANE_W / 2 + row.lane * LANE_W;
  // Merge = simpul berongga: pembeda non-warna, supaya lane hijau-merah tetap terbaca tanpa warna.
  const merge = row.commit.parents.length > 1;
  return (
    <svg aria-hidden="true" width={maxLanes * LANE_W} height={height} className="hn-graph-lane">
      {edges.map((e, i) => (
        <path key={i} d={edgePath(e, style, height)} className="hn-graph-edge" data-lane={e.colorLane}
          style={cssVars({ "--lane": laneColor(e.colorLane, palette) })} />
      ))}
      <circle cx={cx} cy={height / 2} r={DOT} className="hn-graph-node" data-lane={row.lane}
        data-merge={merge ? "true" : undefined} style={cssVars({ "--lane": laneColor(row.lane, palette) })} />
    </svg>
  );
}

// Item context-menu untuk satu commit. Aksi hapus branch sadar local vs origin (SPEC-206):
// ref `origin/<b>` dikelompokkan dengan branch lokal `<b>` bila keduanya menunjuk commit ini.
// SPEC-229 · aksi merge lewat `merge` (jalur worktree isolasi + sesi claude), bukan `act`/onRunGit.
type MergeFn = (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => void;
type RefFn = (ref: string) => void; // rebase(onto) / drop(sha) / pull(source)
// Perbandingan dua commit tanpa Ctrl/Cmd-klik: item menu ⋮ (jalur keyboard, SPEC-847 audit a11y).
type CompareCtl = { from: string | null; mark: (sha: string | null) => void; compare: (from: string, to: string) => void };
type Ctl = {
  act: (op: GitOp) => void; merge: MergeFn; rebase: RefFn; drop: RefFn;
  ask: (a: Ask) => void;
  // Aksi destruktif: dialog DS dengan dampak terstruktur; `run` menahan dialog sampai selesai.
  guard: (o: ConfirmOptions, run: () => unknown) => void;
  cmp: CompareCtl;
  // Dampak reset hard / clean: berkas tak ter-commit dan berkas untracked saat ini.
  dirty: string[]; untracked: string[];
};
function menuItems(c: GraphCommit, current: string, ctl: Ctl): MenuItem[] {
  const { act, merge, rebase, drop, ask, guard, cmp } = ctl;
  const locals = c.refs.filter((r) => !r.startsWith("origin/"));
  const origins = c.refs.filter((r) => r.startsWith("origin/") && r !== "origin/HEAD").map((r) => r.slice("origin/".length));
  const names = [...new Set([...locals, ...origins])];
  const copy = (t: string) => { void navigator.clipboard?.writeText(t); };
  const sha7 = c.sha.slice(0, 7);
  const resetHardImpact = [
    `Commit di atas ${sha7} lepas dari branch ${current || "saat ini"}; pemulihannya hanya lewat reflog.`,
    ctl.dirty.length
      ? `Perubahan tak ter-commit di ${ctl.dirty.length} berkas dibuang: ${fileList(ctl.dirty)}.`
      : "Tak ada perubahan tak ter-commit yang ikut dibuang.",
  ];
  // Audit UI/UX 2026-10 (3H) · menu commit dikelompokkan, bukan >20 item datar. Urutannya: navigasi
  // paling sering, lalu cabang & tag, dan aksi yang menulis ulang riwayat (cherry-pick, revert,
  // reset, drop) di grup Lanjutan paling bawah. Reset hard & drop tetap lewat dialog dampak.
  const navigasi: MenuItem[] = [
    { label: `Checkout ${sha7}`, group: "Navigasi", run: () => act({ op: "checkout", ref: c.sha }) },
    { label: "Salin hash", group: "Navigasi", run: () => copy(c.sha) },
    { label: "Salin subject", group: "Navigasi", run: () => copy(c.subject) },
    // Perbandingan lewat menu: tandai commit pertama, lalu bandingkan dengan commit kedua.
    ...(cmp.from === null
      ? [{ label: "Tandai untuk dibandingkan", group: "Navigasi", run: () => cmp.mark(c.sha) }]
      : cmp.from === c.sha
        ? [{ label: "Batal tandai perbandingan", group: "Navigasi", run: () => cmp.mark(null) }]
        : [{ label: `Bandingkan dengan ${cmp.from.slice(0, 7)}`, group: "Navigasi", run: () => cmp.compare(cmp.from as string, c.sha) }]),
  ];
  const cabang: MenuItem[] = [
    { label: "Merge (fast-forward bila bisa)", group: "Cabang & tag", run: () => merge(c.sha) },
    { label: "Merge tanpa fast-forward", group: "Cabang & tag", run: () => merge(c.sha, { ff: "no-ff" }) },
    { label: "Merge fast-forward saja", group: "Cabang & tag", run: () => merge(c.sha, { ff: "ff-only" }) },
    // SPEC-233 · rebase current ke commit ini (isolasi + konflik → sesi claude)
    { label: "Rebase current → sini", group: "Cabang & tag", run: () => rebase(c.sha) },
    { label: "Buat branch di sini…", group: "Cabang & tag", run: () => ask({
      title: `Branch baru di ${sha7}`, label: "Nama branch baru", placeholder: "mis. fitur/login", submit: "Buat branch",
      onSubmit: (name) => { void act({ op: "branch", name, at: c.sha, checkout: true }); },
    }) },
    // SPEC-233 · buat tag di commit ini. Pesan kosong = lightweight; terisi = annotated.
    // Dorong ke origin adalah NILAI form (bukan izin), jadi ia checkbox di dialog — bukan confirm.
    { label: "Tambah tag…", group: "Cabang & tag", run: () => ask({
      title: `Tag baru di ${sha7}`, label: "Nama tag", placeholder: "mis. v1.2.0", submit: "Buat tag",
      second: { label: "Pesan (opsional)", placeholder: "mis. rilis stabil", hint: "Kosong = tag ringan tanpa pesan.", pushLabel: "Dorong tag ke origin" },
      onSubmit: (name, extra) => {
        void act({ op: "tag", name, message: extra?.message || undefined, at: c.sha, push: extra?.push ?? false });
      },
    }) },
    // Merge branch ini lalu hapus (local + origin bila ada). Hanya branch lokal selain yang aktif.
    ...locals.filter((r) => r !== current).map((r): MenuItem => ({
      label: `Merge ${r} lalu hapus (local${origins.includes(r) ? " + origin" : ""})`,
      group: "Cabang & tag",
      run: () => merge(r, { deleteBranch: r }),
    })),
    // Hapus mandiri per branch: local &/atau origin. Local tak boleh branch aktif; origin selalu boleh.
    ...names.flatMap((r): MenuItem[] => {
      const localOk = locals.includes(r) && r !== current, hasOrigin = origins.includes(r);
      const items: MenuItem[] = [];
      if (localOk && hasOrigin) items.push({ label: `Hapus ${r} (local + origin)`, group: "Cabang & tag", run: () => act({ op: "delete-branch", name: r, remote: true }) });
      if (localOk) items.push({ label: `Hapus ${r} (local)`, group: "Cabang & tag", run: () => act({ op: "delete-branch", name: r }) });
      if (hasOrigin) items.push({ label: `Hapus origin/${r}`, group: "Cabang & tag", run: () => act({ op: "delete-branch", name: r, local: false, remote: true }) });
      return items;
    }),
  ];
  const lanjutan: MenuItem[] = [
    { label: "Cherry-pick", group: "Lanjutan", run: () => act({ op: "cherry-pick", sha: c.sha }) },
    { label: "Revert", group: "Lanjutan", run: () => act({ op: "revert", sha: c.sha }) },
    // SPEC-233 · reset branch current ke commit ini (soft/mixed/hard). hard ireversibel → dialog dampak.
    { label: "Reset current → sini (soft)", group: "Lanjutan", run: () => act({ op: "reset", sha: c.sha, mode: "soft" }) },
    { label: "Reset current → sini (mixed)", group: "Lanjutan", run: () => act({ op: "reset", sha: c.sha, mode: "mixed" }) },
    { label: "Reset current → sini (hard)", group: "Lanjutan", run: () => guard({
      title: `Reset ${current || "branch"} ke ${sha7} secara hard?`, eyebrow: "Reset hard", tone: "danger", icon: "rotate-ccw",
      message: "Reset hard memindahkan branch dan membuang perubahan tak ter-commit.",
      impact: resetHardImpact, confirmLabel: "Reset hard",
    }, () => act({ op: "reset", sha: c.sha, mode: "hard" })) },
    { label: "Drop commit…", group: "Lanjutan", run: () => guard({
      title: `Drop commit ${sha7}?`, eyebrow: c.subject, tone: "danger", icon: "trash-2",
      message: "Commit ini dibuang dari riwayat branch.",
      impact: ["Riwayat branch ditulis ulang tanpa commit ini; pemulihannya hanya lewat reflog."],
      confirmLabel: "Drop commit",
    }, () => drop(c.sha)) },
  ];
  return [...navigasi, ...cabang, ...lanjutan];
}

// SPEC-233 · menu klik-kanan pada pill branch. Local vs origin dibedakan prefix `origin/`.
// Branch aktif (== current) hanya Rename/Push/Copy (tak boleh checkout/merge/hapus diri sendiri).
function branchMenuItems(ref: string, current: string, allRefs: string[], act: (op: GitOp) => void, merge: MergeFn, rebase: RefFn, pull: RefFn, pr: RefFn, archive: RefFn, ask: (a: Ask) => void): MenuItem[] {
  const isOrigin = ref.startsWith("origin/");
  const name = isOrigin ? ref.slice("origin/".length) : ref;
  const copy = () => { void navigator.clipboard?.writeText(ref); };
  if (isOrigin) return [
    { label: `Checkout ${ref}`, run: () => act({ op: "checkout", ref }) },
    { label: `Merge ${ref} → current`, run: () => merge(ref) },
    { label: `Pull ${name} → current`, run: () => pull(name) },
    { label: "Buat Pull Request", run: () => pr(name) },
    { label: "Buat arsip", run: () => archive(ref) },
    { label: `Hapus origin/${name}`, run: () => act({ op: "delete-branch", name, local: false, remote: true }) },
    { label: "Salin nama branch", run: copy },
  ];
  const self = ref === current;
  const hasOrigin = allRefs.includes(`origin/${name}`);
  const items: MenuItem[] = [];
  if (!self) items.push({ label: `Checkout ${ref}`, run: () => act({ op: "checkout", ref }) });
  items.push({ label: "Ganti nama…", run: () => ask({
    title: `Ganti nama ${ref}`, label: "Nama baru", initial: ref, placeholder: "mis. fitur/login-ulang", submit: "Ganti nama",
    onSubmit: (to) => { if (to !== ref) void act({ op: "rename-branch", from: ref, to }); },
  }) });
  items.push({ label: "Push ke origin", run: () => act({ op: "push-branch", name: ref, setUpstream: true }) });
  if (!self) items.push({ label: `Merge ${ref} → current`, run: () => merge(ref) });
  if (!self) items.push({ label: `Rebase current → ${ref}`, run: () => rebase(ref) });
  items.push({ label: "Buat Pull Request", run: () => pr(ref) });
  items.push({ label: "Buat arsip", run: () => archive(ref) });
  if (!self) {
    items.push({ label: hasOrigin ? `Hapus ${ref} (local + origin)` : `Hapus ${ref} (local)`, run: () => act({ op: "delete-branch", name: ref, remote: hasOrigin }) });
    if (hasOrigin) items.push({ label: `Hapus ${ref} (local saja)`, run: () => act({ op: "delete-branch", name: ref }) });
  }
  items.push({ label: "Salin nama branch", run: copy });
  return items;
}

export function GitGraph({ projectId, onRunGit, onMerge, onRebase, onPull, onDrop, onOpenFile, onToast, onOpenCabang }:
  { projectId: string; onRunGit: (op: GitOp) => Promise<unknown>;
    onMerge: (source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) => Promise<void>;
    onRebase: (onto: string) => Promise<void>;
    onPull: (source: string) => Promise<void>;
    onDrop: (sha: string) => Promise<void>;
    onOpenFile: (path: string, ref: string) => void; onToast?: Toast;
    /** Tautan "Kelola di Cabang": satu-satunya tempat hapus branch utama ada di tab Cabang. */
    onOpenCabang?: () => void }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  // Dialog DS untuk input teks (form kecil) dan konfirmasi destruktif — keduanya dirender di bawah.
  const [ask, setAsk] = React.useState<Ask | null>(null);
  const { confirm, dialog } = useConfirm();
  const toastErr = React.useCallback((action: string, err: unknown) => {
    // 409 = working tree kotor; IdeScreen sudah membuka dialog "Paksa" untuk itu, jadi tak perlu toast ganda.
    if (err instanceof ApiError && err.status === 409) return;
    onToast?.(failureMessage(action, err), "err", "x-circle");
  }, [onToast]);
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
  const [panel, setPanel] = React.useState<"graph" | "detail">("graph");
  const tier = useResponsiveTier();
  const coarsePointer = useCoarsePointer();
  const [menu, setMenu] = React.useState<{ x: number; y: number; c: GraphCommit; anchor?: HTMLElement } | null>(null);
  const [tagMenu, setTagMenu] = React.useState<{ x: number; y: number; tag: string; anchor?: HTMLElement } | null>(null);
  const [status, setStatus] = React.useState<RepoStatus | null>(null);
  const [uncMenu, setUncMenu] = React.useState<{ x: number; y: number; anchor?: HTMLElement } | null>(null);
  const [stashes, setStashes] = React.useState<Stash[]>([]);
  const [stashMenu, setStashMenu] = React.useState<{ x: number; y: number; s: Stash; anchor?: HTMLElement } | null>(null);
  const [branchMenu, setBranchMenu] = React.useState<{ x: number; y: number; ref: string; anchor?: HTMLElement } | null>(null);
  const allRefs = React.useMemo(() => rows.flatMap((r) => r.commit.refs), [rows]);
  // SPEC-233 · detail commit: toggle tree/flat + diff per-file (modal, reuse DiffView).
  const [detailView, setDetailView] = React.useState<"list" | "tree">("list");
  // SPEC-385 · tab ketiga `preview` untuk .md. Permukaan ini SUDAH modal, jadi pratinjaunya
  // tab — bukan DocPreviewModal di atas modal (Escape jadi ambigu, dua backdrop menumpuk).
  const [fileDiff, setFileDiff] = React.useState<{ path: string; sha: string; from?: string; data: ReviewFile | null; err?: string; tab: "diff" | "source" | "preview" } | null>(null);
  const openFileDiff = React.useCallback((path: string, sha: string, from?: string) => {
    setFileDiff({ path, sha, from, data: null, tab: "diff" });
    const p = from ? api.ideCompareFile(projectId, from, sha, path) : api.ideCommitFile(projectId, sha, path);
    p.then((d) => setFileDiff((s) => (s && s.path === path ? { ...s, data: d } : s)))
      .catch((e: unknown) => setFileDiff((s) => (s && s.path === path ? { ...s, err: failureMessage("memuat diff", e) } : s)));
  }, [projectId]);
  // SPEC-233 · compare dua commit: Ctrl/Cmd-klik commit kedua. compareFrom = commit pertama.
  const [compareFrom, setCompareFrom] = React.useState<string | null>(null);
  const [compare, setCompare] = React.useState<{ from: string; to: string; changed: import("../api/client").ChangedFile[] } | null>(null);
  const compareCommits = React.useCallback((from: string, to: string) => {
    setCompareFrom(null);
    api.ideCompare(projectId, from, to)
      .then((c) => { setCompare(c); setDetail(null); setPanel("detail"); })
      .catch((e: unknown) => toastErr("membandingkan commit", e));
  }, [projectId, toastErr]);
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
  const [showView, setShowView] = React.useState(false);   // disclosure "Tampilan" (tak persisten)
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
      // Audit 2026-10 · objek `gopts` baru TANPA perubahan nilai memicu `load` ulang → daftar
      // berkedip ke "Memuat…" saat mount (baris yang sedang diklik pun lepas). Hanya ganti bila beda.
      setGopts((o) => {
        const showRemote = m["gitGraph.showRemoteBranches"] !== "0", showTags = m["gitGraph.showTags"] !== "0";
        return o.showRemote === showRemote && o.showTags === showTags ? o : { ...o, showRemote, showTags };
      });
    }).catch(() => { /* preferensi opsional: gagal dibaca = pakai default bawaan, bukan galat operator */ });
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
      if (compareFrom !== sha) compareCommits(compareFrom, sha);
      setCompareFrom(null); return;
    }
    api.ideCommit(projectId, sha).then((next) => { setDetail(next); setPanel("detail"); })
      .catch((e: unknown) => toastErr("membuka commit", e));
  }, [projectId, compareFrom, compareCommits, toastErr]);

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
  // SPEC-908 · perubahan repo yang datang di luar aksi sinkron sendiri (sesi claude yang commit,
  // konflik merge/rebase diselesaikan di Terminal) kini DIDORONG lewat langganan `/events/ws`,
  // bukan poll 4 dtk per klien. `apply` sengaja tak menyentuh `state`/`paging`: pembaruan yang
  // datang tak boleh membuat graph berkedip maupun melempar posisi gulir operator (SPEC-245/351).
  // Satu `git log` dihitung per PARAMETER yang benar-benar ditonton dan dibagi semua tab yang
  // melihat project & opsi yang sama; POLL_MS tinggal kadens fallback.
  useLiveTopic({
    topic: "git",
    params: {
      projectId, limit: gopts.limit, branch: gopts.branch,
      showRemote: gopts.showRemote, showTags: gopts.showTags,
    },
    apply: (m) => {
      setRows(computeLanes(m.graph.commits));
      setCurrent(m.graph.current);
      setTotal(m.graph.total ?? 0);
      setHasMore(m.graph.commits.length >= gopts.limit);
      setState("ready");
      setStatus(m.status);
      setStashes(m.stashes);
    },
    refetch: () => load(true), pollMs: POLL_MS,
  });
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
    setMenu({ x: e.clientX, y: e.clientY, c, anchor: e.currentTarget as HTMLElement });
  }
  // SPEC-245 · `() => load()` (bukan `.then(load)`) supaya nilai resolve tak tersalur ke param `silent`.
  // Galat SELALU tampil sebagai toast (kecuali 409, yang sudah dijawab dialog "Paksa" di host).
  async function act(op: GitOp) {
    setMenu(null);
    try { await onRunGit(op); load(); }
    catch (e) { toastErr(`menjalankan ${OP_LABEL[op.op] ?? op.op}`, e); }
  }
  // SPEC-229 · merge lewat jalur isolasi; sukses → reload graph. Galat sudah ditampilkan host
  // (IdeScreen.mergeGraph memberi toast lalu melempar lagi), jadi di sini hanya tak memuat ulang.
  async function mergeAct(source: string, opts?: { ff?: "no-ff" | "ff-only"; deleteBranch?: string }) {
    setMenu(null);
    try { await onMerge(source, opts); load(); } catch { /* sudah ditampilkan host */ }
  }
  // SPEC-233 · rebase/pull/drop lewat jalur isolasi (pola merge); galat juga sudah ditampilkan host.
  async function rebaseAct(onto: string) {
    setMenu(null); setBranchMenu(null);
    try { await onRebase(onto); load(); } catch { /* sudah ditampilkan host */ }
  }
  async function pullAct(source: string) {
    setMenu(null); setBranchMenu(null);
    try { await onPull(source); load(); } catch { /* sudah ditampilkan host */ }
  }
  async function dropAct(sha: string) {
    setMenu(null);
    try { await onDrop(sha); load(); } catch { /* sudah ditampilkan host */ }
  }
  // Konfirmasi destruktif: `run` berjalan SETELAH dikonfirmasi, dan dialog tetap terbuka + busy
  // sampai selesai (submit ganda mustahil). Setiap aksi di sini menangani galatnya sendiri.
  const guard = React.useCallback((o: ConfirmOptions, run: () => unknown) => {
    confirm({ ...o, run: async () => { await run(); } })
      .catch((e: unknown) => toastErr("menjalankan aksi", e));
  }, [confirm, toastErr]);
  // SPEC-233 · Create PR (buka URL provider dari origin) & Create archive (unduh git archive).
  function prAct(branch: string) {
    setBranchMenu(null);
    api.idePrUrl(projectId, branch)
      .then((r) => { if (r.url) window.open(r.url, "_blank", "noreferrer"); else onToast?.("origin bukan github/gitlab/bitbucket — tak bisa buat PR otomatis", "warn", "git-branch"); })
      .catch((e: unknown) => toastErr("membuat Pull Request", e));
  }
  function archiveAct(ref: string) { setBranchMenu(null); window.open(api.ideArchiveUrl(projectId, ref), "_blank"); }
  // Konteks yang dibutuhkan builder menu commit (lihat `Ctl`).
  const ctl: Ctl = {
    act, merge: mergeAct, rebase: rebaseAct, drop: dropAct, ask: setAsk, guard,
    cmp: { from: compareFrom, mark: setCompareFrom, compare: compareCommits },
    dirty: [...(status?.staged ?? []), ...(status?.unstaged ?? [])],
    untracked: status?.untracked ?? [],
  };

  const maxLanes = Math.max(1, ...rows.map((r) => r.width));
  const allEdges = React.useMemo(() => rowEdges(rows), [rows]);

  // Audit 2026-10 · keadaan memuat/galat/kosong MENGGANTI daftar saja. Dulu `return` dini membuang
  // seluruh komponen — filter bar dan tombol cari ikut hilang, dan "Coba lagi" tak punya konteks.
  // `action` tanpa argumen: StateBlock meneruskan MouseEvent, dan `load(silent)` akan membacanya.
  const body = state === "loading" ? <StateBlock kind="loading" title="Memuat git graph…" />
    : state === "error" ? <StateBlock kind="error" title="Gagal memuat git graph" action={() => load()} />
    : rows.length === 0 ? <StateBlock kind="empty" icon="git-commit" title="Belum ada commit" />
    : null;

  const narrow = tier !== "desktop";
  const graphRowHeight = tier === "mobile" || coarsePointer ? 44 : ROW_H;
  const hasDetail = !!(detail || compare);
  return (<>
    {narrow && hasDetail && (
      <Tabs aria-label="Panel Git Graph" variant="pill" value={panel} onChange={(next) => setPanel(next as "graph" | "detail")}
        tabs={[{ value: "graph", label: "Graph" }, { value: "detail", label: "Detail" }]} />
    )}
    <div className="hn-git-graph-layout" style={cssVars({ "--git-cols": narrow ? "minmax(0, 1fr)" : hasDetail ? "minmax(0, 1fr) 340px" : "minmax(0, 1fr)" })}>
      <section data-panel="graph" aria-label="Graph" aria-hidden={narrow && hasDetail && panel !== "graph" ? "true" : "false"}
        hidden={narrow && hasDetail && panel !== "graph"} className="hn-git-panel">
      <Card padding={0}>
        {/* SPEC-233 · find widget (Ctrl/Cmd-F) + center HEAD (Ctrl/Cmd-H) */}
        <div className="hn-git-find">
          {findOpen ? (
            <>
              <Icon name="search" size={13} color="var(--text-subtle)" />
              <input autoFocus value={find} aria-label="Cari commit" onChange={(e) => { setFind(e.target.value); setFindIdx(0); }}
                onKeyDown={(e) => { if (e.key === "Enter") gotoHit(findIdx + (e.shiftKey ? -1 : 1)); if (e.key === "Escape") setFindOpen(false); }}
                placeholder="mis. auto-merge, 3a3e7e0, atau hanoman/spec-490"
                className="hn-git-find-input" />
              <span className="hn-git-find-count">
                {findHits.length ? `${findIdx + 1}/${findHits.length}` : find ? "0" : ""}
              </span>
              <Button size="sm" variant="ghost" leftIcon="chevron-up" aria-label="Hasil sebelumnya" disabled={!findHits.length} onClick={() => gotoHit(findIdx - 1)} />
              <Button size="sm" variant="ghost" leftIcon="chevron-down" aria-label="Hasil berikutnya" disabled={!findHits.length} onClick={() => gotoHit(findIdx + 1)} />
              <Button size="sm" variant="ghost" leftIcon="x" aria-label="Tutup pencarian" onClick={() => { setFindOpen(false); setFind(""); }} />
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" leftIcon="search" onClick={() => setFindOpen(true)}>Cari</Button>
              <Button size="sm" variant="ghost" leftIcon="crosshair" onClick={centerHead}>HEAD</Button>
              {/* Pintasan keyboard: disembunyikan lewat CSS di perangkat sentuh dan layar ≤640px (ide.css). */}
              <span className="hn-git-find-hint">⌘F cari · ⌘H ke HEAD</span>
            </>
          )}
        </div>
        {/* SPEC-233 · kontrol tampilan: filter branch, show/hide remote/tag, muted, style */}
        <div className="hn-ide-graph-bar">
          <select aria-label="Filter branch" value={gopts.branch} onChange={(e) => setView({ branch: e.target.value })}
            className="hn-git-branch-select">
            <option value="">semua branch</option>
            {/* Pilihan aktif tetap ada walau daftar branch belum termuat (mis. saat galat). */}
            {gopts.branch && !localBranches.includes(gopts.branch) && <option value={gopts.branch}>{gopts.branch}</option>}
            {localBranches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {/* SPEC-879 · `input` telanjang direntangkan aturan mobile `input { min-height:
              var(--touch-target) }` jadi kotak biru 44×44; `Checkbox` DS menaruh kotak 18×18 di
              DALAM area sentuh itu. */}
          <Button size="sm" variant="ghost" leftIcon="eye" aria-expanded={showView} aria-controls={showView ? "ide-graph-view" : undefined}
            onClick={() => setShowView((v) => !v)}>Tampilan</Button>
          <LiveConnectionBadge />
        </div>
        {/* Audit UI/UX 2026-10 (3H) · pengaturan tampilan disembunyikan di balik "Tampilan" (progressive
            disclosure): bar di atas hanya memuat filter dan status, bukan lima kontrol yang setara bobotnya. */}
        {showView && (
          <div id="ide-graph-view" role="group" aria-label="Tampilan graph" className="hn-ide-graph-view">
            <Checkbox checked={gopts.showRemote} onChange={(next) => setView({ showRemote: next })} label="remote" />
            <Checkbox checked={gopts.showTags} onChange={(next) => setView({ showTags: next })} label="tag" />
            <Checkbox checked={muted} onChange={(next) => setMuted(next)} label="redupkan merge" />
            <Button size="sm" variant="ghost" onClick={() => setStyle((s) => (s === "rounded" ? "angular" : "rounded"))}>
              Gaya: {style === "rounded" ? "lengkung" : "siku"}
            </Button>
          </div>
        )}
        {/* SPEC-233 · stash sebagai chip di puncak; klik-kanan → apply/pop/drop/branch/copy */}
        {stashes.length > 0 && (
          <div className="hn-git-stash-row">
            <span className="hn-eyebrow hn-git-stash-label">stash</span>
            {stashes.map((s) => (
              <button type="button" key={s.ref} title={s.message} aria-label={`Aksi ${s.ref}`}
                onClick={(e) => { e.stopPropagation(); setStashMenu({ x: e.clientX, y: e.clientY, s, anchor: e.currentTarget }); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setStashMenu({ x: e.clientX, y: e.clientY, s, anchor: e.currentTarget }); }}
                className="hn-git-stash-chip">
                {s.ref}: {s.message.length > 40 ? s.message.slice(0, 40) + "…" : s.message}
              </button>
            ))}
          </div>
        )}
        {/* SPEC-879 · baris commit tak bisa reflow: lane SVG-nya posisional dan kolomnya berlebar
            tetap, jadi ia memiliki scroller mendatarnya sendiri — dengan lebar minimum, karena anak
            BLOK selalu selebar induknya dan scroller tanpa konten yang lebih lebar tak pernah bisa
            digulir (terukur 362 = 362 di 390px). Widget cari, kontrol tampilan, chip stash, dan
            baris penutup sengaja DI LUAR: yang terakhir sentinel IntersectionObserver SPEC-351
            yang menempel pada `<main>` yang menggulir tegak. */}
        {body ?? (<>
        <LocalOverflow className="hn-git-scroll" data-testid="ide-graph-rows">
          <div role="list" aria-label="Riwayat commit" className="hn-git-rows"
            style={cssVars({ "--graph-min-w": `${maxLanes * LANE_W + GRAPH_ROW_MIN}px`, "--row-h": `${graphRowHeight}px` })}>
            {/* SPEC-233 · baris uncommitted changes (lingkaran terbuka) di puncak bila working tree kotor */}
            {status && !status.clean && (() => {
              const n = status.staged.length + status.unstaged.length + status.untracked.length;
              const first = status.unstaged[0] ?? status.untracked[0] ?? status.staged[0];
              return (
                <div role="listitem" className="hn-ide-graph-row" onClick={() => { if (first) onOpenFile(first, ""); }}
                  onContextMenu={(e) => { e.preventDefault(); setUncMenu({ x: e.clientX, y: e.clientY, anchor: e.currentTarget }); }}>
                  {/* Lane SVG hanya gambar: maknanya ikut di teks baris (subject, merge, HEAD). */}
                  <svg aria-hidden="true" width={maxLanes * LANE_W} height={graphRowHeight} className="hn-graph-lane">
                    <circle cx={LANE_W / 2} cy={graphRowHeight / 2} r={DOT} className="hn-graph-node hn-graph-node--open" />
                  </svg>
                  <button type="button" onClick={(event) => { event.stopPropagation(); if (first) onOpenFile(first, ""); }}
                    className={first ? "hn-git-uncommitted" : "hn-git-uncommitted hn-git-uncommitted--static"}>
                    Perubahan belum di-commit · {n} berkas
                  </button>
                  <button type="button" className="hn-graph-action" aria-label="Aksi working tree"
                    onClick={(e) => { e.stopPropagation(); setUncMenu({ x: e.clientX, y: e.clientY, anchor: e.currentTarget }); }}>⋮</button>
                  <span className="hn-git-wt">working tree</span>
                  <span className="hn-git-wt-gap" />
                </div>
              );
            })()}
            {rows.map((r, i) => {
              const c = r.commit;
              const isHead = c.refs.includes(current);
              const sel = detail?.sha === c.sha;
              const hit = findHits.includes(c.sha);
              const activeHit = findHits[findIdx] === c.sha;
              // Warna latar hanya untuk keadaan terpilih/ditemukan; hover ditangani CSS (`.hn-ide-graph-row:hover`),
              // jadi baris biasa tak membawa latar inline yang menimpanya.
              // Latar hanya untuk keadaan terpilih/ditemukan (prioritas sama seperti sebelumnya: terpilih > aktif > ditemukan).
              const rowState = sel ? "is-sel" : activeHit ? "is-active" : hit ? "is-hit" : "";
              // Teks subjek yang tampil; juga `title` bila subjek terpotong (ellipsis di kolomnya).
              const subject = msgOpts.emoji ? emojify(c.subject) : c.subject;
              return (
                <div key={c.sha} ref={(el) => { if (el) rowRefs.current.set(c.sha, el); }} role="listitem"
                  className={rowState ? `hn-ide-graph-row ${rowState}` : "hn-ide-graph-row"}
                  onClick={(e) => onRowClick(e, c.sha)}
                  onContextMenu={(e) => openMenu(e, c)}
                  title={compareFrom ? "Ctrl/Cmd-klik untuk bandingkan dengan commit pertama" : "Ctrl/Cmd-klik untuk mulai compare"}>
                  <RowSvg row={r} edges={allEdges[i] ?? []} maxLanes={maxLanes} style={style} palette={palette} height={graphRowHeight} />
                  <div className="hn-git-main">
                    {c.refs.map((ref) => (
                      <button type="button" key={ref} title={isHead && ref === current ? `${ref} · branch aktif (HEAD) — pilih untuk aksi` : `${ref} · branch — pilih untuk aksi`}
                        aria-label={`Aksi branch ${ref}`}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBranchMenu({ x: e.clientX, y: e.clientY, ref, anchor: e.currentTarget }); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setBranchMenu({ x: e.clientX, y: e.clientY, ref, anchor: e.currentTarget }); }}
                        className={isHead && ref === current ? "hn-git-ref hn-git-ref--head" : "hn-git-ref"}>
                        <span className="hn-git-ref-text">{ref}</span>
                      </button>
                    ))}
                    {/* SPEC-233 · tag = pill terpisah (warna leaf, ikon tag); klik-kanan → menu tag */}
                    {c.tags.map((t) => (
                      <button type="button" key={`tag:${t}`} title={`${t} · tag — pilih untuk aksi`} aria-label={`Aksi tag ${t}`}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTagMenu({ x: e.clientX, y: e.clientY, tag: t, anchor: e.currentTarget }); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setTagMenu({ x: e.clientX, y: e.clientY, tag: t, anchor: e.currentTarget }); }}
                        className="hn-git-tag"><span className="hn-git-ref-text">⌂{t}</span></button>
                    ))}
                    {/* Merge dinyatakan TEKS, bukan hanya redup warnanya (audit a11y). */}
                    {c.parents.length > 1 && <span className="hn-git-merge">merge</span>}
                    {/* P2-3 · di ≤640 subjek dan tanggal berbagi satu kolom teks: tanggal turun ke baris kecil
                        di bawah subjek (`.hn-git-date-under`), dan kolom tanggal samping dilepas. Di atas 640
                        `.hn-git-text` tak membuat kotak (display: contents), jadi susunannya tetap seperti dulu. */}
                    <span className="hn-git-text">
                      <button type="button" aria-label={`Buka commit ${c.sha}`} title={subject}
                        onClick={(event) => { event.stopPropagation(); onRowClick(event, c.sha); }}
                        className={muted && c.parents.length > 1 ? "hn-git-subject hn-git-subject--muted" : "hn-git-subject"}>
                        {subject}
                      </button>
                      <span className="hn-git-date-under">{rel(c.at)}</span>
                    </span>
                  </div>
                  <button type="button" className="hn-graph-action" aria-label={`Aksi commit ${c.sha}`}
                    onClick={(e) => { e.stopPropagation(); openMenu(e, c); }}>⋮</button>
                  <span className="hn-git-author">{c.author}</span>
                  <span className="hn-git-date">{rel(c.at)}</span>
                </div>
              );
            })}
          </div>
        </LocalOverflow>
        {/* SPEC-351 · baris penutup: daftar tak pernah lagi berhenti tanpa kabar. Menyatakan
            berapa yang dimuat, apakah masih ada lanjutannya, dan jadi sentinel auto-load. */}
        <div ref={moreRef} className="hn-git-more">
          <span className="hn-git-more-count">
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
        </>)}
      </Card>
      </section>

      {detail && (
        <section data-panel="detail" aria-label="Detail" aria-hidden={narrow && panel !== "detail" ? "true" : "false"}
          hidden={narrow && panel !== "detail"} className="hn-git-panel">
        <Card padding={16}>
          <div className="hn-git-head">
            <span className="hn-eyebrow">commit {detail.sha.slice(0, 8)}</span>
            <div className="hn-git-cluster">
              {detail.signed && <Badge tone="ok" size="sm">signed</Badge>}
              <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => void navigator.clipboard?.writeText(detail.sha)}>Hash</Button>
              <Button size="sm" variant="ghost" leftIcon="x" onClick={() => { setDetail(null); setPanel("graph"); }}>Tutup</Button>
            </div>
          </div>
          <div className="hn-git-detail-title">{msgOpts.emoji ? emojify(detail.subject) : detail.subject}</div>
          <div className="hn-git-detail-meta">
            {fetchAvatars && detail.authorEmail && <img src={gravatarUrl(detail.authorEmail, 20)} width={18} height={18} alt="" className="hn-git-avatar" />}
            <span>{detail.author}{detail.committer && detail.committer !== detail.author ? ` · committed by ${detail.committer}` : ""}</span>
          </div>
          {detail.body && <pre className="hn-git-detail-body">{renderMessage(detail.body, msgOpts)}</pre>}
          <div className="hn-eyebrow hn-git-changed-head">
            <span className="hn-grow">{detail.changed.length} file berubah</span>
            {(["list", "tree"] as const).map((v) => (
              <button key={v} type="button" aria-label={v === "list" ? "Tampilan daftar" : "Tampilan pohon"} aria-pressed={detailView === v}
                onClick={() => setDetailView(v)} className="hn-git-view-btn">
                <Icon name={v === "list" ? "list" : "folder-tree"} size={13} color={detailView === v ? "var(--brass-700)" : "var(--text-subtle)"} />
              </button>
            ))}
          </div>
          {detailView === "tree"
            ? <TreeRoot label="Berkas commit" nodes={buildFileTree(detail.changed.map((f) => f.path))}>
                {buildFileTree(detail.changed.map((f) => f.path)).map((nd) =>
                  <TreeRow key={nd.path} node={nd} selected={fileDiff?.path ?? ""} onSelect={(p) => openFileDiff(p, detail.sha)} defaultOpen />)}
              </TreeRoot>
            : detail.changed.map((f) => (
              <div key={f.path} className="hn-git-file">
                <Badge tone={f.status === "A" ? "ok" : f.status === "D" ? "err" : "warn"} size="sm">{f.status}</Badge>
                <button onClick={() => openFileDiff(f.path, detail.sha)} title="lihat diff" className="hn-git-file-path">{f.path}</button>
                {/* Ikon-ikon ini dulu <Icon onClick> — tak bisa difokus lewat keyboard. Sekarang tombol. */}
                <button type="button" className="hn-graph-action" aria-label={`Lihat ${f.path} pada commit ini`}
                  title="Lihat pada revisi ini" onClick={() => onOpenFile(f.path, detail.sha)}>
                  <Icon name="git-commit" size={12} color="var(--text-subtle)" />
                </button>
                <button type="button" className="hn-graph-action" aria-label={`Buka ${f.path} dari working tree`}
                  title="Buka dari working tree" onClick={() => onOpenFile(f.path, "")}>
                  <Icon name="external-link" size={12} color="var(--text-subtle)" />
                </button>
                <button type="button" className="hn-graph-action" aria-label={`Salin path ${f.path}`}
                  title="Salin path" onClick={() => void navigator.clipboard?.writeText(f.path)}>
                  <Icon name="copy" size={12} color="var(--text-subtle)" />
                </button>
              </div>
            ))}
        </Card>
        </section>
      )}

      {compare && (
        <section data-panel="detail" aria-label="Detail" aria-hidden={narrow && panel !== "detail" ? "true" : "false"}
          hidden={narrow && panel !== "detail"} className="hn-git-panel">
        <Card padding={16}>
          <div className="hn-git-head">
            <span className="hn-eyebrow">compare {compare.from.slice(0, 7)} … {compare.to.slice(0, 7)}</span>
            <Button size="sm" variant="ghost" leftIcon="x" onClick={() => { setCompare(null); setPanel("graph"); }}>Tutup</Button>
          </div>
          <div className="hn-eyebrow hn-git-count">{compare.changed.length} file berbeda</div>
          {compare.changed.length === 0 && <div className="hn-git-empty">Tak ada perbedaan.</div>}
          {compare.changed.map((f) => (
            <div key={f.path} className="hn-git-file">
              <Badge tone={f.status === "A" ? "ok" : f.status === "D" ? "err" : "warn"} size="sm">{f.status}</Badge>
              <button onClick={() => openFileDiff(f.path, compare.to, compare.from)} className="hn-git-file-path">{f.path}</button>
            </div>
          ))}
        </Card>
        </section>
      )}

      {compareFrom && (
        <div className="hn-git-compare-pill">
          Compare dari {compareFrom.slice(0, 7)} — Ctrl/Cmd-klik commit kedua
          <button type="button" aria-label="Batalkan perbandingan" onClick={() => setCompareFrom(null)} className="hn-git-compare-close">✕</button>
        </div>
      )}

      {menu && <Menu x={menu.x} y={menu.y} returnFocus={menu.anchor} onClose={() => setMenu(null)} items={menuItems(menu.c, current, ctl)} />}
      {tagMenu && <Menu x={tagMenu.x} y={tagMenu.y} returnFocus={tagMenu.anchor} onClose={() => setTagMenu(null)} items={[
        { label: `Hapus tag ${tagMenu.tag} (local)`, run: () => { setTagMenu(null); void act({ op: "delete-tag", name: tagMenu.tag }); } },
        { label: `Hapus tag ${tagMenu.tag} (local + origin)`, run: () => { setTagMenu(null); void act({ op: "delete-tag", name: tagMenu.tag, remote: true }); } },
        { label: "Push tag ke origin", run: () => { setTagMenu(null); void act({ op: "push-tag", name: tagMenu.tag }); } },
        { label: "Salin nama tag", run: () => { setTagMenu(null); void navigator.clipboard?.writeText(tagMenu.tag); } },
      ]} />}
      {uncMenu && <Menu x={uncMenu.x} y={uncMenu.y} returnFocus={uncMenu.anchor} onClose={() => setUncMenu(null)} items={[
        // SPEC-233 · aksi baris uncommitted. Reset hard & clean ireversibel → dialog dampak (guard).
        { label: "Stash perubahan…", run: () => { setUncMenu(null); setAsk({
          title: "Stash perubahan", label: "Pesan stash (opsional)", placeholder: "mis. WIP login", submit: "Stash",
          onSubmit: (m) => { void act({ op: "stash", message: m || undefined, includeUntracked: true }); },
        }); } },
        { label: "Reset working tree (mixed — unstage)", run: () => { setUncMenu(null); void act({ op: "reset-worktree", mode: "mixed" }); } },
        { label: "Reset working tree (hard — buang semua)", run: () => { setUncMenu(null); guard({
          title: "Buang semua perubahan tak ter-commit?", eyebrow: "Reset hard", tone: "danger", icon: "rotate-ccw",
          message: "Berkas yang diubah atau di-stage kembali ke isi commit HEAD.",
          impact: [ctl.dirty.length
            ? `${ctl.dirty.length} berkas diubah kembali: ${fileList(ctl.dirty)}. Isinya tak bisa dikembalikan.`
            : "Tak ada berkas tracked yang berubah.",
          "Berkas untracked tidak tersentuh oleh reset ini."],
          confirmLabel: "Buang perubahan",
        }, () => act({ op: "reset-worktree", mode: "hard" })); } },
        { label: "Hapus berkas untracked…", run: () => { setUncMenu(null); guard({
          title: "Hapus berkas untracked?", eyebrow: "Clean untracked", tone: "danger", icon: "trash-2",
          message: "Berkas dan folder yang tak pernah di-add ke git dihapus permanen.",
          impact: [ctl.untracked.length
            ? `${ctl.untracked.length} berkas/folder dihapus: ${fileList(ctl.untracked)}.`
            : "Tak ada berkas untracked.",
          "Tidak ada di riwayat git, sehingga tak bisa dipulihkan."],
          confirmLabel: "Hapus berkas",
        }, () => act({ op: "clean", directories: true })); } },
      ]} />}
      {stashMenu && <Menu x={stashMenu.x} y={stashMenu.y} returnFocus={stashMenu.anchor} onClose={() => setStashMenu(null)} items={[
        { label: "Apply (jaga stash)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-apply", ref: s.ref }); } },
        { label: "Pop (apply + buang)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-pop", ref: s.ref }); } },
        { label: "Drop (buang stash)", run: () => { const s = stashMenu.s; setStashMenu(null); void act({ op: "stash-drop", ref: s.ref }); } },
        { label: "Buat branch dari stash…", run: () => { const s = stashMenu.s; setStashMenu(null); setAsk({
          title: `Branch dari ${s.ref}`, label: "Nama branch baru", placeholder: "mis. fitur/dari-stash", submit: "Buat branch",
          onSubmit: (name) => { void act({ op: "stash-branch", ref: s.ref, name }); },
        }); } },
        { label: "Salin nama stash", run: () => { const s = stashMenu.s; setStashMenu(null); void navigator.clipboard?.writeText(s.ref); } },
      ]} />}
      {branchMenu && <Menu x={branchMenu.x} y={branchMenu.y} returnFocus={branchMenu.anchor} onClose={() => setBranchMenu(null)}
        items={[...branchMenuItems(branchMenu.ref, current, allRefs, act, mergeAct, rebaseAct, pullAct, prAct, archiveAct, setAsk),
          // "Satu tempat utama" hapus branch = tab Cabang; menu ini hanya menautkan ke sana.
          ...(onOpenCabang ? [{ label: "Kelola di tab Cabang", run: () => { setBranchMenu(null); onOpenCabang(); } }] : [])]} />}
      {ask && <GitAskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog}

      {/* SPEC-233 · modal diff satu file di commit (reuse DiffView), tab Diff|Source */}
      {fileDiff && (
        <Modal open title={`Diff ${fileDiff.path}`} eyebrow={`@ ${fileDiff.sha.slice(0, 8)}`} width={900} fillHeight onClose={() => setFileDiff(null)}>
          <div className="hn-panel-flex hn-git-diff-body">
            <div className="hn-git-diff-bar">
              <div className="hn-git-diff-tabs">
                {(isMarkdownPath(fileDiff.path)
                  ? (["diff", "source", "preview"] as const)
                  : (["diff", "source"] as const)
                ).map((t) => (
                  <button key={t} onClick={() => setFileDiff((s) => (s ? { ...s, tab: t } : s))}
                    className={fileDiff.tab === t ? "hn-git-diff-tab hn-git-diff-tab--on" : "hn-git-diff-tab"}>{t}</button>
                ))}
              </div>
              {/* SPEC-385 · ADR-0078 · pratinjau baru wajib bisa dibawa pergi sebagai .md/.pdf */}
              {isMarkdownPath(fileDiff.path) && !fileDiff.data?.binary && fileDiff.data?.content != null && (
                <DocDownload href={(f) => (fileDiff.from
                  ? api.ideCompareFileDownloadUrl(projectId, fileDiff.from, fileDiff.sha, fileDiff.path, f)
                  : api.ideCommitFileDownloadUrl(projectId, fileDiff.sha, fileDiff.path, f))} />
              )}
            </div>
            <div data-testid="gitgraph-file-scroll" className="hn-git-diff-scroll">
              {!fileDiff.data ? (fileDiff.err
                ? <StateBlock kind="error" title="Diff belum bisa dibuka" hint={fileDiff.err} />
                : <StateBlock kind="loading" title="Memuat diff…" hint={fileDiff.path} />)
                : fileDiff.data.binary ? <StateBlock kind="empty" icon="file" title="Berkas biner" />
                : fileDiff.tab === "diff" ? <DiffView diff={fileDiff.data.diff ?? ""} emptyHint="File tak berubah di commit ini." />
                : fileDiff.tab === "preview"
                  ? <div className="hn-git-md">
                      <MarkdownView text={fileDiff.data.content ?? ""} name={fileDiff.path} />
                    </div>
                : <pre className="hn-git-source">{fileDiff.data.content ?? "(kosong / dihapus)"}</pre>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  </>);
}
