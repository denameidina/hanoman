import { describe, expect, it } from "vitest";
import type { PaneIO } from "../src/services/tui-dialog";
import { answerSessionDialog, readSessionDialog, screenHashOf } from "../src/services/session-dialog";

// Layar dialog nyata claude 2.1.220, dipangkas ke bagian yang dibaca tui-dialog.ts.
const SINGLE = [
  "  ←  ☐ Warna  ☐ Ukuran  →",
  "  Warna apa yang dipakai?",
  "",
  "❯ 1. merah",
  "  2. biru",
  "  3. Type something.",
  "  4. Chat about this",
  "",
  "  enter to select · esc to cancel",
].join("\n");

const MULTI = [
  "  ←  ☐ Paket  →",
  "  Paket mana yang ikut?",
  "",
  "❯ 1. [ ] alpha",
  "  2. [ ] beta",
  "  3. [ ] Type something",
  "",
  "     Submit",
  "",
  "  enter to select · esc to cancel",
].join("\n");

// Dialog trust codex: berdaftar & ber-footer, TAPI tanpa baris kolom bebas dan tanpa kolom catatan.
const TRUST = [
  "  Do you trust the files in this folder?",
  "❯ 1. Yes, proceed",
  "  2. No, exit",
  "",
  "  enter to confirm · esc to cancel",
].join("\n");

const NOT_A_DIALOG = "$ pnpm dev\n  ready in 312 ms\n";

function fakeIO(screens: string[]): PaneIO & { typed: string[]; enters: number; downs: number } {
  const typed: string[] = [];
  let at = 0;
  const io = {
    typed, enters: 0, downs: 0,
    capture: () => screens[Math.min(at, screens.length - 1)]!,
    literal: (s: string) => { typed.push(s); at = Math.min(at + 1, screens.length - 1); },
    enter: () => { io.enters += 1; },
    down: () => { io.downs += 1; at = Math.min(at + 1, screens.length - 1); },
    sleep: async () => { },
  };
  return io;
}

describe("SPEC-899 · membaca dialog sesi", () => {
  it("memetakan layar single-select jadi DTO tanpa baris bebas & tanpa Chat about this", () => {
    const found = readSessionDialog(fakeIO([SINGLE]));
    expect(found).not.toBeNull();
    expect(found!.dialog.title).toBe("Warna apa yang dipakai?");
    expect(found!.dialog.multi).toBe(false);
    expect(found!.dialog.freeIndex).toBe(3);
    expect(found!.dialog.options).toEqual([
      { n: 1, label: "merah", checked: null },
      { n: 2, label: "biru", checked: null },
    ]);
    expect(found!.dialog.tabs.map((t) => t.header)).toEqual(["Warna", "Ukuran"]);
  });

  it("memetakan layar multiSelect beserta keadaan kotaknya", () => {
    const found = readSessionDialog(fakeIO([MULTI]));
    expect(found!.dialog.multi).toBe(true);
    expect(found!.dialog.options).toEqual([
      { n: 1, label: "alpha", checked: false },
      { n: 2, label: "beta", checked: false },
    ]);
  });

  it("layar bukan dialog → null", () => {
    expect(readSessionDialog(fakeIO([NOT_A_DIALOG]))).toBeNull();
  });

  it("dialog trust/izin → null: tombol dashboard tak pernah menjawab prompt izin", () => {
    expect(readSessionDialog(fakeIO([TRUST]))).toBeNull();
  });

  it("hash berubah begitu dialognya lenyap, dan sama untuk layar yang sama", () => {
    expect(screenHashOf(SINGLE)).toBe(screenHashOf(SINGLE));
    expect(screenHashOf(SINGLE)).not.toBe(screenHashOf(NOT_A_DIALOG));
  });

  it("hash TIDAK berubah saat kotak centang berbalik — itu gotcha ADR-0102 #1", () => {
    const checked = MULTI.replace("1. [ ] alpha", "1. [✔] alpha").replace("☐ Paket", "☒ Paket");
    expect(screenHashOf(checked)).toBe(screenHashOf(MULTI));
  });
});

describe("SPEC-899 · menjawab dialog sesi", () => {
  const hashOf = (s: string) => screenHashOf(s);

  it("single-select: label opsi diketik ke kolom bebas, Enter hanya setelah teks mendarat", async () => {
    const landed = SINGLE.replace("3. Type something.", "3. biru");
    const io = fakeIO([SINGLE, SINGLE, landed]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 2 }, 0);
    expect(r).toEqual({ ok: true });
    expect(io.typed).toEqual(["3", "biru"]);   // nomor kolom bebas dulu, baru prosanya
    expect(io.enters).toBe(1);
  });

  it("single-select: `text` menang atas label opsi", async () => {
    const landed = SINGLE.replace("3. Type something.", "3. hijau saja");
    const io = fakeIO([SINGLE, SINGLE, landed]);
    await answerSessionDialog(io, { screenHash: hashOf(SINGLE), text: "hijau saja" }, 0);
    expect(io.typed).toEqual(["3", "hijau saja"]);
  });

  it("multiSelect: mencentang lalu menekan Submit", async () => {
    const one = MULTI.replace("1. [ ] alpha", "1. [✔] alpha");
    const focused = one.replace("     Submit", "❯    Submit");
    const io = fakeIO([MULTI, one, one, focused]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(MULTI), choices: [1] }, 0);
    expect(r).toEqual({ ok: true });
    expect(io.typed).toEqual(["1"]);
    expect(io.enters).toBe(1);
  });

  it("hash basi → stale, dan tak satu byte pun dikirim ke pane", async () => {
    const io = fakeIO([SINGLE]);
    const r = await answerSessionDialog(io, { screenHash: "basi", choice: 1 }, 0);
    expect(r).toEqual({ ok: false, reason: "stale" });
    expect(io.typed).toEqual([]);
    expect(io.enters).toBe(0);
  });

  it("layar sudah bukan dialog → stale", async () => {
    const io = fakeIO([NOT_A_DIALOG]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 1 }, 0);
    expect(r).toEqual({ ok: false, reason: "stale" });
  });

  it("nomor baris di luar opsi layar → shape", async () => {
    const io = fakeIO([SINGLE]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 9 }, 0);
    expect(r).toEqual({ ok: false, reason: "shape" });
    expect(io.typed).toEqual([]);
  });

  it("`choices` di layar single → shape", async () => {
    const io = fakeIO([SINGLE]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choices: [1] }, 0);
    expect(r).toEqual({ ok: false, reason: "shape" });
  });

  it("teks tak mendarat → not-landed, dan Enter TIDAK ditekan (bug SPEC-452)", async () => {
    const io = fakeIO([SINGLE]);   // layar tak pernah berubah: kolom bebas tetap placeholder
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 1 }, 0);
    expect(r).toEqual({ ok: false, reason: "not-landed" });
    expect(io.enters).toBe(0);
  });
});
