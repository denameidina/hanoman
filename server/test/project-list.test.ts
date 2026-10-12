// ADR-0212 · fungsi murni urutan & penyaring perhatian. Tanpa DB.
import { describe, it, expect } from "vitest";
import { attentionRank, needsAttention, sortByAttention, boolParam } from "../src/services/project-list";

type P = { id: string; name: string; docStatus: "ok" | "drift" | "broken" };
const p = (id: string, name: string, docStatus: P["docStatus"]): P => ({ id, name, docStatus });

describe("attentionRank / needsAttention", () => {
  it("rusak 0, drift 1, ok 2; hanya ok yang tak butuh perhatian", () => {
    expect(attentionRank({ docStatus: "broken" })).toBe(0);
    expect(attentionRank({ docStatus: "drift" })).toBe(1);
    expect(attentionRank({ docStatus: "ok" })).toBe(2);
    expect(needsAttention({ docStatus: "broken" })).toBe(true);
    expect(needsAttention({ docStatus: "drift" })).toBe(true);
    expect(needsAttention({ docStatus: "ok" })).toBe(false);
  });
});

describe("sortByAttention", () => {
  const input: P[] = [
    p("c", "Charlie", "ok"),
    p("a", "delta", "drift"),
    p("b", "Bravo", "broken"),
    p("d", "alfa", "ok"),
    p("e", "Bravo", "broken"),
  ];

  it("rank dulu, lalu nama tanpa peduli huruf besar-kecil, lalu id", () => {
    expect(sortByAttention(input).map((x) => x.id)).toEqual(["b", "e", "a", "d", "c"]);
  });

  it("deterministik: urutan masukan apa pun menghasilkan urutan yang sama (paginasi konsisten)", () => {
    const expected = sortByAttention(input).map((x) => x.id);
    // Semua permutasi lima elemen.
    const perms = (xs: P[]): P[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) =>
      perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
    for (const perm of perms(input)) {
      expect(sortByAttention(perm).map((x) => x.id)).toEqual(expected);
    }
  });

  it("tidak mengubah array masukan", () => {
    const snapshot = input.map((x) => x.id);
    sortByAttention(input);
    expect(input.map((x) => x.id)).toEqual(snapshot);
  });

  it("daftar kosong → kosong", () => {
    expect(sortByAttention([])).toEqual([]);
  });
});

describe("boolParam", () => {
  it("kosong/tak ada → false; 1/true → true; 0/false → false; lainnya → null", () => {
    expect(boolParam(undefined)).toBe(false);
    expect(boolParam("")).toBe(false);
    expect(boolParam("1")).toBe(true);
    expect(boolParam("true")).toBe(true);
    expect(boolParam("0")).toBe(false);
    expect(boolParam("false")).toBe(false);
    expect(boolParam("yes")).toBeNull();
    expect(boolParam("TRUE")).toBeNull();
  });
});
