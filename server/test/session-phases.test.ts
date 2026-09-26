import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  phaseFilePath, decisionFilePath, readPhases, stageFor, planComplete, planCompleteAsync,
  stageForRun, stageForRunAsync, phasesComplete, sessionComplete, sessionCompleteAsync,
  enrichPhases, trackDoneSeen,
  type Phase, type PhaseState, type PhaseInvocation,
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

  // ADR-0171 · nama plan skill default (tanpa spec-id) tak pernah cocok regex — sebelumnya itu
  // lolos sebagai "tak ada plan untuk digerbang" (true) walau fase Plan sungguhan sudah `done`.
  describe("ADR-0171 · planPhaseDone", () => {
    it("Plan done tapi tak ada file cocok spec-id → BELUM complete", () => {
      const wt = mkWorktree({ "2026-09-25-orkestrasi-mutu-multi-subagent.md": "- [ ] belum" });
      expect(planComplete(wt, "SPEC-1234", true)).toBe(false);
    });
    it("Plan done + tak ada dir plan sama sekali → BELUM complete", () => {
      expect(planComplete(mkWorktree({}), "SPEC-1234", true)).toBe(false);
    });
    it("Plan BUKAN done (default false, mis. skipped/fast-path qa) → tetap true seperti semula", () => {
      expect(planComplete(mkWorktree({}), "SPEC-1234")).toBe(true);
      expect(planComplete(mkWorktree({}), "SPEC-1234", false)).toBe(true);
    });
    it("file cocok spec-id ada (apa pun isinya) → planPhaseDone tak berpengaruh", () => {
      const wt = mkWorktree({ "2026-07-11-x-spec-1234.md": "- [x] a\n" });
      expect(planComplete(wt, "SPEC-1234", true)).toBe(true);
    });
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

  // ADR-0171 · Plan `done` (bukan `skipped`) tapi tak satu pun berkas plan cocok spec-id (mis.
  // nama skill default tanpa spec-id) → tahan di `executing`, jangan lompat ke `done`.
  it("Plan done + Execute done + tak ada plan ber-spec-id → tahan di executing", () => {
    const wt = mkWorktree({ "2026-09-25-nama-tanpa-spec-id.md": "- [ ] belum" });
    expect(stageForRun(P([["Plan", "done"], ["Execute", "done"]]), wt, "SPEC-173")).toBe("executing");
  });

  // qa fast-path: Plan `skipped`, bukan `done` → perilaku lama tak berubah.
  it("Plan skipped (fast-path qa) + tak ada plan ber-spec-id → tetap done", () => {
    expect(stageForRun(P([["Plan", "skipped"], ["Execute", "done"]]), mkWorktree({}), "SPEC-173")).toBe("done");
  });

  // Flow tanpa fase Plan sama sekali (goal/no_effort/audit/dokumen) → tak ada entri "Plan" di
  // `phases`, `planPhaseDone` selalu false → perilaku lama tak berubah.
  it("flow tanpa fase Plan (mis. goal) → tak digerbang gerbang plan", () => {
    expect(stageForRun(P([["Goal", "done"], ["Verifikasi", "done"]]), mkWorktree({}), "SPEC-173")).toBe("done");
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

  // ADR-0171 · Plan `done` sungguhan tanpa plan ber-spec-id (nama skill default) → BELUM complete,
  // bukan lolos diam-diam ke pil "Selesai".
  it("Plan done + Execute done + tak ada plan ber-spec-id → BELUM complete", () => {
    const wt = mkWorktree({ "2026-09-25-nama-tanpa-spec-id.md": "- [ ] belum" });
    expect(sessionComplete(P([["Plan", "done"], ["Execute", "done"]]), wt, "SPEC-433")).toBe(false);
  });
});

// ADR-0171 · varian async harus bersemantik identik dengan varian sync untuk gerbang plan baru.
describe("ADR-0171 · varian async identik sync", () => {
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];

  it("planCompleteAsync: Plan done tanpa plan ber-spec-id → false, sama seperti sync", async () => {
    const wt = mkWorktree({ "2026-09-25-nama-tanpa-spec-id.md": "- [ ] belum" });
    expect(await planCompleteAsync(wt, "SPEC-1234", true)).toBe(false);
    expect(planComplete(wt, "SPEC-1234", true)).toBe(false);
  });

  it("stageForRunAsync: Plan done + Execute done + tak ada plan ber-spec-id → executing", async () => {
    const wt = mkWorktree({ "2026-09-25-nama-tanpa-spec-id.md": "- [ ] belum" });
    expect(await stageForRunAsync(P([["Plan", "done"], ["Execute", "done"]]), wt, "SPEC-173"))
      .toBe("executing");
  });

  it("sessionCompleteAsync: Plan done + Execute done + tak ada plan ber-spec-id → false", async () => {
    const wt = mkWorktree({ "2026-09-25-nama-tanpa-spec-id.md": "- [ ] belum" });
    expect(await sessionCompleteAsync(P([["Plan", "done"], ["Execute", "done"]]), wt, "SPEC-433"))
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

describe("enrichPhases (ADR-0164)", () => {
  const roster = [
    { name: "hanoman-fase-spec", phase: "Spec", model: "claude-opus-5", effort: "high" },
    { name: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low" },
  ];
  const inv = (o: Partial<PhaseInvocation>): PhaseInvocation => ({
    phase: "Spec", runtimeInvocationId: "a1", status: "completed", startedAt: "2026-09-14T00:00:00.000Z",
    durationMs: 72_000, inputTokens: 10, outputTokens: 5, cachedTokens: null, resultExcerpt: "Status: selesai", ...o,
  });
  const phases: Phase[] = [
    { name: "Brainstorm", state: "done" }, { name: "Spec", state: "done" }, { name: "Plan", state: "active" },
  ];

  // Sejak I-1, `enrichPhases` mewajibkan `bornAt` (ms epoch; 0 = tak diketahui → perilaku lama).
  // Seluruh test di bawah memakai `bornAt=0` KECUALI yang eksplisit menguji pembatasan umur sesi.
  it("fase tanpa agen fase di roster tak disentuh", () => {
    expect(enrichPhases(phases, roster, [], new Map(), 0, 0)[0]).toEqual({ name: "Brainstorm", state: "done" });
  });
  it("invocation terakhir menentukan status; percobaan = agent id berbeda", () => {
    const [, spec] = enrichPhases(phases, roster, [
      inv({ runtimeInvocationId: "a1", status: "interrupted", startedAt: "2026-09-14T00:00:00.000Z" }),
      inv({ runtimeInvocationId: "a2", status: "completed", startedAt: "2026-09-14T00:05:00.000Z" }),
    ], new Map(), 0, 0);
    expect(spec!.agent).toMatchObject({
      name: "hanoman-fase-spec", model: "claude-opus-5", effort: "high", status: "completed", attempts: 2, evidence: "ok",
    });
  });
  it("fase done tanpa invocation: pending selama tenggang, missing sesudahnya", () => {
    const seen = new Map([["Spec", 1_000]]);
    expect(enrichPhases(phases, roster, [], seen, 1_000 + 59_999, 0)[1]!.agent!.evidence).toBe("pending");
    expect(enrichPhases(phases, roster, [], seen, 1_000 + 60_000, 0)[1]!.agent!.evidence).toBe("missing");
  });
  it("fase aktif belum berinvocation tetap pending walau lama", () => {
    expect(enrichPhases(phases, roster, [], new Map(), 10_000_000, 0)[2]!.agent)
      .toMatchObject({ attempts: 0, evidence: "pending" });
  });
  // ADR-0170 · reviewer Execute tercatat di bawah fase Execute (roster `phase: "Execute"`), tapi
  // bukan percobaan Execute: chip tetap milik agen Execute, status = invocation agen Execute terakhir.
  it("reviewer satu fase tak dihitung sebagai percobaan agen fasenya", () => {
    const exec: Phase[] = [{ name: "Execute", state: "active" }];
    const withReviewer = [
      { name: "hanoman-fase-review", phase: "Execute", model: "claude-opus-5", effort: "high" },
      { name: "hanoman-fase-execute", phase: "Execute", model: "claude-sonnet-5", effort: "high" },
    ];
    const [e] = enrichPhases(exec, withReviewer, [
      inv({ phase: "Execute", agentName: "hanoman-fase-execute", runtimeInvocationId: "x1", status: "completed",
        startedAt: "2026-09-14T00:00:00.000Z" }),
      inv({ phase: "Execute", agentName: "hanoman-fase-review", runtimeInvocationId: "r1", status: "running",
        startedAt: "2026-09-14T00:05:00.000Z" }),
    ], new Map(), 0, 0);
    expect(e!.agent).toMatchObject({ name: "hanoman-fase-execute", attempts: 1, status: "completed" });
  });
});

// I-1 · ADR-0164 · sesi ditutup di tengah fase lalu dilanjutkan (id sesi sama, `sessionIdForSpec`)
// meninggalkan baris invocation dari SEBELUM kelahiran sesi baru — tanpa gerbang ini chip Plan
// tampil "running 2h…"/`↻` palsu dari run yang sudah mati.
describe("enrichPhases · I-1 chip dibatasi umur sesi (ADR-0164)", () => {
  const roster = [{ name: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low" }];
  const phases: Phase[] = [{ name: "Plan", state: "active" }];
  const inv = (o: Partial<PhaseInvocation> = {}): PhaseInvocation => ({
    phase: "Plan", runtimeInvocationId: "old-1", status: "running", startedAt: "2026-09-14T00:00:00.000Z",
    durationMs: null, inputTokens: null, outputTokens: null, cachedTokens: null, resultExcerpt: null, ...o,
  });
  const BORN = Date.parse("2026-09-14T01:00:00.000Z");

  it("invocation lama running SEBELUM bornAt tak tampil running; attempts nol", () => {
    const [plan] = enrichPhases(phases, roster, [inv()], new Map(), BORN + 1_000, BORN);
    expect(plan!.agent).toMatchObject({ attempts: 0, evidence: "pending" });
    expect(plan!.agent!.status).toBeUndefined();
  });

  it("invocation lama + baru: attempts hanya baris SESUDAH lahir, status dari baris baru", () => {
    const invs = [
      inv({ runtimeInvocationId: "old-1", status: "running", startedAt: "2026-09-14T00:00:00.000Z" }),
      inv({ runtimeInvocationId: "new-1", status: "completed", startedAt: "2026-09-14T01:05:00.000Z" }),
    ];
    const [plan] = enrichPhases(phases, roster, invs, new Map(), BORN + 10 * 60_000, BORN);
    expect(plan!.agent).toMatchObject({ attempts: 1, status: "completed", evidence: "ok" });
  });

  it("bornAt 0 → perilaku lama (semua invocation, tanpa peduli waktu, ikut dihitung)", () => {
    const [plan] = enrichPhases(phases, roster, [inv()], new Map(), BORN + 1_000, 0);
    expect(plan!.agent).toMatchObject({ attempts: 1, status: "running", evidence: "ok" });
  });
});

// M-2 · ADR-0164 · fase yang SUDAH done|skipped SAAT SESI LAHIR (mis. sesi lama mode tunggal tanpa
// invocation, dilanjutkan sebagai orchestrator baru) tak boleh dilabeli ⚠ "missing" hanya karena
// tak ada invocation SESUDAH lahir — createSession menandainya lewat `@hanoman_done_at_birth`.
describe("enrichPhases · M-2 fase sudah done saat lahir (ADR-0164)", () => {
  const roster = [{ name: "hanoman-fase-spec", phase: "Spec", model: "claude-opus-5", effort: "high" }];
  const specDone: Phase[] = [{ name: "Spec", state: "done" }];
  const oldInv = (): PhaseInvocation => ({
    phase: "Spec", runtimeInvocationId: "legacy-1", status: "completed", startedAt: "2026-09-01T00:00:00.000Z",
    durationMs: 1_000, inputTokens: 1, outputTokens: 1, cachedTokens: null, resultExcerpt: "Status: selesai",
  });
  const BORN = Date.parse("2026-09-14T00:00:00.000Z");

  it("done saat lahir TANPA invocation sama sekali: tak pernah missing walau lewat tenggang", () => {
    const seen = new Map([["Spec", BORN]]);
    const doneAtBirth = new Set(["Spec"]);
    const [spec] = enrichPhases(specDone, roster, [], seen, BORN + 10 * 60_000, BORN, doneAtBirth);
    expect(spec!.agent!.evidence).toBe("pending");
  });

  it("done saat lahir DENGAN invocation lama (sebelum bornAt): evidence ok, status/attempts tak ikut invocation lama", () => {
    const seen = new Map([["Spec", BORN]]);
    const doneAtBirth = new Set(["Spec"]);
    const [spec] = enrichPhases(specDone, roster, [oldInv()], seen, BORN + 10 * 60_000, BORN, doneAtBirth);
    expect(spec!.agent).toMatchObject({ attempts: 0, evidence: "ok" });
    expect(spec!.agent!.status).toBeUndefined();
  });

  it("done SESUDAH lahir (bukan di daftar doneAtBirth) tanpa invocation: missing sesudah tenggang (perilaku lama tetap)", () => {
    const seen = new Map([["Spec", BORN + 1_000]]);
    const [spec] = enrichPhases(specDone, roster, [], seen, BORN + 1_000 + 60_000, BORN);
    expect(spec!.agent!.evidence).toBe("missing");
  });
});

describe("trackDoneSeen (ADR-0164)", () => {
  const P = (pairs: [string, PhaseState][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state }));

  it("mencatat waktu PERTAMA kali terlihat done, sekali saja", () => {
    const seen = new Map<string, number>();
    trackDoneSeen(P([["Spec", "done"]]), seen, 1_000);
    trackDoneSeen(P([["Spec", "done"]]), seen, 5_000);
    expect(seen.get("Spec")).toBe(1_000);
  });

  it("melupakan fase yang tak lagi done (mis. direset ke active)", () => {
    const seen = new Map([["Spec", 1_000]]);
    trackDoneSeen(P([["Spec", "active"]]), seen, 5_000);
    expect(seen.has("Spec")).toBe(false);
  });

  it("melupakan fase yang tak lagi hadir di daftar", () => {
    const seen = new Map([["Spec", 1_000]]);
    trackDoneSeen(P([["Plan", "active"]]), seen, 5_000);
    expect(seen.has("Spec")).toBe(false);
  });

  it("fase done lain tak tersentuh oleh entri yang dilupakan", () => {
    const seen = new Map([["Spec", 1_000], ["Brainstorm", 500]]);
    trackDoneSeen(P([["Brainstorm", "done"], ["Spec", "pending"]]), seen, 5_000);
    expect(seen.get("Brainstorm")).toBe(500);
    expect(seen.has("Spec")).toBe(false);
  });
});

// Regresi 0.9.8 · gerbang `planPhaseDone` di atas menahan SETIAP backlog project yang menaruh plan di
// luar PLAN_DIRS (mis. erp-tumbuh-ai: `internal/docs/superpowers/plans/`, diarsip ke
// `internal/docs/superpowers/done/plans/`) — nama berkasnya ber-spec-id, tapi pemindaian hanya
// melihat `docs/superpowers/plans` → "tak ada plan" → `executing` selamanya. Plan ber-spec-id di
// direktori `plans/` mana pun di worktree (git-tracked atau untracked) harus ikut dinilai.
describe("gerbang plan · plan ber-spec-id di luar PLAN_DIRS", () => {
  const P = (pairs: [string, string][]): Phase[] =>
    pairs.map(([name, state]) => ({ name, state })) as Phase[];
  const mkRepo = (files: Record<string, string>) => {
    const wt = mkdtempSync(join(tmpdir(), "hanoman-wt-"));
    execFileSync("git", ["init", "-q", wt]);
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(wt, rel, ".."), { recursive: true });
      writeFileSync(join(wt, rel), body);
    }
    return wt;
  };
  const done = P([["Plan", "done"], ["Execute", "done"]]);

  it("plan tuntas di internal/docs/superpowers/plans → done", async () => {
    const wt = mkRepo({ "internal/docs/superpowers/plans/2026-09-25-spec-1341-soap-plan.md": "- [x] a\n" });
    expect(stageForRun(done, wt, "SPEC-1341")).toBe("done");
    expect(await stageForRunAsync(done, wt, "SPEC-1341")).toBe("done");
    expect(sessionComplete(done, wt, "SPEC-1341")).toBe(true);
  });

  it("plan tuntas yang sudah diarsip ke done/plans → done", async () => {
    const wt = mkRepo({ "internal/docs/superpowers/done/plans/2026-09-25-spec-1341-soap-plan.md": "- [x] a\n" });
    expect(stageForRun(done, wt, "SPEC-1341")).toBe("done");
    expect(await sessionCompleteAsync(done, wt, "SPEC-1341")).toBe(true);
  });

  it("plan di luar PLAN_DIRS masih `- [ ]` → tetap executing", async () => {
    const wt = mkRepo({ "internal/docs/superpowers/plans/2026-09-25-spec-1341-soap-plan.md": "- [ ] belum\n" });
    expect(stageForRun(done, wt, "SPEC-1341")).toBe("executing");
    expect(await stageForRunAsync(done, wt, "SPEC-1341")).toBe("executing");
  });

  it("berkas ber-spec-id yang BUKAN di direktori plans (mis. specs/) tak dihitung sebagai plan", () => {
    const wt = mkRepo({ "internal/docs/superpowers/specs/2026-09-25-spec-1341-design.md": "x\n" });
    expect(stageForRun(done, wt, "SPEC-1341")).toBe("executing");
  });
});
