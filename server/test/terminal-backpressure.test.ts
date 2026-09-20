import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBoundedSender } from "../src/services/bounded-sender";

const data = (s: string) => JSON.stringify({ t: "data", d: s });
const phase = JSON.stringify({ t: "phase", phases: [], complete: false });

function fakeWs(buffered = 0) {
  const sent: string[] = [];
  return { sent, bufferedAmount: buffered, send(s: string) { sent.push(s); } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createBoundedSender (SPEC-1267)", () => {
  it("di bawah plafon: kirim langsung", () => {
    const ws = fakeWs(0);
    createBoundedSender(ws, { high: 1000 }).send(data("a"));
    expect(ws.sent).toEqual([data("a")]);
  });

  it("di atas plafon: ditahan, lalu dikirim berurutan begitu bufferedAmount turun", () => {
    const ws = fakeWs(5000);
    const s = createBoundedSender(ws, { high: 1000, drainMs: 20 });
    s.send(data("a")); s.send(data("b"));
    expect(ws.sent).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(ws.sent).toEqual([]);
    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(20);
    expect(ws.sent).toEqual([data("a"), data("b")]);
  });

  it("penulis jauh lebih cepat: data terlama dibuang, frame kontrol utuh, resync sekali, memori berbatas", () => {
    const ws = fakeWs(5000);
    const onResync = vi.fn();
    const s = createBoundedSender(ws, { high: 1000, cap: 400, drainMs: 20, onResync });
    s.send(phase);
    for (let i = 0; i < 200; i++) s.send(data(`chunk-${i}-${"x".repeat(40)}`));
    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(20);
    expect(ws.sent[0]).toBe(phase);
    expect(ws.sent.length).toBeLessThan(20);
    expect(ws.sent.at(-1)).toBe(data(`chunk-199-${"x".repeat(40)}`));
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("dispose menghentikan timer drain", () => {
    const ws = fakeWs(5000);
    const s = createBoundedSender(ws, { high: 1000 });
    s.send(data("a"));
    s.dispose();
    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(200);
    expect(ws.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
