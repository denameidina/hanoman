import { describe, it, expect } from "vitest";
import { classifyInput, applySeq, rollbackSeq } from "../src/screens/terminal-predict";

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

import { canPredict, initialState, looksLikePasswordPrompt, scanAltScreen,
  type PredictState, type View } from "../src/screens/terminal-predict";

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
