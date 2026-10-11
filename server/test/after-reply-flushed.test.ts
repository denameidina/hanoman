import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { afterReplyFlushed } from "../src/services/restart";

// ADR-0200 · "jawab dulu, mati kemudian". `POST /update/apply` dan `POST /restart` kini terjangkau
// agent token; pemanggil yang menerima koneksi putus tanpa balasan tak bisa membedakan "restart
// diterima" dari "server mati". Urutan itu ditegakkan di sini, bukan dari jeda timer.
afterEach(() => vi.useRealTimers());

describe("afterReplyFlushed", () => {
  it("TIDAK menjalankan fn sebelum balasan selesai ditulis, lalu menjalankannya sekali pada finish", () => {
    vi.useFakeTimers();
    const raw = new EventEmitter();
    const fn = vi.fn();
    afterReplyFlushed(raw as never, fn);
    vi.advanceTimersByTime(4_000);
    expect(fn).not.toHaveBeenCalled();           // balasan belum selesai → belum boleh mati
    raw.emit("finish");
    expect(fn).toHaveBeenCalledTimes(1);
    raw.emit("close"); raw.emit("finish"); vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(1);          // sekali jalan, peristiwa berikutnya diabaikan
  });

  it("socket yang sudah tertutup (close tanpa finish) tak menahan restart yang sudah dikonfirmasi", () => {
    const raw = new EventEmitter();
    const fn = vi.fn();
    afterReplyFlushed(raw as never, fn);
    raw.emit("close");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("klien yang menggantung dibatasi plafon waktu, bukan menahan restart selamanya", () => {
    vi.useFakeTimers();
    const raw = new EventEmitter();
    const fn = vi.fn();
    afterReplyFlushed(raw as never, fn, 1_000);
    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
    raw.emit("finish");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("listener dilepas sesudah jalan — tak bocor di objek response", () => {
    const raw = new EventEmitter();
    afterReplyFlushed(raw as never, () => {});
    raw.emit("finish");
    expect(raw.listenerCount("finish")).toBe(0);
    expect(raw.listenerCount("close")).toBe(0);
  });
});
