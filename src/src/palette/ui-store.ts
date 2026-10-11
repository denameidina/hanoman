// Keadaan buka/tutup palet dan bantuan shortcut, dibagi ke Shell (tombol topbar), penangan shortcut,
// dan komponen dialognya tanpa prop drilling. Store modul kecil, bukan React context: Shell dirender
// di belasan cabang App, dan context baru di sana adalah undangan bagi cabang yang terlewat.
import React from "react";

export type PaletteUi = { palette: boolean; help: boolean };

let state: PaletteUi = { palette: false, help: false };
const listeners = new Set<() => void>();

function patch(next: Partial<PaletteUi>): void {
  const merged = { ...state, ...next };
  if (merged.palette === state.palette && merged.help === state.help) return;
  state = merged;
  for (const l of [...listeners]) l();
}

export const openPalette = (): void => patch({ palette: true });
export const closePalette = (): void => patch({ palette: false });
export const togglePalette = (): void => patch({ palette: !state.palette });
export const openShortcutHelp = (): void => patch({ help: true });
export const closeShortcutHelp = (): void => patch({ help: false });

export const getPaletteUi = (): PaletteUi => state;

export function subscribePaletteUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePaletteUi(): PaletteUi {
  return React.useSyncExternalStore(subscribePaletteUi, getPaletteUi, getPaletteUi);
}

/** Hanya untuk test: kembalikan ke keadaan tertutup antar-kasus. */
export function resetPaletteUi(): void {
  patch({ palette: false, help: false });
}
