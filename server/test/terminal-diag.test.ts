import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendDiag, diagFile, DIAG_MAX_BYTES } from "../src/services/terminal-diag";

const home = () => mkdtempSync(join(tmpdir(), "hanoman-diag-"));

describe("diagFile", () => {
  it("menaruh berkas per sesi di bawah $HANOMAN_HOME/diag", () => {
    expect(diagFile("/h", "spec-873")).toBe("/h/diag/spec-873.jsonl");
  });

  // Id sesi datang dari parameter route. Tanpa gerbang ini `..%2f..%2fsecret.key` menulis di luar
  // $HANOMAN_HOME — dan perekam ini menerima muatan dari klien, jadi ia permukaan tulis.
  it("menolak id yang bisa keluar dari direktori", () => {
    for (const bad of ["../x", "a/b", "", ".", "..", "a".repeat(65), "a b"]) {
      expect(() => diagFile("/h", bad)).toThrow();
    }
  });
});

describe("appendDiag", () => {
  it("menulis satu baris JSON per peristiwa", () => {
    const h = home();
    appendDiag(h, "s1", [{ t: 0, k: "key", v: "a" }, { t: 12, k: "data", v: "a" }]);
    const lines = readFileSync(diagFile(h, "s1"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ t: 0, k: "key", v: "a" });
    expect(JSON.parse(lines[1]!)).toMatchObject({ t: 12, k: "data", v: "a" });
  });

  it("menambah, bukan menimpa, di panggilan berikutnya", () => {
    const h = home();
    appendDiag(h, "s1", [{ t: 0, k: "key", v: "a" }]);
    appendDiag(h, "s1", [{ t: 1, k: "key", v: "b" }]);
    expect(readFileSync(diagFile(h, "s1"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("membuat direktori diag saat belum ada", () => {
    const h = home();
    expect(existsSync(join(h, "diag"))).toBe(false);
    appendDiag(h, "s1", [{ t: 0, k: "key", v: "a" }]);
    expect(existsSync(join(h, "diag"))).toBe(true);
  });

  // Perekam menyala berjam-jam kalau operator lupa mematikannya. $HANOMAN_HOME juga rumah DB —
  // memenuhi disknya jauh lebih merugikan daripada kehilangan diagnostik lama.
  it("memangkas berkas yang sudah melewati plafon, lalu tetap menulis", () => {
    const h = home();
    appendDiag(h, "s1", [{ t: 0, k: "key", v: "lama" }]);
    writeFileSync(diagFile(h, "s1"), "x".repeat(DIAG_MAX_BYTES + 1));
    appendDiag(h, "s1", [{ t: 1, k: "key", v: "baru" }]);
    const body = readFileSync(diagFile(h, "s1"), "utf8");
    expect(body.length).toBeLessThan(DIAG_MAX_BYTES);
    expect(body).toContain("baru");
    expect(body).not.toContain("lama");
  });

  it("mengabaikan batch kosong tanpa membuat berkas", () => {
    const h = home();
    appendDiag(h, "s1", []);
    expect(existsSync(diagFile(h, "s1"))).toBe(false);
  });

  // Muatannya datang dari klien lewat WebSocket: bentuk yang tak dikenal dibuang, tak dipercaya.
  it("membuang peristiwa yang bentuknya tak dikenal", () => {
    const h = home();
    appendDiag(h, "s1", [
      { t: 0, k: "key", v: "a" },
      { t: "x", k: "key", v: "b" } as never,
      { t: 1, k: "tidak-dikenal", v: "c" } as never,
      { t: 2, k: "data", v: 5 } as never,
    ]);
    const lines = readFileSync(diagFile(h, "s1"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).v).toBe("a");
  });
});
