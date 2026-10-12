import { describe, it, expect } from "vitest";
import { kategoriLabel, prioritasLabel, jaringanAtauPesan } from "../src/portal/labels";

// Satu map untuk kosakata klien: enum mentah tak pernah tampil (audit 2026-10, Portal & Public).
describe("label portal", () => {
  it("kategori mentah → label awam; nilai tak dikenal jatuh ke teksnya", () => {
    expect(kategoriLabel("bug")).toBe("Ada masalah");
    expect(kategoriLabel("fitur")).toBe("Permintaan fitur");
    expect(kategoriLabel("kategori-baru")).toBe("kategori-baru");
  });
  it("prioritas mentah → label awam", () => {
    expect(prioritasLabel("tinggi")).toBe("Prioritas tinggi");
    expect(prioritasLabel("xyz")).toBe("xyz");
  });
  it("galat jaringan diganti langkah berikutnya; galat lain memakai pesannya", () => {
    expect(jaringanAtauPesan(new TypeError("Failed to fetch"), "x")).toMatch(/Periksa koneksi/);
    expect(jaringanAtauPesan(new Error("tiket penuh"), "x")).toBe("tiket penuh");
    expect(jaringanAtauPesan(null, "fallback")).toBe("fallback");
  });
});
