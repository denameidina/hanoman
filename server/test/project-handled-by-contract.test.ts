import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { WEBHOOK_ENTITIES, zHandledBy, handledByOf, HANDLED_BY_MAX } from "@hanoman/shared";
import { __FIELDS, __DATE_FIELDS, __JSON_FIELDS } from "../src/services/sync";

const projectModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Project")!;

describe("SPEC-880 · kontrak kolom Project.handledBy", () => {
  it("kolomnya ada di skema sebagai Json opsional", () => {
    const col = projectModel.fields.find((f) => f.name === "handledBy");
    expect(col).toBeTruthy();
    expect(col!.type).toBe("Json");
    expect(col!.isRequired).toBe(false);
  });

  // Inti spec ini: penanda "ditangani oleh" HARUS menyeberang. Kelas gagal-senyap
  // ADR-0090/0093/0105 — `upsert` yang tak menyebut kolom TETAP berhasil, jadi kolom yang lupa
  // didaftarkan mendarat sebagai null palsu di tiap client tanpa satu pun galat.
  it("ikut menyeberang sync sebagai JSON, bukan DATE", () => {
    expect(__FIELDS.project).toContain("handledBy");
    expect(__JSON_FIELDS.has("project:handledBy")).toBe(true);
    expect(__DATE_FIELDS.project).not.toContain("handledBy");
  });

  // Kontrol negatif: nilai LOCAL-only tetap di luar sync (constraint SPEC-880).
  it("repoDir/schedulerOptIn/leadOptIn/autoMerge TETAP di luar FIELDS", () => {
    for (const f of ["repoDir", "schedulerOptIn", "leadOptIn", "autoMerge"]) {
      expect(__FIELDS.project).not.toContain(f);
    }
  });

  it("penerima webhook melihat handledBy", () => {
    const p = WEBHOOK_ENTITIES.find((d) => d.entity === "project")!;
    expect(p.fields).toContain("handledBy");
    expect(p.sample).toHaveProperty("handledBy");
  });

  it("zHandledBy: entri butuh deviceId & name, duplikat ditolak, ada batas panjang", () => {
    expect(zHandledBy.safeParse([]).success).toBe(true);
    expect(zHandledBy.safeParse([{ deviceId: "d1", name: "hm-dena" }]).success).toBe(true);
    expect(zHandledBy.safeParse([{ deviceId: "d1" }]).success).toBe(false);
    expect(zHandledBy.safeParse([{ deviceId: "", name: "x" }]).success).toBe(false);
    expect(zHandledBy.safeParse([
      { deviceId: "d1", name: "a" }, { deviceId: "d1", name: "b" },
    ]).success).toBe(false);
    const tooMany = Array.from({ length: HANDLED_BY_MAX + 1 }, (_, i) => ({ deviceId: `d${i}`, name: `n${i}` }));
    expect(zHandledBy.safeParse(tooMany).success).toBe(false);
  });

  // Kolom Json bisa berisi apa saja (ditulis versi lain, disunting tangan). Bentuk rusak → []
  // bukan melempar: daftar project tak boleh mati karena satu baris cacat (preseden autoMergeOf).
  it("handledByOf toleran terhadap isi kolom yang rusak", () => {
    expect(handledByOf(null)).toEqual([]);
    expect(handledByOf(undefined)).toEqual([]);
    expect(handledByOf("bukan array")).toEqual([]);
    expect(handledByOf([{ deviceId: "d1", name: "hm-dena" }])).toEqual([{ deviceId: "d1", name: "hm-dena" }]);
    expect(handledByOf([{ deviceId: "d1" }])).toEqual([]);
  });
});
