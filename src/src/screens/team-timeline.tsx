import React from "react";
import type { MemberView, TaskView } from "@hanoman/shared";
import { Icon } from "../ds";
import {
  barGeometry, projectGroups, taskDates, taskSpan, timelineRows, timelineWindow, todayOffset,
  zoomCell,
  type BarGeometry, type TaskSpan, type TimelineWindow, type TimelineZoom,
} from "./team-rules";

/* SPEC-948 · kanvas Gantt RENCANA. Tak ada batang aktual, tak ada persen selesai, tak ada critical
   path, tak ada dependency antar-task — yang digambar hanya `startDate → dueDate` yang diketik
   manusia (ADR-0150).

   `TimelineCanvas` di bawah tak menyebut `Task` sama sekali: ia menerima baris, batang, dan
   jendela. Mode Lintas project (item E) memakainya apa adanya dengan baris per PROJECT, dan itulah
   sebabnya `bars` jamak meski mode task selalu mengirim satu. */

// Tinggi baris (34 px), inset batang (6 px), dan indent anak (16 px) hidup di `team.css` (`hn-tl-*`).
const LABEL_W = 232;

export type TimelineBarSpec = {
  key: string;
  geometry: BarGeometry;
  tone: "brass" | "err" | "muted" | "envelope";
  title: string;
  onClick?: () => void;
};

export type TimelineRowSpec = {
  key: string;
  label: React.ReactNode;
  meta?: React.ReactNode;
  bars: TimelineBarSpec[];
};

/* Warna batang dan swatch lahir dari nada di CSS (`.hn-tl-bar[data-tone]` di team.css). Di sini hanya
   warna ikon yang dibutuhkan TSX, dan ia harus sama dengan `border-color` nada itu. */
const TONE_BORDER: Record<TimelineBarSpec["tone"], string> = {
  brass: "var(--brass-500)",
  err: "var(--status-err)",
  muted: "var(--border-strong)",
  // SPEC-949 · amplop rentang project. Harus lebih resesif dari `muted`, yang sudah dipakai task
  // berstatus `done`: amplop yang sewarna dengan task selesai membuat dua hal berbeda tampak sama.
  envelope: "var(--border-hair)",
};

/* Nilai yang berubah per render lewat CSS custom property. `CSSProperties` tak memuat kunci `--*`;
   assertion ini sama dengan `ds/responsive.tsx`. */
const cssVars = (vars: Record<string, string>) => vars as React.CSSProperties;

function Bar({ spec }: { spec: TimelineBarSpec }) {
  const g = spec.geometry;
  const border = TONE_BORDER[spec.tone];
  const interactive = !!spec.onClick;
  // Audit 2026-10: batang tanpa aksi (amplop project) bukan tombol — ia gambar, bukan kontrol.
  // Hanya batang yang membuka tugas yang berupa <button>, sehingga klik batang punya satu arti.
  const props = {
    "data-testid": `timeline-bar-${spec.key}`,
    // SPEC-949 · nada dipancarkan sebagai atribut karena warnanya lahir dari nada di CSS, bukan dari
    // geometri: amplop yang jatuh ke nada task selesai (`muted`) lolos dari SETIAP assertion
    // berbasis `data-invalid`, terukur.
    "data-tone": spec.tone,
    "data-invalid": g.invalid ? "true" : "false",
    "data-clipped-start": g.clippedStart ? "true" : "false",
    "data-clipped-end": g.clippedEnd ? "true" : "false",
    title: spec.title, "aria-label": spec.title,
    onClick: spec.onClick,
    className: "hn-tl-bar",
    // Satu-satunya nilai per batang adalah posisi dan lebar. Minimum 3 px (bukan persen) dan tinggi
    // tombol 22 px ada di `.hn-tl-bar`; sudut siku di sisi terpotong ada di `data-clipped-*`.
    style: cssVars({ "--tl-left": `${g.left}%`, "--tl-width": `${g.width}%` }),
  };
  const body = (
    <>
      {/* Tenggat mendahului mulai: warna saja tak cukup (WCAG 1.4.1) — ikon + legenda menyebutnya. */}
      {g.invalid && <Icon name="triangle-alert" size={11} color={border} />}
      {g.clippedStart && <Icon name="chevron-left" size={11} color={border} />}
      <span className="hn-grow" />
      {g.clippedEnd && <Icon name="chevron-right" size={11} color={border} />}
    </>
  );
  return interactive
    ? <button type="button" {...props}>{body}</button>
    : <div role="img" {...props}>{body}</div>;
}

