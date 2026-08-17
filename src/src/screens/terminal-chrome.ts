// SPEC-800 · aritmetika chrome terminal, dipisah dari komponennya supaya teruji tanpa layout
// engine: jsdom tak mengukur apa pun, jadi yang bisa dijaga test adalah keputusannya, bukan
// pikselnya. Komponen hanya menyuplai lebar hasil ResizeObserver.

/** Lebar minimum label sesi di header sel; di bawah ini label tak lagi bisa dibaca. */
export const HEADER_LABEL_MIN = 96;
/** Ilustrasi state (34px) + gap header di kedua sisinya (ilustrasi↔label, label↔klaster aksi). */
export const HEADER_MEDIA_PX = 50;
/** Jarak antar tombol aksi di dalam klaster `.hn-terminal-actions` — bukan gap header (8px). */
export const ACTION_GAP = 2;
/** `Layar penuh` + `Tutup` tak pernah runtuh: keduanya jalan keluar, bukan aksi tambahan. */
export const ALWAYS_INLINE = 2;

/** Berapa aksi yang boleh tetap inline pada header selebar `width`. Sisanya milik overflow.
 *  `actionPx` mengikuti pointer: 28 (halus) / 44 (kasar), mencermin app.css. */
export function inlineActionCount(width: number, total: number, actionPx: number): number {
  if (!Number.isFinite(width) || width <= 0) return total;
  const slot = actionPx + ACTION_GAP;
  const room = Math.floor((width - HEADER_LABEL_MIN - HEADER_MEDIA_PX - ALWAYS_INLINE * slot) / slot);
  if (room >= total) return total;
  // Satu slot dibayarkan untuk tombol overflow itu sendiri.
  return Math.max(0, room - 1);
}

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
