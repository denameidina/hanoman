// Audit UI/UX 2026-10 · Fase 3C · kontrak hook `useSettingField`: satu aturan simpan untuk seluruh
// Pengaturan. Debounce untuk input yang diketik, langsung untuk kontrol diskret, status per field
// (Menyimpan… / Tersimpan / Gagal — coba lagi), rollback saat gagal, dan flush saat blur/unmount.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSettingField, SAVE_DEBOUNCE_MS } from "../src/screens/settings/useSettingField";

type Deferred = { resolve: (ok: boolean) => void };

/** Simpan palsu yang bisa kita selesaikan manual, supaya urutan selesainya bisa diatur. */
function deferredSave<T = string>() {
  const calls: { value: T; d: Deferred }[] = [];
  const save = vi.fn((value: T) => new Promise<boolean>((resolve) => {
    calls.push({ value, d: { resolve } });
  }));
  return { save, calls };
}

async function flush() {
  // Biarkan `.then` pada promise simpan berjalan di dalam act.
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useSettingField · debounce", () => {
  it("default 400 ms: ketikan beruntun hanya memicu satu simpan dengan nilai terakhir", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useSettingField({ value: "a", save }));
    act(() => result.current.set("ab"));
    act(() => result.current.set("abc"));
    expect(SAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
    expect(SAVE_DEBOUNCE_MS).toBeLessThanOrEqual(500);
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("pending");
    expect(result.current.value).toBe("abc");
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
    await flush();
    expect(result.current.status).toBe("saved");
  });

  it("delayMs 0 menyimpan langsung tanpa timer", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useSettingField({ value: false, save, delayMs: 0 }));
    act(() => result.current.set(true));
    expect(save).toHaveBeenCalledWith(true);
    expect(result.current.status).toBe("saving");
    await flush();
    expect(result.current.status).toBe("saved");
  });

  it("flush() menyimpan perubahan yang masih menunggu jeda (dipakai saat blur)", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useSettingField({ value: "a", save }));
    act(() => result.current.set("ab"));
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.flush());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    // Timer yang sudah dibatalkan tak menyimpan dua kali.
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush() tanpa perubahan yang menunggu tak melakukan apa pun", () => {
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useSettingField({ value: "a", save }));
    act(() => result.current.flush());
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("nilai yang sama dengan yang tersimpan dilewati tanpa PUT", () => {
    const save = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useSettingField({ value: "x", save, delayMs: 0 }));
    act(() => result.current.set("x"));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});

describe("useSettingField · status per field", () => {
  it("pending → saving → saved, lalu kembali idle setelah jeda", async () => {
    const { save, calls } = deferredSave();
    const { result } = renderHook(() => useSettingField({ value: "a", save, delayMs: 0 }));
    act(() => result.current.set("b"));
    expect(result.current.status).toBe("saving");
    await act(async () => { calls[0]!.d.resolve(true); });
    await flush();
    expect(result.current.status).toBe("saved");
    expect(result.current.value).toBe("b");
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(result.current.status).toBe("idle");
  });

  it("gagal → rollback ke nilai tersimpan dan status error; retry mengulang nilai yang gagal", async () => {
    const { save, calls } = deferredSave();
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useSettingField({ value, save, delayMs: 0 }),
      { initialProps: { value: "lama" } });
    act(() => result.current.set("baru"));
    expect(result.current.value).toBe("baru");
    await act(async () => { calls[0]!.d.resolve(false); });
    await flush();
    expect(result.current.status).toBe("error");
    // Parent membalik snapshot-nya saat gagal; hook menampilkan nilai itu, bukan draft.
    rerender({ value: "lama" });
    expect(result.current.value).toBe("lama");
    act(() => result.current.retry());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("baru");
  });

  it("simpan yang selesai setelah ada ubahan baru tak menimpa status ubahan itu", async () => {
    const { save, calls } = deferredSave();
    const { result } = renderHook(() => useSettingField({ value: "a", save, delayMs: 0 }));
    act(() => result.current.set("b"));
    act(() => result.current.set("c"));
    expect(save).toHaveBeenCalledTimes(2);
    // Yang pertama gagal, tetapi sudah basi: status & draft milik "c" tak boleh berubah.
    await act(async () => { calls[0]!.d.resolve(false); });
    await flush();
    expect(result.current.status).toBe("saving");
    expect(result.current.value).toBe("c");
    await act(async () => { calls[1]!.d.resolve(true); });
    await flush();
    expect(result.current.status).toBe("saved");
  });
});

describe("useSettingField · ubahan berurutan", () => {
  it("nilai kembali ke semula saat simpan sebelumnya masih berjalan tetap dikirim ke server", async () => {
    const { save, calls } = deferredSave<boolean>();
    const { result } = renderHook(() => useSettingField({ value: false, save, delayMs: 0 }));
    // Dua ubahan dalam satu tik, sebelum render ulang: simpan kedua tak boleh dilewati karena "sama".
    act(() => { result.current.set(true); result.current.set(false); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, false);
    await act(async () => { calls[0]!.d.resolve(true); calls[1]!.d.resolve(true); });
    await flush();
    expect(result.current.status).toBe("saved");
  });
});

describe("useSettingField · siklus hidup", () => {
  it("unmount saat ada perubahan menunggu jeda tetap menyimpannya", () => {
    const save = vi.fn(() => Promise.resolve(true));
    const { result, unmount } = renderHook(() => useSettingField({ value: "a", save }));
    act(() => result.current.set("terakhir"));
    expect(save).not.toHaveBeenCalled();
    unmount();
    expect(save).toHaveBeenCalledWith("terakhir");
  });

  it("nilai tampil mengikuti nilai tersimpan saat tak ada draft", () => {
    const save = vi.fn(() => Promise.resolve(true));
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useSettingField({ value, save }),
      { initialProps: { value: "satu" } });
    expect(result.current.value).toBe("satu");
    rerender({ value: "dua" });
    expect(result.current.value).toBe("dua");
  });
});
