import { describe, it, expect } from "vitest";
import { ORCHESTRATION_DEFAULTS, resolvePhasePlan, type Orchestration } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "../src/code-style";
import {
  orchestratorClause, startPrompt, continuePrompt, resumePrompt, startGoalPrompt, startProjectPrompt,
  startPrdPrompt, startBreakdownPrompt, startScaffoldPrompt, specContext,
} from "../src/prompt";
import type { Flow } from "../src/types";

const plan = (flow: Flow, runtime: "claude" | "codex" = "claude", orchestration: Orchestration = ORCHESTRATION_DEFAULTS) =>
  resolvePhasePlan({
    flow, runtime, orchestration, orchestrator: { model: "claude-opus-5", effort: "high" }, nativeAgents: true,
  })!;
const spec = { id: "SPEC-9", title: "T", source: "brief", priority: "sedang", objective: "O", payload: { a: 1 } };
const project = { id: "p1", name: "P1", desc: "d", stack: "ts" };

describe("orchestratorClause (ADR-0164)", () => {
  it("mendaftar agen fase ber-model/effort, aturan ulang/eskalasi/relay, dan larangan", () => {
    const o: Orchestration = { ...ORCHESTRATION_DEFAULTS,
      feature: { enabled: true, claude: { Plan: { model: "claude-sonnet-5", effort: "low" } }, codex: {} } };
    const c = orchestratorClause(plan("feature", "claude", o));
    expect(c).toContain("Sesi ini ORCHESTRATOR");
    expect(c).toContain("4. Plan → `hanoman-fase-plan` · claude-sonnet-5 · low");
    expect(c).toContain("`Fase <Nama Fase>`");
    expect(c).toContain("Percobaan: <k>/2");
    expect(c).toContain("AskUserQuestion");
    expect(c).toContain("SendMessage");
    expect(c).toContain("DILARANG mengerjakan isi fase sendiri");
    expect(c).not.toContain("jalur-cepat");
  });
  // Live smoke (claude 2.1.270, orchestrator Haiku 4.5/low): (B) label statusline keluar
  // `Fase 1/1: Kerjakan` karena baris pertama blok serah-terima itu sendiri `Fase <n>/<total>: …`,
  // bersebelahan dengan instruksi deskripsi — model menyalin header alih-alih deskripsi. (A) orchestrator
  // menulis "Fase Kerjakan selesai" lalu langsung `git push` TANPA pernah menulis
  // `$HANOMAN_PHASE_FILE` — langkah 2 bukan gerbang wajib. Lihat progress.md T14 Step 3.
  it("blok serah-terima BUKAN 'Fase <n>/<total>:' dan deskripsi pemanggilan dijelaskan terpisah (temuan B)", () => {
    const c = orchestratorClause(plan("feature"));
    expect(c).toContain("Urutan: <n>/<total> · <Nama Fase>");
    expect(c).not.toContain("Fase <n>/<total>:");
    expect(c).toContain("`Fase <Nama Fase>`");
    expect(c).toContain("BUKAN baris pertama blok serah-terima");
  });
  it("langkah 2 menggerbang penulisan $HANOMAN_PHASE_FILE sebelum fase berikutnya/commit/push (temuan A)", () => {
    const c = orchestratorClause(plan("feature"));
    expect(c).toContain('tail -1 "$HANOMAN_PHASE_FILE"');
    expect(c).toContain("SEBELUM hal lain (memanggil fase berikutnya, commit, atau push)");
    expect(c).toContain("Kamu satu-satunya penulis berkas itu");
  });
  it("gerbang penutup: belum tuntas sampai tiap fase punya baris done/skipped — untuk plan claude & codex", () => {
    const claudeClause = orchestratorClause(plan("feature", "claude"));
    const codexClause = orchestratorClause(plan("feature", "codex"));
    for (const c of [claudeClause, codexClause]) {
      expect(c).toContain("BELUM selesai sampai SEMUA fase di daftar di atas punya baris");
      expect(c).toContain('cat "$HANOMAN_PHASE_FILE"');
    }
  });
  it("codex memakai spawn_agent & send_input; fastPath menambah aturan jalur cepat & tetap menggerbang skip", () => {
    const c = orchestratorClause(plan("qa", "codex"), { fastPath: true });
    expect(c).toContain("spawn_agent");
    expect(c).toContain("send_input");
    expect(c).toContain("`Rekomendasi fase: jalur-cepat`");
    expect(c).toContain("Spec skipped");
    expect(c).toContain("Plan skipped");
    expect(c).not.toContain("Fase <n>/<total>:");
    expect(c).toContain("BUKAN baris pertama blok serah-terima");
  });
});

