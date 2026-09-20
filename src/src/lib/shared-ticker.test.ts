import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscribeTick } from "./shared-ticker";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("subscribeTick", () => {
  it("lima pelanggan berbagi satu interval; semuanya dipanggil tiap detik", () => {
    const fns = Array.from({ length: 5 }, () => vi.fn());
    const off = fns.map((f) => subscribeTick(f));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    for (const f of fns) expect(f).toHaveBeenCalledTimes(2);
    off.forEach((o) => o());
  });

  it("tanpa pelanggan interval dibersihkan", () => {
    const off = subscribeTick(() => {});
    off();
    expect(vi.getTimerCount()).toBe(0);
  });
});
