// SPEC-883 · kolom penandaan komponen. Kontrak terpenting di berkas ini bukan bentuk kolomnya,
// melainkan bahwa ketiganya BUKAN bagian sync (pelajaran SPEC-880).
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { __FIELDS } from "../src/services/sync";

const vpsModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Vps")!;
const field = (name: string) => vpsModel.fields.find((f) => f.name === name);

describe("SPEC-883 · kolom provisioning", () => {
  it("ketiganya ada dan nullable", () => {
    expect(field("components")).toMatchObject({ type: "Json", isRequired: false });
    expect(field("componentsCheckedAt")).toMatchObject({ type: "DateTime", isRequired: false });
    expect(field("provisionProfile")).toMatchObject({ type: "String", isRequired: false });
  });

  // SPEC-880: kolom baru di snapshot() dikirim pada SETIAP push, sehingga hub yang lebih tua
  // menolak seluruh push entitas itu. Status komponen juga milik mesin pemegang key SSH.
  it("TIDAK ikut sync", () => {
    for (const f of ["components", "componentsCheckedAt", "provisionProfile"]) {
      expect(__FIELDS.vps).not.toContain(f);
    }
  });
});