describe("pembangun prompt · mode orchestrator (ADR-0164)", () => {
  it("rencana null identik dengan tanpa rencana", () => {
    expect(startPrompt("feature", spec, "b", undefined, "changed", undefined, undefined, null))
      .toBe(startPrompt("feature", spec, "b", undefined, "changed"));
  });
  it("startPrompt dengan rencana: kontrak delegasi tanpa cara mengerjakan fase", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-9", undefined, "changed", undefined, undefined, plan("feature"));
    expect(p).toContain("Sesi ini ORCHESTRATOR");
    expect(p).toContain(specContext(spec));
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-9");
    for (const bocor of ["superpowers:brainstorming", "Kerjakan fase berurutan", "Scope verifikasi", CODE_STYLE_CLAUSE])
      expect(p).not.toContain(bocor);
  });
  it("qa start memuat jalur cepat; resume qa yang Audit-nya sudah tercatat tidak", () => {
    expect(startPrompt("qa", spec, "b", undefined, undefined, undefined, undefined, plan("qa"))).toContain("jalur-cepat");
    const resume = { recorded: ["Audit done"], next: "Spec", worktreeKept: true };
    const r = resumePrompt("qa", spec, "b", resume, undefined, undefined, undefined, undefined, plan("qa"));
    expect(r).toContain("Lanjutkan dari fase: Spec.");
    expect(r).not.toContain("jalur-cepat");
  });
  it("continuePrompt hanya melanjutkan Execute", () => {
    const full = plan("feature");
    const p = continuePrompt("feature", spec, "b", undefined, undefined, undefined, undefined,
      { ...full, phases: full.phases.filter((x) => x.phase === "Execute") });
    expect(p).toContain("1. Execute → `hanoman-fase-execute`");
    expect(p).not.toContain("hanoman-fase-plan");
  });
  it("startGoalPrompt dengan rencana: klausa Verifikasi pindah ke agen fase", () => {
    const g = { ...spec, source: "goal", payload: { goal: "Hijau" } };
    const p = startGoalPrompt("goal", g, "b", { plan: plan("goal") });
    expect(p).toContain("Goal: Hijau");
    expect(p).toContain("hanoman-fase-verifikasi");
    expect(p).not.toContain("bukan formalitas");
  });
  it("reverse/scaffold/prd/breakdown: STANDAR DOCS & isi PRD tak masuk prompt orchestrator", () => {
    expect(startProjectPrompt("reverse", project, "reverse-docs", plan("reverse"))).not.toContain("=== STANDAR DOCS ===");
    expect(startScaffoldPrompt(project, "scaffold-docs", plan("scaffold"))).not.toContain("=== STANDAR DOCS ===");
    expect(startPrdPrompt(project, { title: "T", context: "c", outcome: "o" }, "prd/t", undefined, plan("prd")))
      .toContain("Brief — Judul: T");
    const b = startBreakdownPrompt(project, { title: "PRD", path: "docs/prd/p.md", content: "ISI-PRD-RAHASIA" },
      "breakdown/p", plan("breakdown"));
    expect(b).toContain("PRD: PRD (docs/prd/p.md)");
    expect(b).not.toContain("ISI-PRD-RAHASIA");
  });
});
