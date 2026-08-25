import { describe, it, expect } from "vitest";
import { HN_NAV } from "../src/ds/shell";

describe("SPEC-946 · entri nav Tim", () => {
  // Ikon yang salah nama jatuh ke `Circle` tanpa satu pun error (SPEC-906) — `users` sudah
  // diverifikasi ada di lucide yang terpasang.
  it("terdaftar sebagai 'Tim' ber-ikon users (cabang App dijaga changelog-nav.test)", () => {
    const item = HN_NAV.find((n) => n.key === "team");
    expect(item).toEqual({ key: "team", label: "Tim", icon: "users" });
  });

  it("duduk TEPAT sesudah backlog", () => {
    const keys = HN_NAV.map((n) => n.key);
    expect(keys[keys.indexOf("backlog") + 1]).toBe("team");
  });

  // Papan tim tak digerbangi: ia berguna di instalasi satu mesin maupun banyak.
  it("tak digerbangi", () => {
    expect(HN_NAV.find((n) => n.key === "team")?.gate).toBeUndefined();
  });
});
