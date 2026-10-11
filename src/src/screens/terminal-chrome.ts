// SPEC-800 · aritmetika chrome terminal, dipisah dari komponennya supaya teruji tanpa layout
// engine: jsdom tak mengukur apa pun, jadi yang bisa dijaga test adalah keputusannya, bukan
// pikselnya. Komponen hanya menyuplai lebar hasil ResizeObserver.

// SPEC-452 · dialog AskUserQuestion adalah daftar Ink: satu digit sebagai keystroke tersendiri
// LANGSUNG memilih baris bernomor itu, sedangkan burst >1 karakter ditelan bulat-bulat. Footer
// dialognya (`Enter to select · ↑/↓ to navigate · Esc to cancel`) dipakai sebagai gerbang supaya
// daftar bernomor di layar kerja biasa tak pernah ikut terkirim.
const DIALOG_SELECT = /enter to select/i;
const DIALOG_NAVIGATE = /to navigate/i;
const CHOICE_ROW = /^\s*[❯>*]?\s*(\d)\.\s/;

export function dialogChoiceAt(lines: string[], row: number): string | null {
  const screen = lines.join("\n");
  if (!DIALOG_SELECT.test(screen) || !DIALOG_NAVIGATE.test(screen)) return null;
  const line = lines[row];
  return line ? CHOICE_ROW.exec(line)?.[1] ?? null : null;
}

export const FONT_MIN = 10;
export const FONT_MAX = 24;
export const FONT_DEFAULT = 13;
export const FONT_DEFAULT_MOBILE = 15;

// SPEC-audit tablet · lebar nyaman minimum satu pane terminal: cukup untuk ~45 kolom monospace
// pada FONT_DEFAULT (13px, char ≈ 0.6em ⇒ 7.8px/kolom ⇒ ~350px) plus padding/border sel. Di bawah
// ini output terminal mulai wrap berlebihan dan header sel kehabisan ruang untuk label+aksi.
export const MIN_PANE_WIDTH = 360;

/** Grid tablet melebihi lebar kontainer yang tersedia bila tiap kolom dipaksa muat `minPaneWidth`
 *  — turunkan ke mode Tabs single-pane yang sama dengan mobile. `containerWidth` tak terukur
 *  (jsdom, belum di-observe) = jangan collapse. */
export function shouldCollapseToTabs(cols: number, containerWidth: number, minPaneWidth = MIN_PANE_WIDTH): boolean {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return false;
  return cols * minPaneWidth > containerWidth;
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_DEFAULT;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(value)));
}

// Papan tombol layar: keyboard virtual ponsel tak punya panah, Esc, maupun Tab, dan Esc adalah
// satu-satunya jalan keluar dari copy-mode tmux (audit SPEC-800 §4).
export const TERMINAL_KEYS = [
  { id: "esc", label: "Esc", seq: "\x1b", aria: "Kirim Escape ke terminal" },
  { id: "tab", label: "Tab", seq: "\t", aria: "Kirim Tab ke terminal" },
  { id: "up", label: "↑", seq: "\x1b[A", aria: "Kirim panah atas ke terminal" },
  { id: "down", label: "↓", seq: "\x1b[B", aria: "Kirim panah bawah ke terminal" },
  { id: "left", label: "←", seq: "\x1b[D", aria: "Kirim panah kiri ke terminal" },
  { id: "right", label: "→", seq: "\x1b[C", aria: "Kirim panah kanan ke terminal" },
  { id: "enter", label: "Enter", seq: "\r", aria: "Kirim Enter ke terminal" },
] as const;

/** Jalan keluar keyboard dari xterm: Ctrl+Shift+Esc. Dipilih karena tak dipakai TUI agen (Esc polos
 *  adalah tombol tersibuknya, lihat CellImpl) dan tak punya urutan byte di xterm, jadi tak pernah
 *  ikut terkirim ke pty ketika ia memang dipakai untuk keluar. */
export function isFocusEscape(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): boolean {
  return e.key === "Escape" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
}
