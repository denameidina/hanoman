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

  // M-6 · codex tak punya tool AskUserQuestion — orchestrator codex bertanya di terminal ini,
  // bukan lewat tool yang tak ada. claude tetap memakainya.
  it("codex bertanya di terminal, bukan AskUserQuestion; claude tetap AskUserQuestion", () => {
    const codexClause = orchestratorClause(plan("feature", "codex"));
    const claudeClause = orchestratorClause(plan("feature", "claude"));
    expect(codexClause).not.toContain("AskUserQuestion");
    expect(codexClause).toContain("tanyakan di terminal ini");
    expect(claudeClause).toContain("AskUserQuestion");
  });
  it("codex: aturan tanya-di-terminal tetap berlaku walau klausa otonomi menyuruh tak bertanya", () => {
    const c = orchestratorClause(plan("feature", "codex"));
    expect(c).toContain("Aturan ini berlaku walau klausa otonomi di prompt ini menyuruhmu tak bertanya");
  });

  // ADR-0167 · keputusan terbuka ditanyakan SEMUA sebelum marker fase, tanpa batas, dan orchestrator
  // tak pernah menjawab sendiri — lead (bila aktif) atau manusia yang memutuskan.
  it.each(["claude", "codex"] as const)("%s: relay keputusan terbuka sebelum marker, tanpa batas, tak menjawab sendiri", (rt) => {
    const c = orchestratorClause(plan("feature", rt));
    expect(c).toContain("`Keputusan terbuka:`");
    expect(c).toContain("`Status: menunggu-keputusan`");
    expect(c).toContain("SEBELUM menulis marker fase");
    expect(c).toContain("tak ada batas jumlah pertanyaan maupun putaran");
    expect(c).toContain("JANGAN pernah menjawab sendiri");
    expect(c).toMatch(/hanoman-lead bila aktif.*selain itu manusia/);
    expect(c).not.toContain("putuskan sendiri");
    expect(c).not.toContain("Pertanyaan untuk manusia:");
  });
  it("claude memecah >4 pertanyaan ke beberapa AskUserQuestion; codex satu pesan bernomor diakhiri ?", () => {
    expect(orchestratorClause(plan("feature", "claude")))
      .toContain("paling banyak 4 pertanyaan per panggilan, jadi pecah sisanya ke panggilan berikutnya");
    const codex = orchestratorClause(plan("feature", "codex"));
    expect(codex).toContain("tiap pertanyaan bernomor dan diakhiri `?`");
    expect(codex).not.toContain("AskUserQuestion");
  });
});

// I-2 · varian orchestrator dari klausa lanjutan audit (payload.fromAudit). Sesi tunggal boleh
// disuruh "pakai sebagai bahan" karena agen ITU SENDIRI mengerjakan fasenya; orchestrator TIDAK —
// instruksi yang sama di mode orchestrator berarti menyuruhnya mengerjakan isi fase sendiri.
describe("lanjutan audit (fromAudit) · varian orchestrator vs sesi tunggal (I-2, ADR-0164)", () => {
  const featureFromAudit = { id: "SPEC-320", title: "Ekspor CSV", source: "brief", priority: "sedang",
    objective: "bisa unduh", payload: { fromAudit: "SPEC-300" } };
  const qaFromAudit = { id: "SPEC-321", title: "Bug antrean", source: "qa", priority: "tinggi",
    objective: "perbaiki antrean", payload: { fromAudit: "SPEC-237", steps: "s" } };

  it("feature orchestrator: dokumen audit ke handoff Brainstorm, BUKAN dibaca/dirancang orchestrator", () => {
    const p = startPrompt("feature", featureFromAudit, "hanoman/spec-320", undefined, undefined,
      undefined, undefined, plan("feature"));
    expect(p).not.toContain("pekerjaanmu");
    expect(p).not.toContain("pakai sebagai bahan fase Brainstorm");
    expect(p).toContain("audit-spec-300-*.md");
    expect(p).toContain("Artefak fase sebelumnya");
  });

  // Final fix A2 (minor) · Objective biasanya membawa path artefak Brainstorm di baris `Artefak
  // fase sebelumnya:` — path dokumen audit harus DITAMBAHKAN di samping path itu, bukan menggantikannya.
  it("feature orchestrator: untuk Objective, path audit di samping path artefak Brainstorm", () => {
    const p = startPrompt("feature", featureFromAudit, "hanoman/spec-320", undefined, undefined,
      undefined, undefined, plan("feature"));
    expect(p).toContain("Objective");
    expect(p).toContain("di samping");
  });

  it("qa orchestrator: Audit ditandai skipped sendiri, dokumen diteruskan, satu keputusan routing", () => {
    const p = startPrompt("qa", qaFromAudit, "hanoman/spec-321", undefined, undefined,
      undefined, undefined, plan("qa"));
    expect(p).toContain("Audit skipped");
    expect(p).toContain('tail -1 "$HANOMAN_PHASE_FILE"');
    expect(p).toContain("SATU keputusan ROUTING");
    expect(p).not.toContain("baca dokumen audit itu sebagai temuan");
  });

  // Final fix A2 (important) · dua pemicu jalur cepat qa (langkah 5 orchestratorClause vs keputusan
  // routing dari dokumen audit pada kelanjutan) harus disambung eksplisit: kelanjutan audit
  // MENGGANTIKAN langkah 5, dan orchestrator DILARANG menunggu frasa `Rekomendasi fase: jalur-cepat`
  // dari agen Audit karena Audit tak pernah dijalankan pada kelanjutan ini.
  it("qa orchestrator: keputusan routing kelanjutan audit menggantikan langkah 5, tak menunggu frasa Audit", () => {
    const p = startPrompt("qa", qaFromAudit, "hanoman/spec-321", undefined, undefined,
      undefined, undefined, plan("qa"));
    expect(p).toContain("menggantikan langkah 5");
    expect(p).toContain("JANGAN menunggu frasa `Rekomendasi fase: jalur-cepat` dari agen Audit");
  });

  // Final fix A2 · sesi qa BIASA (tanpa fromAudit) tak boleh tersentuh: langkah 5 apa adanya, tanpa
  // klausa penggantian yang hanya berlaku pada kelanjutan audit.
  it("qa orchestrator TANPA fromAudit: langkah 5 apa adanya, tanpa klausa penggantian", () => {
    const p = startPrompt("qa", spec, "b", undefined, undefined, undefined, undefined, plan("qa"));
    expect(p).toContain("`Rekomendasi fase: jalur-cepat` sesudah Audit");
    expect(p).not.toContain("menggantikan langkah 5");
  });

  it("tanpa rencana (sesi tunggal): teks lama utuh — split orchestrator/sesi-tunggal eksplisit", () => {
    const pFeature = startPrompt("feature", featureFromAudit, "hanoman/spec-320");
    expect(pFeature).toContain("pekerjaanmu");
    expect(pFeature).toContain("pakai sebagai bahan fase Brainstorm");
    const pQa = startPrompt("qa", qaFromAudit, "hanoman/spec-321");
    expect(pQa).toContain("baca dokumen audit itu sebagai temuan");
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
