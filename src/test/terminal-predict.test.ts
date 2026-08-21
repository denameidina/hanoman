import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySeq, canPredict, classifyInput, echoedPrefixLen, initialState, looksLikePasswordPrompt,
  COALESCE_IN_MS, createInputBatcher, onInput, onPaneAltScreen, onReattach, onServerData, onTick,
  onDelivered, reapply, rollbackSeq,
  SUSPEND_MS, TTL_MS, type PredictState, type View,
} from "../src/screens/terminal-predict";

describe("classifyInput", () => {
  it("menyebut satu grafem cetak sebagai teks", () => {
    expect(classifyInput("a")).toBe("text");
    expect(classifyInput(" ")).toBe("text");
    expect(classifyInput("é")).toBe("text");
  });
  it("menyebut escape, panah, Enter, Tab, dan ctrl sebagai control", () => {
    for (const d of ["\x1b", "\x1b[A", "\r", "\n", "\t", "\x03", "\x7f", "\b"]) {
      expect(classifyInput(d)).toBe("control");
    }
  });
  it("menyebut input >1 karakter cetak sebagai bulk", () => {
    expect(classifyInput("halo")).toBe("bulk");
  });
  // Pembungkus bracketed paste memuat ESC, jadi ia jatuh ke "control" — bukan "bulk". Bedanya
  // tak berperilaku: batcher memperlakukan setiap yang bukan "text" sama persis (kuras lalu
  // loloskan seketika), dan gerbang prediksi menolak keduanya.
  it("menyebut bungkus bracketed paste sebagai control", () => {
    expect(classifyInput("\x1b[200~x\x1b[201~")).toBe("control");
  });
  it("menyebut string kosong sebagai control (tak pernah diprediksi)", () => {
    expect(classifyInput("")).toBe("control");
  });
});

describe("applySeq / rollbackSeq", () => {
  it("hanya men-toggle underline — netral terhadap warna dan latar", () => {
    expect(applySeq("ab")).toBe("\x1b[4mab\x1b[24m");
  });
  it("mundur n kolom lalu menghapus ke akhir baris", () => {
    expect(rollbackSeq(3)).toBe("\x1b[3D\x1b[K");
  });
  it("tak menghasilkan apa pun untuk n <= 0", () => {
    expect(rollbackSeq(0)).toBe("");
    expect(rollbackSeq(-1)).toBe("");
  });
});

const view = (over: Partial<View> = {}): View =>
  ({ cursorX: 4, cols: 100, line: "❯ h", deliverable: true, ...over });
const state = (over: Partial<PredictState> = {}): PredictState => ({ ...initialState(), ...over });

// SPEC-863 · aliran byte klien tmux BUKAN sumber kebenaran soal keadaan pane. Terukur pada tmux
// 3.4, 3.5a, dan 3.7b: `?1049h` milik handshake attach tmux sendiri (`smcup` terminfo) datang
// sebagai byte pertama dan pasangan `l`-nya baru dikirim saat DETACH, sementara `?1049h/l` milik
// program di DALAM pane tak pernah diteruskan sama sekali. Memindainya karena itu hanya bisa
// salah-positif, tak pernah benar-positif.
const TMUX_ATTACH_HANDSHAKE =
  "\x1b[?1049h\x1b[22;0;0t\x1b[?1h\x1b=\x1b[H\x1b[2J\x1b[?12l\x1b[?25h" +
  "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1005l\x1b[?2004h";

describe("keadaan alternate screen", () => {
  it("TIDAK menyala oleh handshake attach tmux nyata", () => {
    expect(onServerData(initialState(), TMUX_ATTACH_HANDSHAKE, 0).state.altScreen).toBe(false);
  });
  it("TIDAK memindai mode DEC dari aliran sama sekali", () => {
    for (const seq of ["\x1b[?1049h", "\x1b[?1047h", "\x1b[?47h", "\x1b[?2004h"]) {
      expect(onServerData(initialState(), seq, 0).state.altScreen).toBe(false);
    }
  });
  it("menyala dan padam hanya lewat sinyal pane dari server", () => {
    const on = onPaneAltScreen(initialState(), true);
    expect(on.altScreen).toBe(true);
    expect(onPaneAltScreen(on, false).altScreen).toBe(false);
  });
  it("tak membiarkan aliran mematikan sinyal pane yang sedang menyala", () => {
    const on = onPaneAltScreen(initialState(), true);
    expect(onServerData(on, "\x1b[?1049l teks", 0).state.altScreen).toBe(true);
  });
  // `pending` sengaja tidak disentuh: rollback tetap milik dua jalur yang sudah ada (byte server
  // berikutnya, atau TTL). Mengosongkannya di sini akan meninggalkan glyph yatim di layar.
  it("tak menyentuh prediksi yang sedang menunggu", () => {
    const s = onPaneAltScreen(state({ pending: "ab", since: 1_000 }), true);
    expect(s.pending).toBe("ab");
    expect(s.since).toBe(1_000);
  });
});

