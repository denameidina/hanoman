import React from "react";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";
import { Button, Mark, useResponsiveTier } from "../ds";
import { useNotifications } from "../notifications/NotificationsContext";
import {
  derivePetState, loadPetHidden, loadPetRoam, savePetHidden, savePetRoam,
  POSE_LABEL, type PetTarget,
} from "./pet-state";
import {
  PET_ATLAS_URL, PET_MANIFEST, POSE_ROW, durationMs, rowIndex, rowOf, thenOf, type PetRowKey,
} from "./pet-sprite";
import { initialWalkState, stepWalk, type PetMove, type PetWalkState } from "./pet-walk";

// Tinggi karakter berdiri di layar (band "pet" 80–128 px, amandemen sistem maskot). Skala sel
// diturunkan dari `character.h` manifest, bukan dari tinggi sel — sel menyisakan ruang ekor/lompat.
const PET_HEIGHT: Record<"mobile" | "tablet" | "desktop", number> = { mobile: 96, tablet: 112, desktop: 112 };
// SPEC-763 · hanya 44×44 px di kaki yang menangkap tap; sisa panggung cuma seni.
const HIT = 44;
const PANEL_W = 268;
const PANEL_GAP = 10;
const PANEL_EDGE = 12;

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
  // Dinaikkan HANYA oleh peluruhan keadaan transient — satu-satunya perubahan pose yang tak dibawa
  // data baru. Bukan denyut: tak ada interval, hanya satu timeout tepat pada waktunya.
  const [decay, setDecay] = React.useState(0);
  const reduced = usePrefersReducedMotion();
  const tier = useResponsiveTier();
  const documentHidden = useDocumentHidden();
  const laneWidth = useLaneWidth();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const actorRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const view = React.useMemo(
    () => derivePetState({ sessions, backlog, notifications: items, now: Date.now() }),
    [sessions, backlog, items, decay]);

  React.useEffect(() => {
    if (view.transientUntil === null) return;
    const t = setTimeout(() => setDecay((n) => n + 1), Math.max(0, view.transientUntil - Date.now()));
    return () => clearTimeout(t);
  }, [view.transientUntil]);

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
  const [shippedDone, setShippedDone] = React.useState(false);
  React.useEffect(() => { setShippedDone(false); }, [view.pose]);
  const baseRow: PetRowKey = row === "shipped" && shippedDone ? (thenOf("shipped") ?? "idle") : row;
  const displayRow: PetRowKey = oneShot?.row ?? baseRow;
  const display = rowOf(displayRow);
  const playWave = React.useCallback(() => {
    if (reduced) return;
    setOneShot((o) => o ?? { row: "wave", id: Date.now() });
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

  const status = `Hanoman ${POSE_LABEL[view.pose]} · ${view.headline}`;
  const frames = reduced
    ? "none"
    : `hn-pet-frames ${durationMs(displayRow)}ms steps(${columns}, end) ${display.loop ? "infinite" : "1 forwards"}`;
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
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{POSE_LABEL[view.pose]}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600,
            color: "var(--text-strong)", lineHeight: 1.25 }}>{view.headline}</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-ui)", fontSize: 12.5,
            color: "var(--text-muted)", lineHeight: 1.45 }}>{view.detail}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <Button size="sm" leftIcon={view.target.section === "terminal" ? "terminal" : "list-checks"}
              style={reduced ? { transition: "none", transform: "none" } : undefined}
              onClick={() => { closePanel(); onOpen(view.target); }}>
              {view.target.section === "terminal" ? "Buka Terminal" : "Buka Backlog"}
            </Button>
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
        {/* Live region membungkus kalimat status + panggung; atlas berisi 80 frame sehingga tak bisa
            diberi alt bermakna — kalimatnya hidup di span visually-hidden, satu sumber. */}
        <div data-testid="pet-stage" role="status" aria-live="polite"
          className="hn-pet-stage" data-reduced-motion={reduced ? "true" : undefined} style={{
            position: "relative", width: cellW, height: cellH,
            animation: reduced ? "none" : "hn-pet-reveal var(--dur-slow) var(--ease-out) both",
          }}>
          <span className="hn-sr-only" data-testid="pet-status">{status}</span>
          <div data-testid="pet-reactor" className="hn-pet-reactor" style={{
            position: "relative", width: "100%", height: "100%",
            transition: reduced ? "none" : "transform var(--dur-base) var(--ease-out)",
            animation: reduced || !reacting
              ? "none"
              : "hn-pet-click var(--dur-slow) var(--ease-out) both",
          }} onAnimationEnd={(event) => {
            if (event.animationName === "hn-pet-click") setReacting(false);
          }}>
            <div data-testid="pet-viewport" style={{ position: "relative", overflow: "hidden", width: cellW, height: cellH }}>
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
