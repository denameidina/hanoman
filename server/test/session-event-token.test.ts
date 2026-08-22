import { describe, it, expect } from "vitest";
import { sessionEventToken, verifySessionEventToken } from "../src/services/session-event-token";

describe("token event sesi", () => {
  it("deterministik untuk id yang sama", () => {
    expect(sessionEventToken("spec-909")).toBe(sessionEventToken("spec-909"));
  });

  it("berbeda antar sesi — id sesi TIDAK cukup sebagai kredensial", () => {
    expect(sessionEventToken("spec-909")).not.toBe(sessionEventToken("spec-910"));
  });

  it("menerima token miliknya sendiri", () => {
    expect(verifySessionEventToken("spec-909", sessionEventToken("spec-909"))).toBe(true);
  });

  it("menolak token milik sesi tetangga", () => {
    expect(verifySessionEventToken("spec-909", sessionEventToken("spec-910"))).toBe(false);
  });

  it("menolak token kosong / bentuk salah tanpa melempar", () => {
    for (const bad of ["", "x", "!".repeat(43), sessionEventToken("spec-909") + "a"])
      expect(verifySessionEventToken("spec-909", bad)).toBe(false);
  });

  it("tak bocor lewat panjang: semua token sama panjang", () => {
    const a = sessionEventToken("a"), b = sessionEventToken("sesi-yang-namanya-jauh-lebih-panjang");
    expect(a).toHaveLength(b.length);
  });
});
