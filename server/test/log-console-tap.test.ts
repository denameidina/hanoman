import { describe, expect, it, afterEach, vi } from "vitest";
import { installConsoleTap, uninstallConsoleTap, isConsoleTapInstalled } from "../src/services/logs/console-tap";
import * as spool from "../src/services/logs/spool";

describe("console-tap", () => {
  afterEach(() => { uninstallConsoleTap(); vi.restoreAllMocks(); });

  it("meneruskan keluaran asli tanpa perubahan", () => {
    // vitest membungkus console.log sendiri untuk pelaporan test dan tak selalu menembak
    // process.stdout.write secara sinkron — jadi kita sadap console.log SEBELUM install untuk
    // memastikan tap tetap meneruskan panggilan ke fungsi asli, bukan menelannya.
    const realLog = console.log;
    const original = vi.fn();
    console.log = original;
    installConsoleTap();
    console.log("halo dunia");
    expect(original).toHaveBeenCalledWith("halo dunia");
    uninstallConsoleTap();
    console.log = realLog;
  });

  it("mencabut sadapan mengembalikan console.log ke fungsi aslinya", () => {
    const original = console.log;
    installConsoleTap();
    expect(console.log).not.toBe(original);
    uninstallConsoleTap();
    expect(console.log).toBe(original);
    expect(isConsoleTapInstalled()).toBe(false);
  });

  it("menyamarkan rahasia sebelum menulis ke spool", async () => {
    const spy = vi.spyOn(spool, "appendSpool").mockResolvedValue({ dropped: null });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    installConsoleTap();
    console.log("Authorization: Bearer abc123XYZ");
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalled();
    const written = spy.mock.calls[0]![1] as { msg: string };
    expect(written.msg).not.toContain("abc123XYZ");
    write.mockRestore();
  });

  it("menggabungkan baris identik beruntun dalam 60 detik jadi data.repeat", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(spool, "appendSpool").mockResolvedValue({ dropped: null });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    installConsoleTap();
    console.log("baris sama");
    console.log("baris sama");
    console.log("baris sama");
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
