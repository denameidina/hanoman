/* DalangHanomanScreen — "panggung orkestrasi" sinematik (menu Dalang Hanoman): implementasi
   layar dari konsep Claude Design "Dashboard Futuristik" dengan DATA NYATA. Satu-satunya layar
   bertema gelap penuh — dibenarkan oleh peran warna DS "dark terminal = kerja aktif": seluruh
   layar ini adalah panggung kerja aktif sang dalang. Sumber hidup = `sessions` WS (cermin
   DalangStage; `ProjectView.session` basi sejak login). Murni presentasi, nol fetch baru.
   Semua warna lewat kelas `.hn-dlg-*` di app.css / token — dikunci test kontrak. */
import React from "react";
import { Icon } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, Spec } from "./types";
import { isToday } from "./DalangStage";
import heroUrl from "../../../internal/assets/dalang/hnm-hero-cinematic-v01.webp?url";
import blencongUrl from "../../../internal/assets/dalang/hnm-blencong-v01.webp?url";
// Empat varian wayang sinematik (aset GPT Image via Codex, benang gantung di puncak) —
// tiap project dapat tokohnya sendiri lewat hash stabil dari id.
import wayangAlusUrl from "../../../internal/assets/dalang/hnm-wayang-satria-alus-v01.webp?url";
import wayangGagahUrl from "../../../internal/assets/dalang/hnm-wayang-satria-gagah-v01.webp?url";
import wayangPutriUrl from "../../../internal/assets/dalang/hnm-wayang-putri-v01.webp?url";
import wayangPanakawanUrl from "../../../internal/assets/dalang/hnm-wayang-panakawan-v01.webp?url";

const WAYANG_VARIANTS = [wayangAlusUrl, wayangGagahUrl, wayangPutriUrl, wayangPanakawanUrl];
const wayangFor = (projectId: string): string =>
  WAYANG_VARIANTS[[...projectId].reduce((n, c) => n + c.charCodeAt(0), 0) % WAYANG_VARIANTS.length]!;

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const pad = (n: number) => String(n).padStart(2, "0");

function useReducedMotion(): boolean {
  return React.useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
}

