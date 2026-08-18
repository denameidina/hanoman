import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  phaseFilePath, decisionFilePath, readPhases, stageFor, planComplete, stageForRun,
  phasesComplete, sessionComplete, type Phase, type PhaseState,
} from "../src/services/session-phases";

describe("decisionFilePath (SPEC-184)", () => {
  it("di .worktrees/.decisions/<id> (di dalam .gitignore)", () => {
    expect(decisionFilePath("/repo", "spec_9")).toBe("/repo/.worktrees/.decisions/spec_9");
  });
});

let dir = "";
let file = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-phase-")); file = join(dir, "spec-1"); });
const write = (s: string) => writeFileSync(file, s);
const states = (flow: "feature" | "qa" | "reverse" = "feature") =>
  readPhases(file, flow).map((p) => `${p.name}:${p.state}`);

describe("phaseFilePath", () => {
  it("hidup di luar worktree, di bawah .worktrees/.phases", () => {
    expect(phaseFilePath("/repo", "spec-162")).toBe("/repo/.worktrees/.phases/spec-162");
  });
});

describe("readPhases", () => {
  it("berkas belum ada → fase pertama aktif, sisanya pending, tanpa melempar", () => {
    expect(states()).toEqual([
      "Brainstorm:active", "Objective:pending", "Spec:pending", "Plan:pending", "Execute:pending",
    ]);
  });

  it("baris done menandai fase, dan yang berikutnya menjadi aktif", () => {
    write("Brainstorm done\nObjective done\n");
    expect(states()).toEqual([
      "Brainstorm:done", "Objective:done", "Spec:active", "Plan:pending", "Execute:pending",
    ]);
  });

  it("skipped diperlakukan sebagai tercatat, bukan sebagai aktif", () => {
    write("Audit done\nSpec skipped\nPlan skipped\n");
    expect(states("qa")).toEqual(["Audit:done", "Spec:skipped", "Plan:skipped", "Execute:active"]);
  });

  // "Docs teknis" / "Konvensi & index" mengandung spasi: state adalah token TERAKHIR,
  // bukan token kedua. Fase selesai tak berurutan justru menguatkan parsing-nya.
  it("nama fase berspasi terbaca utuh", () => {
    write("Scan done\nDocs teknis done\nKonvensi & index done\n");
    expect(readPhases(file, "reverse").map((p) => p.state))
      .toEqual(["done", "done", "active", "done", "pending"]);
  });

  it("seluruh fase tercatat → tak ada yang aktif", () => {
    write("Brainstorm done\nObjective done\nSpec done\nPlan done\nExecute done\n");
    expect(states().filter((s) => s.endsWith(":active"))).toEqual([]);
  });

  it("baris sampah, fase asing, dan state asing diabaikan diam-diam", () => {
    write("\n???\nBrainstorm done\nMandi pagi\nTidur selesai\nObjective menyala\n");
    expect(states()).toEqual([
      "Brainstorm:done", "Objective:active", "Spec:pending", "Plan:pending", "Execute:pending",
    ]);
  });
});

describe("stageFor", () => {
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];
  it("memetakan fase ke stage seperti ADR-0008", () => {
    expect(stageFor(P([["Brainstorm", "active"]]))).toBe("brainstorming");
    expect(stageFor(P([["Brainstorm", "done"], ["Objective", "done"]]))).toBe("objective");
    expect(stageFor(P([["Spec", "done"]]))).toBe("spec-ready");
    expect(stageFor(P([["Plan", "done"]]))).toBe("planned");
    expect(stageFor(P([["Execute", "active"]]))).toBe("executing");
    expect(stageFor(P([["Execute", "done"]]))).toBe("done");
  });
  it("Audit done setara Objective done (flow qa)", () => {
    expect(stageFor(P([["Audit", "done"]]))).toBe("objective");
  });
  it("skipped tak memundurkan: Spec skipped + Plan skipped tetap planned", () => {
    expect(stageFor(P([["Audit", "done"], ["Spec", "skipped"], ["Plan", "skipped"]]))).toBe("planned");
  });
  it("tak ada yang cocok → null (jangan sentuh stage)", () => {
    expect(stageFor(P([["Brainstorm", "pending"]]))).toBe(null);
  });
});

