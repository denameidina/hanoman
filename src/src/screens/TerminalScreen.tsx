import React from "react";
import { Button, IconButton, Icon, Select, StateBlock, Modal, Input, Badge, StatusPill,
  ProductStateIllustration, Tabs, OverflowActions, useResponsiveTier, useCoarsePointer,
  type OverflowItem } from "../ds";
import { api, ApiError, type TerminalSession, type Phase, type Flow } from "../api/client";
import { subscribe } from "../api/events";
import { flowForSource, sameTerminalWorkspace, type SessionHistoryView, type WorktreeCleanupView } from "@hanoman/shared";
import { TerminalPane } from "./TerminalPane";
import { SessionHistoryModal } from "./SessionHistoryModal";
import { NewTerminalModal } from "./NewTerminalModal";
import { SpecDocsModal } from "./SpecDocsModal";
import { IntegrateDialog } from "./IntegrateDialog";
import { B_STAGES } from "./BacklogScreen";
import type { Spec } from "./types";
import * as L from "./terminal-layout";
import * as W from "./terminal-workspace";
import { useTerminalWorkspace } from "./use-terminal-workspace";
import { usePersistedState, isStr, isBool, isNum } from "../ui-state";
import { clampFontSize, inlineActionCount, FONT_DEFAULT, FONT_DEFAULT_MOBILE,
  FONT_MIN, FONT_MAX } from "./terminal-chrome";

