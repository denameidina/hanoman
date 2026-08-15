import { describe, it, expect } from "vitest";
import { validateIncomingRecord } from "../src/services/sync-client";

const specData = {
  projectId: "p1", title: "t", source: "brief", stage: "planned",
  priority: "sedang", author: "a", objective: "o",
};

describe("kompat versi campur (SPEC-799 · ADR-0119)", () => {
  it("record TANPA op terbaca sebagai upsert (hub versi lama)", () => {
    expect(validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 1, data: specData }).op).toBe("upsert");
  });

  it("op hidup di TOP-LEVEL, tak menyentuh allowlist data", () => {
    expect(validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData }).op)
      .toBe("delete");
    // Penanda DI DALAM data tetap ditolak — itulah yang akan membuat client lama mandek.
    expect(() => validateIncomingRecord({
      entity: "spec", recordId: "SPEC-1", version: 2, data: { ...specData, __deleted: true },
    })).toThrow(/field/);
  });

  it("op tak dikenal → null (dilewati), BUKAN melempar", () => {
    expect(validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 2, op: "gaya-baru", data: specData }).op)
      .toBeNull();
  });

  it("data sebuah tombstone tetap lolos kontrak field entitasnya", () => {
    expect(() => validateIncomingRecord({ entity: "spec", recordId: "SPEC-1", version: 2, op: "delete", data: specData }))
      .not.toThrow();
  });
});
