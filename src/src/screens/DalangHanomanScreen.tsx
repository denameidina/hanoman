/* DalangHanomanScreen — panggung orkestrasi sinematik (menu Dalang Hanoman), dipulihkan dari 8380d3fa
   atas keputusan pemilik (ADR-0219, mengamandemen ADR-0208). Takeover layar penuh tanpa Shell: satu-satunya
   layar gelap penuh (pengecualian ADR-0208, kerja aktif). Sumber hidup = `sessions` WS dan status socket
   nyata (`useEventsStatus`), bukan ProjectView.session yang basi. Murni presentasi, nol fetch baru.
   Ticker mengetik dan jam hidup di komponen anak ber-state sendiri (React.memo), supaya tiap tikNya tak
   me-render ulang layar induk. Reduced-motion mematikan ticker dan hitungan naik. Gaya di
   screens/styles/dalang.css; tanpa warna literal dan tanpa inline style statis. */
import React from "react";
import { Icon } from "../ds";
import type { TerminalSession } from "../api/client";
import type { ProjectVM, SpecSlim } from "./types";
import { WayangSilhouette } from "./WayangSilhouette";
import { FLOW_LABEL, STAGE_LABEL, labelOf } from "../lib/labels";
import { useEventsStatus } from "../api/live";
// Hero dirakit dari 5 bagian ber-sendi (rig sheet Codex): badan + 4 lengan berputar di cakram pivot
// bahunya masing-masing. Aset dibundel lewat `?url` (Vite mengeluarkannya ke dist, ikut paket npm web/).
import rigBodyUrl from "../../../internal/assets/dalang/hnm-hero-rig-body-v01.webp?url";
import rigArmUlUrl from "../../../internal/assets/dalang/hnm-hero-rig-arm-ul-v01.webp?url";
import rigArmUrUrl from "../../../internal/assets/dalang/hnm-hero-rig-arm-ur-v01.webp?url";
import rigArmMlUrl from "../../../internal/assets/dalang/hnm-hero-rig-arm-ml-v01.webp?url";
import rigArmMrUrl from "../../../internal/assets/dalang/hnm-hero-rig-arm-mr-v01.webp?url";
import blencongUrl from "../../../internal/assets/dalang/hnm-blencong-v01.webp?url";
// Empat varian wayang sinematik (aset GPT Image via Codex, benang gantung di puncak). Tiap project
// mendapat tokohnya sendiri lewat hash stabil dari id.
import wayangAlusUrl from "../../../internal/assets/dalang/hnm-wayang-satria-alus-v01.webp?url";
import wayangGagahUrl from "../../../internal/assets/dalang/hnm-wayang-satria-gagah-v01.webp?url";
import wayangPutriUrl from "../../../internal/assets/dalang/hnm-wayang-putri-v01.webp?url";
import wayangPanakawanUrl from "../../../internal/assets/dalang/hnm-wayang-panakawan-v01.webp?url";
import "./styles/dalang.css";

const WAYANG = [wayangAlusUrl, wayangGagahUrl, wayangPutriUrl, wayangPanakawanUrl];
const wayangFor = (id: string): string =>
  WAYANG[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % WAYANG.length]!;

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Batas hari LOKAL, komponen-per-komponen. `new Date("YYYY-MM-DD")` adalah tengah malam UTC dan
 *  menggeser hari di WIB (gotcha ADR-0090/0105). */
export function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// Menunggu manusia: cermin pet-state.ts dan Terminal (decision && !deciding).
const isWaiting = (s: TerminalSession) => !!s.decision && !s.deciding;

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
function readReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(REDUCE_QUERY).matches;
}
/** Preferensi gerak sistem; ikut berubah bila pengguna mengganti pengaturannya saat layar terbuka. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(readReducedMotion);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REDUCE_QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Hitungan naik sekali saat berubah (900 ms); reduced-motion langsung ke nilai akhir. */
function useCountUp(target: number, reduced: boolean): number {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    if (reduced) return;
    const t0 = performance.now();
    const T = 900;
    let raf = 0;
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / T);
      setV(Math.round(target * (1 - Math.pow(1 - f, 3))));
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return reduced ? target : v;
}

