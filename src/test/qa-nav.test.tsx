import { describe, expect, it } from "vitest";
import { HN_NAV } from "../src/ds/shell";

describe("entri nav QA", () => {
  // `toEqual` eksak: sekaligus mengunci bahwa entri ini tak ber-`gate`. Ikon salah nama jatuh ke
  // `Circle` tanpa error (SPEC-906) — `clipboard-check` didaftarkan di icon-registry (Task 11).
  it("terdaftar sebagai 'QA' ber-ikon clipboard-check, tanpa gate, tepat sesudah Tim", () => {
    expect(HN_NAV.find((n) => n.key === "qa")).toEqual({ key: "qa", label: "QA", icon: "clipboard-check" });
    const keys = HN_NAV.map((n) => n.key);
    expect(keys[keys.indexOf("team") + 1]).toBe("qa");
  });
});
