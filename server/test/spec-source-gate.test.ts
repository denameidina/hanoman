import { describe, it, expect } from "vitest";
import { checkSourceChange, sourceChangeEntry, appendSourceHistory } from "../src/services/spec-source";

const brief = { context: "c", outcome: "o", constraints: "k", priority: "sedang" };
const fresh = { source: "brief", stage: "brainstorming", baseSha: null, payload: brief };
const started = { source: "brief", stage: "executing", baseSha: "abc123", payload: brief };

describe("SPEC-546 · ADR-0109 · gerbang konversi", () => {
  it("item belum dimulai boleh pindah ke source mana pun", () => {
    for (const to of ["qa", "audit", "help", "goal"]) {
      const g = checkSourceChange(fresh, to);
      expect(g.ok).toBe(true);
    }
  });

  it("tanpa payload, server memakai convertPayload sebagai default", () => {
    const g = checkSourceChange(fresh, "qa");
    expect(g.ok && g.payload).toEqual({
      severity: "minor", steps: "", expected: "o", actual: "c", env: "",
    });
    expect(g.ok && g.dropped).toEqual(["constraints"]);
  });

  it("payload yang dikirim dipakai apa adanya bila bentuknya cocok", () => {
    const qa = { severity: "critical", steps: "1", expected: "e", actual: "a", env: "prod" };
    const g = checkSourceChange(fresh, "qa", qa);
    expect(g.ok && g.payload).toEqual(qa);
  });

  it("payload bentuk salah ditolak 400 walau pemanggil bukan HTTP", () => {
    const g = checkSourceChange(fresh, "qa", brief);
    expect(g).toEqual({ ok: false, code: 400, error: "bentuk payload tak cocok dengan source" });
  });

  // Gerbang mengunci FLOW, bukan label (ADR-0109).
  it("item yang sudah dimulai TETAP boleh brief ↔ help — flow-nya sama", () => {
    const g = checkSourceChange(started, "help");
    expect(g.ok).toBe(true);
    expect(g.ok && g.payload).toEqual(brief);   // payload tak disentuh
  });

  it("item yang sudah dimulai DITOLAK ke source ber-flow lain", () => {
    for (const to of ["qa", "audit", "goal"]) {
      const g = checkSourceChange(started, to);
      expect(g.ok).toBe(false);
      expect(!g.ok && g.code).toBe(409);
    }
  });

  it("item yang sudah dimulai tak boleh sekalian mengubah payload", () => {
    const g = checkSourceChange(started, "help", brief);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.code).toBe(409);
  });

  it("stage maju tanpa baseSha pun terhitung sudah dimulai (cermin SPEC-186)", () => {
    const g = checkSourceChange({ ...fresh, stage: "planned" }, "qa");
    expect(g.ok).toBe(false);
  });

  it("entri jejak membawa payload LAMA utuh dan menumpuk append-only", () => {
    const e1 = sourceChangeEntry(fresh, "qa", "dena@x", new Date("2026-08-06T04:00:00Z"));
    expect(e1).toEqual({
      at: "2026-08-06T04:00:00.000Z", from: "brief", to: "qa", by: "dena@x", payload: brief,
    });
    const e2 = sourceChangeEntry({ source: "qa", payload: null }, "goal", "dena@x", new Date("2026-08-06T05:00:00Z"));
    expect(appendSourceHistory([e1], e2)).toEqual([e1, e2]);
    expect(appendSourceHistory(null, e1)).toEqual([e1]);        // kolom masih null
    expect(appendSourceHistory("rusak", e1)).toEqual([e1]);     // nilai tak terduga tak melempar
  });
});
