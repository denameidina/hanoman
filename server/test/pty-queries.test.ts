import { describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import {
  attach, createSession, killSession, writeTo, isTerminalResponse, stripTerminalQueries,
  type Client,
} from "../src/services/pty";

// SPEC-860 · replay scrollback yang memuat PERTANYAAN terminal membuat setiap klien baru menjawab
// pertanyaan lama; tmux sudah lewat handshake-nya, jadi jawabannya mendarat di pane sebagai
// KETIKAN. Inventaris di bawah diambil dari dump kawat sesi tmux 3.7b nyata (audit SPEC-860).
const HANDSHAKE = "\x1b[?1049h\x1b[22;0;0t\x1b[?1h\x1b=\x1b[H\x1b[2J\x1b[?2004h\x1b[?2031h"
  + "\x1b[?996n\x1b[m\x1b[1;1H\x1b[1;30r\x1b[c\x1b[>c\x1b[>q\x1b]10;?\x1b\\\x1b]11;?\x1b\\";

// SPEC-860 · berdiri sebagai TUI agen: menampilkan apa pun yang masuk sebagai teks.
const RX_ECHO = fileURLToPath(new URL("./fixtures/rx-echo.mjs", import.meta.url));

// Socket sendiri: `hanoman-test` dipakai bersama worktree tetangga dan `killAll()` di sana
// membunuh SERVER tmux-nya, bukan satu sesi — terukur sebagai "[server exited]" di tengah test ini.
const PREV_SOCKET = process.env.HANOMAN_TMUX_SOCKET;
beforeAll(() => { process.env.HANOMAN_TMUX_SOCKET = "hanoman-t860"; });
afterAll(() => { process.env.HANOMAN_TMUX_SOCKET = PREV_SOCKET; });

const sessions: string[] = [];
const born = (id: string): string => { sessions.push(id); return id; };
afterEach(() => { while (sessions.length) killSession(sessions.pop()!); });

function fakeClient(): Client & { data: () => string } {
  const frames: { t: string; d?: string }[] = [];
  return {
    send: (m: string) => { frames.push(JSON.parse(m)); },
    close: () => {},
    data: () => frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join(""),
  };
}
const waitFor = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Cursor Position Report. Dipilih karena terukur LOLOS mesin keadaan tmux sampai ke pane — tak
// seperti balasan DA pertama sebuah klien tmux, yang selalu ditelannya sendiri (`TTY_HAVEDA`;
// itulah justru sebabnya attach #1 bersih di lapangan).
const CPR = "\x1b[24;1R";

describe("stripTerminalQueries (SPEC-860)", () => {
  it("membuang setiap pertanyaan handshake attach tmux", () => {
    const out = stripTerminalQueries(HANDSHAKE);
    for (const q of ["\x1b[c", "\x1b[>c", "\x1b[>q", "\x1b[?996n", "\x1b]10;?", "\x1b]11;?"]) {
      expect(out).not.toContain(q);
    }
  });

  it("membuang pertanyaan program yang diteruskan tmux", () => {
    // Terukur sampai ke klien: palet OSC 4 dan laporan ukuran XTWINOPS berparameter tunggal.
    expect(stripTerminalQueries("A\x1b]4;1;?\x07B")).toBe("AB");
    expect(stripTerminalQueries("A\x1b[18t\x1b[14tB")).toBe("AB");
    expect(stripTerminalQueries("A\x1b[6n\x1b[5n\x1b[?6nB")).toBe("AB");
    expect(stripTerminalQueries("A\x1b[?1049$p\x1b[4$pB")).toBe("AB");
    expect(stripTerminalQueries("A\x1bP+q544e\x1b\\\x1bP$qm\x1b\\B")).toBe("AB");
  });

  it("TIDAK menyentuh satu pun byte yang menggambar", () => {
    // Inventaris kawat nyata: mode, penempatan, hapus, gulir, warna, judul, dan resize.
    const paint = "\x1b[?1049h\x1b[?1h\x1b=\x1b[H\x1b[2J\x1b[?12l\x1b[?25h\x1b[?25l\x1b[?2004h"
      + "\x1b[?2031h\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[m\x1b[38;5;174m\x1b[1;1H\x1b[1;30r"
      + "\x1b[3;11H\x1b[K\x1b[A\x1b[2S\x1b[22;0;0t\x1b[8;30;100t\x1b[2 q ❯ halo";
    expect(stripTerminalQueries(paint)).toBe(paint);
  });

  it("membiarkan teks polos yang kebetulan memuat huruf finalnya", () => {
    expect(stripTerminalQueries("c n q p t 18t ]4;1;?")).toBe("c n q p t 18t ]4;1;?");
  });
});

describe("isTerminalResponse (SPEC-860)", () => {
  it("mengenali balasan yang benar-benar dikirim xterm.js 6", () => {
    for (const r of ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b]10;rgb:ffff/ffff/ffff\x1b\\",
      "\x1b]11;rgb:0000/0000/0000\x1b\\", "\x1b]4;1;rgb:cccc/0000/0000\x1b\\",
      "\x1b[24;1R", "\x1b[0n", "\x1b[?1049;1$y", "\x1bP1+r544e=1B\x1b\\"]) {
      expect(isTerminalResponse(r)).toBe(true);
    }
    // Balasan bisa tiba bergandengan dalam satu frame.
    expect(isTerminalResponse("\x1b[?1;2c\x1b[>0;276;0c")).toBe(true);
  });

  it("TIDAK pernah mengenali ketikan manusia sebagai balasan", () => {
    for (const k of ["a", "halo", "\r", "\n", "\t", "\x03", "\x7f", "\x1b", "\x1b[A", "\x1b[B",
      "\x1bOA", "\x1b[3~", "\x1b[200~tempelan\x1b[201~", "\x1b[<0;12;24M", ""]) {
      expect(isTerminalResponse(k)).toBe(false);
    }
  });
});

