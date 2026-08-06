import { describe, it, expect } from "vitest";
import { CODE_STYLE_CLAUSE } from "../src/code-style";

// SPEC-543 · ADR-0108. Kelima butir di bawah adalah objective spec-nya; mengikatnya di sini
// membuat "merapikan" klausa tak bisa diam-diam menghapus salah satunya.
describe("CODE_STYLE_CLAUSE", () => {
  it("menggerbangi dirinya sendiri di baris pertama (klausa dipasang juga di prompt non-kode)", () => {
    const first = CODE_STYLE_CLAUSE.split("\n")[0]!.toLowerCase();
    expect(first).toContain("gaya kode");
    expect(first).toMatch(/menulis atau mengubah kode/);
  });

  it("butir 1 — rapi & mengikuti idiom/penamaan/struktur sekitarnya", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const kata of ["idiom", "penamaan", "struktur"]) expect(c).toContain(kata);
  });

  it("butir 2 — melarang komentar yang mengulang kode", () => {
    expect(CODE_STYLE_CLAUSE.toLowerCase()).toContain("mengulang");
  });

  it("butir 3 — menyebut apa yang JUSTRU layak dikomentari", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const kata of ["alasan", "trade-off", "workaround", "invariant"]) expect(c).toContain(kata);
    expect(CODE_STYLE_CLAUSE).toMatch(/SPEC\/ADR/);
  });

  it("butir 4 — melarang pembatas seksi, header berhiasan, narasi langkah demi langkah", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const kata of ["pembatas seksi", "berhias", "langkah demi langkah"]) expect(c).toContain(kata);
  });

  it("butir 5 — melarang kode mati / kode yang dikomentari", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    expect(c).toContain("kode mati");
    expect(c).toContain("dikomentari");
  });

  // Pagar 1 · hanoman sendiri bergantung pada komentar ber-rujukan SPEC/ADR di titik cekiknya
  // (verify-scope.ts, brain.ts). Klausa yang terbaca "kurangi komentar" akan menghapus justru
  // informasi yang tak bisa dipulihkan dari kode.
  it("tidak melarang komentar secara umum", () => {
    expect(CODE_STYLE_CLAUSE.toLowerCase()).not.toMatch(/jangan menulis komentar\.|tanpa komentar\b/);
  });

  // Pagar 2 · SPEC-402: prompt sesi hidup di ARGV agennya, jadi nama perintah di dalam klausa
  // menjadikannya sasaran `pkill -f` milik sesi tetangga.
  it("tidak memuat nama perintah yang bisa jadi pola pkill", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const cmd of ["vitest", "tsc", "pnpm", "node ", "npm "]) expect(c).not.toContain(cmd);
  });

  // Prompt dibayar tiap sesi. Klausa yang membengkak adalah klausa yang akan dicabut.
  it("ringkas — paling banyak 10 baris", () => {
    expect(CODE_STYLE_CLAUSE.split("\n").length).toBeLessThanOrEqual(10);
  });
});
