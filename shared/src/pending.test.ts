import { describe, it, expect } from "vitest";
import { EMPTY_PENDING, pendingFor, pendingLabel, pendingTotal, type PendingCounts } from "./pending";

const counts = (o: Partial<PendingCounts> = {}): PendingCounts => ({ ...EMPTY_PENDING, ...o });

describe("pendingTotal", () => {
  it("menjumlahkan keempat permukaan", () =>
    expect(pendingTotal(counts({ triage: 3, backlog: 12, prd: 1, lead: 2 }))).toBe(18));
  it("nol saat tak ada yang menunggu", () => expect(pendingTotal(EMPTY_PENDING)).toBe(0));
});

describe("pendingFor", () => {
  it("mengembalikan angka permukaan yang diminta", () =>
    expect(pendingFor(counts({ triage: 3 }), "triage")).toBe(3));

  // Nol dan "belum tahu" sama-sama tak merender badge, tapi sengaja lewat jalan yang sama:
  // pemanggil tak boleh perlu membedakannya untuk memutuskan merender.
  it("nol tak pernah jadi badge", () => expect(pendingFor(counts(), "backlog")).toBeUndefined());
  it("null (server lama, ADR-0087) tak pernah jadi badge", () =>
    expect(pendingFor(null, "backlog")).toBeUndefined());

  // Sidebar memanggil ini untuk SETIAP entri nav, termasuk belasan yang memang tak punya angka.
  it("entri nav tanpa angka tak melempar", () =>
    expect(pendingFor(counts({ triage: 3 }), "terminal")).toBeUndefined());

  // Frame datang dari jaringan: field asing / bertipe salah tak boleh lolos jadi teks badge.
  it("nilai bukan angka diabaikan", () =>
    expect(pendingFor({ ...EMPTY_PENDING, triage: "9" as unknown as number }, "triage")).toBeUndefined());
  it("angka negatif diabaikan", () =>
    expect(pendingFor(counts({ lead: -1 }), "lead")).toBeUndefined());
});

describe("pendingLabel", () => {
  it("angka apa adanya sampai 99", () => expect(pendingLabel(99)).toBe("99"));
  it("dipangkas di atas 99 supaya lebar badge tetap", () => expect(pendingLabel(100)).toBe("99+"));
});