describe("looksLikePasswordPrompt", () => {
  it("mengenali prompt password yang lazim", () => {
    for (const l of ["Password:", "password for dena:", "Enter passphrase for key:",
      "PASS:", "Masukkan PIN:", "[sudo] password for dena:"]) {
      expect(looksLikePasswordPrompt(l)).toBe(true);
    }
  });
  it("tak menuduh baris kerja biasa", () => {
    for (const l of ["❯ h", "$ git push", "// password rotation adalah ADR-0117"]) {
      expect(looksLikePasswordPrompt(l)).toBe(false);
    }
  });
});

describe("canPredict", () => {
  it("mengizinkan satu karakter teks di ujung baris yang bersih", () => {
    expect(canPredict(state(), "a", view(), 0, true)).toBe(true);
  });
  it("menolak saat sakelar operator mati", () => {
    expect(canPredict(state(), "a", view(), 0, false)).toBe(false);
  });
  it("menolak saat byte tak akan pernah terkirimkan", () => {
    expect(canPredict(state(), "a", view({ deliverable: false }), 0, true)).toBe(false);
  });
  it("menolak di alternate screen", () => {
    expect(canPredict(state({ altScreen: true }), "a", view(), 0, true)).toBe(false);
  });
  it("menolak input control dan bulk", () => {
    expect(canPredict(state(), "\x1b[A", view(), 0, true)).toBe(false);
    expect(canPredict(state(), "\r", view(), 0, true)).toBe(false);
    expect(canPredict(state(), "tempelan", view(), 0, true)).toBe(false);
  });
  it("menolak dua kolom terakhir — prediksi yang membungkus baris tak bisa di-rollback dengan CUB", () => {
    expect(canPredict(state(), "a", view({ cursorX: 98, cols: 100 }), 0, true)).toBe(false);
    expect(canPredict(state(), "a", view({ cursorX: 97, cols: 100 }), 0, true)).toBe(true);
  });
  // `cursorX` dibaca hidup dari xterm dan SUDAH memuat karakter yang diprediksi sebelumnya;
  // menghitung `pending` lagi di sini akan menutup prediksi jauh sebelum tepi baris.
  it("tak menghitung pending dua kali terhadap tepi baris", () => {
    expect(canPredict(state({ pending: "xy" }), "a", view({ cursorX: 95, cols: 100 }), 0, true)).toBe(true);
  });
  it("menolak saat ekor baris di kanan kursor tak kosong", () => {
    expect(canPredict(state(), "a", view({ cursorX: 2, line: "❯ halo" }), 0, true)).toBe(false);
  });
  it("menolak pada baris berpola password", () => {
    expect(canPredict(state(), "a", view({ line: "Password:", cursorX: 10 }), 0, true)).toBe(false);
  });
  it("menolak selama cooldown suspend, lalu mengizinkan lagi sesudahnya", () => {
    const s = state({ suspendedUntil: 30_000 });
    expect(canPredict(s, "a", view(), 29_999, true)).toBe(false);
    expect(canPredict(s, "a", view(), 30_000, true)).toBe(true);
  });
});

describe("echoedPrefixLen", () => {
  it("menghitung berapa karakter pending yang sudah digambar server", () => {
    expect(echoedPrefixLen("❯ he", "el")).toBe(1);
    expect(echoedPrefixLen("❯ hel", "el")).toBe(2);
    expect(echoedPrefixLen("❯ h", "el")).toBe(0);
  });
  it("mengambil prefiks TERPANJANG, bukan yang pertama cocok", () => {
    expect(echoedPrefixLen("aaa", "aa")).toBe(2);
  });
  it("nol untuk pending kosong", () => {
    expect(echoedPrefixLen("apa pun", "")).toBe(0);
  });
});

