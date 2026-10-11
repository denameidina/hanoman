import React from "react";
import type { CreateTaskInput, MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { Badge, Button, Icon, OverflowActions, Tabs, LIST_SCROLL_STYLE, FIXED_ROW_STYLE, useResponsiveTier } from "../ds";
import { TEAM_COLUMNS, canDropTask, taskDates, type Board } from "./team-rules";

/* SPEC-946 · papan kanban MANUSIA. Kolomnya `Task.status` — milik manusia — bukan `Spec.stage`
   yang diturunkan dari fase sesi (ADR-0008/0024). Konsekuensinya keempat kolom saling menerima
   drop, kebalikan board Backlog yang hampir seluruhnya menolaknya.

   Audit 2026-10: (1) kartu menampilkan nama project, bukan id mentah; (2) dua Select aksi kartu
   digabung jadi satu menu "⋯" (pindah kolom + tugaskan), keyboard tetap jalan lewat Modal DS;
   (3) mobile memakai pemilih kolom (Tabs) alih-alih papan yang digeser mendatar. */

/* `Record<Priority, …>` — bukan `Record<string, …>` seperti dua cermin yang sudah ada
   (`BacklogScreen.tsx` `B_PRIO`, `SchedulerScreen.tsx` `PRIO_TONE`): dengan kunci `string`,
   nilai prioritas baru jatuh ke default tanpa satu pun galat kompilasi.

   `sedang` sengaja `neutral`, mengikuti `B_PRIO` board Backlog — bukan `warn` seperti
   SchedulerScreen. Dua alasan: ia nilai BAWAAN `zCreateTask`, jadi mewarnainya amber membuat
   hampir seluruh papan berteriak; dan prioritas yang sama harus terbaca sama di dua papan yang
   dibolak-balik operator. (Kedua cermin lama sudah berselisih di nilai ini sebelum SPEC-946;
   menyelaraskan keduanya di luar lingkup spec ini.) */
type Priority = NonNullable<CreateTaskInput["priority"]>;
const PRIO_TONE: Record<Priority, "err" | "warn" | "neutral"> = {
  tinggi: "err", sedang: "neutral", rendah: "neutral",
};

type ProjectRef = { id: string; name: string };

function TaskCard({ task, members, projectName, dragging, onDragStart, onDragEnd, onOpen, onMove, onAssign,
  onEscalate, onUnlink, onOpenSpec }: {
  task: TaskView; members: MemberView[]; projectName: string | null; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void;
  onOpen: (t: TaskView) => void;
  onMove: (t: TaskView, to: TaskStatus) => void;
  onAssign: (t: TaskView, memberId: string | null) => void;
  onEscalate: (t: TaskView) => void;
  onUnlink: (t: TaskView) => void;
  onOpenSpec?: (specId: string) => void;
}) {
  // Anggota bisa lenyap dari daftar sebelum kartunya menyusul (frame sync mendahului). Yang
  // dirender tetap kalimat manusia, bukan id mentah.
  const assignee = members.find((m) => m.id === task.memberId)?.name ?? "belum ditugaskan";
  const dates = taskDates(task);
  // Menu "Ubah…": pindah kolom + tugaskan, satu tempat. Pindah ke kolom sendiri dibuang (bukan
  // perpindahan); anggota yang sudah menugaskan task ini ditandai nonaktif, bukan dihilangkan.
  const menu = [
    ...TEAM_COLUMNS.filter((c) => c.key !== task.status).map((c) => ({
      key: `move-${c.key}`, label: `Pindah ke ${c.label}`,
      onSelect: () => onMove(task, c.key),
    })),
    { key: "assign-none", label: "Kosongkan penugasan", disabled: !task.memberId,
      onSelect: () => onAssign(task, null) },
    ...members.map((m) => ({
      key: `assign-${m.id}`, label: `Tugaskan ke ${m.name}`, disabled: task.memberId === m.id,
      onSelect: () => onAssign(task, m.id),
    })),
  ];
  return (
    <div draggable data-testid={`team-card-${task.id}`}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{
        // `0 0 auto`: tanpa ini kartu menyusut mengisi kolom, bukan kolomnya yang menggulir.
        flex: "0 0 auto",
        background: "var(--surface-card)", border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-md)", padding: 10, boxShadow: "var(--shadow-xs)",
        cursor: "grab", opacity: dragging ? 0.4 : 1,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Badge tone={PRIO_TONE[task.priority as Priority] ?? "neutral"} size="sm"
          variant={task.priority === "tinggi" ? "soft" : "outline"}>{task.priority}</Badge>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 11, color: "var(--text-subtle)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{task.projectId === null ? "tanpa project" : projectName ?? "project tak dikenal"}</span>
      </div>
      <button type="button" onClick={() => onOpen(task)} style={{
        display: "block", width: "100%", textAlign: "left", border: "none", background: "none",
        padding: 0, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13,
        fontWeight: "var(--weight-medium)", color: "var(--text-strong)", lineHeight: 1.35,
      }}>{task.title}</button>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap",
        fontSize: "var(--text-xs)", color: "var(--text-subtle)",
      }}>
        <Icon name="user" size={12} color="var(--text-subtle)" />
        <span>{assignee}</span>
        {dates && <><span aria-hidden="true">·</span><span>{dates}</span></>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {task.specId ? (
          <>
            {/* ADR-0150 keputusan 5 · `specId` terisi tanpa `spec` = tautan putus. Bedanya dengan
                "tak pernah dikirim ke backlog" harus terlihat, bukan diam-diam kosong. Audit
                2026-10: istilah "tautan putus" diganti "spec tak ditemukan". */}
            {task.spec && onOpenSpec ? (
              <button type="button" onClick={() => onOpenSpec(task.specId!)}
                aria-label={`Buka ${task.spec.id} di Backlog`}
                style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}>
                <Badge tone="ok" size="sm" icon="link">{`${task.spec.id} · ${task.spec.stage}`}</Badge>
              </button>
            ) : (
              <Badge tone={task.spec ? "ok" : "warn"} size="sm" icon={task.spec ? "link" : "unlink"}>
                {task.spec ? `${task.spec.id} · ${task.spec.stage}` : "spec tak ditemukan"}
              </Badge>
            )}
            <Button size="sm" variant="ghost" leftIcon="unlink"
              aria-label={`Lepas tautan: ${task.title}`}
              onClick={() => onUnlink(task)}>Lepas tautan</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" leftIcon="git-branch"
            aria-label={`Kirim ke Backlog: ${task.title}`}
            onClick={() => onEscalate(task)}>Kirim ke Backlog</Button>
        )}
        <span style={{ flex: 1 }} />
        {/* Satu menu menggantikan dua Select. Drag tetap ada untuk mouse; menu ini jalur keyboard
            dan sentuh (Modal DS: focus trap, Escape, fokus kembali ke pemicu). */}
        <OverflowActions label={`Ubah tugas: ${task.title}`} icon="ellipsis" items={menu} />
      </div>
    </div>
  );
}

