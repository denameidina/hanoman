import { describe, expect, it } from "vitest";
import {
  sameTerminalWorkspace,
  zTerminalWorkspaceV1,
  zTerminalWorkspaceWrite,
  type TerminalWorkspaceV1,
} from "./terminal-workspace";

const valid: TerminalWorkspaceV1 = {
  version: 1,
  groups: [
    { id: "g1", name: "Utama", layout: { rows: 1, cols: 2, cells: ["s1", null] } },
  ],
};

describe("terminal workspace canonical contract", () => {
  it("accepts a v1 row-major workspace and a matching base revision", () => {
    expect(zTerminalWorkspaceV1.parse(valid)).toEqual(valid);
    expect(zTerminalWorkspaceWrite.parse({ baseRevision: 4, workspace: valid }))
      .toEqual({ baseRevision: 4, workspace: valid });
  });

  it("rejects unknown versions, impossible dimensions, and out-of-range sizes", () => {
    expect(zTerminalWorkspaceV1.safeParse({ ...valid, version: 2 }).success).toBe(false);
    expect(zTerminalWorkspaceV1.safeParse({ version: 1, groups: [
      { id: "g1", name: "Utama", layout: { rows: 2, cols: 2, cells: [null] } },
    ] }).success).toBe(false);
    expect(zTerminalWorkspaceV1.safeParse({ version: 1, groups: [
      { id: "g1", name: "Utama", layout: { rows: 13, cols: 1, cells: Array(13).fill(null) } },
    ] }).success).toBe(false);
  });

  it("rejects duplicate group ids and duplicate session ids across groups", () => {
    const duplicateGroup = zTerminalWorkspaceV1.safeParse({ version: 1, groups: [
      valid.groups[0],
      { id: "g1", name: "Debug", layout: { rows: 1, cols: 1, cells: [null] } },
    ] });
    expect(duplicateGroup.success).toBe(false);
    if (!duplicateGroup.success)
      expect(duplicateGroup.error.issues.some((issue) => issue.message.includes("group id"))).toBe(true);

    const duplicateSession = zTerminalWorkspaceV1.safeParse({ version: 1, groups: [
      valid.groups[0],
      { id: "g2", name: "Debug", layout: { rows: 1, cols: 1, cells: ["s1"] } },
    ] });
    expect(duplicateSession.success).toBe(false);
    if (!duplicateSession.success)
      expect(duplicateSession.error.issues.some((issue) => issue.message.includes("sessionId"))).toBe(true);
  });

  it("normalizes surrounding id/name whitespace but rejects empty or oversized identifiers", () => {
    expect(zTerminalWorkspaceV1.parse({ version: 1, groups: [
      { id: " g1 ", name: " Utama ", layout: { rows: 1, cols: 1, cells: [" s1 "] } },
    ] })).toEqual({ version: 1, groups: [
      { id: "g1", name: "Utama", layout: { rows: 1, cols: 1, cells: ["s1"] } },
    ] });
    expect(zTerminalWorkspaceV1.safeParse({ version: 1, groups: [
      { id: "", name: "Utama", layout: { rows: 1, cols: 1, cells: [null] } },
    ] }).success).toBe(false);
    expect(zTerminalWorkspaceV1.safeParse({ version: 1, groups: [
      { id: "g1", name: "Utama", layout: { rows: 1, cols: 1, cells: ["x".repeat(257)] } },
    ] }).success).toBe(false);
  });

  it("compares canonical content rather than object identity", () => {
    expect(sameTerminalWorkspace(valid, structuredClone(valid))).toBe(true);
    expect(sameTerminalWorkspace(valid, {
      ...valid,
      groups: [{ ...valid.groups[0]!, name: "Debug" }],
    })).toBe(false);
  });
});
