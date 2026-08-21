// Perekam diagnostik jalur input terminal. Dipakai untuk menutup SATU batas yang belum pernah
// terukur: antara jari operator di kaca perangkat dan byte yang keluar dari `term.onData`.
//
// Latar: terukur di pty, sembilan karakter pertama sebuah abjad mendarat sempurna lalu sisanya
// mendarat sebagai huruf yang sama sekali lain (`abcdefghi` + 22 huruf asing). Tak ada satu pun
// jalur di klien yang bisa MENGGANTI byte — batcher hanya menyambung, `sendInput` hanya bisa
// membuang, rollback prediksi ditulis ke terminal lokal dan tak pernah menyentuh pty. Karena itu
// pertanyaannya bergeser ke hulu `term.onData`, dan hanya perekaman peristiwa asli browser yang
// bisa menjawabnya. Modul ini murni supaya bisa diuji tanpa DOM maupun WebSocket.

/** Satu peristiwa. Nama field sengaja satu huruf: perekam menyala justru saat jaringan bermasalah,
 *  dan amplop JSON-nya ikut menempuh sambungan yang sedang diselidiki. */
export type DiagEvent = {
  /** ms sejak peristiwa PERTAMA perekam ini — relatif, supaya jam dinding tak ikut bocor. */
  t: number;
  k: DiagKind;
  v: string;
  n?: number;
};

export type DiagKind =
  | "key"     // keydown mentah dari papan tombol/IME
  | "comp"    // compositionstart/update/end
  | "data"    // muatan yang keluar dari term.onData — inilah yang benar-benar dikirim
  | "ack"     // ack server, `n` = RTT terukur (ms)
  | "pred";   // keputusan echo prediktif

export const DIAG_BATCH_MS = 250;
/** Cukup untuk beberapa menit mengetik manusia, tetap jauh di bawah plafon 64 KiB satu frame WS. */
export const DIAG_MAX_BUFFER = 512;

const NAMED: Record<string, string> = {
  "\x1b": "\\e", "\r": "\\r", "\n": "\\n", "\t": "\\t", "\b": "\\b", "\x7f": "\\x7f",
};

/** Menampilkan muatan ESC-berat sebagai teks yang bisa dibaca mata TANPA kehilangan karakter.
 *  Tanpa ini `\x1b[A` di berkas JSONL tak bisa dibedakan dari huruf `[A` yang benar-benar diketik
 *  — dan justru perbedaan itu yang sedang diselidiki. */
export function showBytes(d: string): string {
  let out = "";
  for (const ch of d) {
    const named = NAMED[ch];
    if (named) { out += named; continue; }
    const code = ch.codePointAt(0)!;
    // Hanya C0 dan DEL yang di-escape: non-ASCII cetak (`é`, `❯`) justru bukti berharga soal IME.
    out += code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
  }
  return out;
}

export function createDiagRecorder(opts: {
  now: () => number;
  send: (events: DiagEvent[]) => void;
  batchMs?: number;
  max?: number;
}): { record(k: DiagKind, v: string, n?: number): void; flush(): void; dispose(): void } {
  const batchMs = opts.batchMs ?? DIAG_BATCH_MS;
  const max = opts.max ?? DIAG_MAX_BUFFER;
  let origin: number | null = null;
  let buf: DiagEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dead = false;

  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (!buf.length) return;
    const batch = buf;
    buf = [];
    opts.send(batch);
  };

  return {
    record(k, v, n) {
      if (dead) return;
      const at = opts.now();
      if (origin === null) origin = at;
      const ev: DiagEvent = { t: at - origin, k, v };
      if (n !== undefined) ev.n = n;
      buf.push(ev);
      // Yang dibuang adalah peristiwa TERTUA: saat operator mengetik lebih cepat dari kurasan,
      // yang sedang diselidiki selalu apa yang BARU SAJA terjadi.
      if (buf.length > max) buf = buf.slice(buf.length - max);
      if (!timer) timer = setTimeout(flush, batchMs);
    },
    flush,
    dispose() { flush(); dead = true; },
  };
}
