import { describe, it, expect } from "vitest";
import { QA_PAYLOAD, BRIEF_PAYLOAD, GOAL_PAYLOAD, SPEC_PAYLOAD_ONEOF } from "../src/mcp-schema";

// SPEC-826 · skema MCP adalah kontrak yang dibaca agen sebelum ia memanggil apa pun. Field yang
// tak diiklankan = field yang tak pernah dikirim agen, walau server menerimanya.
describe("SPEC-826 · constraints di skema MCP payload qa", () => {
  it("ketiga bentuk payload mengiklankan constraints", () => {
    for (const shape of [BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD])
      expect(Object.keys(shape.properties ?? {})).toContain("constraints");
  });

  it("qa TIDAK mewajibkannya — kosong adalah keadaan normal (cermin SHAPE_REQUIRED)", () => {
    expect(QA_PAYLOAD.required).not.toContain("constraints");
    expect(QA_PAYLOAD.required).toEqual(["severity", "steps", "expected", "actual", "env"]);
  });

  it("kalimat oneOf mengeja bentuk qa berikut constraints", () => {
    expect(SPEC_PAYLOAD_ONEOF.description).toContain("constraints");
    expect(SPEC_PAYLOAD_ONEOF.description)
      .toContain("{severity, steps, expected, actual, env, constraints}");
  });
});
