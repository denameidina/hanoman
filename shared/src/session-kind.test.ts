import { describe, it, expect } from "vitest";
import { SESSION_KINDS, SESSION_KIND_LABEL, restartableKind, zSessionKind } from "./session-kind";

describe("SessionKind (SPEC-362)", () => {
  it("mencakup setiap jenis sesi yang bisa lahir dari createSession", () => {
    expect([...SESSION_KINDS].sort()).toEqual([
      "breakdown", "lead", "prd", "reverse", "scaffold", "shell",
      "spec", "telegram", "terminal", "vps", "worktree",
    ]);
  });

  it("tiap kind punya label manusia — UI tak pernah merender slug mentah", () => {
    for (const k of SESSION_KINDS) expect(SESSION_KIND_LABEL[k].length).toBeGreaterThan(0);
  });

  it("restartable hanya untuk sesi yang konteksnya bisa dibangun ulang dari riwayat", () => {
    for (const k of ["spec", "terminal", "shell", "reverse", "scaffold"] as const)
      expect(restartableKind(k)).toBe(true);
    // prd/breakdown butuh brief/prdPath yang tak tersimpan; vps/worktree tak punya arti "mulai lagi".
    for (const k of ["prd", "breakdown", "vps", "worktree", "telegram"] as const)
      expect(restartableKind(k)).toBe(false);
  });

  it("kind tak dikenal tak pernah restartable", () => {
    expect(restartableKind("apa-pun")).toBe(false);
  });

  it("zSessionKind menolak nilai di luar katalog", () => {
    expect(zSessionKind.safeParse("spec").success).toBe(true);
    expect(zSessionKind.safeParse("apa-pun").success).toBe(false);
  });
});
