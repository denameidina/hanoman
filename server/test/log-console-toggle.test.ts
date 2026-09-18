import { describe, expect, it, vi, beforeEach } from "vitest";
import { updateRemoteControl } from "../src/services/remote-control";
import * as consoleTap from "../src/services/logs/console-tap";
import { getSetting } from "../src/services/settings";

describe("toggle lajur server memasang/mencabut sadapan console tanpa restart", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("menyalakan logs.server memanggil installConsoleTap()", async () => {
    const spy = vi.spyOn(consoleTap, "installConsoleTap").mockImplementation(() => {});
    const before = await getSetting();
    await updateRemoteControl({ logs: { ...before.logShipping, server: true } }, "test");
    expect(spy).toHaveBeenCalled();
  });

  it("mematikan logs.server memanggil uninstallConsoleTap()", async () => {
    await updateRemoteControl({ logs: { event: true, server: true, transcript: false } }, "test");
    const spy = vi.spyOn(consoleTap, "uninstallConsoleTap").mockImplementation(() => {});
    await updateRemoteControl({ logs: { event: true, server: false, transcript: false } }, "test");
    expect(spy).toHaveBeenCalled();
  });
});