/* Ticker boot ala JARVIS: mengetik satu baris, jeda, lalu baris berikut. State-nya milik komponen ini
   saja: tiap ketukan (26 ms) hanya komponen ini yang me-render. Perbandingan memo memakai isi baris,
   bukan referensi array, sehingga induk yang render ulang tak memicu ketikan dari awal. */
const sameLines = (a: { lines: string[]; reduced: boolean }, b: { lines: string[]; reduced: boolean }) =>
  a.reduced === b.reduced && a.lines.join("\n") === b.lines.join("\n");

const BootTicker = React.memo(function BootTicker({ lines, reduced }: { lines: string[]; reduced: boolean }) {
  const [text, setText] = React.useState("");
  const key = lines.join("\n");
  React.useEffect(() => {
    if (reduced || lines.length === 0) return;
    let idx = 0;
    let i = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let hold: ReturnType<typeof setTimeout> | null = null;
    const type = () => {
      const line = lines[idx % lines.length] ?? "";
      i = 0;
      timer = setInterval(() => {
        i++;
        setText(line.slice(0, i));
        if (i >= line.length && timer) {
          clearInterval(timer);
          timer = null;
          hold = setTimeout(() => { idx++; type(); }, 3200);
        }
      }, 26);
    };
    type();
    return () => {
      if (timer) clearInterval(timer);
      if (hold) clearTimeout(hold);
    };
    // `lines` dijaga oleh `key` (isi, bukan referensi).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);
  // Reduced-motion: baris pertama tampil utuh dan statis, tanpa ketikan.
  return (
    <p className="hn-dlg-boot" aria-live="off">
      {reduced ? (lines[0] ?? "") : text}
    </p>
  );
}, sameLines);

/* Jam per detik: satu interval di komponen ini saja. Tanpa props, jadi induk tak pernah memaksanya render. */
const DalangClock = React.memo(function DalangClock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="hn-dlg-clock" aria-hidden="true">
      <span className="hn-dlg-chip"><Icon name="calendar-clock" size={13} />{now.getDate()} {BULAN[now.getMonth()]} {now.getFullYear()}</span>
      <span className="hn-dlg-chip"><Icon name="history" size={13} />{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>
    </span>
  );
});

/** Satu KPI; hitungannya naik sendiri, tak memaksa induk render ulang. */
const Kpi = React.memo(function Kpi({ icon, tone, label, value, sub, reduced }: {
  icon: string; tone: string; label: string; value: number; sub: string; reduced: boolean;
}) {
  const n = useCountUp(value, reduced);
  return (
    <div className="hn-dlg-kpi">
      <span className={`hn-dlg-kpi-ic hn-dlg-tone-${tone}`}><Icon name={icon} size={17} /></span>
      <span className="hn-dlg-kpi-body">
        <span className="hn-dlg-kpi-l">{label}</span>
        <span className="hn-dlg-kpi-v">{n}</span>
        <span className="hn-dlg-kpi-s">{sub}</span>
      </span>
    </div>
  );
});

/** Baris "Menunggu jawabanmu": satu sesi, satu tombol Jawab (ringkas, di atas). */
function WaitRow({ name, fase, sesi, onClick }: { name: string; fase: string; sesi: string; onClick: () => void }) {
  return (
    <button type="button" className="hn-dlg-row" onClick={onClick}>
      <span className="hn-dlg-glyph" aria-hidden="true">
        <WayangSilhouette height={24} color="var(--amber-500)" rod="var(--brass-300)" />
      </span>
      <span className="hn-dlg-name">{name}</span>
      <span className="hn-dlg-fase">{fase}</span>
      {sesi && <span className="hn-dlg-sesi">{sesi}</span>}
      <span className="hn-dlg-aksi">Jawab</span>
    </button>
  );
}

/** Status koneksi nyata dari socket (bukan teks tetap). */
function linkState(connected: boolean, paused: boolean): { tone: "ok" | "idle" | "err"; text: string } {
  if (connected) return { tone: "ok", text: "Terhubung" };
  if (paused) return { tone: "idle", text: "Jeda · tab tersembunyi" };
  return { tone: "err", text: "Koneksi terputus · menyambung ulang" };
}

export function DalangHanomanScreen({ projects, backlog, sessions, onOpenSession, onOpenProject, onGoto, onExit, previous }: {
  projects: ProjectVM[]; backlog: SpecSlim[]; sessions: TerminalSession[];
  onOpenSession: (id: string) => void; onOpenProject: (p: ProjectVM) => void;
  onGoto: (s: string) => void; onExit: () => void;
  /** Layar sebelumnya yang dituju tombol keluar dan Esc (ADR-0208 § 2). Tanpa ini keluar = `onExit`. */
  previous?: { label: string; onBack: () => void };
}) {
  const events = useEventsStatus();
  const reduced = useReducedMotion();
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
  const parked = projects.filter((p) => !liveProjects.has(p.id));
  const specById = new Map(backlog.map((s) => [s.id, s] as const));
  const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
  const nameOf = (projectId: string) => nameById.get(projectId) ?? projectId;
  const faseOf = (s: TerminalSession) => {
    const spec = s.specId ? specById.get(s.specId) : undefined;
    return spec ? labelOf(STAGE_LABEL, spec.stage) : s.flow ? labelOf(FLOW_LABEL, s.flow) : "Sesi terminal";
  };
  const subOf = (s: TerminalSession) => {
    if (isWaiting(s)) return "menunggu jawabanmu";
    const spec = s.specId ? specById.get(s.specId) : undefined;
    return spec ? `${spec.id} · ${labelOf(STAGE_LABEL, spec.stage)}` : (s.flow ? labelOf(FLOW_LABEL, s.flow) : "sesi terminal");
  };

  const startedToday = backlog.filter((s) => isToday(s.startedAt)).length;
  const waitingN = waiting.length;
  const link = linkState(events.connected, events.paused);
  // Ticker hanya memuat hal yang diketahui benar. "Online" hanya saat socket terhubung; tanpa yang
  // menunggu, ditulis apa adanya, bukan "semua sistem normal" yang tak pernah diukur.
  const bootLines = [
    events.connected
      ? `HANOMAN ONLINE · ${live.length > 0 ? `${live.length} SESI HIDUP` : "KELIR SUNYI"}`
      : events.paused ? "JEDA · TAB TERSEMBUNYI" : "KONEKSI TERPUTUS · MENYAMBUNG ULANG",
    `${startedToday} TASK DIKERJAKAN HARI INI`,
    waitingN > 0 ? `${waitingN} SESI MENUNGGU JAWABANMU` : "TIDAK ADA YANG MENUNGGU JAWABANMU",
    `${projects.length} PROYEK DALAM PANTAUAN`,
  ];
  const summary = [
    live.length === 0 ? "Tidak ada sesi berjalan" : `${live.length} sesi berjalan`,
    waitingN > 0 ? `${waitingN} menunggu jawabanmu` : null,
    `${projects.length} project`,
  ].filter(Boolean).join(" · ");

  // Distribusi backlog per stage: data nyata untuk donut (r=15.9 → keliling ≈ 100 unit).
  // Kosakata zStage dirangkum ke empat fase yang terbaca operator.
  const stageN = { done: 0, executing: 0, planned: 0, spec: 0 };
  for (const s of backlog) {
    if (s.stage === "done") stageN.done++;
    else if (s.stage === "executing") stageN.executing++;
    else if (s.stage === "planned") stageN.planned++;
    else stageN.spec++;
  }
  const total = backlog.length;
  const segs: { key: keyof typeof stageN; cls: string; label: string }[] = [
    { key: "executing", cls: "executing", label: "Execute" },
    { key: "done", cls: "done", label: "Done" },
    { key: "planned", cls: "planned", label: "Plan" },
    { key: "spec", cls: "spec", label: "Spec" },
  ];
  const donut = segs.map((g) => ({ ...g, n: stageN[g.key], frac: total ? (stageN[g.key] / total) * 100 : 0 }));
  // Cincin donat = conic-gradient dari persentase nyata, lewat CSS-var (dinamis). Bukan svg: axe menganggap
  // svg sebagai gambar dan melaporkan kontras teks di atasnya sebagai "tak bisa ditentukan".
  const SEG_TOKEN: Record<string, string> = {
    executing: "var(--wind-500)", done: "var(--leaf-500)", planned: "var(--amber-500)", spec: "var(--brass-400)",
  };
  let acc = 0;
  const stops = donut.filter((g) => g.frac > 0).map((g) => {
    const from = acc;
    acc += g.frac;
    return `${SEG_TOKEN[g.cls]} ${from}% ${acc}%`;
  });
  const donutBg = stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(var(--term-line) 0% 100%)";

  // Produktivitas 7 hari: berapa item mulai dikerjakan per hari LOKAL.
  const now = new Date();
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

  // Benang gapit ke SEMUA wayang: yang hidup = emas mengalir, yang diam = benang kendur redup.
  // Diukur dari layout nyata; jsdom memberi rect 0, jadi benangnya kosong di sana.
  const threadKey = `${live.map((s) => s.id).join("|")}#${parked.map((p) => p.id).join("|")}`;
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [threads, setThreads] = React.useState<{ d: string; slack: boolean }[]>([]);
  React.useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || (live.length === 0 && parked.length === 0)) { setThreads([]); return; }
    const measure = () => {
      const host = el.getBoundingClientRect();
      if (host.width < 60) return;
      const art = el.querySelector<HTMLElement>(".hn-dlg-hero-art")?.getBoundingClientRect();
      const cx = art ? art.left + art.width / 2 - host.left : host.width / 2;
      // Jangkar = gapit di tiap tangan rig: lengan ATAS memainkan wayang hidup, lengan TENGAH
      // (menjuntai) memegangi wayang diam.
      const hands: Record<string, { x: number; y: number }> = {};
      el.querySelectorAll<HTMLElement>("[data-hand]").forEach((h) => {
        const r = h.getBoundingClientRect();
        hands[h.dataset.hand ?? ""] = { x: r.left + r.width / 2 - host.left, y: r.top + r.height / 2 - host.top };
      });
      const fallback = { x: cx, y: art ? art.top - host.top + art.height * 0.36 : host.height * 0.35 };
      const ds: { d: string; slack: boolean }[] = [];
      el.querySelectorAll<HTMLElement>(".hn-dlg-prj").forEach((c) => {
        // Ujung benang = puncak WAYANG-nya, bukan tepi kartu.
        const img = c.querySelector<HTMLElement>(".hn-dlg-puppet img") ?? c;
        const r = img.getBoundingClientRect();
        const tx = r.left + r.width / 2 - host.left;
        const ty = r.top - host.top + 1;
        const slack = !c.hasAttribute("data-puppet");
        const side = tx < cx ? "l" : "r";
        const hand = hands[(slack ? "m" : "u") + side] ?? fallback;
        // Benang kendur melengkung ke BAWAH (beban wayang diam); benang hidup tegang ke atas.
        const my = slack ? Math.max(hand.y, ty) + 26 : Math.min(hand.y, ty) - 16;
        ds.push({
          d: `M ${hand.x.toFixed(1)} ${hand.y.toFixed(1)} Q ${((hand.x + tx) / 2).toFixed(1)} ${my.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`,
          slack,
        });
      });
      setThreads(ds);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [threadKey, live.length, parked.length]);

  const activity = projects.slice(0, 6).map((p) => ({
    id: p.id, name: p.name, text: p.activity, live: liveProjects.has(p.id),
  }));

  return (
    // Takeover tanpa Shell: `main` memberi landmark (axe region) untuk seluruh isi layar.
    <main className="hn-dlg" aria-label="Dalang Hanoman">
      <header className="hn-dlg-top">
        <div className="hn-dlg-brand">
          <img className="hn-dlg-blencong" src={blencongUrl} alt="" aria-hidden="true"
            data-lit={live.length > 0 || undefined} />
          <div className="hn-dlg-head">
            <h2 className="hn-dlg-title">Dalang Hanoman</h2>
            <BootTicker lines={bootLines} reduced={reduced} />
            <p className="hn-dlg-summary">{summary}</p>
            <p className={`hn-dlg-link hn-dlg-link--${link.tone}`} role="status">
              <span className="hn-dlg-dot" aria-hidden="true" />{link.text}
            </p>
          </div>
        </div>
        <div className="hn-dlg-bar">
          <DalangClock />
          {/* Jalan keluar selalu 44×44 di semua ukuran layar (sentuh); ✕ atau panah kembali. */}
          <button type="button" className="hn-dlg-exit" onClick={leave}
            aria-label={previous ? `Kembali ke ${previous.label}` : "Keluar dari panggung (Esc)"}
            title={previous ? `Kembali ke ${previous.label}` : "Keluar dari panggung (Esc)"}>
            <Icon name={previous ? "arrow-left" : "x"} size={18} />
          </button>
        </div>
      </header>

      {waiting.length > 0 && (
        <section className="hn-dlg-section hn-dlg-section--wait" aria-labelledby="dlg-wait">
          <h3 id="dlg-wait" className="hn-dlg-rt">Menunggu jawabanmu</h3>
          <ul className="hn-dlg-list">
            {waiting.map((s) => (
              <li key={s.id}>
                <WaitRow name={nameOf(s.projectId)} fase={faseOf(s)} sesi={s.specId ?? ""}
                  onClick={() => onOpenSession(s.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="hn-dlg-kpis">
        <Kpi icon="layout-grid" tone="proyek" label="TOTAL PROYEK" value={projects.length} sub="dalam pantauan" reduced={reduced} />
        <Kpi icon="check-circle-2" tone="hari" label="TASK HARI INI" value={startedToday} sub="mulai dikerjakan" reduced={reduced} />
        <Kpi icon="activity" tone="sesi" label="SESI BERJALAN" value={live.length} sub="wayang dimainkan" reduced={reduced} />
        <Kpi icon="hand" tone="tunggu" label="MENUNGGU KAMU" value={waitingN} sub="butuh keputusan" reduced={reduced} />
      </div>

      <div className="hn-dlg-grid">
        <div className="hn-dlg-main">
          <div className="hn-dlg-hero" ref={stageRef}>
            <svg className="hn-dlg-hud" viewBox="0 0 330 330" aria-hidden="true" focusable="false">
              <g className="hn-dlg-hud-a"><circle cx="165" cy="165" r="150" strokeDasharray="3 14" /></g>
              <g className="hn-dlg-hud-b"><circle cx="165" cy="165" r="126" strokeDasharray="40 22" /></g>
            </svg>
            {threads.length > 0 && (
              <svg className="hn-dlg-threads" aria-hidden="true" focusable="false">
                {threads.map((t, i) => (
                  <path key={i} d={t.d} className={t.slack ? "hn-dlg-thread--slack" : undefined}
                    style={t.slack ? undefined : { "--d": `${(i % 6) * 0.3}s` } as React.CSSProperties} />
                ))}
              </svg>
            )}
            <div className="hn-dlg-scan" aria-hidden="true" />
            <div className="hn-dlg-hero-art" aria-hidden="true">
              <img className="hn-dlg-rig-arm hn-dlg-rig-arm--ul" src={rigArmUlUrl} alt="" />
              <img className="hn-dlg-rig-arm hn-dlg-rig-arm--ur" src={rigArmUrUrl} alt="" />
              <img className="hn-dlg-rig-arm hn-dlg-rig-arm--ml" src={rigArmMlUrl} alt="" />
              <img className="hn-dlg-rig-arm hn-dlg-rig-arm--mr" src={rigArmMrUrl} alt="" />
              <img className="hn-dlg-rig-body" src={rigBodyUrl} alt="" />
              {/* Jangkar benang = posisi gapit di tiap tangan (diukur dari rig sheet). */}
              <span className="hn-dlg-hand" data-hand="ul" />
              <span className="hn-dlg-hand" data-hand="ur" />
              <span className="hn-dlg-hand" data-hand="ml" />
              <span className="hn-dlg-hand" data-hand="mr" />
            </div>
            {projects.length === 0 ? (
              <div className="hn-dlg-empty">
                <div>Panggung sunyi — belum ada project di workspace.</div>
                <div className="hn-dlg-empty-hint">Tambahkan project dan sang dalang mengangkat wayangnya.</div>
              </div>
            ) : (
              <ul className="hn-dlg-cards" aria-label="Wayang project">
                {live.map((s, i) => {
                  const name = nameOf(s.projectId);
                  const waits = isWaiting(s);
                  return (
                    <li key={s.id}>
                      <button type="button" className="hn-dlg-prj" data-puppet
                        data-waiting={waits || undefined}
                        onClick={() => onOpenSession(s.id)}
                        aria-label={`Buka terminal — ${name}, ${subOf(s)}`}>
                        <span className={waits ? "hn-dlg-puppet hn-dlg-puppet--still" : "hn-dlg-puppet"}
                          style={{ "--d": `${(i % 6) * 0.6}s` } as React.CSSProperties}>
                          <img src={wayangFor(s.projectId)} alt="" aria-hidden="true" />
                        </span>
                        <span className="hn-dlg-prj-name">{name}</span>
                        <span className={waits ? "hn-dlg-prj-sub hn-dlg-prj-sub--amber" : "hn-dlg-prj-sub"}>{subOf(s)}</span>
                      </button>
                    </li>
                  );
                })}
                {/* Semua project tampil; yang tanpa sesi hidup jadi wayang redup tersandar. */}
                {parked.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="hn-dlg-prj hn-dlg-prj--off" onClick={() => onOpenProject(p)}
                      aria-label={`Buka project ${p.name}`}>
                      <span className="hn-dlg-puppet hn-dlg-puppet--still">
                        <img src={wayangFor(p.id)} alt="" aria-hidden="true" />
                      </span>
                      <span className="hn-dlg-prj-name">{p.name}</span>
                      <span className="hn-dlg-prj-sub hn-dlg-prj-sub--off">tersandar di debog</span>
                    </button>
                  </li>
                ))}
              </ul>
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
                  <span className={a.live ? "hn-dlg-dot2 hn-dlg-dot2--on" : "hn-dlg-dot2"} />
                  <span className="hn-dlg-act-x"><b>{a.name}</b> {a.text}</span>
                </div>
              ))}
          </div>

          <div className="hn-dlg-card">
            <div className="hn-dlg-rt">DISTRIBUSI BACKLOG</div>
            <div className="hn-dlg-donut-wrap">
              <div className="hn-dlg-donut" style={{ "--donut": donutBg } as React.CSSProperties}>
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
            {/* Data grafik dibacakan lewat teks tersembunyi visual; SVG-nya dekoratif. */}
            <p className="hn-sr-only">Item mulai dikerjakan, 7 hari terakhir: {days.map((d) => `${d.label} ${d.n}`).join(", ")}</p>
            {/* Label sumbu di HTML, di luar kotak SVG (SVG hanya garis dan titik): lihat catatan di dalang.css. */}
            <div className="hn-dlg-chart-box">
              <div className="hn-dlg-chart-y" aria-hidden="true">
                <span style={{ "--y": "18%" } as React.CSSProperties}>{maxDay}</span>
                <span style={{ "--y": "78%" } as React.CSSProperties}>0</span>
              </div>
              <svg viewBox="0 0 280 100" className="hn-dlg-chart" aria-hidden="true" focusable="false">
                <line x1="24" y1="18" x2="252" y2="18" />
                <line x1="24" y1="48" x2="252" y2="48" />
                <line x1="24" y1="78" x2="252" y2="78" />
                <polyline className="hn-dlg-trend" points={pts} />
                {days.map((d, i) => (
                  <circle key={i} cx={32 + i * 35} cy={78 - (d.n / maxDay) * 60} r="2.4" />
                ))}
              </svg>
              <div className="hn-dlg-chart-x" aria-hidden="true">
                {days.map((d, i) => (i % 2 === 0
                  ? <span key={i} style={{ "--x": `${((22 + i * 35) / 280) * 100}%` } as React.CSSProperties}>{d.label}</span>
                  : null))}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <footer className="hn-dlg-foot">
        <span aria-hidden="true">◈</span>&nbsp;&nbsp;HANOMAN · ORKESTRASI CERDAS · EKSEKUSI SEMPURNA&nbsp;&nbsp;<span aria-hidden="true">◈</span>
      </footer>
    </main>
  );
}
