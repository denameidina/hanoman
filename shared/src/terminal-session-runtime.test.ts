import { describe, it, expect } from "vitest";
import { zTerminalSession } from "./dto";

// SPEC-517 · varian terminal agen biasa menerima override runtime per sesi. Varian reverse
// (sesi project-level, ADR-0074) sengaja TIDAK — ia tetap mengikuti Setting.agent.
describe("zTerminalSession · varian terminal agen biasa (SPEC-517)", () => {
  it("{project} polos tetap sah dan tak membawa override apa pun", () => {
    const r = zTerminalSession.safeParse({ project: "p1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ project: "p1" });
  });

  it("membawa agent + model + effort sampai ke data hasil parse", () => {
    const r = zTerminalSession.safeParse(
      { project: "p1", agent: "codex", model: "gpt-5.6-luna", effort: "max" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject(
      { project: "p1", agent: "codex", model: "gpt-5.6-luna", effort: "max" });
  });

  it("agen di luar katalog ditolak", () => {
    expect(zTerminalSession.safeParse({ project: "p1", agent: "gemini" }).success).toBe(false);
  });

  it("flow reverse tetap sah, TANPA membawa override", () => {
    const r = zTerminalSession.safeParse({ project: "p1", flow: "reverse", agent: "codex" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ project: "p1", flow: "reverse" });
  });

  // Gerbang `flow: z.undefined()` pada varian plain. Tanpa itu, varian permisif ini menelan
  // body flow yang cacat dan melahirkan terminal biasa secara SENYAP alih-alih 400.
  it("body prd tanpa brief ditolak seluruh union — bukan jatuh jadi terminal biasa", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "prd" }).success).toBe(false);
  });

  it("flow breakdown tanpa prdPath ditolak, tak jatuh jadi terminal biasa", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "breakdown" }).success).toBe(false);
  });

  it("varian shell tetap menang atas varian plain", () => {
    const r = zTerminalSession.safeParse({ project: "p1", shell: true, agent: "codex" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ project: "p1", shell: true });
  });
});