// Butuh tmux nyata: yang diuji adalah aliran byte antara klien tmux dan klien WebSocket.
describe("attachment · balasan terminal tak pernah lahir sendiri (SPEC-860)", () => {
  it("replay ke klien kedua tak memuat satu pun pertanyaan terminal", async () => {
    const s = createSession("p860", process.cwd(), { id: born("q860a"), command: [process.execPath, RX_ECHO] });
    const first = fakeClient();
    attach(s.id, first);
    // Handshake attach tmux — sumber pertanyaannya — tiba lebih dulu ke klien pertama.
    await waitFor(() => first.data().includes("\x1b["));
    await sleep(300);

    const second = fakeClient();
    attach(s.id, second);
    const replay = second.data();
    expect(replay.length).toBeGreaterThan(0);
    for (const q of ["\x1b[c", "\x1b[>c", "\x1b[>q", "\x1b[?996n", "\x1b]10;?", "\x1b]11;?"]) {
      expect(replay).not.toContain(q);
    }
  });

  it("balasan dari klien yang bukan penjawab tak pernah sampai ke pty", async () => {
    const s = createSession("p860", process.cwd(), { id: born("q860b"), command: [process.execPath, RX_ECHO] });
    const answerer = fakeClient();
    const watcher = fakeClient();
    attach(s.id, answerer);
    attach(s.id, watcher);
    // Dua bentuk balasan yang BERBEDA supaya asalnya tak bisa tertukar di layar; keduanya
    // terukur lolos mesin keadaan tmux sampai ke pane. Urutan byte ke pty terjaga, jadi penanda
    // SESUDAH adalah gerbang waktu yang deterministik: ia tiba berarti balasan di depannya sudah
    // lewat titik keputusannya. Tanpa itu test ini hijau hanya karena balasannya belum tiba.
    writeTo(s.id, CPR, watcher);
    writeTo(s.id, "sesudah", watcher);
    await waitFor(() => answerer.data().includes("sesudah"));
    expect(answerer.data()).not.toContain("24;1R");

    // Kontrol positif: balasan dari penjawab TETAP sampai — gerbangnya bukan "buang semuanya".
    // Aman memakai bentuk yang sama: assertion negatif di atas sudah dieksekusi sebelum satu byte
    // pun dikirim dari penjawab, jadi asal kemunculan di bawah ini tak bisa tertukar.
    writeTo(s.id, CPR, answerer);
    writeTo(s.id, "akhir", answerer);
    await waitFor(() => answerer.data().includes("akhir"));
    expect(answerer.data()).toContain("24;1R");

    // Ketikan manusia dari klien mana pun tak pernah tersentuh gerbang ini.
    writeTo(s.id, "halo", watcher);
    await waitFor(() => answerer.data().includes("halo"));
  });
});
