import { describe, expect, it } from "vitest";
import inventory from "../../internal/assets/illustration/inventory.json";
import {
  ILLUSTRATIONS,
  ILLUSTRATION_IDS,
  illustrationsByFamily,
} from "../src/ds/illustration-registry";

describe("illustration registry", () => {
  it("registers the authoritative 41/41 catalog without metadata drift", () => {
    expect([...ILLUSTRATION_IDS].sort()).toEqual(inventory.map((item) => item.id).sort());
    expect(Object.keys(ILLUSTRATIONS)).toHaveLength(41);

    for (const expected of inventory) {
      const actual = ILLUSTRATIONS[expected.id as keyof typeof ILLUSTRATIONS];
      expect(actual).toMatchObject({
        id: expected.id,
        filename: expected.filename,
        family: expected.family,
        subject: expected.subject,
        ratio: expected.ratio,
        alt: expected.promptIntent,
      });
      expect(actual.src).toContain(".webp");
    }

    expect(illustrationsByFamily("product-state")).toHaveLength(6);
    expect(new Set(Object.values(ILLUSTRATIONS).map((item) => item.family))).toEqual(
      new Set(inventory.map((item) => item.family)),
    );
  });
});
