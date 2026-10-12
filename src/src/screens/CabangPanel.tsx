/* Tab Cabang IDE (Audit UI/UX 2026-10 · Fase 3H) — branch dan worktree dalam SATU daftar.
   Menggantikan BranchesPanel + WorktreesPanel. Aturannya tetap:
   - branch yang sedang dipakai worktree tampil SEBAGAI baris worktree-nya (satu entri per checkout);
   - branch tanpa worktree tampil sebagai baris branch;
   - pembersihan massal menulis dampaknya di satu dialog: sesi yang ditutup, commit yang hilang,
     berkas kotor, branch ikut dihapus; branch belum ter-merge menuntut ketikan ulang (ADR-0121);
   - satu-satunya tempat hapus branch utama ada di sini. Menu commit di Riwayat hanya menautkan ke sini.
   Semua data turunan git dari server; tak ada yang dipersist (menghapus harus dipilih ulang). */
import React from "react";
import { Card, Button, Badge, Checkbox, Input, Select, StateBlock, useConfirm } from "../ds";
import { api, LOCK_LABEL, type UnusedBranch, type UnusedReport, type BranchScope, type BranchDeleteResult,
  type WorktreeReport, type WorktreeView, type WorktreeStats, type WorktreeDeleteResult } from "../api/client";
import { relativeTime } from "../lib/time-format";
import { errorMessage } from "../lib/report-error";

const SCOPES: { value: BranchScope; label: string }[] = [
  { value: "both", label: "local + origin" },
  { value: "local", label: "local saja" },
  { value: "remote", label: "origin saja" },
];

type Status = "all" | "merged" | "unmerged";
const STATUSES: { value: Status; label: string }[] = [
  { value: "all", label: "semua status" },
  { value: "merged", label: "ter-merge saja" },
  { value: "unmerged", label: "belum ter-merge" },
];

// Repo besar: daftar penuh bisa ratusan baris. Batas ini bagian dari definisi "sedang tampak".
const PAGE = 100;

/** Satu baris daftar: worktree (dengan branch-nya bila ada) atau branch tanpa worktree. */
type Row = {
  key: string;               // "wt:<nama>" | "br:<nama>" — identitas pilihan & fokus
  name: string;
  kind: "worktree" | "branch";
  wt?: WorktreeView;
  br?: UnusedBranch;         // info merge & kunci: branch baris ini, atau branch worktree-nya bila diketahui
  deletable: boolean;
};

/** Hasil satu baris setelah pembersihan — dipisah per jenis supaya kegagalan branch tetap terbaca. */
type Outcome = { name: string; kind: Row["kind"]; ok: boolean; forced?: boolean; error?: string;
  branch?: { name: string; ok: boolean; error?: string } };

const rel = (iso: string | null | undefined): string => relativeTime(iso ?? "", Date.now()) || "—";
const size = (b: number | null): string => {
  if (b === null) return "—";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
};
const scopeOf = (b: UnusedBranch) => (b.local && b.remote ? "local + origin" : b.local ? "local" : "origin");
const deletableBranch = (b: UnusedBranch) => b.locks.length === 0;

