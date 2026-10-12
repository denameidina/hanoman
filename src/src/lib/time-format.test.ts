// Audit UI/UX 2026-10 · Fase 2D — kontrak format waktu relatif (lib/time-format.ts).
import { describe, expect, it } from "vitest";
import { absoluteDate, relativeTime } from "./time-format";

// Waktu lokal eksplisit: tes ini membandingkan hari kalender, jadi tak boleh bergantung zona mesin.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 11, 12, 0);

describe("relativeTime · bentuk yang dibaca operator", () => {
  it("di bawah satu menit: baru saja", () => {
    expect(relativeTime(NOW - 0, NOW)).toBe("baru saja");
    expect(relativeTime(NOW - 59_000, NOW)).toBe("baru saja");
  });

  it("menit dan jam memakai kata penuh, tanpa singkatan mnt/m/j", () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 menit lalu");
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe("59 menit lalu");
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe("2 jam lalu");
    expect(relativeTime(NOW - (3 * 3_600_000 + 7 * 60_000), NOW)).toBe("3 jam lalu");
  });

  it("kemarin untuk hari kalender sebelumnya walau selisihnya lebih dari 24 jam", () => {
    expect(relativeTime(at(2026, 10, 10, 8, 0), at(2026, 10, 11, 9, 0))).toBe("kemarin");
  });

  it("2 sampai 6 hari: N hari lalu", () => {
    expect(relativeTime(at(2026, 10, 8, 9, 0), at(2026, 10, 11, 9, 0))).toBe("3 hari lalu");
    expect(relativeTime(at(2026, 10, 5, 9, 0), at(2026, 10, 11, 9, 0))).toBe("6 hari lalu");
  });

  it("tujuh hari atau lebih: tanggal, bukan hitungan hari", () => {
    expect(relativeTime(at(2026, 10, 1, 10, 0), at(2026, 10, 11, 12, 0))).toMatch(/^1 Okt$/);
  });

  it("tanggal menyebut tahun hanya bila beda tahun dengan sekarang", () => {
    expect(absoluteDate(at(2025, 12, 30, 10, 0), NOW)).toMatch(/30 Des 2025/);
    expect(absoluteDate(at(2026, 10, 1, 10, 0), NOW)).not.toMatch(/2026/);
  });

  it("masa depan kecil dibaca baru saja, bukan angka negatif", () => {
    expect(relativeTime(NOW + 30_000, NOW)).toBe("baru saja");
  });

  it("masukan kosong atau tak valid menghasilkan string kosong, tanpa melempar", () => {
    expect(relativeTime(null, NOW)).toBe("");
    expect(relativeTime(undefined, NOW)).toBe("");
    expect(relativeTime("", NOW)).toBe("");
    expect(relativeTime("bukan-tanggal", NOW)).toBe("");
  });

  it("menerima ISO string, epoch ms, dan Date dengan hasil sama", () => {
    const t = NOW - 5 * 60_000;
    expect(relativeTime(new Date(t).toISOString(), NOW)).toBe("5 menit lalu");
    expect(relativeTime(t, NOW)).toBe("5 menit lalu");
    expect(relativeTime(new Date(t), NOW)).toBe("5 menit lalu");
  });
});

describe("relativeTime · tidak ada bentuk lama yang bocor", () => {
  // Penyambung " lalu" dulu ditempel di luar fungsi; ini menangkap regresi ke "baru saja lalu",
  // "mnt", "5m lalu", dan "2j lalu" di seluruh rentang selisih.
  const diffs = [0, 20_000, 61_000, 5 * 60_000, 59 * 60_000, 60 * 60_000, 2 * 3_600_000, 23 * 3_600_000,
    25 * 3_600_000, 3 * 86_400_000, 9 * 86_400_000, 40 * 86_400_000];
  it("tak pernah memuat baru saja lalu, mnt, atau singkatan m/j/h lalu", () => {
    for (const d of diffs) {
      const out = relativeTime(NOW - d, NOW);
      expect(out, `selisih ${d} ms`).not.toMatch(/baru saja lalu/);
      expect(out, `selisih ${d} ms`).not.toMatch(/\bmnt\b|\d[mjh] lalu/);
      expect(out.length, `selisih ${d} ms`).toBeGreaterThan(0);
    }
  });
});
