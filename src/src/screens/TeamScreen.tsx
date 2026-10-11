import React from "react";
import { memberId, type MemberView, type TaskStatus, type TaskView, type TopicParams } from "@hanoman/shared";
import {
  Button, Select, StateBlock, Tabs, LiveConnectionBadge, FilterBar, OverflowActions, Field, Stack,
  useToast, ToastHost, type FilterChip,
} from "../ds";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import { SyncButton } from "./SyncButton";
import { TeamBoard } from "./team-board";
import { TeamTimeline, TeamProjectTimeline } from "./team-timeline";
import { TaskModal } from "./TaskModal";
import { EscalateDialog } from "./EscalateDialog";
import { MembersPanel } from "./MembersPanel";
import {
  TEAM_COLUMNS, TIMELINE_ZOOMS, emptyBoard, moveCard, nextOrder, replaceCard,
  type Board, type TimelineZoom,
} from "./team-rules";
import { usePersistedState, isStr, oneOf, strList } from "../ui-state";
import type { ProjectVM } from "./types";
import { errorMessage } from "../lib/report-error";
import "./styles/team.css";

/* TeamScreen — papan kerja MANUSIA (SPEC-946 · ADR-0150/ADR-0151). Screen mandiri (pola
   TriageScreen): memuat datanya sendiri, tak lewat `gate` App.

   Redesign Audit UI/UX 2026-10 · Fase 3D:
   - Lensa "Saya" = tugas yang ditugaskan ke pengguna yang sedang login (bila akunnya terdaftar
     sebagai anggota); "Semua" melepasnya. Lensa adalah bawaan, bukan penyaring yang harus disetel.
   - Baris alat ≤6 kontrol: lensa, mode, pencarian, Filter (popover), Tugas baru, ⋯ (anggota).
   - Papan dan linimasa tetap; linimasa membaca papan yang sama dan membawa legenda sendiri.

   Papan berlangganan PER KOLOM. `zSubLimit` menjepit `limit` ke 200 dan `order` bermakna DI DALAM
   kolom, jadi satu langganan untuk seluruh papan memotong himpunan gabungan empat kolom di titik
   yang sewenang-wenang. Empat langganan memberi tiap kolom `total`-nya sendiri. Biayanya 4 dari MAX_SUBS = 16. */

const POLL_MS = 5000;
// ADR-0107 · PLAFON, bukan preferensi — nilainya sama dengan batas atas `zSubLimit`, supaya muat
// awal HTTP dan langganan WS memotong di titik yang SAMA.
const COLUMN_LIMIT = 200;
// SPEC-908 · jeda sebelum ketikan mengubah KUNCI langganan.
const Q_DEBOUNCE_MS = 400;
// Nilai lensa "Saya". Disimpan sebagai sentinel: anggota pengguna baru diketahui setelah muat, jadi
// nilai ini diterjemahkan ke id anggota saat dipakai, bukan saat disimpan.
const LENS_ME = "me";
const LENS_ALL = "all";

/* Diekspor supaya `team-screen.test.tsx` bisa menegakkan cermin `TEAM_VIEWS` ↔ cabang render:
   entri yang tak punya cabangnya sendiri merender permukaan mode LAIN di bawah pilnya. */
export const TEAM_VIEWS = [
  { value: "board", label: "Papan", icon: "kanban" },
  // SPEC-948 · `gantt-chart` → `GanttChart` DIVERIFIKASI ada di lucide 0.400.0.
  { value: "timeline", label: "Linimasa", icon: "gantt-chart" },
  // SPEC-949 · `layers` → `Layers`, diverifikasi di lucide yang sama.
  { value: "projects", label: "Lintas project", icon: "layers" },
];

const ZOOM_LABEL: Record<TimelineZoom, string> = { day: "Hari", week: "Minggu", month: "Bulan" };

type Totals = Record<TaskStatus, number>;
const zeroTotals = (): Totals =>
  Object.fromEntries(TEAM_COLUMNS.map((c) => [c.key, 0])) as Totals;

/* Satu langganan per kolom. Komponen tanpa render karena jumlah pemanggilan hook harus tetap
   sah saat kolom disaring keluar. */
