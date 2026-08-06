import { describe, it, expect } from "vitest";
import { convertPayload, priorityFromSeverity, severityFromPriority } from "./spec-source";

const brief = { context: "gejalanya", outcome: "maunya", constraints: "tanpa cache", priority: "tinggi" as const };
const qa = { severity: "minor" as const, steps: "1. buka", expected: "maunya", actual: "gejalanya", env: "prod" };
const goal = { goal: "p95 < 200 ms", done: "output benchmark", constraints: "tanpa cache", priority: "rendah" as const };

describe("SPEC-546 · peta prioritas ↔ severity", () => {
  it("priorityFromSeverity mencerminkan aturan deriveSpecFields", () => {
    expect(priorityFromSeverity("minor")).toBe("sedang");
    expect(priorityFromSeverity("major")).toBe("tinggi");
    expect(priorityFromSeverity("critical")).toBe("tinggi");
  });
  it("severityFromPriority adalah invers 3→2 nilai yang dinyatakan", () => {
    expect(severityFromPriority("tinggi")).toBe("major");
    expect(severityFromPriority("sedang")).toBe("minor");
    expect(severityFromPriority("rendah")).toBe("minor");
  });
});

describe("SPEC-546 · convertPayload", () => {
  it("sebentuk (brief → audit/help) tak mengubah apa pun", () => {
    const c = convertPayload("help", brief);
    expect(c.payload).toEqual(brief);
    expect(c.dropped).toEqual([]);
    expect(c.missing).toEqual([]);
  });

  it("brief → qa: context→actual, outcome→expected, severity dari priority", () => {
    const c = convertPayload("qa", brief);
    expect(c.payload).toEqual({
      severity: "major", steps: "", expected: "maunya", actual: "gejalanya", env: "",
    });
    expect(c.dropped).toEqual(["constraints"]);
    expect(c.missing).toEqual(["steps", "env"]);
  });

  it("qa → brief: actual→context, expected→outcome, priority dari severity", () => {
    const c = convertPayload("brief", qa);
    expect(c.payload).toEqual({
      context: "gejalanya", outcome: "maunya", constraints: "", priority: "sedang",
    });
    expect(c.dropped).toEqual(["steps", "env"]);
    expect(c.missing).toEqual([]);
  });

  it("brief → goal: outcome jadi goal, context yang tak terpakai dilaporkan dropped", () => {
    const c = convertPayload("goal", brief);
    expect(c.payload).toEqual({
      goal: "maunya", done: "", constraints: "tanpa cache", priority: "tinggi",
    });
    expect(c.dropped).toEqual(["context"]);
    expect(c.missing).toEqual(["done"]);
  });

  it("brief tanpa outcome → goal: context NAIK jadi goal, jadi tak ada yang dibuang", () => {
    const c = convertPayload("goal", { ...brief, outcome: "" });
    expect(c.payload.goal).toBe("gejalanya");
    expect(c.dropped).toEqual([]);
  });

  it("goal → brief: goal jadi outcome, done dilaporkan dropped", () => {
    const c = convertPayload("brief", goal);
    expect(c.payload).toEqual({
      context: "", outcome: "p95 < 200 ms", constraints: "tanpa cache", priority: "rendah",
    });
    expect(c.dropped).toEqual(["done"]);
    expect(c.missing).toEqual(["context"]);
  });

  it("qa → goal: expected jadi goal, jejak reproduksi dilaporkan dropped", () => {
    const c = convertPayload("goal", qa);
    expect(c.payload).toEqual({ goal: "maunya", done: "", constraints: "", priority: "sedang" });
    expect(c.dropped).toEqual(["steps", "actual", "env"]);
    expect(c.missing).toEqual(["done"]);
  });

  it("goal → qa: goal jadi expected, done+constraints dilaporkan dropped", () => {
    const c = convertPayload("qa", goal);
    expect(c.payload).toEqual({
      severity: "minor", steps: "", expected: "p95 < 200 ms", actual: "", env: "",
    });
    expect(c.dropped).toEqual(["done", "constraints"]);
    expect(c.missing).toEqual(["steps", "actual", "env"]);
  });

  it("fromAudit ikut menyeberang antar brief↔qa, dan dilaporkan dropped saat ke goal", () => {
    const withAudit = { ...brief, fromAudit: "SPEC-400" };
    expect(convertPayload("qa", withAudit).payload.fromAudit).toBe("SPEC-400");
    expect(convertPayload("goal", withAudit).payload.fromAudit).toBeUndefined();
    expect(convertPayload("goal", withAudit).dropped).toEqual(["context", "fromAudit"]);
  });

  // Konstrain SPEC-546: round-trip brief → qa → brief.
  it("round-trip brief→qa→brief: prosa selamat; constraints hilang & priority bergeser sesuai peta 3→2", () => {
    const back = convertPayload("brief", convertPayload("qa", brief).payload);
    expect(back.payload.context).toBe(brief.context);
    expect(back.payload.outcome).toBe(brief.outcome);
    // Yang TIDAK selamat, dinyatakan bukan disembunyikan:
    expect(back.payload.constraints).toBe("");
    expect(convertPayload("qa", brief).dropped).toContain("constraints");
    expect(back.payload.priority).toBe("tinggi");   // tinggi → major → tinggi
    // Prioritas rendah tak bisa round-trip: peta severity hanya punya dua nilai.
    const low = convertPayload("brief", convertPayload("qa", { ...brief, priority: "rendah" }).payload);
    expect(low.payload.priority).toBe("sedang");
  });

  it("payload null (item lama) dibaca sebagai brief kosong, tak melempar", () => {
    const c = convertPayload("qa", null);
    expect(c.payload).toEqual({ severity: "minor", steps: "", expected: "", actual: "", env: "" });
    expect(c.dropped).toEqual([]);
    expect(c.missing).toEqual(["steps", "expected", "actual", "env"]);
  });
});
