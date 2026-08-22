// SPEC-883 · katalog komponen provisioning. Dependensi diselesaikan DI SERVER — skrip menerima
// daftar yang sudah lengkap & terurut dan tak pernah menebak.
import { describe, it, expect } from "vitest";
import { COMPONENTS, componentById, resolveComponents } from "../src/vps/catalog/components";

describe("SPEC-883 · katalog komponen", () => {
  it("setiap `requires` menunjuk komponen yang ada, tanpa siklus", () => {
    for (const c of COMPONENTS) {
      for (const profile of ["lab", "production"] as const) {
        for (const dep of c.requires[profile]) {
          expect(componentById(dep), `${c.id} → ${dep}`).toBeDefined();
          expect(dep).not.toBe(c.id);
        }
      }
    }
  });

  it("hanoman di lab menutup base+node, terurut topologis", () => {
    const r = resolveComponents(["hanoman"], "lab");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toEqual(["base", "node", "hanoman"]);
  });

  it("hanoman di production ikut menarik podman", () => {
    const r = resolveComponents(["hanoman"], "production");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toContain("podman");
    expect(r.items.indexOf("podman")).toBeLessThan(r.items.indexOf("hanoman"));
  });

  it("claude di production menarik agent-image, di lab tidak", () => {
    const prod = resolveComponents(["claude"], "production");
    const lab = resolveComponents(["claude"], "lab");
    expect(prod.ok && prod.items).toContain("agent-image");
    expect(lab.ok && lab.items).not.toContain("agent-image");
  });

  it("komponen di luar profil ditolak", () => {
    const r = resolveComponents(["agent-image"], "lab");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/profil/);
  });

  it("id tak dikenal ditolak", () => {
    const r = resolveComponents(["wat" as never], "lab");
    expect(r.ok).toBe(false);
  });

  it("daftar kosong ditolak", () => {
    expect(resolveComponents([], "lab").ok).toBe(false);
  });

  it("duplikat tak menggandakan langkah", () => {
    const r = resolveComponents(["node", "node", "hanoman"], "lab");
    expect(r.ok && r.items).toEqual(["base", "node", "hanoman"]);
  });
});
