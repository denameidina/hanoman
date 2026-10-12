import { describe, it, expect } from "vitest";
import {
  parseCron, nextRun, nextRunFor, presetToExpr, exprToPreset, describeCron, isValidTimeZone,
} from "./cron-expr";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe("parseCron", () => {
  it("menerima lima field dan bentuk yang didukung", () => {
    expect(parseCron("0 7 * * *")).not.toBeNull();
    expect(parseCron("30 9 * * 1-5")).not.toBeNull();
    expect(parseCron("0 */6 * * *")).not.toBeNull();
    expect(parseCron("0,30 8-10 1,15 1-6/2 *")).not.toBeNull();
  });
  it("menolak bentuk yang tak sah", () => {
    for (const bad of ["", "0 7 * *", "0 7 * * * *", "60 7 * * *", "0 24 * * *",
      "0 7 0 * *", "0 7 * 13 *", "0 7 * * 8", "a 7 * * *", "0 7 * * 1-", "0 /2 * * *", "0 */0 * * *"]) {
      expect(parseCron(bad), bad).toBeNull();
    }
  });
  it("dow 7 dinormalkan ke 0 (Minggu)", () => {
    expect([...parseCron("0 7 * * 7")!.dow]).toEqual([0]);
  });
});

describe("nextRun", () => {
  it("harian: jatuh tempo berikutnya di hari yang sama bila jamnya belum lewat", () => {
    expect(nextRunFor("0 7 * * *", at(2026, 8, 11, 3, 0))).toEqual(at(2026, 8, 11, 7, 0));
  });
  it("harian: pindah ke besok bila jamnya sudah lewat", () => {
    expect(nextRunFor("0 7 * * *", at(2026, 8, 11, 7, 0))).toEqual(at(2026, 8, 12, 7, 0));
  });
  it("hari kerja: Sabtu 09:30 melompat ke Senin", () => {
    // 2026-08-15 adalah Sabtu.
    expect(nextRunFor("30 9 * * 1-5", at(2026, 8, 15, 0, 0))).toEqual(at(2026, 8, 17, 9, 30));
  });
  it("mingguan: Senin berikutnya", () => {
    expect(nextRunFor("0 8 * * 1", at(2026, 8, 11, 9, 0))).toEqual(at(2026, 8, 17, 8, 0));
  });
  it("tiap N jam: kelipatan berikutnya", () => {
    expect(nextRunFor("0 */6 * * *", at(2026, 8, 11, 7, 30))).toEqual(at(2026, 8, 11, 12, 0));
  });
  it("melompati batas bulan", () => {
    expect(nextRunFor("0 0 1 * *", at(2026, 8, 20, 12, 0))).toEqual(at(2026, 9, 1, 0, 0));
  });
  it("tanggal & hari-pekan sama-sama dibatasi → OR (aturan Vixie)", () => {
    // 2026-08-12 Rabu; dom=15 ATAU dow=3 → Rabu 12 Agustus lebih dulu daripada tanggal 15.
    expect(nextRunFor("0 0 15 * 3", at(2026, 8, 11, 12, 0))).toEqual(at(2026, 8, 12, 0, 0));
  });
  it("hasilnya SELALU lebih besar dari `after` (invarian DST)", () => {
    const spec = parseCron("*/1 * * * *")!;
    let cur = at(2026, 3, 1, 0, 0);
    for (let i = 0; i < 200; i++) {
      const nxt = nextRun(spec, cur)!;
      expect(nxt.getTime()).toBeGreaterThan(cur.getTime());
      cur = nxt;
    }
  });
  it("mengembalikan null bila tak ada yang cocok dalam batas hari", () => {
    // 30 Februari tak pernah ada.
    expect(nextRunFor("0 0 30 2 *", at(2026, 1, 1))).toBeNull();
  });
});

describe("preset", () => {
  it("round-trip keempat bentuk", () => {
    const presets = [
      { kind: "harian", hour: 7, minute: 0 },
      { kind: "hari-kerja", hour: 9, minute: 30 },
      { kind: "mingguan", hour: 8, minute: 5, weekday: 1 },
      { kind: "tiap-n-jam", everyHours: 6, minute: 0 },
    ] as const;
    for (const p of presets) expect(exprToPreset(presetToExpr(p))).toEqual(p);
  });
  it("expr lanjutan tak punya preset", () => {
    expect(exprToPreset("0,30 8-10 1,15 * *")).toBeNull();
    expect(exprToPreset("0 7 1 * *")).toBeNull();
  });
});

describe("describeCron", () => {
  it("menerjemahkan preset ke bahasa manusia, sisanya apa adanya", () => {
    expect(describeCron("0 7 * * *")).toBe("setiap hari 07:00");
    expect(describeCron("30 9 * * 1-5")).toBe("hari kerja 09:30");
    expect(describeCron("0 8 * * 1")).toBe("setiap Senin 08:00");
    expect(describeCron("0 */6 * * *")).toBe("tiap 6 jam (menit 0)");
    expect(describeCron("0,30 8-10 1,15 * *")).toBe("0,30 8-10 1,15 * *");
  });
});

