// Penangan shortcut global (Audit UI/UX 2026-10 · Fase 2C). Satu listener `keydown` di window.
// Aturan lengkap ada di shortcuts.ts; di sini hanya DOM-nya: siapa yang sedang difokus, dialog apa
// yang terbuka, dan aksi apa yang dijalankan.
import React from "react";
import { getPaletteUi, openPalette, openShortcutHelp, togglePalette } from "./ui-store";
import { CHORD_IDLE, stepChord, type ChordState } from "./shortcuts";

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const TERMINAL = ".xterm";

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING) !== null;
}

export function isTerminalTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TERMINAL) !== null;
}

/** Ada dialog modal terbuka (Modal DS dan dialog konfirmasi memakai aria-modal). */
export function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** `/`: fokus kotak cari topbar bila ada dan bisa diketik; selain itu buka palet. */
export function focusSearchOrPalette(): void {
  const input = document.querySelector<HTMLInputElement>(".hn-shell-search input");
  if (input && !input.disabled && !input.readOnly) {
    input.focus();
    return;
  }
  openPalette();
}

export type GlobalShortcutsOptions = {
  /** false = tanpa shortcut (login, portal klien). */
  enabled: boolean;
  /** Kunci nav yang boleh dituju chord, sudah tersaring gerbangnya. */
  navKeys: readonly string[];
  go: (key: string) => void;
};

export function useGlobalShortcuts(opts: GlobalShortcutsOptions): void {
  // Ref, bukan dependensi effect: listener dipasang sekali; opsi terbaru dibaca tiap tombol.
  const latest = React.useRef(opts);
  latest.current = opts;

  React.useEffect(() => {
    let chord: ChordState = CHORD_IDLE;
    const onKeyDown = (e: KeyboardEvent) => {
      const cur = latest.current;
      if (!cur.enabled || e.isComposing || e.defaultPrevented) return;
      const target = e.target;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
        if (isTerminalTarget(target)) return;
        if (!getPaletteUi().palette && modalOpen()) return;
        e.preventDefault();
        chord = CHORD_IDLE;
        togglePalette();
        return;
      }

      if (mod || e.altKey || isTypingTarget(target) || isTerminalTarget(target) || modalOpen()) {
        chord = CHORD_IDLE;
        return;
      }

      const step = stepChord(chord, e.key, Date.now(), cur.navKeys);
      chord = step.state;
      if (step.target) {
        e.preventDefault();
        cur.go(step.target);
        return;
      }
      if (step.consumed) return;
      if (e.key === "?") {
        e.preventDefault();
        openShortcutHelp();
      } else if (e.key === "/") {
        e.preventDefault();
        focusSearchOrPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
