import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { agoLabel, clampNumber, fmtAt, untilLabel, useServerDraft } from "../src/screens/sched-lead-shared";

// Audit UI/UX 2026-10 · 1G · helper bersama Scheduler & Lead.

describe("clampNumber", () => {
  it("kosong atau bukan angka → nilai tersimpan (fallback), bukan minimum", () => {
    expect(clampNumber("", 1, 9, 4)).toBe(4);
    expect(clampNumber("abc", 1, 9, 4)).toBe(4);
  });

  it("dijepit ke rentang dan dibulatkan bila bilangan bulat", () => {
    expect(clampNumber("0", 1, 9, 4)).toBe(1);
    expect(clampNumber("12", 1, 9, 4)).toBe(9);
    expect(clampNumber("2.6", 1, 9, 4)).toBe(3);
  });

  it("pecahan dipertahankan saat integer=false; koma desimal diterima", () => {
    expect(clampNumber("1,75", 0.1, Infinity, 2.5, false)).toBe(1.75);
  });
});

describe("waktu relatif", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  it("memakai bahasa biasa", () => {
    expect(agoLabel(null)).toBe("—");
    expect(agoLabel("2026-10-11T11:55:00Z", now)).toBe("5 menit lalu");
    expect(agoLabel("2026-10-11T10:00:00Z", now)).toBe("2 jam lalu");
    expect(untilLabel("2026-10-11T12:30:00Z", now)).toBe("30 menit lagi");
    expect(untilLabel("2026-10-11T11:00:00Z", now)).toBe("jatuh tempo");
  });
});

describe("useServerDraft", () => {
  it("draft yang belum diedit mengikuti snapshot server baru", () => {
    const { result, rerender } = renderHook(({ s }) => useServerDraft(s), { initialProps: { s: { a: "1" } } });
    rerender({ s: { a: "2" } });
    expect(result.current.draft).toEqual({ a: "2" });
    expect(result.current.dirty).toBe(false);
  });

  it("draft yang sedang diedit tak ditimpa snapshot baru", () => {
    const { result, rerender } = renderHook(({ s }) => useServerDraft(s), { initialProps: { s: { a: "1", b: "x" } } });
    act(() => result.current.setDraft({ a: "9", b: "x" }));
    rerender({ s: { a: "1", b: "y" } });   // server berubah di kolom lain
    expect(result.current.draft).toEqual({ a: "9", b: "x" });
    expect(result.current.dirty).toBe(true);
  });

  it("snapshot dengan isi sama tetapi objek baru tak mereset draft", () => {
    const { result, rerender } = renderHook(({ s }) => useServerDraft(s), { initialProps: { s: { a: "1" } } });
    act(() => result.current.setDraft({ a: "7" }));
    rerender({ s: { a: "1" } });
    expect(result.current.draft).toEqual({ a: "7" });
  });
});

// Fase 3I · jam absolut dari server ditampilkan dalam zona server, bukan zona browser.
describe("fmtAt (zona server)", () => {
  // 00:00 UTC = 07:00 WIB (Asia/Jakarta, tanpa DST). Zona yang sama dengan instan = jam berbeda.
  const iso = "2026-10-11T00:00:00Z";
  it("menampilkan jam dalam zona yang diminta", () => {
    expect(fmtAt(iso, "Asia/Jakarta")).toContain("07.00");
    expect(fmtAt(iso, "UTC")).toContain("00.00");
  });
  it("kosong atau tak valid → strip '—'", () => {
    expect(fmtAt(null)).toBe("—");
    expect(fmtAt(undefined, "UTC")).toBe("—");
    expect(fmtAt("bukan-tanggal", "UTC")).toBe("—");
  });
  it("zona yang tak dikenal Intl tak menjatuhkan render; jam tetap tampil", () => {
    expect(fmtAt(iso, "Zona/Tidak-Ada")).toContain("2026");
  });
});
