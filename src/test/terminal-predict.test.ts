import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySeq, canPredict, classifyInput, echoedPrefixLen, initialState, looksLikePasswordPrompt,
  COALESCE_IN_MS, createInputBatcher, onInput, onPaneAltScreen, onReattach, onServerData, onTick,
  onDelivered, reapply, rollbackSeq, echoEvidence, onEchoed, wantsEchoEvidence,
  onFrameParsed, inFlight,
  SUSPEND_MS, TTL_MS, TYPED_MAX, UNECHOED_MAX, type PredictState, type View,
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
  });
  it("melewatkan data apa adanya saat tak ada pending", () => {
    const r = onServerData(initialState(), "DATA", 0);
    expect(r.write).toBe("DATA");
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
    const fresh = onReattach(state({ pending: "ab", unechoed: "ab", typed: "x", suspendedUntil: 9, since: 1, altScreen: true }));
    const { gen, parsed, ...rest } = fresh;
    const { gen: g0, parsed: p0, ...init } = initialState();
    expect(rest).toEqual(init);
    // Hanya nomor frame yang diteruskan, supaya callback sambungan lama basi; tak ada yang in flight.
    expect(gen).toBe(parsed);
    expect(gen).toBeGreaterThan(g0);
    expect(p0).toBe(g0);
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

// Suspend yang menyembuhkan diri. Suspend lahir dari TTL yang lewat tanpa echo — sah untuk prompt
// password dan dialog yang menelan tombol, tapi pemicu palsunya nyata: TUI agen yang menggambar
// ulang >500 ms saat mesin sibuk. Dulu hukumannya rata 30 dtk tanpa jalan pulih; kini suspend
// dicabut begitu ada BUKTI pty membalas ketikan lagi (ekor teks yang diketik muncul di kiri
// kursor sesudah frame server tergambar), dan fallback-nya jauh lebih pendek.
describe("suspend yang menyembuhkan diri", () => {
  const suspended = (over: Partial<PredictState> = {}): PredictState =>
    state({ suspendedUntil: 10_000, ...over });

  it("fallback suspend jauh lebih pendek dari 30 dtk", () => {
    expect(SUSPEND_MS).toBeLessThanOrEqual(5_000);
  });

  it("onTick yang menyuspend memulai buku ketikan yang kosong", () => {
    const fired = onTick(state({ pending: "a", since: 1_000, typed: "sisa" }), 1_000 + TTL_MS);
    expect(fired.state.typed).toBe("");
    expect(fired.state.suspendedUntil).toBe(1_000 + TTL_MS + SUSPEND_MS);
  });

  it("mencatat teks yang diketik selama suspend, tanpa memprediksinya", () => {
    let s = suspended();
    for (const c of [..."ab"]) {
      const r = onInput(s, c, view(), 5_000, true);
      expect(r.write).toBe("");
      s = r.state;
    }
    expect(s.typed).toBe("ab");
    expect(wantsEchoEvidence(s, 5_000)).toBe(true);
  });

  it("control dan bulk mengosongkan buku ketikan — barisnya sudah berubah", () => {
    const s = onInput(suspended({ typed: "ab" }), "\x7f", view(), 5_000, true).state;
    expect(s.typed).toBe("");
    const t = onInput(suspended({ typed: "ab" }), "tempelan", view(), 5_000, true).state;
    expect(t.typed).toBe("");
  });

  it("buku ketikan berbatas, menyimpan ekor terbaru", () => {
    let s = suspended();
    for (let i = 0; i < TYPED_MAX + 5; i += 1) s = onInput(s, String(i % 10), view(), 5_000, true).state;
    expect(s.typed.length).toBe(TYPED_MAX);
    expect(s.typed.endsWith(String((TYPED_MAX + 4) % 10))).toBe(true);
  });

  it("di luar suspend buku ketikan tak pernah terisi", () => {
    const r = onInput(state({ typed: "basi" }), "a", view(), 20_000, true);
    expect(r.state.typed).toBe("");
    expect(wantsEchoEvidence(r.state, 20_000)).toBe(false);
  });

  it("bukti echo = ekor ketikan (≥2 huruf bila ada) persis di kiri kursor", () => {
    expect(echoEvidence("❯ ab", "ab")).toBe(true);
    expect(echoEvidence("❯ halo ab", "ab")).toBe(true);
    expect(echoEvidence("❯ b", "b")).toBe(true);          // hanya satu huruf diketik
    expect(echoEvidence("❯ a", "ab")).toBe(false);        // echo baru sampai huruf pertama
    expect(echoEvidence("Password: ", "ab")).toBe(false); // pty bungkam
    expect(echoEvidence("❯ b", "ab")).toBe(false);        // satu huruf kebetulan tak cukup
    expect(echoEvidence("", "")).toBe(false);
  });

  it("mencabut suspend begitu bukti echo tiba", () => {
    const s = suspended({ typed: "ab" });
    const healed = onEchoed(s, "❯ ab", 5_000);
    expect(healed.suspendedUntil).toBe(0);
    expect(healed.typed).toBe("");
    expect(canPredict(healed, "c", view({ line: "❯ ab", cursorX: 4 }), 5_000, true)).toBe(true);
  });

  it("tetap suspend selama pty bungkam — prompt password tak bocor lebih dari satu kedip", () => {
    const s = suspended({ typed: "s3" });
    const same = onEchoed(s, "Password: ", 5_000);
    expect(same.suspendedUntil).toBe(10_000);
    expect(same.typed).toBe("s3");
  });

  it("ketikan yang menyusul frame tak mengacaukan bukti — frame berikutnya yang mengangkatnya", () => {
    const s = suspended({ typed: "abc" });   // `c` diketik sesudah frame "ab" dibuat server
    expect(onEchoed(s, "❯ ab", 5_000).suspendedUntil).toBe(10_000);
    expect(onEchoed(s, "❯ abc", 5_000).suspendedUntil).toBe(0);
  });

  it("sesudah suspend kedaluwarsa, onEchoed hanya membersihkan buku ketikan", () => {
    const s = suspended({ typed: "ab" });
    const later = onEchoed(s, "Password: ", 10_000);
    expect(later.suspendedUntil).toBe(10_000);
    expect(later.typed).toBe("");
  });

  it("onReattach membuang buku ketikan bersama sisa keadaan lain", () => {
    expect(onReattach().typed).toBe("");
  });
});

// Re-prediksi sisa SESUDAH frame server tergambar. xterm memproses write server secara asinkron
// (hanya write pertama sesudah input pengguna yang sinkron), jadi membaca layar tepat sesudah
// `term.write` selalu melihat glyph prediksi sendiri — blok reapply lama karena itu tak pernah
// bekerja di browser nyata: huruf yang belum ter-echo lenyap sekejap sampai repaint berikutnya.
// Keputusan kini diambil di callback frame TERAKHIR yang in flight, dengan layar segar. Selama
// ada frame in flight, huruf baru ditangguhkan (tak digambar, tak masuk `pending`) — kalau
// digambar, ia mendarat DI DEPAN sisa lama di antrean xterm dan urutannya terbalik.
describe("re-prediksi sisa sesudah frame tergambar", () => {
  const typed = (s: PredictState, text: string, v: View = view()) =>
    [...text].reduce((acc, c) => onInput(acc, c, v, 1_000, true).state, s);

  it("prediksi yang digambar juga tercatat sebagai unechoed", () => {
    const s = typed(state(), "ab");
    expect(s.pending).toBe("ab");
    expect(s.unechoed).toBe("ab");
    expect(inFlight(s)).toBe(false);
  });

  it("frame server: rollback pending, naikkan gen, simpan unechoed untuk diputuskan nanti", () => {
    const s = typed(state(), "ab");
    const r = onServerData(s, "DATA", 1_050);
    expect(r.write).toBe("\x1b[2D\x1b[KDATA");
    expect(r.state.pending).toBe("");
    expect(r.state.unechoed).toBe("ab");
    expect(r.state.gen).toBe(s.gen + 1);
    expect(inFlight(r.state)).toBe(true);
  });

  it("selama in flight, huruf baru ditangguhkan: tak digambar, tak pending, masuk unechoed", () => {
    const s = onServerData(typed(state(), "ab"), "DATA", 1_050).state;
    const r = onInput(s, "c", view(), 1_060, true);
    expect(r.write).toBe("");
    expect(r.deferred).toBe(true);
    expect(r.state.pending).toBe("");
    expect(r.state.unechoed).toBe("abc");
  });

  it("callback frame yang sudah disusul frame lebih baru tak memutuskan apa pun", () => {
    const first = onServerData(typed(state(), "ab"), "A", 1_050).state;
    const second = onServerData(first, "B", 1_060).state;
    const r = onFrameParsed(second, first.gen, view({ line: "❯ a", cursorX: 3 }), 1_070, true);
    expect(r.write).toBe("");
    expect(r.state).toBe(second);
    expect(inFlight(r.state)).toBe(true);
  });

  it("frame terakhir tergambar: sisa yang belum ter-echo (termasuk yang ditangguhkan) digambar ulang berurutan", () => {
    const s = onInput(onServerData(typed(state(), "ab"), "A", 1_050).state, "c", view(), 1_060, true).state;
    // Layar sesudah frame: TUI baru meng-echo `a`.
    const r = onFrameParsed(s, s.gen, view({ line: "❯ a", cursorX: 3 }), 1_070, true);
    expect(r.write).toBe(applySeq("bc"));
    expect(r.state.pending).toBe("bc");
    expect(r.state.unechoed).toBe("bc");
    expect(r.state.since).toBeNull();           // jam TTL milik pemanggil (onDelivered)
    expect(inFlight(r.state)).toBe(false);
  });

  it("layar sudah memuat semuanya: tak ada yang digambar ulang", () => {
    const s = onServerData(typed(state(), "ab"), "A", 1_050).state;
    const r = onFrameParsed(s, s.gen, view({ line: "❯ ab", cursorX: 4 }), 1_070, true);
    expect(r.write).toBe("");
    expect(r.state.pending).toBe("");
    expect(r.state.unechoed).toBe("");
    expect(inFlight(r.state)).toBe(false);
  });

  it("gerbang gagal pada layar segar: sisa dibuang, tak ada glyph tanpa pemilik", () => {
    const s = onServerData(typed(state(), "ab"), "A", 1_050).state;
    const r = onFrameParsed(s, s.gen, view({ line: "", cursorX: 99, cols: 100 }), 1_070, true);
    expect(r.write).toBe("");
    expect(r.state.pending).toBe("");
    expect(r.state.unechoed).toBe("");
  });

  it("Backspace/control mengosongkan unechoed tapi pending tetap (masih butuh rollback)", () => {
    const s = onInput(typed(state(), "ab"), "\x7f", view(), 1_010, true).state;
    expect(s.pending).toBe("ab");
    expect(s.unechoed).toBe("");
    const t = onInput(typed(state(), "ab"), "tempelan", view(), 1_010, true).state;
    expect(t.unechoed).toBe("");
    // selama in flight pun sama: huruf yang ditangguhkan sebelum Backspace tak digambar ulang
    const f = onServerData(typed(state(), "ab"), "A", 1_050).state;
    const g = onInput(onInput(f, "c", view(), 1_060, true).state, "\x7f", view(), 1_070, true).state;
    expect(g.unechoed).toBe("");
    expect(onFrameParsed(g, g.gen, view({ line: "❯ a", cursorX: 3 }), 1_080, true).write).toBe("");
  });

  it("penolakan gerbang di luar flight memutus urutan: unechoed dikosongkan", () => {
    const s = typed(state(), "ab");
    const r = onInput(s, "c", view({ line: "❯ ab x", cursorX: 4 }), 1_010, true);   // ekor tak kosong
    expect(r.write).toBe("");
    expect(r.state.unechoed).toBe("");
    expect(r.state.pending).toBe("ab");
  });

  it("TTL yang menggigit membuang unechoed juga", () => {
    const s = onDelivered(typed(state(), "ab"), 1_000);
    const r = onTick(s, 1_000 + TTL_MS);
    expect(r.state.unechoed).toBe("");
  });

  it("onReattach menjaga kontinuitas gen: callback sambungan lama basi", () => {
    const old = onServerData(typed(state(), "ab"), "A", 1_050).state;
    const fresh = onReattach(old);
    expect(fresh.unechoed).toBe("");
    expect(fresh.gen).toBeGreaterThan(old.gen);
    expect(inFlight(fresh)).toBe(false);
    const r = onFrameParsed(fresh, old.gen, view({ line: "❯ a", cursorX: 3 }), 1_100, true);
    expect(r.write).toBe("");
    expect(r.state).toBe(fresh);
  });

  it("unechoed berbatas: huruf di luar batas tak ditangguhkan, bukan menggeser yang lama", () => {
    let s = onServerData(state(), "A", 1_050).state;
    for (let i = 0; i < UNECHOED_MAX + 3; i += 1) s = onInput(s, "x", view(), 1_060, true).state;
    expect(s.unechoed.length).toBe(UNECHOED_MAX);
  });

  it("penyembuhan suspend tetap lewat callback yang sama", () => {
    const s: PredictState = { ...onServerData(state(), "A", 1_050).state, suspendedUntil: 10_000, typed: "ab" };
    const r = onFrameParsed(s, s.gen, view({ line: "❯ ab", cursorX: 4 }), 1_070, true);
    expect(r.state.suspendedUntil).toBe(0);
    expect(r.state.typed).toBe("");
  });
});
