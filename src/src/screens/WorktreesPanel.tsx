/* SPEC-861 · ADR-0132 — panel worktree hidup: satu baris per worktree yang terdaftar di git,
   dengan hapus per baris + bulk yang ikut menutup sesinya dan (opsional) menghapus branch-nya.
   Pasangan BranchesPanel.tsx untuk sisi worktree; seluruh data turunan git dari server.
   Sesi tmux hidup, backlog belum selesai, dan isi kotor adalah PERINGATAN, bukan penolakan —
   satu-satunya baris yang tak bisa dihapus adalah yang ditolak `ownsWorktree` di server. */
import React from "react";
import { Card, Button, Badge, Checkbox, StateBlock, useConfirm } from "../ds";
import { usePersistedState, scoped } from "../ui-state";
import { api, type WorktreeReport, type WorktreeStats, type WorktreeDeleteResult } from "../api/client";

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

const rel = (iso: string | null): string => {
  const t = iso ? new Date(iso).getTime() : 0;
  if (!t) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}j`;
  if (s < 2592000) return `${Math.floor(s / 86400)}h`;
  return new Date(iso!).toLocaleDateString();
};

const size = (b: number | null): string => {
  if (b === null) return "—";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

export function WorktreesPanel({ projectId, focus, onOpenBranch }: {
  projectId: string; focus?: string; onOpenBranch?: (branch: string) => void;
}) {
  const ui = scoped("worktrees", projectId);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [report, setReport] = React.useState<WorktreeReport | null>(null);
  const [stats, setStats] = React.useState<Record<string, WorktreeStats>>({});
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [withBranch, setWithBranch] = usePersistedState(ui, "withBranch", false, isBool);
  const [results, setResults] = React.useState<WorktreeDeleteResult[] | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = React.useCallback(() => {
    setState("loading");
    api.worktrees(projectId)
      .then((r) => { setReport(r); setPicked(new Set()); setStats({}); setState("ready"); })
      .catch(() => setState("error"));
  }, [projectId]);
  React.useEffect(() => { load(); }, [load]);

  // Sinyal mahal dimuat MENYUSUL, satu baris per giliran: `du` menelusuri seluruh pohon, dan
  // menembakkan N sekaligus membuat daftar yang sudah terender ikut tersendat — padahal ia sudah
  // di layar justru supaya operator tak menunggu.
  React.useEffect(() => {
    if (!report) return;
    let alive = true;
    void (async () => {
      for (const w of report.worktrees) {
        if (!alive) return;
        const s = await api.worktreeStats(projectId, w.name).catch(() => null);
        if (alive && s) setStats((prev) => ({ ...prev, [w.name]: s }));
      }
    })();
    return () => { alive = false; };
  }, [report, projectId]);

  const rows = report?.worktrees ?? [];
  const free = React.useMemo(() => rows.filter((w) => w.deletable).map((w) => w.name), [rows]);
  const allPicked = free.length > 0 && free.every((n) => picked.has(n));
  const toggle = (name: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  // Urutan mengikuti daftar server supaya `names` deterministik (dan enak di-assert).
  const pickedNames = rows.filter((w) => picked.has(w.name)).map((w) => w.name);
  const anyBranch = rows.some((w) => w.deletable && w.branch);

  const ask = async (names: string[]) => {
    const target = rows.filter((w) => names.includes(w.name));
    // Dialog yang tak bisa menyebut angkanya bukan konfirmasi (ADR-0127): baris yang stats-nya
    // belum sempat termuat dijemput dulu, sekali, sebelum dialognya dibuka.
    const fetched: Record<string, WorktreeStats> = { ...stats };
    for (const w of target) {
      if (fetched[w.name]) continue;
      const s = await api.worktreeStats(projectId, w.name).catch(() => null);
      if (s) fetched[w.name] = s;
    }
    setStats(fetched);

    const sessions = target.filter((w) => w.session).length;
    const dirty = target.reduce((n, w) => n + (fetched[w.name]?.dirtyFiles ?? 0), 0);
    const orphan = target.reduce((n, w) => n + (fetched[w.name]?.orphanCommits ?? 0), 0);
    const branches = target.map((w) => w.branch).filter((b): b is string => !!b);
    const impact: React.ReactNode[] = [];
    if (sessions) impact.push(`${sessions} sesi aktif akan ditutup lebih dulu`);
    if (orphan) impact.push(`${orphan} commit tak ada di tempat lain — hilang`);
    if (dirty) impact.push(`${dirty} berkas belum tersimpan`);
    if (withBranch && branches.length) impact.push(`branch ikut dihapus: ${branches.join(", ")}`);
    if (!impact.length) impact.push("tak ada kerja yang belum tersimpan di sini");

    await confirm({
      eyebrow: "worktree", title: `Hapus ${names.length} worktree?`, confirmLabel: "Ya, hapus",
      message: "Direktorinya dipindah ke .worktrees/.trash/ dan byte-nya dihapus di latar.",
      impact,
      run: async () => {
        const r = await api.deleteWorktrees(projectId,
          { names, ...(withBranch ? { deleteBranch: true } : {}) });
        setResults(r.results);
        load();
      },
    }).catch((e: Error) => {
      setResults(names.map((n) => ({ name: n, ok: false, cleanup: null, error: e.message })));
      return false;
    });
  };

  const failed = (results ?? []).filter((r) => !r.ok);
  const branchFailed = (results ?? []).filter((r) => r.ok && r.branch && !r.branch.ok);

  return (
    <Card padding={0}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        <span className="hn-eyebrow" style={{ flex: 1 }}>worktree hidup</span>
        {anyBranch && (
          <Checkbox data-testid="with-branch" checked={withBranch}
            onChange={() => setWithBranch(!withBranch)} label="Hapus branch-nya juga" />
        )}
        <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={load}>Muat ulang</Button>
        <Button size="sm" variant="primary" leftIcon="trash-2" data-testid="bulk-delete"
          disabled={pickedNames.length === 0} onClick={() => void ask(pickedNames)}>
          Hapus terpilih ({pickedNames.length})
        </Button>
      </div>

      {results && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-hair)", fontSize: 12.5 }}>
          <div style={{ color: "var(--text-strong)" }}>
            {results.length - failed.length} terhapus · {failed.length} gagal
          </div>
          {failed.map((f) => (
            <div key={f.name} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {f.name} — {f.error ?? "gagal"}
            </div>
          ))}
          {/* Worktree terhapus tapi branch-nya tertahan pagar ADR-0077: keduanya harus terbaca,
              kalau tidak operator mengira branch-nya ikut lenyap. */}
          {branchFailed.map((f) => (
            <div key={`b-${f.name}`} style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {f.branch!.name} — {f.branch!.error ?? "branch gagal dihapus"}
            </div>
          ))}
        </div>
      )}

      {state === "loading" ? <StateBlock kind="loading" title="Memuat worktree…" />
        : state === "error" ? <StateBlock kind="error" title="Gagal memuat worktree" action={load} />
        : rows.length === 0 ? <StateBlock kind="empty" icon="folder" title="Tak ada worktree"
            hint="Project ini belum punya checkout lokal, atau git tak bisa dibaca." />
        : (
          <div style={{ maxHeight: 620, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
              borderBottom: "1px solid var(--border-hair)" }}>
              <Checkbox data-testid="pick-all" checked={allPicked} disabled={free.length === 0}
                onChange={() => setPicked(allPicked ? new Set<string>() : new Set(free))}
                label={`Pilih semua yang boleh (${free.length})`} />
            </div>
            {rows.map((w) => (
              <div key={w.name} data-testid={`row-${w.name}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                  borderBottom: "1px solid var(--border-hair)",
                  background: focus === w.name ? "var(--surface-sunken)" : undefined }}>
                <Checkbox data-testid={`pick-${w.name}`} checked={picked.has(w.name)}
                  disabled={!w.deletable} onChange={() => toggle(w.name)} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-strong)", flex: 1 }}>
                  {w.name}
                </span>
                {w.branch
                  ? <button data-testid={`goto-branch-${w.name}`} onClick={() => onOpenBranch?.(w.branch!)}
                      style={{ background: "none", border: 0, padding: 0, cursor: "pointer",
                        fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--brass)" }}>{w.branch}</button>
                  /* ADR-0002 · sesi hanoman selalu detached — kolom ini wajib sanggup jadi SHA. */
                  : <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>
                      {w.head.slice(0, 7) || "—"}
                    </span>}
                {!w.branch && <Badge size="sm" tone="brass">detached</Badge>}
                {w.spec && <Badge size="sm" tone="brass">{w.spec.id} · {w.spec.stage}</Badge>}
                {w.session && <Badge size="sm" tone="warn">sesi aktif</Badge>}
                {w.prunable && <Badge size="sm" tone="warn">prunable</Badge>}
                {w.locked && <Badge size="sm" tone="warn">terkunci git</Badge>}
                {w.blocked && <Badge size="sm" tone="warn">{w.blocked}</Badge>}
                {!!stats[w.name]?.dirtyFiles && <Badge size="sm" tone="warn">{stats[w.name]!.dirtyFiles} kotor</Badge>}
                <span style={{ fontSize: 11.5, color: "var(--text-subtle)", minWidth: 130, textAlign: "right" }}>
                  {stats[w.name] ? size(stats[w.name]!.sizeBytes) : "…"} · {rel(w.createdAt)}
                </span>
                <Button size="sm" variant="ghost" leftIcon="trash-2" data-testid={`row-delete-${w.name}`}
                  disabled={!w.deletable} onClick={() => void ask([w.name])}>Hapus</Button>
              </div>
            ))}
          </div>
        )}
      {dialog}
    </Card>
  );
}
