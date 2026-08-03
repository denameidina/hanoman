import { describe, it, expect } from "vitest";
import { zChangelogRequest, defaultRange, dayString, DEFAULT_RANGE_DAYS } from "./changelog";

describe("zChangelogRequest", () => {
  it("mode backlog boleh tanpa rentang (server mengisi default)", () => {
    expect(zChangelogRequest.safeParse({ mode: "backlog" }).success).toBe(true);
  });

  it("menolak from > to", () => {
    const r = zChangelogRequest.safeParse({ mode: "backlog", from: "2026-08-02", to: "2026-08-01" });
    expect(r.success).toBe(false);
  });

  it("menerima from == to (rentang satu hari, inklusif)", () => {
    expect(zChangelogRequest.safeParse({ mode: "backlog", from: "2026-08-01", to: "2026-08-01" }).success).toBe(true);
  });

  it("menolak tanggal yang bukan YYYY-MM-DD", () => {
    expect(zChangelogRequest.safeParse({ mode: "backlog", from: "01/08/2026" }).success).toBe(false);
  });

  it("mode commit menuntut dua revisi", () => {
    expect(zChangelogRequest.safeParse({ mode: "commit", fromSha: "abc1234", toSha: "def5678" }).success).toBe(true);
    expect(zChangelogRequest.safeParse({ mode: "commit", fromSha: "abc1234" }).success).toBe(false);
  });

  it("mode version menuntut toTag; fromTag opsional", () => {
    expect(zChangelogRequest.safeParse({ mode: "version", toTag: "v1.2.0" }).success).toBe(true);
    expect(zChangelogRequest.safeParse({ mode: "version", fromTag: "v1.1.0", toTag: "v1.2.0" }).success).toBe(true);
    expect(zChangelogRequest.safeParse({ mode: "version", fromTag: "v1.1.0" }).success).toBe(false);
  });

  it("mode tak dikenal ditolak", () => {
    expect(zChangelogRequest.safeParse({ mode: "sihir" }).success).toBe(false);
  });
});

describe("defaultRange", () => {
  // Tanggal LOKAL, bukan UTC: `new Date("2026-07-31")` adalah tengah malam UTC dan sebagai
  // batas `to` ia membuang hampir seluruh hari itu di WIB (pelajaran ADR-0090).
  it("30 hari terakhir, inklusif di kedua ujung", () => {
    const r = defaultRange(new Date(2026, 7, 3));   // 3 Agustus 2026 lokal
    expect(r.to).toBe("2026-08-03");
    expect(r.from).toBe("2026-07-05");              // 3 Agt − 29 hari
    expect(DEFAULT_RANGE_DAYS).toBe(30);
  });

  it("dayString memakai komponen LOKAL, bukan toISOString", () => {
    // 23:30 lokal 31 Des — toISOString() di zona timur akan melompat ke tahun berikutnya.
    expect(dayString(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });
});
