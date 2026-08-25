import React from "react";
import type { MemberView, TaskStatus, TaskView, TopicParams } from "@hanoman/shared";
import {
  Button, Input, Select, StateBlock, Tabs, LiveConnectionBadge,
  LIST_SCREEN_STYLE, FIXED_ROW_STYLE,
} from "../ds";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import { SyncButton } from "./SyncButton";
import { TeamBoard } from "./team-board";
import { TaskModal } from "./TaskModal";
import { MembersPanel } from "./MembersPanel";
import { TEAM_COLUMNS, emptyBoard, moveCard, nextOrder, replaceCard, type Board } from "./team-rules";
import { usePersistedState, ResetViewButton, isStr, oneOf } from "../ui-state";
import type { ProjectVM } from "./types";

/* TeamScreen — papan kerja MANUSIA (SPEC-946 · ADR-0150/ADR-0151). Screen mandiri (pola
   TriageScreen): memuat datanya sendiri, tak lewat `gate` App.

   Papan berlangganan PER KOLOM. `zSubLimit` menjepit `limit` ke 200 dan `order` bermakna DI DALAM
   kolom, jadi satu langganan untuk seluruh papan memotong himpunan gabungan empat kolom di titik
   yang sewenang-wenang — kolom mana yang terpotong, dan seberapa, tak bisa dijelaskan kepada
   operator. Empat langganan memberi tiap kolom `total`-nya sendiri, dan plafonnya berlaku per
   kolom. Biayanya 4 dari MAX_SUBS = 16. */

const POLL_MS = 5000;
// ADR-0107 · PLAFON, bukan preferensi — nilainya sama dengan batas atas `zSubLimit`, supaya muat
// awal HTTP dan langganan WS memotong di titik yang SAMA. Muat awal tak-berbatas lalu langganan
// berplafon berarti kartu HILANG dari layar tanpa satu pun tindakan operator.
const COLUMN_LIMIT = 200;
// SPEC-908 · jeda sebelum ketikan mengubah KUNCI langganan: tiap huruf melahirkan kunci baru yang
// dibangun server di luar jadwal, dan sebelas dari dua belas langsung dibuang.
const Q_DEBOUNCE_MS = 400;

// Item B hanya membawa mode Papan. Item D (Linimasa) dan E (Lintas project) menambahkan entri ke
// array yang SAMA — bukan memasang mekanisme baru.
const TEAM_VIEWS = [{ value: "board", label: "Papan", icon: "kanban" }];

type Totals = Record<TaskStatus, number>;
const zeroTotals = (): Totals =>
  Object.fromEntries(TEAM_COLUMNS.map((c) => [c.key, 0])) as Totals;

/* Satu langganan per kolom. Komponen tanpa render karena jumlah pemanggilan hook harus tetap
   sah saat kolom disaring keluar — memasang/melepas komponennya adalah cara React yang jujur
   untuk berhenti berlangganan, dan ia tak melanggar rules-of-hooks seperti hook di dalam map. */
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

