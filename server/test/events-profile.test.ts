import { describe, it, expect, vi } from "vitest";

describe("events-profile", () => {
  it("mati: profStart tak memanggil hrtime", async () => {
    delete process.env.HANOMAN_EVENTS_PROFILE;
    vi.resetModules();
    const spy = vi.spyOn(process.hrtime, "bigint");
    const m = await import("../src/services/events-profile");
    expect(m.profStart()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("hidup: profEnd mengakumulasi per grup", async () => {
    process.env.HANOMAN_EVENTS_PROFILE = "1";
    vi.resetModules();
    const m = await import("../src/services/events-profile");
    const t0 = m.profStart();
    m.profEnd("specs", t0, 1234, true);
    expect(m.__snapshot().specs.frames).toBe(1);
    expect(m.__snapshot().specs.bytes).toBe(1234);
    delete process.env.HANOMAN_EVENTS_PROFILE;
  });
});
