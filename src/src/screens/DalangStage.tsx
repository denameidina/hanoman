/* DalangStage — hero Overview: Anoman sebagai DALANG yang mengendalikan wayang project.
   Konsep: tiap sesi `claude` yang running = satu wayang yang sedang dimainkan di kelir
   (panel gelap terminal + rim brass); project tanpa sesi = wayang parkir di debog.
   Referensi visual: internal/assets/illustration/concepts/dalang/ (ADR-0140 pipeline Codex).
   Murni presentasi — data dari props Overview, tanpa fetch sendiri. */
import React from "react";
import { MascotIllustration } from "../ds";
import type { ProjectVM, Spec } from "./types";

// Batas hari LOKAL, komponen-per-komponen — `new Date("YYYY-MM-DD")` adalah tengah malam UTC
// dan menggeser hari di WIB (gotcha ADR-0090/0105).
function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/* Siluet wayang kulit generik (bukan Anoman — Anoman-nya sang dalang): kepala profil +
   sumping, badan ramping, kain melebar, satu lengan ber-gapit. Digambar sekali, diwarnai
   lewat `fill`/`stroke` dari token pemanggil. */
function WayangSilhouette({ height, color, rod }: { height: number; color: string; rod: string }) {
  return (
    <svg viewBox="0 0 64 128" width={(height * 64) / 128} height={height} aria-hidden="true" focusable="false">
      {/* gapit utama — tulang pegang dalang */}
      <path d="M31.2 74 L30.2 127 L33.8 127 L32.8 74 Z" fill={rod} />
      {/* gapit lengan */}
      <path d="M51 79 L50.2 122 L53 122 L52.4 79 Z" fill={rod} />
      {/* tubuh: kain, torso, kepala profil menghadap kanan + irah-irahan menyapu ke belakang */}
      <path
        d="M32 73
           C 24 76, 19 88, 17.5 103 C 17 106, 20 107, 24 106.4
           C 28 106, 30 104, 32 104 C 34 104, 36 106, 40 106.4 C 44 107, 47 106, 46.5 103
           C 45 88, 40 76, 32 73 Z"
        fill={color}
      />
      <path d="M32 74 C 29.5 66, 29.5 60, 31 53 L 37 53 C 38.5 60, 37.5 67, 34.5 74 Z" fill={color} />
      <path
        d="M31 53
           C 28.5 48, 29 43.5, 31.5 40.5
           C 28 38.5, 25 34, 25.5 28.5
           C 26 22, 30 16.5, 36 15
           C 34 20, 34.5 24, 37.5 27.5
           C 41 31.5, 44.5 33.5, 46.5 37.5
           C 48 40.5, 47 43.5, 44.5 44.5
           C 46 46.5, 46.5 49, 45 51.5
           C 43 54.5, 38 55, 34.5 53.8 Z"
        fill={color}
      />
      {/* lengan depan: bahu → siku → telapak, menyatu ke gapit lengan */}
      <path
        d="M35 55 C 40 58, 44.5 63, 47.5 69 C 49.5 73, 51 76, 51.8 79.5 L 49.4 80.5
           C 47 76.5, 44.5 72.5, 41.5 68.5 C 38.5 64.5, 35.5 61, 33 58.5 Z"
        fill={color}
      />
    </svg>
  );
}

function LivePuppet({ p, index, onGoto }: { p: ProjectVM; index: number; onGoto: (s: string) => void }) {
  return (
    <button
      type="button"
      className="hn-dalang-live"
      style={{ animationDelay: `${(index % 5) * 0.5}s` }}
      onClick={() => onGoto("terminal")}
      aria-label={`Buka terminal — ${p.name}${p.session.phase ? `, fase ${p.session.phase}` : ""}`}
    >
      <span className="hn-dalang-puppet" style={{ animationDelay: `${(index % 5) * 0.7}s` }}>
        <WayangSilhouette height={72} color="var(--brass-300)" rod="var(--brass-700)" />
      </span>
      <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, color: "var(--term-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
      <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--brass-400)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.session.phase ?? "berjalan"}{p.session.flow ? ` · ${p.session.flow}` : ""}
      </span>
    </button>
  );
}

function Stat({ value, label, dot }: { value: React.ReactNode; label: string; dot: string }) {
  return (
    <div className="hn-dalang-stat">
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1 }}>{value}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

export function DalangStage({ projects, backlog, onGoto, onOpenProject }: {
  projects: ProjectVM[]; backlog: Spec[];
  onGoto: (s: string) => void; onOpenProject: (p: ProjectVM) => void;
}) {
  const live = projects.filter((p) => p.session.status === "running");
  const parked = projects.filter((p) => p.session.status !== "running");
  const startedToday = backlog.filter((s) => isToday(s.startedAt)).length;
  const doneN = backlog.filter((s) => s.stage === "done").length;
  const waitingN = backlog.filter((s) => !s.startedAt && s.stage !== "done").length;

  return (
    <section className="hn-dalang" aria-label="Panggung dalang — status orkestrasi workspace">
      <div className="hn-dalang-head hn-wrap-mobile">
        <div>
          <div className="hn-eyebrow" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-subtle)" }}>
            panggung dalang · {live.length > 0 ? `${live.length} wayang dimainkan` : "kelir sunyi"}
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, color: "var(--text-strong)", margin: "5px 0 0" }}>
            {live.length > 0 ? "Anoman sedang memainkan lakon" : "Anoman siaga di balik kelir"}
          </h2>
        </div>
        <div className="hn-dalang-stats">
          <Stat value={startedToday} label="dikerjakan hari ini" dot="var(--brass-500)" />
          <Stat value={live.length} label="sesi berjalan" dot="var(--leaf-500)" />
          <Stat value={waitingN} label="menunggu di backlog" dot="var(--wind-500)" />
          <Stat value={doneN} label="total selesai" dot="var(--bone-400)" />
        </div>
      </div>

      <div className="hn-dalang-stage">
        <div className="hn-dalang-mascot">
          <MascotIllustration id={live.length > 0 ? "MPS-004" : "MPS-003"} decorative />
        </div>
        {live.length > 0 ? (
          <div className="hn-dalang-troupe" role="list" aria-label="Sesi yang sedang berjalan">
            {live.map((p, i) => <LivePuppet key={p.id} p={p} index={i} onGoto={onGoto} />)}
          </div>
        ) : (
          <div className="hn-dalang-empty">
            <div style={{ fontSize: 13.5, color: "var(--text-body)" }}>
              Panggung sunyi — semua wayang tersandar di debog.
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Mulai sebuah backlog item dan sang dalang mengangkat wayangnya.
            </div>
          </div>
        )}
      </div>

      {parked.length > 0 && (
        <div className="hn-dalang-debog" aria-label="Project tanpa sesi aktif">
          {parked.map((p) => (
            <button key={p.id} type="button" className="hn-dalang-parked" onClick={() => onOpenProject(p)}
              aria-label={`Buka project ${p.name}`}>
              <WayangSilhouette height={26} color="var(--ink-300)" rod="var(--bone-400)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
