import { describe, expect, it } from "vitest";
import { BOOTSTRAP_ORDER, OPTIONAL_ENTITIES, PARENTS, SYNCED, isEntity, validateSyncData } from "../src/services/sync";

describe("registri sync memori (ADR-0180)", () => {
  it("projectMemory & memoryEvent tersync dan opsional; MemoryLocalState tidak", () => {
    expect(isEntity("projectMemory")).toBe(true);
    expect(isEntity("memoryEvent")).toBe(true);
    expect(isEntity("memoryLocalState")).toBe(false);
    expect([...OPTIONAL_ENTITIES].sort()).toEqual(["memoryEvent", "projectMemory"]);
    for (const e of OPTIONAL_ENTITIES) expect(SYNCED).toContain(e);
  });
  it("induk mendahului anak di bootstrap", () => {
    const i = (e: string) => BOOTSTRAP_ORDER.indexOf(e as never);
    expect(i("project")).toBeLessThan(i("projectMemory"));
    expect(i("projectMemory")).toBeLessThan(i("memoryEvent"));
    expect(PARENTS.memoryEvent).toEqual([{ field: "memoryId", entity: "projectMemory", onDelete: "cascade" }]);
  });
  it("validasi tipe: anchors/scopePaths JSON, trusted boolean, field asing ditolak", () => {
    const ok = { projectId: "p", kind: "fact", content: "c", scopePaths: [], anchors: [], status: "active",
      supersedesId: null, reviewReason: null, sourceRuntime: "human", sourceSessionId: null, sourceTokenId: null,
      sourceDeviceId: "local", commitSha: null, trusted: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect(() => validateSyncData("projectMemory", ok)).not.toThrow();
    expect(() => validateSyncData("projectMemory", { ...ok, trusted: "ya" })).toThrow();
    expect(() => validateSyncData("projectMemory", { ...ok, verdict: "valid" })).toThrow();
  });
});