export function CabangPanel({ projectId }: { projectId: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [branches, setBranches] = React.useState<UnusedReport | null>(null);
  const [wts, setWts] = React.useState<WorktreeReport | null>(null);
  const [stats, setStats] = React.useState<Record<string, WorktreeStats>>({});
  const [bases, setBases] = React.useState<string[]>([]);
  const [base, setBase] = React.useState("");
  const [scope, setScope] = React.useState<BranchScope>("both");
  const [status, setStatus] = React.useState<Status>("all");
  const [q, setQ] = React.useState("");
  const [shown, setShown] = React.useState(PAGE);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [showOpts, setShowOpts] = React.useState(false);   // progressive disclosure: base, cakupan, branch ikut
  // Audit 2026-10 · TIDAK dipersist: menghapus adalah tindakan yang harus dipilih ulang setiap kunjungan.
  const [withBranch, setWithBranch] = React.useState(false);
  const [results, setResults] = React.useState<Outcome[] | null>(null);
  const [focusKey, setFocusKey] = React.useState("");
  const { confirm, dialog } = useConfirm();

  const load = React.useCallback(() => {
    setState("loading");
    Promise.all([api.branchesUnused(projectId, base || undefined, "all"), api.worktrees(projectId)])
      .then(([b, w]) => { setBranches(b); setWts(w); setPicked(new Set()); setStats({}); setFocusKey(""); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId, base]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    api.listBranches(projectId)
      .then((r) => setBases([...new Set([...r.branches, ...r.remotes])].sort()))
      // Daftar base hanya pilihan tambahan: gagal dibaca = tinggal "base otomatis" (yang selalu ada).
      .catch(() => setBases([]));
  }, [projectId]);

  // Sinyal mahal dimuat MENYUSUL, satu worktree per giliran (`du` menelusuri seluruh pohon).
  const worktreeList = wts?.worktrees ?? [];
  React.useEffect(() => {
    if (!wts) return;
    let alive = true;
    void (async () => {
      for (const w of wts.worktrees) {
        if (!alive) return;
        const s = await api.worktreeStats(projectId, w.name).catch(() => null);
        if (alive && s) setStats((prev) => ({ ...prev, [w.name]: s }));
      }
    })();
    return () => { alive = false; };
  }, [wts, projectId]);

  // Worktree lebih dulu: branch-nya ikut tampil di baris worktree, bukan sebagai baris kedua.
  const branchList = branches?.branches ?? [];
  const byBranch = React.useMemo(() => new Map(branchList.map((b) => [b.name, b])), [branchList]);
  const rows = React.useMemo<Row[]>(() => {
    const attached = new Set<string>();
    const out: Row[] = [];
    for (const w of worktreeList) {
      if (w.branch) attached.add(w.branch);
      out.push({ key: `wt:${w.name}`, name: w.name, kind: "worktree", wt: w,
        br: w.branch ? byBranch.get(w.branch) : undefined, deletable: w.deletable });
    }
    for (const b of branchList) {
      if (attached.has(b.name)) continue;
      out.push({ key: `br:${b.name}`, name: b.name, kind: "branch", br: b, deletable: deletableBranch(b) });
    }
    return out;
  }, [worktreeList, branchList, byBranch]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const merged = r.br?.merged ?? null;
      const statusOk = status === "all" || (status === "merged" ? merged === true : merged === false);
      return statusOk && (!needle || r.name.toLowerCase().includes(needle));
    });
  }, [rows, status, q]);
  // Menyempitkan filter tak boleh menyisakan pilihan yang tak terlihat lagi.
  React.useEffect(() => { setShown(PAGE); setPicked(new Set()); }, [status, q]);

  const visible = filtered.slice(0, shown);
  const free = visible.filter((r) => r.deletable).map((r) => r.key);
  const allPicked = free.length > 0 && free.every((k) => picked.has(k));
  const toggle = (key: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const pickedRows = visible.filter((r) => picked.has(r.key));
  const anyWorktreeBranch = rows.some((r) => r.kind === "worktree" && r.deletable && r.wt?.branch);
  const orphans = rows.filter((r) => r.wt?.orphan);
  const collectible = orphans.filter((r) => r.deletable);
  const scopeLabel = SCOPES.find((s) => s.value === scope)!.label;

  /**
   * Konfirmasi pembersihan untuk `targets`. Statistik worktree dimuat ulang dulu, karena pekerjaan
   * bisa berubah sejak daftar dibuka; dampaknya disusun dari angka itu, bukan dari tampilan.
   */
  const ask = (targets: Row[], orphanOnly = false) => {
    if (targets.length === 0) return;
    void (async () => {
      const fetched: Record<string, WorktreeStats> = { ...stats };
      const wtRows = targets.filter((t) => t.kind === "worktree" && t.wt);
      const brRows = targets.filter((t) => t.kind === "branch" && t.br);
      for (const t of wtRows) {
        const s = await api.worktreeStats(projectId, t.name).catch(() => null);
        if (s) fetched[t.name] = s; else delete fetched[t.name];
      }
      setStats(fetched);

      const sessions = wtRows.filter((t) => t.wt!.session).length;
      const dirty = wtRows.reduce((n, t) => n + (fetched[t.name]?.dirtyFiles ?? 0), 0);
      const orphan = wtRows.reduce((n, t) => n + (fetched[t.name]?.orphanCommits ?? 0), 0);
      const unknown = wtRows.filter((t) => fetched[t.name]?.dirtyFiles == null || fetched[t.name]?.orphanCommits == null).length;
      const branchesWithWt = wtRows.map((t) => t.wt!.branch).filter((b): b is string => !!b);
      const risky = brRows.filter((t) => t.br!.merged === false);
      const forcing = risky.length > 0;

      const impact: React.ReactNode[] = [];
      if (sessions) impact.push(`${sessions} sesi aktif akan ditutup lebih dulu`);
      if (orphan) impact.push(`${orphan} commit tak ada di tempat lain — hilang`);
      if (dirty) impact.push(`${dirty} berkas belum tersimpan`);
      if (unknown) impact.push(`Dampak ${unknown} worktree belum diketahui — statistik git gagal dibaca`);
      if (!orphanOnly && withBranch && branchesWithWt.length) impact.push(`branch ikut dihapus: ${branchesWithWt.join(", ")}`);
      if (wtRows.length) impact.push("Seluruh isi direktori akan hilang, termasuk berkas ignored seperti .env dan node_modules");
      if (forcing) {
        impact.push(`${risky.length} branch belum ter-merge ke ${branches?.base ?? "base"}: ${risky.map((t) => t.name).join(", ")}.`);
        impact.push("Commit yang hanya ada di branch itu akan hilang dan tak bisa dipulihkan dari dashboard.");
      }

      const parts = [
        brRows.length ? `${brRows.length} branch akan dihapus (${scopeLabel}).` : "",
        wtRows.length ? `${wtRows.length} worktree akan dihapus.` : "",
        "Tindakan ini tak bisa dibatalkan.",
      ].filter(Boolean);
      const title = wtRows.length && !brRows.length ? `Hapus ${wtRows.length} worktree?`
        : brRows.length && !wtRows.length ? `Hapus ${brRows.length} branch?`
        : `Hapus ${targets.length} cabang?`;

      const run = async () => {
        const outcomes: Outcome[] = [];
        if (wtRows.length) {
          const names = wtRows.map((t) => t.name);
          try {
            const r = await api.deleteWorktrees(projectId,
              { names, ...(orphanOnly ? { orphanOnly: true } : withBranch ? { deleteBranch: true } : {}) });
            for (const x of r.results as WorktreeDeleteResult[]) {
              outcomes.push({ name: x.name, kind: "worktree", ok: x.ok, error: x.error,
                ...(x.branch ? { branch: x.branch } : {}) });
            }
          } catch (e) {
            for (const n of names) outcomes.push({ name: n, kind: "worktree", ok: false, error: errorMessage(e, "gagal") });
          }
        }
        if (brRows.length) {
          const names = brRows.map((t) => t.name);
          try {
            const r = await api.deleteBranches(projectId,
              { names, scope, ...(forcing ? { allowUnmerged: true } : {}) });
            for (const x of r.results as BranchDeleteResult[]) {
              outcomes.push({ name: x.name, kind: "branch", ok: x.ok, error: x.error, ...(x.forced ? { forced: true } : {}) });
            }
          } catch (e) {
            for (const n of names) outcomes.push({ name: n, kind: "branch", ok: false, error: errorMessage(e, "gagal") });
          }
        }
        setResults(outcomes);
        load();
      };

      void confirm({
        eyebrow: "cabang",
        title,
        confirmLabel: "Ya, hapus",
        message: orphanOnly
          ? "Worktree sesi terputus ini akan dihapus. Sesi yang kembali hidup akan dilewati."
          : parts.join(" "),
        impact,
        requireText: forcing ? (targets.length === 1 ? targets[0]!.name : "hapus paksa") : undefined,
        run,
      }).catch((e: unknown) => setResults(targets.map((t) => ({ name: t.name, kind: t.kind, ok: false, error: errorMessage(e, "gagal") }))));
    })();
  };

  const okCount = (results ?? []).filter((r) => r.ok).length;
  const failed = (results ?? []).filter((r) => !r.ok);
  const branchFailed = (results ?? []).filter((r) => r.ok && r.branch && !r.branch.ok);
  const forcedCount = (results ?? []).filter((r) => r.ok && r.forced).length;

  return (
    <Card padding={0}>
      <div className="hn-ide-cabang-bar">
        <span className="hn-eyebrow hn-ide-cabang-title">
          cabang & worktree{branches?.base ? ` · base ${branches.base}` : ""}
        </span>
        <Input size="sm" data-testid="cari" leftIcon="search" aria-label="Cari cabang" placeholder="mis. fitur/login"
          value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} style={{ width: 180 }} />
        <Select size="sm" data-testid="status" aria-label="Status branch" value={status}
          onChange={(e) => setStatus(e.target.value as Status)} options={STATUSES} />
        <Button size="sm" variant="ghost" aria-expanded={showOpts} aria-controls="cabang-opsi"
          onClick={() => setShowOpts((v) => !v)}>Opsi</Button>
        <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={load}>Muat ulang</Button>
        <Button size="sm" variant="primary" leftIcon="trash-2" data-testid="bulk-delete"
          disabled={pickedRows.length === 0} onClick={() => ask(pickedRows)}>
          Hapus terpilih ({pickedRows.length})
        </Button>
      </div>
      {showOpts && (
        <div id="cabang-opsi" role="group" aria-label="Opsi pembersihan" className="hn-ide-cabang-opts">
          <Select size="sm" data-testid="base" aria-label="Base pembanding" value={base} onChange={(e) => setBase(e.target.value)}
            options={[{ value: "", label: `base otomatis${branches?.base ? ` (${branches.base})` : ""}` },
              ...bases.map((b) => ({ value: b, label: b }))]} />
          <Select size="sm" data-testid="scope" aria-label="Cakupan hapus branch" value={scope}
            onChange={(e) => setScope(e.target.value as BranchScope)} options={SCOPES} />
          {anyWorktreeBranch && (
            <Checkbox data-testid="with-branch" checked={withBranch} onChange={() => setWithBranch(!withBranch)}
              label="Hapus branch worktree juga" description="Mati: branch tetap ada. Branch tanpa worktree dihapus lewat barisnya." />
          )}
        </div>
      )}

      {orphans.length > 0 && state === "ready" && (
        <div className="hn-ide-cabang-banner">
          <span className="hn-ide-cabang-banner-text">
            {orphans.length} worktree sesi terputus — disimpan sampai kamu membersihkannya.
            Sesi yang sudah hidup kembali dilewati.
          </span>
          <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={!collectible.length}
            onClick={() => ask(collectible, true)}>Bersihkan sesi terputus ({collectible.length})</Button>
        </div>
      )}

      {results && (
        <div className="hn-ide-cabang-results">
          <div className="hn-ide-cabang-results-sum">
            {okCount} terhapus{forcedCount ? ` (${forcedCount} dipaksa)` : ""} · {failed.length} gagal
          </div>
          {failed.map((f) => (
            <div key={`f-${f.kind}-${f.name}`} className="hn-ide-cabang-results-line">{f.name} — {f.error ?? "gagal"}</div>
          ))}
          {/* Worktree terhapus tapi branch-nya tertahan pagar ADR-0077: keduanya harus terbaca. */}
          {branchFailed.map((f) => (
            <div key={`b-${f.name}`} className="hn-ide-cabang-results-line">{f.branch!.name} — {f.branch!.error ?? "branch gagal dihapus"}</div>
          ))}
        </div>
      )}

      {state === "loading" ? <StateBlock kind="loading" title="Memuat cabang…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat cabang" action={() => load()} />
        : rows.length === 0 ? <StateBlock kind="empty" icon="git-branch" title="Tak ada branch atau worktree"
            hint="Project ini belum punya branch local, origin, maupun checkout lokal." />
        : filtered.length === 0 ? <StateBlock kind="empty" icon="filter" title="Tak ada branch cocok filter"
            hint="Longgarkan filter status atau kosongkan pencarian." />
        : (
          <div className="hn-ide-cabang-list">
            <div className="hn-ide-cabang-pickall">
              <Checkbox data-testid="pick-all" checked={allPicked} disabled={free.length === 0}
                onChange={() => setPicked(allPicked ? new Set<string>() : new Set(free))}
                label={`Pilih semua yang boleh (${free.length})`} />
            </div>
            {visible.map((r) => <CabangRow key={r.key} row={r} stats={r.wt ? stats[r.name] : undefined}
              picked={picked.has(r.key)} focused={focusKey === r.key} onToggle={() => toggle(r.key)}
              onDelete={() => ask([r])} onFocusWorktree={(path) => {
                const w = worktreeList.find((x) => x.path === path);
                if (w) setFocusKey(`wt:${w.name}`);
              }} />)}
            {filtered.length > visible.length && (
              <div className="hn-ide-cabang-more">
                <Button size="sm" variant="ghost" data-testid="show-more"
                  onClick={() => setShown((n) => n + PAGE)}>
                  Tampilkan {Math.min(PAGE, filtered.length - visible.length)} lagi
                  ({filtered.length - visible.length} tersisa)
                </Button>
              </div>
            )}
          </div>
        )}
      {dialog}
    </Card>
  );
}

