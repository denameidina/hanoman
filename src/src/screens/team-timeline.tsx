import React from "react";
import type { MemberView, TaskView } from "@hanoman/shared";
import { Icon, FIXED_ROW_STYLE } from "../ds";
import {
  taskDates, taskSpan, timelineRows, timelineWindow, todayOffset, zoomCell,
  type BarGeometry, type TaskSpan, type TimelineWindow, type TimelineZoom,
} from "./team-rules";

/* SPEC-948 · kanvas Gantt RENCANA. Tak ada batang aktual, tak ada persen selesai, tak ada critical
   path, tak ada dependency antar-task — yang digambar hanya `startDate → dueDate` yang diketik
   manusia (ADR-0150).

   `TimelineCanvas` di bawah tak menyebut `Task` sama sekali: ia menerima baris, batang, dan
   jendela. Mode Lintas project (item E) memakainya apa adanya dengan baris per PROJECT, dan itulah
   sebabnya `bars` jamak meski mode task selalu mengirim satu. */

const LABEL_W = 232;
const ROW_H = 34;
const BAR_INSET = 6;

export type TimelineBarSpec = {
  key: string;
  geometry: BarGeometry;
  tone: "brass" | "err" | "muted";
  title: string;
  onClick?: () => void;
};

export type TimelineRowSpec = {
  key: string;
  label: React.ReactNode;
  meta?: React.ReactNode;
  bars: TimelineBarSpec[];
};

const TONE: Record<TimelineBarSpec["tone"], { bg: string; border: string }> = {
  brass: { bg: "var(--brass-300)", border: "var(--brass-500)" },
  err: { bg: "var(--status-err-tint)", border: "var(--status-err)" },
  muted: { bg: "var(--bone-300)", border: "var(--border-strong)" },
};

const LABEL_CELL: React.CSSProperties = {
  position: "sticky", left: 0, zIndex: 1, flex: `0 0 ${LABEL_W}px`, width: LABEL_W,
  boxSizing: "border-box", padding: "5px 10px", minWidth: 0,
  background: "var(--surface-card)", borderRight: "1px solid var(--border-hair)",
};

const ELLIPSIS: React.CSSProperties = {
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

function Bar({ spec }: { spec: TimelineBarSpec }) {
  const g = spec.geometry;
  const tone = TONE[spec.tone];
  return (
    <button type="button" data-testid={`timeline-bar-${spec.key}`}
      data-invalid={g.invalid ? "true" : "false"}
      data-clipped-start={g.clippedStart ? "true" : "false"}
      data-clipped-end={g.clippedEnd ? "true" : "false"}
      title={spec.title} aria-label={spec.title} onClick={spec.onClick}
      style={{
        position: "absolute", top: BAR_INSET, height: ROW_H - BAR_INSET * 2,
        left: `${g.left}%`, width: `${g.width}%`,
        // Minimum PIKSEL, bukan persen: memaksanya ke persen membuat batang satu hari di zoom
        // bulan tampak lebih panjang dari waktunya.
        minWidth: 3,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: 0, overflow: "hidden",
        background: tone.bg, border: `1px solid ${tone.border}`,
        // Sudut SIKU di sisi yang terpotong — batang terpotong yang tak mengaku terpotong
        // berbohong tentang tenggat.
        borderTopLeftRadius: g.clippedStart ? 0 : "var(--radius-sm)",
        borderBottomLeftRadius: g.clippedStart ? 0 : "var(--radius-sm)",
        borderTopRightRadius: g.clippedEnd ? 0 : "var(--radius-sm)",
        borderBottomRightRadius: g.clippedEnd ? 0 : "var(--radius-sm)",
        cursor: spec.onClick ? "pointer" : "default",
      }}>
      {g.clippedStart && <Icon name="chevron-left" size={11} color={tone.border} />}
      <span style={{ flex: 1 }} />
      {g.clippedEnd && <Icon name="chevron-right" size={11} color={tone.border} />}
    </button>
  );
}

export function TimelineCanvas({ window: win, rows, today, emptyHint }: {
  window: TimelineWindow; rows: TimelineRowSpec[]; today: number; emptyHint?: string;
}) {
  const cell = zoomCell(win.zoom);
  const trackW = win.ticks.length * cell;
  const marker = todayOffset(win, today);
  /* Gridline sebagai GRADIEN, bukan satu div per sel per baris: 40 baris x 120 tick = 4 800 node
     kosong yang tak pernah dibaca siapa pun. Ia tetap sejajar dengan header karena kanvasnya
     sama-sama `N x cell` px. */
  const track: React.CSSProperties = {
    position: "relative", width: trackW, height: ROW_H, flex: `0 0 ${trackW}px`,
    backgroundImage:
      `repeating-linear-gradient(to right, var(--border-hair) 0 1px, transparent 1px ${cell}px)`,
  };
  return (
    <div data-testid="team-timeline" className="hn-timeline-scroll"
      style={{ flex: "1 1 auto", minHeight: 0, overflowX: "auto", overflowY: "auto" }}>
      {/* Lebar EKSPLISIT: anak blok di dalam container `overflow: auto` menyusut mengikuti
          containernya, dan scroller-nya lalu tak punya apa pun untuk digulir (SPEC-879). */}
      <div data-testid="timeline-canvas"
        style={{ position: "relative", minWidth: LABEL_W + trackW, width: LABEL_W + trackW }}>
        <div style={{
          display: "flex", position: "sticky", top: 0, zIndex: 2,
          background: "var(--bone-100)", borderBottom: "1px solid var(--border-hair)",
        }}>
          {/* Kolom label tetap `sticky left` bahkan di header: nama tugas yang tergulir keluar
              membuat batang di sebelah kanan kehilangan pemiliknya. */}
          <div style={{ ...LABEL_CELL, zIndex: 3, background: "var(--bone-100)" }}>
            <span className="hn-eyebrow">Tugas</span>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: `repeat(${win.ticks.length}, ${cell}px)`,
            width: trackW, flex: `0 0 ${trackW}px`,
          }}>
            {win.ticks.map((t) => (
              <div key={t.start} data-testid="timeline-tick" style={{
                borderLeft: `1px solid ${t.major ? "var(--border-strong)" : "var(--border-hair)"}`,
                padding: "5px 4px", fontFamily: "var(--font-mono)", fontSize: 10,
                ...ELLIPSIS,
                color: t.major ? "var(--text-body)" : "var(--text-subtle)",
              }}>{t.label}</div>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div data-testid="timeline-empty" style={{
            position: "sticky", left: 0, width: LABEL_W, padding: "18px 10px",
            fontSize: "var(--text-xs)", color: "var(--text-muted)",
          }}>{emptyHint ?? "Tak ada yang bisa dihamparkan di jendela ini."}</div>
        ) : rows.map((r) => (
          <div key={r.key} data-testid={`timeline-row-${r.key}`}
            style={{ display: "flex", borderBottom: "1px solid var(--border-hair)" }}>
            <div style={LABEL_CELL}>
              <div style={{
                ...ELLIPSIS, fontSize: 12, fontWeight: "var(--weight-medium)",
                color: "var(--text-strong)",
              }}>{r.label}</div>
              {r.meta && <div style={{ ...ELLIPSIS, fontSize: 10, color: "var(--text-subtle)" }}>
                {r.meta}
              </div>}
            </div>
            <div style={track}>
              {r.bars.map((b) => <Bar key={b.key} spec={b} />)}
            </div>
          </div>
        ))}

        {marker !== null && (
          <div data-testid="timeline-today" aria-hidden="true" style={{
            position: "absolute", top: 0, bottom: 0, width: 2, pointerEvents: "none",
            left: LABEL_W + (marker / 100) * trackW,
            background: "var(--brass-500)", opacity: 0.5,
          }} />
        )}
      </div>
    </div>
  );
}

