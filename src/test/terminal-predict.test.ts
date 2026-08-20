import { describe, it, expect } from "vitest";
import {
  applySeq, canPredict, classifyInput, echoedPrefixLen, initialState, looksLikePasswordPrompt,
  onInput, onReattach, onServerData, onTick, reapply, rollbackSeq, scanAltScreen,
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
  ({ cursorX: 4, cols: 100, line: "❯ h", connected: true, ...over });
const state = (over: Partial<PredictState> = {}): PredictState => ({ ...initialState(), ...over });

describe("scanAltScreen", () => {
  it("menyala pada ?1049h dan padam pada ?1049l", () => {
    expect(scanAltScreen("\x1b[?1049h", false)).toBe(true);
    expect(scanAltScreen("\x1b[?1049l", true)).toBe(false);
  });
  it("menghormati ?1047h/l juga", () => {
    expect(scanAltScreen("\x1b[?1047h", false)).toBe(true);
    expect(scanAltScreen("\x1b[?1047l", true)).toBe(false);
  });
  // Terukur di probe SPEC-856: `?47h` DAN `?2004h` sama-sama lahir dari handshake attach tmux —
  // muncul 1x pada `bash --noprofile --norc` polos, bukan hanya pada TUI agen. Mempercayainya
  // berarti prediksi mati selamanya di setiap attach.
  it("MENGABAIKAN ?47h dan ?2004h — keduanya milik handshake attach tmux", () => {
    expect(scanAltScreen("\x1b[?47h", false)).toBe(false);
    expect(scanAltScreen("\x1b[?2004h", false)).toBe(false);
  });
  it("memakai kejadian terakhir dalam satu frame", () => {
    expect(scanAltScreen("\x1b[?1049h isi \x1b[?1049l", false)).toBe(false);
  });
  it("mempertahankan keadaan saat frame tak menyebut mode apa pun", () => {
    expect(scanAltScreen("teks biasa", true)).toBe(true);
    expect(scanAltScreen("teks biasa", false)).toBe(false);
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
  it("menolak saat socket belum open", () => {
    expect(canPredict(state(), "a", view({ connected: false }), 0, true)).toBe(false);
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
    expect(r.state.since).toBe(1_000);
  });
  it("menumpuk karakter kedua tanpa memindahkan stempel TTL", () => {
    const first = onInput(initialState(), "a", view(), 1_000, true);
    const second = onInput(first.state, "b", view({ cursorX: 5 }), 1_100, true);
    expect(second.state.pending).toBe("ab");
    expect(second.state.since).toBe(1_000);
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
  it("memperbarui alt-screen dari aliran yang sama", () => {
    expect(onServerData(initialState(), "\x1b[?1049h", 0).state.altScreen).toBe(true);
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
    const r = reapply(initialState(), "b", view({ connected: false }), 1_050, true);
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
