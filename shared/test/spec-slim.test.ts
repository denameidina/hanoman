import { describe, it, expect } from "vitest";
import { zSpec, zSpecListItem, zSpecSlim } from "../src/entities";

describe("SpecListItem / SpecSlim", () => {
  it("SpecListItem tanpa payload/sourceHistory, tetap objective", () => {
    expect("payload" in zSpecListItem.shape).toBe(false);
    expect("sourceHistory" in zSpecListItem.shape).toBe(false);
    expect("objective" in zSpecListItem.shape).toBe(true);
  });

  it("SpecSlim tanpa objective; dependsOn/blockedBy dipertahankan", () => {
    expect("objective" in zSpecSlim.shape).toBe(false);
    for (const k of ["dependsOn", "blockedBy"]) expect(k in zSpecSlim.shape).toBe(k in zSpec.shape);
  });
});
