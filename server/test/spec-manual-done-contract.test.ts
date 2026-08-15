import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { WEBHOOK_ENTITIES, zManualDone, zMarkSpecDone, zSpec } from "@hanoman/shared";
import { __FIELDS, __DATE_FIELDS, __JSON_FIELDS } from "../src/services/sync";

const specModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Spec")!;

describe("SPEC-804 · kontrak kolom Spec.manualDone", () => {
  it("kolomnya ada di skema sebagai Json opsional", () => {
    const col = specModel.fields.find((f) => f.name === "manualDone");
    expect(col).toBeTruthy();
    expect(col!.type).toBe("Json");
    expect(col!.isRequired).toBe(false);
  });

  // Kelas gagal-senyap ADR-0090/0093/0094/0105: `upsert` yang tak menyebut sebuah kolom TETAP
  // berhasil, jadi kolom yang lupa didaftarkan mendarat sebagai null palsu di tiap client.
  it("ikut menyeberang sync sebagai JSON, bukan DATE", () => {
    expect(__FIELDS.spec).toContain("manualDone");
    expect(__JSON_FIELDS.has("spec:manualDone")).toBe(true);
    expect(__DATE_FIELDS.spec).not.toContain("manualDone");
  });

  it("penerima webhook bisa membedakan selesai-manual dari selesai-lewat-sesi", () => {
    const spec = WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!;
    expect(spec.fields).toContain("manualDone");
  });

  it("zManualDone menuntut at & by, reason opsional", () => {
    expect(zManualDone.safeParse({ at: "2026-08-15T00:00:00.000Z", by: "dena@x" }).success).toBe(true);
    expect(zManualDone.safeParse({ at: "2026-08-15T00:00:00.000Z", by: "dena@x", reason: "sudah ter-merge" }).success).toBe(true);
    expect(zManualDone.safeParse({ by: "dena@x" }).success).toBe(false);
  });

  it("zMarkSpecDone: body kosong sah, alasan > 280 ditolak", () => {
    expect(zMarkSpecDone.safeParse({}).success).toBe(true);
    expect(zMarkSpecDone.safeParse({ reason: "x".repeat(280), confirm: true }).success).toBe(true);
    expect(zMarkSpecDone.safeParse({ reason: "x".repeat(281) }).success).toBe(false);
  });

  it("zSpec membawa manualDone dan tetap parse respons versi lama", () => {
    const old = {
      id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "done", priority: "sedang",
      author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null,
      createdAt: "2026-08-15T00:00:00.000Z", startedAt: null,
    };
    const parsed = zSpec.parse(old);
    expect(parsed.manualDone).toBeNull();
  });
});
