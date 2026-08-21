/* SPEC-360 · ADR-0077 — panel branch project: SELURUH branch (local + origin), ter-merge maupun
   belum, dengan satu tombol hapus per baris + bulk. Komponen sendiri (bukan tambahan ke
   GitGraph.tsx yang sudah 43 KB). Seluruh data turunan git dari server — tak ada state persist.
   SPEC-859 — daftar melebar dari "hanya ter-merge" ke semua branch; filter status/cari & batas
   render hidup di klien supaya "yang sedang tampak" persis sama dengan yang bisa dipilih. */
import React from "react";
import { Card, Button, Badge, Select, Input, Checkbox, StateBlock, ConfirmDialog } from "../ds";
import { api, LOCK_LABEL, type UnusedBranch, type UnusedReport, type BranchScope, type BranchDeleteResult } from "../api/client";

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

// Repo besar: daftar penuh bisa ratusan baris. Batas ini bagian dari definisi "sedang tampak" —
// pilihan tak pernah memuat baris yang tak dirender, jadi "Pilih semua yang boleh (N)" jujur.
const PAGE = 100;

const rel = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}j`;
  if (s < 2592000) return `${Math.floor(s / 86400)}h`;
  return new Date(iso).toLocaleDateString();
};

const deletable = (b: UnusedBranch) => b.locks.length === 0;
const scopeOf = (b: UnusedBranch) => (b.local && b.remote ? "local + origin" : b.local ? "local" : "origin");

export function BranchesPanel({ projectId, onOpenWorktree }: {
  projectId: string;
  /** SPEC-861 · pindah ke tab Worktrees pada baris yang menahan branch ini. */
  onOpenWorktree?: (path: string) => void;
}) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [report, setReport] = React.useState<UnusedReport | null>(null);
  const [bases, setBases] = React.useState<string[]>([]);
  const [base, setBase] = React.useState("");
  const [scope, setScope] = React.useState<BranchScope>("both");
  const [status, setStatus] = React.useState<Status>("all");
  const [q, setQ] = React.useState("");
  const [shown, setShown] = React.useState(PAGE);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<BranchDeleteResult[] | null>(null);

  const load = React.useCallback(() => {
    setState("loading");
    api.branchesUnused(projectId, base || undefined, "all")
      .then((r) => { setReport(r); setPicked(new Set()); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId, base]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    api.listBranches(projectId)
      .then((r) => setBases([...new Set([...r.branches, ...r.remotes])].sort()))
      .catch(() => setBases([]));
  }, [projectId]);

  const branches = report?.branches ?? [];
  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return branches.filter((b) =>
      (status === "all" || (status === "merged") === b.merged) &&
      (!needle || b.name.toLowerCase().includes(needle)));
  }, [branches, status, q]);
  // Menyempitkan filter tak boleh menyisakan pilihan yang tak terlihat lagi: batas render ikut
  // jadi bagian dari "tampak", dan pilihan dikosongkan tiap kali himpunan itu berubah bentuk.
  React.useEffect(() => { setShown(PAGE); setPicked(new Set()); }, [status, q]);

  const visible = filtered.slice(0, shown);
  const free = React.useMemo(() => visible.filter(deletable).map((b) => b.name), [visible]);
  const allPicked = free.length > 0 && free.every((n) => picked.has(n));

  const toggle = (name: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const toggleAll = () => setPicked(allPicked ? new Set<string>() : new Set(free));

  // Urutan mengikuti daftar server supaya `names` deterministik (dan enak di-assert).
  const pickedNames = visible.filter((b) => picked.has(b.name)).map((b) => b.name);

  const byName = React.useMemo(() => new Map(branches.map((b) => [b.name, b])), [branches]);
  const risky = (pending ?? []).filter((n) => byName.get(n)?.merged === false);
  const force = risky.length > 0;

  const run = () => {
    const names = pending;
    if (!names) return;
    setBusy(true);
    api.deleteBranches(projectId, { names, scope, ...(force ? { allowUnmerged: true } : {}) })
      .then((r) => { setResults(r.results); setPending(null); load(); })
      .catch((e: Error) => {
        setResults(names.map((n) => ({ name: n, ok: false, scope: "none" as const, error: e.message })));
        setPending(null);
      })
      .finally(() => setBusy(false));
  };

  const failed = (results ?? []).filter((r) => !r.ok);
  const okCount = (results ?? []).length - failed.length;
  const forcedCount = (results ?? []).filter((r) => r.ok && r.forced).length;
  const scopeLabel = SCOPES.find((s) => s.value === scope)!.label;

  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        <span className="hn-eyebrow" style={{ flex: 1 }}>
          branch project{report?.base ? ` · base ${report.base}` : ""}
        </span>
        <Input size="sm" data-testid="cari" leftIcon="search" placeholder="cari branch…"
          value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          style={{ width: 180 }} />
        <Select size="sm" data-testid="status" value={status}
          onChange={(e) => setStatus(e.target.value as Status)} options={STATUSES} />
        <Select size="sm" data-testid="base" value={base} onChange={(e) => setBase(e.target.value)}
          options={[{ value: "", label: `base otomatis${report?.base ? ` (${report.base})` : ""}` },
            ...bases.map((b) => ({ value: b, label: b }))]} />
        <Select size="sm" data-testid="scope" value={scope}
          onChange={(e) => setScope(e.target.value as BranchScope)} options={SCOPES} />
        <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={load}>Muat ulang</Button>
        <Button size="sm" variant="primary" leftIcon="trash-2" data-testid="bulk-delete"
          disabled={pickedNames.length === 0} onClick={() => setPending(pickedNames)}>
          Hapus terpilih ({pickedNames.length})
        </Button>
      </div>

      {results && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)", fontSize: 12.5 }}>
          <div style={{ color: "var(--text-strong)" }}>
            {okCount} terhapus{forcedCount ? ` (${forcedCount} dipaksa)` : ""} · {failed.length} gagal
          </div>
          {failed.map((f) => (
            <div key={f.name} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {f.name} — {f.error ?? "gagal"}
            </div>
          ))}
        </div>
      )}

      {state === "loading" ? <StateBlock kind="loading" title="Memuat branch…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat branch" action={load} />
        : branches.length === 0 ? <StateBlock kind="empty" icon="git-branch" title="Tak ada branch"
            hint="Project ini belum punya branch local maupun origin." />
        : filtered.length === 0 ? <StateBlock kind="empty" icon="filter" title="Tak ada branch cocok filter"
            hint="Longgarkan filter status atau kosongkan pencarian." />
        : (
          <div style={{ maxHeight: 620, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
              borderBottom: "1px solid var(--border-hair)" }}>
              <Checkbox data-testid="pick-all" checked={allPicked} onChange={toggleAll}
                disabled={free.length === 0} label={`Pilih semua yang boleh (${free.length})`} />
            </div>
            {/* SPEC-879 · baris ini dulu flex satu baris tanpa wrap: di 390px tombol Hapus tiap
                baris terukur 145–363px DI LUAR layar, dan di 820px masih 17px. `hn-dense-row`
                memberi nama branch lebar minimum di mobile; `flexWrap` berlaku di semua tier. */}
            {visible.map((b) => (
              <div key={b.name} className="hn-dense-row"
                style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  padding: "8px 14px", borderBottom: "1px solid var(--border-hair)" }}>
                <Checkbox data-testid={`pick-${b.name}`} checked={picked.has(b.name)}
                  disabled={!deletable(b)} onChange={() => toggle(b.name)} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1 }}>
                  {b.name}
                </span>
                <Badge size="sm" tone={b.merged ? "ok" : "warn"}>
                  {b.merged ? "ter-merge" : "belum ter-merge"}
                </Badge>
                <Badge size="sm" tone="brass">{scopeOf(b)}</Badge>
                {/* SPEC-861 · kunci `worktree` adalah SATU-SATUNYA yang punya jalan keluar di
                    layar lain: badge-nya jadi tautan ke baris worktree yang menahannya. */}
                {b.locks.map((l) =>
                  l === "worktree" && b.worktree && onOpenWorktree
                    ? <button key={l} data-testid={`goto-worktree-${b.name}`}
                        onClick={() => onOpenWorktree(b.worktree!)}
                        style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                        <Badge size="sm" tone="warn">{LOCK_LABEL[l]} →</Badge>
                      </button>
                    : <Badge key={l} size="sm" tone="warn">{LOCK_LABEL[l]}</Badge>)}
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 200,
                  marginLeft: "auto", textAlign: "right" }}>
                  {b.lastCommit ? `${b.lastCommit.subject} · ${rel(b.lastCommit.at)}` : "—"}
                </span>
                <Button size="sm" variant="ghost" leftIcon="trash-2" data-testid={`row-delete-${b.name}`}
                  disabled={!deletable(b)} onClick={() => setPending([b.name])}>Hapus</Button>
              </div>
            ))}
            {filtered.length > visible.length && (
              <div style={{ padding: "8px 14px", textAlign: "center" }}>
                <Button size="sm" variant="ghost" data-testid="show-more"
                  onClick={() => setShown((n) => n + PAGE)}>
                  Tampilkan {Math.min(PAGE, filtered.length - visible.length)} lagi
                  ({filtered.length - visible.length} tersisa)
                </Button>
              </div>
            )}
          </div>
        )}

      {/* confirmLabel BUKAN "Hapus": tombol per baris sudah memakai label itu → query test ambigu.
          SPEC-859 · target yang belum ter-merge memakai dialog TERPISAH: `git branch -D` membuang
          commit yang tak ada di mana pun lagi, jadi pagarnya ketikan ulang (pola ADR-0121) —
          nama branch bila targetnya satu, `hapus paksa` bila batch. */}
      <ConfirmDialog
        open={pending !== null} busy={busy} eyebrow="branch" title="Hapus branch?"
        confirmLabel="Ya, hapus"
        requireText={force ? (pending?.length === 1 ? pending[0] : "hapus paksa") : undefined}
        message={pending
          ? `${pending.length} branch akan dihapus (${scopeLabel}). Tindakan ini tak bisa dibatalkan.`
          : ""}
        impact={force ? [
          `${risky.length} branch belum ter-merge ke ${report?.base ?? "base"}: ${risky.join(", ")}.`,
          "Commit yang hanya ada di branch itu akan hilang dan tak bisa dipulihkan dari dashboard.",
        ] : undefined}
        onConfirm={run} onCancel={() => setPending(null)} />
    </Card>
  );
}