describe("onInput", () => {
  it("menulis karakter bergaris bawah dan menyimpannya sebagai pending", () => {
    const r = onInput(initialState(), "a", view(), 1_000, true);
    expect(r.write).toBe("\x1b[4ma\x1b[24m");
    expect(r.state.pending).toBe("a");
    // SPEC-878 · jam TTL berhenti di sini dan baru dinyalakan `onDelivered`.
    expect(r.state.since).toBeNull();
  });
  it("menumpuk karakter kedua dan menghentikan lagi jam TTL yang mungkin sudah menyala", () => {
    const first = onInput(initialState(), "a", view(), 1_000, true);
    const armed = onDelivered(first.state, 1_050);
    const second = onInput(armed, "b", view({ cursorX: 5 }), 1_100, true);
    expect(second.state.pending).toBe("ab");
    expect(second.state.since).toBeNull();
  });
  it("tak menulis apa pun saat gerbang menolak", () => {
    const r = onInput(initialState(), "\r", view(), 1_000, true);
    expect(r.write).toBe("");
    expect(r.state.pending).toBe("");
  });
});

describe("onServerData", () => {
  it("mendahulukan rollback lalu data — satu string, satu write", () => {
    const s = state({ pending: "ab", since: 1_000 });
    const r = onServerData(s, "DATA", 1_050);
    expect(r.write).toBe("\x1b[2D\x1b[KDATA");
    expect(r.state.pending).toBe("");
    expect(r.state.since).toBeNull();
    expect(r.tail).toBe("ab");
  });
  it("melewatkan data apa adanya saat tak ada pending", () => {
    const r = onServerData(initialState(), "DATA", 0);
    expect(r.write).toBe("DATA");
    expect(r.tail).toBe("");
  });
  // Frame nyata SPEC-856: satu keystroke di TUI claude membalas repaint layar penuh ber-posisi
  // absolut. Prediksi tetap harus dilepas lebih dulu, dan byte server lewat tanpa disunat.
  it("melepas prediksi di depan repaint absolut TUI agen tanpa mengubah byte server", () => {
    const frame = "\x1b[38;5;174m\x1b[H ▐▛███▛█\x1b[K\x1b[8;1H❯ h\x1b[K\x1b[8;4H";
    const r = onServerData(state({ pending: "h", since: 1_000 }), frame, 1_050);
    expect(r.write).toBe("\x1b[1D\x1b[K" + frame);
    expect(r.state.altScreen).toBe(false);
  });
});

describe("reapply", () => {
  it("menghidupkan ulang hanya sisa yang belum ter-echo", () => {
    const r = reapply(initialState(), "b", view({ cursorX: 5, line: "❯ ha" }), 1_050, true);
    expect(r.write).toBe("\x1b[4mb\x1b[24m");
    expect(r.state.pending).toBe("b");
  });
  it("membuang sisa tanpa menulis apa pun bila gerbang tak lagi lolos", () => {
    const r = reapply(initialState(), "b", view({ deliverable: false }), 1_050, true);
    expect(r.write).toBe("");
    expect(r.state.pending).toBe("");
  });
  it("menolak seluruh sisa saat sebagiannya akan membungkus baris", () => {
    const r = reapply(initialState(), "bcd", view({ cursorX: 96, cols: 100, line: "" }), 1_050, true);
    expect(r.write).toBe("");
    expect(r.state.pending).toBe("");
  });
  it("diam untuk sisa kosong", () => {
    expect(reapply(initialState(), "", view(), 0, true).write).toBe("");
  });
});

describe("onTick", () => {
  it("diam selama TTL belum lewat", () => {
    const s = state({ pending: "a", since: 1_000 });
    const r = onTick(s, 1_000 + TTL_MS - 1);
    expect(r.write).toBe("");
    expect(r.missed).toBe(false);
    expect(r.state.pending).toBe("a");
  });
  // Kasus terukur: `read -s` dan dialog trust claude sama-sama membalas NOL byte. TTL adalah
  // satu-satunya sinyal yang membedakannya dari jaringan lambat.
  it("me-rollback dan menyuspend begitu TTL lewat tanpa echo", () => {
    const s = state({ pending: "ab", since: 1_000 });
    const r = onTick(s, 1_000 + TTL_MS);
    expect(r.write).toBe("\x1b[2D\x1b[K");
    expect(r.missed).toBe(true);
    expect(r.state.pending).toBe("");
    expect(r.state.suspendedUntil).toBe(1_000 + TTL_MS + SUSPEND_MS);
  });
  it("diam saat tak ada pending", () => {
    expect(onTick(initialState(), 9_999).write).toBe("");
  });
});

