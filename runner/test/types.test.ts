import { describe, it, expect } from "vitest";
import { PIPELINES } from "../src/prompt";
describe("runner wiring", () => {
  it("has a pipeline for every flow", () =>
    // SPEC-407 · +goal (Goal → Verifikasi) · SPEC-825 · +no_effort (Kerjakan)
    expect(Object.keys(PIPELINES).sort()).toEqual(["audit", "breakdown", "feature", "goal", "no_effort", "prd", "qa", "reverse", "scaffold"]));
});
