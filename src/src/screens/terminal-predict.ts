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
 *  pernah menyentuh xterm supaya seluruh keputusannya bisa diuji sebagai fungsi murni.
 *
 *  SPEC-878 · `deliverable` menggantikan `connected`: yang menentukan boleh-tidaknya memprediksi
 *  adalah apakah byte ini akan SAMPAI, bukan apakah socketnya sedang hidup. Byte yang diantre untuk
 *  sambungan yang masih akan pulih pasti terkirim — menolak memprediksinya membuat layar diam
 *  persis saat operator paling butuh umpan balik (terukur: 0 tulis lokal untuk 14 keystroke). */
export type View = { cursorX: number; cols: number; line: string; deliverable: boolean };

export type PredictState = {
  /** karakter yang sudah di-echo lokal dan belum terkonfirmasi, berurutan */
  pending: string;
  /** stempel prediksi terlama yang masih menunggu, untuk TTL */
  since: number | null;
  /** SPEC-863 · keadaan alternate screen PANE, dipasok server lewat frame `alt`. */
  altScreen: boolean;
  /** prediksi mati sampai stempel ini (0 = tidak disuspend) */
  suspendedUntil: number;
  /** Teks yang diketik SELAMA suspend dan tak diprediksi — bahan bukti bahwa pty membalas lagi.
   *  Kosong di luar suspend; dikosongkan oleh control/bulk karena barisnya sudah berubah. */
  typed: string;
  /** Urutan huruf yang layak digambar ulang sesudah frame server tergambar: yang sudah diprediksi
   *  (⊇ `pending`) plus yang DITANGGUHKAN selama frame in flight. Control/bulk/penolakan gerbang
   *  memutus urutannya → dikosongkan; `pending` tetap karena glyph-nya masih butuh rollback. */
  unechoed: string;
  /** Nomor frame server terakhir yang write-nya sudah dipanggil, dan yang terakhir TERGAMBAR.
   *  Berbeda = ada frame in flight; hanya callback frame ber-`gen` terakhir yang memutuskan. */
  gen: number;
  parsed: number;
};

export const TTL_MS = 500;
// Suspend lahir dari TTL yang lewat tanpa echo. Itu sah untuk prompt password dan dialog yang
// menelan tombol (keduanya terukur membalas NOL byte), tapi pemicu palsunya nyata: TUI agen yang
// menggambar ulang >500 ms saat mesin sibuk. Dulu hukumannya rata 30 dtk tanpa jalan pulih —
// setiap huruf menunggu RTT penuh. Kini suspend DICABUT begitu ada bukti pty membalas ketikan
// lagi (`onEchoed`), dan angka ini tinggal fallback untuk konteks yang memang bungkam: di prompt
// password paling banyak satu huruf berkedip 500 ms per jendela ini.
export const SUSPEND_MS = 5_000;
/** Batas buku ketikan selama suspend: cukup untuk satu kata, tak pernah tumbuh tanpa batas. */
export const TYPED_MAX = 32;
/** Batas huruf yang ditangguhkan selama frame in flight (beberapa ms; parse xterm ber-jatah 12 ms).
 *  Melewati batas: huruf baru tak ditangguhkan — menggeser yang lama akan merusak urutan. */
export const UNECHOED_MAX = 64;
/** Kolom cadangan di tepi kanan: prediksi yang membungkus baris tak bisa di-rollback dengan CUB. */
const EDGE_MARGIN = 2;

export function initialState(): PredictState {
  return { pending: "", since: null, altScreen: false, suspendedUntil: 0, typed: "", unechoed: "", gen: 0, parsed: 0 };
}

/** Ada write frame server yang belum tergambar. Selama ini benar, tak ada glyph prediksi di layar
 *  (`pending` kosong) dan huruf baru ditangguhkan ke `unechoed`. */
export const inFlight = (state: PredictState): boolean => state.gen !== state.parsed;