/* Legenda warna + ikon. Dipakai kedua mode; "Rentang project" hanya di mode lintas project. */
function TimelineLegend({ envelope = false }: { envelope?: boolean }) {
  const swatch = (tone: TimelineBarSpec["tone"]) => (
    <span aria-hidden="true" className="hn-tl-swatch" data-tone={tone} />
  );
  return (
    <ul aria-label="Legenda linimasa" className="hn-tl-legend">
      <li className="hn-tl-legend-item">{swatch("brass")}Rencana</li>
      <li className="hn-tl-legend-item">{swatch("muted")}Selesai</li>
      <li className="hn-tl-legend-item">
        {swatch("err")}
        <Icon name="triangle-alert" size={11} color="var(--status-err)" />
        Tenggat mendahului mulai
      </li>
      {envelope && (
        <li className="hn-tl-legend-item">
          {swatch("envelope")}Rentang project (buka lewat namanya)
        </li>
      )}
    </ul>
  );
}

export function TimelineCanvas({ window: win, rows, today, emptyHint, testId, labelHead }: {
  window: TimelineWindow; rows: TimelineRowSpec[]; today: number; emptyHint?: string;
  /* SPEC-949 · `data-testid` kanvas. Mode Lintas project memakai komponen yang SAMA dengan mode
     Linimasa, dan cermin `TEAM_VIEWS` ↔ cabang render di `team-screen.test.tsx` menuntut "tak ada
     dua mode yang berbagi permukaan" — tanpa testid sendiri ia lolos cermin itu sambil melanggar
     persis apa yang dijaganya. */
  testId?: string;
  labelHead?: string;
}) {
  const cell = zoomCell(win.zoom);
  const trackW = win.ticks.length * cell;
  const marker = todayOffset(win, today);
  return (
    /* Gulir mendatar dan `min-width: 0` ada di `.hn-tl-scroll` (team.css): ia yang menahan flex item
       ini melar mengikuti isinya alih-alih menggulir (kelas SPEC-879). Diuji lewat berkas CSS, karena
       jsdom tak memuat stylesheet. */
    <div data-testid={testId ?? "team-timeline"} className="hn-timeline-scroll hn-tl-scroll">
      {/* Lebar EKSPLISIT: anak blok di dalam container `overflow: auto` menyusut mengikuti
          containernya, dan scroller-nya lalu tak punya apa pun untuk digulir (SPEC-879).
          Dimensi kanvas (lebar kolom label, tick, trek) dinyatakan sekali di sini sebagai CSS var
          dan diwarisi header, baris, dan garis hari ini. Gridline trek memakai gradien, bukan satu
          div per sel per baris: 40 baris x 120 tick = 4 800 node kosong yang tak pernah dibaca. */}
      <div data-testid="timeline-canvas" className="hn-tl"
        style={cssVars({
          "--tl-label-w": `${LABEL_W}px`,
          "--tl-cell": `${cell}px`,
          "--tl-ticks": String(win.ticks.length),
          "--tl-track-w": `${trackW}px`,
          "--tl-canvas-w": `${LABEL_W + trackW}px`,
        })}>
        <div className="hn-tl-head">
          {/* Kolom label tetap `sticky left` bahkan di header: nama tugas yang tergulir keluar
              membuat batang di sebelah kanan kehilangan pemiliknya. */}
          <div className="hn-tl-label">
            <span className="hn-eyebrow">{labelHead ?? "Tugas"}</span>
          </div>
          <div className="hn-tl-ticks">
            {win.ticks.map((t) => (
              <div key={t.start} data-testid="timeline-tick" data-major={t.major ? "true" : "false"}
                className="hn-tl-tick">{t.label}</div>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div data-testid="timeline-empty" className="hn-tl-empty">
            {emptyHint ?? "Tak ada yang bisa dihamparkan di jendela ini."}
          </div>
        ) : rows.map((r) => (
          <div key={r.key} data-testid={`timeline-row-${r.key}`} className="hn-tl-row">
            <div className="hn-tl-label">
              <div className="hn-tl-label-text">{r.label}</div>
              {r.meta && <div className="hn-tl-label-meta">{r.meta}</div>}
            </div>
            <div className="hn-tl-track">
              {r.bars.map((b) => <Bar key={b.key} spec={b} />)}
            </div>
          </div>
        ))}

        {marker !== null && (
          <div data-testid="timeline-today" aria-hidden="true" className="hn-tl-today"
            style={cssVars({ "--tl-today-x": `${LABEL_W + (marker / 100) * trackW}px` })} />
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
    <div data-testid={testId} className="hn-tl-aside">
      <div className="hn-tl-aside-head">
        <Icon name={icon} size={13} color="var(--text-subtle)" />
        <span className="hn-eyebrow">{title} · {tasks.length}</span>
        {hint && <span className="hn-tl-aside-hint">{hint}</span>}
      </div>
      <div className="hn-tl-aside-list">
        {tasks.map((t) => (
          <button key={t.id} type="button" onClick={() => onOpen(t)} className="hn-tl-chip">{t.title}</button>
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
      <TimelineLegend />
      <TimelineCanvas window={win} rows={rowSpecs} today={today}
        emptyHint="Belum ada tugas bertanggal — isi mulai atau tenggat di kartunya." />
      {hidden > 0 && (
        <div data-testid="timeline-truncated" className="hn-tl-note">
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

/* ── mode lintas project (SPEC-949) ─────────────────────────────────────────────────────────────
   Baris ringkas per project menjawab pertanyaan yang mode Linimasa TIDAK jawab: project mana yang
   jadwalnya bertabrakan. Amplop `projectSpan` sendirian berbohong tentang okupansi — project
   ber-task di Januari dan Desember menggambar batang selebar setahun dan tampak bertabrakan dengan
   segalanya — jadi tiap baris membawa amplop DAN satu segmen per task. Itulah pemakaian `bars`
   jamak yang sudah disiapkan `TimelineCanvas`. */

const NONE_KEY = "__none__";

const taskTone = (t: TaskView, g: BarGeometry): TimelineBarSpec["tone"] =>
  g.invalid ? "err" : t.status === "done" ? "muted" : "brass";

const barTitle = (t: TaskView, g: BarGeometry, dates: string | null): string => [
  t.title, dates,
  g.invalid ? "tenggat mendahului mulai" : null,
  g.clippedStart || g.clippedEnd ? "melewati tepi jendela" : null,
].filter(Boolean).join(" · ");

function ExpandLabel({ testId, open, name, count, onClick }: {
  testId: string; open: boolean; name: string; count: number; onClick: () => void;
}) {
  return (
    /* `data-testid` sendiri, bukan `getByRole("button", { name })`: amplop project juga sebuah
       `button` dan `aria-label`-nya memuat nama project yang sama, jadi query berbasis nama cocok
       DUA elemen dan test gagal karena ambiguitas, bukan karena kode. */
    // `min-height: 0` ada di `.hn-tl button.hn-tl-expand` (team.css): `app.css` menaikkan setiap
    // `button` ke 44 px di layar sentuh, dan tombol 44 px di baris 34 px meluber ke baris berikutnya.
    <button type="button" onClick={onClick} data-testid={testId} aria-expanded={open}
      className="hn-tl-expand">
      <Icon name={open ? "chevron-down" : "chevron-right"} size={12} color="var(--text-subtle)" />
      <span className="hn-tl-expand-name">{name}</span>
      <span className="hn-tl-expand-count">{count}</span>
    </button>
  );
}

export function TeamProjectTimeline({
  tasks, projects, members, zoom, today, hidden, expanded, onToggle, onOpen,
}: {
  tasks: TaskView[];
  /** Disempitkan ke `{ id, name }`: kanvas tak butuh sisa `ProjectVM`, dan tanda tangan yang
      menyebut lebih dari yang dipakai mengundang ketergantungan yang tak disadari. */
  projects: { id: string; name: string }[];
  members: MemberView[];
  zoom: TimelineZoom; today: number;
  /** Selisih `total` vs yang termuat, akibat plafon 200/kolom (ADR-0151). */
  hidden: number;
  expanded: string[];
  onToggle: (projectId: string) => void;
  onOpen: (t: TaskView) => void;
}) {
  // Jendela dihitung dari SELURUH task yang termuat, bukan dari baris yang terlihat: kalau tidak,
  // membuka satu project menggeser sumbu dan seluruh baris lain ikut bergerak — persis saat
  // operator sedang membandingkan dua di antaranya.
  const win = React.useMemo(() => {
    const spans = tasks.map(taskSpan).filter((s): s is TaskSpan => s !== null);
    return timelineWindow(spans, zoom, today);
  }, [tasks, zoom, today]);

  const nameOf = React.useCallback((projectId: string | null): string => {
    if (projectId === null) return "Tanpa project";
    // Project bisa lenyap dari daftar sebelum kartunya menyusul (frame sync mendahului). Id mentah
    // lebih jujur daripada baris yang hilang — cermin "belum ditugaskan" di kartu papan.
    return projects.find((p) => p.id === projectId)?.name ?? projectId;
  }, [projects]);

  const groups = React.useMemo(() => projectGroups(tasks, win, nameOf), [tasks, win, nameOf]);
  const open = React.useMemo(() => new Set(expanded), [expanded]);

  const rows = React.useMemo<TimelineRowSpec[]>(() => {
    const out: TimelineRowSpec[] = [];
    for (const g of groups) {
      const key = g.projectId ?? NONE_KEY;
      const isOpen = open.has(key);
      const label = nameOf(g.projectId);
      const meta = g.geometry
        // `span.end` EKSKLUSIF — `taskSpan` menambahkan satu hari. Mengirimnya apa adanya membuat
        // setiap project berakhir sehari lebih lambat dari task terakhirnya.
        ? taskDates({
            startDate: new Date(g.span!.start).toISOString(),
            dueDate: new Date(g.span!.end - 1).toISOString(),
          })
        : g.span ? "di luar jendela · pilih zoom yang lebih lebar"
          : "belum dijadwalkan";

      const bars: TimelineBarSpec[] = [];
      if (g.geometry) {
        bars.push({
          key: `span:${key}`, geometry: g.geometry,
          tone: g.geometry.invalid ? "err" : "envelope",
          title: `${label} · ${meta ?? ""}`.trim(),
          // Tanpa onClick: amplop hanya gambar. Membuka baris dilakukan lewat nama project di
          // kolom kiri (ExpandLabel); dengan begitu satu klik batang tak pernah punya dua arti.
        });
        // Segmen tetap dirender saat baris DIBUKA: baris ringkas yang berubah arti tergantung
        // apakah ia sedang dibuka lebih sulit dibaca daripada sedikit pengulangan.
        for (const t of g.tasks) {
          const geometry = barGeometry(t, win);
          if (!geometry) continue;
          bars.push({
            key: `seg:${t.id}`, geometry, tone: taskTone(t, geometry),
            title: barTitle(t, geometry, taskDates(t)), onClick: () => onOpen(t),
          });
        }
      }

      out.push({
        key: `p:${key}`, meta, bars,
        label: <ExpandLabel testId={`expand-${key}`} open={isOpen} name={label}
          count={g.tasks.length} onClick={() => onToggle(key)} />,
      });

      if (!isOpen) continue;
      for (const t of g.tasks) {
        const geometry = barGeometry(t, win);
        const assignee = members.find((m) => m.id === t.memberId)?.name ?? "belum ditugaskan";
        const dates = taskDates(t);
        out.push({
          key: `t:${t.id}`,
          label: <span className="hn-tl-child">{t.title}</span>,
          meta: dates ? `${assignee} · ${dates}` : assignee,
          bars: geometry
            ? [{
                key: `t:${t.id}`, geometry, tone: taskTone(t, geometry),
                title: barTitle(t, geometry, dates), onClick: () => onOpen(t),
              }]
            : [],
        });
      }
    }
    return out;
  }, [groups, open, nameOf, win, members, onToggle, onOpen]);

  return (
    <>
      <TimelineLegend envelope />
      <TimelineCanvas window={win} rows={rows} today={today}
        testId="team-projects" labelHead="Project"
        emptyHint="Belum ada project bertanggal — isi mulai atau tenggat di kartunya." />
      {hidden > 0 && (
        <div data-testid="projects-truncated" className="hn-tl-note">
          {hidden} tugas tak termuat karena plafon 200 per kolom — amplop project bisa
          lebih pendek dari rentang sebenarnya; persempit kolom, anggota, atau pencarian
        </div>
      )}
    </>
  );
}
