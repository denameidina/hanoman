import { describe, it, expect } from "vitest";
import { isTerminalResponse } from "./terminal-io";

describe("isTerminalResponse (SPEC-860, dipakai dua sisi sejak SPEC-878)", () => {
  it("menyebut balasan handshake murni sebagai balasan", () => {
    for (const r of ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[0n", "\x1b]11;rgb:0000/0000/0000\x1b\\"]) {
      expect(isTerminalResponse(r)).toBe(true);
    }
    expect(isTerminalResponse("\x1b[?1;2c\x1b[>0;276;0c")).toBe(true);
  });

  it("menyebut ketikan manusia BUKAN balasan", () => {
    for (const k of ["a", "\r", "\x1b[A", "\x1bOA", "\x1b[3~", ""]) {
      expect(isTerminalResponse(k)).toBe(false);
    }
  });

  // Sifat inilah yang memindahkan predikat ini ke shared: satu blob campuran menembus gerbang
  // `writeTo` (SPEC-860) apa adanya, jadi klien harus menolaknya SEBELUM ia sempat mengantre.
  it("menyebut balasan yang bercampur ketikan BUKAN balasan", () => {
    expect(isTerminalResponse("\x1b[?1;2cya")).toBe(false);
  });
});