describe("onReattach", () => {
  it("melupakan segalanya — tmux memutar ulang layar penuh saat attach", () => {
    expect(onReattach()).toEqual(initialState());
  });
});

describe("createInputBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("menggabungkan teks yang tiba dalam satu jendela menjadi SATU frame", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", true); b.push("b", true); b.push("c", true);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(COALESCE_IN_MS);
    expect(sent).toEqual(["abc"]);
  });
  it("mengirim seketika saat coalesce dimatikan — sakelar prediksi mati tak boleh menambah latensi", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", false);
    expect(sent).toEqual(["a"]);
  });
  // SPEC-452/800/816: Enter, panah, Esc, path lampiran, dan digit dialog wajib tetap satu
  // keystroke = satu frame, dan wajib tak pernah menyalip teks yang sudah mengantre.
  it("meloloskan control seketika, sesudah menguras buffer lebih dulu", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("h", true); b.push("i", true);
    b.push("\r", true);
    expect(sent).toEqual(["hi", "\r"]);
  });
  it("meloloskan bulk (paste) seketika sebagai satu frame", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("tempelan panjang", true);
    expect(sent).toEqual(["tempelan panjang"]);
  });
  it("flush() mengosongkan buffer tanpa menunggu timer", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", true);
    b.flush();
    expect(sent).toEqual(["a"]);
  });
  it("dispose() menguras buffer — ketikan tak boleh mati bersama pane", () => {
    const sent: string[] = [];
    const b = createInputBatcher((d) => sent.push(d));
    b.push("a", true);
    b.dispose();
    expect(sent).toEqual(["a"]);
    vi.advanceTimersByTime(COALESCE_IN_MS * 4);
    expect(sent).toEqual(["a"]);
  });
});

// SPEC-878 · ADR-0134 · jam TTL hanya boleh berjalan sejak byte diketahui SAMPAI. Selama ia belum
// sampai, diamnya pty bukan bukti tentang apa pun — dan menghukumnya terukur membeli 30,5 detik
// layar bisu untuk satu kedip jaringan 500 ms.
describe("jam TTL berbasis pengiriman (SPEC-878)", () => {
  it("menolak memprediksi saat byte tak akan terkirimkan", () => {
    expect(canPredict(state(), "a", view({ deliverable: false }), 0, true)).toBe(false);
  });

  it("tetap memprediksi meski socket sedang mati, selama antrean akan terkuras", () => {
    const r = onInput(state(), "a", view(), 1_000, true);
    expect(r.write).toBe(applySeq("a"));
    expect(r.state.pending).toBe("a");
  });

  it("onInput menghentikan jam — `since` null, betapa pun lamanya menunggu", () => {
    const r = onInput(state(), "a", view(), 1_000, true);
    expect(r.state.since).toBeNull();
    const t = onTick(r.state, 1_000 + TTL_MS * 100);
    expect(t.write).toBe("");
    expect(t.missed).toBe(false);
    expect(t.state.pending).toBe("a");
    expect(t.state.suspendedUntil).toBe(0);
  });

  it("onDelivered menyalakan jam, dan TTL kembali menggigit sesudahnya", () => {
    const typed = onInput(state(), "a", view(), 1_000, true).state;
    const armed = onDelivered(typed, 5_000);
    expect(armed.since).toBe(5_000);
    expect(onTick(armed, 5_000 + TTL_MS - 1).write).toBe("");
    const fired = onTick(armed, 5_000 + TTL_MS);
    expect(fired.missed).toBe(true);
    expect(fired.write).toBe(rollbackSeq(1));
    expect(fired.state.suspendedUntil).toBe(5_000 + TTL_MS + SUSPEND_MS);
  });

  it("onDelivered tak menyentuh apa pun tanpa prediksi tertunda", () => {
    expect(onDelivered(state(), 9_000).since).toBeNull();
  });

  it("onDelivered tak memundurkan jam yang sudah menyala", () => {
    const armed = onDelivered(onInput(state(), "a", view(), 0, true).state, 100);
    expect(onDelivered(armed, 400).since).toBe(100);
  });

  it("reapply menyerahkan penyalaan jam ke pemanggil, bukan menyetelnya sendiri", () => {
    const r = reapply(state(), "ab", view({ cursorX: 2, line: "❯ " }), 7_000, true);
    expect(r.state.pending).toBe("ab");
    expect(r.state.since).toBeNull();
  });
});
