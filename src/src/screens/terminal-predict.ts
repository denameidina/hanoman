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

/** Berapa karakter awal `pending` yang sudah digambar server, dilihat dari teks di kiri kursor
 *  SESUDAH frame server ditulis (saat itu xterm sudah otoritatif). */
export function echoedPrefixLen(before: string, pending: string): number {
  for (let n = pending.length; n > 0; n -= 1) {
    if (before.endsWith(pending.slice(0, n))) return n;
  }
  return 0;
}

export function onInput(
  state: PredictState, d: string, view: View, now: number, enabled: boolean,
): { state: PredictState; write: string } {
  if (!canPredict(state, d, view, now, enabled)) return { state, write: "" };
  return {
    state: { ...state, pending: state.pending + d, since: state.since ?? now },
    write: applySeq(d),
  };
}

export function onServerData(
  state: PredictState, data: string, _now: number,
): { state: PredictState; write: string; tail: string } {
  const altScreen = scanAltScreen(data, state.altScreen);
  return {
    state: { ...state, pending: "", since: null, altScreen },
    write: rollbackSeq(state.pending.length) + data,
    tail: state.pending,
  };
}

export function reapply(
  state: PredictState, tail: string, view: View, now: number, enabled: boolean,
): { state: PredictState; write: string } {
  if (!tail) return { state, write: "" };
  // Gerbang diuji terhadap SELURUH sisa sekaligus, dengan kursor dimajukan sendiri: memasang
  // sebagian lalu kehabisan kolom akan meninggalkan pending yang tak bisa di-rollback.
  const chars = [...tail];
  for (let i = 0; i < chars.length; i += 1) {
    const at: View = { ...view, cursorX: view.cursorX + i };
    if (!canPredict({ ...state, pending: "" }, chars[i]!, at, now, enabled)) {
      return { state, write: "" };
    }
  }
  return { state: { ...state, pending: tail, since: now }, write: applySeq(tail) };
}

export function onTick(
  state: PredictState, now: number,
): { state: PredictState; write: string; missed: boolean } {
  if (!state.pending || state.since === null || now < state.since + TTL_MS) {
    return { state, write: "", missed: false };
  }
  return {
    state: { ...state, pending: "", since: null, suspendedUntil: now + SUSPEND_MS },
    write: rollbackSeq(state.pending.length),
    missed: true,
  };
}

/** tmux memutar ulang layar penuh saat attach — tak ada yang boleh diwarisi lintas sambungan. */
export function onReattach(): PredictState {
  return initialState();
}

/** Satu frame animasi, cermin `COALESCE_MS` arah keluar (SPEC-812). Terukur: TUI agen menggambar
 *  ulang sekali per EVENT input, bukan per karakter — `hello world` sebagai 11 keystroke terpisah
 *  membalas 22 frame / 16 999 byte, sebagai satu frame 2 frame / 1 551 byte. */
export const COALESCE_IN_MS = 16;

export function createInputBatcher(send: (d: string) => void): {
  push(d: string, coalesce: boolean): void; flush(): void; dispose(): void;
} {
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (!buf) return;
    const d = buf;
    buf = "";
    send(d);
  };
  return {
    push(d, coalesce) {
      // Control & bulk tak pernah ditahan: mereka menguras antrean lebih dulu supaya urutan byte
      // ke pty tak pernah berubah, lalu lewat sendiri.
      if (!coalesce || classifyInput(d) !== "text") { flush(); if (d) send(d); return; }
      buf += d;
      if (!timer) timer = setTimeout(flush, COALESCE_IN_MS);
    },
    flush,
    dispose() { flush(); },
  };
}