/** Satu baris Cabang. Badge dibatasi dua per baris; sisa keadaan ditulis sebagai teks pendukung. */
function CabangRow({ row, stats, picked, focused, onToggle, onDelete, onFocusWorktree }: {
  row: Row; stats: WorktreeStats | undefined; picked: boolean; focused: boolean;
  onToggle: () => void; onDelete: () => void; onFocusWorktree: (path: string) => void;
}) {
  const { wt, br } = row;
  const isWt = row.kind === "worktree";
  const orphanish = !!wt?.orphan;
  const dirty = stats?.dirtyFiles ?? 0;
  return (
    <div className="hn-dense-row" data-testid={isWt ? `row-${row.name}` : `branch-row-${row.name}`}
      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 14px",
        borderBottom: "1px solid var(--border-hair)", background: focused ? "var(--surface-sunken)" : undefined }}>
      <Checkbox data-testid={`pick-${row.name}`} aria-label={`Pilih ${row.name}`} checked={picked}
        disabled={!row.deletable} onChange={onToggle} />
      <span className="hn-grow" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1 }}>
        {row.name}
      </span>
      {isWt && wt && (
        <>
          {orphanish ? <Badge size="sm" tone="warn">sesi terputus</Badge>
            : wt.session ? <Badge size="sm" tone="warn">sesi aktif</Badge>
            : dirty > 0 ? <Badge size="sm" tone="warn">{dirty} kotor</Badge>
            : !wt.branch ? <Badge size="sm" tone="brass">detached</Badge>
            : null}
          {wt.spec && <Badge size="sm" tone="brass">{wt.spec.id} · {wt.spec.stage}</Badge>}
        </>
      )}
      {!isWt && br && <Badge size="sm" tone={br.merged ? "ok" : "warn"}>{br.merged ? "ter-merge" : "belum ter-merge"}</Badge>}
      <span className="hn-ide-cabang-meta">
        {isWt && wt && (
          wt.branch
            ? <span className="hn-ide-cabang-branch">{wt.branch}</span>
            : <span className="hn-ide-cabang-sha">{wt.head.slice(0, 7) || "—"}</span>
        )}
        {isWt && wt?.prunable && <span>prunable</span>}
        {isWt && wt?.locked && <span>terkunci git</span>}
        {isWt && wt?.blocked && <span>{wt.blocked}</span>}
        {!isWt && br && <span>{scopeOf(br)}</span>}
        {!isWt && br?.locks.map((l) => (
          l === "worktree" && br.worktree
            ? <button key={l} type="button" data-testid={`goto-worktree-${row.name}`} className="hn-ide-cabang-link"
                onClick={() => onFocusWorktree(br.worktree!)}>{LOCK_LABEL[l]} →</button>
            : <span key={l}>{LOCK_LABEL[l]}</span>
        ))}
      </span>
      {isWt
        ? <span className="hn-ide-cabang-when" style={{ minWidth: 130, marginLeft: "auto", textAlign: "right" }}>
            {stats ? size(stats.sizeBytes) : "…"} · {rel(wt?.createdAt)}
          </span>
        : <span className="hn-ide-cabang-when" style={{ minWidth: 200, marginLeft: "auto", textAlign: "right" }}>
            {br?.lastCommit ? `${br.lastCommit.subject} · ${rel(br.lastCommit.at)}` : "—"}
          </span>}
      <Button size="sm" variant="ghost" leftIcon="trash-2" data-testid={`row-delete-${row.name}`}
        disabled={!row.deletable} onClick={onDelete}>Hapus</Button>
    </div>
  );
}