// ADR-0212 · `nextRunFor(expr, after, tz)`: jam dinding dalam zona IANA, lepas dari zona proses.
// Instan dituliskan eksplisit (ISO dengan offset), jadi tes ini sama di mesin mana pun.
describe("nextRunFor dengan zona (ADR-0212)", () => {
  const iso = (s: string) => new Date(s);

  it("UTC: jam dinding = UTC", () => {
    expect(nextRunFor("0 7 * * *", iso("2026-08-11T03:00:00Z"), "UTC")).toEqual(iso("2026-08-11T07:00:00Z"));
    // Tepat pada jatuh tempo → strictly after, jadi besok.
    expect(nextRunFor("0 7 * * *", iso("2026-08-11T07:00:00Z"), "UTC")).toEqual(iso("2026-08-12T07:00:00Z"));
  });

  it("Asia/Jakarta (UTC+7, tanpa DST): 07:00 WIB = 00:00Z", () => {
    expect(nextRunFor("0 7 * * *", iso("2026-08-10T23:00:00Z"), "Asia/Jakarta")).toEqual(iso("2026-08-11T00:00:00Z"));
    expect(nextRunFor("0 7 * * *", iso("2026-08-11T00:00:00Z"), "Asia/Jakarta")).toEqual(iso("2026-08-12T00:00:00Z"));
  });

  it("Asia/Jakarta: hari kerja, Sabtu 10:00 WIB melompat ke Senin 09:30 WIB", () => {
    // 2026-08-15 Sabtu; 10:00 WIB = 03:00Z. Senin 17 09:30 WIB = 02:30Z.
    expect(nextRunFor("30 9 * * 1-5", iso("2026-08-15T03:00:00Z"), "Asia/Jakarta")).toEqual(iso("2026-08-17T02:30:00Z"));
  });

  it("America/New_York, standar (EST, UTC-5): 09:00 EST = 14:00Z", () => {
    expect(nextRunFor("0 9 * * *", iso("2026-03-07T12:00:00Z"), "America/New_York")).toEqual(iso("2026-03-07T14:00:00Z"));
  });

  it("America/New_York, setelah DST musim semi (EDT, UTC-4): jam dinding 09:00 tetap, instan bergeser", () => {
    // DST mulai 2026-03-08 pukul 02:00 EST. Sesudahnya 09:00 EDT = 13:00Z.
    expect(nextRunFor("0 9 * * *", iso("2026-03-08T14:00:00Z"), "America/New_York")).toEqual(iso("2026-03-09T13:00:00Z"));
  });

  it("America/New_York, musim semi: jam yang tak ada (02:30) bergeser ke 03:30 EDT, sekali", () => {
    // 2026-03-08 02:30 tak ada. Perilaku sama dengan zona lokal JS: maju ke jam sesudah celah.
    expect(nextRunFor("30 2 * * *", iso("2026-03-08T05:00:00Z"), "America/New_York")).toEqual(iso("2026-03-08T07:30:00Z"));
    expect(nextRunFor("30 2 * * *", iso("2026-03-08T07:30:00Z"), "America/New_York")).toEqual(iso("2026-03-09T06:30:00Z"));
  });

  it("America/New_York, musim gugur: jam ganda (01:30) berjalan di kemunculan PERTAMA saja", () => {
    // 2026-11-01 pukul 02:00 EDT → 01:00 EST. 01:30 terjadi dua kali; yang pertama = 05:30Z (EDT).
    expect(nextRunFor("30 1 * * *", iso("2026-10-31T12:00:00Z"), "America/New_York")).toEqual(iso("2026-11-01T05:30:00Z"));
    // Setelah kemunculan pertama, kemunculan kedua (06:30Z) TIDAK menjadi jatuh tempo.
    expect(nextRunFor("30 1 * * *", iso("2026-11-01T05:30:00Z"), "America/New_York")).toEqual(iso("2026-11-02T06:30:00Z"));
  });

  it("invarian: hasilnya selalu > after, melintasi kedua transisi DST", () => {
    let cur = iso("2026-03-07T00:00:00Z");
    for (let i = 0; i < 200; i++) {
      const nxt = nextRunFor("*/30 * * * *", cur, "America/New_York")!;
      expect(nxt.getTime()).toBeGreaterThan(cur.getTime());
      cur = nxt;
    }
    // 200 langkah 30 menit = 4 hari: transisi musim semi (8 Mar) sudah terlewati.
    expect(cur.getTime()).toBeGreaterThan(iso("2026-03-08T12:00:00Z").getTime());
  });

  it("zona = zona lokal proses → hasil sama dengan tanpa zona (hari tanpa transisi)", () => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const after = at(2026, 8, 11, 3, 0);
    expect(nextRunFor("0 7 * * *", after, local)).toEqual(nextRunFor("0 7 * * *", after));
    expect(nextRunFor("0 */6 * * *", after, local)).toEqual(nextRunFor("0 */6 * * *", after));
  });

  it("zona tak dikenal → null, ekspresi tak sah tetap null", () => {
    expect(nextRunFor("0 7 * * *", iso("2026-08-11T00:00:00Z"), "Mars/Olympus")).toBeNull();
    expect(nextRunFor("bukan cron", iso("2026-08-11T00:00:00Z"), "Asia/Jakarta")).toBeNull();
  });

  it("isValidTimeZone membedakan zona IANA dari teks sembarang", () => {
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