/** SPEC-863 · satu-satunya jalan masuk keadaan alternate screen: frame `alt` dari server, yang
 *  membacanya dari `#{alternate_on}` milik tmux. Aliran byte tak pernah dipindai lagi — tmux
 *  mengemulasi terminal pane, jadi `\x1b[?1049h/l` milik program di dalamnya tak pernah sampai ke
 *  klien, sementara yang sampai (`smcup` klien tmux) menyala di byte pertama dan tak pernah padam.
 *  Memindainya karena itu hanya bisa salah-positif — terukur mematikan prediksi total, ADR-0133.
 *
 *  `pending` sengaja tak disentuh: rollback tetap milik dua jalur yang sudah ada (byte server
 *  berikutnya, atau TTL), dan mengosongkannya di sini akan meninggalkan glyph tanpa pemilik. */
export function onPaneAltScreen(state: PredictState, on: boolean): PredictState {
  return { ...state, altScreen: on };
}

const PASSWORD = /(password|passphrase|pass|pin)\s*(?:for\s+\S+\s*)?:\s*$/i;

export function looksLikePasswordPrompt(line: string): boolean {
  return PASSWORD.test(line);
}

export function canPredict(
  state: PredictState, d: string, view: View, now: number, enabled: boolean,
): boolean {
  if (!enabled || !view.deliverable || state.altScreen) return false;
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

// SPEC-878 · `since` dikosongkan setiap kali lahir prediksi baru: jam TTL milik `onDelivered`, dan
// ia baru boleh berjalan sesudah byte-nya diketahui sampai di server (ADR-0134). Menyetelnya di
// sini berarti mengukur "sudah berapa lama saya menunggu" — pertanyaan yang jawabannya sama dengan
// "pty sengaja bungkam" hanya selama jaringan sehat.
export function onInput(
  state: PredictState, d: string, view: View, now: number, enabled: boolean,
): { state: PredictState; write: string; deferred?: boolean } {
  const kind = classifyInput(d);
  // Frame server masih in flight: layar yang terbaca sekarang masih layar LAMA, dan glyph yang
  // digambar sekarang akan mendarat di depan sisa lama di antrean xterm — urutannya terbalik.
  // Huruf ditangguhkan; gerbang layar penuh dijalankan `onFrameParsed` dengan layar segar.
  // Gerbang yang tak butuh layar tetap ditegakkan di sini.
  if (kind === "text" && inFlight(state) && enabled && view.deliverable && !state.altScreen
    && now >= state.suspendedUntil) {
    if (state.unechoed.length >= UNECHOED_MAX) return { state, write: "" };
    return { state: { ...state, unechoed: state.unechoed + d, typed: "" }, write: "", deferred: true };
  }
  if (!canPredict(state, d, view, now, enabled)) {
    // Buku ketikan hanya hidup selama suspend: teks dicatat sebagai bahan bukti echo, control/bulk
    // mengosongkannya (Enter/Backspace/panah mengubah baris; yang lama tak lagi di kiri kursor).
    const suspended = now < state.suspendedUntil;
    const typed = suspended && kind === "text" ? (state.typed + d).slice(-TYPED_MAX) : "";
    // Apa pun alasannya, urutan huruf yang layak digambar ulang terputus di sini.
    if (typed === state.typed && !state.unechoed) return { state, write: "" };
    return { state: { ...state, typed, unechoed: "" }, write: "" };
  }
  return {
    state: { ...state, pending: state.pending + d, unechoed: state.unechoed + d, since: null, typed: "" },
    write: applySeq(d),
  };
}

/** Apakah komponen perlu membaca layar sesudah frame server tergambar: hanya selama suspend dan
 *  hanya bila ada ketikan yang bisa dibuktikan echonya. Di luar itu nol biaya. */
export function wantsEchoEvidence(state: PredictState, now: number): boolean {
  return now < state.suspendedUntil && state.typed.length > 0;
}

/** Bukti pty membalas ketikan lagi: teks di kiri kursor SESUDAH frame server tergambar berakhir
 *  dengan ekor `typed`. Ekornya ≥2 huruf bila ada — satu huruf yang kebetulan sama (spasi di
 *  prompt password) tak boleh mengangkat suspend; bila hanya satu huruf yang diketik, satu cukup.
 *  Ketikan yang menyusul SESUDAH frame dibuat server (huruf ketiga saat frame baru memuat dua)
 *  tak cocok di frame ini dan cocok di frame berikutnya — benar, hanya tertunda satu repaint. */
export function echoEvidence(before: string, typed: string): boolean {
  if (!typed) return false;
  const tail = typed.slice(-Math.min(2, typed.length));
  return before.endsWith(tail);
}

/** Dipanggil dengan teks di kiri kursor sesudah frame server TERGAMBAR (callback `term.write`,
 *  bukan tepat sesudah pemanggilannya — xterm memproses write server secara asinkron). */
export function onEchoed(state: PredictState, before: string, now: number): PredictState {
  if (now >= state.suspendedUntil) return state.typed ? { ...state, typed: "" } : state;
  if (!echoEvidence(before, state.typed)) return state;
  return { ...state, suspendedUntil: 0, typed: "" };
}

export function onServerData(
  state: PredictState, data: string, _now: number,
): { state: PredictState; write: string } {
  // `unechoed` tak disentuh: sisa yang belum ter-echo diputuskan `onFrameParsed` sesudah frame
  // ini TERGAMBAR. Frame yang datang selagi frame lain in flight tak perlu rollback — tak ada
  // glyph prediksi di layar selama itu.
  return {
    state: { ...state, pending: "", since: null, gen: state.gen + 1 },
    write: rollbackSeq(state.pending.length) + data,
  };
}

/** Callback `term.write` frame server ber-`gen`: frame sudah tergambar, layar (`view`) segar.
 *  Bila sudah ada frame yang lebih baru, keputusan diserahkan ke callback frame itu. Urutannya:
 *  penyembuhan suspend (`onEchoed`), lalu sisa `unechoed` yang belum ter-echo digambar ulang
 *  dalam SATU write — dengan gerbang layar penuh atas seluruh sisa, kalau tidak: dibuang. */
export function onFrameParsed(
  state: PredictState, gen: number, view: View, now: number, enabled: boolean,
): { state: PredictState; write: string } {
  if (gen !== state.gen) return { state, write: "" };
  const before = view.line.slice(0, view.cursorX);
  const s = onEchoed({ ...state, parsed: gen }, before, now);
  if (!s.unechoed) return { state: s, write: "" };
  const remaining = s.unechoed.slice(echoedPrefixLen(before, s.unechoed));
  if (!remaining) return { state: { ...s, unechoed: "" }, write: "" };
  const back = reapply({ ...s, pending: "" }, remaining, view, now, enabled);
  if (!back.write) return { state: { ...s, pending: "", unechoed: "" }, write: "" };
  return { state: { ...back.state, unechoed: remaining }, write: back.write };
}

/** SPEC-878 · ADR-0134 · satu-satunya penyala jam TTL: server mengakui sudah menerima frame yang
 *  membawa prediksi ini dan menyerahkannya ke pty. Sesudah titik itu — dan hanya sesudahnya —
 *  diamnya pty benar-benar berarti "pty memilih tak membalas" (`read -s`, tombol yang ditelan
 *  dialog: keduanya terukur nol byte). Idempoten: jam yang sudah menyala tak pernah dimundurkan. */
export function onDelivered(state: PredictState, now: number): PredictState {
  if (!state.pending || state.since !== null) return state;
  return { ...state, since: now };
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
  return { state: { ...state, pending: tail, since: null }, write: applySeq(tail) };
}

export function onTick(
  state: PredictState, now: number,
): { state: PredictState; write: string; missed: boolean } {
  if (!state.pending || state.since === null || now < state.since + TTL_MS) {
    return { state, write: "", missed: false };
  }
  return {
    state: { ...state, pending: "", since: null, suspendedUntil: now + SUSPEND_MS, typed: "", unechoed: "" },
    write: rollbackSeq(state.pending.length),
    missed: true,
  };
}

/** tmux memutar ulang layar penuh saat attach — tak ada yang boleh diwarisi lintas sambungan.
 *  `altScreen` ikut kembali ke `false` dan itu aman: server mengirim frame `alt` berisi keadaan
 *  yang sedang berlaku ke setiap klien baru, di dalam `attach()` (SPEC-863). */
export function onReattach(prev?: PredictState): PredictState {
  // `gen` diteruskan naik: callback write milik sambungan lama yang baru tergambar sesudah ini
  // tak boleh cocok dengan frame mana pun dari sambungan baru.
  const gen = (prev?.gen ?? 0) + 1;
  return { ...initialState(), gen, parsed: gen };
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
