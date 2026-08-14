import React from "react";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";
import { Button, Mark, StickerIllustration } from "../ds";
import { useNotifications } from "../notifications/NotificationsContext";
import {
  derivePetState, loadPetHidden, savePetHidden,
  POSE_ART, POSE_LABEL, type PetPose, type PetTarget,
} from "./pet-state";
import { motionForPose } from "./pet-motion";

const SIZE = 76;
// SPEC-763 · pet melayang `fixed` di pojok, jadi konten yang tergulir lewat di BAWAHNYA — dan
// tombol tembus-pandangnya dulu selebar seluruh panggung, sehingga tap yang ditujukan ke kontrol
// di bawahnya mendarat di pet. Terukur di 390×844 lewat `elementFromPoint` atas 9 titik sampel per
// kontrol: "Hapus spec" 2/9 titik, "Buka project" 3/9, "Pimpin" 4/9, item PRD 2/9. Ukuran target
// sentuh minimum (44px) sudah memenuhi aksesibilitas, jadi sisa panggung tak perlu ikut menangkap
// tap — ia cuma seni. Jangkar kanan-bawah mengikuti badan sticker-nya.
const HIT = 44;

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

export function HanomanPet({ sessions, backlog, onOpen }:
  { sessions: TerminalSession[]; backlog: Spec[]; onOpen: (target: PetTarget) => void }) {
  const { items } = useNotifications();
  const [hidden, setHidden] = React.useState(loadPetHidden);
  const [open, setOpen] = React.useState(false);
  const [panelMounted, setPanelMounted] = React.useState(false);
  const [reacting, setReacting] = React.useState(false);
  // Dinaikkan HANYA oleh peluruhan keadaan transient — satu-satunya perubahan pose yang tak dibawa
  // data baru. Bukan denyut: tak ada interval, hanya satu timeout tepat pada waktunya.
  const [decay, setDecay] = React.useState(0);
  const reduced = usePrefersReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const view = React.useMemo(
    () => derivePetState({ sessions, backlog, notifications: items, now: Date.now() }),
    [sessions, backlog, items, decay]);
  const motion = motionForPose(view.pose);
  const poseAnimation = (on: boolean) => reduced
    ? "none"
    : `hn-pet-pose-${on ? "in" : "out"} var(--dur-slow) var(--ease-out) both`;

  React.useEffect(() => {
    if (view.transientUntil === null) return;
    const t = setTimeout(() => setDecay((n) => n + 1), Math.max(0, view.transientUntil - Date.now()));
    return () => clearTimeout(t);
  }, [view.transientUntil]);

  // Hanya pose yang PERNAH terjadi yang masuk DOM: layer lama dipertahankan untuk animation keluar,
  // tanpa memuat kedelapan artwork sebelum benar-benar dipakai.
  const [seen, setSeen] = React.useState<PetPose[]>([view.pose]);
  React.useEffect(() => {
    setSeen((s) => (s.includes(view.pose) ? s : [...s, view.pose]));
  }, [view.pose]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, reduced]);

  React.useEffect(() => {
    if (!reduced) return;
    setReacting(false);
    if (!open) setPanelMounted(false);
  }, [reduced, open]);

  // React 18 belum mengetik atribut `inert` di HTMLAttributes stabilnya. Menulis atribut DOM
  // menjaga panel yang sedang keluar tetap tak bisa difokuskan tanpa cast prop yang rapuh.
  React.useEffect(() => {
    panelRef.current?.toggleAttribute("inert", !open);
  }, [open, panelMounted]);

  function showPanel() {
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

  // z 80: di bawah header (90), overlay terminal fullscreen (100), Modal (150), Toast (200) — jadi
  // pet tak bisa menutupi lapisan CHROME. Ia TETAP di atas konten halaman (z auto): klaim lama
  // "secara struktural tak bisa menutupi kontrol mana pun" salah, dan terbantah `elementFromPoint`
  // di 390×844 — "Hapus spec" kehilangan 2 dari 9 titik sampelnya. `pointerEvents: none` di
  // pembungkus memang menyerahkan area kosong, tapi tombol di dalamnya `auto`; yang membatasi
  // kerusakan adalah UKURAN tombol itu (`HIT`), bukan z-index.
  const root: React.CSSProperties = {
    position: "fixed", right: "max(22px, var(--safe-right))", bottom: "max(22px, var(--safe-bottom))", zIndex: 80,
    display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10,
    pointerEvents: "none",
  };

  if (hidden) {
    return (
      <div data-testid="pet-root" style={root}>
        <button aria-label="Tampilkan pet Hanoman" onClick={() => setVisibility(false)} style={{
          pointerEvents: "auto", width: 44, height: 44, padding: 0, display: "inline-flex",
          alignItems: "center", justifyContent: "center", cursor: "pointer",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-pill)",
          background: "var(--surface-card)", opacity: 0.55, boxShadow: "var(--shadow-sm)",
        }}>
          <Mark id="buntut" size={15} />
        </button>
      </div>
    );
  }

  const alt = `Hanoman ${POSE_LABEL[view.pose]} · ${view.headline}`;
  return (
    <div data-testid="pet-root" ref={ref} style={root}>
      {panelMounted && (
        <div ref={panelRef} data-testid="pet-panel" aria-hidden={!open || undefined}
          onAnimationEnd={(event) => {
            if (event.animationName === "hn-pet-panel-out" && !open) setPanelMounted(false);
          }} style={{
          pointerEvents: open ? "auto" : "none", width: 268,
          maxWidth: "calc(100vw - var(--safe-left) - var(--safe-right) - 24px)",
          maxHeight: "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 120px)",
          overflowY: "auto", boxSizing: "border-box", padding: 14,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
          transformOrigin: "right bottom",
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
            <Button size="sm" variant="ghost"
              style={reduced ? { transition: "none", transform: "none" } : undefined}
              onClick={() => setVisibility(true)}>Sembunyikan</Button>
          </div>
        </div>
      )}
      {/* Live region membungkus gambarnya dan tombol adalah overlay transparan DI DALAMNYA:
          gambar di dalam <button> diperlakukan sebagian screen reader sebagai presentasional,
          sehingga perubahan alt tak pernah diumumkan. */}
      <div data-testid="pet-stage" role="status" aria-live="polite"
        className="hn-pet-stage" data-reduced-motion={reduced ? "true" : undefined} style={{
          position: "relative", width: SIZE, height: SIZE,
          animation: reduced ? "none" : "hn-pet-reveal var(--dur-slow) var(--ease-out) both",
        }}>
        <div data-testid="pet-reactor" className="hn-pet-reactor" style={{
          position: "relative", width: "100%", height: "100%",
          transition: reduced ? "none" : "transform var(--dur-base) var(--ease-out)",
          animation: reduced || !reacting
            ? "none"
            : "hn-pet-click var(--dur-slow) var(--ease-out) both",
        }} onAnimationEnd={(event) => {
          if (event.animationName === "hn-pet-click") setReacting(false);
        }}>
          <div data-testid="pet-idle" data-motion={motion.id} style={{
            position: "relative", width: "100%", height: "100%", transformOrigin: "50% 86%",
            animation: reduced ? "none" : motion.animation,
          }}>
            {seen.map((pose) => {
              const on = pose === view.pose;
              return (
                <StickerIllustration key={pose} id={POSE_ART[pose]} decorative={!on}
                  alt={on ? alt : undefined} style={{
                    position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
                    opacity: on ? 1 : 0, zIndex: on ? 2 : 1,
                    animation: poseAnimation(on), transition: reduced ? "none" : undefined,
                  }} />
              );
            })}
          </div>
        </div>
        <button data-testid="pet-hit" aria-label="Ringkasan status Hanoman" title={`${view.headline} — ${view.detail}`}
          onClick={reactAndToggle} style={{
            pointerEvents: "auto", position: "absolute", zIndex: 3,
            right: 0, bottom: 0, width: HIT, height: HIT,
            padding: 0, border: "none", background: "transparent", cursor: "pointer",
          }} />
      </div>
    </div>
  );
}