export function TeamScreen({ projects, projectFilter, onProjectFilter, onToast }: {
  projects: ProjectVM[]; projectFilter: string;
  onProjectFilter: (v: string) => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [board, setBoard] = React.useState<Board>(emptyBoard);
  const [totals, setTotals] = React.useState<Totals>(zeroTotals);
  const [members, setMembers] = React.useState<MemberView[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  // SPEC-857 · ADR-0131 · saat refetch gagal, papan yang sudah tampil TIDAK boleh berubah jadi
  // layar galat: operator harus tahu ia sedang membaca nilai basi, bukan papan yang menyusut.
  const [stale, setStale] = React.useState(false);
  const [editing, setEditing] = React.useState<TaskView | null>(null);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [membersOpen, setMembersOpen] = React.useState(false);

  // SPEC-740 · ADR-0115 · state tampilan layar ini persisten berkunci `team`. Tak ada `page`:
  // papan tidak dipaginasi.
  const [view, setView] = usePersistedState<string>("team", "view", "board",
    oneOf(...TEAM_VIEWS.map((v) => v.value)));
  const [q, setQ] = usePersistedState("team", "q", "", isStr);
  const [colFilter, setColFilter] = usePersistedState("team", "col", "all", isStr);
  const [memberFilter, setMemberFilter] = usePersistedState("team", "member", "all", isStr);

  const columns = React.useMemo(
    () => (colFilter === "all" ? TEAM_COLUMNS : TEAM_COLUMNS.filter((c) => c.key === colFilter)),
    [colFilter],
  );
  // Larik baru tiap render; yang stabil kuncinya, bukan referensinya.
  const columnsKey = columns.map((c) => c.key).join(",");
  const activeFilters = [projectFilter !== "all", colFilter !== "all", memberFilter !== "all", q.trim() !== ""]
    .filter(Boolean).length;

  const filters = React.useMemo(() => ({
    projectId: projectFilter === "all" ? undefined : projectFilter,
    memberId: memberFilter === "all" ? undefined : memberFilter,
    q: q.trim() || undefined,
  }), [projectFilter, memberFilter, q]);

  // Muat PERTAMA boleh mengosongkan layar; yang berikutnya tidak. Tanpa pemisahan ini tiap huruf
  // di kotak cari — dan tiap ganti penyaring — membuat keempat kolom lenyap sekejap.
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
    api.listMembers().then((r) => setMembers(r.items)).catch(() => { /* diam disengaja */ });
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
    try { await api.patchTask(task.id, moved.patch); }
    catch {
      setBoard(before);
      onToast("Gagal memindahkan tugas", "err", "x-circle");
    }
  }

  async function assign(task: TaskView, memberId: string | null) {
    const before = board;
    setBoard(replaceCard(board, { ...task, memberId }));
    try { await api.patchTask(task.id, { memberId }); }
    catch {
      setBoard(before);
      onToast("Gagal menugaskan", "err", "x-circle");
    }
  }

  const empty = columns.every((c) => board[c.key].length === 0);

  return (
    <div style={LIST_SCREEN_STYLE}>
      <div className="hn-team-controls" role="region" aria-label="Kontrol papan tim"
        style={{ ...FIXED_ROW_STYLE, marginBottom: 18 }}>
        <div className="hn-team-topline" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap", marginBottom: 12,
        }}>
          <Tabs variant="pill" value={view} onChange={setView} tabs={TEAM_VIEWS} aria-label="Mode tampilan" />
          <div className="hn-team-view-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button size="sm" leftIcon="plus" onClick={() => { setEditing(null); setTaskOpen(true); }}>Tugas baru</Button>
            <Button size="sm" variant="secondary" leftIcon="users" onClick={() => setMembersOpen(true)}>Anggota</Button>
            <SyncButton onDone={refetchSilently} onToast={onToast} />
            <ResetViewButton screen="team" active={activeFilters} onReset={() => onProjectFilter("all")} />
            {/* `role="status"` supaya perubahannya juga terdengar pembaca layar. */}
            <span className="hn-eyebrow" role="status"
              style={stale ? { color: "var(--amber-600)" } : undefined}
              title={stale ? "Server tak menjawab saat menyegarkan — angka ini dari muatan terakhir yang berhasil" : undefined}>
              {columns.reduce((n, c) => n + (totals[c.key] ?? 0), 0)} tugas{stale ? " · basi" : ""}
            </span>
            <LiveConnectionBadge />
          </div>
        </div>
        <div className="hn-team-filters" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Input size="sm" leftIcon="search" aria-label="Cari tugas" value={q}
            placeholder="mis. halaman harga atau deploy"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            style={{ flex: "1 1 220px" }} />
          {/* SPEC-146 · App pemilik tunggal "daftar disaring ke project mana", jadi berpindah dari
              Backlog ke Tim tak mengganti project yang sedang dilihat. */}
          <Select size="sm" aria-label="Filter project" value={projectFilter}
            onChange={(e) => onProjectFilter(e.target.value)}
            options={[{ value: "all", label: "Semua project" },
              ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          {/* Menyaring kolom di sebuah PAPAN = mempersempit kolom yang tampil. Hanya kolom yang
              tampil yang dimuat & dilanggan, jadi biaya servernya ikut mengecil. */}
          <Select size="sm" aria-label="Filter kolom" value={colFilter}
            onChange={(e) => setColFilter(e.target.value)}
            options={[{ value: "all", label: "Semua kolom" },
              ...TEAM_COLUMNS.map((c) => ({ value: c.key, label: c.label }))]} />
          <Select size="sm" aria-label="Filter anggota" value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            options={[{ value: "all", label: "Semua anggota" },
              ...members.map((m) => ({ value: m.id, label: m.name }))]} />
        </div>
      </div>

      {columns.map((c) => (
        <ColumnFeed key={c.key} status={c.key} params={subParams} onData={applyFeed} refetch={refetchSilently} />
      ))}

      {state === "loading" ? <StateBlock kind="loading" />
        : state === "error" ? <StateBlock kind="error" hint="Gagal memuat papan tim."
            action={() => load()} actionLabel="Coba lagi" />
        // Kolom kosong DI BAWAH penyaring tetap dirender sebagai kolom: "Dikerjakan 0" adalah
        // jawaban, sementara StateBlock akan menyembunyikan tiga kolom lain yang mungkin berisi.
        // Yang layak menggantikan papan hanya papan yang benar-benar kosong tanpa penyaring.
        : empty && activeFilters === 0 ? <StateBlock kind="empty" icon="users" title="Papan tim masih kosong"
            hint="Catat pekerjaan manusia di sekitar sesi agen — desain, meeting klien, deploy, nego."
            action={() => { setEditing(null); setTaskOpen(true); }} actionLabel="Tugas baru" actionIcon="plus" />
        : <TeamBoard board={board} totals={totals} columns={columns} members={members}
            onMove={move} onAssign={assign}
            onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />}

      <TaskModal open={taskOpen} task={editing} projects={projects} members={members}
        defaultProjectId={projectFilter === "all" ? null : projectFilter}
        orderFor={(s) => nextOrder(board[s])}
        onClose={() => { setTaskOpen(false); setEditing(null); }}
        onSaved={refetchSilently} onToast={onToast} />
      <MembersPanel open={membersOpen} onClose={() => setMembersOpen(false)}
        onChanged={setMembers} onToast={onToast} />
    </div>
  );
}
