import { describe, it, expect } from "vitest";
import { scoreText } from "./vps-status";

// ADR-0211 · skor di daftar VPS datang dari audit TERSIMPAN. null (belum pernah diaudit) dan tak
// ada field sama-sama tampil sebagai strip, bukan "0%" yang seolah-olah VPS gagal semua.
describe("scoreText", () => {
  it("skor angka tampil dengan persen", () => {
    expect(scoreText(72)).toBe("Skor 72%");
    expect(scoreText(0)).toBe("Skor 0%");
  });

  it("belum pernah diaudit (null) dan field tak ada tampil sebagai strip", () => {
    expect(scoreText(null)).toBe("Skor —");
    expect(scoreText(undefined)).toBe("Skor —");
  });
});
