/* DalangStage — hero Overview: Anoman sebagai DALANG yang mengendalikan wayang project.
   Konsep: tiap sesi `claude` hidup = satu wayang yang sedang dimainkan di kelir
   (panel gelap terminal + rim brass); project tanpa sesi hidup = wayang parkir di debog.
   Referensi visual: internal/assets/concepts/dalang/ (ADR-0140 pipeline Codex).
   Sumber "hidup"-nya `sessions` (siaran WS `t:"sessions"`), BUKAN `ProjectView.session` —
   yang terakhir hanya dimuat saat login dan basi berjam-jam (lihat catatan pet di
   frontend-implementation.md); kosakata sesinya cermin pet-state.ts: hidup = `!exited`,
   menunggu manusia = `decision && !deciding`. Murni presentasi, tanpa fetch sendiri. */
import React from "react";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, Spec } from "./types";
// Aset dalang digenerate Codex/GPT Image (chroma key hijau → transparan), master + rekaman
// produksi di internal/assets/dalang/. Ukuran display (512/384/256) supaya bundle tak bengkak —
// pelajaran registry illustration (master 1,5 MB per berkas dilarang masuk glob bundel).
import dalangUrl from "../../../internal/assets/dalang/hnm-dalang-six-arms-v01.webp?url";
import wayangUrl from "../../../internal/assets/dalang/hnm-wayang-project-v01.webp?url";
import blencongUrl from "../../../internal/assets/dalang/hnm-blencong-v01.webp?url";

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

