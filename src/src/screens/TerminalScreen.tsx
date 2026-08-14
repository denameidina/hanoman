import React from "react";
import { Button, IconButton, Icon, Select, StateBlock, Modal, Input, Badge, StatusPill,
  ProductStateIllustration, Tabs, useResponsiveTier } from "../ds";
import { api, ApiError, type TerminalSession, type Phase, type Flow } from "../api/client";
import { subscribe } from "../api/events";
import { flowForSource, type SessionHistoryView, type WorktreeCleanupView } from "@hanoman/shared";
import { TerminalPane } from "./TerminalPane";
import { SessionHistoryModal } from "./SessionHistoryModal";
import { NewTerminalModal } from "./NewTerminalModal";
import { SpecDocsModal } from "./SpecDocsModal";
import { IntegrateDialog } from "./IntegrateDialog";
import { B_STAGES } from "./BacklogScreen";
import type { Spec } from "./types";
import * as L from "./terminal-layout";
import * as W from "./terminal-workspace";
import { usePersistedState, isStr } from "../ui-state";

export function TerminalScreen({ projects, backlog = [], focusSession, onOpenReview, onOpenSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf }: {
  projects: { id: string; name: string }[]; backlog?: Spec[]; focusSession?: string | null;
  onOpenReview?: (specId: string) => void;
  onOpenSessionReview?: (sessionId: string, title: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: Spec, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => Spec | undefined;
}) {
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  // SPEC-742 · ADR-0116 · worktree yang masih disapu di latar. Bukan sesi: sesinya sudah lenyap.
  const [cleanups, setCleanups] = React.useState<WorktreeCleanupView[]>([]);
  const [ws, setWs] = React.useState<W.Workspace>(() => W.load() ?? W.emptyWorkspace());
  // SPEC-740 · ADR-0115 · project pemilih sesi baru. Workspace grid TIDAK dipindah ke
  // namespace ini — ia sudah persisten di kunci `hanoman.terminal.workspace`, dan
  // memindahkannya membuang state pengguna yang sudah ada dengan imbalan nol.
  const [project, setProject] = usePersistedState("terminal", "project", projects[0]?.id ?? "", isStr);
  const [maxed, setMaxed] = React.useState(false);
  // SPEC-232 · id sesi yang sedang dilihat layar-penuh (satu terminal, sebagai modal).
  // Tak dipersist, seperti `maxed` (SPEC-163).
  const [fullId, setFullId] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [pickError, setPickError] = React.useState<string | null>(null);
  // SPEC-517 · form runtime sebelum sesi agen biasa lahir. Modal, bukan panel: grid di belakangnya
  // tak berubah ukuran — pola yang sama dengan "Ambil backlog" & "Riwayat".
  const [newOpen, setNewOpen] = React.useState(false);
  // SPEC-362 · riwayat sesi. State-nya sekadar boolean: modal baru dirender saat diminta, jadi
  // tak ada request riwayat maupun elemen tambahan selama operator tak membukanya.
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const tier = useResponsiveTier();
  const mobile = tier === "mobile";
  const [activeCell, setActiveCell] = React.useState(0);
  const [requestedSession, setRequestedSession] = React.useState<string | null>(null);
  const handledFocus = React.useRef<string | null>(null);

  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    api.listTerminals().then(setSessions).catch(() => setSessions([])).finally(() => setLoaded(true));
  }, []);

  // SPEC-199 · daftar sesi (`exited` + marker "menunggu keputusan") didorong lewat WS siar
  // (ADR-0039), bukan poll 8s. tmux = source of truth di server; snapshot penuh saat connect.
  React.useEffect(() => subscribe((m) => {
    if (m.t === "sessions") setSessions(m.sessions as TerminalSession[]);
    // SPEC-742 · ADR-0116 · tab yang ditutup lepas SEKETIKA (sesinya memang sudah lenyap); yang
    // masih berjalan cuma penghapusan byte worktree-nya. Tanpa baris ini kerja itu tak kasatmata,
    // dan "kok disknya belum kembali" jadi pertanyaan tanpa jawaban.
    else if (m.t === "cleanups") setCleanups(m.cleanups);
  }), []);

  // Sesi hidup di tmux dan selamat dari restart server (ADR-0016): workspace ter-load bisa
  // menunjuk sesi yang masih hidup (disambung ulang) atau yang sudah di-kill (dikosongkan).
  // Ditahan sampai `loaded`: sebelum listTerminals() resolve, `sessions` masih [] dan
  // rekonsiliasi dini akan mengosongkan workspace yang baru saja dipulihkan dari localStorage.
  React.useEffect(() => {
    if (!loaded) return;
    setWs((w) => W.reconcileAll(w, new Set(sessions.map((s) => s.id))));
  }, [loaded, sessions]);

  React.useEffect(() => { W.save(ws); }, [ws]);

  // SPEC-184 · notifikasi mengarahkan ke sesi tertentu → tempatkan ke grid aktif begitu sesi itu
  // muncul di daftar hidup. SPEC-197 · efek ini jalan tiap `sessions` berubah; tanpa guard, sesi
  // fokus yang sudah tampil bisa "loncat" ke sel-kosong-pertama saat sesi lain exit. Hanya place
  // bila belum ada di grid mana pun (placedIds); kalau sudah, kembalikan w apa adanya (no-op).
  React.useEffect(() => {
    if (!focusSession) { handledFocus.current = null; return; }
    if (!loaded || handledFocus.current === focusSession) return;
    if (!sessions.some((s) => s.id === focusSession && !s.exited)) return;
    handledFocus.current = focusSession;
    setRequestedSession(focusSession);
  }, [focusSession, loaded, sessions]);

  React.useEffect(() => {
    if (!requestedSession) return;
    setWs((current) => {
      const existing = current.groups.find((group) => group.layout.cells.includes(requestedSession));
      if (existing) return existing.id === current.active ? current : W.selectGroup(current, existing.id);
      const placed = W.placeFirstEmptyInActive(current, requestedSession);
      if (placed !== current || !mobile) return placed;
      return W.placeInActive(current, activeCell, requestedSession);
    });
  }, [activeCell, mobile, requestedSession]);

  // SPEC-232 · fullscreen menunjuk satu sesi hidup; bila sesi itu hilang (kill/exit lewat
  // frame WS), lepas fullscreen supaya modal tak menggantung ke sesi yang sudah lenyap.
  React.useEffect(() => {
    if (fullId && !sessions.some((s) => s.id === fullId)) setFullId(null);
  }, [fullId, sessions]);

  const failedCleanups = cleanups.filter((c) => c.error);
  const byId = (id: string) => sessions.find((s) => s.id === id) ?? null;
  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  // SPEC-517 · sesi agen biasa lahir DI DALAM NewTerminalModal (ia yang memegang pilihan
  // runtime); di sini tinggal menaruhnya di grid — persis jalur lama sesudah createTerminal.
  function placeNew(id: string) {
    setSessions((s) => (s.some((x) => x.id === id)
      ? s
      : [...s, { id, projectId: project, cwd: "", exited: false }]));
    setWs((w) => W.placeFirstEmptyInActive(w, id));
    setRequestedSession(id);
  }

  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project terpilih. Cermin
  // openNew, tapi memanggil createShell — server men-spawn $SHELL, bukan claude.
  async function openShell() {
    if (!project) return;
    const { id } = await api.createShell(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    setWs((w) => W.placeFirstEmptyInActive(w, id));
    setRequestedSession(id);
  }

  // SPEC-179 · ambil backlog item tanpa pindah page. Reuse start API idempoten +
  // placeFirstEmptyInActive — sesi baru langsung masuk grid aktif.
  async function pickBacklog(spec: Spec) {
    const flow: Flow = flowForSource(spec.source);
    try {
      const { id } = await api.startSession({ spec: spec.id, flow });
      setSessions((s) => s.some((x) => x.id === id)
        ? s
        : [...s, { id, projectId: spec.projectId, specId: spec.id, flow, cwd: "", exited: false }]);
      setWs((w) => W.placeFirstEmptyInActive(w, id));
      setRequestedSession(id);
      setPicking(false);
      setPickError(null);
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 400 || e.status === 422);
      setPickError(`${spec.id} · gagal mulai${noRepo ? " · project belum punya repoDir" : ""}`);
    }
  }

  // SPEC-362 · "Mulai lagi" = sesi BARU dengan konteks yang sama; sesi lamanya sudah mati bersama
  // panenya. Endpoint yang dipakai persis endpoint yang melahirkan sesi jenis itu pertama kali.
  async function restartFromHistory(r: SessionHistoryView) {
    try {
      const born = r.specId
        ? await api.startSession({ spec: r.specId, flow: (r.flow ?? "feature") as Flow })
        : r.kind === "shell"
          ? await api.createShell(r.projectId)
          : r.kind === "terminal"
            // SPEC-517 · runtime baris riwayat ikut, bukan default global: "Mulai lagi" berjanji
            // konteks yang sama, dan sejak runtime bisa dipilih ia bagian dari konteks itu.
            // `agent` kolomnya `String` (bukan enum) — nilai asing jatuh ke claude, cermin
            // pembacaan @hanoman_agent di pty.ts.
            ? await api.createTerminal(r.projectId, {
                agent: r.agent === "codex" ? "codex" : "claude",
                ...(r.model ? { model: r.model } : {}),
                ...(r.effort ? { effort: r.effort } : {}),
              })
            : await api.createTerminalFlow(r.projectId, r.kind as Flow);
      setSessions((s) => (s.some((x) => x.id === born.id)
        ? s
        : [...s, { id: born.id, projectId: r.projectId, specId: r.specId ?? undefined, cwd: "", exited: false }]));
      setWs((w) => W.placeFirstEmptyInActive(w, born.id));
      setRequestedSession(born.id);
      setHistoryOpen(false);
    } catch {
      // Gagal (project tak ter-bind, worktree tak bisa dibuat) — biarkan modal terbuka; pesan
      // detailnya sudah muncul di jalur Start biasa, riwayat tak perlu menduplikasinya.
    }
  }

  // Startable = belum selesai & belum punya sesi hidup di terminal ini (cermin Backlog
  // "Mulai/Lanjutkan": stage !== "done" && !running).
  const activeSpecIds = new Set(
    sessions.filter((s) => s.specId && !s.exited).map((s) => s.specId as string));
  const startable = backlog.filter((s) => s.stage !== "done" && !activeSpecIds.has(s.id));

  // Tutup = kill sesi. Selnya dikosongkan oleh efek rekonsiliasi.
  // SPEC-742 · ADR-0116 · sel dilepas LEBIH DULU, tak menunggu respons: begitu operator menekan
  // Tutup, sesi itu selesai baginya. Tak ada risiko menyembunyikan sesi yang sebenarnya selamat —
  // tmux tetap source of truth dan frame siar `sessions` (1 dtk) mengembalikannya bila DELETE gagal.
  function close(id: string) {
    setSessions((s) => s.filter((x) => x.id !== id));
    void api.deleteTerminal(id).catch(() => {});
  }

  // SPEC-402 · kode keluar dari frame `exit` DISIMPAN, tak lagi dibuang: pane yang mati dengan
  // status ≠ 0 (mis. 143 karena di-SIGTERM `pkill -f` sesi tetangga) harus terbaca sebagai gagal,
  // bukan "Selesai". Daftar sesi dari server juga membawanya, jadi labelnya selamat dari refresh.
  const markExited = React.useCallback((id: string, code?: number) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true, exitCode: code } : x)));
  }, []);

  const place = (idx: number, id: string) => { setActiveCell(idx); setWs((w) => W.placeInActive(w, idx, id)); };
  const placeFirst = (id: string) => { setRequestedSession(id); setWs((w) => W.placeFirstEmptyInActive(w, id)); };
  const detach = (id: string) => setWs((w) => W.detach(w, id));

  const placed = W.placedIds(ws);
  const unplaced = sessions.filter((s) => !placed.has(s.id));

  const layout = W.activeGroup(ws).layout;
  React.useEffect(() => {
    if (!requestedSession) return;
    const index = layout.cells.indexOf(requestedSession);
    if (index < 0) return;
    setActiveCell(index);
    setRequestedSession(null);
  }, [layout.cells, requestedSession]);
  React.useEffect(() => {
    if (activeCell >= layout.cells.length) setActiveCell(Math.max(0, layout.cells.length - 1));
  }, [activeCell, layout.cells.length]);
  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;

  // Overlay menimpa Shell, bukan melepas screen darinya. zIndex 100: di atas konten halaman,
  // di bawah modal (150) dan toast (200) di ds/kit.tsx — kalau dibalik, dialog konfirmasi
  // terkubur di belakang terminal.
  // ponytail: Escape sengaja TIDAK di-bind untuk keluar. Ia tombol tersibuk di TUI Claude Code;
  // merebutnya demi menutup overlay menukar hal yang dipakai tiap menit dengan hal yang dipakai
  // sekali. Keluar lewat tombol saja. Ada test yang menjaga ini.
  const rootStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: maxed ? 8 : 12,
    ...(maxed
      ? { position: "fixed", inset: 0, zIndex: 100, background: "var(--surface-page)",
          paddingTop: "max(12px, var(--safe-top))", paddingRight: "max(12px, var(--safe-right))",
          paddingBottom: "max(12px, var(--safe-bottom))", paddingLeft: "max(12px, var(--safe-left))" }
      : { height: "calc(100dvh - 180px)" }),
  };

  return (
    <div data-testid="terminal-root" style={rootStyle}>
      {/* Saat maximize, tabbar & toolbar melebur jadi satu baris supaya ~110px chrome
          kembali ke grid — itu inti permintaannya. */}
      <div style={{ display: "flex", gap: 8,
        flexDirection: maxed ? "row" : "column", alignItems: maxed ? "center" : "stretch" }}>
        <GroupTabs
          compact={maxed}
          ws={ws}
          onSelect={(id) => setWs((w) => W.selectGroup(w, id))}
          onAdd={() => setWs((w) => W.addGroup(w, `Grup ${w.groups.length + 1}`))}
          onRename={(id, name) => setWs((w) => W.renameGroup(w, id, name))}
          onRemove={(id) => setWs((w) => W.removeGroup(w, id))}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          ...(maxed ? { flex: 1, minWidth: 0 } : {}) }}>
          <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addColumn))}>+ Kolom</Button>
          <Button size="sm" variant="ghost" onClick={() => setWs((w) => W.mapActiveLayout(w, L.addRow))}>+ Baris</Button>
          <div style={{ flex: 1, minWidth: 0 }} />
          {cleanups.length > 0 && (
            <span data-testid="worktree-cleanups"
              title={cleanups.map((c) => `${c.sessionId}${c.error ? ` — ${c.error}` : ""}`).join("\n")}
              style={{ fontSize: 12, color: failedCleanups.length ? "var(--status-err)" : "var(--text-muted)" }}>
              {failedCleanups.length
                ? `${failedCleanups.length} worktree gagal dibersihkan`
                : `membersihkan ${cleanups.length} worktree…`}
            </span>
          )}
          <Select size="sm" value={project} onChange={(e) => setProject(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          <Button size="sm" variant="secondary" leftIcon="inbox"
            onClick={() => { setPickError(null); setPicking(true); }}>Ambil backlog</Button>
          <Button size="sm" variant="secondary" leftIcon="history"
            title="Riwayat sesi yang sudah berlalu — buka kembali atau baca transkripnya"
            onClick={() => setHistoryOpen(true)}>Riwayat</Button>
          <Button size="sm" variant="secondary" leftIcon="terminal"
            title="Buka shell tmux tanpa Claude di project terpilih — jalankan command di project"
            onClick={() => void openShell()}>Terminal biasa</Button>
          {/* SPEC-517 · membuka form runtime dulu (agen · model · effort); sesinya lahir saat
              "Buka sesi" ditekan, dengan pilihan itu sebagai argv pane tmux. */}
          <Button size="sm" leftIcon="plus" onClick={() => setNewOpen(true)}>Sesi baru</Button>
          <IconButton size="sm" icon={maxed ? "minimize-2" : "maximize-2"}
            label={maxed ? "Keluar layar penuh" : "Layar penuh"}
            aria-pressed={maxed} onClick={() => setMaxed((m) => !m)} />
        </div>
      </div>

      {unplaced.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>Belum di grid:</span>
          {unplaced.map((s) => (
            <span key={s.id} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px",
              borderRadius: "var(--radius-sm)", background: "var(--bone-200)",
              border: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 11,
            }}>
              <button className="hn-terminal-unplaced-action" onClick={() => placeFirst(s.id)} title="Taruh di sel kosong pertama grup ini"
                style={{ all: "unset", cursor: "pointer" }}>
                {s.specId ?? nameOf(s.projectId)} · {s.id.slice(0, 6)}
              </button>
              <button type="button" className="hn-terminal-action" aria-label={`Tutup sesi ${s.id}`}
                onClick={() => void close(s.id)}>×</button>
            </span>
          ))}
        </div>
      )}

      {mobile && !showEmpty && (
        <div className="hn-stack-mobile" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tabs aria-label="Panel terminal" variant="pill" value={String(activeCell)}
            onChange={(next) => setActiveCell(Number(next))}
            tabs={layout.cells.map((id, idx) => ({ value: String(idx),
              label: `Panel ${idx + 1}${id ? ` · ${id.slice(0, 6)}` : " · kosong"}` }))} />
          <div className="hn-wrap-mobile" style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="ghost" disabled={layout.cols === 1} aria-label="Hapus kolom aktif"
              onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeColumn(l, activeCell % l.cols)))}>Hapus kolom</Button>
            <Button size="sm" variant="ghost" disabled={layout.rows === 1} aria-label="Hapus baris aktif"
              onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeRow(l, Math.floor(activeCell / l.cols))))}>Hapus baris</Button>
          </div>
        </div>
      )}

      {showEmpty ? (
        // Tanpa `action`: toolbar di atas sudah menawarkan "Sesi baru" — tombol kedua
        // dengan label identik hanya duplikasi, bukan affordance tambahan.
        <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
          hint="Pilih project lalu buka sesi — 'Sesi baru' menjalankan claude --dangerously-skip-permissions di direktori project; 'Terminal biasa' membuka shell tmux polos untuk menjalankan command." />
      ) : (
        <div style={{
          flex: 1, minHeight: 0, display: "grid", gap: 8,
          gridTemplateColumns: mobile ? "minmax(0, 1fr)" : `18px repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: mobile ? "minmax(0, 1fr)" : `16px repeat(${layout.rows}, minmax(0, 1fr))`,
        }}>
          {!mobile && <div />}{/* pojok kiri-atas: perpotongan kedua gutter */}
          {!mobile && Array.from({ length: layout.cols }, (_, c) => (
            <GutterX key={`col-${c}`} label={`Tutup kolom ${c + 1}`} disabled={layout.cols === 1}
              onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeColumn(l, c)))} />
          ))}
          {Array.from({ length: layout.rows }, (_, r) => (
            <React.Fragment key={`row-${r}`}>
              {!mobile && <GutterX label={`Tutup baris ${r + 1}`} disabled={layout.rows === 1}
                onClick={() => setWs((w) => W.mapActiveLayout(w, (l) => L.removeRow(l, r)))} />
              }
              {Array.from({ length: layout.cols }, (_, c) => {
                const idx = r * layout.cols + c;
                const id = layout.cells[idx] ?? null;
                const s = id ? byId(id) : null;
                return (
                  <div key={id ?? `empty-${idx}`} data-terminal-cell-index={idx}
                    aria-hidden={mobile && activeCell !== idx ? "true" : "false"} style={{
                    minHeight: 0, minWidth: 0, display: mobile && activeCell !== idx ? "none" : "flex", flexDirection: "column",
                    border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", overflow: "hidden",
                  }}>
                    {s
                      ? <Cell session={s} nameOf={nameOf} onClose={() => void close(s.id)}
                          onDetach={() => detach(s.id)} onExit={(code) => markExited(s.id, code)} onReview={onOpenReview}
                          onSessionReview={onOpenSessionReview}
                          titleOf={titleOf} onIntegrate={onIntegrate} onIntegrateSession={onIntegrateSession} specOf={specOf}
                          fullscreen={fullId === s.id} onFullscreen={() => setFullId(s.id)} />
                      : <EmptyCell unplaced={unplaced} nameOf={nameOf} onPick={(sid) => place(idx, sid)} />}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}

      {picking && (
        <BacklogPicker seed={startable} activeIds={activeSpecIds} error={pickError}
          onPick={(s) => void pickBacklog(s)} onClose={() => setPicking(false)} />
      )}

      {newOpen && (
        <NewTerminalModal open projectId={project} projectName={nameOf(project)}
          onClose={() => setNewOpen(false)} onCreated={placeNew} />
      )}

      {historyOpen && (
        <SessionHistoryModal projects={projects} onClose={() => setHistoryOpen(false)}
          onRestart={(r) => void restartFromHistory(r)} />
      )}

      {fullId && byId(fullId) && (
        <FullscreenTerminal session={byId(fullId)!}
          label={cellLabel(byId(fullId)!, nameOf, titleOf)}
          onClose={() => setFullId(null)} />
      )}
    </div>
  );
}

// SPEC-232 · label header sel/modal: "project · SPEC-x · judul" (atau hanya project untuk
// sesi tanpa spec). Dipakai bersama oleh Cell dan FullscreenTerminal.
function cellLabel(s: TerminalSession, nameOf: (pid: string) => string,
  titleOf?: (specId: string) => string | undefined): string {
  const proj = nameOf(s.projectId);
  const title = s.specId ? titleOf?.(s.specId) : undefined;
  if (s.specId) return `${proj} · ${s.specId}${title ? ` · ${title}` : ""}`;
  // SPEC-337 · sesi audit lintas LEPAS tak punya spec; tanpa penanda ia tampak seperti terminal biasa.
  return s.id.startsWith("xaudit-") ? `${proj} · audit lintas` : proj;
}

// SPEC-179 · picker backlog dari Terminal. Daftar padat + cari; klik baris = ambil.
// Filter search/stage/prioritas mencermin halaman Backlog (SPEC-178) supaya konsisten.
function BacklogPicker({ seed, activeIds, error, onPick, onClose }: {
  seed: Spec[]; activeIds: Set<string>; error: string | null; onPick: (s: Spec) => void; onClose: () => void;
}) {
  const [q, setQ] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState("all");
  const [prioFilter, setPrioFilter] = React.useState("all");
  // SPEC-198 · search/filter startable via API. Seed dari prop (render instan + tahan mock parsial),
  // lalu refetch dari server. Exclusi sesi aktif tetap di klien (state sesi, bukan filter/paginasi).
  const [items, setItems] = React.useState<Spec[]>(seed);
  const [dq, setDq] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  React.useEffect(() => {
    let alive = true;
    const p = api.listSpecs?.({
      startable: true, q: dq || undefined,
      stage: stageFilter === "all" ? undefined : stageFilter,
      priority: prioFilter === "all" ? undefined : prioFilter,
    });
    p?.then((r) => { if (alive) setItems(r.items); }).catch(() => { });
    return () => { alive = false; };
  }, [dq, stageFilter, prioFilter]);
  const shown = items.filter((s) => !activeIds.has(s.id));
  return (
    <Modal open title="Ambil backlog" icon="inbox" onClose={onClose} width={760}>
      {error && (
        <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: "var(--radius-sm)",
          background: "var(--clay-100)", color: "var(--clay-600)", fontSize: 12 }}>{error}</div>
      )}
      {/* baris penyaring: search + stage + prioritas (startable tak pernah `done`). */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Input size="sm" leftIcon="search" placeholder="mis. invoice atau SPEC-412" aria-label="Cari backlog"
          value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          style={{ flex: "1 1 220px" }} />
        <Select size="sm" aria-label="Filter stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
          options={[{ value: "all", label: "Semua stage" }].concat(
            B_STAGES.filter((s) => s.key !== "done").map((s) => ({ value: s.key, label: s.label })))} />
        <Select size="sm" aria-label="Filter prioritas" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}
          options={[
            { value: "all", label: "Semua prioritas" }, { value: "tinggi", label: "Tinggi" },
            { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" },
          ]} />
      </div>
      {shown.length === 0 ? (
        <StateBlock kind="empty" icon="inbox" title="Tak ada backlog untuk diambil"
          hint="Semua item sudah selesai/aktif atau tak cocok filter — buat brief baru di halaman Backlog." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "62vh", overflowY: "auto" }}>
          {shown.map((s) => (
            <button key={s.id} onClick={() => onPick(s)} style={{
              all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              padding: "9px 8px", borderBottom: "1px solid var(--border-hair)",
            }}>
              <Icon name={s.source === "qa" ? "bug" : s.source === "audit" ? "search" : "lightbulb"} size={14}
                color={s.source === "qa" ? "var(--clay-500)" : s.source === "audit" ? "var(--wind-600)" : "var(--brass-500)"} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)",
                flex: "0 0 78px" }}>{s.id}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-strong)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
              <Badge tone={s.priority === "tinggi" ? "err" : "neutral"} size="sm">{s.priority}</Badge>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11,
                color: "var(--text-muted)" }}>{s.projectId}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// Tab = grup, tiap grup punya grid sendiri. Grup non-aktif tak dirender: pane-nya unmount
// dan WebSocket-nya tertutup. Kembali ke tab itu meng-attach ulang ke sesi tmux yang sama —
// scrollback dipegang tmux (ADR-0016), bukan buffer xterm di memori.
function GroupTabs({ ws, compact = false, onSelect, onAdd, onRename, onRemove }: {
  ws: W.Workspace; compact?: boolean; onSelect: (id: string) => void; onAdd: () => void;
  onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const active = W.activeGroup(ws);
  const only = ws.groups.length === 1;

  return (
    <div role="tablist" aria-label="Grup terminal"
      style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
        // Baris digabung → garis bawah tabbar akan memotong baris chrome di tengah.
        ...(compact ? {} : { borderBottom: "1px solid var(--border-hair)", paddingBottom: 4 }) }}>
      {ws.groups.map((g, index) => {
        const isActive = g.id === active.id;
        if (editing === g.id)
          return <RenameInput key={g.id} initial={g.name}
            onCommit={(name) => { if (name.trim()) onRename(g.id, name.trim()); setEditing(null); }}
            onCancel={() => setEditing(null)} />;
        return (
          <span key={g.id} style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 6px",
            borderRadius: "var(--radius-sm)", fontSize: 12,
            background: isActive ? "var(--bone-200)" : "transparent",
            border: `1px solid ${isActive ? "var(--border-hair)" : "transparent"}`,
          }}>
            <button className="hn-terminal-group-control" role="tab" aria-selected={isActive} tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(g.id)}
              onKeyDown={(event) => {
                let next: number | null = null;
                if (event.key === "ArrowRight") next = (index + 1) % ws.groups.length;
                else if (event.key === "ArrowLeft") next = (index - 1 + ws.groups.length) % ws.groups.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = ws.groups.length - 1;
                if (next === null) return;
                event.preventDefault();
                onSelect(ws.groups[next]!.id);
                event.currentTarget.closest('[role="tablist"]')
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              }}
              style={{ border: 0, padding: 0, background: "transparent", font: "inherit", cursor: "pointer", color: isActive ? "var(--text-strong)" : "var(--text-muted)" }}>
              {g.name}
            </button>
            {isActive && (
              <>
                <button className="hn-terminal-group-control" aria-label={`Ganti nama grup ${g.name}`} title="Ganti nama"
                  onClick={() => setEditing(g.id)}
                  style={{ border: 0, padding: 0, background: "transparent", cursor: "pointer", color: "var(--text-subtle)", fontSize: 10 }}>✎</button>
                <button className="hn-terminal-group-control" aria-label={`Hapus grup ${g.name}`}
                  title={only ? "Grup terakhir tak bisa dihapus" : "Hapus grup (sesi tetap hidup)"}
                  disabled={only} onClick={() => onRemove(g.id)}
                  style={{ border: 0, padding: 0, background: "transparent", cursor: only ? "not-allowed" : "pointer",
                    color: "var(--text-subtle)", opacity: only ? 0.35 : 1 }}>×</button>
              </>
            )}
          </span>
        );
      })}
      <button className="hn-terminal-group-control" aria-label="Grup baru" title="Grup baru" onClick={onAdd}
        style={{ border: 0, background: "transparent", cursor: "pointer", padding: "3px 8px", color: "var(--text-subtle)", fontSize: 12 }}>+</button>
    </div>
  );
}

// Menutup kolom/baris TIDAK mematikan sesi — selnya lenyap, sesinya jatuh ke tray lewat
// placedIds. Karena itu tak ada konfirmasi, sama seperti "lepas".
function GutterX({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={disabled ? "Grid tak boleh menyusut ke nol" : label}
      disabled={disabled} onClick={onClick}
      style={{ all: "unset", display: "grid", placeItems: "center", fontSize: 11, lineHeight: 1,
        color: "var(--text-subtle)", opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "not-allowed" : "pointer" }}>×</button>
  );
}

function RenameInput({ initial, onCommit, onCancel }: {
  initial: string; onCommit: (name: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <input autoFocus aria-label="Nama grup" value={value} placeholder="mis. Rilis"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
      }}
      style={{ width: 100, padding: "3px 6px", fontSize: 12, fontFamily: "var(--font-ui)",
        border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
        background: "var(--surface-card)", color: "var(--text-strong)" }} />
  );
}

// Fase yang DILAPORKAN agen, bukan yang disimpulkan server (SPEC-162). Agen yang lupa menulis
// berkas fasenya meninggalkan strip ini diam — terminalnya sendiri yang jadi kebenaran.
const PHASE_COLOR: Record<Phase["state"], string> = {
  done: "var(--brass)",
  active: "var(--text-strong)",
  skipped: "var(--text-subtle)",
  pending: "var(--text-subtle)",
};
export function PhaseStrip({ phases }: { phases: Phase[] | null }) {
  if (!phases?.length) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "3px 8px", flex: "0 0 auto",
      borderBottom: "1px solid var(--border-hair)", fontSize: 10, fontFamily: "var(--font-mono)",
    }}>
      {phases.map((p) => (
        <span key={p.name} data-state={p.state} title={p.state}
          style={{
            color: PHASE_COLOR[p.state],
            fontWeight: p.state === "active" ? 600 : 400,
            textDecoration: p.state === "skipped" ? "line-through" : "none",
            opacity: p.state === "pending" ? 0.5 : 1,
          }}>
          {p.name}
        </span>
      ))}
    </div>
  );
}

function Cell({ session, nameOf, onClose, onDetach, onExit, onReview, onSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf, fullscreen, onFullscreen }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onDetach: () => void; onExit: (code: number) => void;
  onReview?: (specId: string) => void;
  onSessionReview?: (sessionId: string, title: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: Spec, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => Spec | undefined;
  fullscreen: boolean; onFullscreen: () => void;
}) {
  const [phases, setPhases] = React.useState<Phase[] | null>(null);
  // SPEC-433 · verdict dari server, bukan kesimpulan klien: gerbang plan `- [ ]` (ADR-0029) hanya
  // bisa dibaca di sisi yang memegang worktree-nya.
  const [complete, setComplete] = React.useState(false);
  const onPhases = React.useCallback((p: Phase[], done: boolean) => { setPhases(p); setComplete(done); }, []);
  const [docs, setDocs] = React.useState(false);
  const [integrate, setIntegrate] = React.useState(false);
  const [sessIntegrate, setSessIntegrate] = React.useState(false);
  // SPEC-175 · spec dari specId untuk aksi rebase/merge di header.
  const spec = session.specId ? specOf?.(session.specId) : undefined;
  // SPEC-230 · sesi project-level ber-branch (PRD) tanpa Spec: review + integrate ber-skop sesi.
  const branchSession = !session.specId && !!session.branch;
  const label = cellLabel(session, nameOf, titleOf);
  // SPEC-196 · sesi yang berhenti menunggu keputusan manusia (marker) belum `exited` — beri
  // pembeda sendiri. `exited` menang bila keduanya benar (proses sudah beku).
  const awaiting = !session.exited && !!session.decision;
  // SPEC-409 · ADR-0091 · AC-3 · lead sedang menyusun keputusannya. MENANG atas `awaiting`: keduanya
  // benar bersamaan (marker tetap terisi selama lead berpikir), dan yang perlu dibaca operator adalah
  // "sedang dilayani", bukan "mandek".
  const deciding = !session.exited && !!session.deciding;
  // SPEC-402 · pane mati berkode ≠ 0 = pekerjaan TERPUTUS (agen di-SIGTERM/crash), bukan tuntas.
  // `!!exitCode` sengaja: 0 dan undefined (sesi lama / daftar tanpa kode) tetap "Selesai".
  const failed = session.exited && !!session.exitCode;
  // SPEC-433 · pekerjaan tuntas pada pane yang MASIH HIDUP — keadaan yang dulu tak punya tampilan
  // apa pun. Agen adalah TUI interaktif: sesudah fase terakhir ia kembali ke prompt-nya, jadi
  // `exited` tak pernah menjadi true di jalur sukses dan pil hijau tak pernah bisa muncul.
  // `exited` tetap menang (SPEC-402: bisa di-SIGTERM sesudah baris fase terakhir ditulis).
  const finished = !session.exited && complete;
  const stateIllustration = failed ? null
    : session.exited || finished ? "PST-005"
      : awaiting ? "PST-004" : "PST-003";
  return (
    <>
      <div className="hn-terminal-cell-header" style={{
        display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", flex: "0 0 auto",
        background: failed ? "var(--status-err-tint)"
          : session.exited || finished ? "var(--status-ok-tint)"
            : awaiting ? "var(--status-warn-tint)" : "var(--bone-200)",
        borderBottom: "1px solid var(--border-hair)",
        fontFamily: "var(--font-mono)", fontSize: 11, color: session.exited ? "var(--text-muted)" : "var(--text-body)",
      }}>
        {stateIllustration && (
          <ProductStateIllustration id={stateIllustration} decorative
            style={{ width: 34, flex: "0 0 auto", borderRadius: "var(--radius-sm)" }} />
        )}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label} · {session.id.slice(0, 6)}
        </span>
        {/* SPEC-402 · kode keluar ikut tercetak: "Gagal" tanpa angka menyisakan pertanyaan
            "gagal kenapa", dan angkanya (143 = SIGTERM) itulah petunjuknya. */}
        {session.exited && (failed
          ? <StatusPill status="failed" size="sm">{`Gagal · exit ${session.exitCode}`}</StatusPill>
          : <StatusPill status="done" size="sm">Selesai</StatusPill>)}
        {finished && <StatusPill status="done" size="sm">Selesai</StatusPill>}
        {/* SPEC-433 · `finished` membungkam marker: pada codex marker keputusan MENYALA saat sesi
            selesai wajar (tak ada event Notification → dipasang di Stop+UserPromptSubmit,
            ADR-0074), jadi membiarkan `awaiting` menang mengulang bug ini untuk separuh agen. */}
        {awaiting && !finished && (deciding
          ? <StatusPill status="running" size="sm">Lead memutuskan</StatusPill>
          : <StatusPill status="awaiting" size="sm" />)}
        {/* SPEC-511 · seleksi teks butuh modifier: tmux `mouse on` (SPEC-209) mengirim drag polos
            ke tmux, bukan ke seleksi xterm. Modifier yang tak terlihat = tak ada, jadi petunjuknya
            duduk di baris affordance yang sama dengan dokumen/review/integrate. */}
        <span aria-label="Cara menyalin teks terminal"
          title="Seleksi: tahan Option (macOS) atau Shift (Windows·Linux) sambil drag — pane ini memakai mouse mode tmux. Salin: Cmd+C atau Ctrl+Shift+C. Tempel: Cmd+V atau Ctrl+Shift+V."
          style={{ cursor: "help", color: "var(--text-subtle)", display: "inline-flex", alignItems: "center" }}>
          <Icon name="clipboard" size={12} />
        </span>
        {session.specId && (
          <button type="button" className="hn-terminal-action" onClick={() => setDocs(true)}
            aria-label={`Lihat dokumen sesi ${session.id}`} title="Lihat dokumen (audit/spec/plan)">
            <Icon name="file-text" size={12} />
          </button>
        )}
        {session.specId && onReview && (
          <button type="button" className="hn-terminal-action" onClick={() => onReview(session.specId!)}
            aria-label={`Review sesi ${session.id}`} title="Review perubahan (diff worktree)">
            <Icon name="git-compare" size={12} />
          </button>
        )}
        {/* SPEC-230 · review diff worktree sesi project-level (PRD, tanpa Spec). */}
        {branchSession && onSessionReview && (
          <button type="button" className="hn-terminal-action" onClick={() => onSessionReview(session.id, label)}
            aria-label={`Review sesi ${session.id}`} title="Review perubahan (diff worktree sesi)">
            <Icon name="git-compare" size={12} />
          </button>
        )}
        {/* SPEC-175 · rebase/merge branch hasil spec (muncul hanya bila spec-nya dikenal). */}
        {spec && onIntegrate && (
          <button type="button" className="hn-terminal-action" onClick={() => setIntegrate(true)}
            aria-label={`Integrasikan sesi ${session.id}`} title="Rebase / Merge branch spec">
            <Icon name="git-merge" size={12} />
          </button>
        )}
        {/* SPEC-230 · rebase/merge branch sesi project-level (PRD prd/<slug>). */}
        {branchSession && onIntegrateSession && (
          <button type="button" className="hn-terminal-action" onClick={() => setSessIntegrate(true)}
            aria-label={`Integrasikan sesi ${session.id}`} title="Rebase / Merge branch sesi">
            <Icon name="git-merge" size={12} />
          </button>
        )}
        {/* SPEC-232 · lihat SATU terminal ini secara penuh dalam modal. */}
        <button type="button" className="hn-terminal-action" onClick={onFullscreen} title="Layar penuh — fokus 1 terminal"
          aria-label={`Layar penuh sesi ${session.id}`}
        >
          <Icon name="fullscreen" size={12} />
        </button>
        <button type="button" className="hn-terminal-action hn-terminal-action--text" onClick={onDetach}
          title="Lepas dari grid (sesi tetap hidup)">lepas</button>
        <button type="button" className="hn-terminal-action" aria-label={`Tutup sesi ${session.id}`}
          onClick={onClose}>×</button>
      </div>
      {/* Sesi berakhir (SPEC-188): badan diredupkan agar terbaca beku; header + badge
          "Selesai" tetap penuh supaya statusnya justru paling kontras. */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
        opacity: session.exited ? 0.6 : 1 }}>
        <PhaseStrip phases={phases} />
        {/* key = identitas sesi: pindah antar sel memindah subtree, bukan me-remount WebSocket.
            SPEC-232 · saat sel ini sedang layar-penuh, pane-nya dilepas (placeholder) supaya
            hanya modal yang meng-attach tmux — jaga invariant satu sesi = satu attach. */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {fullscreen
            ? <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 12,
                color: "var(--text-subtle)", fontSize: 12, textAlign: "center" }}>
                Terbuka di layar penuh
              </div>
            : <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={onPhases} />}
        </div>
      </div>
      {docs && session.specId && <SpecDocsModal specId={session.specId} onClose={() => setDocs(false)} />}
      {integrate && spec && onIntegrate && (
        <IntegrateDialog projectId={spec.projectId}
          ownBranch={`hanoman/${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`} eyebrow={spec.id}
          onClose={() => setIntegrate(false)}
          onIntegrate={(op, target) => { setIntegrate(false); onIntegrate(spec, op, target); }} />
      )}
      {sessIntegrate && branchSession && onIntegrateSession && (
        <IntegrateDialog projectId={session.projectId} ownBranch={session.branch!} eyebrow={session.id.slice(0, 16)}
          onClose={() => setSessIntegrate(false)}
          onIntegrate={(op, target) => { setSessIntegrate(false); onIntegrateSession(session, op, target); }} />
      )}
    </>
  );
}

// SPEC-232 · fullscreen SATU terminal sebagai modal. Pane-nya hidup di sini; sel asalnya
// menampilkan placeholder (lihat Cell) supaya tmux tetap satu attach. closeOnEscape=false:
// Escape tombol tersibuk TUI Claude Code — keluar via × / backdrop saja (sejalan maximize-grid,
// SPEC-163). Menutup modal memasang ulang pane di sel (reconnect murah; scrollback dari tmux).
function FullscreenTerminal({ session, label, onClose }: {
  session: TerminalSession; label: string; onClose: () => void;
}) {
  return (
    <Modal open icon="terminal" title={label} onClose={onClose} closeOnEscape={false} width={1600}>
      <div style={{ height: "min(72vh, calc(100dvh - 180px))", minHeight: 0, display: "flex", flexDirection: "column",
        opacity: session.exited ? 0.6 : 1 }}>
        <TerminalPane key={session.id} sessionId={session.id} onExit={() => {}} />
      </div>
    </Modal>
  );
}

function EmptyCell({ unplaced, nameOf, onPick }: {
  unplaced: TerminalSession[]; nameOf: (pid: string) => string; onPick: (id: string) => void;
}) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 12 }}>
      <Select size="sm" value="" aria-label="Pilih sesi untuk sel" disabled={!unplaced.length}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        options={[{ value: "", label: unplaced.length ? "Pilih sesi…" : "tidak ada sesi bebas" }]
          .concat(unplaced.map((s) => ({
            value: s.id,
            label: `${s.specId ?? nameOf(s.projectId)} · ${s.id.slice(0, 6)}`,
          })))} />
    </div>
  );
}
