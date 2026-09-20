import { describe, it, expect } from "vitest";
import { createHiddenRing } from "./hidden-ring";

describe("createHiddenRing", () => {
  it("menyimpan chunk berurutan tanpa overflow di bawah cap", () => {
    const r = createHiddenRing(100);
    r.push("ab"); r.push("cd");
    expect(r.drain()).toEqual({ chunks: ["ab", "cd"], overflowed: false });
    expect(r.size()).toBe(0);
  });

  it("memori konstan: 10x cap tetap <= cap dan overflowed", () => {
    const r = createHiddenRing(1000);
    for (let i = 0; i < 100; i++) r.push("x".repeat(100));
    expect(r.size()).toBeLessThanOrEqual(1000);
    expect(r.drain().overflowed).toBe(true);
  });
});