// SPEC-173 · ADR-0029 — `Execute done` hanya sah bila plan spec-nya terceklist penuh.
const mkWorktree = (files: Record<string, string>) => {
  const wt = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
  if (Object.keys(files).length) mkdirSync(join(wt, "docs/superpowers/plans"), { recursive: true });
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(wt, "docs/superpowers/plans", name), body);
  return wt;
};

describe("planComplete", () => {
  it("true bila tak ada dir plan sama sekali", () => {
    expect(planComplete(mkWorktree({}), "SPEC-173")).toBe(true);
  });
  it("true bila tak ada file plan yang cocok spec-id (fast-path qa)", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-lain-spec-999.md": "- [ ] belum" }), "SPEC-173")).toBe(true);
  });
  it("false bila plan spec-nya masih punya - [ ]", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-x-spec-173.md": "- [x] a\n- [ ] b\n" }), "SPEC-173")).toBe(false);
  });
  it("true bila semua kotak plan sudah - [x]", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-x-spec-173.md": "- [x] a\n- [x] b\n" }), "SPEC-173")).toBe(true);
  });
  it("spec-16 tak menyerempet spec-167", () => {
    expect(planComplete(mkWorktree({ "2026-07-11-x-spec-167.md": "- [ ] belum" }), "SPEC-16")).toBe(true);
  });
});

describe("stageForRun", () => {
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];
  const mkPlan = (body: string) => mkWorktree({ "2026-07-11-x-spec-173.md": body });
  it("Execute done + plan belum tuntas → executing, bukan done", () => {
    expect(stageForRun(P([["Execute", "done"]]), mkPlan("- [x] a\n- [ ] b\n"), "SPEC-173")).toBe("executing");
  });
  it("Execute done + plan tuntas → done", () => {
    expect(stageForRun(P([["Execute", "done"]]), mkPlan("- [x] a\n- [x] b\n"), "SPEC-173")).toBe("done");
  });
  it("stage non-done tak terpengaruh gerbang", () => {
    expect(stageForRun(P([["Plan", "done"]]), mkPlan("- [ ] b\n"), "SPEC-173")).toBe("planned");
  });
});

// SPEC-433 — "pekerjaan selesai" adalah fakta yang BERDIRI SENDIRI di sebelah "pane mati".
// Agen adalah TUI interaktif: sesudah fase terakhir ia kembali ke prompt-nya dan pane tetap
// hidup, jadi `exited` (⇐ #{pane_dead}) tak pernah bisa menjadi kabar "selesai" di jalur sukses.
describe("SPEC-433 · phasesComplete", () => {
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];

  it("semua fase done → true", () => {
    expect(phasesComplete(P([["Audit", "done"], ["Execute", "done"]]))).toBe(true);
  });

  it("skipped ikut dihitung tercapai (fast-path qa)", () => {
    expect(phasesComplete(P([
      ["Audit", "done"], ["Spec", "skipped"], ["Plan", "skipped"], ["Execute", "done"],
    ]))).toBe(true);
  });

  it("satu fase masih active → false", () => {
    expect(phasesComplete(P([["Audit", "done"], ["Execute", "active"]]))).toBe(false);
  });

  it("satu fase masih pending → false", () => {
    expect(phasesComplete(P([["Audit", "active"], ["Execute", "pending"]]))).toBe(false);
  });

  // Daftar kosong berarti "tak tahu apa-apa" (flow tak dikenal / sesi tanpa fase), bukan tuntas.
  it("daftar kosong → false, bukan vacuous true", () => {
    expect(phasesComplete([])).toBe(false);
  });
});

