import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createShutdown } from "../src/services/graceful-shutdown";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Server lama yang `close()`-nya menggantung tetap hidup sebagai yatim dan berebut klien tmux
// (`attach-session -d`) dengan server baru sampai PTY sistem habis (kern.tty.ptmx_max).
describe("createShutdown", () => {
  it("close selesai: exit(0) tanpa menunggu batas waktu", async () => {
    const exit = vi.fn();
    const close = vi.fn(async () => {});
    await createShutdown({ close, exit, log: () => {} })("SIGTERM");
    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledTimes(1); expect(exit).toHaveBeenCalledWith(0);
  });

  it("close menggantung: exit dipaksa setelah batas waktu", async () => {
    const exit = vi.fn();
    void createShutdown({ close: () => new Promise(() => {}), exit, log: () => {}, timeoutMs: 5_000 })("SIGTERM");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(exit).toHaveBeenCalledTimes(1); expect(exit).toHaveBeenCalledWith(1);
  });

  it("close melempar: tetap exit", async () => {
    const exit = vi.fn();
    await createShutdown({ close: async () => { throw new Error("boom"); }, exit, log: () => {} })("SIGINT");
    expect(exit).toHaveBeenCalledOnce();
  });

  it("sinyal kedua saat sedang menutup tidak menjalankan close dua kali", async () => {
    const exit = vi.fn();
    const close = vi.fn(async () => {});
    const sd = createShutdown({ close, exit, log: () => {} });
    await Promise.all([sd("SIGTERM"), sd("SIGINT")]);
    expect(close).toHaveBeenCalledOnce();
  });
});
