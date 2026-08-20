// SPEC-856 · echo prediktif lokal. Seluruh logikanya murni supaya rekonsiliasi bisa diuji tanpa
// tmux dan tanpa layout engine: komponen menyuplai pandangan layar sebagai data (lihat `View`).
//
// Invarian keselamatan yang menopang seluruh modul ini: begitu satu byte pun datang dari pty,
// prediksi di-rollback SEBELUM byte itu ditulis, dalam SATU panggilan `term.write`. Layar sesudah
// setiap frame server karena itu byte-identik dengan layar tanpa prediksi — prediksi paling buruk
// hanya salah selama < 1 RTT lalu hilang tanpa sisa.

export type InputKind = "text" | "control" | "bulk";

/** Kontrol C0/C1 dan DEL: apa pun di sini tak pernah diprediksi dan tak pernah di-batch. */
const CONTROL = /[\x00-\x1f\x7f]/;

export function classifyInput(d: string): InputKind {
  if (!d || CONTROL.test(d)) return "control";
  return [...d].length > 1 ? "bulk" : "text";
}

/** Underline saja: `\x1b[24m` mematikan underline TANPA menyentuh warna/latar, jadi SGR yang
 *  berlaku sesudah prediksi identik dengan sebelumnya — itu yang membuat `rollbackSeq` setia. */
export function applySeq(chars: string): string {
  return chars ? `\x1b[4m${chars}\x1b[24m` : "";
}

/** Mundur n kolom lalu hapus ke akhir baris. Setia hanya karena gerbang menjamin ekor baris di
 *  kanan kursor kosong — yang justru dipastikan `\x1b[K` milik TUI agen sendiri. */
export function rollbackSeq(n: number): string {
  return n > 0 ? `\x1b[${n}D\x1b[K` : "";
}

/** Pandangan layar pada saat keputusan diambil. Komponen membacanya dari xterm; modul ini tak
 *  pernah menyentuh xterm supaya seluruh keputusannya bisa diuji sebagai fungsi murni. */
export type View = { cursorX: number; cols: number; line: string; connected: boolean };

export type PredictState = {
  /** karakter yang sudah di-echo lokal dan belum terkonfirmasi, berurutan */
  pending: string;
  /** stempel prediksi terlama yang masih menunggu, untuk TTL */
  since: number | null;
  altScreen: boolean;
  /** prediksi mati sampai stempel ini (0 = tidak disuspend) */
  suspendedUntil: number;
};

export const TTL_MS = 500;
export const SUSPEND_MS = 30_000;
/** Kolom cadangan di tepi kanan: prediksi yang membungkus baris tak bisa di-rollback dengan CUB. */
const EDGE_MARGIN = 2;

export function initialState(): PredictState {
  return { pending: "", since: null, altScreen: false, suspendedUntil: 0 };
}

// SPEC-856 · HANYA ?1049 dan ?1047. `?47h`/`?2004h` terukur ikut lahir dari handshake attach tmux
// pada `bash` polos — bukan penanda TUI apa pun.
const ALT_ON = /\x1b\[\?(?:1049|1047)h/g;
const ALT_OFF = /\x1b\[\?(?:1049|1047)l/g;

export function scanAltScreen(data: string, alt: boolean): boolean {
  const last = (re: RegExp): number => {
    let at = -1;
    for (const m of data.matchAll(re)) at = m.index ?? at;
    return at;
  };
  const on = last(ALT_ON);
  const off = last(ALT_OFF);
  if (on < 0 && off < 0) return alt;
  return on > off;
}

const PASSWORD = /(password|passphrase|pass|pin)\s*(?:for\s+\S+\s*)?:\s*$/i;

export function looksLikePasswordPrompt(line: string): boolean {
  return PASSWORD.test(line);
}

export function canPredict(
  state: PredictState, d: string, view: View, now: number, enabled: boolean,
): boolean {
  if (!enabled || !view.connected || state.altScreen) return false;
  if (now < state.suspendedUntil) return false;
  if (classifyInput(d) !== "text") return false;
  // `view.cursorX` dibaca hidup dari xterm, jadi ia SUDAH memuat karakter yang sudah diprediksi —
  // menambahkan `pending.length` di sini akan menghitungnya dua kali. Pemanggil yang memprobe
  // beberapa karakter sekaligus (`reapply`) memajukan kursornya sendiri.
  if (view.cursorX + EDGE_MARGIN + 1 > view.cols) return false;
  // Ekor baris di kanan kursor wajib kosong: itu prasyarat `rollbackSeq` yang memakai `\x1b[K`.
  if (view.line.slice(view.cursorX).trim().length > 0) return false;
  return !looksLikePasswordPrompt(view.line.trimEnd());
}
