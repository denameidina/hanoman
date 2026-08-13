import { describe, it, expect } from "vitest";
import { PLAN_DIRS } from "@hanoman/shared";
import {
  GOAL_MAX, GOAL_CHUNK, GOAL_TUI_PASTE_LIMIT,
  defaultGoalCondition, resolveGoalCondition, goalOneLine, goalChunks,
} from "../src/goal";

const args = { flow: "feature" as const, specId: "SPEC-332", branchTo: "hanoman/spec-332" };

describe("goal condition", () => {
  it("default memuat identitas backlog, seluruh fase, gate plan, dan push", () => {
    const c = defaultGoalCondition(args);
    expect(c).toContain("SPEC-332");
    expect(c).toContain("Brainstorm → Objective → Spec → Plan → Execute");
    expect(c).toContain('cat "$HANOMAN_PHASE_FILE"');
    expect(c).toContain("docs/superpowers/plans/");
    expect(c).toContain("git push origin HEAD:refs/heads/hanoman/spec-332");
    expect(c.length).toBeLessThanOrEqual(GOAL_MAX);
  });

  it("flow tanpa Plan+Execute tak membawa gate plan", () => {
    const c = defaultGoalCondition({ ...args, flow: "audit" });
    expect(c).toContain("Audit → Laporan");
    expect(c).not.toContain("docs/superpowers/plans/");
    expect(c).toContain("git push");
  });

  it("resolve: override menang atas template, template menang atas default", () => {
    expect(resolveGoalCondition(args, "pakai ini", "template")).toBe("pakai ini");
    expect(resolveGoalCondition(args, "  ", "template")).toBe("template");
    expect(resolveGoalCondition(args, undefined, "")).toBe(defaultGoalCondition(args));
    expect(resolveGoalCondition(args, null, null)).toBe(defaultGoalCondition(args));
  });

  it("resolve memangkas kondisi di atas batas Claude Code", () => {
    expect(resolveGoalCondition(args, "x".repeat(GOAL_MAX + 500)).length).toBe(GOAL_MAX);
  });

  it("goalOneLine meratakan baris (Enter di tmux = submit)", () => {
    expect(goalOneLine("baris satu\n  baris dua\n\nbaris tiga ")).toBe("baris satu baris dua baris tiga");
  });
});

// SPEC-397 · ADR-0085 — TUI codex mengubah masukan yang datang dalam SATU burst ≥ 1024 karakter
// menjadi lampiran `[Pasted Content N chars]`, dan begitu itu terjadi slash-dispatch tak jalan:
// `/goal` terkirim sebagai pesan chat biasa, tanpa error dan tanpa goal.
describe("goalChunks", () => {
  it("merekonstruksi kondisi utuh tanpa kehilangan atau menambah karakter", () => {
    const line = goalOneLine(defaultGoalCondition(args));
    expect(goalChunks(line).join("")).toBe(line);
  });

  it("tak ada potongan yang mencapai batas paste, bahkan untuk kondisi GOAL_MAX", () => {
    const chunks = goalChunks("x".repeat(GOAL_MAX));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
  });

  it("dua potongan bersebelahan yang menyatu pun masih di bawah batas (margin sengaja)", () => {
    // Ditulis dengan kursor `prev`, bukan indeks: `chunks[i - 1]` bertipe `string | undefined` di
    // bawah TS strict, dan menutupinya dengan `?? ""` justru akan menyembunyikan potongan kosong.
    let prev: string | undefined;
    for (const cur of goalChunks("y".repeat(GOAL_MAX))) {
      if (prev !== undefined) {
        expect(prev.length + cur.length).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
      }
      prev = cur;
    }
  });

  it("kondisi pendek tetap satu potongan (tak ada invokasi send-keys sia-sia)", () => {
    expect(goalChunks("kondisi pendek")).toEqual(["kondisi pendek"]);
  });

  it("string kosong tak menghasilkan potongan", () => {
    expect(goalChunks("")).toEqual([]);
  });

  it("GOAL_CHUNK punya margin terhadap batas paste", () => {
    expect(GOAL_CHUNK * 2).toBeLessThan(GOAL_TUI_PASTE_LIMIT);
  });
});

// SPEC-407 · ADR-0089 · backlog goal: kondisi berhenti BUKAN DoD generik hanoman melainkan goal
// item itu sendiri — plus dua bukti yang tanpa itu hasil sesi tak pernah terlihat (baris fase &
// push).
describe("kondisi goal untuk flow goal (SPEC-407)", () => {
  const gArgs = {
    flow: "goal" as const, specId: "SPEC-407", branchTo: "hanoman/spec-407",
    spec: {
      payload: { goal: "p95 /api/specs < 200 ms", done: "output benchmark < 200 ms",
        constraints: "", priority: "tinggi" },
      objective: "p95 /api/specs < 200 ms",
    },
  };

  it("memuat goal, bukti selesai, baris fase, dan push", () => {
    const c = defaultGoalCondition(gArgs);
    expect(c).toContain("SPEC-407");
    expect(c).toContain("p95 /api/specs < 200 ms");
    expect(c).toContain("output benchmark < 200 ms");
    expect(c).toContain("Goal → Verifikasi");
    expect(c).toContain('cat "$HANOMAN_PHASE_FILE"');
    expect(c).toContain("git push origin HEAD:refs/heads/hanoman/spec-407");
    expect(c).not.toContain("docs/superpowers/plans/");
    expect(c.length).toBeLessThanOrEqual(GOAL_MAX);
  });

  it("tanpa `done` → goal itu sendiri yang jadi buktinya", () => {
    const c = defaultGoalCondition({ ...gArgs, spec: { ...gArgs.spec,
      payload: { goal: "g", done: "", constraints: "", priority: "tinggi" } } });
    expect(c).toContain("goal tercapai — g;");
    expect(c).not.toContain("undefined");
  });

  it("payload rusak → jatuh ke objective, tanpa melempar", () => {
    const c = defaultGoalCondition({ ...gArgs, spec: { payload: null, objective: "objective cadangan" } });
    expect(c).toContain("objective cadangan");
    expect(c).not.toContain("undefined");
  });

  it("resolve: override sesi tetap menang untuk flow goal", () => {
    expect(resolveGoalCondition(gArgs, "KONDISI-SESI", "TEMPLATE")).toBe("KONDISI-SESI");
  });

  it("flow lain tak tersentuh", () => {
    expect(defaultGoalCondition({ flow: "feature", specId: "SPEC-332", branchTo: "b" }))
      .toContain("Brainstorm → Objective → Spec → Plan → Execute");
  });
});

describe("SPEC-734 · kondisi mode goal menyebut union planDir", () => {
  // Gerbang ini menuntut hasil `grep` yang KOSONG sebagai bukti selesai, jadi direktori yang salah
  // bukan sekadar tak informatif — ia MEMUASKAN gerbangnya. Union wajib.
  it("defaultGoalCondition menyebut setiap planDir", () => {
    const c = defaultGoalCondition({ flow: "feature", specId: "SPEC-9", branchTo: "hanoman/x" });
    for (const d of PLAN_DIRS) expect(c).toContain(`${d}/`);
  });
});
