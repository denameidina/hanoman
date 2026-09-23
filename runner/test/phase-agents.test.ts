import { describe, it, expect } from "vitest";
import { ORCHESTRATION_DEFAULTS, resolveMethod, resolvePhasePlan } from "@hanoman/shared";
import { buildPhaseAgents, fromAuditOf } from "../src/phase-agents";
import { CODE_STYLE_CLAUSE } from "../src/code-style";
import { ESCALATION_CONTRACT } from "../src/prompt";
import { phasePromptOf, renderAgentsJson, type AgentDef } from "../src/custom-agents";
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
      // T2 · konteks bersama TIDAK disalin ke tiap instruksi — dibawa terpisah supaya renderer claude
      // bisa merujuknya lewat SATU berkas (argumen `--agents` tetap di bawah MAX_ARG_STRLEN Linux).
      expect(d.instructions).not.toContain("KONTEKS-UJI");
      expect(d.context).toBe("KONTEKS-UJI");
      expect(phasePromptOf(d)).toContain("=== KONTEKS ===\nKONTEKS-UJI");
      expect(d.instructions).toContain("JANGAN menulis `$HANOMAN_PHASE_FILE`");
      expect(d.instructions).toContain("Status: selesai | sebagian | terhalang | menunggu-keputusan");
      expect(d.instructions).toContain("`Keputusan terbuka:`");
    }
  });

  // T1 · audit: 22 laporan agen fase tanpa baris `Status:` — agen fase mengakhiri gilirannya sambil
  // menunggu proses latarnya sendiri ("I'll pause here and wait for the background test run"), dan
  // orchestrator membaca teks itu sebagai laporan final.
  it("dilarang mengakhiri giliran selama masih menunggu proses/tugas latar miliknya sendiri", () => {
    for (const d of agentsFor("feature")) {
      expect(d.instructions).toMatch(/JANGAN mengakhiri giliran.*proses\/tugas latar milikmu sendiri/);
      expect(d.instructions).toContain("tunggu sampai selesai");
      expect(d.instructions).toMatch(/laporan lengkap berawalan `Status:`/);
    }
  });

  // T2 · terukur di audit: payload 25 KB → argumen `--agents` 168 KB karena konteks disalin ke tiap
  // fase; Linux menolak satu argumen > 128 KiB (MAX_ARG_STRLEN). Dengan konteks dirujuk lewat berkas,
  // ukuran argumen tak lagi bergantung ukuran konteks.
  it("konteks besar dirujuk lewat berkas: argumen --agents jauh di bawah 128 KiB", () => {
    const big = "Langkah \"reproduksi\": buka halaman — klik tombol.\n".repeat(2_000); // ≈ 100 KB
    const defs = agentsFor("feature", { context: big });
    const inline = Buffer.byteLength(renderAgentsJson(defs));
    const ref = Buffer.byteLength(renderAgentsJson(defs, {
      phaseContextFile: { context: big, path: "/tmp/hanoman-agents/s/phase-context.md" },
    }));
    expect(inline).toBeGreaterThan(128 * 1024);
    expect(ref).toBeLessThan(64 * 1024);
    expect(inline - ref).toBeGreaterThan(defs.length * (Buffer.byteLength(big) - 1024));
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
