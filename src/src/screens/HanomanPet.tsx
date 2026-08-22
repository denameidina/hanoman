import React from "react";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";
import { eventsStatus, subscribeStatus, type EventsStatus } from "../api/events";
import { Button, Mark, useResponsiveTier } from "../ds";
import { useNotifications } from "../notifications/NotificationsContext";
import {
  derivePetState, loadPetHidden, loadPetRoam, savePetHidden, savePetRoam, petPulse,
  KIND_NOUN, POSE_LABEL, waitingSessions, type PetTarget,
} from "./pet-state";
import {
  isUrgent, PET_AWAY_MS, PET_SPEECH_MS, petRecap, petSnapshot, speechFor,
  type PetSnapshot, type PetSpeech,
} from "./pet-speech";
import {
  PET_ATLAS_URL, PET_MANIFEST, POSE_ROW, durationMs, rowIndex, rowOf, thenOf, type PetRowKey,
} from "./pet-sprite";
import { initialWalkState, stepWalk, type PetMove, type PetWalkState } from "./pet-walk";
import { PetAnswer } from "./PetAnswer";

// Tinggi karakter berdiri di layar (band "pet" 80–128 px, amandemen sistem maskot). Skala sel
// diturunkan dari `character.h` manifest, bukan dari tinggi sel — sel menyisakan ruang ekor/lompat.
const PET_HEIGHT: Record<"mobile" | "tablet" | "desktop", number> = { mobile: 96, tablet: 112, desktop: 112 };
// SPEC-763 · hanya 44×44 px di kaki yang menangkap tap; sisa panggung cuma seni.
const HIT = 44;
const PANEL_W = 268;
const PANEL_GAP = 10;
const PANEL_EDGE = 12;
// Lebar terburuk gelembung. Clamp memakainya sebagai lebar, jadi gelembung pendek di dekat tepi
// sedikit lebih ke dalam dari yang perlu — yang tak boleh terjadi adalah terpotong.
const BUBBLE_W = 200;
const BUBBLE_EDGE = 8;
// Socket `events` ditutup saat tab hidden dan baru menyambung saat tab aktif lagi (api/events.ts),
// jadi frame pertama belum tentu sudah tiba pada `visibilitychange`. Snapshot ditahan selama ini,
// bukan dibuang pada render pertama yang datanya masih basi.
const RECAP_GRACE_MS = 5_000;
// SPEC-898 · fps baris `waiting` saat pertanyaannya sudah menua (6 → 9). Digerbangi BARIS, bukan
// pose: `wave`/`thanks` yang menumpang di atasnya tetap berirama normal.
const PET_URGENT_RATE = 1.5;
// SPEC-898 · elus = tiga klik dalam dua detik. Klik ke-3 TIDAK menyentuh panel: itulah isi
// "tidak membuka/menutup panel berulang". Klik pertama & kedua tetap buka lalu tutup — itu
// perilaku normal dua klik dan tak boleh diubah demi easter egg.
const PET_CLICK_WINDOW_MS = 2_000;
const PET_CLICK_BURST = 3;

// jsdom tak punya matchMedia; ketiadaannya dibaca sebagai "tak ada preferensi", bukan "reduce".
function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = React.useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia(query).matches);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

// SPEC-897 · status socket `events` yang sudah ada — pengamat, tak membuka koneksi sendiri.
function useEventsStatus(): EventsStatus {
  const [status, setStatus] = React.useState(eventsStatus);
  React.useEffect(() => {
    setStatus(eventsStatus());   // bisa sudah berubah antara render pertama dan efek ini
    return subscribeStatus(setStatus);
  }, []);
  return status;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = React.useState(() => typeof document !== "undefined" && document.hidden);
  React.useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

// Lebar jalur = lebar viewport; dibaca saat mount dan resize (debounce), bukan per frame.
function useLaneWidth(): number {
  const [width, setWidth] = React.useState(() => (typeof window !== "undefined" ? window.innerWidth : 1024));
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => { clearTimeout(t); t = setTimeout(() => setWidth(window.innerWidth), 150); };
    window.addEventListener("resize", on);
    return () => { clearTimeout(t); window.removeEventListener("resize", on); };
  }, []);
  return width;
}

