import { describe, it, expect } from "vitest";
import { paneToPresence } from "../src/services/presence/snapshot";
import type { Pane } from "../src/services/pty";

const pane = (over: Partial<Pane> = {}): Pane => ({
  id: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
  cwd: "/tmp/worktrees/spec-919", exited: false, code: 0, decision: false,
  agent: "claude", altScreen: false, activityAt: 1756000000, eventHook: true,
  startedAt: 1755999000, ...over,
});

describe("paneToPresence", () => {
  it("membawa identitas ringkas dan fase", () => {
    expect(paneToPresence(pane(), "Execute")).toEqual({
      sessionId: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
      phase: "Execute", agent: "claude", status: "working",
      startedAt: new Date(1755999000 * 1000).toISOString(),
    });
  });

  // Inilah bagian yang membuat SessionHistory LOCAL-only (schema.prisma:389) tak berlaku di sini.
  it("tidak pernah membawa cwd maupun path berkas", () => {
    const out = JSON.stringify(paneToPresence(pane(), "Execute"));
    expect(out).not.toContain("/tmp/worktrees");
    expect(out).not.toContain("cwd");
  });

  it("exited menang atas menunggu keputusan", () => {
    expect(paneToPresence(pane({ exited: true, decision: true })).status).toBe("exited");
  });

  it("decision → waiting", () => {
    expect(paneToPresence(pane({ decision: true })).status).toBe("waiting");
  });

  it("pane tanpa spec/flow/fase tetap sah", () => {
    const out = paneToPresence(pane({ specId: undefined, flow: undefined }));
    expect(out.specId).toBeUndefined();
    expect(out.flow).toBeUndefined();
    expect(out.phase).toBeUndefined();
  });

  it("startedAt 0 (tmux lama) jatuh ke epoch, bukan Invalid Date", () => {
    expect(paneToPresence(pane({ startedAt: 0 })).startedAt).toBe(new Date(0).toISOString());
  });

  /* `new Date(NaN).toISOString()` MELEMPAR, dan lemparan itu ditelan `.catch(() => [])` di
     `view.ts` serta `catch { return; }` di `sender.ts` — presence mati tanpa satu baris log.
     Karena itu NaN harus mati di sini, di fungsi murninya. */
  it("startedAt NaN tak melempar dan tak menghasilkan Invalid Date", () => {
    let out: ReturnType<typeof paneToPresence>;
    expect(() => { out = paneToPresence(pane({ startedAt: Number.NaN })); }).not.toThrow();
    expect(out!.startedAt).toBe(new Date(0).toISOString());
  });
});
