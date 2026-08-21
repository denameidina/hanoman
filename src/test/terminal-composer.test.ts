import { describe, expect, it } from "vitest";
import {
  commonPrefixLen, deltaFor, initialState, onExternalInput, onFlush, onSubmit, onText,
  statusFor, DEBOUNCE_MS, MAX_HOLD_MS, type ComposerState,
} from "../src/screens/terminal-composer";

const at = (text: string, sentPrefix: string): ComposerState => ({ text, sentPrefix });

describe("commonPrefixLen", () => {
  it("menghitung awalan sama per code point, bukan unit UTF-16", () => {
    expect(commonPrefixLen("🙂ab", "🙂ax")).toBe(2);
    expect(commonPrefixLen("", "abc")).toBe(0);
    expect(commonPrefixLen("abc", "abc")).toBe(3);
  });
});

describe("deltaFor", () => {
  it("menambah di ujung → hanya karakter baru yang dikirim", () => {
    expect(deltaFor("git st", "git sta")).toBe("a");
    expect(deltaFor("", "halo")).toBe("halo");
  });

  it("menghapus di ujung → hanya \\x7f sebanyak selisih", () => {
    expect(deltaFor("halo", "ha")).toBe("\x7f\x7f");
    expect(deltaFor("halo", "")).toBe("\x7f\x7f\x7f\x7f");
  });

  it("menyunting di tengah → \\x7f sampai titik pisah lalu sisa teks", () => {
    expect(deltaFor("git commit", "git push")).toBe("\x7f\x7f\x7f\x7f\x7f\x7fpush");
  });

  // Emoji yang dihitung sebagai dua unit UTF-16 merusak baris pty tanpa jejak di layar operator.
  it("menghitung backspace per code point untuk emoji dan huruf beraksen", () => {
    expect(deltaFor("🙂🙂", "")).toBe("\x7f\x7f");
    expect(deltaFor("🙂🙂", "🙂")).toBe("\x7f");
    expect(deltaFor("café", "caf")).toBe("\x7f");
    expect(deltaFor("a🙂", "a🚀")).toBe("\x7f🚀");
  });

  it("tak mengirim apa pun saat tak ada yang berubah", () => {
    expect(deltaFor("halo", "halo")).toBe("");
    expect(deltaFor("", "")).toBe("");
  });
});

describe("onText / onFlush", () => {
  it("onText hanya menggeser teks yang dilihat operator, tanpa menyentuh sentPrefix", () => {
    expect(onText(initialState(), "ha")).toEqual({ text: "ha", sentPrefix: "" });
    expect(onText(at("ha", "h"), "hal")).toEqual({ text: "hal", sentPrefix: "h" });
  });

  it("onFlush mengirim delta lalu memindahkan sentPrefix ke teks saat ini", () => {
    const r = onFlush(at("halo", "ha"));
    expect(r.send).toBe("lo");
    expect(r.state).toEqual({ text: "halo", sentPrefix: "halo" });
  });

  it("onFlush tanpa perubahan mengirim string kosong", () => {
    const r = onFlush(at("halo", "halo"));
    expect(r.send).toBe("");
    expect(r.state).toEqual({ text: "halo", sentPrefix: "halo" });
  });
});

describe("onSubmit", () => {
  it("menguras delta SEBELUM \\r, lalu mereset", () => {
    const r = onSubmit(at("halo", "ha"));
    expect(r.send).toBe("lo\r");
    expect(r.state).toEqual(initialState());
  });

  // Enter di baris kosong tetap sah.
  it("tetap mengirim \\r saat teksnya kosong", () => {
    expect(onSubmit(initialState()).send).toBe("\r");
  });

  it("membawa backspace ikut mendahului \\r saat operator memangkas sebelum submit", () => {
    expect(onSubmit(at("ha", "halo")).send).toBe("\x7f\x7f\r");
  });
});

describe("onExternalInput", () => {
  it("menguras delta yang tertunda LEBIH DULU, baru menihilkan text dan sentPrefix", () => {
    const r = onExternalInput(at("halo", "ha"));
    expect(r.send).toBe("lo");
    expect(r.state).toEqual(initialState());
  });

  it("tak mengirim apa pun saat tak ada delta tertunda", () => {
    const r = onExternalInput(at("halo", "halo"));
    expect(r.send).toBe("");
    expect(r.state).toEqual(initialState());
  });

  it("tak pernah memakai \\x15 sebagai selaraskan-ulang", () => {
    expect(onExternalInput(at("halo", "halo")).send).not.toContain("\x15");
    expect(onSubmit(at("x", "halo")).send).not.toContain("\x15");
  });
});

describe("statusFor", () => {
  it("mengatakan terkirim saat sambungan terbuka dan antrean kosong", () => {
    expect(statusFor("open", { n: 0, held: false })).toEqual({ kind: "sent", text: "terkirim" });
  });

  it("mengatakan berapa yang diantre saat antrean terisi dan tak ditahan", () => {
    expect(statusFor("open", { n: 7, held: false })).toEqual({ kind: "queued", text: "diantre 7" });
    expect(statusFor("retrying", { n: 7, held: false })).toEqual({ kind: "queued", text: "diantre 7" });
  });

  it("mengatakan tertahan dan menunjuk tombol Kirim di strip atas", () => {
    expect(statusFor("open", { n: 3, held: true }))
      .toEqual({ kind: "held", text: "tertahan — Kirim di atas" });
  });

  // Strip status di atas pane sudah bicara sendiri saat menyambung ulang; penanda kedua yang
  // mengatakan hal yang sama hanya menambah derau.
  it("diam saat sambungan belum terbuka dan tak ada apa pun yang menunggu", () => {
    expect(statusFor("retrying", { n: 0, held: false })).toBeNull();
    expect(statusFor("gone", { n: 0, held: false })).toBeNull();
  });
});

describe("irama kirim", () => {
  it("memakai debounce 350 ms dan kuras paksa 1 detik", () => {
    expect(DEBOUNCE_MS).toBe(350);
    expect(MAX_HOLD_MS).toBe(1_000);
  });
});
