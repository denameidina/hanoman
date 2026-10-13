import React from "react";
import { subscribeTick } from "../lib/shared-ticker";
import { Button, IconButton, Icon, Select, StateBlock, Modal, Input, Badge, StatusPill, Callout,
  ProductStateIllustration, Tabs, OverflowActions, useResponsiveTier, useCoarsePointer, usePopoverFocus,
  useConfirm, useToast, Toast, type OverflowItem } from "../ds";
import { failureMessage } from "../lib/report-error";
import { SESSION_ENDED_NOTICE, SESSION_HISTORY_ACTION } from "../lib/labels";
import { api, ApiError, type TerminalSession, type Phase, type Flow } from "../api/client";
import { subscribe } from "../api/events";
import { flowForSource, sameTerminalWorkspace, type SessionHistoryView, type WorktreeCleanupView } from "@hanoman/shared";
import { TerminalPane } from "./TerminalPane";
import { SessionHistoryModal } from "./SessionHistoryModal";
import { NewTerminalModal } from "./NewTerminalModal";
import { NewShellModal } from "./NewShellModal";
import { SpecDocsModal } from "./SpecDocsModal";
import { IntegrateDialog } from "./IntegrateDialog";
import { B_STAGES } from "./BacklogScreen";
import type { SpecSlim } from "./types";
import * as L from "./terminal-layout";
import * as W from "./terminal-workspace";
import { useTerminalWorkspace } from "./use-terminal-workspace";
import { useLaunchAdmission } from "./use-launch-admission";
import { usePersistedState, isStr, isBool, isNum } from "../ui-state";
import { clampFontSize, shouldCollapseToTabs, FONT_DEFAULT, FONT_DEFAULT_MOBILE,
  FONT_MIN, FONT_MAX, MIN_PANE_WIDTH } from "./terminal-chrome";
import { chipAccessibleName, chipTone, formatDuration, modelLabel, type ChipTone } from "./phase-chip";
import { RAIL_PILL, SessionRail, type RailItem } from "./TerminalRail";
import { groupByProject, isTerminalView, railStartedMs, railStatus, resolveFocus, sortRail, type TerminalView } from "./terminal-rail";
import { relativeTime } from "../lib/time-format";
import "./styles/terminal.css";

// Default prop bernilai literal `[]` baru tiap render akan mematahkan memo `Cell`.
const NO_BACKLOG: SpecSlim[] = [];

// Project yang punya checkout di mesin ini: binding per-mesin menang atas repoDir (SPEC-213), cermin
// `p.binding ?? p.repoDir` di MissingRepoCard. Dipakai hanya untuk MEMILIH default; server tetap yang
// memutuskan saat sesi dibuka (400 {needsBind}).
type TerminalProject = { id: string; name: string; binding?: string | null; repoDir?: string | null };
const hasCheckout = (p: TerminalProject) => !!(p.binding ?? p.repoDir);
const defaultProjectId = (ps: TerminalProject[]) => (ps.find(hasCheckout) ?? ps[0])?.id ?? "";
// Galat "belum di-bind" dari POST /api/terminal/sessions: 400 dengan `needsBind: true` di body.
const isNeedsBind = (e: unknown) => e instanceof ApiError && e.status === 400
  && typeof e.detail === "object" && e.detail !== null && (e.detail as { needsBind?: unknown }).needsBind === true;

// Dialog per sesi (dokumen, integrasi) dipegang layar, bukan sel: rail, pane fokus, dan sel grid
// memakai satu menu yang sama (Audit UI/UX 2026-10 · Fase 3E).
type SessionDialogKind = "docs" | "integrate" | "sessIntegrate";

