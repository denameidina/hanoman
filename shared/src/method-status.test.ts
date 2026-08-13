import { describe, it, expect } from "vitest";
import { zAgent } from "./enums";
import { METHODS, METHOD_IDS } from "./method-catalog";
import { methodSkills, methodStatus } from "./method-status";

const ALL = { skills: [] as string[], packages: [] as string[] };

describe("methodSkills", () => {
  it("union phaseSkills ∪ exitSkills, ter-dedup", () => {
    const s = methodSkills(METHODS.superpowers!);
    expect(s).toContain("superpowers:brainstorming");
    expect(s).toContain("superpowers:verification-before-completion");
    expect(new Set(s).size).toBe(s.length);
  });
});

describe("methodStatus", () => {
  it("nol terpasang → kurang PAKET dan kurang SKILL, keduanya dilaporkan", () => {
    const st = methodStatus(METHODS.superpowers!, "codex", ALL);
    expect(st.ready).toBe(false);
    expect(st.missingPackages).toEqual(["superpowers"]);
    expect(st.missingSkills).toContain("superpowers:brainstorming");
    expect(st.agent).toBe("codex");
  });

  // Butir `requires` adalah nama PAKET; yang dipanggil prompt adalah id SKILL. Paket ada dengan
  // skill kurang itu keadaan nyata (versi lebih tua) — dua pertanyaan, dua jawaban.
  it("paket ada tapi skill kurang → tetap belum siap, hanya missingSkills terisi", () => {
    const st = methodStatus(METHODS.superpowers!, "claude", {
      packages: ["superpowers"], skills: ["superpowers:brainstorming"],
    });
    expect(st.missingPackages).toEqual([]);
    expect(st.missingSkills).toContain("superpowers:verification-before-completion");
    expect(st.ready).toBe(false);
  });

  it("seluruh paket & skill ada → siap", () => {
    const m = METHODS.superpowers!;
    const st = methodStatus(m, "claude", { packages: [...m.requires], skills: methodSkills(m) });
    expect(st).toMatchObject({ ready: true, missingPackages: [], missingSkills: [] });
  });

  // PENCOCOKAN KETAT: skill user bernama `brainstorming` beralamat `brainstorming`, bukan
  // `superpowers:brainstorming` — prompt yang memanggil id berprefiks tetap akan gagal.
  it("skill polos tak memuaskan id berprefiks paket", () => {
    const st = methodStatus(METHODS.superpowers!, "codex", {
      packages: ["superpowers"], skills: ["brainstorming", "writing-plans"],
    });
    expect(st.missingSkills).toContain("superpowers:brainstorming");
  });

  it("install datang dari katalog metode itu, per agen", () => {
    expect(methodStatus(METHODS.superpowers!, "claude", ALL).install)
      .toEqual([...METHODS.superpowers!.install.claude]);
    expect(methodStatus(METHODS.superpowers!, "codex", ALL).install)
      .toEqual([...METHODS.superpowers!.install.codex]);
  });
});

// Invarian SUMBER (pola SPEC-490/AC-7 ADR-0113): ditegakkan di katalog, bukan di render — nol
// test UI bisa menangkap entri metode ketiga yang lupa membawa perintah pemasangannya.
describe("katalog · MethodDef.install", () => {
  it("setiap metode punya perintah untuk SETIAP agen, non-kosong", () => {
    for (const id of METHOD_IDS) {
      const m = METHODS[id]!;
      expect(Object.keys(m.install).sort()).toEqual([...zAgent.options].sort());
      for (const a of zAgent.options) {
        expect(m.install[a].length).toBeGreaterThan(0);
        for (const cmd of m.install[a]) expect(cmd.trim()).not.toBe("");
      }
    }
  });

  it("perintahnya menyebut sedikitnya satu paket yang ada di `requires`", () => {
    for (const id of METHOD_IDS) {
      const m = METHODS[id]!;
      for (const a of zAgent.options) {
        const joined = m.install[a].join(" ");
        expect(m.requires.some((r) => joined.includes(r))).toBe(true);
      }
    }
  });
});
