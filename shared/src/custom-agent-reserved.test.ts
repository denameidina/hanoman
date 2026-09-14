import { describe, it, expect } from "vitest";
import { zCreateCustomAgent } from "./custom-agent";

// ADR-0164 · AC-13 · registry native berkunci nama: custom agent bernama `hanoman-fase-*` akan
// menimpa agen fase sesi orchestrator. Route POST /custom-agents membalas 400 dari parse ini.
describe("nama custom agent yang dicadangkan", () => {
  const base = { description: "d", instructions: "i" };
  it("menolak awalan hanoman-fase-", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, name: "hanoman-fase-plan" }).success).toBe(false);
  });
  it("nama lain tetap sah", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, name: "scout-dua" }).success).toBe(true);
  });
});