/* ── mode task ──────────────────────────────────────────────────────────────────────────────── */

function Aside({ testId, icon, title, hint, tasks, onOpen }: {
  testId: string; icon: string; title: string; hint?: string;
  tasks: TaskView[]; onOpen: (t: TaskView) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div data-testid={testId} style={{
      ...FIXED_ROW_STYLE, marginTop: 10, padding: 10,
      background: "var(--bone-100)", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <Icon name={icon} size={13} color="var(--text-subtle)" />
        <span className="hn-eyebrow">{title} · {tasks.length}</span>
        {hint && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tasks.map((t) => (
          <button key={t.id} type="button" onClick={() => onOpen(t)} style={{
            padding: "3px 10px", background: "var(--surface-card)",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
            fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-body)", cursor: "pointer",
          }}>{t.title}</button>
        ))}
      </div>
    </div>
  );
}

export function TeamTimeline({ tasks, members, zoom, today, hidden, onOpen }: {
  tasks: TaskView[]; members: MemberView[]; zoom: TimelineZoom; today: number;
  /** Selisih `total` vs yang termuat, akibat plafon 200/kolom (ADR-0151). */
  hidden: number;
  onOpen: (t: TaskView) => void;
}) {
  const win = React.useMemo(() => {
    const spans = tasks.map(taskSpan).filter((s): s is TaskSpan => s !== null);
    return timelineWindow(spans, zoom, today);
  }, [tasks, zoom, today]);

  const { rows, unscheduled, outside } = React.useMemo(
    () => timelineRows(tasks, win), [tasks, win]);

  const rowSpecs = React.useMemo<TimelineRowSpec[]>(() => rows.map(({ task, geometry }) => {
    // Anggota bisa lenyap dari daftar sebelum kartunya menyusul (frame sync mendahului). Yang
    // dirender tetap kalimat manusia, bukan id mentah — cermin `TaskCard` di papan.
    const assignee = members.find((m) => m.id === task.memberId)?.name ?? "belum ditugaskan";
    const dates = taskDates(task);
    const notes = [
      geometry.invalid ? "tenggat mendahului mulai" : null,
      geometry.clippedStart || geometry.clippedEnd ? "melewati tepi jendela" : null,
    ].filter(Boolean);
    return {
      key: task.id,
      label: task.title,
      meta: dates ? `${assignee} · ${dates}` : assignee,
      bars: [{
        key: task.id,
        geometry,
        tone: geometry.invalid ? "err" as const
          : task.status === "done" ? "muted" as const : "brass" as const,
        title: [task.title, dates, ...notes].filter(Boolean).join(" · "),
        onClick: () => onOpen(task),
      }],
    };
  }), [rows, members, onOpen]);

  return (
    <>
      <TimelineCanvas window={win} rows={rowSpecs} today={today}
        emptyHint="Belum ada tugas bertanggal — isi mulai atau tenggat di kartunya." />
      {hidden > 0 && (
        <div data-testid="timeline-truncated" style={{
          ...FIXED_ROW_STYLE, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--amber-600)",
        }}>
          {hidden} tugas tak termuat karena plafon 200 per kolom — persempit penyaring
        </div>
      )}
      <Aside testId="timeline-unscheduled" icon="calendar-off" title="Belum dijadwalkan"
        tasks={unscheduled} onOpen={onOpen} />
      <Aside testId="timeline-outside" icon="chevrons-left-right" title="Di luar jendela"
        hint="pilih zoom yang lebih lebar" tasks={outside} onOpen={onOpen} />
    </>
  );
}
