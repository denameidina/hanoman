import { describe, expect, it, vi, beforeEach } from "vitest";
import { observePhases, __resetPhaseTap } from "../src/services/logs/phase-tap";
import * as eventLog from "../src/services/logs/event-log";

describe("observePhases", () => {
  beforeEach(() => { __resetPhaseTap(); vi.restoreAllMocks(); });

  it("menulis session.phase saat fase berubah", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "plan" }]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      kind: "session.phase", data: { from: "spec", to: "plan" },
    }));
  });

  it("tak menulis apa pun bila fase tak berubah", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    spy.mockClear();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("membuang sesi dari peta saat hilang dari snapshot, tanpa menulis event", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    spy.mockClear();
    observePhases([]);
    expect(spy).not.toHaveBeenCalled();
    // sesi dianggap baru sesudah hilang — panggilan pertama pasca-hilang adalah baseline (tak
    // menulis), lalu perubahan berikutnya memakai baseline BARU ("plan"), bukan "spec" lama —
    // membuktikan peta lama sungguh dibuang, bukan diwarisi.
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "plan" }]);
    expect(spy).not.toHaveBeenCalled();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "done" }]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ data: { from: "plan", to: "done" } }));
  });
});
