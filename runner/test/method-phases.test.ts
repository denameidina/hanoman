import { describe, it, expect } from "vitest";
import { METHODS } from "@hanoman/shared";
import { PIPELINES } from "../src/prompt";

// SPEC-734 · assertion ini TAK BISA tinggal di `shared`: `PIPELINES` hidup di `runner`, dan
// `runner` sudah mengimpor `shared` — mengujinya dari sana berarti siklus paket. Di sini kedua
// konstanta terlihat bersamaan.
const PHASE_NAMES = new Set(Object.values(PIPELINES).flat());

describe("METHODS × PIPELINES", () => {
  it("setiap kunci phaseSkills adalah nama fase yang ADA di PIPELINES", () => {
    for (const [id, m] of Object.entries(METHODS)) {
      for (const phase of Object.keys(m.phaseSkills)) {
        expect(PHASE_NAMES.has(phase), `${id}.phaseSkills["${phase}"] bukan nama fase PIPELINES`)
          .toBe(true);
      }
    }
  });
});
