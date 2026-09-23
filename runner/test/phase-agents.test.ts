import { describe, it, expect } from "vitest";
import { ORCHESTRATION_DEFAULTS, resolveMethod, resolvePhasePlan } from "@hanoman/shared";
import { buildPhaseAgents, fromAuditOf } from "../src/phase-agents";
import { CODE_STYLE_CLAUSE } from "../src/code-style";
import { ESCALATION_CONTRACT, startPrdPrompt, startProjectPrompt, startScaffoldPrompt } from "../src/prompt";
import type { AgentDef } from "../src/custom-agents";
import type { Flow } from "../src/types";

const planFor = (flow: Flow) => resolvePhasePlan({
  flow, runtime: "claude", orchestration: ORCHESTRATION_DEFAULTS,
  orchestrator: { model: "claude-opus-5", effort: "high" }, nativeAgents: true,
})!;
const agentsFor = (flow: Flow, over: Partial<Parameters<typeof buildPhaseAgents>[1]> = {}) =>
  buildPhaseAgents(planFor(flow), {
    flow, method: resolveMethod("superpowers"), verifyScope: "changed", context: "KONTEKS-UJI", ...over,
  });
const at = (defs: AgentDef[], phase: string) => defs.find((d) => d.phase === phase)!;

describe("buildPhaseAgents (ADR-0164)", () => {
  it("satu agen fase per fase, bernama & ber-model sesuai rencana, tanpa tools", () => {
    const defs = agentsFor("feature");
    expect(defs.map((d) => d.name)).toEqual([
      "hanoman-fase-brainstorm", "hanoman-fase-objective", "hanoman-fase-spec",
      "hanoman-fase-plan", "hanoman-fase-execute",
    ]);
    // Default bawaan memakai alias native CLI sejak 1a5a0981, bukan id terpatok.
    const expectedRuntime = {
      Brainstorm: { model: "sonnet", effort: "medium" },
      Objective: { model: "sonnet", effort: "medium" },
      Spec: { model: "opus", effort: "medium" },
      Plan: { model: "sonnet", effort: "medium" },
      Execute: { model: "sonnet", effort: "medium" },
    } as const;
    for (const d of defs) {
      expect(d).toMatchObject({
        kind: "phase", tools: null, ...expectedRuntime[d.phase as keyof typeof expectedRuntime], mentions: [],
      });
      expect(d.instructions).toContain("KONTEKS-UJI");
      expect(d.instructions).toContain("JANGAN menulis `$HANOMAN_PHASE_FILE`");
      expect(d.instructions).toContain("Status: selesai | sebagian | terhalang | menunggu-keputusan");
      expect(d.instructions).toContain("`Keputusan terbuka:`");
    }
  });

  // ADR-0167 · 166 run agen fase, 0 pertanyaan: asumsi jatuh ke prosa/`Rekomendasi fase:` yang tak dibaca
  // orchestrator. Agen fase tak boleh memutuskan yang ambigu, dan daftarnya tak berbatas.
  it("keputusan ambigu dilaporkan sebagai `Keputusan terbuka:` tanpa batas, bukan diputuskan sendiri", () => {
    for (const d of agentsFor("feature")) {
      expect(d.instructions).not.toContain("Pertanyaan untuk manusia:");
      expect(d.instructions).toContain("TIDAK BOLEH memutuskan sendiri");
      expect(d.instructions).toContain("asumsi yang terpaksa");
      expect(d.instructions).toContain("tanpa batas jumlah");
      expect(d.instructions).toContain("`selesai` hanya sah bila isinya `-`");
      expect(d.instructions).toMatch(/hanoman-lead bila aktif.*selain itu manusia/);
      expect(d.instructions).not.toMatch(/SATU pertanyaan|maksimal \d+ pertanyaan/i);
    }
  });

  it("skill metode hanya di fase pemiliknya; exitSkills di fase terakhir flow penulis-kode", () => {
    const defs = agentsFor("feature");
    expect(at(defs, "Brainstorm").instructions).toContain("superpowers:brainstorming");
    expect(at(defs, "Plan").instructions).toContain("superpowers:writing-plans");
    expect(at(defs, "Execute").instructions).toContain("superpowers:verification-before-completion");
    expect(at(defs, "Objective").instructions).not.toContain("Skills superpowers WAJIB");
    expect(at(defs, "Plan").instructions).not.toContain("superpowers:brainstorming");
  });

  it("Execute membawa gerbang plan, scope verifikasi, dan klausa gaya kode; fase lain tidak", () => {
    const defs = agentsFor("feature");
    expect(at(defs, "Execute").instructions).toContain("- [ ]");
    expect(at(defs, "Execute").instructions).toContain("Scope verifikasi");
    expect(at(defs, "Execute").instructions).toContain(CODE_STYLE_CLAUSE);
    expect(at(defs, "Spec").instructions).not.toContain(CODE_STYLE_CLAUSE);
  });

  it("metode matt: skill & klausa khas matt ikut, plan dir matt", () => {
    const defs = agentsFor("qa", { method: resolveMethod("matt") });
    expect(at(defs, "Plan").instructions).toContain("mattpocock-skills:to-tickets");
    expect(at(defs, "Plan").instructions).toContain("docs/matt/plans");
    expect(at(defs, "Execute").instructions).toContain("TAK BERPENUNGGU");
  });

  it("Audit qa merekomendasikan jalur, bukan menulis marker", () => {
    const audit = at(agentsFor("qa"), "Audit").instructions;
    expect(audit).toContain("Rekomendasi fase: jalur-cepat");
    expect(audit).not.toContain('echo "Spec skipped"');
  });

  it("lanjutan audit menyebut dokumen audit asal di Brainstorm", () => {
    const b = at(agentsFor("feature", { fromAudit: "SPEC-1100" }), "Brainstorm").instructions;
    expect(b).toContain("internal/docs/research/audit-spec-1100-*.md");
  });

  // I-2 · ADR-0164 · qa lanjutan audit: orchestrator menandai `Audit skipped` SENDIRI (tanpa
  // mendelegasikan ke agen fase Audit) — jadi agen fase Audit tak pernah dipanggil dalam skenario
  // ini. Fase pertama yang BENAR-BENAR dipanggil adalah Spec; ia yang harus menerima catatan
  // dokumen audit asal, bukan Audit.
  it("qa lanjutan audit: note juga di Spec — fase pertama yang benar-benar dipanggil sesudah Audit dilewati", () => {
    const s = at(agentsFor("qa", { fromAudit: "SPEC-1100" }), "Spec").instructions;
    expect(s).toContain("internal/docs/research/audit-spec-1100-*.md");
  });

  it("flow audit: kontrak eskalasi hanya di Laporan", () => {
    const defs = agentsFor("audit");
    expect(at(defs, "Laporan").instructions).toContain(ESCALATION_CONTRACT);
    expect(at(defs, "Audit").instructions).not.toContain(ESCALATION_CONTRACT);
    expect(at(defs, "Audit").instructions).toContain("JANGAN menulis perbaikan kode");
  });

  it("reverse: STANDAR DOCS hanya di fase penulis docs; Wawancara memakai baris panduan yang sama", () => {
    const defs = agentsFor("reverse", { method: resolveMethod() });
    expect(at(defs, "Docs teknis").instructions).toContain("=== STANDAR DOCS ===");
    expect(at(defs, "Konvensi & index").instructions).toContain("=== STANDAR DOCS ===");
    expect(at(defs, "Wawancara").instructions).not.toContain("=== STANDAR DOCS ===");
    expect(at(defs, "Wawancara").instructions).toContain("- Wawancara: untuk product, business");
  });

  // R4 · agen fase tak punya terminal ke manusia: baris panduan fase bergiliran (Wawancara reverse,
  // Brainstorm scaffold/prd) dan Serah terima reverse yang menyuruh bertanya/menulis "di terminal"
  // diadaptasi HANYA untuk agen fase. Prompt sesi tunggal tak berubah (prompt-golden).
  it.each([
    ["reverse", "Wawancara"], ["scaffold", "Brainstorm"], ["prd", "Brainstorm"],
  ] as const)("%s/%s: pertanyaan jadi `Keputusan terbuka:` satu topik per putaran, bukan terminal", (flow, phase) => {
    const guide = at(agentsFor(flow, { method: resolveMethod(), prd: { slug: "dasbor" } }), phase).instructions
      .split("\n\n").find((block) => block.startsWith(`- ${phase}:`))!;
    expect(guide).toBeDefined();
    expect(guide).not.toMatch(/terminal/);
    expect(guide).toContain("`Keputusan terbuka:`");
    expect(guide).toContain("satu topik per putaran");
    expect(guide).toContain("`Status: menunggu-keputusan`");
    expect(guide).toContain("Jangan mengarang");
  });
  it("reverse/Serah terima: ringkasan masuk laporan untuk ditampilkan orchestrator, bukan ke terminal", () => {
    const guide = at(agentsFor("reverse", { method: resolveMethod() }), "Serah terima").instructions
      .split("\n\n").find((block) => block.startsWith("- Serah terima:"))!;
    expect(guide).not.toMatch(/terminal/);
    expect(guide).toContain("`Ringkasan serah terima:`");
    expect(guide).toContain("orchestrator");
  });
  it("sesi tunggal reverse/scaffold/prd tetap bertanya di terminal (tak tersentuh adaptasi agen fase)", () => {
    const project = { id: "p1", name: "P1", desc: "d", stack: "ts" };
    expect(startProjectPrompt("reverse", project, "reverse-docs"))
      .toContain("ajukan SATU pertanyaan per giliran ke manusia di terminal ini");
    expect(startScaffoldPrompt(project, "scaffold-docs"))
      .toContain("Ajukan SATU pertanyaan per giliran ke manusia di terminal ini");
    expect(startPrdPrompt(project, { title: "T", context: "c", outcome: "o" }, "prd/t"))
      .toContain("Ajukan SATU pertanyaan per giliran ke manusia di terminal ini");
  });

  it("prd & breakdown: baris panduan memakai slug", () => {
    expect(at(agentsFor("prd", { method: resolveMethod(), prd: { slug: "dasbor" } }), "PRD").instructions)
      .toContain("docs/prd/dasbor.md");
    expect(at(agentsFor("breakdown", { method: resolveMethod(), prd: { slug: "dasbor", title: "Dasbor" } }), "Breakdown").instructions)
      .toContain("# Breakdown: Dasbor");
  });

  it("goal: Verifikasi bukan formalitas; Goal tanpa skill", () => {
    const defs = agentsFor("goal");
    expect(at(defs, "Verifikasi").instructions).toContain("bukan formalitas");
    expect(at(defs, "Goal").instructions).not.toContain("Skills superpowers WAJIB");
  });

  // S2 · SPEC-394 · subagent lahir dengan konteks TERPISAH — catatan resume yang hanya ditempel ke
  // prompt orchestrator tak pernah sampai. Tanpa ini agen fase menulis ulang pekerjaan belum-commit
  // atau Brainstorm membuat dokumen spec kedua.
  it("S2 · resume: catatan melanjutkan ikut ke setiap agen fase, sebelum blok KONTEKS", () => {
    const kept = agentsFor("feature", { resume: { worktreeKept: true, recorded: ["Brainstorm done"] } });
    for (const d of kept) {
      expect(d.instructions).toContain("MELANJUTKAN pekerjaan sesi sebelumnya");
      expect(d.instructions).toContain("termasuk perubahan yang belum di-commit");
      expect(d.instructions).toContain("Brainstorm done");
      expect(d.instructions).toContain("`git log --oneline` dan `git status`");
      expect(d.instructions.indexOf("MELANJUTKAN")).toBeLessThan(d.instructions.indexOf("=== KONTEKS ==="));
    }
    expect(at(kept, "Brainstorm").instructions).toContain("JANGAN membuat dokumen baru kedua");
    const rebuilt = agentsFor("feature", { resume: { worktreeKept: false, recorded: [] } });
    expect(at(rebuilt, "Plan").instructions).toContain("DIBANGUN ULANG");
    expect(at(rebuilt, "Plan").instructions).not.toContain("tercatat di $HANOMAN_PHASE_FILE");
  });

  it("S2 · tanpa resume: instruksi byte-identik (tak ada catatan melanjutkan)", () => {
    const fresh = agentsFor("feature");
    const explicit = agentsFor("feature", { resume: undefined });
    expect(explicit.map((d) => d.instructions)).toEqual(fresh.map((d) => d.instructions));
    for (const d of fresh) expect(d.instructions).not.toContain("MELANJUTKAN");
  });
});

describe("fromAuditOf", () => {
  it("membaca payload.fromAudit secara defensif", () => {
    expect(fromAuditOf({ fromAudit: "SPEC-1" })).toBe("SPEC-1");
    expect(fromAuditOf({ fromAudit: "" })).toBeUndefined();
    expect(fromAuditOf(["x"])).toBeUndefined();
    expect(fromAuditOf(null)).toBeUndefined();
  });
});
