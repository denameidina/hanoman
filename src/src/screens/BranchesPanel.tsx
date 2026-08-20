/* SPEC-360 · ADR-0077 — panel branch tak terpakai: branch yang sudah ter-merge ke base, dengan
   satu tombol hapus per baris + bulk, mencakup local & origin. Komponen sendiri (bukan tambahan
   ke GitGraph.tsx yang sudah 43 KB). Seluruh data turunan git dari server — tak ada state persist. */
import React from "react";
import { Card, Button, Badge, Select, Checkbox, StateBlock, ConfirmDialog } from "../ds";
import { api, LOCK_LABEL, type UnusedBranch, type UnusedReport, type BranchScope, type BranchDeleteResult } from "../api/client";

const SCOPES: { value: BranchScope; label: string }[] = [
  { value: "both", label: "local + origin" },
  { value: "local", label: "local saja" },
  { value: "remote", label: "origin saja" },
];

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
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<BranchDeleteResult[] | null>(null);

  const load = React.useCallback(() => {
    setState("loading");
    api.branchesUnused(projectId, base || undefined)
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
  const free = React.useMemo(() => branches.filter(deletable).map((b) => b.name), [branches]);
  const allPicked = free.length > 0 && free.every((n) => picked.has(n));

  const toggle = (name: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const toggleAll = () => setPicked(allPicked ? new Set<string>() : new Set(free));

  // Urutan mengikuti daftar server supaya `names` deterministik (dan enak di-assert).
  const pickedNames = branches.filter((b) => picked.has(b.name)).map((b) => b.name);

  const run = () => {
    const names = pending;
    if (!names) return;
    setBusy(true);
    api.deleteBranches(projectId, { names, scope })
      .then((r) => { setResults(r.results); setPending(null); load(); })
      .catch((e: Error) => {
        setResults(names.map((n) => ({ name: n, ok: false, scope: "none" as const, error: e.message })));
        setPending(null);
      })
      .finally(() => setBusy(false));
  };

  const failed = (results ?? []).filter((r) => !r.ok);
  const okCount = (results ?? []).length - failed.length;
  const scopeLabel = SCOPES.find((s) => s.value === scope)!.label;

  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        <span className="hn-eyebrow" style={{ flex: 1 }}>
          branch ter-merge{report?.base ? ` ke ${report.base}` : ""}
        </span>
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
          <div style={{ color: "var(--text-strong)" }}>{okCount} terhapus · {failed.length} gagal</div>
          {failed.map((f) => (
            <div key={f.name} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {f.name} — {f.error ?? "gagal"}
            </div>
          ))}
        </div>
      )}

      {state === "loading" ? <StateBlock kind="loading" title="Memuat branch…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat branch" action={load} />
        : branches.length === 0 ? <StateBlock kind="empty" icon="git-branch" title="Tak ada branch ter-merge"
            hint="Branch muncul di sini setelah ter-merge ke base." />
        : (
          <div style={{ maxHeight: 620, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
              borderBottom: "1px solid var(--border-hair)" }}>
              <Checkbox data-testid="pick-all" checked={allPicked} onChange={toggleAll}
                disabled={free.length === 0} label={`Pilih semua yang boleh (${free.length})`} />
            </div>
            {branches.map((b) => (
              <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                borderBottom: "1px solid var(--border-hair)" }}>
                <Checkbox data-testid={`pick-${b.name}`} checked={picked.has(b.name)}
                  disabled={!deletable(b)} onChange={() => toggle(b.name)} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1 }}>
                  {b.name}
                </span>
                <Badge size="sm" tone="brass">{b.local && b.remote ? "local + origin" : b.local ? "local" : "origin"}</Badge>
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
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 200, textAlign: "right" }}>
                  {b.lastCommit ? `${b.lastCommit.subject} · ${rel(b.lastCommit.at)}` : "—"}
                </span>
                <Button size="sm" variant="ghost" leftIcon="trash-2" data-testid={`row-delete-${b.name}`}
                  disabled={!deletable(b)} onClick={() => setPending([b.name])}>Hapus</Button>
              </div>
            ))}
          </div>
        )}

      {/* confirmLabel BUKAN "Hapus": tombol per baris sudah memakai label itu → query test ambigu. */}
      <ConfirmDialog
        open={pending !== null} busy={busy} eyebrow="branch" title="Hapus branch?"
        confirmLabel="Ya, hapus"
        message={pending ? `${pending.length} branch akan dihapus (${scopeLabel}). Tindakan ini tak bisa dibatalkan.` : ""}
        onConfirm={run} onCancel={() => setPending(null)} />
    </Card>
  );
}
