import { describe, it, expect } from "vitest";
import { __FIELDS, __DATE_FIELDS } from "../src/services/sync";
import { WEBHOOK_ENTITIES, eventTypeFor } from "@hanoman/shared";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

describe("SPEC-546 · ADR-0109 · kontrak kolom sourceHistory", () => {
  it("ikut menyeberang sync — tanpa ini jejak konversi berhenti di satu mesin", () => {
    expect(__FIELDS.spec).toContain("sourceHistory");
    expect(__FIELDS.spec).toContain("source");   // kontrol negatif: source memang sudah ikut
  });

  it("BUKAN DATE_FIELDS — `at` hidup DI DALAM JSON, kolomnya sendiri bukan DateTime", () => {
    expect(__DATE_FIELDS.spec).not.toContain("sourceHistory");
  });

  it("TIDAK masuk allowlist webhook — ia membawa payload, dan payload memang dikecualikan", () => {
    const spec = WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!;
    expect(spec.fields).not.toContain("sourceHistory");
    expect(spec.fields).not.toContain("payload");   // kontrol negatif
    expect(spec.fields).toContain("source");
  });

  it("perubahan `source` memancarkan spec.source_changed, menggantikan spec.updated", () => {
    const spec = WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!;
    expect(eventTypeFor(spec, "updated", ["source"])).toBe("spec.source_changed");
    expect(eventTypeFor(spec, "updated", ["stage"])).toBe("spec.stage_changed");
    expect(eventTypeFor(spec, "updated", ["title"])).toBe("spec.updated");
  });

  it("kolomnya benar-benar ada di DB dan menerima array objek", async () => {
    await resetDb();
    await makeProject({ id: "psh" });
    await makeSpec({ id: "SPEC-900", projectId: "psh" });
    await prisma.spec.update({
      where: { id: "SPEC-900" },
      data: {
        sourceHistory: [{
          at: "2026-08-06T00:00:00.000Z", from: "brief", to: "qa", by: "x",
          payload: { context: "c" },
        }],
      },
    });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-900" } });
    expect((row!.sourceHistory as unknown[]).length).toBe(1);
  });
});
