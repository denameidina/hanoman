import React from "react";
import type { CreateTaskInput, MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { Icon, OverflowActions, Tabs, useResponsiveTier, type OverflowItem } from "../ds";
import { TEAM_COLUMNS, canDropTask, type Board } from "./team-rules";
import { PRIORITY_LABEL } from "../lib/labels";

/* SPEC-946 · papan kanban MANUSIA. Kolomnya `Task.status` — milik manusia — bukan `Spec.stage`
   yang diturunkan dari fase sesi (ADR-0008/0024). Konsekuensinya keempat kolom saling menerima
   drop, kebalikan board Backlog yang hampir seluruhnya menolaknya.

   Redesign Audit UI/UX 2026-10 · Fase 3D: kartu hanya judul, titik prioritas, penanggung jawab
   (avatar + nama), dan SATU menu "Ubah tugas". Pindah, tugaskan, dan tautan Backlog ada di menu itu,
   jadi keyboard dan layar sentuh punya jalur yang sama dengan drag. Mobile = satu kolom + pemilih. */

/* Titik prioritas sama dengan papan Backlog (`B_PRIO`): tinggi = aksen, sedang = isi netral, rendah =
   berlubang. Dua papan yang dibolak-balik operator harus membaca prioritas yang sama dengan cara yang
   sama. Bentuknya membawa makna; warnanya hanya penguat. */
type Priority = NonNullable<CreateTaskInput["priority"]>;
const PRIO_LEVEL: Record<Priority, "high" | "mid" | "low"> = { tinggi: "high", sedang: "mid", rendah: "low" };

type ProjectRef = { id: string; name: string };

function PrioDot({ priority }: { priority: string }) {
  const level = PRIO_LEVEL[priority as Priority] ?? "mid";
  const label = PRIORITY_LABEL[priority as Priority] ?? priority;
  return (
    <span className={`hn-tm-prio hn-tm-prio-${level}`} title={`Prioritas ${label}`}>
      <span className="hn-sr-only">Prioritas {label}</span>
    </span>
  );
}

// Inisial dari nama anggota, untuk avatar. Tanpa nama, ikon orang: "belum ditugaskan" tetap terbaca.
function Avatar({ name }: { name: string | null }) {
  if (!name) {
    return <span className="hn-tm-avatar hn-tm-avatar-empty" aria-hidden="true"><Icon name="user" size={12} /></span>;
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return <span className="hn-tm-avatar" aria-hidden="true">{initials || "?"}</span>;
}

// Semua aksi kartu, satu menu. Pindah ke kolom sendiri dibuang (bukan perpindahan); anggota yang
// sudah menugaskan task ini ditandai nonaktif, bukan dihilangkan.
function taskMenu(task: TaskView, members: MemberView[], actions: {
  onMove: (t: TaskView, to: TaskStatus) => void;
  onAssign: (t: TaskView, memberId: string | null) => void;
  onEscalate: (t: TaskView) => void;
  onUnlink: (t: TaskView) => void;
  onOpenSpec?: (specId: string) => void;
}): OverflowItem[] {
  const items: OverflowItem[] = [
    ...TEAM_COLUMNS.filter((c) => c.key !== task.status).map((c) => ({
      key: `move-${c.key}`, label: `Pindah ke ${c.label}`,
      onSelect: () => actions.onMove(task, c.key),
    })),
    ...members.map((m) => ({
      key: `assign-${m.id}`, label: `Tugaskan ke ${m.name}`, disabled: task.memberId === m.id,
      onSelect: () => actions.onAssign(task, m.id),
    })),
    { key: "assign-none", label: "Kosongkan penugasan", disabled: !task.memberId,
      onSelect: () => actions.onAssign(task, null) },
  ];
  // Tautan ke backlog. "tautan putus" (specId ada, spec tak ada) tetap terbaca di label, bukan diam-diam kosong.
  if (task.specId) {
    if (task.spec && actions.onOpenSpec) {
      const specId = task.specId;
      items.push({ key: "open-spec", label: `Buka ${task.spec.id} di Backlog`,
        onSelect: () => actions.onOpenSpec?.(specId) });
    }
    items.push({ key: "unlink", label: task.spec ? "Lepas tautan" : "Lepas tautan (spec tak ditemukan)",
      onSelect: () => actions.onUnlink(task) });
  } else {
    items.push({ key: "escalate", label: "Kirim ke Backlog", onSelect: () => actions.onEscalate(task) });
  }
  return items;
}

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
  const assignee = members.find((m) => m.id === task.memberId)?.name ?? null;
  const menu = taskMenu(task, members, { onMove, onAssign, onEscalate, onUnlink, onOpenSpec });
  const project = task.projectId === null ? "tanpa project" : projectName ?? "project tak dikenal";
  return (
    <div draggable data-testid={`team-card-${task.id}`} className="hn-tm-card"
      data-dragging={dragging || undefined} title={`Project: ${project}`}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}>
      <div className="hn-tm-card-head">
        <PrioDot priority={task.priority} />
        <button type="button" className="hn-tm-title" onClick={() => onOpen(task)}>{task.title}</button>
      </div>
      <div className="hn-tm-card-foot">
        <span className="hn-tm-assignee-wrap">
          <Avatar name={assignee} />
          <span className="hn-tm-assignee">{assignee ?? "belum ditugaskan"}</span>
        </span>
        {/* Satu menu menggantikan semua aksi kartu. Drag tetap ada untuk mouse; menu ini jalur keyboard
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
      <div data-testid="team-board" data-layout="mobile" className="hn-tm-mobile">
        <Tabs variant="pill" aria-label="Kolom papan tim" value={current.key}
          onChange={(v) => setMobileCol(v as TaskStatus)}
          tabs={columns.map((c) => ({ value: c.key, label: `${c.label} · ${board[c.key].length}` }))} />
        <div data-testid={`team-col-${current.key}`} className="hn-tm-col-stack">
          {items.map((t) => cardFor(t, current.key))}
          {items.length === 0 && (
            <div className="hn-tm-empty-col">Tak ada tugas di {current.label}.</div>
          )}
          {hidden > 0 && (
            <div className="hn-tm-hidden-note">menampilkan {items.length} dari {totals[current.key]} — persempit penyaring</div>
          )}
        </div>
      </div>
    );
  }

  return (
    /* Baris kolom menggulir MENDATAR; tiap KOLOM menggulir tegak sendiri, jadi judul kolom tak
       pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. */
    <div data-testid="team-board" className="hn-board-local-overflow hn-tm-board">
      {columns.map((c) => {
        const items = board[c.key];
        const active = !!drag && canDropTask(drag.from, c.key);
        const hot = active && over === c.key;
        const hidden = Math.max(0, (totals[c.key] ?? 0) - items.length);
        return (
          <div key={c.key} data-testid={`team-col-${c.key}`} className="hn-tm-col"
            data-active={active || undefined} data-hot={hot || undefined}
            data-dimmed={drag && !active || undefined}
            onDragOver={(e) => {
              if (!active) return;   // tanpa preventDefault, kolom ini menolak drop
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(c.key);
            }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.key); }}>
            <div className="hn-tm-col-head">
              <span className="hn-eyebrow">{c.label}</span>
              <span className="hn-tm-col-count">{items.length}</span>
            </div>
            {/* Zona drop mencakup ruang kosong di bawah kartu: event menggelembung ke kolom. */}
            <div className="hn-tm-col-body">
              {items.map((t) => cardFor(t, c.key))}
            </div>
            {/* Plafon langganan 200/kolom (ADR-0151). Papan yang diam-diam memotong terbaca
                sebagai papan yang lengkap. */}
            {hidden > 0 && (
              <div className="hn-tm-hidden-note">
                menampilkan {items.length} dari {totals[c.key]} — persempit penyaring
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