export function TerminalScreen({ userId = "test-user", projects, backlog = NO_BACKLOG, focusSession, startedSession, onStartedSessionHandled, onStartBacklog, onOpenReview, onOpenSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf, sessions: sessionsProp, setSessions: setSessionsProp, onOpenProject }: {
  userId?: string;
  projects: TerminalProject[]; backlog?: SpecSlim[]; focusSession?: string | null;
  // Tujuan aksi "Buka project" di toast galat "belum terhubung": kartu checkout ada di layar project.
  onOpenProject?: (projectId: string) => void;
  // SPEC-252/0164 · App owns the shared StartSessionModal so Terminal and Backlog use one picker.
  onStartBacklog?: (spec: SpecSlim) => void;
  // Keep the just-created session visible immediately; the WS snapshot remains authoritative.
  startedSession?: Pick<TerminalSession, "id" | "projectId" | "specId" | "flow"> | null;
  onStartedSessionHandled?: () => void;
  onOpenReview?: (specId: string) => void;
  onOpenSessionReview?: (sessionId: string, title: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: SpecSlim, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => SpecSlim | undefined;
  // SPEC-1267 · daftar sesi milik App (satu langganan `sessions` untuk seluruh aplikasi). Tanpa prop
  // ini layar memegang salinannya sendiri dan berlangganan sendiri.
  sessions?: TerminalSession[];
  setSessions?: React.Dispatch<React.SetStateAction<TerminalSession[]>>;
}) {
  const [ownSessions, setOwnSessions] = React.useState<TerminalSession[]>([]);
  const sessions = sessionsProp ?? ownSessions;
  const setSessions = setSessionsProp ?? setOwnSessions;
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
  // Default = project pertama yang sudah punya checkout di mesin ini; bila tak ada, project pertama.
  const [project, setProject] = usePersistedState("terminal", "project", defaultProjectId(projects), isStr);
  // SPEC-800 · ukuran font & papan tombol adalah state TAMPILAN (SPEC-740 · ADR-0115): lokal per
  // browser, bukan bagian payload workspace kanonik per-user (SPEC-786 · ADR-0118).
  const coarse = useCoarsePointer();
  const tier = useResponsiveTier();
  const mobile = tier === "mobile";
  const [fontSize, setFontSize] = usePersistedState(
    "terminal", "fontSize", coarse ? FONT_DEFAULT_MOBILE : FONT_DEFAULT, isNum);
  // Audit UI/UX 2026-10 · Fase 3E+ · ponsel memulai dengan papan tombol TERTUTUP: composer adalah
  // jalan utama, dan 7 tombol itu memakan sepertiga layar. Tablet sentuh tetap terbuka seperti dulu.
  // Pilihan operator yang sudah tersimpan tetap menang atas default ini.
  const [keysOpen, setKeysOpen] = usePersistedState("terminal", "keys", coarse && !mobile, isBool);
  // SPEC-856 · echo prediktif lokal. State TAMPILAN per browser seperti ukuran font & papan
  // tombol (SPEC-740 · ADR-0115), bukan payload workspace kanonik per-user (ADR-0118) — dan
  // sekaligus alat ukur sebelum/sesudah: satu build, satu variabel.
  const [predict, setPredict] = usePersistedState("terminal", "predict", true, isBool);
  // Perekam diagnostik jalur input. Default MATI dan sengaja tidak lengket ke ingatan operator
  // sebagai fitur harian: ia merekam setiap tombol yang ditekan di pane, jadi ia alat investigasi
  // yang dinyalakan saat dibutuhkan lalu dimatikan lagi.
  const [diag, setDiag] = usePersistedState("terminal", "diag", false, isBool);
  // Audit UI/UX 2026-10 · keputusan 15: mode pembaca layar xterm. OPSIONAL dan default MATI, karena ia
  // mengekspos teks terminal ke DOM dengan biaya kecepatan. Tab tetap dikirim ke sesi, dan
  // Ctrl+Shift+Esc tetap melepas fokus (lihat TerminalPane).
  const [screenReader, setScreenReader] = usePersistedState("terminal", "sr", false, isBool);
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
  // "Terminal biasa" menanyakan project dulu (kecuali hanya ada satu) — shell lahir di repoDir-nya.
  const [shellOpen, setShellOpen] = React.useState(false);
  // SPEC-362 · riwayat sesi. State-nya sekadar boolean: modal baru dirender saat diminta, jadi
  // tak ada request riwayat maupun elemen tambahan selama operator tak membukanya.
  const [historyOpen, setHistoryOpen] = React.useState(false);
  // Audit UI/UX 2026-10 · Fase 3E · mode tampilan. "focus" (rail + satu pane) adalah default; "grid"
  // memakai workspace kanonik (ADR-0118) apa adanya. Pilihan disimpan per browser (ADR-0115), dan
  // workspace server tak ikut berubah saat mode berpindah.
  const [view, setView] = usePersistedState<TerminalView>("terminal", "view", "focus", isTerminalView);
  const focusMode = view === "focus";
  // Sesi di pane fokus. Lokal dan tak dipersist: sesinya bisa sudah lenyap saat layar dibuka lagi.
  const [focusId, setFocusId] = React.useState<string | null>(null);
  // Sesi yang plan-nya sudah tuntas, dari verdict pane (SPEC-433). Rail memakainya untuk "Selesai".
  const [finishedIds, setFinishedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  // Fase milik sesi di pane fokus; sessionId dicocokkan saat dibaca supaya fase sesi lama tak bocor.
  const [focusPhases, setFocusPhases] = React.useState<{ sessionId: string; phases: Phase[] } | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  // Tampilan (font, papan tombol, ketik responsif, diagnostik) di ponsel: sheet dari menu ⋯, bukan
  // baris toolbar. Di tablet/desktop ia tetap menjadi panel dari tombol "Tampilan terminal".
  const [displayOpen, setDisplayOpen] = React.useState(false);
  const [sessionDialog, setSessionDialog] = React.useState<{ kind: SessionDialogKind; sessionId: string } | null>(null);
  const launchAdmission = useLaunchAdmission();
  // Tutup sesi hidup menghentikan agen: selalu lewat dialog aplikasi, bukan confirm native.
  const { confirm: confirmKill, dialog } = useConfirm();
  const layout = W.activeGroup(ws).layout;
  const showEmpty = layout.rows === 1 && layout.cols === 1 && !layout.cells[0] && sessions.length === 0;
  // Audit UI/UX tablet · grid CSS `minmax(0,1fr)` menyusut pane ke lebar berapa pun tanpa batas
  // bawah, jadi tablet lebar sempit (atau kolom bertambah lewat toolbar) butuh sinyal ruang nyata,
  // bukan cuma breakpoint viewport. Diukur di kontainer grid sendiri (bukan viewport) supaya sidebar
  // navigation rail tablet ikut terhitung.
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = React.useState(Number.POSITIVE_INFINITY);
  React.useEffect(() => {
    const el = gridRef.current;
    // jsdom tak punya ResizeObserver; lebar tak terukur = tak collapse (perilaku lama).
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      if (width > 0) setGridWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Grid dirender kondisional (`showEmpty`): re-attach saat elemen itu mount/unmount.
  }, [showEmpty]);
  // Turun ke Tabs single-pane yang sama dengan mobile ketika grid tablet tak muat pada lebar
  // minimum nyaman per pane — bukan mode baru, cuma memperluas kondisi render `mobile` yang sudah
  // ada. Re-evaluate tiap render: `layout.cols` (tombol +Kolom) dan `gridWidth` (resize/rotasi)
  // sama-sama bisa membuatnya berubah, dan keduanya sudah jadi dependency alami lewat closure ini.
  const tabletCollapse = tier === "tablet" && shouldCollapseToTabs(layout.cols, gridWidth, MIN_PANE_WIDTH);
  const singlePane = mobile || tabletCollapse;
  const [activeCell, setActiveCell] = React.useState(0);
  const [requestedSession, setRequestedSession] = React.useState<string | null>(null);
  const handledFocus = React.useRef<string | null>(null);
  // Sesi yang baru dibuka/dideeplink menjadi fokus DAN ditempatkan di grid (mode grid tetap utuh).
  const openSession = (id: string) => { setFocusId(id); setRequestedSession(id); };
  const markFinished = React.useCallback((id: string, done: boolean) => {
    setFinishedIds((prev) => {
      if (prev.has(id) === done) return prev;
      const next = new Set(prev);
      if (done) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  // Urutan rail dan sesi fokus DIHITUNG dari `sessions`; tak disimpan. Sesi fokus yang lenyap jatuh
  // ke baris pertama rail, jadi tak perlu efek pembersihan.
  const ordered = React.useMemo(() => groupByProject(sortRail(sessions, finishedIds)), [sessions, finishedIds]);
  const focused = resolveFocus(ordered, focusId);
  // Kunci fokus ke sesi yang sedang tampil: tanpa ini fallback "baris pertama rail" ikut berpindah
  // tiap urutan rail berubah (mis. sesi masuk/keluar "Menunggu keputusan").
  const focusedId = focused?.id ?? null;
  React.useEffect(() => { if (focusedId && focusedId !== focusId) setFocusId(focusedId); }, [focusedId, focusId]);

  const [sessionsLoaded, setSessionsLoaded] = React.useState(false);
  // Gagal memuat daftar tampil sebagai galat ber-"Coba lagi", bukan daftar kosong yang menyamar
  // sebagai "belum ada sesi" (audit UI/UX).
  const [listError, setListError] = React.useState<string | null>(null);
  const [listAttempt, setListAttempt] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    api.listTerminals().then((current) => {
      if (!alive) return;
      setListError(null);
      setSessions(current);
      setSessionsLoaded(true);
    }).catch((e: unknown) => {
      if (alive) setListError(failureMessage("memuat daftar sesi", e));
    });
    return () => { alive = false; };
  }, [listAttempt]);
  const [toast, showToast] = useToast();

  // SPEC-199 · daftar sesi (`exited` + marker "menunggu keputusan") didorong lewat WS siar
  // (ADR-0039), bukan poll 8s. tmux = source of truth di server; snapshot penuh saat connect.
  React.useEffect(() => subscribe((m) => {
    if (m.t === "sessions" && !sessionsProp) setSessions(m.sessions as TerminalSession[]);
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

  // The shared StartSessionModal is rendered by App, so its successful response reaches this
  // screen through a small optimistic hand-off. Wait for the initial list so a slower response
  // cannot overwrite this new session; the next authoritative WS snapshot deduplicates the id.
  React.useEffect(() => {
    if (!startedSession || startedSession.specId == null || !sessionsLoaded) return;
    setSessions((current) => current.some((session) => session.id === startedSession.id)
      ? current
      : [...current, { ...startedSession, cwd: "", exited: false }]);
    setFocusId(startedSession.id);
    setRequestedSession(startedSession.id);
    onStartedSessionHandled?.();
  }, [onStartedSessionHandled, sessionsLoaded, startedSession]);

  // SPEC-184 · notifikasi mengarahkan ke sesi tertentu → tempatkan ke grid aktif begitu sesi itu
  // muncul di daftar hidup. SPEC-197 · efek ini jalan tiap `sessions` berubah; tanpa guard, sesi
  // fokus yang sudah tampil bisa "loncat" ke sel-kosong-pertama saat sesi lain exit. Hanya place
  // bila belum ada di grid mana pun (placedIds); kalau sudah, kembalikan w apa adanya (no-op).
  // Sesi target yang sudah berakhir (atau tak pernah ada) TIDAK memindahkan fokus ke sesi lain:
  // dulu efek ini diam-diam berhenti, dan pane jatuh ke sesi default. Kini operator diberi tahu,
  // dan riwayat sesi itu ditawarkan bila tercatat. Sekali per target, supaya frame WS tak mengulang.
  const endedNoticeFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!focusSession) { handledFocus.current = null; endedNoticeFor.current = null; return; }
    if (!sessionsLoaded || handledFocus.current === focusSession) return;
    if (!sessions.some((s) => s.id === focusSession && !s.exited)) {
      if (endedNoticeFor.current === focusSession) return;
      endedNoticeFor.current = focusSession;
      void api.listSessionHistory({ q: focusSession, limit: 1 })
        .then((r) => showToast(SESSION_ENDED_NOTICE, "warn", "history", r.total > 0
          ? { action: { label: SESSION_HISTORY_ACTION, onAction: () => setHistoryOpen(true) }, duration: 7000 }
          : undefined))
        .catch(() => {
          // Riwayat yang gagal dimuat tak menggagalkan pemberitahuannya: pesan tetap tampil tanpa aksi.
          showToast(SESSION_ENDED_NOTICE, "warn", "history");
        });
      return;
    }
    handledFocus.current = focusSession;
    // Notifikasi/palet yang menunjuk sesi = buka sesi itu di fokus (deep link tetap berlaku di kedua mode).
    setFocusId(focusSession);
    setRequestedSession(focusSession);
  }, [focusSession, sessions, sessionsLoaded, showToast]);

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
      if (placed !== current || !singlePane) return placed;
      return W.placeInActive(current, activeCell, requestedSession);
    });
  }, [activeCell, singlePane, mutateWorkspace, requestedSession, setActiveGroup, workspaceWritable, ws]);

  // SPEC-232 · fullscreen menunjuk satu sesi hidup; bila sesi itu hilang (kill/exit lewat
  // frame WS), lepas fullscreen supaya modal tak menggantung ke sesi yang sudah lenyap.
  React.useEffect(() => {
    if (fullId && !sessions.some((s) => s.id === fullId)) setFullId(null);
  }, [fullId, sessions]);

  const failedCleanups = cleanups.filter((c) => c.error);
  const byId = (id: string) => sessions.find((s) => s.id === id) ?? null;
  const nameOf = React.useCallback(
    (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid, [projects]);

  // SPEC-517 · sesi agen biasa lahir DI DALAM NewTerminalModal (ia yang memegang pilihan
  // runtime); di sini tinggal menaruhnya di grid — persis jalur lama sesudah createTerminal.
  function placeNew(id: string) {
    setSessions((s) => (s.some((x) => x.id === id)
      ? s
      : [...s, { id, projectId: project, cwd: "", exited: false }]));
    void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
    openSession(id);
  }

  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project terpilih. Cermin
  // openNew, tapi memanggil createShell — server men-spawn $SHELL, bukan claude.
  async function openShell(project: string) {
    if (!project) return;
    setShellOpen(false);
    let id: string;
    try {
      ({ id } = await api.createShell(project));
    } catch (e) {
      // Project tanpa checkout di mesin ini: server menjawab 400 {needsBind}. Diberi jalan keluar
      // (aksi menuju project, tempat kartu "Belum ada checkout" menawarkan clone/pilih folder),
      // bukan dibiarkan diam.
      if (isNeedsBind(e)) {
        showToast(`Project ${nameOf(project)} belum terhubung ke folder repo — hubungkan dulu.`, "err", "folder-git-2",
          onOpenProject ? { action: { label: "Buka project", onAction: () => onOpenProject(project) } } : undefined);
      } else {
        showToast(failureMessage("membuka terminal biasa", e), "err", "x-circle");
      }
      return;
    }
    setSessions((s) => [...s, { id, projectId: project, cwd: "", exited: false }]);
    void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
    openSession(id);
  }

  // SPEC-179 · ambil backlog item tanpa pindah page. Di App, aksi ini membuka StartSessionModal
  // yang sama dengan Backlog agar model/effort orchestrator dan override fase bisa ditinjau dulu.
  // Fallback langsung dipertahankan untuk pemakaian screen mandiri/test lama.
  async function pickBacklog(spec: SpecSlim, force?: true) {
    if (onStartBacklog && !force) {
      setPicking(false);
      setPickError(null);
      onStartBacklog(spec);
      return;
    }
    const flow: Flow = flowForSource(spec.source);
    try {
      const { id } = await api.startSession({ spec: spec.id, flow, ...(force ? { force } : {}) });
      setSessions((s) => s.some((x) => x.id === id)
        ? s
        : [...s, { id, projectId: spec.projectId, specId: spec.id, flow, cwd: "", exited: false }]);
      void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
      openSession(id);
      setPicking(false);
      setPickError(null);
    } catch (e) {
      if (launchAdmission.offerRetry(e, spec.id, (next) => pickBacklog(spec, next))) return;
      const noRepo = e instanceof ApiError && (e.status === 400 || e.status === 422);
      setPickError(`${spec.id} · gagal mulai${noRepo ? " · project belum punya repoDir" : ""}`);
    }
  }

  // SPEC-362 · "Mulai lagi" = sesi BARU dengan konteks yang sama; sesi lamanya sudah mati bersama
  // panenya. Endpoint yang dipakai persis endpoint yang melahirkan sesi jenis itu pertama kali.
  async function restartFromHistory(r: SessionHistoryView, force?: true) {
    try {
      const born = r.specId
        // S4c · runtime sesi asal ikut, cermin cabang terminal agen di bawah (SPEC-517): tanpa itu
        // sesi codex dilanjutkan sebagai claude mengikuti Setting global. Override fase tak tersimpan
        // di mana pun, jadi tak bisa diulang di sini.
        ? await api.startSession({
            spec: r.specId, flow: (r.flow ?? "feature") as Flow,
            agent: r.agent === "codex" ? "codex" : "claude",
            ...(r.model ? { model: r.model } : {}),
            ...(r.effort ? { effort: r.effort } : {}),
            ...(force ? { force } : {}),
          })
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
            : await (force ? api.createTerminalFlow(r.projectId, r.kind as Flow, { force })
              : api.createTerminalFlow(r.projectId, r.kind as Flow));
      setSessions((s) => (s.some((x) => x.id === born.id)
        ? s
        : [...s, { id: born.id, projectId: r.projectId, specId: r.specId ?? undefined, cwd: "", exited: false }]));
      void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, born.id));
      openSession(born.id);
      setHistoryOpen(false);
    } catch (e) {
      if (r.specId || (r.kind !== "shell" && r.kind !== "terminal")) {
        if (launchAdmission.offerRetry(e, `${r.projectId} · ${r.title ?? r.specId ?? r.kind}`,
          (next) => restartFromHistory(r, next))) return;
      }
      // Gagal (project tak ter-bind, worktree tak bisa dibuat) — biarkan modal terbuka; pesan
      // detailnya sudah muncul di jalur Start biasa, riwayat tak perlu menduplikasinya.
    }
  }

  // Startable = belum selesai & belum punya sesi hidup di terminal ini (cermin Backlog
  // "Mulai/Lanjutkan": stage !== "done" && !running).
  const activeSpecIds = new Set(
    sessions.filter((s) => s.specId && !s.exited).map((s) => s.specId as string));
  const startable = backlog.filter((s) => s.stage !== "done" && !activeSpecIds.has(s.id));

  // Tutup = kill sesi. SPEC-742 · ADR-0116 · sel dilepas LEBIH DULU, tak menunggu respons: begitu
  // operator setuju, sesi itu selesai baginya. tmux tetap source of truth dan frame siar `sessions`
  // (1 dtk) mengembalikan sel bila DELETE gagal. Gagal itu TIDAK lagi diam: operator diberi tahu.
  function killSession(id: string) {
    setSessions((s) => s.filter((x) => x.id !== id));
    api.deleteTerminal(id).catch((e: unknown) => {
      // 404 = sesinya sudah lenyap sendiri; tak ada yang perlu dilaporkan.
      if (e instanceof ApiError && e.status === 404) return;
      showToast(failureMessage(`menutup sesi ${id.slice(0, 6)}`, e), "err", "x-circle");
    });
  }
  // Menutup sesi yang masih berjalan = menghentikan agennya, jadi selalu dikonfirmasi (tone danger).
  // Nama sesi disebut di judul supaya dialog ini tak mungkin menutup sesi lain.
  async function requestKill(id: string) {
    const s = byId(id);
    // Format sama dengan header sel ("label · id6") supaya dua sesi di project yang sama tetap beda.
    const name = `${s ? cellLabel(s, nameOf, titleOf) : id} · ${id.slice(0, 6)}`;
    const running = !!s && !s.exited;
    const ok = await confirmKill({
      title: `Tutup sesi "${name}"?`,
      impact: [
        running ? "Agen yang sedang berjalan di sesi ini akan dihentikan."
          : "Sesi ini sudah berhenti, jadi tidak ada agen yang perlu dihentikan.",
        "Worktree sesi ini ikut dibersihkan dari disk.",
      ],
      confirmLabel: "Tutup sesi", icon: "square", tone: "danger",
    });
    if (ok) killSession(id);
  }

  // SPEC-402 · kode keluar dari frame `exit` DISIMPAN, tak lagi dibuang: pane yang mati dengan
  // status ≠ 0 (mis. 143 karena di-SIGTERM `pkill -f` sesi tetangga) harus terbaca sebagai gagal,
  // bukan "Selesai". Daftar sesi dari server juga membawanya, jadi labelnya selamat dari refresh.
  const markExited = React.useCallback((id: string, code?: number) => {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, exited: true, exitCode: code } : x)));
  }, []);

  // SPEC-1267 · handler per-sel yang identitasnya stabil supaya `Cell` (React.memo) tak render ulang
  // tiap render layar. Isinya membaca `latest` saat dipanggil, jadi tak pernah basi.
  const current = {
    killSession, requestKill, detach: (id: string) => { void mutateWorkspace((c) => W.detach(c, id)); }, markExited, setFullId,
    openDialog: (kind: SessionDialogKind, sessionId: string) => setSessionDialog({ kind, sessionId }),
    props: { onOpenReview, onOpenSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf },
  };
  const latest = React.useRef(current);
  latest.current = current;
  const cellHandlers = React.useRef(new Map<string, {
    onClose: () => void; onForget: () => void; onDetach: () => void; onExit: (code: number) => void;
    onFullscreen: () => void; onDialog: (kind: SessionDialogKind) => void;
  }>());
  const handlersFor = (id: string) => {
    let h = cellHandlers.current.get(id);
    if (!h) {
      h = {
        onClose: () => void latest.current.requestKill(id), onForget: () => latest.current.killSession(id),
        onDetach: () => latest.current.detach(id),
        onExit: (code) => latest.current.markExited(id, code), onFullscreen: () => latest.current.setFullId(id),
        onDialog: (kind) => latest.current.openDialog(kind, id),
      };
      cellHandlers.current.set(id, h);
    }
    return h;
  };
  // Fase pane fokus: satu handler per sesi, stabil, supaya TerminalPane (memo) tak render ulang tiap kali.
  const phaseHandlers = React.useRef(new Map<string, (phases: Phase[], done: boolean) => void>());
  const phasesFor = (id: string) => {
    let h = phaseHandlers.current.get(id);
    if (!h) {
      h = (phases, done) => {
        setFocusPhases({ sessionId: id, phases });
        markFinished(id, done);
      };
      phaseHandlers.current.set(id, h);
    }
    return h;
  };
  // Menu ⋯ satu sumber untuk sel grid, baris rail, dan kepala pane fokus (Audit UI/UX · Fase 3E).
  const menuFor = (s: TerminalSession) => sessionMenuItems(s, {
    label: cellLabel(s, nameOf, titleOf),
    canArrange: workspaceWritable,
    specOf, onReview: onOpenReview, onSessionReview: onOpenSessionReview,
    onIntegrate, onIntegrateSession,
    onDialog: handlersFor(s.id).onDialog,
    onDetach: handlersFor(s.id).onDetach,
    onFullscreen: handlersFor(s.id).onFullscreen,
    onKill: () => void requestKill(s.id),
  });
  const stableProps = React.useRef({
    onOpenReview: (specId: string) => latest.current.props.onOpenReview?.(specId),
    onOpenSessionReview: (sid: string, title: string) => latest.current.props.onOpenSessionReview?.(sid, title),
    titleOf: (specId: string) => latest.current.props.titleOf?.(specId),
    onIntegrate: (spec: SpecSlim, op: "merge" | "rebase", target: string) => latest.current.props.onIntegrate?.(spec, op, target),
    onIntegrateSession: (session: TerminalSession, op: "merge" | "rebase", target: string) => latest.current.props.onIntegrateSession?.(session, op, target),
    specOf: (specId: string) => latest.current.props.specOf?.(specId),
  }).current;

  const place = (idx: number, id: string) => {
    setActiveCell(idx);
    void mutateWorkspace((current) => W.placeInActive(current, idx, id));
  };
  const placeFirst = (id: string) => {
    openSession(id);
    void mutateWorkspace((current) => W.placeFirstEmptyInActive(current, id));
  };
  const detach = (id: string) => { void mutateWorkspace((current) => W.detach(current, id)); };

  const placed = W.placedIds(ws);
  const unplaced = sessions.filter((s) => !placed.has(s.id));

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

  // Drag-resize antar-pane (audit UI/UX Terminal desktop): preview lokal saat pointer digerakkan,
  // commit ke workspace hanya di pointerup — sama seperti pola lain di layar ini yang tak menulis
  // tiap ketukan (mis. RenameInput commit di onBlur/Enter, bukan tiap onChange). `gridRef` dipakai
  // bersama dengan pengukuran lebar kontainer untuk auto-collapse tablet (dideklarasikan di atas).
  const dragRef = React.useRef<{
    axis: "col" | "row"; index: number; pointerId: number; start: number; extent: number;
    startSizes: number[]; latest: number[];
  } | null>(null);
  const [dragPreview, setDragPreview] = React.useState<{ axis: "col" | "row"; sizes: number[] } | null>(null);

  const colSizes = dragPreview?.axis === "col" ? dragPreview.sizes : layout.colSizes ?? Array(layout.cols).fill(1);
  const rowSizes = dragPreview?.axis === "row" ? dragPreview.sizes : layout.rowSizes ?? Array(layout.rows).fill(1);

  function beginResize(axis: "col" | "row", index: number, e: React.PointerEvent) {
    if (!workspaceWritable) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startSizes = axis === "col" ? colSizes : rowSizes;
    dragRef.current = {
      axis, index, pointerId: e.pointerId,
      start: axis === "col" ? e.clientX : e.clientY,
      extent: axis === "col" ? rect.width : rect.height,
      startSizes, latest: startSizes,
    };
    setDragPreview({ axis, sizes: startSizes });
  }
  function moveResize(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const pos = d.axis === "col" ? e.clientX : e.clientY;
    const total = d.startSizes.reduce((a, b) => a + b, 0);
    const deltaFr = ((pos - d.start) / d.extent) * total;
    d.latest = L.resizeTracks(d.startSizes, d.index, deltaFr);
    setDragPreview({ axis: d.axis, sizes: d.latest });
  }
  function endResize(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragPreview(null);
    if (d.latest === d.startSizes) return;   // tak bergerak — jangan tulis workspace
    void mutateWorkspace((current) => W.mapActiveLayout(current, (l) =>
      d.axis === "col" ? { ...l, colSizes: d.latest } : { ...l, rowSizes: d.latest }));
  }
  function stepResize(axis: "col" | "row", index: number, e: React.KeyboardEvent) {
    if (!workspaceWritable) return;
    const forward = axis === "col" ? "ArrowRight" : "ArrowDown";
    const backward = axis === "col" ? "ArrowLeft" : "ArrowUp";
    const direction = e.key === forward ? 1 : e.key === backward ? -1 : 0;
    if (direction === 0) return;
    e.preventDefault();
    void mutateWorkspace((current) => W.mapActiveLayout(current, (l) =>
      axis === "col" ? L.stepResizeCol(l, index, direction, e.shiftKey) : L.stepResizeRow(l, index, direction, e.shiftKey)));
  }
  // Klik dua kali: reset ukuran KEDUA track bertetangga saja (menyamakan lebar/tinggi keduanya) —
  // reset grid utuh di luar scope task ini.
  function equalizeResize(axis: "col" | "row", index: number) {
    if (!workspaceWritable) return;
    void mutateWorkspace((current) => W.mapActiveLayout(current, (l) => {
      const sizes = axis === "col" ? l.colSizes ?? Array(l.cols).fill(1) : l.rowSizes ?? Array(l.rows).fill(1);
      const avg = (sizes[index]! + sizes[index + 1]!) / 2;
      const delta = avg - sizes[index]!;
      return axis === "col" ? L.resizeCol(l, index, delta) : L.resizeRow(l, index, delta);
    }));
  }

  // SPEC-800 · kontrol tampilan tinggal di panel, bukan di toolbar: keduanya dipakai sekali lalu
  // dilupakan, dan menaruhnya inline melawan tujuan "pane dapat ruang layar terbesar".
  const displayControls = (
    <div className="hn-terminal-display">
      <div className="hn-dense-row hn-terminal-display-row">
        <span className="hn-terminal-display-label">Ukuran teks terminal</span>
        <IconButton size="sm" icon="minus" label="Perkecil teks terminal"
          disabled={fontSize <= FONT_MIN} onClick={() => bumpFont(-1)} />
        <span className="hn-terminal-display-value">
          {fontSize}px
        </span>
        <IconButton size="sm" icon="plus" label="Perbesar teks terminal"
          disabled={fontSize >= FONT_MAX} onClick={() => bumpFont(1)} />
      </div>
      <div className="hn-dense-row hn-terminal-display-row">
        <span className="hn-terminal-display-label">
          Papan tombol layar (Esc · panah · Enter)
        </span>
        <Button size="sm" variant="secondary" aria-pressed={keysOpen}
          onClick={() => setKeysOpen((on) => !on)}>{keysOpen ? "Sembunyikan" : "Tampilkan"}</Button>
      </div>
      <div className="hn-dense-row hn-terminal-display-row">
        <span className="hn-terminal-display-label">
          Ketik responsif (huruf tampil sebelum echo server)
        </span>
        <Button size="sm" variant="secondary" aria-pressed={predict}
          aria-label={`${predict ? "Matikan" : "Nyalakan"} ketik responsif`}
          onClick={() => setPredict((on) => !on)}>{predict ? "Matikan" : "Nyalakan"}</Button>
      </div>
      {/* Mode pembaca layar: opsi xterm `screenReaderMode`, default mati. Hint-nya memuat dua hal yang
          harus diketahui operator: Tab tetap masuk ke sesi (dan fokus bisa pindah), serta jalan keluar
          Ctrl+Shift+Esc yang tetap bekerja. Uji nyata dengan VoiceOver/NVDA belum dilakukan. */}
      <div className="hn-dense-row hn-terminal-display-row">
        <span id="terminal-sr-label" className="hn-terminal-display-label">Mode pembaca layar</span>
        <Button size="sm" variant="secondary" aria-pressed={screenReader} aria-describedby="terminal-sr-hint"
          aria-label={`${screenReader ? "Matikan" : "Nyalakan"} mode pembaca layar`}
          onClick={() => setScreenReader((on) => !on)}>{screenReader ? "Matikan" : "Nyalakan"}</Button>
      </div>
      <p id="terminal-sr-hint" className="hn-terminal-sr-hint">
        Untuk pembaca layar: teks terminal tersedia di DOM; kecepatan lebih rendah. Tab dikirim ke sesi
        (tidak memindahkan fokus). Untuk keluar dari terminal tekan Ctrl+Shift+Esc.
      </p>
      {/* Reset grid hanya berarti sesuatu di mode grid. Pemilih project pindah ke "Sesi baru". */}
      {!focusMode && (
        <div className="hn-dense-row hn-terminal-display-row">
          <span id="terminal-reset-grid-hint" className="hn-terminal-display-label">
            Kembalikan grid ke 1 kolom × 1 baris (sesi lain pindah ke "belum di grid")
          </span>
          <Button size="sm" variant="secondary" aria-describedby="terminal-reset-grid-hint"
            disabled={!workspaceWritable || (layout.cols === 1 && layout.rows === 1)}
            onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, () => L.emptyLayout()))}>
            Reset grid
          </Button>
        </div>
      )}
      {/* Diagnostik menyimpan pengaturan yang hanya dipakai saat menyelidiki masalah ketik. Tertutup
          supaya kontrol harian tak tercampur dengannya; ia merekam setiap tombol yang ditekan. */}
      <details className="hn-terminal-diag">
        <summary className="hn-terminal-diag-summary">
          Diagnostik{diag ? " · perekaman aktif" : ""}
        </summary>
        <div className="hn-dense-row hn-terminal-display-row hn-terminal-diag-row">
          <span className="hn-terminal-display-label">
            Rekam jalur ketik — mencatat setiap tombol yang ditekan di pane. Nyalakan hanya saat menyelidiki masalah ketik.
          </span>
          <Button size="sm" variant="secondary" aria-pressed={diag}
            aria-label={`${diag ? "Matikan" : "Nyalakan"} rekam jalur ketik`}
            onClick={() => setDiag((on) => !on)}>{diag ? "Matikan" : "Nyalakan"}</Button>
        </div>
      </details>
    </div>
  );

  // "Buka…" memuat semua cara membuka sesi selain "Sesi baru" (toolbar ≤ 6 kontrol, Fase 3E).
  const openItems: OverflowItem[] = [
    { key: "backlog", label: "Ambil backlog", icon: "inbox",
      onSelect: () => { setPickError(null); setPicking(true); } },
    { key: "history", label: "Riwayat sesi", icon: "history", onSelect: () => setHistoryOpen(true) },
    { key: "shell", label: "Terminal biasa", icon: "terminal", onSelect: () => (projects.length > 1 ? setShellOpen(true) : void openShell(project)) },
  ];
  // Aksi susunan grid: di desktop tampil sebagai tombol di baris grup; di sempit masuk satu menu.
  const gridItems: OverflowItem[] = [
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
  // Mobile (<768px) · toolbar satu baris: Sesi baru, Buka… (ikon ber-label), "Sesi · N" (rail di
  // mode Fokus), dan ⋯. Mode Fokus|Grid, layar penuh, dan tampilan masuk menu ⋯ ini.
  const mobileMenuItems: OverflowItem[] = [
    { key: "mode", label: focusMode ? "Pakai mode Grid" : "Pakai mode Fokus",
      icon: focusMode ? "columns-2" : "terminal", onSelect: () => setView(focusMode ? "grid" : "focus") },
    { key: "full", label: maxed ? "Keluar layar penuh" : "Layar penuh",
      icon: maxed ? "minimize-2" : "maximize-2", onSelect: () => setMaxed((m) => !m) },
    { key: "display", label: "Tampilan terminal", icon: "sliders", onSelect: () => setDisplayOpen(true) },
  ];

  // Overlay menimpa Shell, bukan melepas screen darinya. zIndex 100: di atas konten halaman,
  // di bawah modal (150) dan toast (200) di ds/kit.tsx — kalau dibalik, dialog konfirmasi
  // terkubur di belakang terminal.
  // ponytail: Escape sengaja TIDAK di-bind untuk keluar. Ia tombol tersibuk di TUI Claude Code;
  // merebutnya demi menutup overlay menukar hal yang dipakai tiap menit dengan hal yang dipakai
  // sekali. Keluar lewat tombol saja. Ada test yang menjaga ini.
  // Layar penuh = kelas `is-maxed` (fixed, menutupi shell); tata letak biasa ada di `.hn-terminal-screen`.
  return (
    <div data-testid="terminal-root" className={maxed ? "hn-terminal-screen is-maxed" : "hn-terminal-screen"}>
      {/* Toolbar ≤ 6 kontrol (aturan minimalis, Fase 3E): Sesi baru (primer) · Buka… · Fokus|Grid ·
          Tampilan · Layar penuh. Susunan grid, grup, dan tray hidup di baris grid di bawahnya. */}
      {/* group, bukan toolbar: pola toolbar ARIA menuntut navigasi panah yang tak dipasang di sini. */}
      <div className="hn-terminal-toolbar" role="group" aria-label="Terminal">
        {/* SPEC-517 · membuka form runtime dulu (agen · model · effort); sesinya lahir saat
            "Buka sesi" ditekan, dengan pilihan itu sebagai argv pane tmux. */}
        <Button size="sm" leftIcon="plus" title="Pilih runtime lalu buka sesi agen di direktori project. Agen berjalan dengan izin penuh (claude --dangerously-skip-permissions)."
          onClick={() => setNewOpen(true)}>Sesi baru</Button>
        {mobile ? (
          <>
            {/* Sempit: "Buka…" jadi ikon ber-label (tak ada teks yang bisa terpotong). */}
            <OpenMenu compact items={openItems} />
            {/* Rail sesi di ponsel jadi laci; tombolnya ikut toolbar supaya kepala pane tetap satu baris. */}
            {focusMode && sessions.length > 0 && (
              <button type="button" className="hn-terminal-rail-toggle" aria-haspopup="dialog"
                aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
                Sesi · {sessions.length}
              </button>
            )}
            <OverflowActions label="Menu terminal" title="Terminal" items={mobileMenuItems} />
          </>
        ) : (
          <>
            <OpenMenu items={openItems} />
            <div className="hn-terminal-seg" role="group" aria-label="Mode tampilan terminal">
              <button type="button" className="hn-terminal-seg-btn" aria-pressed={focusMode}
                title="Satu terminal fokus dengan daftar sesi di samping" onClick={() => setView("focus")}>
                Fokus
              </button>
              <button type="button" className="hn-terminal-seg-btn" aria-pressed={!focusMode}
                title="Beberapa terminal sekaligus dalam grid" onClick={() => setView("grid")}>
                Grid
              </button>
            </div>
            {/* SPEC-800 · kontrol tampilan (font, papan tombol, ketik responsif, diagnostik) ada di panel ini. */}
            <OverflowActions label="Tampilan terminal" icon="sliders" items={[]}>{displayControls}</OverflowActions>
            <IconButton size="sm" icon={maxed ? "minimize-2" : "maximize-2"}
              label={maxed ? "Keluar layar penuh" : "Layar penuh"}
              aria-pressed={maxed} onClick={() => setMaxed((m) => !m)} />
          </>
        )}
      </div>

      {(workspaceStatus !== "ready" || cleanups.length > 0) && (
        <div className="hn-terminal-status">
          {workspaceStatus !== "ready" && (
            <span data-testid="terminal-workspace-status" title={workspaceMessage ?? undefined}
              className={workspaceStatus === "conflict" ? "hn-terminal-status-warn" : undefined}>
              {workspaceStatus === "loading"
                ? "Memuat layout server…"
                : workspaceStatus === "recovering"
                  ? <><span>Layout server belum tersambung</span>{" "}
                      <button type="button" onClick={() => void refreshWorkspace()}>Coba lagi</button></>
                  : workspaceMessage ?? "Layout berubah di perangkat lain"}
            </span>
          )}
          {cleanups.length > 0 && (
            <span data-testid="worktree-cleanups"
              title={cleanups.map((c) => `${c.sessionId}${c.error ? ` — ${c.error}` : ""}`).join("\n")}
              className={failedCleanups.length ? "hn-terminal-status-err" : undefined}>
              {failedCleanups.length
                ? `${failedCleanups.length} worktree gagal dibersihkan`
                : `membersihkan ${cleanups.length} worktree…`}
            </span>
          )}
        </div>
      )}

      {/* Baris grid: hanya di mode grid. Tabbar grup milik workspace kanonik, jadi tetap di sini. */}
      {!focusMode && (
        <div className="hn-terminal-grid-bar">
          <GroupTabs
            compact={maxed}
            ws={ws}
            writable={workspaceWritable}
            onSelect={setActiveGroup}
            onAdd={() => void mutateWorkspace((current) => W.addGroup(current, `Grup ${current.groups.length + 1}`))}
            onRename={(id, name) => void mutateWorkspace((current) => W.renameGroup(current, id, name))}
            onRemove={(id) => void mutateWorkspace((current) => W.removeGroup(current, id))}
          />
          {!singlePane && (
            <>
              <Button size="sm" variant="ghost" disabled={!workspaceWritable}
                onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addColumn))}>+ Kolom</Button>
              <Button size="sm" variant="ghost" disabled={!workspaceWritable}
                onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, L.addRow))}>+ Baris</Button>
            </>
          )}
          {singlePane && <OverflowActions label="Atur grid" icon="sliders" items={gridItems} />}
        </div>
      )}

      {listError && (
        <Callout tone="err" title="Daftar sesi belum bisa dimuat" className="hn-terminal-notice--tight">
          <span>{listError} </span>
          <button type="button" className="hn-terminal-action hn-terminal-action--text"
            onClick={() => setListAttempt((n) => n + 1)}>Coba lagi</button>
        </Callout>
      )}

      {!focusMode && unplaced.length > 0 && (
        <div className="hn-terminal-unplaced">
          <span className="hn-terminal-unplaced-label">Belum di grid:</span>
          {unplaced.map((s) => (
            <span key={s.id} className="hn-terminal-unplaced-chip">
              <button className="hn-terminal-unplaced-action" disabled={!workspaceWritable}
                onClick={() => placeFirst(s.id)} title="Taruh di sel kosong pertama grup ini">
                {s.specId ?? nameOf(s.projectId)} · {s.id.slice(0, 6)}
              </button>
              <button type="button" className="hn-terminal-action" aria-label={`Tutup sesi ${s.id}`}
                onClick={() => void requestKill(s.id)}>×</button>
            </span>
          ))}
        </div>
      )}

      {!focusMode && singlePane && !showEmpty && (
        <div className="hn-stack-mobile hn-terminal-tabs-row">
          <Tabs aria-label="Panel terminal" variant="pill" value={String(activeCell)}
            onChange={(next) => setActiveCell(Number(next))}
            tabs={layout.cells.map((id, idx) => ({ value: String(idx),
              label: `Panel ${idx + 1}${id ? ` · ${id.slice(0, 6)}` : " · kosong"}` }))} />
        </div>
      )}

      {!focusMode && (showEmpty ? (
        // Saat daftar gagal dimuat, "Belum ada sesi" akan berbohong: galat di atas yang bicara.
        // Tanpa `action`: toolbar di atas sudah menawarkan "Sesi baru".
        listError ? null : (
          <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
            hint="Tekan Sesi baru untuk memulai agen di project terpilih, atau Terminal biasa untuk shell." />
        )
      ) : (
        <div ref={gridRef} data-testid="terminal-grid" className="hn-terminal-grid" style={{
          // Track grid bergantung pada state (jumlah kolom, lebar hasil seret): lewat CSS variable.
          "--grid-cols": singlePane ? "minmax(0, 1fr)"
            : `18px ${colSizes.map((s) => `minmax(0, ${s}fr)`).join(" ")}`,
          "--grid-rows": singlePane ? "minmax(0, 1fr)"
            : `16px ${rowSizes.map((s) => `minmax(0, ${s}fr)`).join(" ")}`,
        } as React.CSSProperties}>
          {/* Track pane c/r duduk di grid-line c+2/r+2 (line 1 dipakai gutter) — eksplisit, bukan
              auto-placement, supaya divider di bawah bisa berbagi track yang sama tanpa mendorong
              sel lain (auto-placement menganggap track yang diklaim item eksplisit "terpakai"). */}
          {!singlePane && <div className="hn-terminal-grid-corner" />}{/* pojok kiri-atas */}
          {!singlePane && Array.from({ length: layout.cols }, (_, c) => (
            <GutterX key={`col-${c}`} axis="col" label={`Tutup kolom ${c + 1}`} disabled={!workspaceWritable || layout.cols === 1}
              gridColumn={c + 2} gridRow={1}
              onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, (l) => L.removeColumn(l, c)))} />
          ))}
          {!singlePane && Array.from({ length: layout.rows }, (_, r) => (
            <GutterX key={`row-${r}`} axis="row" label={`Tutup baris ${r + 1}`} disabled={!workspaceWritable || layout.rows === 1}
              gridColumn={1} gridRow={r + 2}
              onClick={() => void mutateWorkspace((current) => W.mapActiveLayout(current, (l) => L.removeRow(l, r)))} />
          ))}
          {!singlePane && Array.from({ length: layout.cols - 1 }, (_, c) => {
            const pct = L.trackPercent(colSizes, c);
            return (
              <ResizeDivider key={`col-div-${c}`} orientation="col" label={`Ubah lebar kolom ${c + 1}/${c + 2}`}
                now={pct.now} min={pct.min} max={pct.max} disabled={!workspaceWritable}
                gridColumn={c + 3} gridRow="1 / -1"
                onPointerDown={(e) => beginResize("col", c, e)} onPointerMove={moveResize} onPointerUp={endResize}
                onKeyDown={(e) => stepResize("col", c, e)} onDoubleClick={() => equalizeResize("col", c)} />
            );
          })}
          {!singlePane && Array.from({ length: layout.rows - 1 }, (_, r) => {
            const pct = L.trackPercent(rowSizes, r);
            return (
              <ResizeDivider key={`row-div-${r}`} orientation="row" label={`Ubah tinggi baris ${r + 1}/${r + 2}`}
                now={pct.now} min={pct.min} max={pct.max} disabled={!workspaceWritable}
                gridColumn="1 / -1" gridRow={r + 3}
                onPointerDown={(e) => beginResize("row", r, e)} onPointerMove={moveResize} onPointerUp={endResize}
                onKeyDown={(e) => stepResize("row", r, e)} onDoubleClick={() => equalizeResize("row", r)} />
            );
          })}
          {Array.from({ length: layout.rows }, (_, r) => r).flatMap((r) =>
            Array.from({ length: layout.cols }, (_, c) => {
              const idx = r * layout.cols + c;
              const id = layout.cells[idx] ?? null;
              const s = id ? byId(id) : null;
              return (
                <div key={id ?? `empty-${idx}`} data-terminal-cell-index={idx}
                  aria-hidden={singlePane && activeCell !== idx ? "true" : "false"}
                  className={singlePane && activeCell !== idx ? "hn-terminal-cell-slot is-hidden" : "hn-terminal-cell-slot"}
                  // Posisi sel: `auto` di mode satu panel (auto-placement), koordinat grid di mode grid.
                  style={{ "--cell-col": singlePane ? "auto" : c + 2, "--cell-row": singlePane ? "auto" : r + 2 } as React.CSSProperties}>
                  {s
                    ? <Cell session={s} nameOf={nameOf} {...handlersFor(s.id)}
                        canArrange={workspaceWritable}
                        onReview={onOpenReview && stableProps.onOpenReview}
                        onSessionReview={onOpenSessionReview && stableProps.onOpenSessionReview}
                        titleOf={titleOf && stableProps.titleOf} onIntegrate={onIntegrate && stableProps.onIntegrate}
                        onIntegrateSession={onIntegrateSession && stableProps.onIntegrateSession}
                        specOf={specOf && stableProps.specOf} backlog={backlog}
                        fontSize={fontSize} showKeys={keysOpen} predict={predict} diag={diag} screenReader={screenReader}
                        fullscreen={fullId === s.id}
                        paneHidden={singlePane && activeCell !== idx} />
                    : <EmptyCell disabled={!workspaceWritable} unplaced={unplaced} nameOf={nameOf} onPick={(sid) => place(idx, sid)} />}
                </div>
              );
            }))}
        </div>
      ))}

      {focusMode && (
        <FocusView
          sessionCount={sessions.length} focused={focused} mobile={mobile}
          railItems={ordered.map((s) => ({
            session: s,
            label: cellLabel(s, nameOf, titleOf),
            projectName: nameOf(s.projectId),
            status: railStatus(s, finishedIds.has(s.id)),
            startedMs: railStartedMs(s),
          }))}
          listError={!!listError}
          menuFor={menuFor}
          onFocus={setFocusId}
          drawerOpen={drawerOpen}
          onDrawer={setDrawerOpen}
          fullId={fullId}
          focusPhases={focusPhases}
          paneHandlers={(id) => ({
            onExit: handlersFor(id).onExit, onPhases: phasesFor(id), onForget: handlersFor(id).onForget,
          })}
          fontSize={fontSize} showKeys={keysOpen} onToggleKeys={() => setKeysOpen((on) => !on)}
          predict={predict} diag={diag} screenReader={screenReader}
        />
      )}

      {picking && (
        <BacklogPicker seed={startable} activeIds={activeSpecIds} error={pickError}
          onPick={(s) => void pickBacklog(s)} onClose={() => setPicking(false)} />
      )}

      {newOpen && (
        <NewTerminalModal open projectId={project} projectName={nameOf(project)}
          projects={projects} onProjectChange={setProject}
          onClose={() => setNewOpen(false)} onCreated={placeNew} />
      )}

      {shellOpen && (
        <NewShellModal projectId={project} projects={projects} onProjectChange={setProject}
          onClose={() => setShellOpen(false)} onConfirm={(pid) => void openShell(pid)} />
      )}

      {historyOpen && (
        <SessionHistoryModal projects={projects} onClose={() => setHistoryOpen(false)}
          onRestart={(r) => void restartFromHistory(r)} />
      )}
      {launchAdmission.dialog}

      {sessionDialog && byId(sessionDialog.sessionId) && (
        <SessionDialogs kind={sessionDialog.kind} session={byId(sessionDialog.sessionId)!}
          specOf={specOf} onIntegrate={onIntegrate} onIntegrateSession={onIntegrateSession}
          onClose={() => setSessionDialog(null)} />
      )}

      {fullId && byId(fullId) && (
        <FullscreenTerminal session={byId(fullId)!}
          label={cellLabel(byId(fullId)!, nameOf, titleOf)}
          fontSize={fontSize} showKeys={keysOpen} predict={predict} diag={diag} screenReader={screenReader}
          onClose={() => setFullId(null)} />
      )}
      {mobile && displayOpen && (
        <Modal open title="Tampilan terminal" icon="sliders" width={420} onClose={() => setDisplayOpen(false)}>
          {displayControls}
        </Modal>
      )}
      {dialog}
      <Toast toast={toast} />
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
  seed: SpecSlim[]; activeIds: Set<string>; error: string | null; onPick: (s: SpecSlim) => void; onClose: () => void;
}) {
  const [q, setQ] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState("all");
  const [prioFilter, setPrioFilter] = React.useState("all");
  // SPEC-198 · search/filter startable via API. Seed dari prop (render instan + tahan mock parsial),
  // lalu refetch dari server. Exclusi sesi aktif tetap di klien (state sesi, bukan filter/paginasi).
  const [items, setItems] = React.useState<SpecSlim[]>(seed);
  const [dq, setDq] = React.useState("");
  // Daftar yang gagal dimuat tak boleh diam: seed tetap tampil, tapi operator tahu itu bisa basi.
  const [listErr, setListErr] = React.useState<string | null>(null);
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  React.useEffect(() => {
    let alive = true;
    const p = api.listSpecs?.({
      startable: true, q: dq || undefined,
      stage: stageFilter === "all" ? undefined : stageFilter,
      priority: prioFilter === "all" ? undefined : prioFilter,
    });
    p?.then((r) => { if (alive) { setItems(r.items); setListErr(null); } })
      .catch((e: unknown) => { if (alive) setListErr(failureMessage("memuat backlog", e)); });
    return () => { alive = false; };
  }, [dq, stageFilter, prioFilter]);
  const shown = items.filter((s) => !activeIds.has(s.id));
  const notice = error ?? listErr;
  return (
    <Modal open title="Ambil backlog" icon="inbox" onClose={onClose} width={760}>
      {notice && (
        <div role="alert" className="hn-terminal-pick-notice">{notice}</div>
      )}
      {/* baris penyaring: search + stage + prioritas (startable tak pernah `done`). */}
      <div className="hn-terminal-pick-filters">
        <Input size="sm" leftIcon="search" placeholder="mis. invoice atau SPEC-412" aria-label="Cari backlog"
          value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          className="hn-terminal-pick-search" />
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
        <div className="hn-terminal-pick-list">
          {shown.map((s) => (
            // SPEC-763 · reset tombol ada di kelas `.hn-terminal-pick-row` (bukan inline lagi): ia
            // harus menang atas `button { min-height: var(--touch-target) }` dan atas `flex-wrap`
            // milik `.hn-dense-row`. `flex: 0 0 auto` wajib: daftarnya flex-column ber-`maxHeight`,
            // jadi barisnya boleh menyusut di bawah kontennya — terukur tombol 44px memuat isi 66px,
            // dan judul yang membungkus MENIMPA baris di bawahnya. Akar yang sama dengan tab yang tumpah.
            <button key={s.id} onClick={() => onPick(s)} className="hn-terminal-pick-row">
              {/* Baris flex-nya hidup di dalam <span>, bukan di <button> itu sendiri: kotak tombol
                  tidak menumbuhkan tingginya untuk baris flex yang membungkus, sehingga judul yang
                  turun ke baris kedua menimpa baris berikutnya (terlihat langsung di 390px). */}
              <span className="hn-dense-row hn-picker-row hn-terminal-pick-main">
                <Icon name={s.source === "qa" ? "bug" : s.source === "audit" ? "search" : "lightbulb"} size={14}
                  color={s.source === "qa" ? "var(--clay-500)" : s.source === "audit" ? "var(--wind-600)" : "var(--brass-500)"} />
                <span className="hn-terminal-pick-id">{s.id}</span>
                <span className="hn-picker-title hn-terminal-pick-title">{s.title}</span>
                <Badge tone={s.priority === "tinggi" ? "err" : "neutral"} size="sm">{s.priority}</Badge>
                <span className="hn-terminal-pick-project">{s.projectId}</span>
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
  // Audit UI/UX Terminal · target sentuh kontrol grup: 24px pointer halus, 44px pointer kasar.
  const coarse = useCoarsePointer();
  const box = coarse ? 44 : 24;

  return (
    // Ukuran kontrol (24px / 44px pointer kasar) satu-satunya nilai dinamis: lewat `--group-box`.
    // Baris digabung → garis bawah tabbar akan memotong baris chrome di tengah (`is-bordered`).
    <div className={compact ? "hn-terminal-groups" : "hn-terminal-groups is-bordered"}
      style={{ "--group-box": `${box}px` } as React.CSSProperties}>
      {/* Hanya tab di dalam tablist: ARIA mengharapkan anak tablist berupa tab saja. Kontrol ubah,
          hapus, dan grup baru duduk di luarnya. */}
      <div role="tablist" aria-label="Grup terminal" className="hn-terminal-groups-tabs">
        {ws.groups.map((g, index) => {
          const isActive = g.id === active.id;
          return (
            <button key={g.id} type="button" role="tab" aria-selected={isActive} tabIndex={isActive ? 0 : -1}
              className="hn-terminal-group-control hn-terminal-group-tab" onClick={() => onSelect(g.id)}
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
              }}>
              {g.name}
            </button>
          );
        })}
      </div>
      {writable && (editing === active.id
        ? <RenameInput key={active.id} initial={active.name}
            onCommit={(name) => { if (name.trim()) onRename(active.id, name.trim()); setEditing(null); }}
            onCancel={() => setEditing(null)} />
        : (
          <span role="group" aria-label={`Kelola grup ${active.name}`} className="hn-terminal-groups-actions">
            <button type="button" className="hn-terminal-group-control hn-terminal-group-action" aria-label={`Ganti nama grup ${active.name}`}
              title="Ganti nama" onClick={() => setEditing(active.id)}>✎</button>
            <button type="button" className="hn-terminal-group-control hn-terminal-group-action hn-terminal-group-remove"
              aria-label={`Hapus grup ${active.name}`}
              title={only ? "Grup terakhir tak bisa dihapus" : "Hapus grup (sesi tetap hidup)"}
              disabled={only} onClick={() => onRemove(active.id)}>×</button>
          </span>
        ))}
      <button type="button" className="hn-terminal-group-control hn-terminal-group-action hn-terminal-group-add"
        aria-label="Grup baru" title="Grup baru"
        disabled={!writable} onClick={onAdd}>+</button>
    </div>
  );
}

// Menutup kolom/baris TIDAK mematikan sesi — selnya lenyap, sesinya jatuh ke tray lewat
// placedIds. Karena itu tak ada konfirmasi, sama seperti "lepas".
// `axis` menentukan sumbu mana yang sempit (col-gutter: tinggi 16px, lebar track kolom; row-gutter:
// lebar 18px, tinggi track baris) — `.hn-terminal-gutter--{axis}` (app.css) hanya memperbesar hit
// area lewat `::before` pada sumbu yang sempit itu, tanpa mengubah track grid-nya sendiri (SPEC-763).
// `gridColumn`/`gridRow` adalah posisi grid eksplisit (desktop), dikirim lewat CSS variable.
function GutterX({ label, disabled, onClick, axis, gridColumn, gridRow }: {
  label: string; disabled: boolean; onClick: () => void; axis: "col" | "row";
  gridColumn: number; gridRow: number;
}) {
  return (
    <button type="button" aria-label={label} title={disabled ? "Grid tak boleh menyusut ke nol" : label}
      disabled={disabled} onClick={onClick}
      className={`hn-terminal-gutter hn-terminal-gutter--${axis}`}
      style={{ "--grid-col": gridColumn, "--grid-row": gridRow } as React.CSSProperties}>×</button>
  );
}

// Divider draggable antar-track: tak menambah track grid — ia dititipkan di track pane
// bertetangga (lebar/tinggi = gap 8px) lalu digeser margin negatif supaya berimpit persis di
// atas gap, tak pernah menutupi konten pane. role="separator" + panah keyboard karena "seret utk
// resize" wajib punya padanan keyboard di desktop (mandat audit UI/UX Terminal).
function ResizeDivider({ orientation, label, now, min, max, disabled, gridColumn, gridRow,
  onPointerDown, onPointerMove, onPointerUp, onKeyDown, onDoubleClick }: {
  orientation: "col" | "row"; label: string; now: number; min: number; max: number; disabled: boolean;
  gridColumn: string | number; gridRow: string | number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div role="separator" aria-label={label} aria-disabled={disabled}
      aria-orientation={orientation === "col" ? "vertical" : "horizontal"}
      aria-valuenow={now} aria-valuemin={min} aria-valuemax={max}
      tabIndex={disabled ? -1 : 0}
      className={`hn-terminal-divider hn-terminal-divider--${orientation}`}
      title={disabled ? undefined
        : "Seret untuk ubah ukuran — panah untuk langkah kecil, Shift+panah langkah besar, klik dua kali menyamakan"}
      style={{ "--grid-col": gridColumn, "--grid-row": gridRow } as React.CSSProperties}
      onPointerDown={disabled ? undefined : onPointerDown}
      onPointerMove={disabled ? undefined : onPointerMove}
      onPointerUp={disabled ? undefined : onPointerUp}
      onPointerCancel={disabled ? undefined : onPointerUp}
      onKeyDown={disabled ? undefined : onKeyDown}
      onDoubleClick={disabled ? undefined : onDoubleClick} />
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
      className="hn-terminal-rename" />
  );
}

// Fase yang DILAPORKAN agen, bukan yang disimpulkan server (SPEC-162). Agen yang lupa menulis
// berkas fasenya meninggalkan strip ini diam — terminalnya sendiri yang jadi kebenaran.
// Warna, tebal, coret, dan redup nama fase datang dari `data-state` (lihat terminal.css), bukan dari
// objek inline per fase.
const CHIP_ICON: Record<ChipTone, string> = {
  done: "✓", running: "●", pending: "○", skipped: "–", failed: "✕", abandoned: "⨯",
};

// ADR-0164 · fase tanpa agen digambar persis seperti sebelumnya. Fase ber-agen jadi chip: nama ·
// model · effort · durasi, ditambah ↻n bila diulang dan ⚠ bila bukti subagent tak diterima.
// `compact` (sel sempit): hanya chip aktif yang menampilkan model/effort/durasi.
export function PhaseStrip({ phases, compact = false, now }: {
  phases: Phase[] | null; compact?: boolean; now?: number;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  // Audit R2 · pola popover DS (LimitIndicator): Esc, klik-luar, fokus masuk panel & kembali ke chip.
  // Satu panel untuk banyak chip — `triggerRef` dipasang di chip yang sedang terbuka saja.
  const popover = usePopoverFocus(open !== null, () => setOpen(null), "dialog");
  const [, setTick] = React.useState(0);
  const running = !!phases?.some((p) => p.agent?.status === "running");
  React.useEffect(() => {
    if (!running || now !== undefined) return;
    return subscribeTick(() => setTick((x) => x + 1));
  }, [running, now]);
  if (!phases?.length) return null;
  const at = now ?? Date.now();
  const openPhase = phases.find((p) => p.name === open && p.agent);
  const durationOf = (p: Phase): string => {
    const a = p.agent;
    if (!a) return "";
    if (typeof a.durationMs === "number") return formatDuration(a.durationMs);
    if (a.status === "running" && a.startedAt) return formatDuration(at - Date.parse(a.startedAt));
    return "";
  };
  // ADR-0164 · review panel-terpotong: panel detail dulu hidup DI DALAM baris chip yang
  // men-scroll (overflowX: auto). Spec CSS overflow menegaskan bila satu sumbu diset bukan
  // `visible`, sumbu lain yang `visible` dihitung ulang jadi `auto` — jadi overflow-y strip pun
  // ikut jadi `auto` begitu overflow-x-nya diset, dan panel `position:absolute; top:100%` yang
  // masih jadi ANAK baris scroll itu jatuh ke area scroll vertikal setinggi baris chip (~20px)
  // yang tersembunyi. Di browser sungguhan "klik chip → detail" jadi tak terlihat/tak terjangkau;
  // jsdom tak melakukan layout jadi test lama tetap hijau walau bug-nya nyata. Perbaikannya:
  // wrapper LUAR ini sengaja TIDAK menyetel overflow apa pun (default `visible` kedua sumbu), dan
  // hanya baris chip di dalamnya (`phase-strip-scroller`) yang men-scroll horizontal. Panelnya
  // jadi SAUDARA baris scroll itu, tetap anak wrapper luar, sehingga `top: 100%` mengacu ke
  // wrapper yang tak dipotong.
  //
  // ADR-0164 · review 2: perbaikan di atas memindahkan panel keluar dari baris scroll, tapi
  // containing block-nya (wrapper strip ini, dulu `position: relative`) masih anak sel grid yang
  // `overflow: hidden` (jaga grid rapi) — dan panel bisa setinggi ~242px (4 baris + `<pre>` maks
  // 160px) sementara sel padat di grid cuma ~220px, jadi ujung bawah panel terpotong lagi, kali
  // ini oleh sel bukan oleh strip. Containing block panel dipindah SATU LEVEL LEBIH LUAR: ke
  // wrapper BADAN sel di `Cell` (header + strip + pane, tinggi definit, selalu di dalam sel) —
  // lihat `position: "relative"` di sana. Wrapper strip ini sengaja MELEPAS `position: relative`
  // supaya bukan lagi containing block-nya. Panel tetap `position: absolute` tapi TANPA
  // `top`/`left`, jadi ia jatuh ke posisi statisnya (persis di bawah baris chip, masih anak
  // wrapper strip ini secara struktur DOM) sementara ukurannya (`maxHeight`, `maxWidth`) dihitung
  // relatif terhadap badan sel. Anggaran 48px pada `maxHeight: calc(100% - 48px)` = tinggi strip
  // (~24px) + kemungkinan scrollbar horizontal non-overlay baris chip bila chip meluber (~15px) +
  // margin bawah kecil; sisanya jadi batas atas tinggi panel, dan kontennya sendiri yang
  // men-scroll (`overflowY: auto`) kalau sel terlalu pendek untuk menampung semuanya.
  return (
    <div data-testid="phase-strip" className="hn-terminal-phase">
      <div data-testid="phase-strip-scroller" className="hn-terminal-phase-scroller">
        {phases.map((p) => {
          if (!p.agent) {
            return <span key={p.name} data-state={p.state} title={p.state} className="hn-terminal-phase-name">{p.name}</span>;
          }
          const a = p.agent;
          const tone = chipTone(p);
          const full = !compact || p.state === "active";
          const duration = durationOf(p);
          return (
            <button key={p.name} type="button" data-tone={tone} aria-expanded={open === p.name}
              ref={open === p.name ? popover.triggerRef : undefined} aria-haspopup="dialog"
              aria-controls={open === p.name ? popover.panelId : undefined}
              aria-label={chipAccessibleName(p, duration)} onClick={() => setOpen(open === p.name ? null : p.name)}
              className="hn-terminal-phase-chip">
              <span aria-hidden>{CHIP_ICON[tone]}</span>
              <span data-state={p.state} title={p.state} className="hn-terminal-phase-name">{p.name}</span>
              {p.state === "skipped" && <span>dilewati</span>}
              {full && a.model && <span>· {modelLabel(a.model)}</span>}
              {full && a.effort && <span>· {a.effort}</span>}
              {full && duration && <span>· {duration}</span>}
              {a.attempts > 1 && <span>↻{a.attempts}</span>}
              {a.evidence === "missing" && (
                <span role="img" aria-label="bukti subagent tak diterima" title="bukti subagent tak diterima"
                  className="hn-terminal-phase-warn">⚠</span>
              )}
            </button>
          );
        })}
      </div>
      {openPhase?.agent && (
        <div ref={popover.panelRef} id={popover.panelId} role="dialog" aria-label={`Detail fase ${openPhase.name}`}
          tabIndex={-1} onKeyDown={popover.onKeyDown} className="hn-terminal-phase-panel">
          <div><b>{openPhase.agent.name}</b></div>
          {/* Guard: `model` opsional — dibangun dari bagian yang ADA saja supaya tak menyisakan
              "· " di depan saat model kosong. */}
          <div>{[modelLabel(openPhase.agent.model), openPhase.agent.effort, openPhase.agent.status ?? "belum mulai"]
            .filter(Boolean).join(" · ")}</div>
          <div>durasi {durationOf(openPhase) || "—"} · percobaan {openPhase.agent.attempts}</div>
          <div>token in {openPhase.agent.inputTokens ?? "—"} · out {openPhase.agent.outputTokens ?? "—"} · cache {openPhase.agent.cachedTokens ?? "—"}</div>
          {openPhase.agent.resultExcerpt && (
            <pre className="hn-terminal-phase-excerpt">{openPhase.agent.resultExcerpt}</pre>
          )}
        </div>
      )}
    </div>
  );
}

const Cell = React.memo(CellImpl);

function CellImpl({ session, nameOf, onClose, onForget, canArrange, onDetach, onExit, onReview, onSessionReview, titleOf, onIntegrate, onIntegrateSession, specOf, fontSize, showKeys, predict, diag, screenReader, fullscreen, onFullscreen, onDialog, paneHidden }: {
  session: TerminalSession; nameOf: (pid: string) => string;
  onClose: () => void; onForget: () => void; canArrange: boolean; onDetach: () => void; onExit: (code: number) => void;
  // Dialog dokumen/integrasi dipegang layar (satu tempat untuk sel, rail, dan pane fokus).
  onDialog: (kind: SessionDialogKind) => void;
  onReview?: (specId: string) => void;
  onSessionReview?: (sessionId: string, title: string) => void;
  titleOf?: (specId: string) => string | undefined;
  onIntegrate?: (spec: SpecSlim, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  specOf?: (specId: string) => SpecSlim | undefined;
  // Hanya kunci render ulang: `titleOf`/`specOf` stabil, jadi perubahan backlog harus lewat prop ini.
  backlog?: SpecSlim[];
  fontSize: number; showKeys: boolean; predict: boolean; diag: boolean; screenReader: boolean;
  fullscreen: boolean; onFullscreen: () => void; paneHidden?: boolean;
}) {
  const [phases, setPhases] = React.useState<Phase[] | null>(null);
  // SPEC-800 · yang menentukan strip fase ringkas adalah lebar SEL, bukan viewport: sel sempit
  // (grid 4 kolom di desktop) butuh chip ringkas agar tak terpotong `overflow: hidden`.
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = React.useState(Number.POSITIVE_INFINITY);
  React.useEffect(() => {
    const el = bodyRef.current;
    // jsdom tak punya ResizeObserver; lebar yang tak terukur = tampilan lengkap (perilaku lama).
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      if (width > 0) setBodyWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // SPEC-433 · verdict dari server, bukan kesimpulan klien: gerbang plan `- [ ]` (ADR-0029) hanya
  // bisa dibaca di sisi yang memegang worktree-nya.
  const [complete, setComplete] = React.useState(false);
  const onPhases = React.useCallback((p: Phase[], done: boolean) => { setPhases(p); setComplete(done); }, []);
  const label = cellLabel(session, nameOf, titleOf);
  // SPEC-196 · sesi yang berhenti menunggu keputusan manusia (marker) belum `exited` — beri
  // pembeda sendiri. `exited` menang bila keduanya benar (proses sudah beku).
  const awaiting = !session.exited && !!session.decision;
  // SPEC-409 · ADR-0091 · AC-3 · lead sedang menyusun keputusannya. MENANG atas `awaiting`, dan
  // BERDIRI SENDIRI: sejak SPEC-903/ADR-0143 `decision` padam tiap kali pane mengeluarkan sesuatu —
  // termasuk saat lead mengetik jawabannya — jadi menyarangkannya di dalam `awaiting` membuat sel
  // ini DIAM justru pada sesi yang sedang dilayani. Tabelnya cermin `sessionKind` milik pet-state.
  const deciding = !session.exited && !!session.deciding;
  // Keduanya menuntut mata operator; hanya pilnya yang berbeda. Satu nama supaya tint header dan
  // ilustrasi tak bisa berselisih dengan pil di sebelahnya.
  const attention = awaiting || deciding;
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
      : attention ? "PST-004" : "PST-003";
  // Aksi sekunder dikumpulkan di satu menu ⋯ dengan label teks (audit UI/UX). Ikon-saja di header sel
  // yang sempit tak terbaca, dan tak punya nama bagi pembaca layar. "Tutup" tetap di luar menu: ia
  // satu-satunya aksi yang menghentikan agen, jadi ia berdiri sendiri dan dikonfirmasi.
  // Menu ⋯ sel grid: satu sumber dengan rail dan pane fokus (sessionMenuItems). Sel grid tetap
  // memegang tombol × sendiri, jadi menunya tak memuat "Tutup".
  const menuItems = sessionMenuItems(session, {
    label, canArrange, specOf, onReview, onSessionReview, onIntegrate, onIntegrateSession,
    onDialog, onDetach, onFullscreen,
  });
  return (
    <>
      {/* Latar kepala ditentukan oleh `data-cell-tone` (prioritas: gagal > selesai > perhatian > netral). */}
      <div className={session.exited ? "hn-terminal-cell-header is-exited" : "hn-terminal-cell-header"}
        data-cell-tone={failed ? "failed" : session.exited || finished ? "done" : attention ? "attention" : "idle"}>
        {stateIllustration && (
          // Lebar 34px ada di pembungkus (kelas), bukan di <img>: Illustration sudah memberi
          // `width: 100%` inline pada gambar, dan inline itu menang atas kelas.
          <span className="hn-terminal-cell-illus">
            <ProductStateIllustration id={stateIllustration} decorative />
          </span>
        )}
        <span className="hn-terminal-cell-title">
          {label} · {session.id.slice(0, 6)}
        </span>
        {/* ADR-0164 · model & effort orchestrator; model tiap fase ada di chip PhaseStrip. */}
        {session.orchestrated && session.model && (
          <span data-testid="orchestrator-chip" title="Model & effort orchestrator"
            className="hn-terminal-orch">
            orch {modelLabel(session.model)}{session.effort ? ` · ${session.effort}` : ""}
          </span>
        )}
        {/* SPEC-402 · kode keluar ikut tercetak: "Gagal" tanpa angka menyisakan pertanyaan
            "gagal kenapa", dan angkanya (143 = SIGTERM) itulah petunjuknya. */}
        {session.exited && (failed
          ? <StatusPill status="failed" size="sm">{`Gagal · exit ${session.exitCode}`}</StatusPill>
          : <StatusPill status="done" size="sm">Selesai</StatusPill>)}
        {finished && <StatusPill status="done" size="sm">Selesai</StatusPill>}
        {/* SPEC-433 · `finished` membungkam marker: pada codex marker keputusan MENYALA saat sesi
            selesai wajar (tak ada event Notification → dipasang di Stop+UserPromptSubmit,
            ADR-0074), jadi membiarkan `awaiting` menang mengulang bug ini untuk separuh agen. */}
        {deciding && !finished && <StatusPill status="running" size="sm">Lead memutuskan</StatusPill>}
        {awaiting && !deciding && !finished && <StatusPill status="awaiting" size="sm" />}
        {/* Aksi sel: satu menu ⋯ untuk aksi sekunder, lalu "Tutup" yang berdiri sendiri. Tutup
            menghentikan agen, jadi ia selalu lewat konfirmasi (`onClose` = requestKill). */}
        <span className="hn-terminal-actions">
          <OverflowActions label={`Aksi sesi ${session.id}`} items={menuItems} />
          <button type="button" className="hn-terminal-action" aria-label={`Tutup sesi ${session.id}`}
            title="Tutup sesi (dikonfirmasi dulu)" onClick={onClose}>
            <Icon name="x" size={12} />
          </button>
        </span>
      </div>
      {/* Sesi berakhir (SPEC-188): badan diredupkan agar terbaca beku; header + badge
          "Selesai" tetap penuh supaya statusnya justru paling kontras.
          ADR-0164 review 2 · `position: relative` di sini (bukan di wrapper `phase-strip`) jadi
          containing block panel detail fase: tinggi = strip + pane, selalu definit dan selalu
          di dalam sel (yang `overflow: hidden`), jadi panel tak bisa lagi meluber ke luar sel. */}
      <div ref={bodyRef} className="hn-terminal-cell-body">
        {session.exited && <SessionEndedBanner />}
        <PhaseStrip phases={phases} compact={bodyWidth < 480} />
        {/* key = identitas sesi: pindah antar sel memindah subtree, bukan me-remount WebSocket.
            SPEC-232 · saat sel ini sedang layar-penuh, pane-nya dilepas (placeholder) supaya
            hanya modal yang meng-attach tmux — jaga invariant satu sesi = satu attach. */}
        <div className="hn-terminal-cell-pane">
          {fullscreen
            ? <div className="hn-terminal-cell-fullscreen">
                Terbuka di layar penuh
              </div>
            : <TerminalPane key={session.id} sessionId={session.id} onExit={onExit} onPhases={onPhases}
                fontSize={fontSize} showKeys={showKeys} predict={predict} diag={diag} screenReader={screenReader}
                hidden={paneHidden}
                onForget={onForget} label={cellLabel(session, nameOf, titleOf)} />}
        </div>
      </div>
    </>
  );
}

// Aksi sekunder satu sesi (Audit UI/UX 2026-10 · Fase 3E). Dipakai sel grid, baris rail, dan kepala
// pane fokus. Urutan tetap: dokumen, review, integrasi, lepas, layar penuh, lalu tutup (destruktif;
// "Tutup" selalu dikonfirmasi lewat `onKill` → requestKill). Dialog dokumen/integrasi dibuka lewat
// `onDialog` supaya ia bertahan walau baris/sel yang membukanya lenyap (mis. drawer mobile).
type SessionMenuCtx = {
  label: string;
  canArrange: boolean;
  specOf?: (specId: string) => SpecSlim | undefined;
  onReview?: (specId: string) => void;
  onSessionReview?: (sessionId: string, title: string) => void;
  onIntegrate?: (spec: SpecSlim, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  onDialog: (kind: SessionDialogKind) => void;
  onDetach: () => void;
  onFullscreen: () => void;
  onKill?: () => void;
};

export function sessionMenuItems(s: TerminalSession, c: SessionMenuCtx): OverflowItem[] {
  const items: OverflowItem[] = [];
  const spec = s.specId ? c.specOf?.(s.specId) : undefined;
  // SPEC-230 · sesi project-level ber-branch (PRD) tanpa Spec: review + integrate ber-skop sesi.
  const branchSession = !s.specId && !!s.branch;
  if (s.specId) {
    items.push({ key: "docs", label: "Lihat dokumen", icon: "file-text",
      title: "Lihat dokumen (audit/spec/plan)", onSelect: () => c.onDialog("docs") });
  }
  const specId = s.specId;
  if (specId && c.onReview) {
    const onReview = c.onReview;
    items.push({ key: "review", label: "Review perubahan", icon: "git-compare",
      title: "Review perubahan (diff worktree)", onSelect: () => onReview(specId) });
  }
  // SPEC-230 · review diff worktree sesi project-level (PRD, tanpa Spec).
  if (branchSession && c.onSessionReview) {
    const onSessionReview = c.onSessionReview;
    items.push({ key: "review-session", label: "Review perubahan", icon: "git-compare",
      title: "Review perubahan (diff worktree sesi)", onSelect: () => onSessionReview(s.id, c.label) });
  }
  // SPEC-175 · rebase/merge branch hasil spec (muncul hanya bila spec-nya dikenal).
  if (spec && c.onIntegrate) {
    items.push({ key: "integrate", label: "Rebase / Merge branch", icon: "git-merge",
      title: "Rebase / Merge branch spec", onSelect: () => c.onDialog("integrate") });
  }
  // SPEC-230 · rebase/merge branch sesi project-level (PRD prd/<slug>).
  if (branchSession && c.onIntegrateSession) {
    items.push({ key: "integrate-session", label: "Rebase / Merge branch", icon: "git-merge",
      title: "Rebase / Merge branch sesi", onSelect: () => c.onDialog("sessIntegrate") });
  }
  items.push({ key: "detach", label: "Lepas dari grid", icon: "unlink", disabled: !c.canArrange,
    title: "Lepas dari grid (sesi tetap hidup)", onSelect: c.onDetach });
  // SPEC-232 · lihat SATU terminal ini secara penuh dalam modal.
  items.push({ key: "fullscreen", label: "Layar penuh", icon: "fullscreen",
    title: "Layar penuh — fokus 1 terminal", onSelect: c.onFullscreen });
  if (c.onKill) {
    items.push({ key: "close", label: "Tutup sesi", icon: "square", tone: "danger",
      title: "Tutup sesi (dikonfirmasi dulu)", onSelect: c.onKill });
  }
  return items;
}

// Dialog dokumen dan integrasi milik satu sesi, dirender layar. Tiap kondisi cocok dengan item menu
// yang membukanya (sessionMenuItems), jadi dialog tak pernah terbuka untuk sesi yang tak mendukungnya.
function SessionDialogs({ kind, session, specOf, onIntegrate, onIntegrateSession, onClose }: {
  kind: SessionDialogKind; session: TerminalSession;
  specOf?: (specId: string) => SpecSlim | undefined;
  onIntegrate?: (spec: SpecSlim, op: "merge" | "rebase", target: string) => void;
  onIntegrateSession?: (session: TerminalSession, op: "merge" | "rebase", target: string) => void;
  onClose: () => void;
}) {
  if (kind === "docs") {
    return session.specId ? <SpecDocsModal specId={session.specId} onClose={onClose} /> : null;
  }
  if (kind === "integrate") {
    const spec = session.specId ? specOf?.(session.specId) : undefined;
    if (!spec || !onIntegrate) return null;
    return (
      <IntegrateDialog projectId={spec.projectId}
        ownBranch={`hanoman/${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`} eyebrow={spec.id}
        onClose={onClose}
        onIntegrate={(op, target) => { onClose(); onIntegrate(spec, op, target); }} />
    );
  }
  if (!session.branch || session.specId || !onIntegrateSession) return null;
  return (
    <IntegrateDialog projectId={session.projectId} ownBranch={session.branch} eyebrow={session.id.slice(0, 16)}
      onClose={onClose}
      onIntegrate={(op, target) => { onClose(); onIntegrateSession(session, op, target); }} />
  );
}

// "Buka…": pemicu untuk cara membuka sesi selain "Sesi baru". Di ruang sempit ia ikon ber-label
// "Buka…" (nama aksesibelnya sama, tak ada teks yang terpotong). Panelnya Modal DS, sama dengan menu
// ⋯ lain (fokus, Escape, sheet di mobile).
// Tooltip menu "Buka…": ikon di layar sempit tak menjelaskan isinya, dan sentuh tak punya hover.
const OPEN_MENU_HINT = "Buka sesi lain: ambil backlog, riwayat sesi, atau terminal biasa";

function OpenMenu({ items, compact = false }: { items: readonly OverflowItem[]; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      {compact ? (
        // Sempit: ikon folder. Teks "Buka…" ikut tampil dari 641px (`.hn-terminal-open-text`); nama aksesibelnya
        // tetap "Buka…" di semua lebar.
        <button type="button" className="hn-terminal-open-compact" aria-label="Buka…" title={OPEN_MENU_HINT}
          aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="folder-open" size={16} />
          <span className="hn-terminal-open-text">Buka…</span>
        </button>
      ) : (
        <Button size="sm" variant="ghost" aria-haspopup="dialog" aria-expanded={open} title={OPEN_MENU_HINT}
          onClick={() => setOpen(true)}>Buka…</Button>
      )}
      {open && (
        <Modal open title="Buka sesi" icon="terminal" width={420} onClose={() => setOpen(false)}>
          <div className="hn-terminal-menu-list">
            {items.map((item) => (
              <button key={item.key} type="button" disabled={item.disabled} title={item.title}
                className="hn-overflow-item"
                onClick={() => { setOpen(false); item.onSelect(); }}>
                {item.icon && <Icon name={item.icon} size={15} />}
                {item.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

// Pane fokus (Audit UI/UX 2026-10 · Fase 3E): satu TerminalPane untuk sesi fokus, kepala ringkas
// (nama, satu status, ⋯), banner Berakhir, strip fase, lalu composer di dock bawah. Rail di kiri
// desktop; di mobile rail jadi laci. Hanya SATU pane yang dipasang, jadi satu sesi = satu attach tmux.
type FocusViewProps = {
  sessionCount: number;
  focused: TerminalSession | null;
  railItems: RailItem[];
  mobile: boolean;
  listError: boolean;
  menuFor: (s: TerminalSession) => OverflowItem[];
  onFocus: (id: string) => void;
  drawerOpen: boolean;
  onDrawer: (open: boolean) => void;
  fullId: string | null;
  focusPhases: { sessionId: string; phases: Phase[] } | null;
  paneHandlers: (id: string) => { onExit: (code: number) => void; onPhases: (p: Phase[], done: boolean) => void; onForget: () => void };
  fontSize: number; showKeys: boolean; onToggleKeys: () => void; predict: boolean; diag: boolean; screenReader: boolean;
};

function FocusView({ sessionCount, focused, railItems, mobile, listError, menuFor, onFocus, drawerOpen, onDrawer,
  fullId, focusPhases, paneHandlers, fontSize, showKeys, onToggleKeys, predict, diag, screenReader }: FocusViewProps) {
  const current = focused ? railItems.find((item) => item.session.id === focused.id) : undefined;
  return (
    <div className="hn-terminal-focus" data-testid="terminal-focus">
      {!mobile && sessionCount > 0 && (
        <aside className="hn-terminal-rail" aria-label="Sesi terminal">
          <div className="hn-terminal-rail-head">
            <span>Sesi</span>
            <span>{sessionCount}</span>
          </div>
          <div className="hn-terminal-rail-scroll">
            <SessionRail items={railItems} focusedId={focused?.id ?? null} onFocus={onFocus} menuFor={menuFor} />
          </div>
        </aside>
      )}
      <section className="hn-terminal-focus-main" aria-label="Terminal fokus">
        {focused && current ? (
          <>
            {/* Kepala satu baris: nama, satu status, ⋯. Di ponsel tombol "Sesi · N" ada di toolbar. */}
            <header className="hn-terminal-focus-head">
              <span className="hn-terminal-focus-title" title={current.label}>
                {current.label} · {focused.id.slice(0, 6)}
              </span>
              <StatusPill status={RAIL_PILL[current.status.tone]} size="sm" variant="dot">{current.status.label}</StatusPill>
              <OverflowActions label={`Aksi sesi ${focused.id}`} items={menuFor(focused)} />
            </header>
            {focused.exited && <SessionEndedBanner />}
            <PhaseStrip compact={mobile} phases={focusPhases?.sessionId === focused.id ? focusPhases.phases : null} />
            <div className="hn-terminal-focus-body">
              {fullId === focused.id ? (
                <div className="hn-terminal-focus-placeholder">Terbuka di layar penuh</div>
              ) : (
                <TerminalPane key={focused.id} sessionId={focused.id} {...paneHandlers(focused.id)}
                  fontSize={fontSize} showKeys={showKeys} predict={predict} diag={diag} screenReader={screenReader}
                  composer compact={mobile} onToggleKeys={onToggleKeys} label={current.label} />
              )}
            </div>
          </>
        ) : listError ? null : (
          <StateBlock kind="empty" icon="terminal" title="Belum ada sesi terminal"
            hint="Tekan Sesi baru untuk memulai agen di project terpilih, atau Terminal biasa untuk shell." />
        )}
      </section>
      {mobile && drawerOpen && (
        <Modal open title="Sesi terminal" icon="terminal" width={460} onClose={() => onDrawer(false)}>
          <SessionRail items={railItems} focusedId={focused?.id ?? null}
            onFocus={(id) => { onFocus(id); onDrawer(false); }} menuFor={menuFor} />
        </Modal>
      )}
    </div>
  );
}

// Sesi berakhir (SPEC-188). Dulu seluruh badan diredupkan `opacity: .6`, yang menurunkan kontras
// teks output di bawah ambang yang terbaca (audit UI/UX). Sekarang badan tetap penuh kontras dan
// keadaan "berakhir" disampaikan lewat banner sendiri; pill "Selesai"/"Gagal" di header tetap ada.
function SessionEndedBanner() {
  return (
    <div role="status" data-testid="terminal-ended" className="hn-terminal-ended">
      <strong className="hn-terminal-ended-title">Berakhir</strong>
      <span className="hn-terminal-ended-body">
        Agen sudah berhenti. Output tetap bisa dibaca; tutup sel bila tak diperlukan lagi.
      </span>
    </div>
  );
}

// SPEC-232 · fullscreen SATU terminal sebagai modal. Pane-nya hidup di sini; sel asalnya
// menampilkan placeholder (lihat Cell) supaya tmux tetap satu attach. closeOnEscape=false:
// Escape tombol tersibuk TUI Claude Code — keluar via × / backdrop saja (sejalan maximize-grid,
// SPEC-163). Menutup modal memasang ulang pane di sel (reconnect murah; scrollback dari tmux).
function FullscreenTerminal({ session, label, fontSize, showKeys, predict, diag, screenReader, onClose }: {
  session: TerminalSession; label: string; fontSize: number; showKeys: boolean; predict: boolean; diag: boolean;
  screenReader: boolean; onClose: () => void;
}) {
  return (
    <Modal open icon="terminal" title={label} onClose={onClose} closeOnEscape={false} width={1600}>
      <div className="hn-terminal-fullscreen-body">
        {session.exited && <SessionEndedBanner />}
        <TerminalPane key={session.id} sessionId={session.id} onExit={() => {}}
          fontSize={fontSize} showKeys={showKeys} predict={predict} diag={diag} screenReader={screenReader} />
      </div>
    </Modal>
  );
}

function EmptyCell({ unplaced, nameOf, onPick, disabled }: {
  unplaced: TerminalSession[]; nameOf: (pid: string) => string; onPick: (id: string) => void; disabled: boolean;
}) {
  return (
    <div className="hn-terminal-empty-cell">
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
