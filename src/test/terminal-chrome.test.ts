import { describe, it, expect } from "vitest";
import {
  TERMINAL_KEYS, clampFontSize, dialogChoiceAt, inlineActionCount,
} from "../src/screens/terminal-chrome";

describe("inlineActionCount", () => {
  it("membiarkan semua aksi inline selagi lebarnya belum terukur", () => {
    expect(inlineActionCount(Number.POSITIVE_INFINITY, 4, 28)).toBe(4);
    expect(inlineActionCount(0, 4, 28)).toBe(4);
  });

  it("membiarkan semua aksi inline pada sel lebar", () => {
    expect(inlineActionCount(1000, 4, 28)).toBe(4);
  });

  it("menyisakan satu slot untuk tombol overflow saat tak semuanya muat", () => {
    // slot 30px (28 + gap klaster 2), tetap 96 + 50 + 2×30 = 206 → sisa 94 → 3 slot;
    // satu dipakai tombol overflow
    expect(inlineActionCount(300, 4, 28)).toBe(2);
  });

  it("meruntuhkan seluruh aksi saat pointer kasar memperbesar tiap kontrol", () => {
    // slot 46px, tetap 96 + 50 + 2×46 = 238 → sisa 62 → 1 slot, habis untuk tombol overflow
    expect(inlineActionCount(300, 4, 44)).toBe(0);
  });

  it("tak pernah mengembalikan angka negatif", () => {
    expect(inlineActionCount(80, 4, 44)).toBe(0);
  });
});

describe("dialogChoiceAt", () => {
  const dialog = [
    "❯ 1. In-memory",
    "  2. Redis",
    "  3. Tanpa cache",
    "  4. Type something.",
    "────────────────────",
    "  5. Chat about this",
    "",
    "Enter to select · ↑/↓ to navigate · Esc to cancel",
  ];

  it("mengembalikan digit baris yang di-tap saat footer dialog ada", () => {
    expect(dialogChoiceAt(dialog, 0)).toBe("1");
    expect(dialogChoiceAt(dialog, 2)).toBe("3");
    expect(dialogChoiceAt(dialog, 5)).toBe("5");
  });

  it("mengabaikan baris yang bukan opsi bernomor", () => {
    expect(dialogChoiceAt(dialog, 4)).toBeNull();
    expect(dialogChoiceAt(dialog, 99)).toBeNull();
  });

  it("tak mengirim apa pun pada layar kerja biasa walau ada baris bernomor", () => {
    const work = ["  1. langkah pertama", "  2. langkah kedua", "$ "];
    expect(dialogChoiceAt(work, 0)).toBeNull();
  });
});

describe("clampFontSize", () => {
  it("menjepit ke 10..24 dan membulatkan", () => {
    expect(clampFontSize(2)).toBe(10);
    expect(clampFontSize(99)).toBe(24);
    expect(clampFontSize(13.4)).toBe(13);
  });
});

describe("TERMINAL_KEYS", () => {
  it("memetakan tiap tombol ke SATU keystroke (SPEC-452: burst >1 karakter ditelan Ink)", () => {
    const byId = Object.fromEntries(TERMINAL_KEYS.map((k) => [k.id, k.seq]));
    expect(byId.esc).toBe("\x1b");
    expect(byId.up).toBe("\x1b[A");
    expect(byId.down).toBe("\x1b[B");
    expect(byId.left).toBe("\x1b[D");
    expect(byId.right).toBe("\x1b[C");
    expect(byId.enter).toBe("\r");
    expect(byId.tab).toBe("\t");
  });

  it("memberi tiap tombol nama aksesibel", () => {
    for (const key of TERMINAL_KEYS) expect(key.aria.length).toBeGreaterThan(0);
  });
});