function LivePuppet({ s, projects, backlog, index, onOpenSession }: {
  s: TerminalSession; projects: ProjectVM[]; backlog: Spec[]; index: number;
  onOpenSession: (id: string) => void;
}) {
  const projectName = projects.find((p) => p.id === s.projectId)?.name ?? s.projectId;
  const spec = s.specId ? backlog.find((x) => x.id === s.specId) : undefined;
  // Cermin sel Terminal & pet-state.ts: sesi hidup yang `decision && !deciding` sedang menunggu
  // manusia — wayang-nya "menoleh" (goyangan berhenti) supaya yang minta tolong terbaca beda.
  const waiting = !!s.decision && !s.deciding;
  const sub = waiting ? "menunggu jawabanmu"
    : spec ? `${spec.id} · ${spec.stage}` : (s.flow ?? "sesi terminal");
  return (
    <button
      type="button"
      className="hn-dalang-live"
      data-puppet
      data-waiting={waiting || undefined}
      style={{ animationDelay: `${(index % 5) * 0.5}s` }}
      onClick={() => onOpenSession(s.id)}
      aria-label={`Buka terminal — ${projectName}, ${sub}`}
    >
      <span className={waiting ? "hn-dalang-puppet hn-dalang-puppet--still" : "hn-dalang-puppet"}
        style={{ animationDelay: `${(index % 5) * 0.7}s` }}>
        <img src={wayangUrl} alt="" aria-hidden="true" height={78}
          style={{ display: "block", width: "auto" }} />
      </span>
      <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, color: "var(--term-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName}</span>
      <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 10.5, color: waiting ? "var(--amber-500)" : "var(--brass-400)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sub}
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

export function DalangStage({ projects, backlog, sessions, onOpenSession, onOpenProject }: {
  projects: ProjectVM[]; backlog: Spec[]; sessions: TerminalSession[];
  onOpenSession: (id: string) => void; onOpenProject: (p: ProjectVM) => void;
}) {
  // Urutan tmux bisa bergeser tiap siaran — stabilkan per id (cermin pet-state.ts `byId`).
  const live = sessions.filter((s) => !s.exited).sort((a, b) => a.id.localeCompare(b.id));
  const liveProjects = new Set(live.map((s) => s.projectId));
  const parked = projects.filter((p) => !liveProjects.has(p.id));
  const startedToday = backlog.filter((s) => isToday(s.startedAt)).length;
  const doneN = backlog.filter((s) => s.stage === "done").length;
  const waitingN = backlog.filter((s) => !s.startedAt && s.stage !== "done").length;

  // Benang gapit: kurva dari kipas tangan sang dalang ke tiap kartu wayang, DIUKUR dari layout
  // nyata (kartu wrap & lebar berubah-ubah) — bukan koordinat tebakan. jsdom memberi rect 0
  // → benang kosong, svg-nya tetap dirender supaya kontraknya bisa diuji.
  const liveKey = live.map((s) => s.id).join("|");
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [threads, setThreads] = React.useState<string[]>([]);
  React.useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || live.length === 0) { setThreads([]); return; }
    const measure = () => {
      const host = el.getBoundingClientRect();
      if (host.width < 60) return;
      const m = el.querySelector<HTMLElement>(".hn-dalang-mascot")?.getBoundingClientRect();
      // Jangkar = ujung kipas gapit di kanan-atas figur dalang.
      const hx = m ? m.right - host.left - m.width * 0.2 : 150;
      const hy = m ? m.top - host.top + m.height * 0.28 : host.height * 0.35;
      const ds: string[] = [];
      el.querySelectorAll<HTMLElement>("[data-puppet]").forEach((c) => {
        const r = c.getBoundingClientRect();
        const tx = r.left + r.width / 2 - host.left;
        const ty = r.top - host.top + 2;
        const my = Math.min(hy, ty) - 26;
        ds.push(`M ${hx.toFixed(1)} ${hy.toFixed(1)} Q ${((hx + tx) / 2).toFixed(1)} ${my.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`);
      });
      setThreads(ds);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [liveKey, live.length]);

  return (
    <section className="hn-dalang" aria-label="Panggung dalang — status orkestrasi workspace">
      <div className="hn-dalang-head hn-wrap-mobile">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Blencong di header — di kelir ia menabrak kartu wayang; "menyala" saat ada sesi. */}
          <img className="hn-dalang-blencong" src={blencongUrl} alt="" aria-hidden="true"
            data-lit={live.length > 0 || undefined} />
          <div>
            <div className="hn-eyebrow" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-subtle)" }}>
              panggung dalang · {live.length > 0 ? `${live.length} wayang dimainkan` : "kelir sunyi"}
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, color: "var(--text-strong)", margin: "5px 0 0" }}>
              {live.length > 0 ? "Anoman sedang memainkan lakon" : "Anoman siaga di balik kelir"}
            </h2>
          </div>
        </div>
        <div className="hn-dalang-stats">
          <Stat value={startedToday} label="dikerjakan hari ini" dot="var(--brass-500)" />
          <Stat value={live.length} label="sesi berjalan" dot="var(--leaf-500)" />
          <Stat value={waitingN} label="menunggu di backlog" dot="var(--wind-500)" />
          <Stat value={doneN} label="total selesai" dot="var(--bone-400)" />
        </div>
      </div>

      <div className="hn-dalang-stage" ref={stageRef} data-live={live.length > 0 || undefined}>
        {live.length > 0 && (
          <svg className="hn-dalang-threads" aria-hidden="true" focusable="false">
            {threads.map((d, i) => <path key={i} d={d} style={{ animationDelay: `${(i % 5) * 0.35}s` }} />)}
          </svg>
        )}
        <div className="hn-dalang-mascot">
          {/* Sang dalang sendiri: enam lengan, empat gapit kosong — wayang-nya kartu di kelir.
              Aset yang sama untuk idle & running; yang bercerita adalah kelir di sebelahnya. */}
          <img src={dalangUrl} alt="" aria-hidden="true" style={{ display: "block", width: "100%", height: "auto" }} />
        </div>
        {live.length > 0 ? (
          <div className="hn-dalang-troupe" role="list" aria-label="Sesi yang sedang berjalan">
            {live.map((s, i) => <LivePuppet key={s.id} s={s} projects={projects} backlog={backlog}
              index={i} onOpenSession={onOpenSession} />)}
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
