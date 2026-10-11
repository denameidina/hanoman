/* DalangHanomanScreen — papan status senyap (Audit UI/UX 2026-10 · Fase 3B). Takeover layar penuh tanpa
   Shell: satu-satunya layar gelap penuh, pengecualian terdokumentasi (kerja aktif). Dipangkas dari panggung
   sinematik: tanpa HUD, scan line, float, kursor berkedip, count-up, ticker mengetik, footer, KPI ganda,
   jam, donut, dan grafik. Tersisa: ringkasan satu baris + status koneksi, area "Menunggu jawabanmu" di atas,
   dan daftar project sebagai baris (wayang ikon 24px). Tanpa timer dan tanpa animasi: pet tetap satu-satunya
   elemen yang bergerak. Sumber hidup = `sessions` WS (bukan ProjectView.session yang basi). Murni presentasi. */
import React from "react";
import { Icon } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, SpecSlim } from "./types";
import { WayangSilhouette } from "./DalangStage";
import { FLOW_LABEL, STAGE_LABEL, labelOf } from "../lib/labels";
import { useEventsStatus } from "../api/live";
import "./styles/dalang.css";

// Menunggu manusia: cermin pet-state.ts dan Terminal (decision && !deciding).
const isWaiting = (s: TerminalSession) => !!s.decision && !s.deciding;

// Warna wayang per keadaan. Diberikan sebagai prop SVG (atribut fill/rod), bukan kelas.
const PUPPET_COLOR = {
  wait: { color: "var(--amber-500)", rod: "var(--brass-300)" },
  run: { color: "var(--brass-400)", rod: "var(--brass-300)" },
  off: { color: "var(--term-dim)", rod: "var(--term-line)" },
} as const;

type RowTone = keyof typeof PUPPET_COLOR;

/** Satu baris: wayang kecil, nama, fase, sesi, lalu aksi. Seluruh baris adalah satu tombol. */
function Row({ tone, name, fase, sesi, aksi, onClick }: {
  tone: RowTone; name: string; fase: string; sesi: string; aksi: string; onClick: () => void;
}) {
  return (
    <button type="button" className={`hn-dlg-row hn-dlg-row--${tone}`} onClick={onClick}>
      <span className="hn-dlg-glyph" aria-hidden="true">
        <WayangSilhouette height={24} color={PUPPET_COLOR[tone].color} rod={PUPPET_COLOR[tone].rod} />
      </span>
      <span className="hn-dlg-name">{name}</span>
      <span className="hn-dlg-fase">{fase}</span>
      {sesi && <span className="hn-dlg-sesi">{sesi}</span>}
      <span className="hn-dlg-aksi">{aksi}</span>
    </button>
  );
}

/** Status koneksi nyata dari socket, bukan teks tetap. */
function linkState(connected: boolean, paused: boolean): { tone: "ok" | "idle" | "err"; text: string } {
  if (connected) return { tone: "ok", text: "Terhubung" };
  if (paused) return { tone: "idle", text: "Jeda · tab tersembunyi" };
  return { tone: "err", text: "Koneksi terputus · menyambung ulang" };
}

export function DalangHanomanScreen({ projects, backlog, sessions, onOpenSession, onOpenProject, onGoto, onExit, previous }: {
  projects: ProjectVM[]; backlog: SpecSlim[]; sessions: TerminalSession[];
  onOpenSession: (id: string) => void; onOpenProject: (p: ProjectVM) => void;
  onGoto: (s: string) => void; onExit: () => void;
  /** Halaman sebelumnya yang dituju tombol keluar (opsional). Tanpa ini keluar = `onExit`. */
  previous?: { label: string; onBack: () => void };
}) {
  const events = useEventsStatus();
  // Jalan keluar utama = tombol di layar; Escape hanya pintasan yang menuju tujuan yang sama.
  const leave = previous ? previous.onBack : onExit;
  const leaveRef = React.useRef(leave);
  leaveRef.current = leave;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") leaveRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const live = sessions.filter((s) => !s.exited).sort((a, b) => a.id.localeCompare(b.id));
  const liveProjects = new Set(live.map((s) => s.projectId));
  const waiting = live.filter(isWaiting);
  const running = live.filter((s) => !isWaiting(s));
  const parked = projects.filter((p) => !liveProjects.has(p.id));
  const specById = new Map(backlog.map((s) => [s.id, s] as const));
  const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
  const faseOf = (s: TerminalSession) => {
    const spec = s.specId ? specById.get(s.specId) : undefined;
    return spec ? labelOf(STAGE_LABEL, spec.stage) : s.flow ? labelOf(FLOW_LABEL, s.flow) : "Sesi terminal";
  };

  const summary = [
    live.length === 0 ? "Tidak ada sesi berjalan" : `${live.length} sesi berjalan`,
    waiting.length > 0 ? `${waiting.length} menunggu jawabanmu` : null,
    `${projects.length} project`,
  ].filter(Boolean).join(" · ");
  const link = linkState(events.connected, events.paused);

  return (
    <div className="hn-dlg">
      <header className="hn-dlg-top">
        <div className="hn-dlg-head">
          <h2 className="hn-dlg-title">Dalang Hanoman</h2>
          <p className="hn-dlg-summary">{summary}</p>
          <p className={`hn-dlg-link hn-dlg-link--${link.tone}`} role="status">
            <span className="hn-dlg-dot" aria-hidden="true" />{link.text}
          </p>
        </div>
        <div className="hn-dlg-actions">
          <button type="button" className="hn-dlg-btn" onClick={() => onGoto("terminal")}>Buka terminal</button>
          {/* Jalan keluar selalu 44×44 (sentuh); ikon ✕ atau panah kembali. */}
          <button type="button" className="hn-dlg-exit" onClick={leave}
            aria-label={previous ? `Kembali ke ${previous.label}` : "Keluar dari panggung (Esc)"}
            title={previous ? `Kembali ke ${previous.label}` : "Keluar dari panggung (Esc)"}>
            <Icon name={previous ? "arrow-left" : "x"} size={18} />
          </button>
        </div>
      </header>

      {waiting.length > 0 && (
        <section className="hn-dlg-section" aria-labelledby="dlg-wait">
          <h3 id="dlg-wait" className="hn-dlg-rt">Menunggu jawabanmu</h3>
          <ul className="hn-dlg-list">
            {waiting.map((s) => (
              <li key={s.id}>
                <Row tone="wait" name={nameById.get(s.projectId) ?? s.projectId} fase={faseOf(s)}
                  sesi={s.specId ?? ""} aksi="Jawab" onClick={() => onOpenSession(s.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="hn-dlg-section" aria-labelledby="dlg-prj">
        <h3 id="dlg-prj" className="hn-dlg-rt">Project</h3>
        {projects.length === 0 ? (
          <div className="hn-dlg-empty">
            <div>Panggung sunyi — belum ada project di workspace.</div>
            <div className="hn-dlg-empty-hint">Tambahkan project dan sang dalang mengangkat wayangnya.</div>
          </div>
        ) : (running.length + parked.length) > 0 && (
          <ul className="hn-dlg-list">
            {running.map((s) => (
              <li key={s.id}>
                <Row tone="run" name={nameById.get(s.projectId) ?? s.projectId} fase={faseOf(s)}
                  sesi={s.specId ?? ""} aksi="Buka terminal" onClick={() => onOpenSession(s.id)} />
              </li>
            ))}
            {parked.map((p) => (
              <li key={p.id}>
                <Row tone="off" name={p.name} fase="Tidak ada sesi" sesi="" aksi="Buka project"
                  onClick={() => onOpenProject(p)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