export function HanomanPet({ sessions, backlog, onOpen }:
  { sessions: TerminalSession[]; backlog: Spec[]; onOpen: (target: PetTarget) => void }) {
  const { items } = useNotifications();
  const [hidden, setHidden] = React.useState(loadPetHidden);
  const [roam, setRoam] = React.useState(loadPetRoam);
  const [open, setOpen] = React.useState(false);
  const [panelMounted, setPanelMounted] = React.useState(false);
  const [panelLeft, setPanelLeft] = React.useState(PANEL_EDGE);
  const [reacting, setReacting] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  // Dinaikkan HANYA oleh `recheckAt`: peluruhan transient, habisnya grace terputus, dan onset
  // tidur — tiga saat keadaan berubah tanpa data baru. Bukan denyut: satu timeout tepat waktu.
  const [decay, setDecay] = React.useState(0);
  // Satu gelembung pada satu waktu; yang baru menggantikan yang lama beserta timer-nya.
  const [speech, setSpeech] = React.useState<(PetSpeech & { id: number }) | null>(null);
  const reduced = usePrefersReducedMotion();
  const tier = useResponsiveTier();
  const documentHidden = useDocumentHidden();
  const laneWidth = useLaneWidth();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const actorRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const connection = useEventsStatus();
  // Denyut kehidupan dashboard; `quietSince` dicap ulang tiap kali ia berubah. Dibandingkan SAAT
  // RENDER (pola "menyesuaikan state ketika prop berubah") supaya tak ada render perantara yang
  // memperlihatkan pet masih tidur satu frame sesudah kabarnya datang.
  const pulse = petPulse(sessions, items);
  const [seenPulse, setSeenPulse] = React.useState(pulse);
  const [quietSince, setQuietSince] = React.useState(() => Date.now());
  if (seenPulse !== pulse) { setSeenPulse(pulse); setQuietSince(Date.now()); }

  const view = React.useMemo(
    () => derivePetState({ sessions, backlog, notifications: items, now: Date.now(), connection, quietSince }),
    [sessions, backlog, items, connection, quietSince, decay]);

  // SPEC-899 · satu kotak jawaban per sesi `waiting`. Daftarnya memakai klasifikasi yang sama
  // dengan panel (`sessionKind`), jadi sesi yang sedang dipegang lead memang tak muncul di sini.
  const waiting = React.useMemo(() => waitingSessions(sessions, backlog), [sessions, backlog]);

  React.useEffect(() => {
    if (view.recheckAt === null) return;
    const t = setTimeout(() => setDecay((n) => n + 1), Math.max(0, view.recheckAt - Date.now()));
    return () => clearTimeout(t);
  }, [view.recheckAt]);

  React.useEffect(() => {
    if (!speech) return;
    const t = setTimeout(() => setSpeech(null), speech.ttl);
    return () => clearTimeout(t);
  }, [speech]);

  // Rekap "selama kamu pergi": snapshot dicap saat tab jadi HIDDEN, dibandingkan saat ia terlihat
  // lagi. Tak ada timer yang berjalan selama tab tersembunyi — di sana browser memang membekukannya.
  const awayRef = React.useRef<PetSnapshot | null>(null);
  const backAtRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    const input = { sessions, backlog, notifications: items, now: Date.now() };
    if (documentHidden) {
      if (!awayRef.current) awayRef.current = petSnapshot(input);
      backAtRef.current = null;
      return;
    }
    const away = awayRef.current;
    if (!away) return;
    if (backAtRef.current === null) backAtRef.current = input.now;
    if (input.now - away.at < PET_AWAY_MS) { awayRef.current = null; return; }
    const recap = petRecap(away, input);
    if (recap) { awayRef.current = null; setSpeech({ ...recap, id: input.now }); return; }
    if (input.now - backAtRef.current > RECAP_GRACE_MS) awayRef.current = null;
  }, [documentHidden, sessions, backlog, items]);

  // Kalimat dibandingkan SAAT RENDER (pola yang sama dengan `seenPulse`): pet bicara saat kabarnya
  // berubah, bukan saat mount, dan `waiting` yang menua dari biasa ke mendesak dihitung sebagai
  // kabar baru — karena itu pembandingnya teks, bukan `kind`.
  const line = speechFor(view, Date.now());
  const [saidLine, setSaidLine] = React.useState<string | null>(line?.text ?? null);
  if ((line?.text ?? null) !== saidLine) {
    setSaidLine(line?.text ?? null);
    if (line) setSpeech({ ...line, id: Date.now() });
  }

  // ---- geometri sprite
  const { cell, columns, anchor, character, rows } = PET_MANIFEST;
  const scale = PET_HEIGHT[tier] / character.h;
  const cellW = Math.round(cell.w * scale);
  const cellH = Math.round(cell.h * scale);

  // ---- mesin berkeliaran: keadaan di ref (dibaca handler), cermin di state (memicu render).
  const walkRef = React.useRef<PetWalkState>(initialWalkState(laneWidth, cellW, Date.now()));
  const [walk, setWalk] = React.useState<PetWalkState>(walkRef.current);
  const [row, setRow] = React.useState<PetRowKey>(POSE_ROW[view.pose]);
  const [move, setMove] = React.useState<PetMove>({ x: walkRef.current.x, durationMs: 0 });

  // Posisi aktual hanya dibaca pada peristiwa (potong/jeda), bukan per frame; jsdom memberi rect
  // nol → pakai posisi keadaan.
  const currentX = React.useCallback((): number => {
    const actor = actorRef.current?.getBoundingClientRect();
    const root = rootRef.current?.getBoundingClientRect();
    return actor && root && actor.width > 0 ? actor.left - root.left : walkRef.current.x;
  }, []);

  // Gelembung hidup DI DALAM actor supaya ia ikut posisi pet tanpa kode posisi; yang dihitung di
  // sini hanya pergeseran agar ia tak keluar viewport saat pet berada di tepi.
  const bubbleLeft = React.useMemo(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : laneWidth;
    const want = move.x + anchor.x * cellW - BUBBLE_W / 2;
    const clamped = Math.min(Math.max(want, BUBBLE_EDGE), Math.max(BUBBLE_EDGE, vw - BUBBLE_W - BUBBLE_EDGE));
    return Math.round(anchor.x * cellW - BUBBLE_W / 2 + (clamped - want));
  }, [move.x, cellW, anchor.x, laneWidth]);

  const tick = React.useCallback(() => {
    const step = stepWalk(walkRef.current, {
      now: Date.now(), currentX: currentX(), laneWidth, petWidth: cellW, pose: view.pose,
      hovered, panelOpen: open, documentHidden, roam, reduced, tier,
    }, Math.random);
    walkRef.current = step.state;
    setWalk(step.state);
    setRow(step.row);
    if (step.move) setMove(step.move);
  }, [currentX, laneWidth, cellW, view.pose, hovered, open, documentHidden, roam, reduced, tier]);

  React.useEffect(() => { tick(); }, [tick]);                       // masukan berubah → langkah
  React.useEffect(() => {                                           // satu timeout pada `until`
    if (!Number.isFinite(walk.until)) return;
    const t = setTimeout(tick, Math.max(0, walk.until - Date.now()));
    return () => clearTimeout(t);
  }, [walk.until, tick]);

  // ---- baris sekali-putar: `wave` (hover/klik) menumpuk di atas baris mesin; `shipped` main
  // sekali lalu `then` sampai pose berganti.
  const [oneShot, setOneShot] = React.useState<{ row: PetRowKey; id: number } | null>(null);
  const clicksRef = React.useRef<number[]>([]);
  const [hearts, setHearts] = React.useState(0);
  const [shippedDone, setShippedDone] = React.useState(false);
  React.useEffect(() => { setShippedDone(false); }, [view.pose]);
  const baseRow: PetRowKey = row === "shipped" && shippedDone ? (thenOf("shipped") ?? "idle") : row;
  const displayRow: PetRowKey = oneShot?.row ?? baseRow;
  const display = rowOf(displayRow);
  // Melambai atas data basi, atau melambai sambil tidur, keduanya berbohong.
  const playWave = React.useCallback(() => {
    if (reduced || view.pose === "offline" || view.pose === "sleeping") return;
    setOneShot((o) => o ?? { row: "wave", id: Date.now() });
  }, [reduced, view.pose]);

  const playThanks = React.useCallback(() => {
    if (reduced) return;
    setOneShot({ row: "thanks", id: Date.now() });   // menggantikan `wave` yang mungkin sedang main
    setHearts((n) => n + 1);
  }, [reduced]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, reduced]);

  React.useEffect(() => {
    if (!reduced) return;
    setReacting(false);
    setOneShot(null);
    if (!open) setPanelMounted(false);
  }, [reduced, open]);

  // React 18 belum mengetik atribut `inert` di HTMLAttributes stabilnya. Menulis atribut DOM
  // menjaga panel yang sedang keluar tetap tak bisa difokuskan tanpa cast prop yang rapuh.
  React.useEffect(() => {
    panelRef.current?.toggleAttribute("inert", !open);
  }, [open, panelMounted]);

  function showPanel() {
    // Dijangkar ke posisi pet SAAT buka; pet berhenti selama panel terbuka (mesin §7), jadi cukup
    // sekali. Di-clamp ke viewport supaya panel di pojok kiri tak terpotong.
    const vw = typeof window !== "undefined" ? window.innerWidth : laneWidth;
    const actor = actorRef.current?.getBoundingClientRect();
    const left = actor && actor.width > 0 ? actor.left : walkRef.current.x;
    const center = left + anchor.x * cellW;
    setPanelLeft(Math.round(Math.min(Math.max(center - PANEL_W / 2, PANEL_EDGE), Math.max(PANEL_EDGE, vw - PANEL_W - PANEL_EDGE))));
    setPanelMounted(true);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    if (reduced) setPanelMounted(false);
  }

  function togglePanel() {
    if (open) closePanel();
    else showPanel();
  }

  function reactAndToggle() {
    const now = Date.now();
    const burst = [...clicksRef.current.filter((at) => now - at < PET_CLICK_WINDOW_MS), now];
    if (burst.length >= PET_CLICK_BURST) {
      clicksRef.current = [];        // satu terima kasih per rentetan
      playThanks();
      return;
    }
    clicksRef.current = burst;
    if (!reduced) setReacting(true);
    playWave();
    togglePanel();
  }

  function setVisibility(next: boolean) {
    setHidden(next);
    savePetHidden(next);
    if (next) {
      setOpen(false);
      setPanelMounted(false);
    }
  }

  function setRoaming(next: boolean) {
    setRoam(next);
    savePetRoam(next);
  }

  // Jalur: selebar viewport di tepi bawah, setinggi satu sel. z 80: di bawah header (90), overlay
  // terminal fullscreen (100), Modal (150), Toast (200). `pointerEvents: none` di seluruh jalur —
  // konten di bawah jalur tetap menerima tap; yang `auto` hanya tombol 44 px, pegangan, dan panel.
  const root: React.CSSProperties = {
    position: "fixed", left: 0, right: 0, bottom: "max(0px, var(--safe-bottom))", height: cellH,
    zIndex: 80, pointerEvents: "none",
  };

  if (hidden) {
    return (
      <div data-testid="pet-root" ref={rootRef} style={root}>
        <button aria-label="Tampilkan pet Hanoman" onClick={() => setVisibility(false)} style={{
          pointerEvents: "auto", position: "absolute", width: 44, height: 44, padding: 0,
          right: "max(22px, var(--safe-right))", bottom: 22,
          display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
          background: "var(--surface-card)", opacity: 0.55, boxShadow: "var(--shadow-sm)",
        }}>
          <Mark id="buntut" size={15} />
        </button>
      </div>
    );
  }

  const offline = view.pose === "offline";
  const status = `Hanoman ${POSE_LABEL[view.pose]} · ${view.headline}`
    + (view.count > 1 ? ` · ${view.count} ${KIND_NOUN[view.kind]}` : "");
  const urgent = displayRow === "waiting" && isUrgent(view, Date.now());
  const frameMs = Math.round(durationMs(displayRow) / (urgent ? PET_URGENT_RATE : 1));
  const frames = reduced
    ? "none"
    : `hn-pet-frames ${frameMs}ms steps(${columns}, end) ${display.loop ? "infinite" : "1 forwards"}`;
  return (
    <div data-testid="pet-root" ref={rootRef} style={root}>
      {panelMounted && (
        <div ref={panelRef} data-testid="pet-panel" aria-hidden={!open || undefined}
          onAnimationEnd={(event) => {
            if (event.animationName === "hn-pet-panel-out" && !open) setPanelMounted(false);
          }} style={{
          pointerEvents: open ? "auto" : "none", position: "absolute", left: panelLeft,
          bottom: cellH + PANEL_GAP, width: PANEL_W,
          maxWidth: "calc(100vw - var(--safe-left) - var(--safe-right) - 24px)",
          maxHeight: "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 120px)",
          overflowY: "auto", boxSizing: "border-box", padding: 14,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
          transformOrigin: "center bottom",
          animation: reduced
            ? "none"
            : `${open ? "hn-pet-panel-in" : "hn-pet-panel-out"} var(--dur-slow) var(--ease-out) both`,
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 8 }}>{POSE_LABEL[view.pose]}</div>
          {/* SELURUH kondisi aktif, tiap baris dengan aksinya sendiri. Puncaknya adalah baris
              pertama dan memakai tipografi headline — blok headline terpisah akan menuliskannya
              dua kali di panel selebar 268 px. */}
          <ul data-testid="pet-conditions" style={{
            listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10,
          }}>
            {view.conditions.map((c, i) => (
              <li key={`${c.kind}:${i}`} data-testid="pet-condition" data-kind={c.kind}
                style={i > 0 ? { borderTop: "1px solid var(--border-hair)", paddingTop: 10 } : undefined}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={i === 0
                    ? { fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600,
                        color: "var(--text-strong)", lineHeight: 1.25 }
                    : { fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600,
                        color: "var(--text-strong)", lineHeight: 1.3 }}>{c.headline}</span>
                  {c.count > 1 && (
                    <span data-testid="pet-condition-count" title={`${c.count} ${KIND_NOUN[c.kind]}`} style={{
                      flex: "0 0 auto", padding: "2px 6px", fontFamily: "var(--font-ui)", fontSize: 11,
                      fontWeight: 700, lineHeight: 1, color: "var(--accent-on)", background: "var(--accent)",
                      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
                    }}>{c.count}</span>
                  )}
                </div>
                <div style={{ marginTop: 3, fontFamily: "var(--font-ui)", fontSize: 12.5,
                  color: "var(--text-muted)", lineHeight: 1.45 }}>{c.detail}</div>
                {c.target && (
                  <div style={{ marginTop: 7 }}>
                    <Button size="sm" variant={i === 0 ? "primary" : "ghost"}
                      leftIcon={c.target.section === "terminal" ? "terminal" : "list-checks"}
                      style={reduced ? { transition: "none", transform: "none" } : undefined}
                      onClick={() => { const target = c.target!; closePanel(); onOpen(target); }}>
                      {c.target.section === "terminal" ? "Buka Terminal" : "Buka Backlog"}
                    </Button>
                  </div>
                )}
                {/* SPEC-899 · inbox keputusan. Digerbangi `open`, bukan `panelMounted`: panel yang
                    sedang beranimasi keluar masih ter-mount, dan kotak yang lahir di sana akan
                    memanggil endpoint dialog untuk panel yang justru sedang ditutup. */}
                {c.kind === "waiting" && open && waiting.map((s) => (
                  <PetAnswer key={s.id} sessionId={s.id} label={s.specId ?? s.id} reduced={reduced} />
                ))}
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12,
            borderTop: "1px solid var(--border-hair)", paddingTop: 10 }}>
            {tier !== "mobile" && (
              <Button size="sm" variant="ghost"
                style={reduced ? { transition: "none", transform: "none" } : undefined}
                onClick={() => setRoaming(!roam)}>{roam ? "Diam di pojok" : "Berkeliaran"}</Button>
            )}
            <Button size="sm" variant="ghost"
              style={reduced ? { transition: "none", transform: "none" } : undefined}
              onClick={() => setVisibility(true)}>Sembunyikan</Button>
          </div>
        </div>
      )}
      <div data-testid="pet-actor" ref={actorRef} data-facing={walk.facing} data-mode={walk.mode}
        onTransitionEnd={(event) => { if (event.propertyName === "transform") tick(); }} style={{
          position: "absolute", left: 0, bottom: 0, width: cellW, height: cellH,
          transform: `translateX(${move.x}px)`,
          transition: reduced || move.durationMs === 0 ? "none" : `transform ${move.durationMs}ms linear`,
          willChange: "transform",
        }}>
        {speech && !open && (
          <div data-testid="pet-bubble" data-kind={speech.kind}
            aria-hidden={speech.kind === "pose" ? "true" : undefined} style={{
            pointerEvents: "none", position: "absolute", left: bubbleLeft, bottom: cellH - 6,
            width: "max-content", maxWidth: BUBBLE_W, boxSizing: "border-box", padding: "6px 10px",
            fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.35,
            color: "var(--text-strong)", background: "var(--surface-card)",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-sm)",
            animation: reduced ? "none" : "hn-pet-bubble-in var(--dur-base) var(--ease-out) both",
          }}>
            {speech.text}
            {speech.kind === "recap" && (
              // Satu-satunya hit area tambahan di jalur pet, dan ia transient: kelas yang sama
              // dengan panel, bukan pelebaran badan pet (SPEC-763).
              <div style={{ marginTop: 6, pointerEvents: "auto" }}>
                <Button size="sm" variant="ghost" leftIcon="list-checks"
                  aria-label={`${speech.text} — buka ringkasan pet`}
                  style={reduced ? { transition: "none", transform: "none" } : undefined}
                  onClick={() => { setSpeech(null); showPanel(); }}>Lihat</Button>
              </div>
            )}
          </div>
        )}
        {/* Live region membungkus kalimat status + panggung; atlas berisi 80 frame sehingga tak bisa
            diberi alt bermakna — kalimatnya hidup di span visually-hidden, satu sumber. */}
        <div data-testid="pet-stage" role="status" aria-live="polite"
          className="hn-pet-stage" data-reduced-motion={reduced ? "true" : undefined} style={{
            position: "relative", width: cellW, height: cellH,
            animation: reduced ? "none" : "hn-pet-reveal var(--dur-slow) var(--ease-out) both",
          }}>
          <span className="hn-sr-only" data-testid="pet-status">{status}</span>
          {view.count > 1 && (
            <span data-testid="pet-badge" aria-hidden="true" title={`${view.count} ${KIND_NOUN[view.kind]}`}
              style={{
                pointerEvents: "none", position: "absolute", top: 4, right: 8, zIndex: 2,
                minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700, lineHeight: 1,
                color: "var(--accent-on)", background: "var(--accent)",
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
                boxShadow: "var(--shadow-sm)",
              }}>{view.count}</span>
          )}
          {hearts > 0 && !reduced && (
            <span data-testid="pet-hearts" key={hearts} aria-hidden="true" style={{
              pointerEvents: "none", position: "absolute", zIndex: 2,
              left: Math.round(anchor.x * cellW), bottom: Math.round(cellH * 0.55),
            }} onAnimationEnd={(event) => {
              if ((event.target as HTMLElement).dataset.last === "1") setHearts(0);
            }}>
              {[0, 1, 2].map((i) => (
                <span key={i} data-last={i === 2 ? "1" : undefined} style={{
                  position: "absolute", left: i * 9 - 9, fontFamily: "var(--font-ui)", fontSize: 12,
                  color: "var(--accent)",
                  animation: `hn-pet-heart 900ms var(--ease-out) ${i * 120}ms both`,
                }}>♥</span>
              ))}
            </span>
          )}
          <div data-testid="pet-reactor" className="hn-pet-reactor" style={{
            position: "relative", width: "100%", height: "100%",
            transition: reduced ? "none" : "transform var(--dur-base) var(--ease-out)",
            animation: reduced || !reacting
              ? "none"
              : "hn-pet-click var(--dur-slow) var(--ease-out) both",
          }} onAnimationEnd={(event) => {
            if (event.animationName === "hn-pet-click") setReacting(false);
          }}>
            {/* Pudar duduk DI SINI, bukan di pet-stage: stage memakai `hn-pet-reveal … both`, dan
                `animation-fill-mode: forwards` menang atas `opacity` inline — fade di sana akan
                diam-diam tak berpengaruh. */}
            <div data-testid="pet-viewport" data-offline={offline ? "true" : undefined} style={{
              position: "relative", overflow: "hidden", width: cellW, height: cellH,
              opacity: offline ? 0.45 : 1,
              transition: reduced ? "none" : "opacity var(--dur-slow) var(--ease-out)",
            }}>
              <div data-testid="pet-rowshift" className="hn-pet-rowshift" data-row={displayRow}
                style={{ width: cellW, height: cellH, ["--row" as string]: rowIndex(displayRow) } as React.CSSProperties}>
                <img data-testid="pet-atlas" key={`${displayRow}:${oneShot?.id ?? 0}`}
                  src={PET_ATLAS_URL} alt="" aria-hidden="true" draggable={false} decoding="async"
                  onAnimationEnd={(event) => {
                    if (event.animationName !== "hn-pet-frames") return;
                    if (oneShot) { setOneShot(null); return; }
                    if (displayRow === "shipped") setShippedDone(true);
                  }}
                  style={{
                    display: "block", width: cellW * columns, height: cellH * rows.length,
                    animation: frames, willChange: "transform",
                  }} />
              </div>
            </div>
          </div>
          <button data-testid="pet-hit" aria-label="Ringkasan status Hanoman" title={`${view.headline} — ${view.detail}`}
            onClick={reactAndToggle}
            onPointerEnter={() => { setHovered(true); playWave(); }}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            style={{
              pointerEvents: "auto", position: "absolute", zIndex: 3,
              left: Math.round(anchor.x * cellW - HIT / 2), bottom: 0, width: HIT, height: HIT,
              padding: 0, border: "none", background: "transparent", cursor: "pointer",
            }} />
        </div>
      </div>
    </div>
  );
}
