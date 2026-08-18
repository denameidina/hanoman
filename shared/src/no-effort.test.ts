import { describe, it, expect } from "vitest";
import { zFlow, flowForSource, isGoalShapedFlow } from "./dto";
import { zSpecSource } from "./enums";
import { SOURCE_PAYLOAD_ALLOF } from "./mcp-schema";

describe("SPEC-825 · source & flow no_effort", () => {
  it("setiap source punya flow, dan no_effort punya flow-nya sendiri", () => {
    for (const s of zSpecSource.options) expect(zFlow.options).toContain(flowForSource(s));
    expect(flowForSource("no_effort")).toBe("no_effort");
    expect(flowForSource("goal")).toBe("goal");
  });

  // Gerbang ADR-0109 mengunci FLOW: flow yang sama berarti item berjalan boleh pindah. Flow yang
  // berdiri sendiri itulah yang mengunci item `no_effort` berjalan tanpa satu baris gerbang baru.
  it("no_effort tak berbagi flow dengan source mana pun", () => {
    const others = zSpecSource.options.filter((s) => s !== "no_effort").map(flowForSource);
    expect(others).not.toContain("no_effort");
  });

  it("isGoalShapedFlow menandai goal & no_effort saja", () => {
    expect(zFlow.options.filter(isGoalShapedFlow)).toEqual(["goal", "no_effort"]);
  });

  it("skema MCP mengikat no_effort ke bentuk goal lewat cabang yang sama", () => {
    const goalBranch = SOURCE_PAYLOAD_ALLOF.find((b) => JSON.stringify(b.if).includes('"goal"'));
    expect(JSON.stringify(goalBranch!.if)).toContain('"no_effort"');
    expect(SOURCE_PAYLOAD_ALLOF).toHaveLength(3);
  });
});
