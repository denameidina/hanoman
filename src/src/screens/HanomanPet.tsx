import React from "react";
import type { Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";
import { Button, Mark, StickerIllustration } from "../ds";
import { useNotifications } from "../notifications/NotificationsContext";
import {
  derivePetState, loadPetHidden, savePetHidden,
  POSE_ART, POSE_LABEL, type PetPose, type PetTarget,
} from "./pet-state";

const SIZE = 76;

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
  // Dinaikkan HANYA oleh peluruhan keadaan transient — satu-satunya perubahan pose yang tak dibawa
  // data baru. Bukan denyut: tak ada interval, hanya satu timeout tepat pada waktunya.
  const [decay, setDecay] = React.useState(0);
  const reduced = usePrefersReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);

  const view = React.useMemo(
    () => derivePetState({ sessions, backlog, notifications: items, now: Date.now() }),
    [sessions, backlog, items, decay]);

  React.useEffect(() => {
    if (view.transientUntil === null) return;
    const t = setTimeout(() => setDecay((n) => n + 1), Math.max(0, view.transientUntil - Date.now()));
    return () => clearTimeout(t);
  }, [view.transientUntil]);

  // Hanya pose yang PERNAH terjadi yang masuk DOM: crossfade-nya dikerjakan CSS tanpa timer, dan
  // byte yang diambil browser tumbuh mengikuti pemakaian alih-alih memuat kedelapannya di muka.
  const [seen, setSeen] = React.useState<PetPose[]>([view.pose]);
  React.useEffect(() => {
    setSeen((s) => (s.includes(view.pose) ? s : [...s, view.pose]));
  }, [view.pose]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function setVisibility(next: boolean) {
    setHidden(next);
    savePetHidden(next);
    if (next) setOpen(false);
  }

  // z 80: di bawah header (90), overlay terminal fullscreen (100), Modal (150), Toast (200) — jadi
  // pet secara struktural tak bisa menutupi kontrol mana pun. `pointerEvents: none` di pembungkus
  // menyerahkan kembali area kosong di sekitarnya ke konten di bawahnya.
  const root: React.CSSProperties = {
    position: "fixed", right: 22, bottom: 22, zIndex: 80,
    display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10,
    pointerEvents: "none",
  };

  if (hidden) {
    return (
      <div data-testid="pet-root" style={root}>
        <button aria-label="Tampilkan pet Hanoman" onClick={() => setVisibility(false)} style={{
          pointerEvents: "auto", width: 28, height: 28, padding: 0, display: "inline-flex",
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
      {open && (
        <div style={{
          pointerEvents: "auto", width: 268, padding: 14,
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
        }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>{POSE_LABEL[view.pose]}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600,
            color: "var(--text-strong)", lineHeight: 1.25 }}>{view.headline}</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-ui)", fontSize: 12.5,
            color: "var(--text-muted)", lineHeight: 1.45 }}>{view.detail}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button size="sm" leftIcon={view.target.section === "terminal" ? "terminal" : "list-checks"}
              onClick={() => { setOpen(false); onOpen(view.target); }}>
              {view.target.section === "terminal" ? "Buka Terminal" : "Buka Backlog"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setVisibility(true)}>Sembunyikan</Button>
          </div>
        </div>
      )}
      {/* Live region membungkus gambarnya dan tombol adalah overlay transparan DI DALAMNYA:
          gambar di dalam <button> diperlakukan sebagian screen reader sebagai presentasional,
          sehingga perubahan alt tak pernah diumumkan. */}
      <div data-testid="pet-stage" role="status" aria-live="polite" style={{
        position: "relative", width: SIZE, height: SIZE,
        animation: reduced ? "none" : "hn-pet-breathe 4.5s var(--ease-inout) infinite alternate",
      }}>
        {seen.map((pose) => {
          const on = pose === view.pose;
          return (
            <StickerIllustration key={pose} id={POSE_ART[pose]} decorative={!on} alt={on ? alt : undefined}
              style={{
                position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
                opacity: on ? 1 : 0,
                transition: reduced ? "none" : "opacity var(--dur-slow) var(--ease-out)",
              }} />
          );
        })}
        <button aria-label="Ringkasan status Hanoman" title={`${view.headline} — ${view.detail}`}
          onClick={() => setOpen((o) => !o)} style={{
            pointerEvents: "auto", position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
            padding: 0, border: "none", background: "transparent", cursor: "pointer",
          }} />
      </div>
    </div>
  );
}
