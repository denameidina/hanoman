import { describe, it, expect } from "vitest";
import {
  parseCron, nextRun, nextRunFor, presetToExpr, exprToPreset, describeCron,
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