export function TeamBoard({ board, totals, columns, members, projects = [], onMove, onAssign, onOpen,
  onEscalate, onUnlink, onOpenSpec }: {
  board: Board; totals: Record<TaskStatus, number>;
  columns: { key: TaskStatus; label: string }[];
  members: MemberView[];
  /** Untuk menampilkan nama project di kartu; id yang tak ada di sini jatuh ke "project tak dikenal". */
  projects?: ProjectRef[];
  onMove: (t: TaskView, to: TaskStatus) => void;
  onAssign: (t: TaskView, memberId: string | null) => void;
  onOpen: (t: TaskView) => void;
  onEscalate: (t: TaskView) => void;
  onUnlink: (t: TaskView) => void;
  onOpenSpec?: (specId: string) => void;
}) {
  const [drag, setDrag] = React.useState<{ task: TaskView; from: TaskStatus } | null>(null);
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  const tier = useResponsiveTier();
  const [mobileCol, setMobileCol] = React.useState<TaskStatus>(columns[0]?.key ?? "backlog");

  const nameOf = React.useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p.name] as const));
    return (projectId: string | null): string | null => (projectId === null ? null : byId.get(projectId) ?? null);
  }, [projects]);

  const drop = (to: TaskStatus) => {
    if (drag && canDropTask(drag.from, to)) onMove(drag.task, to);
    setDrag(null);
    setOver(null);
  };

  // `from` = kolom tempat kartu dirender: asal drag, bukan `t.status` (cermin kolom yang tampil).
  const cardFor = (t: TaskView, from: TaskStatus) => (
    <TaskCard key={t.id} task={t} members={members} projectName={nameOf(t.projectId)}
      dragging={drag?.task.id === t.id}
      onDragStart={() => setDrag({ task: t, from })}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onOpen={onOpen} onMove={onMove} onAssign={onAssign}
      onEscalate={onEscalate} onUnlink={onUnlink} onOpenSpec={onOpenSpec} />
  );

  // Mobile: satu kolom per layar, dipilih lewat Tabs (pola ResponsivePanels). Papan 4 kolom
  // yang digeser mendatar tak terbaca di 390 px; semua kolom tetap terjangkau lewat pemilih.
  if (tier === "mobile") {
    const current = columns.find((c) => c.key === mobileCol) ?? columns[0];
    if (!current) return null;
    const items = board[current.key];
    const hidden = Math.max(0, (totals[current.key] ?? 0) - items.length);
    return (
      <div data-testid="team-board" data-layout="mobile" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <Tabs variant="pill" aria-label="Kolom papan tim" value={current.key}
          onChange={(v) => setMobileCol(v as TaskStatus)}
          tabs={columns.map((c) => ({ value: c.key, label: `${c.label} · ${board[c.key].length}` }))} />
        <div data-testid={`team-col-${current.key}`} style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {items.map((t) => cardFor(t, current.key))}
          {items.length === 0 && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", padding: "8px 2px" }}>
              Tak ada tugas di {current.label}.
            </div>
          )}
          {hidden > 0 && (
            <div style={{ ...FIXED_ROW_STYLE, fontSize: "var(--text-xs)", color: "var(--status-warn)" }}>
              menampilkan {items.length} dari {totals[current.key]} — persempit penyaring
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    /* Baris kolom menggulir MENDATAR; tiap KOLOM menggulir tegak sendiri, jadi judul kolom tak
       pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. */
    <div data-testid="team-board" className="hn-board-local-overflow" style={{
      flex: "1 1 auto", minHeight: 0, display: "flex", gap: 10,
      overflowX: "auto", overflowY: "hidden", alignItems: "stretch", paddingBottom: 4,
    }}>
      {columns.map((c) => {
        const items = board[c.key];
        const active = !!drag && canDropTask(drag.from, c.key);
        const hot = active && over === c.key;
        const hidden = Math.max(0, (totals[c.key] ?? 0) - items.length);
        return (
          <div key={c.key} data-testid={`team-col-${c.key}`}
            onDragOver={(e) => {
              if (!active) return;   // tanpa preventDefault, kolom ini menolak drop
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(c.key);
            }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.key); }}
            style={{
              flex: "0 0 244px", display: "flex", flexDirection: "column", minHeight: 0, padding: 10,
              borderRadius: "var(--radius-lg)",
              background: hot ? "var(--brass-100)" : "var(--bone-100)",
              border: `1px ${active ? "dashed" : "solid"} ${hot ? "var(--brass-500)" : "var(--border-hair)"}`,
              opacity: drag && !active ? 0.5 : 1, transition: "var(--transition-fast)",
            }}>
            <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span className="hn-eyebrow">{c.label}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>
                {items.length}
              </span>
            </div>
            {/* Zona drop mencakup ruang kosong di bawah kartu: event menggelembung ke kolom. */}
            <div style={{ ...LIST_SCROLL_STYLE, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((t) => cardFor(t, c.key))}
            </div>
            {/* Plafon langganan 200/kolom (ADR-0151). Papan yang diam-diam memotong terbaca
                sebagai papan yang lengkap. */}
            {hidden > 0 && (
              <div style={{
                ...FIXED_ROW_STYLE, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--status-warn)",
              }}>
                menampilkan {items.length} dari {totals[c.key]} — persempit penyaring
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
