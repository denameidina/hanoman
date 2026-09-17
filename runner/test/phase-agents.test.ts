import { describe, it, expect } from "vitest";
import { ORCHESTRATION_DEFAULTS, resolveMethod, resolvePhasePlan } from "@hanoman/shared";
import { buildPhaseAgents, fromAuditOf } from "../src/phase-agents";
import { CODE_STYLE_CLAUSE } from "../src/code-style";
import { ESCALATION_CONTRACT } from "../src/prompt";
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
    const expectedRuntime = {
      Brainstorm: { model: "claude-sonnet-5", effort: "medium" },
      Objective: { model: "claude-sonnet-5", effort: "medium" },
      Spec: { model: "claude-opus-5", effort: "medium" },
      Plan: { model: "claude-sonnet-5", effort: "medium" },
      Execute: { model: "claude-sonnet-5", effort: "medium" },
    } as const;
    for (const d of defs) {
      expect(d).toMatchObject({
        kind: "phase", tools: null, ...expectedRuntime[d.phase as keyof typeof expectedRuntime], mentions: [],
      });
      expect(d.instructions).toContain("KONTEKS-UJI");
      expect(d.instructions).toContain("JANGAN menulis `$HANOMAN_PHASE_FILE`");
      expect(d.instructions).toContain("Status: selesai | sebagian | terhalang");
      expect(d.instructions).toContain("Pertanyaan untuk manusia:");
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
});

describe("fromAuditOf", () => {
  it("membaca payload.fromAudit secara defensif", () => {
    expect(fromAuditOf({ fromAudit: "SPEC-1" })).toBe("SPEC-1");
    expect(fromAuditOf({ fromAudit: "" })).toBeUndefined();
    expect(fromAuditOf(["x"])).toBeUndefined();
    expect(fromAuditOf(null)).toBeUndefined();
  });
});
