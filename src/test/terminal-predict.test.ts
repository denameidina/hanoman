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
