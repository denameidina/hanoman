import React from "react";
import type { CreateTaskInput, MemberView, TaskStatus, TaskView } from "@hanoman/shared";
import { Badge, Icon, Select, LIST_SCROLL_STYLE, FIXED_ROW_STYLE } from "../ds";
import { TEAM_COLUMNS, canDropTask, type Board } from "./team-rules";

/* SPEC-946 · papan kanban MANUSIA. Kolomnya `Task.status` — milik manusia — bukan `Spec.stage`
   yang diturunkan dari fase sesi (ADR-0008/0024). Konsekuensinya keempat kolom saling menerima
   drop, kebalikan board Backlog yang hampir seluruhnya menolaknya. */

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

const DATE_FMT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const shortDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null);

/** Rentang yang boleh setengah terisi. Kartu tanpa tanggal tak merender barisnya sama sekali —
    "—" adalah ruang yang terpakai untuk mengatakan "tidak ada". */
export function taskDates(t: TaskView): string | null {
  const a = shortDate(t.startDate);
  const b = shortDate(t.dueDate);
  if (a && b) return `${a} → ${b}`;
  if (b) return `→ ${b}`;
  return a;
}

function TaskCard({ task, members, dragging, onDragStart, onDragEnd, onOpen, onMove, onAssign }: {
  task: TaskView; members: MemberView[]; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void;
  onOpen: (t: TaskView) => void;
  onMove: (t: TaskView, to: TaskStatus) => void;
  onAssign: (t: TaskView, memberId: string | null) => void;
}) {
  // Anggota bisa lenyap dari daftar sebelum kartunya menyusul (frame sync mendahului). Yang
  // dirender tetap kalimat manusia, bukan id mentah.
  const assignee = members.find((m) => m.id === task.memberId)?.name ?? "belum ditugaskan";
  const dates = taskDates(task);
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
          fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{task.projectId ?? "tanpa project"}</span>
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
      {task.specId && (
        <div style={{ marginTop: 6 }}>
          {/* ADR-0150 keputusan 5 · `specId` terisi tanpa `spec` = tautan putus. Bedanya dengan
              "tak pernah dieskalasi" harus terlihat; aksinya milik item C. */}
          <Badge tone={task.spec ? "ok" : "warn"} size="sm" icon={task.spec ? "link" : "unlink"}>
            {task.spec ? `${task.spec.id} · ${task.spec.stage}` : "tautan putus"}
          </Badge>
        </div>
      )}
      {/* Drag HTML5 mati total di keyboard dan di layar sentuh. Dua Select ini bukan hiasan —
          di sana merekalah satu-satunya jalan. `aria-label` memuat judul supaya papan berisi
          banyak kartu tetap punya nama yang unik bagi pembaca layar DAN bagi test. */}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Select size="sm" value={task.status} aria-label={`Pindah kolom: ${task.title}`}
          onChange={(e) => onMove(task, e.target.value as TaskStatus)}
          options={TEAM_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
          style={{ flex: 1, minWidth: 0 }} />
        <Select size="sm" value={task.memberId ?? ""} aria-label={`Tugaskan: ${task.title}`}
          onChange={(e) => onAssign(task, e.target.value || null)}
          options={[{ value: "", label: "Belum ditugaskan" },
            ...members.map((m) => ({ value: m.id, label: m.name }))]}
          style={{ flex: 1, minWidth: 0 }} />
      </div>
    </div>
  );
}

export function TeamBoard({ board, totals, columns, members, onMove, onAssign, onOpen }: {
  board: Board; totals: Record<TaskStatus, number>;
  columns: { key: TaskStatus; label: string }[];
  members: MemberView[];
  onMove: (t: TaskView, to: TaskStatus) => void;
  onAssign: (t: TaskView, memberId: string | null) => void;
  onOpen: (t: TaskView) => void;
}) {
  const [drag, setDrag] = React.useState<{ task: TaskView; from: TaskStatus } | null>(null);
  const [over, setOver] = React.useState<TaskStatus | null>(null);

  const drop = (to: TaskStatus) => {
    if (drag && canDropTask(drag.from, to)) onMove(drag.task, to);
    setDrag(null);
    setOver(null);
  };

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
              {items.map((t) => (
                <TaskCard key={t.id} task={t} members={members}
                  dragging={drag?.task.id === t.id}
                  onDragStart={() => setDrag({ task: t, from: c.key })}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onOpen={onOpen} onMove={onMove} onAssign={onAssign} />
              ))}
            </div>
            {/* Plafon langganan 200/kolom (ADR-0151). Papan yang diam-diam memotong terbaca
                sebagai papan yang lengkap. */}
            {hidden > 0 && (
              <div style={{
                ...FIXED_ROW_STYLE, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--amber-600)",
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
