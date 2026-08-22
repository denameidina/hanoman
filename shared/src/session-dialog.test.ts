import { describe, expect, it } from "vitest";
import { zSessionDialogAnswer } from "./session-dialog";
import { paths } from "./api";

describe("SPEC-899 · kontrak jawaban dialog sesi", () => {
  it("menerima jawaban single-select lewat nomor baris", () => {
    const r = zSessionDialogAnswer.safeParse({ screenHash: "abc123", choice: 2 });
    expect(r.success).toBe(true);
  });

  it("menerima jawaban multiSelect + prosa", () => {
    const r = zSessionDialogAnswer.safeParse({ screenHash: "abc123", choices: [1, 3], text: "yang ini" });
    expect(r.success).toBe(true);
  });

  it("menerima centang kosong — 'batalkan semua lalu submit' adalah jawaban yang sah", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc123", choices: [] }).success).toBe(true);
  });

  it("menolak body tanpa satu pun bentuk jawaban", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc123" }).success).toBe(false);
  });

  it("menolak choice dan choices sekaligus — dua bentuk jawaban untuk satu layar", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc", choice: 1, choices: [2] }).success).toBe(false);
  });

  it("menolak screenHash kosong: gerbang kesegaran tak boleh bisa dilewati dengan string kosong", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "", choice: 1 }).success).toBe(false);
  });

  it("menolak nomor baris nol/negatif — baris dialog dinomori mulai 1", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc", choice: 0 }).success).toBe(false);
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc", choices: [-1] }).success).toBe(false);
  });

  it("path dialog duduk di bawah prefix /terminal supaya ikut capability sessions", () => {
    expect(paths.terminalDialog("s1")).toBe("/api/terminal/sessions/s1/dialog");
    expect(paths.terminalDialogAnswer("s1")).toBe("/api/terminal/sessions/s1/dialog/answer");
  });
});