function ColumnFeed({ status, params, onData, refetch }: {
  status: TaskStatus;
  params: Omit<TopicParams["tasks"], "status">;
  onData: (status: TaskStatus, items: TaskView[], total: number) => void;
  refetch: () => void;
}) {
  useLiveTopic({
    topic: "tasks",
    params: { ...params, status },
    apply: (m) => onData(status, m.data.items, m.data.total),
    refetch, pollMs: POLL_MS,
  });
  return null;
}

export function TeamScreen({ projects, projectFilter, onProjectFilter, onToast, onOpenSpec }: {
  projects: ProjectVM[]; projectFilter: string;
  onProjectFilter: (v: string) => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  /** Membuka spec terkait di layar Backlog. Opsional: tanpa ini tautan spec tetap statis. */
  onOpenSpec?: (specId: string) => void;
}) {
  const [board, setBoard] = React.useState<Board>(emptyBoard);
  const [totals, setTotals] = React.useState<Totals>(zeroTotals);
  const [members, setMembers] = React.useState<MemberView[]>([]);
  // Audit 2026-10: daftar anggota yang gagal dimuat harus terlihat, bukan dropdown kosong yang
  // menyesatkan ("Semua anggota" saja seolah tim tak punya anggota).
  const [membersError, setMembersError] = React.useState("");
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  // SPEC-857 · ADR-0131 · saat refetch gagal, papan yang sudah tampil TIDAK boleh berubah jadi
  // layar galat: operator harus tahu ia sedang membaca nilai basi, bukan papan yang menyusut.
  const [stale, setStale] = React.useState(false);
  const [editing, setEditing] = React.useState<TaskView | null>(null);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [membersOpen, setMembersOpen] = React.useState(false);
  const [escalating, setEscalating] = React.useState<TaskView | null>(null);
  // Email pengguna yang login. Dibaca sekali; dipakai untuk lensa "Saya" lewat `memberId` (ADR-0094).
  const [meEmail, setMeEmail] = React.useState<string | null>(null);
  // Toast dengan aksi "Urungkan" untuk pindah & tugaskan (reversibel). Kegagalan tetap lewat onToast.
  const [toast, showToast] = useToast();

  // SPEC-740 · ADR-0115 · state tampilan layar ini persisten berkunci `team`. Tak ada `page`:
  // papan tidak dipaginasi.
  const [view, setView] = usePersistedState<string>("team", "view", "board",
    oneOf(...TEAM_VIEWS.map((v) => v.value)));
  const [q, setQ] = usePersistedState("team", "q", "", isStr);
  const [colFilter, setColFilter] = usePersistedState("team", "col", "all", isStr);
  // Bawaan `me`: papan dibuka sebagai tugas SAYA. Nilai lama `all` (dari sebelum lensa ada) tetap berlaku.
  const [memberFilter, setMemberFilter] = usePersistedState("team", "member", LENS_ME, isStr);
  // SPEC-948 · bawaan `week`: hari terlalu sempit untuk melihat tabrakan, bulan terlalu kasar untuk
  // melihat tenggat. Zoom bukan PENYARING — ia tak ikut penyaring dan tak menyentuh server.
  const [zoom, setZoom] = usePersistedState<TimelineZoom>("team", "zoom", "week",
    oneOf(...TIMELINE_ZOOMS));
  // SPEC-949 · baris project yang sedang dibuka. `strList` menolak nilai rusak (ADR-0115).
  const [expanded, setExpanded] = usePersistedState<string[]>("team", "expanded", [], strList);
  const toggleProject = React.useCallback((key: string) => {
    setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, [setExpanded]);
  const timeline = view === "timeline";
  const cross = view === "projects";
  // Dibekukan sekali per mount: jendela yang bergeser di tengah interaksi lebih membingungkan
  // daripada tanggal yang basi satu hari sampai tab dimuat ulang.
  const today = React.useRef(Date.now()).current;

  React.useEffect(() => {
    let alive = true;
    // `?.`: klien tanpa `authStatus` (test) tak punya identitas; lensa "Saya" lalu tak muncul.
    const p = api.authStatus?.();
    p?.then((r) => { if (alive) setMeEmail(r.user?.email ?? null); })
      .catch(() => { if (alive) setMeEmail(null); });
    return () => { alive = false; };
  }, []);

  const columns = React.useMemo(
    () => (colFilter === "all" ? TEAM_COLUMNS : TEAM_COLUMNS.filter((c) => c.key === colFilter)),
    [colFilter],
  );
  // Larik baru tiap render; yang stabil kuncinya, bukan referensinya.
  const columnsKey = columns.map((c) => c.key).join(",");

  // Mode yang gunanya membandingkan antar-project tak boleh mendarat menampilkan satu baris karena
  // penyaring yang disetel di layar lain masih menempel. Diturunkan SEBELUM `useMemo` dan dipakai
  // sebagai dependensinya (lihat catatan di `load`).
  const effectiveProject = cross || projectFilter === "all" ? undefined : projectFilter;

  // Id anggota pengguna yang login, bila akunnya memang terdaftar sebagai anggota tim.
  const meId = React.useMemo(() => {
    if (!meEmail) return null;
    const id = memberId(meEmail);
    return members.some((m) => m.id === id) ? id : null;
  }, [meEmail, members]);
  // Penyaring anggota yang berlaku: "Saya" → id pengguna (bila ada), "Semua" → tanpa penyaring.
  const memberSel = memberFilter === LENS_ME ? (meId ?? undefined)
    : memberFilter === LENS_ALL ? undefined : memberFilter;
  const memberIsOther = memberFilter !== LENS_ME && memberFilter !== LENS_ALL;

  const filters = React.useMemo(() => ({
    projectId: effectiveProject,
    memberId: memberSel,
    q: q.trim() || undefined,
  }), [effectiveProject, memberSel, q]);

  // Muat PERTAMA boleh mengosongkan layar; yang berikutnya tidak.
  const loadedOnce = React.useRef(false);

  const load = React.useCallback((silent = false) => {
    if (!silent && !loadedOnce.current) setState("loading");
    const keys = (columnsKey ? columnsKey.split(",") : []) as TaskStatus[];
    Promise.all(keys.map((status) =>
      api.listTasks({ ...filters, status, page: 1, limit: COLUMN_LIMIT })))
      .then((pages) => {
        setBoard((prev) => {
          const next: Board = { ...prev };
          keys.forEach((k, i) => { next[k] = pages[i]!.items; });
          return next;
        });
        setTotals((prev) => {
          const next: Totals = { ...prev };
          keys.forEach((k, i) => { next[k] = pages[i]!.total; });
          return next;
        });
        loadedOnce.current = true;
        setStale(false);
        setState("ready");
      })
      .catch(() => {
        if (!loadedOnce.current) { setState("error"); return; }
        setStale(true);
      });
  }, [filters, columnsKey]);

  React.useEffect(() => { load(); }, [load]);

  const loadMembers = React.useCallback(() => {
    // Papan tetap jalan tanpa nama: kartu jatuh ke "belum ditugaskan", bukan ke layar galat.
    api.listMembers()
      .then((r) => { setMembers(r.items); setMembersError(""); })
      .catch((e: unknown) => setMembersError(errorMessage(e, "tidak diketahui")));
  }, []);
  React.useEffect(() => { loadMembers(); }, [loadMembers]);

  // `q` yang menyuapi LANGGANAN ditahan; muat HTTP di atas tetap per-ketikan.
  const [liveQ, setLiveQ] = React.useState(() => q.trim());
  React.useEffect(() => {
    const t = setTimeout(() => setLiveQ(q.trim()), Q_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const applyFeed = React.useCallback((status: TaskStatus, items: TaskView[], total: number) => {
    setBoard((prev) => ({ ...prev, [status]: items }));
    setTotals((prev) => ({ ...prev, [status]: total }));
    loadedOnce.current = true;
    setStale(false);
    setState("ready");
  }, []);

  const subParams = React.useMemo(() => ({
    projectId: filters.projectId, memberId: filters.memberId,
    q: liveQ || undefined, page: 1, limit: COLUMN_LIMIT,
  }), [filters.projectId, filters.memberId, liveQ]);

  const refetchSilently = React.useCallback(() => load(true), [load]);

  async function move(task: TaskView, to: TaskStatus) {
    const moved = moveCard(board, task.id, task.status, to);
    if (!moved) return;
    // Papan sebelum pemindahan, ditangkap dari closure render ini — itulah keadaan yang harus
    // dipulihkan bila server menolak. Papan tak boleh menampilkan kartu di kolom yang tak
    // pernah disimpan.
    const before = board;
    setBoard(moved.board);
    try {
      await api.patchTask(task.id, moved.patch);
      const label = TEAM_COLUMNS.find((c) => c.key === to)?.label ?? to;
      showToast(`Tugas dipindah ke ${label}`, "ok", undefined, {
        action: { label: "Urungkan", onAction: () => { void undoPatch(task.id, { status: task.status }); } },
      });
    } catch {
      setBoard(before);
      onToast("Gagal memindahkan tugas", "err", "x-circle");
    }
  }

  async function assign(task: TaskView, nextMember: string | null) {
    const before = board;
    setBoard(replaceCard(board, { ...task, memberId: nextMember }));
    try {
      await api.patchTask(task.id, { memberId: nextMember });
      const name = nextMember ? members.find((m) => m.id === nextMember)?.name ?? "anggota" : null;
      showToast(name ? `Ditugaskan ke ${name}` : "Penugasan dikosongkan", "ok", undefined, {
        action: { label: "Urungkan", onAction: () => { void undoPatch(task.id, { memberId: task.memberId }); } },
      });
    } catch {
      setBoard(before);
      onToast("Gagal menugaskan", "err", "x-circle");
    }
  }

  // Urung = kirim kebalikan lalu segarkan papan dari server. Tak memakai `board` dari closure
  // render lama (ia bisa sudah basi); kebenaran papan berasal dari muat ulang.
  async function undoPatch(id: string, patch: { status?: TaskStatus; memberId?: string | null }) {
    try {
      await api.patchTask(id, patch);
      refetchSilently();
    } catch {
      onToast("Gagal mengurungkan perubahan", "err", "x-circle");
    }
  }

  // SPEC-947 · lepas tautan tak butuh konfirmasi: ia non-destruktif (Spec dibiarkan) dan
  // reversibel lewat eskalasi ulang.
  async function unlink(task: TaskView) {
    const before = board;
    setBoard(replaceCard(board, { ...task, specId: null, spec: null }));
    try {
      await api.unlinkTaskSpec(task.id);
      onToast("Tautan backlog dilepas", "ok", "unlink");
    } catch {
      setBoard(before);
      onToast("Gagal melepas tautan", "err", "x-circle");
    }
  }

  const empty = columns.every((c) => board[c.key].length === 0);
  // Tugas yang tampil dipersempit oleh penyaring (termasuk lensa orang lain). Lensa "Saya" juga
  // dihitung: papan kosong "untuk saya" bukan papan yang belum punya tugas.
  const searching = q.trim() !== "";
  const chipCount = (!cross && projectFilter !== "all" ? 1 : 0)
    + (colFilter !== "all" ? 1 : 0) + (memberIsOther ? 1 : 0);
  const narrowed = chipCount > 0 || searching || memberSel !== undefined;
  const projName = projects.find((p) => p.id === projectFilter)?.name ?? projectFilter;
  const memberName = members.find((m) => m.id === memberFilter)?.name ?? memberFilter;
  const colLabel = TEAM_COLUMNS.find((c) => c.key === colFilter)?.label ?? colFilter;
  // Hapus penyaring: kembali ke lensa bawaan (Saya). Tampilkan semua: lensa juga dilepas.
  const resetFilters = () => {
    if (!cross) onProjectFilter("all");
    setColFilter("all"); setMemberFilter(LENS_ME); setQ("");
  };
  const showAll = () => {
    if (!cross) onProjectFilter("all");
    setColFilter("all"); setMemberFilter(LENS_ALL); setQ("");
  };
  // Linimasa membaca papan yang SAMA — nol fetch dan nol langganan tambahan (ADR-0151).
  const tasks = React.useMemo(() => columns.flatMap((c) => board[c.key]), [board, columns]);
  const hiddenTasks = columns.reduce(
    (n, c) => n + Math.max(0, (totals[c.key] ?? 0) - board[c.key].length), 0);
  const totalShown = columns.reduce((n, c) => n + (totals[c.key] ?? 0), 0);

  const chips: FilterChip[] = [
    ...(!cross && projectFilter !== "all" ? [{ key: "project", label: `Project: ${projName}`,
      onRemove: () => onProjectFilter("all") }] : []),
    ...(colFilter !== "all" ? [{ key: "col", label: `Kolom: ${colLabel}`,
      onRemove: () => setColFilter("all") }] : []),
    ...(memberIsOther ? [{ key: "member", label: `Anggota: ${memberName}`,
      onRemove: () => setMemberFilter(LENS_ME) }] : []),
  ];
  // Pilihan anggota di popover. "Saya" hanya ada bila akunnya terdaftar; tanpanya nilai "me" jatuh ke "Semua".
  const memberOptions = [
    ...(meId ? [{ value: LENS_ME, label: "Saya" }] : []),
    { value: LENS_ALL, label: "Semua anggota" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];
  const memberSelectValue = memberFilter === LENS_ME && !meId ? LENS_ALL : memberFilter;
  const filtersPanel = (
    <Stack gap={3}>
      {/* SPEC-146 · App pemilik tunggal "daftar disaring ke project mana". */}
      <Field label="Project">
        <Select size="sm" aria-label="Filter project" value={projectFilter} disabled={cross}
          onChange={(e) => onProjectFilter(e.target.value)}
          options={[{ value: "all", label: "Semua project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
      </Field>
      {/* Sebabnya DIRENDER, bukan `title`: kontrol `disabled` tak menampilkan tooltip. */}
      {cross && <p data-testid="project-filter-note" className="hn-tm-hint">Mode ini melintasi semua project</p>}
      <Field label="Anggota">
        <Select size="sm" aria-label="Filter anggota" value={memberSelectValue} disabled={!!membersError}
          onChange={(e) => setMemberFilter(e.target.value)} options={memberOptions} />
      </Field>
      {membersError && (
        <p role="alert" className="hn-tm-hint hn-tm-alert">
          Anggota gagal dimuat: {membersError}
        </p>
      )}
      <Field label="Kolom">
        {/* Menyaring kolom di sebuah PAPAN = mempersempit kolom yang tampil. */}
        <Select size="sm" aria-label="Filter kolom" value={colFilter}
          onChange={(e) => setColFilter(e.target.value)}
          options={[{ value: "all", label: "Semua kolom" }, ...TEAM_COLUMNS.map((c) => ({ value: c.key, label: c.label }))]} />
      </Field>
      {(timeline || cross) && (
        <Field label="Zoom">
          <Select size="sm" aria-label="Zoom linimasa" value={zoom}
            onChange={(e) => setZoom(e.target.value as TimelineZoom)}
            options={TIMELINE_ZOOMS.map((z) => ({ value: z, label: ZOOM_LABEL[z] }))} />
        </Field>
      )}
    </Stack>
  );

  return (
    <div className="hn-tm-screen">
      <section className="hn-tm-toolbar" role="region" aria-label="Kontrol papan tim">
        <div className="hn-tm-switches">
          <Tabs variant="pill" value={view} onChange={setView} tabs={TEAM_VIEWS} aria-label="Mode tampilan" />
          {meId && (
            <Tabs variant="pill" aria-label="Lensa tugas"
              value={memberFilter === LENS_ALL ? LENS_ALL : memberFilter === LENS_ME ? LENS_ME : ""}
              onChange={(v) => setMemberFilter(v)}
              tabs={[{ value: LENS_ME, label: "Saya" }, { value: LENS_ALL, label: "Semua" }]} />
          )}
          {/* `role="status"` supaya perubahannya juga terdengar pembaca layar. */}
          <span className="hn-tm-count" role="status"
            title={stale ? "Server tak menjawab saat menyegarkan — angka ini dari muatan terakhir yang berhasil" : undefined}>
            {totalShown} tugas{stale ? " · data lama" : ""}
          </span>
          <LiveConnectionBadge />
        </div>
        <FilterBar label="Penyaring tim"
          search={{ value: q, onChange: setQ, label: "Cari tugas", placeholder: "mis. halaman harga atau deploy" }}
          chips={chips} filters={filtersPanel} filtersLabel="Filter"
          onReset={chips.length > 0 || searching ? resetFilters : undefined} resetLabel="Reset filter"
          actions={<>
            <Button size="sm" leftIcon="plus" onClick={() => { setEditing(null); setTaskOpen(true); }}>Tugas baru</Button>
            <SyncButton onDone={refetchSilently} onToast={onToast} />
            <OverflowActions label="Lainnya" items={[
              { key: "members", label: "Anggota tim", icon: "users", onSelect: () => setMembersOpen(true) },
            ]} />
          </>} />
      </section>

      {columns.map((c) => (
        <ColumnFeed key={c.key} status={c.key} params={subParams} onData={applyFeed} refetch={refetchSilently} />
      ))}

      {state === "loading" ? <StateBlock kind="loading" />
        : state === "error" ? <StateBlock kind="error" hint="Gagal memuat papan tim."
            action={() => load()} actionLabel="Coba lagi" />
        // Kolom kosong DI BAWAH penyaring tetap dirender sebagai kolom: "Menunggu 0" adalah
        // jawaban, sementara StateBlock akan menyembunyikan tiga kolom lain yang mungkin berisi.
        : empty && !narrowed ? <StateBlock kind="empty" icon="users" title="Papan tim masih kosong"
            hint="Catat pekerjaan manusia di sekitar sesi agen — desain, meeting klien, deploy, nego."
            action={() => { setEditing(null); setTaskOpen(true); }} actionLabel="Tugas baru" actionIcon="plus" />
        : <>
            {/* Penyaring aktif yang menyaring semua tugas harus dikatakan, dengan jalan keluarnya. */}
            {empty && narrowed && (
              <StateBlock kind="empty" compact icon="filter"
                title={memberSel !== undefined && chipCount === 0 && !searching
                  ? "Tak ada tugas untuk kamu" : "Tak ada tugas yang cocok dengan filter"}
                hint="Penyaring yang aktif menyembunyikan semua tugas di papan ini."
                action={showAll} actionLabel="Tampilkan semua" actionIcon="x" />
            )}
            {cross
              ? <TeamProjectTimeline tasks={tasks} projects={projects} members={members}
                  zoom={zoom} today={today} hidden={hiddenTasks} expanded={expanded}
                  onToggle={toggleProject} onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />
              : timeline
                ? <TeamTimeline tasks={tasks} members={members} zoom={zoom} today={today}
                    hidden={hiddenTasks} onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />
                : <TeamBoard board={board} totals={totals} columns={columns} members={members}
                    projects={projects} onOpenSpec={onOpenSpec}
                    onMove={move} onAssign={assign} onEscalate={setEscalating} onUnlink={unlink}
                    onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />}
          </>}

      <TaskModal open={taskOpen} task={editing} projects={projects} members={members}
        defaultProjectId={effectiveProject ?? null}
        orderFor={(s) => nextOrder(board[s])}
        onClose={() => { setTaskOpen(false); setEditing(null); }}
        onSaved={refetchSilently} onToast={onToast} />
      {escalating && (
        <EscalateDialog task={escalating} projects={projects}
          onClose={() => setEscalating(null)}
          // Kartu dari server dipakai LANGSUNG: `projectId` bisa ikut berubah.
          onDone={(t) => setBoard((b) => replaceCard(b, t))}
          onToast={onToast} />
      )}
      <MembersPanel open={membersOpen} onClose={() => setMembersOpen(false)}
        onChanged={setMembers} onToast={onToast} />
      <ToastHost toast={toast} />
    </div>
  );
}
