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
      severity: "minor", steps: "", expected: "o", actual: "c", env: "", constraints: "k",
    });
    expect(g.ok && g.dropped).toEqual([]);   // SPEC-826 · brief→qa tak lagi membuang constraints
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

  it("item yang sudah dimulai kini BOLEH lintas-alur, ditandai reset", () => {
    for (const to of ["qa", "audit", "goal", "no_effort"]) {
      const g = checkSourceChange(started, to);
      expect(g.ok).toBe(true);
      expect(g.ok && g.reset).toBe(true);
    }
  });

  it("lintas-alur mengonversi isi seperti item yang belum dimulai", () => {
    const g = checkSourceChange(started, "qa");
    expect(g.ok && g.payload).toEqual({
      severity: "minor", steps: "", expected: "o", actual: "c", env: "", constraints: "k",
    });
  });

  it("se-alur TIDAK mereset — brief ↔ help tetap in-place, isi tak tersentuh", () => {
    const g = checkSourceChange(started, "help");
    expect(g.ok).toBe(true);
    expect(g.ok && g.reset).toBe(false);
    expect(g.ok && g.payload).toEqual(brief);
  });

  it("item yang belum dimulai tak pernah mereset apa pun", () => {
    for (const to of ["qa", "audit", "help", "goal", "no_effort"]) {
      const g = checkSourceChange(fresh, to);
      expect(g.ok && g.reset).toBe(false);
    }
  });

  it("se-alur tetap menolak payload eksplisit — isinya memang tak berpindah", () => {
    const g = checkSourceChange(started, "help", brief);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.code).toBe(409);
  });

  it("lintas-alur MENERIMA payload eksplisit bila bentuknya cocok", () => {
    const qa = { severity: "critical", steps: "1", expected: "e", actual: "a", env: "prod" };
    const g = checkSourceChange(started, "qa", qa);
    expect(g.ok && g.payload).toEqual(qa);
    expect(g.ok && g.reset).toBe(true);
  });

  it("stage maju tanpa baseSha pun terhitung sudah dimulai (cermin SPEC-186)", () => {
    // ADR-0149 · "sudah dimulai" tak lagi berarti DITOLAK; ia berarti perpindahan lintas-alur
    // membawa harga — reset. Yang diuji di sini tetap definisi "sudah dimulai"-nya.
    const g = checkSourceChange({ ...fresh, stage: "planned" }, "qa");
    expect(g.ok).toBe(true);
    expect(g.ok && g.reset).toBe(true);
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

// SPEC-825 · `no_effort` punya flow SENDIRI, jadi perpindahan dari/ke sana pada item berjalan
// selalu lintas-alur TANPA satu baris gerbang baru. ADR-0149 · akibatnya bukan lagi penolakan
// melainkan reset — berkas fase item feature yang tak akan pernah memuaskan
// phasesComplete(["Kerjakan"]) (bentuk SPEC-433) memang dibuang, bukan dibiarkan mengganjal.
describe("SPEC-825 · no_effort", () => {
  const goal = { goal: "g", done: "d", constraints: "", priority: "sedang" };

  it("item yang sudah dimulai boleh ke no_effort, dan itu selalu mereset — flow-nya sendiri", () => {
    const g = checkSourceChange(started, "no_effort");
    expect(g.ok && g.reset).toBe(true);
  });

  it("item no_effort yang sudah dimulai mereset saat ke goal — flow-nya berbeda", () => {
    const startedNoEffort = { source: "no_effort", stage: "executing", baseSha: "abc123", payload: goal };
    const g = checkSourceChange(startedNoEffort, "goal");
    expect(g.ok && g.reset).toBe(true);
  });

  it("item belum dimulai brief → no_effort mengkonversi ke bentuk goal", () => {
    const g = checkSourceChange(fresh, "no_effort");
    expect(g.ok && g.payload).toEqual({ goal: "o", done: "", constraints: "k", priority: "sedang" });
    expect(g.ok && g.dropped).toEqual(["context"]);
  });

  it("goal → no_effort untuk item belum dimulai tak mengubah payload — sebentuk", () => {
    const freshGoal = { source: "goal", stage: "brainstorming", baseSha: null, payload: goal };
    const g = checkSourceChange(freshGoal, "no_effort");
    expect(g.ok && g.payload).toEqual(goal);
    expect(g.ok && g.dropped).toEqual([]);
  });
});
