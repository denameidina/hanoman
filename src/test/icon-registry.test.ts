// ADR-0160 · registry ikon statis harus mengikuti sumber. Nama ikon baru yang dipakai di call site
// tanpa `pnpm --filter ./src gen:icons` akan dirender sebagai lingkaran kosong TANPA error — kelas
// kegagalan SPEC-906 yang persis ingin dicegah — jadi kebasian registry harus jadi test merah.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectIconNames, renderRegistry, REGISTRY_PATH, SRC_ROOT } from "../scripts/gen-icon-registry";
import { ICONS } from "../src/ds/icon-registry";
import { LEGACY, pascalCandidates } from "../src/ds/icon-names";

describe("icon-registry", () => {
  it("benar-benar memindai sumber", () => {
    expect(collectIconNames(SRC_ROOT).length).toBeGreaterThan(100);
  });

  it("berkas ter-commit sama dengan hasil generator (jalankan gen:icons bila merah)", () => {
    expect(readFileSync(REGISTRY_PATH, "utf8")).toBe(renderRegistry(SRC_ROOT));
  });

  it("semua nama lama SPEC-906 punya komponennya di registry", () => {
    for (const legacy of Object.keys(LEGACY)) {
      const found = pascalCandidates(legacy).some((c) => c in ICONS);
      expect(found, legacy).toBe(true);
    }
  });

  it("fallback Circle selalu ada", () => {
    expect(ICONS.Circle).toBeTruthy();
  });
});
