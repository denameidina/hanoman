import { describe, expect, it } from "vitest";
import { BoundedRateLimiter } from "../src/services/bounded-rate-limit";

describe("BoundedRateLimiter", () => {
  it("never grows beyond maxKeys under attacker-controlled keys", () => {
    const limiter = new BoundedRateLimiter({ windowMs: 60_000, limit: 2, maxKeys: 16 });
    for (let i = 0; i < 100; i++) limiter.hit(`peer-${i}`, 1_000 + i);
    expect(limiter.size).toBeLessThanOrEqual(16);
  });

  it("blocks within a window, clears explicitly, and expires idle keys", () => {
    const limiter = new BoundedRateLimiter({ windowMs: 1_000, limit: 2, maxKeys: 4 });
    expect(limiter.hit("a", 0).blocked).toBe(false);
    expect(limiter.hit("a", 10).blocked).toBe(false);
    expect(limiter.hit("a", 20).blocked).toBe(true);
    limiter.clear("a");
    expect(limiter.hit("a", 30).blocked).toBe(false);
    expect(limiter.hit("a", 2_000).blocked).toBe(false);
  });
});
