import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { PARENTS, SYNCED, type Entity } from "../src/services/sync";

// SPEC-799 · ADR-0119 · PARENTS disalin dari skema, jadi ia basi DIAM-DIAM begitu FK baru lahir
// antar entitas SYNCED. Gerbangnya cuma test ini (preseden PG_ORDER · cli/test/migrate-pg.test.ts).
const modelOf = (e: Entity) => e.charAt(0).toUpperCase() + e.slice(1);

describe("PARENTS = himpunan FK antar model SYNCED", () => {
  it("tak ada relasi FK antar entitas SYNCED yang terlewat", () => {
    const modelToEntity = new Map(SYNCED.map((e) => [modelOf(e), e] as const));
    const expected: Record<string, { field: string; entity: string; onDelete: string }[]> = {};

    for (const entity of SYNCED) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelOf(entity))!;
      for (const f of model.fields) {
        if (f.kind !== "object" || !f.relationFromFields?.length) continue;
        const parent = modelToEntity.get(f.type);
        if (!parent) continue; // relasi ke model di luar SYNCED — bukan urusan mesin sync
        // SPEC-945 · ADR-0150 · `onDelete` ikut ditegakkan: `cascade` membuang record anak yang
        // datang untuk induk bertombstone, `setNull` justru menerapkannya dengan kolom itu
        // dikosongkan. Menyalinnya salah tak menghasilkan satu pun error — kartu hanya lenyap.
        (expected[entity] ??= []).push({
          field: f.relationFromFields[0]!, entity: parent,
          onDelete: f.relationOnDelete === "Cascade" ? "cascade" : "setNull",
        });
      }
    }

    const norm = (v: Record<string, { field: string; entity: string; onDelete: string }[]>) =>
      Object.fromEntries(Object.entries(v)
        .map(([k, arr]) => [k, arr.map((x) => `${x.field}->${x.entity}:${x.onDelete}`).sort()])
        .sort(([a], [b]) => String(a).localeCompare(String(b))));

    expect(norm(PARENTS as never)).toEqual(norm(expected));
  });
});
