import { describe, it, expect } from "vitest";
import { nextBackoff, withJitter, RECONNECT_MIN_MS, RECONNECT_MAX_MS } from "../src/services/sync-client";

describe("backoff reconnect sync", () => {
  it("mulai dari minimum lalu berlipat", () => {
    expect(nextBackoff(0)).toBe(RECONNECT_MIN_MS);
    expect(nextBackoff(RECONNECT_MIN_MS)).toBe(RECONNECT_MIN_MS * 2);
    expect(nextBackoff(4_000)).toBe(8_000);
  });

  it("dijepit di plafon", () => {
    expect(nextBackoff(RECONNECT_MAX_MS)).toBe(RECONNECT_MAX_MS);
    expect(nextBackoff(RECONNECT_MAX_MS * 4)).toBe(RECONNECT_MAX_MS);
  });

  it("jitter ±20% dan deterministik terhadap sumber acaknya", () => {
    expect(withJitter(10_000, () => 0)).toBe(8_000);
    expect(withJitter(10_000, () => 1)).toBe(12_000);
    expect(withJitter(10_000, () => 0.5)).toBe(10_000);
  });
});