describe("SPEC-433 · sessionComplete", () => {
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];
  const qaDone = () => P([
    ["Audit", "done"], ["Spec", "skipped"], ["Plan", "skipped"], ["Execute", "done"],
  ]);

  it("seluruh fase tercatat + tak ada plan → complete (persis keadaan spec-431/432)", () => {
    expect(sessionComplete(qaDone(), mkWorktree({}), "SPEC-431")).toBe(true);
  });

  // Gerbang ADR-0029 yang sama dengan stageForRun: tanpa ini kita cuma menukar "tak pernah
  // hijau" dengan "hijau palsu" — kelas kesalahan yang diperbaiki SPEC-402.
  it("Execute done tapi plan masih - [ ] → BELUM complete", () => {
    const wt = mkWorktree({ "2026-07-31-x-spec-433.md": "- [x] a\n- [ ] b\n" });
    expect(sessionComplete(qaDone(), wt, "SPEC-433")).toBe(false);
  });

  it("kotak terakhir dicentang → complete", () => {
    const wt = mkWorktree({ "2026-07-31-x-spec-433.md": "- [x] a\n- [x] b\n" });
    expect(sessionComplete(qaDone(), wt, "SPEC-433")).toBe(true);
  });

  it("fase belum tuntas → false meski plan bersih", () => {
    const wt = mkWorktree({ "2026-07-31-x-spec-433.md": "- [x] a\n" });
    expect(sessionComplete(P([["Audit", "done"], ["Execute", "active"]]), wt, "SPEC-433")).toBe(false);
  });

  // Sesi project-level (prd/reverse/breakdown) tak punya spec → tak ada plan untuk digerbang.
  // Nama fasenya juga tak ada di REACHED, jadi stageForRun tak bisa dipakai sebagai gantinya.
  it("sesi tanpa specId: cukup seluruh fasenya tercatat", () => {
    expect(sessionComplete(P([["Brainstorm", "done"], ["PRD", "done"]]), "/tak/ada", undefined))
      .toBe(true);
    expect(sessionComplete(P([["Brainstorm", "done"], ["PRD", "active"]]), "/tak/ada", undefined))
      .toBe(false);
  });
});

// SPEC-237 · ADR-0057 — flow audit-only (Audit → Laporan). Fase terminal Laporan → stage done.
describe("SPEC-237 · stage audit-only", () => {
  it("Laporan done → stage done", () => {
    const phases: Phase[] = [{ name: "Audit", state: "done" }, { name: "Laporan", state: "done" }];
    expect(stageFor(phases)).toBe("done");
  });
  it("Audit done, Laporan active → belum done (objective)", () => {
    const phases: Phase[] = [{ name: "Audit", state: "done" }, { name: "Laporan", state: "active" }];
    expect(stageFor(phases)).toBe("objective");
  });
});

// SPEC-407 · ADR-0089 — flow goal (Goal → Verifikasi). Fase KERJA yang sedang berjalan sudah
// berarti `executing`: tanpa itu sesi goal yang jalan tampak `brainstorming` di board — persis
// fase yang dihapus flow ini.
describe("SPEC-407 · stage flow goal", () => {
  const goalPhases = () => readPhases(file, "goal");

  it("berkas kosong → Goal aktif, Verifikasi pending", () => {
    expect(goalPhases().map((p) => `${p.name}:${p.state}`)).toEqual(["Goal:active", "Verifikasi:pending"]);
  });

  it("Goal aktif → executing (bukan brainstorming)", () => {
    expect(stageFor(goalPhases())).toBe("executing");
  });

  it("Goal done → executing; Verifikasi done → done", () => {
    write("Goal done\n");
    expect(stageFor(goalPhases())).toBe("executing");
    write("Goal done\nVerifikasi done\n");
    expect(stageFor(goalPhases())).toBe("done");
  });

  it("gerbang plan ADR-0029 tetap berlaku bila sesi goal sempat menulis plan berkotak", () => {
    write("Goal done\nVerifikasi done\n");
    const wt = mkWorktree({ "2026-07-31-x-spec-407.md": "- [ ] belum\n" });
    expect(stageForRun(goalPhases(), wt, "SPEC-407")).toBe("executing");
    const bersih = mkWorktree({ "2026-07-31-x-spec-407.md": "- [x] beres\n" });
    expect(stageForRun(goalPhases(), bersih, "SPEC-407")).toBe("done");
  });
});

