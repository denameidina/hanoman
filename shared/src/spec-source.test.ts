import { describe, it, expect } from "vitest";
import { payloadShapeFor, shapeOfPayload, payloadMatchesSource } from "./spec-source";
import { zCreateSpec, zChangeSpecSource } from "./dto";
import { zSpecSource } from "./enums";

const brief = { context: "c", outcome: "o", constraints: "", priority: "sedang" as const };
const qa = { severity: "major" as const, steps: "s", expected: "e", actual: "a", env: "prod" };
const goal = { goal: "g", done: "d", constraints: "", priority: "sedang" as const };

describe("SPEC-546 · bentuk payload per source (satu predikat)", () => {
  it("enam source memetakan ke tiga bentuk", () => {
    expect(zSpecSource.options).toEqual(["brief", "qa", "audit", "help", "goal", "no_effort"]);
    expect(zSpecSource.options.map(payloadShapeFor))
      .toEqual(["brief", "qa", "brief", "brief", "goal", "goal"]);
  });

  it("shapeOfPayload mengenali ketiga bentuk; payload null dibaca sebagai brief", () => {
    expect(shapeOfPayload(brief)).toBe("brief");
    expect(shapeOfPayload(qa)).toBe("qa");
    expect(shapeOfPayload(goal)).toBe("goal");
    expect(shapeOfPayload(null)).toBe("brief");
  });

  it("payloadMatchesSource benar untuk seluruh matriks 6×3", () => {
    for (const s of zSpecSource.options)
      for (const [shape, p] of [["brief", brief], ["qa", qa], ["goal", goal]] as const)
        expect(payloadMatchesSource(s, p)).toBe(payloadShapeFor(s) === shape);
  });

  // Regresi SPEC-197/407: gerbang POST /specs tak boleh melemah setelah predikatnya diekstrak.
  it("zCreateSpec tetap menolak kombinasi source × payload yang salah", () => {
    const base = { project: "p", title: "t", priority: "sedang" as const };
    expect(zCreateSpec.safeParse({ ...base, source: "qa", payload: brief }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "brief", payload: goal }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "goal", payload: qa }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "help", payload: brief }).success).toBe(true);
    expect(zCreateSpec.safeParse({ ...base, source: "qa", payload: qa }).success).toBe(true);
  });

  // SPEC-825 · source `no_effort` menumpang bentuk goal — tak ada bentuk keempat.
  it("zCreateSpec mengikat no_effort ke bentuk goal", () => {
    const base = { project: "p", title: "t", priority: "sedang" as const };
    expect(zCreateSpec.safeParse({ ...base, source: "no_effort", payload: goal }).success).toBe(true);
    expect(zCreateSpec.safeParse({ ...base, source: "no_effort", payload: brief }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "no_effort", payload: qa }).success).toBe(false);
  });

  it("zChangeSpecSource: payload opsional, tapi bila ada wajib cocok source tujuan", () => {
    expect(zChangeSpecSource.safeParse({ source: "qa" }).success).toBe(true);
    expect(zChangeSpecSource.safeParse({ source: "qa", payload: qa }).success).toBe(true);
    expect(zChangeSpecSource.safeParse({ source: "qa", payload: brief }).success).toBe(false);
    expect(zChangeSpecSource.safeParse({ source: "bukan-source" }).success).toBe(false);
  });

  // ADR-0149 · perpindahan LINTAS-ALUR pada item yang sudah dimulai mengembalikan item ke
  // `brainstorming`; server menjawab dry-run sampai flag ini dikirim. Diuji di batas kontrak
  // karena zod object default STRIP: tanpa field ini, `confirmReset` apa pun lolos diam-diam
  // dan klien tak pernah tahu bahwa konfirmasinya tak sampai ke gerbang.
  it("zChangeSpecSource: confirmReset boolean opsional", () => {
    expect(zChangeSpecSource.safeParse({ source: "qa" }).success).toBe(true);
    const ok = zChangeSpecSource.safeParse({ source: "qa", confirmReset: true });
    expect(ok.success && ok.data.confirmReset).toBe(true);
    expect(zChangeSpecSource.safeParse({ source: "qa", confirmReset: "ya" }).success).toBe(false);
  });
});
