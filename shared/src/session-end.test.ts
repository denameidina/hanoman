import { describe, it, expect } from "vitest";
import { SESSION_END_REASONS, SESSION_OUTCOMES, sessionOutcome } from "./session-end";

const row = (over: Partial<Parameters<typeof sessionOutcome>[0]> = {}) => ({
  endedAt: "2026-08-19T02:00:00.000Z", endedReason: "closed" as string | null,
  exitCode: null as number | null, ...over,
});

describe("kosakata", () => {
  it("dua alasan tutup dan empat kelas hasil, apa adanya", () => {
    expect([...SESSION_END_REASONS]).toEqual(["closed", "reconciled"]);
    expect([...SESSION_OUTCOMES]).toEqual(["running", "completed", "failed", "interrupted"]);
  });
});

describe("sessionOutcome (SPEC-844)", () => {
  it("endedAt null = berjalan, apa pun kolom lainnya", () => {
    expect(sessionOutcome(row({ endedAt: null }))).toBe("running");
    expect(sessionOutcome(row({ endedAt: null, endedReason: "reconciled" }))).toBe("running");
  });

  it("ditutup hanoman: exitCode null atau 0 = selesai, selain itu gagal", () => {
    expect(sessionOutcome(row({ exitCode: null }))).toBe("completed");
    expect(sessionOutcome(row({ exitCode: 0 }))).toBe("completed");
    expect(sessionOutcome(row({ exitCode: 1 }))).toBe("failed");
    expect(sessionOutcome(row({ exitCode: 143 }))).toBe("failed");
  });

  it("direkonsiliasi = TERPUTUS, dan exitCode tak bisa membatalkannya", () => {
    expect(sessionOutcome(row({ endedReason: "reconciled" }))).toBe("interrupted");
    expect(sessionOutcome(row({ endedReason: "reconciled", exitCode: 0 }))).toBe("interrupted");
  });

  // Baris sebelum SPEC-844 (784 di DB hidup) tak punya kolom ini — mereka WAJIB terbaca persis
  // seperti sebelumnya, bukan jadi "terputus" massal.
  it("endedReason null/hilang/asing dibaca seperti `closed`", () => {
    expect(sessionOutcome(row({ endedReason: null }))).toBe("completed");
    expect(sessionOutcome({ endedAt: "2026-08-19T02:00:00.000Z", exitCode: 2 })).toBe("failed");
    expect(sessionOutcome(row({ endedReason: "entah-apa" }))).toBe("completed");
  });
});