export function TerminalScreen({ userId = "test-user", projects, backlog = [], focusSession, onOpenReview, onOpenSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf }: {
  userId?: string;
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
  const workspaceController = useTerminalWorkspace(userId);
  const {
    workspace: ws,
    status: workspaceStatus,
    message: workspaceMessage,
    writable: workspaceWritable,
    mutate: mutateWorkspace,
    setActive: setActiveGroup,
    refresh: refreshWorkspace,
  } = workspaceController;
  // Project pemilih sesi baru tetap presentasional dan lokal; hanya mapping grid yang kanonik.
  const [project, setProject] = usePersistedState("terminal", "project", projects[0]?.id ?? "", isStr);
  // SPEC-800 · ukuran font & papan tombol adalah state TAMPILAN (SPEC-740 · ADR-0115): lokal per
  // browser, bukan bagian payload workspace kanonik per-user (SPEC-786 · ADR-0118).
  const coarse = useCoarsePointer();
  const [fontSize, setFontSize] = usePersistedState(
    "terminal", "fontSize", coarse ? FONT_DEFAULT_MOBILE : FONT_DEFAULT, isNum);
  const [keysOpen, setKeysOpen] = usePersistedState("terminal", "keys", coarse, isBool);
  // SPEC-856 · echo prediktif lokal. State TAMPILAN per browser seperti ukuran font & papan
  // tombol (SPEC-740 · ADR-0115), bukan payload workspace kanonik per-user (ADR-0118) — dan
  // sekaligus alat ukur sebelum/sesudah: satu build, satu variabel.
  const [predict, setPredict] = usePersistedState("terminal", "predict", true, isBool);
  const bumpFont = (delta: number) => setFontSize((n) => clampFontSize(n + delta));
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

  const [sessionsLoaded, setSessionsLoaded] = React.useState(false);
  React.useEffect(() => {
    api.listTerminals().then((current) => {
      setSessions(current);
      setSessionsLoaded(true);
    }).catch(() => {});
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
  // Ditahan sampai kedua sumber otoritatif siap. Gagal memuat tmux bukan bukti bahwa semua sesi
  // hilang, dan cache recovery bukan kewenangan untuk menulis server.
  React.useEffect(() => {
    if (!sessionsLoaded || !workspaceWritable) return;
    const liveIds = new Set(sessions.map((session) => session.id));
    const reconciled = W.reconcileAll(ws, liveIds);
    if (sameTerminalWorkspace(W.toCanonical(reconciled), W.toCanonical(ws))) return;
    void mutateWorkspace((current) => W.reconcileAll(current, liveIds));
  }, [mutateWorkspace, sessions, sessionsLoaded, workspaceWritable, ws]);

  // SPEC-184 · notifikasi mengarahkan ke sesi tertentu → tempatkan ke grid aktif begitu sesi itu
  // muncul di daftar hidup. SPEC-197 · efek ini jalan tiap `sessions` berubah; tanpa guard, sesi
  // fokus yang sudah tampil bisa "loncat" ke sel-kosong-pertama saat sesi lain exit. Hanya place
  // bila belum ada di grid mana pun (placedIds); kalau sudah, kembalikan w apa adanya (no-op).
  React.useEffect(() => {
    if (!focusSession) { handledFocus.current = null; return; }
    if (!sessionsLoaded || handledFocus.current === focusSession) return;
    if (!sessions.some((s) => s.id === focusSession && !s.exited)) return;
    handledFocus.current = focusSession;
    setRequestedSession(focusSession);
  }, [focusSession, sessions, sessionsLoaded]);

  React.useEffect(() => {
    if (!requestedSession) return;
    const existing = ws.groups.find((group) => group.layout.cells.includes(requestedSession));
    if (existing) {
      if (existing.id !== ws.active) setActiveGroup(existing.id);
      return;
    }
    if (!workspaceWritable) return;
    void mutateWorkspace((current) => {
      // Gerbang `existing` di atas membaca `ws` HASIL RENDER, dan `mutate` menempuh round-trip
      // server: pemanggil yang sudah menaruh sendiri (placeFirst/placeNew/openShell/pickBacklog
      // → placeFirstEmptyInActive, lalu setRequestedSession) belum terlihat di sana saat efek ini
      // jalan. Tanpa gerbang kedua di dalam `change` — satu-satunya tempat yang melihat workspace
      // terbaru — place kedua ini menemukan sel kosong pertama BERIKUTNYA dan menggeser sesi satu
      // sel dari tempat mendaratnya. Sudah tertempel = tak ada yang perlu dikerjakan.
      if (W.placedIds(current).has(requestedSession)) return current;
      const placed = W.placeFirstEmptyInActive(current, requestedSession);
      if (placed !== current || !mobile) return placed;
      return W.placeInActive(current, activeCell, requestedSession);
    });
  }, [activeCell, mobile, mutateWorkspace, requestedSession, setActiveGroup, workspaceWritable, ws]);

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
    void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
    setRequestedSession(id);
  }

  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project terpilih. Cermin
  // openNew, tapi memanggil createShell — server men-spawn $SHELL, bukan claude.
  async function openShell() {
    if (!project) return;
    const { id } = await api.createShell(project);
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
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
      void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
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
      void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, born.id));
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

  const place = (idx: number, id: string) => {
    setActiveCell(idx);
    void mutateWorkspace((current) => W.placeInActive(current, idx, id));
  };
  const placeFirst = (id: string) => {
    setRequestedSession(id);
    void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
  };
  const detach = (id: string) => { void mutateWorkspace((current) => W.detach(current, id)); };

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

  // SPEC-800 · kontrol tampilan tinggal di panel, bukan di toolbar: keduanya dipakai sekali lalu
  // dilupakan, dan menaruhnya inline melawan tujuan "pane dapat ruang layar terbesar".
  const displayControls = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
      <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-muted)" }}>Ukuran teks terminal</span>
        <IconButton size="sm" icon="minus" label="Perkecil teks terminal"
          disabled={fontSize <= FONT_MIN} onClick={() => bumpFont(-1)} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 44, textAlign: "center" }}>
          {fontSize}px
        </span>
        <IconButton size="sm" icon="plus" label="Perbesar teks terminal"
          disabled={fontSize >= FONT_MAX} onClick={() => bumpFont(1)} />
      </div>
      <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-muted)" }}>
          Papan tombol layar (Esc · panah · Enter)
        </span>
        <Button size="sm" variant="secondary" aria-pressed={keysOpen}
          onClick={() => setKeysOpen((on) => !on)}>{keysOpen ? "Sembunyikan" : "Tampilkan"}</Button>
      </div>
      <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-muted)" }}>
          Ketik responsif (huruf tampil sebelum echo server)
        </span>
        <Button size="sm" variant="secondary" aria-pressed={predict}
          aria-label={`${predict ? "Matikan" : "Nyalakan"} ketik responsif`}
          onClick={() => setPredict((on) => !on)}>{predict ? "Matikan" : "Nyalakan"}</Button>
      </div>
      {mobile && (
        <Select size="sm" aria-label="Project sesi baru" value={project}
          onChange={(e) => setProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      )}
    </div>
  );

  const toolbarItems: OverflowItem[] = [
    { key: "backlog", label: "Ambil backlog", icon: "inbox",
      onSelect: () => { setPickError(null); setPicking(true); } },
    { key: "history", label: "Riwayat sesi", icon: "history", onSelect: () => setHistoryOpen(true) },
    { key: "shell", label: "Terminal biasa", icon: "terminal", onSelect: () => void openShell() },
    { key: "col+", label: "+ Kolom", icon: "columns-2", disabled: !workspaceWritable,
      onSelect: () => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addColumn)) },
    { key: "row+", label: "+ Baris", icon: "rows-2", disabled: !workspaceWritable,
      onSelect: () => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addRow)) },
    { key: "col-", label: "Hapus kolom aktif", icon: "columns-2",
      disabled: !workspaceWritable || layout.cols === 1,
      onSelect: () => void mutateWorkspace((current) =>
        W.mapActiveLayout(current, (l) => L.removeColumn(l, activeCell % l.cols))) },
    { key: "row-", label: "Hapus baris aktif", icon: "rows-2",
      disabled: !workspaceWritable || layout.rows === 1,
      onSelect: () => void mutateWorkspace((current) =>
        W.mapActiveLayout(current, (l) => L.removeRow(l, Math.floor(activeCell / l.cols)))) },
  ];

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
      : { flex: "1 1 0", minHeight: 640 }),
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
          writable={workspaceWritable}
          onSelect={setActiveGroup}
          onAdd={() => void mutateWorkspace((current) => W.addGroup(current, `Grup ${current.groups.length + 1}`))}
          onRename={(id, name) => void mutateWorkspace((current) => W.renameGroup(current, id, name))}
          onRemove={(id) => void mutateWorkspace((current) => W.removeGroup(current, id))}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          ...(maxed ? { flex: 1, minWidth: 0 } : {}) }}>
          {!mobile && (
            <>
              <Button size="sm" variant="ghost" disabled={!workspaceWritable}
                onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addColumn))}>+ Kolom</Button>
              <Button size="sm" variant="ghost" disabled={!workspaceWritable}
                onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addRow))}>+ Baris</Button>
            </>
          )}
          <div style={{ flex: 1, minWidth: 0 }} />
          {workspaceStatus !== "ready" && (
            <span data-testid="terminal-workspace-status" title={workspaceMessage ?? undefined}
              style={{ fontSize: 12, color: workspaceStatus === "conflict" ? "var(--status-warn)" : "var(--text-muted)" }}>
              {workspaceStatus === "loading"
                ? "Memuat layout server…"
                : workspaceStatus === "recovering"
                  ? <><span>Layout server belum tersambung</span>{" "}
                      <button type="button" onClick={() => void refreshWorkspace()}>Retry</button></>
                  : workspaceMessage ?? "Layout berubah di perangkat lain"}
            </span>
          )}
          {cleanups.length > 0 && (
            <span data-testid="worktree-cleanups"
              title={cleanups.map((c) => `${c.sessionId}${c.error ? ` — ${c.error}` : ""}`).join("\n")}
              style={{ fontSize: 12, color: failedCleanups.length ? "var(--status-err)" : "var(--text-muted)" }}>
              {failedCleanups.length
                ? `${failedCleanups.length} worktree gagal dibersihkan`
                : `membersihkan ${cleanups.length} worktree…`}
            </span>
          )}
          {!mobile && (
            <>
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
            </>
          )}
          {/* SPEC-517 · membuka form runtime dulu (agen · model · effort); sesinya lahir saat
              "Buka sesi" ditekan, dengan pilihan itu sebagai argv pane tmux. */}
          <Button size="sm" leftIcon="plus" onClick={() => setNewOpen(true)}>Sesi baru</Button>
          {/* SPEC-800 · di mobile aksi sekunder pindah ke satu panel supaya pane mendapat ruang
              layar terbesar; di desktop panel ini hanya memuat kontrol tampilan. */}
          <OverflowActions label={mobile ? "Aksi terminal lain" : "Tampilan terminal"}
            items={mobile ? toolbarItems : []}>{displayControls}</OverflowActions>
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
              <button className="hn-terminal-unplaced-action" disabled={!workspaceWritable}
                onClick={() => placeFirst(s.id)} title="Taruh di sel kosong pertama grup ini"
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
            <GutterX key={`col-${c}`} label={`Tutup kolom ${c + 1}`} disabled={!workspaceWritable || layout.cols === 1}
              onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, (l) => L.removeColumn(l, c)))} />
          ))}
          {Array.from({ length: layout.rows }, (_, r) => (
            <React.Fragment key={`row-${r}`}>
              {!mobile && <GutterX label={`Tutup baris ${r + 1}`} disabled={!workspaceWritable || layout.rows === 1}
                onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, (l) => L.removeRow(l, r)))} />
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
                          canArrange={workspaceWritable} onDetach={() => detach(s.id)} onExit={(code) => markExited(s.id, code)} onReview={onOpenReview}
                          onSessionReview={onOpenSessionReview}
                          titleOf={titleOf} onIntegrate={onIntegrate} onIntegrateSession={onIntegrateSession} specOf={specOf}
                          fontSize={fontSize} showKeys={keysOpen} predict={predict}
                          fullscreen={fullId === s.id} onFullscreen={() => setFullId(s.id)} />
                      : <EmptyCell disabled={!workspaceWritable} unplaced={unplaced} nameOf={nameOf} onPick={(sid) => place(idx, sid)} />}
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
          fontSize={fontSize} showKeys={keysOpen} predict={predict}
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
            // SPEC-763 · `all: "unset"` dulu ada di sini dan memakan DUA aturan sekaligus: ia
            // inline, jadi ia menang atas `button { min-height: var(--touch-target) }` (baris jadi
            // 39px, di bawah minimum 44px) DAN atas `flex-wrap` milik `.hn-dense-row`. Reset
            // eksplisit per properti memulihkan keduanya tanpa `!important` baru.
            // `flex: 0 0 auto` wajib: daftarnya flex-column ber-`maxHeight`, jadi barisnya boleh
            // menyusut di bawah kontennya — terukur tombol 44px memuat isi 66px, dan judul yang
            // membungkus MENIMPA baris di bawahnya. Akar yang sama dengan tab yang tumpah.
            <button key={s.id} onClick={() => onPick(s)} style={{
              cursor: "pointer", display: "block", width: "100%", flex: "0 0 auto",
              font: "inherit", color: "inherit", textAlign: "left", background: "transparent",
              padding: "9px 8px", border: "none", borderBottom: "1px solid var(--border-hair)",
            }}>
              {/* Baris flex-nya hidup di dalam <span>, bukan di <button> itu sendiri: kotak tombol
                  tidak menumbuhkan tingginya untuk baris flex yang membungkus, sehingga judul yang
                  turun ke baris kedua menimpa baris berikutnya (terlihat langsung di 390px). */}
              <span className="hn-dense-row hn-picker-row" style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                <Icon name={s.source === "qa" ? "bug" : s.source === "audit" ? "search" : "lightbulb"} size={14}
                  color={s.source === "qa" ? "var(--clay-500)" : s.source === "audit" ? "var(--wind-600)" : "var(--brass-500)"} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)",
                  flex: "0 0 78px" }}>{s.id}</span>
                <span className="hn-picker-title" style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-strong)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                <Badge tone={s.priority === "tinggi" ? "err" : "neutral"} size="sm">{s.priority}</Badge>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, flex: "0 1 auto", minWidth: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: "var(--text-muted)" }}>{s.projectId}</span>
              </span>
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
function GroupTabs({ ws, compact = false, writable, onSelect, onAdd, onRename, onRemove }: {
  ws: W.Workspace; compact?: boolean; writable: boolean; onSelect: (id: string) => void; onAdd: () => void;
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
            {isActive && writable && (
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
      <button className="hn-terminal-group-control" aria-label="Grup baru" title="Grup baru"
        disabled={!writable} onClick={onAdd}
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

function Cell({ session, nameOf, onClose, canArrange, onDetach, onExit, onReview, onSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf, fontSize, showKeys, predict, fullscreen, onFullscreen }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; canArrange: boolean; onDetach: () => void; onExit: (code: number) => void;
  onReview?: (specId: string) => void;
  onSessionReview?: (sessionId: string, title: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: Spec, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => Spec | undefined;
  fontSize: number; showKeys: boolean; predict: boolean;
  fullscreen: boolean; onFullscreen: () => void;
}) {
  const [phases, setPhases] = React.useState<Phase[] | null>(null);
  // SPEC-800 · yang menentukan bukan lebar viewport melainkan lebar SEL: grid 4 kolom di desktop
  // 1440px memberi tiap sel ~340px, lebih sempit daripada satu pane di ponsel 390px. Selnya
  // `overflow: hidden`, jadi aksi yang tak muat bukan cuma tak terbaca — ia tak bisa diklik.
  const headerRef = React.useRef<HTMLDivElement>(null);
  const [headerWidth, setHeaderWidth] = React.useState(Number.POSITIVE_INFINITY);
  const coarse = useCoarsePointer();
  React.useEffect(() => {
    const el = headerRef.current;
    // jsdom tak punya ResizeObserver; lebar yang tak terukur = semua aksi inline (perilaku lama).
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      if (width > 0) setHeaderWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  // Aksi yang boleh runtuh; `Layar penuh` + `Tutup` sengaja di luar daftar ini karena keduanya
  // jalan keluar, bukan aksi tambahan. `render` = bentuk inline-nya, sisanya kontrak overflow.
  const collapsible: (OverflowItem & { render: React.ReactNode })[] = [
    ...(session.specId ? [{
      key: "docs", label: "Lihat dokumen", icon: "file-text",
      title: "Lihat dokumen (audit/spec/plan)", onSelect: () => setDocs(true),
      render: (
        <button type="button" key="docs" className="hn-terminal-action" onClick={() => setDocs(true)}
          aria-label={`Lihat dokumen sesi ${session.id}`} title="Lihat dokumen (audit/spec/plan)">
          <Icon name="file-text" size={12} />
        </button>
      ),
    }] : []),
    ...(session.specId && onReview ? [{
      key: "review", label: "Review perubahan", icon: "git-compare",
      title: "Review perubahan (diff worktree)", onSelect: () => onReview(session.specId!),
      render: (
        <button type="button" key="review" className="hn-terminal-action" onClick={() => onReview(session.specId!)}
          aria-label={`Review sesi ${session.id}`} title="Review perubahan (diff worktree)">
          <Icon name="git-compare" size={12} />
        </button>
      ),
    }] : []),
    // SPEC-230 · review diff worktree sesi project-level (PRD, tanpa Spec).
    ...(branchSession && onSessionReview ? [{
      key: "review-session", label: "Review perubahan", icon: "git-compare",
      title: "Review perubahan (diff worktree sesi)", onSelect: () => onSessionReview(session.id, label),
      render: (
        <button type="button" key="review-session" className="hn-terminal-action"
          onClick={() => onSessionReview(session.id, label)}
          aria-label={`Review sesi ${session.id}`} title="Review perubahan (diff worktree sesi)">
          <Icon name="git-compare" size={12} />
        </button>
      ),
    }] : []),
    // SPEC-175 · rebase/merge branch hasil spec (muncul hanya bila spec-nya dikenal).
    ...(spec && onIntegrate ? [{
      key: "integrate", label: "Rebase / Merge branch", icon: "git-merge",
      title: "Rebase / Merge branch spec", onSelect: () => setIntegrate(true),
      render: (
        <button type="button" key="integrate" className="hn-terminal-action" onClick={() => setIntegrate(true)}
          aria-label={`Integrasikan sesi ${session.id}`} title="Rebase / Merge branch spec">
          <Icon name="git-merge" size={12} />
        </button>
      ),
    }] : []),
    // SPEC-230 · rebase/merge branch sesi project-level (PRD prd/<slug>).
    ...(branchSession && onIntegrateSession ? [{
      key: "integrate-session", label: "Rebase / Merge branch", icon: "git-merge",
      title: "Rebase / Merge branch sesi", onSelect: () => setSessIntegrate(true),
      render: (
        <button type="button" key="integrate-session" className="hn-terminal-action"
          onClick={() => setSessIntegrate(true)}
          aria-label={`Integrasikan sesi ${session.id}`} title="Rebase / Merge branch sesi">
          <Icon name="git-merge" size={12} />
        </button>
      ),
    }] : []),
    {
      key: "detach", label: "Lepas dari grid", icon: "unlink", disabled: !canArrange,
      title: "Lepas dari grid (sesi tetap hidup)", onSelect: onDetach,
      render: (
        <button type="button" key="detach" className="hn-terminal-action hn-terminal-action--text"
          onClick={onDetach} disabled={!canArrange}
          title="Lepas dari grid (sesi tetap hidup)">lepas</button>
      ),
    },
  ];
  const inline = inlineActionCount(headerWidth, collapsible.length, coarse ? 44 : 28);
  const hidden = collapsible.slice(inline);
  return (
    <>
      <div ref={headerRef} className="hn-terminal-cell-header" style={{
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
        {/* Aksi sel duduk di klaster ber-gap sendiri (lebih rapat dari gap header): tombolnya
            sudah punya target sentuh 28/44px, jadi jarak antar-tombol tak perlu selebar jarak
            label↔status. Angkanya dicerminkan `ACTION_GAP` supaya aritmetika kolaps ikut. */}
        <span className="hn-terminal-actions">
          {collapsible.slice(0, inline).map((action) => action.render)}
          {hidden.length > 0 && (
            <OverflowActions label={`Aksi lain sesi ${session.id}`}
              items={hidden.map(({ render: _render, ...item }) => item)} />
          )}
          {/* SPEC-232 · lihat SATU terminal ini secara penuh dalam modal. */}
          <button type="button" className="hn-terminal-action" onClick={onFullscreen} title="Layar penuh — fokus 1 terminal"
            aria-label={`Layar penuh sesi ${session.id}`}
          >
            <Icon name="fullscreen" size={12} />
          </button>
          <button type="button" className="hn-terminal-action" aria-label={`Tutup sesi ${session.id}`}
            onClick={onClose}>×</button>
        </span>
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
            : <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={onPhases}
                fontSize={fontSize} showKeys={showKeys} predict={predict} />}
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
function FullscreenTerminal({ session, label, fontSize, showKeys, predict, onClose }: {
  session: TerminalSession; label: string; fontSize: number; showKeys: boolean; predict: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open icon="terminal" title={label} onClose={onClose} closeOnEscape={false} width={1600}>
      <div style={{ height: "min(72vh, calc(100dvh - 180px))", minHeight: 0, display: "flex", flexDirection: "column",
        opacity: session.exited ? 0.6 : 1 }}>
        <TerminalPane key={session.id} sessionId={session.id} onExit={() => {}}
          fontSize={fontSize} showKeys={showKeys} predict={predict} />
      </div>
    </Modal>
  );
}

function EmptyCell({ unplaced, nameOf, onPick, disabled }: {
  unplaced: TerminalSession[]; nameOf: (pid: string) => string; onPick: (id: string) => void; disabled: boolean;
}) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 12 }}>
      <Select size="sm" value="" aria-label="Pilih sesi untuk sel" disabled={disabled || !unplaced.length}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        options={[{ value: "", label: unplaced.length ? "Pilih sesi…" : "tidak ada sesi bebas" }]
          .concat(unplaced.map((s) => ({
            value: s.id,
            label: `${s.specId ?? nameOf(s.projectId)} · ${s.id.slice(0, 6)}`,
          })))} />
    </div>
  );
}
