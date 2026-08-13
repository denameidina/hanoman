import { describe, it, expect } from "vitest";
import {
  METHODS, METHOD_IDS, DEFAULT_METHOD, VERIFICATION_GATE, PLAN_DIRS, SPEC_DIRS,
  resolveMethod, readSpecMethod, stampSpecMethod,
} from "./method-catalog";

// SPEC-734 · invarian katalog ditegakkan DI SUMBER (pola SPEC-490): metode ketiga yang melanggar
// salah satunya membuat suite merah sebelum ia sempat melahirkan satu sesi pun.
const entries = () => Object.entries(METHODS);

describe("METHODS · invarian sumber", () => {
  it("kunci peta sama dengan id entrinya", () => {
    for (const [key, m] of entries()) expect(m.id).toBe(key);
  });

  // AC-7 · INVARIAN 2
  it("exitSkills tak boleh kosong", () => {
    for (const [key, m] of entries()) {
      expect(m.exitSkills.length, `${key}.exitSkills kosong`).toBeGreaterThan(0);
    }
  });

  it("exitSkills wajib memuat gerbang verifikasi", () => {
    for (const [key, m] of entries()) {
      expect(m.exitSkills, `${key} tanpa gerbang verifikasi`).toContain(VERIFICATION_GATE);
    }
  });

  it("DEFAULT_METHOD ada di katalog", () => {
    expect(METHODS[DEFAULT_METHOD]).toBeDefined();
  });

  it("planDir & specDir unik antar-metode", () => {
    expect(PLAN_DIRS.length).toBe(METHOD_IDS.length);
    expect(SPEC_DIRS.length).toBe(METHOD_IDS.length);
  });

  it("planDir & specDir relatif, tanpa slash di ujung", () => {
    for (const m of Object.values(METHODS)) {
      for (const d of [m.planDir, m.specDir]) {
        expect(d.startsWith("/")).toBe(false);
        expect(d.endsWith("/")).toBe(false);
      }
    }
  });

  it("requires tak boleh kosong", () => {
    for (const [key, m] of entries()) {
      expect(m.requires.length, `${key}.requires kosong`).toBeGreaterThan(0);
    }
  });

  it("extraClause bila ada wajib menyebut planDir metodenya", () => {
    for (const [key, m] of entries()) {
      if (m.extraClause) expect(m.extraClause, key).toContain(m.planDir);
    }
  });
});

// Skill yang kontraknya MEWAWANCARAI manusia, atau menulis ke issue tracker EKSTERNAL. Sesi
// hanoman tak berpenunggu dan AUTONOMY_CLAUSE_FULL menyuruh agen tak pernah bertanya → deadlock
// (kelas bug yang sama dengan checkpoint "review" superpowers, runner/src/prompt.ts). hanoman
// sendiri adalah issue tracker-nya, jadi `triage`/`to-spec` juga terlarang.
const HUMAN_INVOKED = [
  "grill-me", "to-spec", "triage", "grill-with-docs", "to-questionnaire",
  "wait-what", "teach", "handoff", "ask-matt", "wayfinder", "setup-matt-pocock-skills",
  "improve-codebase-architecture",
];

describe("METHODS · tak boleh memuat skill berpenunggu-manusia", () => {
  it("tak ada entri yang memakai skill dari denylist", () => {
    for (const [key, m] of entries()) {
      const all = [...Object.values(m.phaseSkills).flat(), ...m.exitSkills];
      for (const skill of all) {
        const bare = skill.slice(skill.indexOf(":") + 1);
        expect(HUMAN_INVOKED, `${key} memakai skill berpenunggu-manusia: ${skill}`)
          .not.toContain(bare);
      }
    }
  });
});

describe("resolveMethod", () => {
  it("id yang dikenal mengembalikan entrinya", () => {
    expect(resolveMethod("matt").id).toBe("matt");
  });
  // AC-9
  it("id yang tak ada jatuh ke DEFAULT_METHOD tanpa melempar", () => {
    expect(resolveMethod("tak-ada-metode-ini").id).toBe(DEFAULT_METHOD);
  });
  it("undefined/null/kosong jatuh ke DEFAULT_METHOD", () => {
    expect(resolveMethod().id).toBe(DEFAULT_METHOD);
    expect(resolveMethod(null).id).toBe(DEFAULT_METHOD);
    expect(resolveMethod("").id).toBe(DEFAULT_METHOD);
  });
});

describe("readSpecMethod", () => {
  it("membaca payload.method", () => {
    expect(readSpecMethod({ method: "matt", goal: "x" })).toBe("matt");
  });
  it("payload tanpa method / bukan objek → null", () => {
    expect(readSpecMethod({ goal: "x" })).toBeNull();
    expect(readSpecMethod(null)).toBeNull();
    expect(readSpecMethod(["matt"])).toBeNull();
    expect(readSpecMethod("matt")).toBeNull();
    expect(readSpecMethod({ method: "   " })).toBeNull();
  });
});

describe("stampSpecMethod", () => {
  it("menambahkan method tanpa menyentuh field lain", () => {
    expect(stampSpecMethod({ goal: "x", done: "y" }, "matt"))
      .toEqual({ goal: "x", done: "y", method: "matt" });
  });
  it("payload null lahir sebagai objek berisi method saja", () => {
    expect(stampSpecMethod(null, "superpowers")).toEqual({ method: "superpowers" });
  });
  // Menimpa array/skalar berarti membuang data yang bukan milik kita; resolusi tetap benar
  // tanpa stempel, jadi jawabannya "jangan stempel", bukan "timpa".
  it("payload array/skalar → null (tak distempel)", () => {
    expect(stampSpecMethod(["a"], "matt")).toBeNull();
    expect(stampSpecMethod("a", "matt")).toBeNull();
  });
});
