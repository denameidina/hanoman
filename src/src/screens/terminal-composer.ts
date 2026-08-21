// SPEC-882 · kolom ketik (composer) untuk perangkat sentuh. Pola cermin `terminal-predict.ts`
// (SPEC-856): seluruh logikanya murni supaya aritmetika delta bisa diuji tanpa DOM, tanpa
// WebSocket, dan tanpa xterm — komponen hanya memegang irama dan jalur peristiwa.
//
// Kolom ini MELENGKAPI, bukan menggantikan, mengetik langsung ke pane: operator melihat hurufnya
// seketika (nol RTT, tak bergantung kesehatan sambungan) dan isinya mengalir ke pty secara debounce.
// Ia sengaja BUKAN perbaikan akar lag tablet — akarnya masih ditunggu dari perekam diagnostik.

/** DEL. Satu-satunya mekanisme selaraskan-ulang yang dipakai modul ini. `\x15` (Ctrl-U) DITOLAK:
 *  artinya berbeda per program — readline memotong sampai awal baris, `vim` mode sisip melakukan
 *  hal lain, dan pane tak selalu berisi shell. Backspace bekerja di mana-mana; ongkos beberapa byte
 *  ekstra pada suntingan tengah tak terasa dibanding satu RTT. */
const BACKSPACE = "\x7f";

/** Debounce sesudah ketikan terakhir. */
export const DEBOUNCE_MS = 350;
/** Kuras paksa saat mengetik terus-menerus: tanpa ini kalimat yang diketik tanpa jeda 350 ms
 *  menahan seluruh isinya sampai jari berhenti, dan terminal di atasnya tertinggal berdetik-detik. */
export const MAX_HOLD_MS = 1_000;

export type ComposerState = {
  /** yang dilihat operator di kolom */
  text: string;
  /** yang diyakini sudah mendarat di baris pty DARI kolom ini */
  sentPrefix: string;
};

export function initialState(): ComposerState {
  return { text: "", sentPrefix: "" };
}

/** Panjang awalan sama antara dua teks, dihitung PER CODE POINT. Menghitungnya dalam unit UTF-16
 *  membuat satu emoji bernilai dua backspace: baris pty rusak sementara layar operator tetap
 *  terlihat benar. */
export function commonPrefixLen(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
  return n;
}

/** Satu aturan untuk tiga kasus: mundur sampai titik pisah, lalu ketik sisanya. Menambah di ujung
 *  jadi murni append; menghapus di ujung jadi murni backspace; menyunting di tengah jadi keduanya. */
export function deltaFor(sentPrefix: string, text: string): string {
  const k = commonPrefixLen(sentPrefix, text);
  return BACKSPACE.repeat([...sentPrefix].length - k) + [...text].slice(k).join("");
}

export function onText(state: ComposerState, text: string): ComposerState {
  return { ...state, text };
}

export function onFlush(state: ComposerState): { state: ComposerState; send: string } {
  return {
    state: { ...state, sentPrefix: state.text },
    send: deltaFor(state.sentPrefix, state.text),
  };
}

/** `flush` dulu, lalu `\r`, lalu `reset` — urutan ini tak boleh terbalik: `\r` yang mendahului
 *  deltanya men-submit baris yang belum lengkap. Keduanya satu payload supaya tak ada apa pun yang
 *  bisa menyelip di antaranya. */
export function onSubmit(state: ComposerState): { state: ComposerState; send: string } {
  return { state: initialState(), send: deltaFor(state.sentPrefix, state.text) + "\r" };
}

/** Operator mengetik langsung ke pane (papan tombol fisik, tap, tombol Esc/Tab/panah, tempel,
 *  path lampiran). Delta yang belum melewati debounce dikuras LEBIH DULU — tanpa itu huruf yang
 *  sudah diketik operator lenyap tanpa jejak.
 *
 *  Sesudah reset `sentPrefix` NOL, bukan dipertahankan: menebak isi baris pty sesudah byte asing
 *  masuk adalah tebakan, dan tebakan di sini berarti byte yang salah. */
export function onExternalInput(state: ComposerState): { state: ComposerState; send: string } {
  return { state: initialState(), send: deltaFor(state.sentPrefix, state.text) };
}

/** Penanda kejujuran pengiriman. Tanpa ini kolom ketik memperburuk masalah yang sedang diselidiki:
 *  ia terasa mulus persis ketika byte-nya tidak ke mana-mana (terukur: 26 glyph tampil ~21 ms
 *  sementara `tmux capture-pane` menunjukkan prompt kosong). */
export type ComposerStatus = { kind: "sent" | "queued" | "held"; text: string };

export function statusFor(
  linkState: string, queue: { n: number; held: boolean },
): ComposerStatus | null {
  if (queue.held) return { kind: "held", text: "tertahan — Kirim di atas" };
  if (queue.n > 0) return { kind: "queued", text: `diantre ${queue.n}` };
  if (linkState === "open") return { kind: "sent", text: "terkirim" };
  // Strip status di atas pane sudah mengatakan "menyambung ulang…"; penanda kedua yang mengulangnya
  // hanya menambah derau.
  return null;
}
