import { describe, it, expect } from "vitest";
import {
  TERMINAL_KEYS, clampFontSize, dialogChoiceAt, inlineActionCount,
  shouldCollapseToTabs, MIN_PANE_WIDTH,
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
    // slot 30px (28 + gap klaster 2), tetap 96 + 50 = 146 → sisa 104 → 3 slot;
    // satu dipakai tombol overflow
    expect(inlineActionCount(250, 4, 28)).toBe(2);
    expect(inlineActionCount(250, 4, 28, 60)).toBe(0);
  });

  it("meruntuhkan seluruh aksi saat pointer kasar memperbesar tiap kontrol", () => {
    // slot 46px, tetap 146 → sisa 54 → 1 slot, habis untuk tombol overflow
    expect(inlineActionCount(200, 4, 44)).toBe(0);
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

describe("shouldCollapseToTabs", () => {
  it("tak collapse selagi lebar kontainer belum terukur (jsdom/awal mount)", () => {
    expect(shouldCollapseToTabs(2, Number.POSITIVE_INFINITY)).toBe(false);
    expect(shouldCollapseToTabs(3, 0)).toBe(false);
    expect(shouldCollapseToTabs(3, -10)).toBe(false);
  });

  it("membiarkan grid penuh saat kolom masih muat lebar minimum tiap pane", () => {
    expect(shouldCollapseToTabs(2, 800, 360)).toBe(false);
    expect(shouldCollapseToTabs(2, 720, 360)).toBe(false);
  });

  it("collapse ke tabs begitu kolom tak lagi muat lebar minimum tiap pane", () => {
    expect(shouldCollapseToTabs(2, 719, 360)).toBe(true);
    expect(shouldCollapseToTabs(3, 900, 360)).toBe(true);
  });

  it("+Kolom yang menambah cols re-evaluate ke collapse pada lebar kontainer tetap", () => {
    expect(shouldCollapseToTabs(2, 768, MIN_PANE_WIDTH)).toBe(false);
    expect(shouldCollapseToTabs(3, 768, MIN_PANE_WIDTH)).toBe(true);
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