// SPEC-734 · AC-6 · INVARIAN 1 — item yang BERPINDAH metode adalah kasus yang menentukan.
describe("planComplete · lintas metode (SPEC-734)", () => {
  const wt = () => mkdtempSync(join(tmpdir(), "hn-plan-"));
  const write = (root: string, rel: string, body: string) => {
    mkdirSync(join(root, rel.slice(0, rel.lastIndexOf("/"))), { recursive: true });
    writeFileSync(join(root, rel), body);
  };

  it("plan superpowers yang masih `- [ ]` menahan item meski metode aktifnya matt", () => {
    const root = wt();
    write(root, "docs/superpowers/plans/2026-08-13-spec-9.md", "- [ ] belum\n");
    mkdirSync(join(root, "docs/matt/plans"), { recursive: true });
    expect(planComplete(root, "SPEC-9")).toBe(false);
  });

  it("plan matt yang masih `- [ ]` menahan item meski dir superpowers tak ada", () => {
    const root = wt();
    write(root, "docs/matt/plans/2026-08-13-spec-9.md", "- [ ] belum\n");
    expect(planComplete(root, "SPEC-9")).toBe(false);
  });

  it("kedua direktori bersih → selesai", () => {
    const root = wt();
    write(root, "docs/superpowers/plans/2026-08-13-spec-9.md", "- [x] beres\n");
    write(root, "docs/matt/plans/2026-08-13-spec-9.md", "- [x] beres\n");
    expect(planComplete(root, "SPEC-9")).toBe(true);
  });

  // Direktori metode PERTAMA yang tak ada tak boleh menghentikan pemindaian metode kedua —
  // inilah bentuk kode yang membuat gerbangnya fail-open sebelum spec ini (`return true`).
  it("dir metode pertama tak ada tak menghentikan pemindaian metode kedua", () => {
    const root = wt();
    write(root, "docs/matt/plans/2026-08-13-spec-9.md", "- [ ] belum\n");
    expect(planComplete(root, "SPEC-9")).toBe(false);
  });

  it("tak ada plan cocok sama sekali → true (tak ada checklist untuk digerbang)", () => {
    expect(planComplete(wt(), "SPEC-9")).toBe(true);
  });
});

describe("SPEC-825 · flow no_effort (satu fase)", () => {
  const kerjakan = (state: PhaseState): Phase[] => [{ name: "Kerjakan", state }];

  it("readPhases memberi satu fase aktif saat berkas belum ada", () => {
    expect(readPhases(file, "no_effort").map((p) => `${p.name}:${p.state}`))
      .toEqual(["Kerjakan:active"]);
  });

  it("fase kerja yang AKTIF sudah berarti executing — cermin Execute & Goal", () => {
    expect(stageFor(kerjakan("active"))).toBe("executing");
  });

  it("fase kerja selesai langsung mencapai done — tak ada fase verifikasi untuk menutup", () => {
    expect(stageFor(kerjakan("done"))).toBe("done");
    expect(stageFor(kerjakan("skipped"))).toBe("done");
  });

  it("phasesComplete benar untuk pipeline satu fase", () => {
    expect(phasesComplete(kerjakan("done"))).toBe(true);
    expect(phasesComplete(kerjakan("active"))).toBe(false);
  });
});