/* Jam hidup — satu interval, dibersihkan saat unmount. */
function useClock(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/* Ticker boot ala JARVIS: mengetik satu baris, jeda, lanjut baris berikut. Reduced-motion →
   baris pertama statis. Baris dibangun dari DATA NYATA oleh pemanggil. */
function useTicker(lines: string[], reduced: boolean): string {
  const [text, setText] = React.useState("");
  const key = lines.join("|");
  React.useEffect(() => {
    if (reduced || lines.length === 0) { setText(lines[0] ?? ""); return; }
    let idx = 0; let i = 0; let timer: ReturnType<typeof setInterval> | null = null;
    let hold: ReturnType<typeof setTimeout> | null = null;
    const type = () => {
      const line = lines[idx % lines.length] ?? "";
      i = 0;
      timer = setInterval(() => {
        i++;
        setText(line.slice(0, i));
        if (i >= line.length && timer) {
          clearInterval(timer); timer = null;
          hold = setTimeout(() => { idx++; type(); }, 3200);
        }
      }, 26);
    };
    type();
    return () => { if (timer) clearInterval(timer); if (hold) clearTimeout(hold); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);
  return text;
}

/* Count-up angka KPI sekali saat mount; reduced-motion langsung ke nilai akhir. */
function useCountUp(target: number, reduced: boolean): number {
  const [v, setV] = React.useState(reduced ? target : 0);
  React.useEffect(() => {
    if (reduced) { setV(target); return; }
    const t0 = performance.now(); const T = 900;
    let raf = 0;
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / T);
      setV(Math.round(target * (1 - Math.pow(1 - f, 3))));
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return v;
}

function Kpi({ icon, tone, label, value, sub }: {
  icon: string; tone: string; label: string; value: React.ReactNode; sub: string;
}) {
  return (
    <div className="hn-dlg-kpi">
      <span className={`hn-dlg-kpi-ic hn-dlg-tone-${tone}`}><Icon name={icon} size={17} /></span>
      <span style={{ minWidth: 0 }}>
        <span className="hn-dlg-kpi-l">{label}</span>
        <span className="hn-dlg-kpi-v">{value}</span>
        <span className="hn-dlg-kpi-s">{sub}</span>
      </span>
    </div>
  );
}

export function DalangHanomanScreen({ projects, backlog, sessions, onOpenSession, onOpenProject, onGoto, onExit }: {
  projects: ProjectVM[]; backlog: Spec[]; sessions: TerminalSession[];
  onOpenSession: (id: string) => void; onOpenProject: (p: ProjectVM) => void;
  onGoto: (s: string) => void; onExit: () => void;
}) {
  const reduced = useReducedMotion();
  const now = useClock();

  // Layar penuh (takeover): Escape = keluar, cermin kebiasaan fullscreen Terminal.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const live = sessions.filter((s) => !s.exited).sort((a, b) => a.id.localeCompare(b.id));
  const liveProjects = new Set(live.map((s) => s.projectId));
  const parked = projects.filter((p) => !liveProjects.has(p.id));
  const waitingN = live.filter((s) => !!s.decision && !s.deciding).length;
  const startedToday = backlog.filter((s) => isToday(s.startedAt)).length;

  const kProyek = useCountUp(projects.length, reduced);
  const kToday = useCountUp(startedToday, reduced);
  const kLive = useCountUp(live.length, reduced);
  const kWait = useCountUp(waitingN, reduced);

  const ticker = useTicker([
    live.length > 0 ? `HANOMAN ONLINE · ${live.length} SESI HIDUP` : "HANOMAN ONLINE · KELIR SUNYI",
    `${startedToday} TASK DIKERJAKAN HARI INI`,
    waitingN > 0 ? `${waitingN} SESI MENUNGGU JAWABANMU` : "SEMUA SISTEM NORMAL",
    `${projects.length} PROYEK DALAM PANTAUAN`,
  ], reduced);

  // Distribusi backlog per stage — data nyata untuk donut (r=15.9 → keliling ≈ 100 unit).
  // Kosakata zStage: brainstorming/objective/spec-ready/planned/executing/done — dirangkum
  // ke empat fase yang terbaca operator.
  const stageN = { done: 0, executing: 0, planned: 0, spec: 0 };
  for (const s of backlog) {
    if (s.stage === "done") stageN.done++;
    else if (s.stage === "executing") stageN.executing++;
    else if (s.stage === "planned") stageN.planned++;
    else stageN.spec++;
  }
  const total = backlog.length;
  const segs: { key: keyof typeof stageN; cls: string; label: string }[] = [
    { key: "executing", cls: "wind", label: "Execute" },
    { key: "done", cls: "leaf", label: "Done" },
    { key: "planned", cls: "amber", label: "Plan" },
    { key: "spec", cls: "brass", label: "Spec" },
  ];
  let acc = 0;
  const donut = segs.map((g) => {
    const frac = total ? (stageN[g.key] / total) * 100 : 0;
    const seg = { ...g, n: stageN[g.key], frac, offset: 25 - acc };
    acc += frac;
    return seg;
  });

  // Produktivitas 7 hari: berapa item mulai dikerjakan per hari LOKAL.
  const days: { label: string; n: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const n = backlog.filter((s) => {
      if (!s.startedAt) return false;
      const t = new Date(s.startedAt);
      return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() && t.getDate() === d.getDate();
    }).length;
    days.push({ label: `${d.getDate()} ${BULAN[d.getMonth()]}`, n });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.n));
  const pts = days.map((d, i) => `${32 + i * 35},${78 - (d.n / maxDay) * 60}`).join(" ");

  // Benang gapit: diukur dari layout nyata (cermin DalangStage); jsdom rect 0 → kosong.
  const liveKey = live.map((s) => s.id).join("|");
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [threads, setThreads] = React.useState<string[]>([]);
  React.useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || live.length === 0) { setThreads([]); return; }
    const measure = () => {
      const host = el.getBoundingClientRect();
      if (host.width < 60) return;
      const art = el.querySelector<HTMLElement>(".hn-dlg-hero-art")?.getBoundingClientRect();
      const cx = art ? art.left + art.width / 2 - host.left : host.width / 2;
      // Dua jangkar = dua kelompok tangan hero (kiri/kanan), cermin komposisi referensi.
      const hy = art ? art.top - host.top + art.height * 0.36 : host.height * 0.35;
      const spread = art ? art.width * 0.34 : 60;
      const ds: string[] = [];
      el.querySelectorAll<HTMLElement>("[data-puppet]").forEach((c) => {
        // Ujung benang = puncak WAYANG-nya (tempat string emas di aset), bukan tepi kartu.
        const img = c.querySelector<HTMLElement>(".hn-dlg-puppet img") ?? c;
        const r = img.getBoundingClientRect();
        const tx = r.left + r.width / 2 - host.left;
        const ty = r.top - host.top + 1;
        const hx = tx < cx ? cx - spread : cx + spread;
        const my = Math.min(hy, ty) - 16;
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

  const activity = projects.slice(0, 6).map((p) => ({
    id: p.id, name: p.name, text: p.activity, commit: p.commit, live: liveProjects.has(p.id),
  }));

  return (
    <div className="hn-dlg">
      <div className="hn-dlg-top hn-wrap-mobile">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <img className="hn-dlg-blencong" src={blencongUrl} alt="" aria-hidden="true"
            data-lit={live.length > 0 || undefined} />
          <div style={{ minWidth: 0 }}>
            <h2 className="hn-dlg-title">Dalang Hanoman</h2>
            <p className="hn-dlg-boot" aria-live="off">{ticker}</p>
          </div>
        </div>
        <div className="hn-dlg-chips">
          <span className="hn-dlg-chip"><Icon name="calendar" size={13} />{now.getDate()} {BULAN[now.getMonth()]} {now.getFullYear()}</span>
          <span className="hn-dlg-chip"><Icon name="clock" size={13} />{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>
          <button type="button" className="hn-dlg-exit" onClick={onExit} aria-label="Keluar dari panggung (Esc)">
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      <div className="hn-dlg-kpis">
        <Kpi icon="layout-grid" tone="wind" label="TOTAL PROYEK" value={kProyek} sub="dalam pantauan" />
        <Kpi icon="check-circle-2" tone="leaf" label="TASK HARI INI" value={kToday} sub="mulai dikerjakan" />
        <Kpi icon="activity" tone="brass" label="SESI BERJALAN" value={kLive} sub="wayang dimainkan" />
        <Kpi icon="hand" tone="amber" label="MENUNGGU KAMU" value={kWait} sub="butuh keputusan" />
      </div>

      <div className="hn-dlg-grid hn-grid-mobile">
        <div style={{ minWidth: 0 }}>
          <div className="hn-dlg-hero" ref={stageRef}>
            <svg className="hn-dlg-hud" viewBox="0 0 330 330" aria-hidden="true">
              <g className="hn-dlg-hud-a"><circle cx="165" cy="165" r="150" strokeDasharray="3 14" /></g>
              <g className="hn-dlg-hud-b"><circle cx="165" cy="165" r="126" strokeDasharray="40 22" /></g>
            </svg>
            {threads.length > 0 && (
              <svg className="hn-dlg-threads" aria-hidden="true" focusable="false">
                {threads.map((d, i) => <path key={i} d={d} style={{ animationDelay: `${(i % 6) * 0.3}s` }} />)}
              </svg>
            )}
            <div className="hn-dlg-scan" aria-hidden="true" />
            <div className="hn-dlg-hero-art">
              <img src={heroUrl} alt="" aria-hidden="true" />
            </div>
            {(live.length > 0 || parked.length > 0) ? (
              <div className="hn-dlg-cards" role="list" aria-label="Wayang project">
                {live.map((s, i) => {
                  const name = projects.find((p) => p.id === s.projectId)?.name ?? s.projectId;
                  const spec = s.specId ? backlog.find((x) => x.id === s.specId) : undefined;
                  const waiting = !!s.decision && !s.deciding;
                  const sub = waiting ? "menunggu jawabanmu"
                    : spec ? `${spec.id} · ${spec.stage}` : (s.flow ?? "sesi terminal");
                  return (
                    <button key={s.id} type="button" className="hn-dlg-prj" data-puppet
                      data-waiting={waiting || undefined}
                      onClick={() => onOpenSession(s.id)}
                      aria-label={`Buka terminal — ${name}, ${sub}`}>
                      <span className={waiting ? "hn-dlg-puppet hn-dlg-puppet--still" : "hn-dlg-puppet"}
                        style={{ animationDelay: `${(i % 6) * 0.6}s` }}>
                        <img src={wayangFor(s.projectId)} alt="" aria-hidden="true" />
                      </span>
                      <span className="hn-dlg-prj-name">{name}</span>
                      <span className={waiting ? "hn-dlg-prj-sub hn-dlg-prj-sub--amber" : "hn-dlg-prj-sub"}>{sub}</span>
                    </button>
                  );
                })}
                {/* Semua project tampil — yang tanpa sesi hidup jadi wayang redup tersandar. */}
                {parked.map((p) => (
                  <button key={p.id} type="button" className="hn-dlg-prj hn-dlg-prj--off"
                    onClick={() => onOpenProject(p)}
                    aria-label={`Buka project ${p.name}`}>
                    <span className="hn-dlg-puppet hn-dlg-puppet--still">
                      <img src={wayangFor(p.id)} alt="" aria-hidden="true" />
                    </span>
                    <span className="hn-dlg-prj-name">{p.name}</span>
                    <span className="hn-dlg-prj-sub hn-dlg-prj-sub--off">tersandar di debog</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="hn-dlg-empty">
                <div>Panggung sunyi — belum ada project di workspace.</div>
                <div>Tambahkan project dan sang dalang mengangkat wayangnya.</div>
              </div>
            )}
          </div>

          <button type="button" className="hn-dlg-cmd" onClick={() => onGoto("terminal")}
            aria-label="Buka terminal — pusat kendali sesi">
            <span className="hn-dlg-mic" aria-hidden="true" />
            <span className="hn-dlg-cmd-t"><b>Perintah dalang</b> — buka Terminal untuk mengarahkan sesi yang berjalan…</span>
            <span className="hn-dlg-cmd-k">Terminal</span>
          </button>
        </div>

        <aside className="hn-dlg-rail">
          <div className="hn-dlg-card">
            <div className="hn-dlg-rt">AKTIVITAS TERAKHIR</div>
            {activity.length === 0
              ? <div className="hn-dlg-mut">Belum ada project.</div>
              : activity.map((a) => (
                <div key={a.id} className="hn-dlg-act">
                  <span className={a.live ? "hn-dlg-dot hn-dlg-dot--on" : "hn-dlg-dot"} />
                  <span className="hn-dlg-act-x"><b>{a.name}</b> {a.text}</span>
                </div>
              ))}
          </div>

          <div className="hn-dlg-card">
            <div className="hn-dlg-rt">DISTRIBUSI BACKLOG</div>
            <div className="hn-dlg-donut-wrap">
              <div className="hn-dlg-donut">
                <svg viewBox="0 0 42 42" width="112" height="112" aria-hidden="true">
                  <circle className="hn-dlg-ring" cx="21" cy="21" r="15.9" strokeWidth="5" />
                  {donut.map((g) => g.frac > 0 && (
                    <circle key={g.key} className={`hn-dlg-seg hn-dlg-seg--${g.cls}`} cx="21" cy="21" r="15.9"
                      strokeWidth="5" strokeDasharray={`${g.frac} ${100 - g.frac}`} strokeDashoffset={g.offset} />
                  ))}
                </svg>
                <div className="hn-dlg-donut-c"><b>{total}</b><span>backlog</span></div>
              </div>
              <div className="hn-dlg-leg">
                {donut.map((g) => (
                  <span key={g.key}><i className={`hn-dlg-seg--${g.cls}`} />{g.label} <b>{g.n}</b></span>
                ))}
              </div>
            </div>
          </div>

          <div className="hn-dlg-card">
            <div className="hn-dlg-rt">DIMULAI · 7 HARI</div>
            <svg viewBox="0 0 260 100" className="hn-dlg-chart" aria-hidden="true">
              <line x1="24" y1="18" x2="252" y2="18" />
              <line x1="24" y1="48" x2="252" y2="48" />
              <line x1="24" y1="78" x2="252" y2="78" />
              <text x="8" y="21">{maxDay}</text>
              <text x="10" y="81">0</text>
              <polyline className="hn-dlg-trend" points={pts} />
              {days.map((d, i) => (
                <circle key={i} cx={32 + i * 35} cy={78 - (d.n / maxDay) * 60} r="2.4" />
              ))}
              {days.map((d, i) => (i % 2 === 0
                ? <text key={`l${i}`} x={22 + i * 35} y="94">{d.label}</text> : null))}
            </svg>
          </div>
        </aside>
      </div>

      <div className="hn-dlg-foot">◈&nbsp;&nbsp;HANOMAN · ORKESTRASI CERDAS · EKSEKUSI SEMPURNA&nbsp;&nbsp;◈</div>
    </div>
  );
}
