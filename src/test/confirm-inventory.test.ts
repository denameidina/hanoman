// SPEC-847 · ADR-0125 · AC-4: frontend produksi tak memakai `window.confirm` untuk destructive
// product flow; pengecualian wajib menyebut alasannya lewat komentar `confirm-exempt:`.
import { describe, expect, it } from "vitest";
import { scanConfirmDir, scanHookBalance, scannedFileCount } from "./helpers/native-confirm";

const ROOT = "src/src";
const hits = scanConfirmDir(ROOT);
const where = (h: { file: string; line: number }) => `${h.file}:${h.line}`;

describe("inventaris window.confirm (SPEC-847)", () => {
  // Pemindai yang diam-diam berhenti memberi gejala persis sama dengan "semua lulus".
  it("benar-benar memindai pohon frontend", () => {
    expect(scannedFileCount(ROOT)).toBeGreaterThan(40);
  });

  it("tak ada window.confirm tanpa pengecualian beralasan", () => {
    expect(hits.filter((h) => !h.exemptReason).map(where)).toEqual([]);
  });

  it("setiap pengecualian menyebut alasan yang bermakna", () => {
    expect(hits.filter((h) => (h.exemptReason ?? "").length < 12).map(where)).toEqual([]);
  });

  // Daftar pengecualian ditulis lengkap supaya penambahan diam-diam jadi kegagalan test,
  // bukan sesuatu yang harus ditemukan lewat review.
  it("pengecualian yang diketahui persis satu", () => {
    expect(hits.map(where)).toEqual(["src/src/screens/GitGraph.tsx:137"]);
  });

  // Komponen yang memanggil useConfirm() tapi lupa merender {dialog} membuat promise-nya
  // menggantung selamanya — tanpa error, tanpa gejala. Ini penjaganya.
  it("setiap useConfirm() punya {dialog} yang dirender", () => {
    const balance = scanHookBalance(ROOT);
    // Nol call site membuat filter di bawah selalu kosong — hijau palsu dengan bentuk yang
    // sama persis seperti "semuanya benar".
    expect(balance.length).toBeGreaterThanOrEqual(8);
    const bad = balance.filter((r) => r.dialogs < r.hooks);
    expect(bad.map((r) => `${r.file} (${r.hooks} hook, ${r.dialogs} dialog)`)).toEqual([]);
  });
});
