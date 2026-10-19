import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  ORCHESTRATION_DEFAULTS, SPEC_AUDIT_VERDICTS, SPEC_AUDIT_VERDICT_LIST, resolveMethod, resolvePhasePlan,
} from "@hanoman/shared";
import { buildPhaseAgents, fromAuditOf, phaseDelegationClause, withPhaseDelegation } from "../src/phase-agents";
import { CODE_STYLE_CLAUSE } from "../src/code-style";
import { ESCALATION_CONTRACT, orchestratorClause, startPrdPrompt, startProjectPrompt, startScaffoldPrompt } from "../src/prompt";
import { renderAntigravityAgent } from "../src/antigravity-agent-config";
import { phasePromptOf, renderAgentsJson, type AgentDef } from "../src/custom-agents";
import type { Flow } from "../src/types";

const planFor = (flow: Flow, runtime: "claude" | "codex" | "antigravity" = "claude") => resolvePhasePlan({
  flow, runtime, orchestration: ORCHESTRATION_DEFAULTS,
  orchestrator: { model: "claude-opus-5", effort: "high" }, nativeAgents: true,
})!;
const agentsFor = (flow: Flow, over: Partial<Parameters<typeof buildPhaseAgents>[1]> = {}) =>
  buildPhaseAgents(planFor(flow), {
    flow, method: resolveMethod("superpowers"), verifyScope: "changed", context: "KONTEKS-UJI", ...over,
  });
const REVIEW = "hanoman-fase-review";
const at = (defs: AgentDef[], phase: string) => defs.find((d) => d.phase === phase && d.name !== REVIEW)!;
const phaseOnly = (defs: AgentDef[]) => defs.filter((d) => d.name !== REVIEW);

describe("buildPhaseAgents (ADR-0164)", () => {
  it("satu agen fase per fase, bernama & ber-model sesuai rencana, tanpa tools", () => {
    const defs = phaseOnly(agentsFor("feature"));
    expect(agentsFor("feature").map((d) => d.name)).toEqual([
      "hanoman-fase-brainstorm", "hanoman-fase-objective", "hanoman-fase-spec",
      "hanoman-fase-plan", "hanoman-fase-execute", REVIEW,
    ]);
    // Default bawaan memakai alias native CLI sejak 1a5a0981, bukan id terpatok.
    const expectedRuntime = {
      Brainstorm: { model: "sonnet", effort: "medium" },
      Objective: { model: "sonnet", effort: "medium" },
      Spec: { model: "opus", effort: "high" },
      Plan: { model: "opus", effort: "high" },
      Execute: { model: "sonnet", effort: "high" },
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

  // ADR-0225 · 70 fase Plan terukur: median 143 rb token output & 130 KB plan karena kode lengkap
  // ikut tertulis — lalu Execute mengetiknya lagi. Plan tetap rencana, untuk metode apa pun.
  it("Plan menulis rencana, bukan kode — dan aturannya mengalahkan skill plan, di semua metode", () => {
    for (const method of ["superpowers", "matt", "agent-skills"]) {
      const plan = at(agentsFor("feature", { method: resolveMethod(method) }), "Plan").instructions;
      expect(plan).toContain("Bentuk plan: rencana, bukan kode");
      expect(plan).toContain("JANGAN menulis isi implementasi maupun isi test lengkap");
      expect(plan).toMatch(/mengalahkan anjuran .*kode lengkap/);
    }
    expect(at(agentsFor("feature"), "Execute").instructions).not.toContain("Bentuk plan: rencana");
  });

  // ADR-0225 · 89 sesi: median 2 putaran tanya tersebar sesudah Brainstorm, Spec, Plan, dan Execute —
  // tiap putaran menghentikan sesi sampai dijawab. Fase pertama mengumpulkan semuanya di depan.
  it("fase pertama yang bertanya mengumpulkan SEMUA keputusan sampai Execute dalam satu putaran", () => {
    const brainstorm = at(agentsFor("feature"), "Brainstorm").instructions;
    expect(brainstorm).toContain("SEMUA keputusan yang akan dibutuhkan sampai Execute");
    expect(brainstorm).toContain("satu putaran");
    const audit = at(agentsFor("qa"), "Audit").instructions;
    expect(audit).toContain("SEMUA keputusan yang akan dibutuhkan Spec, Plan, dan Execute");
    expect(at(agentsFor("audit"), "Audit").instructions).not.toContain("dibutuhkan Spec, Plan, dan Execute");
  });

  it("keputusan yang sudah dijawab final: fase berikutnya & reviewer tak menanyakannya ulang", () => {
    for (const d of agentsFor("feature")) {
      expect(d.instructions).toContain("Keputusan yang sudah dijawab");
      expect(d.instructions).toContain("JANGAN menanyakannya ulang");
      // ADR-0167 tetap: ambiguitas baru tetap ditanyakan, tanpa batas.
      expect(d.instructions).toContain("tanpa batas jumlah");
    }
  });

  // ADR-0225 · 257 perintah `sleep` di 92 Execute = 14,4 jam menunggu proses latar yang dipolling.
  it("perintah verifikasi di foreground; polling jeda tidur dilarang — agen fase maupun reviewer", () => {
    for (const d of agentsFor("feature")) {
      expect(d.instructions).toContain("di FOREGROUND dengan batas waktu");
      expect(d.instructions).toContain("`sleep N`");
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
    expect(at(defs, "Execute").instructions).toContain("mewawancarai manusia");
    expect(at(defs, "Execute").instructions).toContain("`Keputusan terbuka:`");
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
    for (const d of phaseOnly(kept)) {
      expect(d.instructions).toContain("MELANJUTKAN pekerjaan sesi sebelumnya");
      expect(d.instructions).toContain("termasuk perubahan yang belum di-commit");
      expect(d.instructions).toContain("Brainstorm done");
      expect(d.instructions).toContain("`git log --oneline` dan `git status`");
      // T2 · blok KONTEKS dirakit `phasePromptOf`, bukan bagian `instructions` — urutannya dicek di prompt jadi.
      const prompt = phasePromptOf(d);
      expect(prompt.indexOf("MELANJUTKAN")).toBeLessThan(prompt.indexOf("=== KONTEKS ==="));
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


// ADR-0170 P2 · delegasi & reviewer. Subagent kini foreground di sesi claude ber-fase (env 6a249ae2):
// agen fase bisa memanggil anak dan menunggunya — izin "custom agent lain boleh dipanggil" akhirnya
// bisa dipenuhi, jadi instruksinya harus menyebut KAPAN, SIAPA, dan KONTRAK serah-terimanya.
describe("P2 · Execute & kontrak fase (ADR-0170)", () => {
  // Amandemen ADR-0170 P2 · default `inline`: subagent per task terukur terlalu lambat.
  it("Execute claude default (inline) memakai executing-plans, bukan subagent-driven-development", () => {
    const e = at(agentsFor("feature"), "Execute").instructions;
    expect(e).toContain("superpowers:executing-plans");
    expect(e).not.toContain("superpowers:subagent-driven-development");
  });
  it("executeMode subagent: Execute claude memakai subagent-driven-development dan melewati final review skill", () => {
    const plan = { ...planFor("feature"), executeMode: "subagent" as const };
    const e = at(buildPhaseAgents(plan, {
      flow: "feature", method: resolveMethod("superpowers"), verifyScope: "changed", context: "K" }), "Execute").instructions;
    expect(e).toContain("superpowers:subagent-driven-development");
    expect(e).not.toContain("superpowers:executing-plans");
    expect(e).toContain("LEWATI final whole-branch review");
  });
  it("executeMode subagent tak berlaku untuk codex: tetap executing-plans", () => {
    const plan = { ...planFor("feature", "codex"), executeMode: "subagent" as const };
    const e = at(buildPhaseAgents(plan, {
      flow: "feature", method: resolveMethod("superpowers"), verifyScope: "changed", context: "K" }), "Execute").instructions;
    expect(e).toContain("superpowers:executing-plans");
    expect(e).not.toContain("LEWATI final whole-branch review");
  });
  it("codex & metode matt tak berubah: codex tetap executing-plans, matt tetap implement", () => {
    const codex = buildPhaseAgents(planFor("feature", "codex"), {
      flow: "feature", method: resolveMethod("superpowers"), verifyScope: "changed", context: "K" });
    expect(at(codex, "Execute").instructions).toContain("superpowers:executing-plans");
    const matt = at(agentsFor("feature", { method: resolveMethod("matt") }), "Execute").instructions;
    expect(matt).toContain("mattpocock-skills:implement");
    expect(matt).not.toContain("subagent-driven-development");
  });
  it("Plan wajib bernama `<YYYY-MM-DD>-<spec-id>-<slug>.md` dan melaporkan path persisnya", () => {
    const p = at(agentsFor("feature"), "Plan").instructions;
    expect(p).toContain("docs/superpowers/plans/<YYYY-MM-DD>-<spec-id>-<slug>.md");
    expect(p).toContain("path PERSIS");
  });
  it("Execute: laporan memuat tabel `AC → bukti` sebelum `Status: selesai`; plan dari path serah-terima", () => {
    const e = at(agentsFor("qa"), "Execute").instructions;
    expect(e).toContain("`AC → bukti`");
    expect(e).toContain("`Artefak fase sebelumnya:`");
  });
  it("Verifikasi (goal) ikut klausa scope verifikasi; tanpa klausa gaya kode", () => {
    const v = at(agentsFor("goal"), "Verifikasi").instructions;
    expect(v).toContain("Scope verifikasi");
    expect(v).not.toContain(CODE_STYLE_CLAUSE);
    expect(at(agentsFor("goal", { verifyScope: undefined }), "Verifikasi").instructions).not.toContain("Scope verifikasi");
  });
});

describe("P2 · reviewer independen Execute (ADR-0170)", () => {
  it("feature & qa: agen `hanoman-fase-review` ber-fase Execute, opus/high, konteks bersama sama", () => {
    for (const flow of ["feature", "qa"] as const) {
      const r = agentsFor(flow).find((d) => d.name === REVIEW)!;
      expect(r).toMatchObject({ kind: "phase", phase: "Execute", model: "opus", effort: "high", tools: null,
        context: "KONTEKS-UJI", mentions: [] });
      expect(r.description).toContain("hanya dipanggil orchestrator");
    }
    for (const flow of ["goal", "audit", "reverse"] as const)
      expect(agentsFor(flow).some((d) => d.name === REVIEW)).toBe(false);
  });
  it("continue (rencana hanya Execute) tetap membawa reviewer; rencana tanpa Execute tidak", () => {
    const full = planFor("feature");
    const onlyExec = { ...full, phases: full.phases.filter((p) => p.phase === "Execute") };
    const ctx = { flow: "feature" as const, method: resolveMethod(), context: "K" };
    expect(buildPhaseAgents(onlyExec, ctx).map((d) => d.name)).toEqual(["hanoman-fase-execute", REVIEW]);
    const noExec = { ...full, phases: full.phases.filter((p) => p.phase !== "Execute") };
    expect(buildPhaseAgents(noExec, ctx).some((d) => d.name === REVIEW)).toBe(false);
  });
  it("instruksi: baca spec/plan & diff base, jalankan test sesuai scope, read-only, laporan AC + Verdict", () => {
    const r = agentsFor("feature").find((d) => d.name === REVIEW)!.instructions;
    expect(r).toContain('git diff "$HANOMAN_BASE_SHA"...HEAD');
    expect(r).toContain("Scope verifikasi");
    expect(r).toMatch(/JANGAN mengubah, membuat, atau menghapus berkas/);
    expect(r).toContain("JANGAN commit");
    expect(r).toContain("`Verdict: lulus` atau `Verdict: rework`");
    expect(r).toContain("`Temuan wajib diperbaiki:`");
    expect(r).toContain("bukan selera");
    expect(r).toContain("JANGAN menulis `$HANOMAN_PHASE_FILE`");
    expect(r).toContain("`Keputusan terbuka:`");
    expect(r).not.toContain("Commit artefak fasemu");
  });
  // Audit custom agent P1-6 · reviewer diturunkan dari spec-auditor: skala putusannya SATU sumber.
  it("kosakata putusan per kriteria = SPEC_AUDIT_VERDICTS, lengkap dan berurutan", () => {
    const r = agentsFor("feature").find((d) => d.name === REVIEW)!.instructions;
    expect(r).toContain(`putuskan salah satu: ${SPEC_AUDIT_VERDICT_LIST}.`);
    let from = 0;
    for (const v of SPEC_AUDIT_VERDICTS) {
      const at = r.indexOf(v, from);
      expect(at, v).toBeGreaterThanOrEqual(0);
      from = at + v.length;
    }
  });
});

const custom = (name: string, over: Partial<AgentDef> = {}): AgentDef => ({
  name, description: `${name} desc`, instructions: "i", tools: null, model: null, mentions: [], ...over,
});

describe("P2 · klausa delegasi agen fase (ADR-0170)", () => {
  const roster = [
    custom("scout", { model: "haiku", workspacePolicy: "read-only" }),
    custom("feature-builder", { model: "sonnet" }),
    custom("wt-only", { workspacePolicy: "isolated-worktree" }),
  ];
  it("menyebut HANYA custom agent yang hidup, dengan tanda read-only & model", () => {
    const c = phaseDelegationClause("Brainstorm", roster, "claude");
    expect(c).toContain("`scout` (read-only · haiku)");
    expect(c).toContain("`feature-builder` (sonnet)");
    // Audit P0-2 · isolated-worktree hanya melihat COMMIT: tandanya memberi tahu cara menyerahkan kerja.
    expect(c).toContain("`wt-only` (worktree terpisah: commit kandidat dulu, hasil via SHA → cherry-pick · model sesi)");
    expect(c.split("\n").length).toBeLessThanOrEqual(12);
    // codex tak bisa memuat isolated-worktree (materializeCodexAgents) → tak disebut.
    expect(phaseDelegationClause("Brainstorm", roster, "codex")).not.toContain("wt-only");
  });
  it("roster kosong: klausa generik tanpa nama agen", () => {
    const c = phaseDelegationClause("Spec", [], "claude");
    expect(c).toContain("Tak ada custom agent");
    expect(c).not.toContain("`scout`");
  });
  it("peran riset (Brainstorm/Spec/Plan): 2–3 pencarian sempit paralel ke agen read-only, sintesis sendiri", () => {
    for (const phase of ["Brainstorm", "Spec", "Plan"]) {
      const c = phaseDelegationClause(phase, roster, "claude");
      expect(c).toContain("2–3 pencarian sempit");
      expect(c).toContain("SATU pesan");
      expect(c).toContain("sintesis");
      expect(c).not.toContain("implementer");
    }
  });
  // ADR-0170 · implementer BERURUTAN (skill SDD melarang implementer paralel: satu worktree, satu
  // index git, mesin 8 GB); paralel hanya untuk pembacaan read-only (pencarian/review).
  it("Execute (executeMode subagent): implementer per task berurutan, paralel hanya read-only, review per task", () => {
    const c = phaseDelegationClause("Execute", roster, "claude", "subagent");
    expect(c).toContain("implementer per task");
    expect(c).toContain("BERURUTAN");
    expect(c).toContain("read-only");
    expect(c).not.toContain("tak beririsan");
    expect(c).toContain("review");
  });
  it("aturan bersama: subagent_type dari daftar, hindari agen umum, larang hanoman-fase-*, kontrak anak", () => {
    const c = phaseDelegationClause("Execute", roster, "claude", "subagent");
    expect(c).toContain("`subagent_type`");
    expect(c).toContain("general-purpose");
    expect(c).toContain("`hanoman-fase-*`");
    expect(c).toMatch(/tujuan, scope berkas, Base SHA.*path:baris/);
    // Audit P0-2 · anak tak mewarisi env parent: SHA diserahkan sebagai NILAI, bukan nama variabel.
    expect(c).toContain("Base SHA (NILAI hasil `echo $HANOMAN_BASE_SHA`, bukan nama variabelnya)");
    expect(c).toContain("Baca SEMUA laporan anak");
    expect(c).toMatch(/`Keputusan terbuka:` anak.*jangan dijawab sendiri/);
    expect(c).toContain("`git push`");
    expect(c).toContain("`git stash`");
    const codex = phaseDelegationClause("Execute", roster, "codex");
    expect(codex).toContain("spawn_agent");
    expect(codex).not.toContain("`subagent_type`");
  });
  // Amandemen ADR-0170 P2 · inline (default): agen fase Execute/Goal mengerjakan task SENDIRI.
  it("Execute/Goal inline (default): kerjakan sendiri, subagent hanya pencarian read-only", () => {
    for (const phase of ["Execute", "Goal"]) {
      const c = phaseDelegationClause(phase, roster, "claude");
      expect(c).toContain("SENDIRI");
      expect(c).toContain("JANGAN mendelegasikan implementasi");
      expect(c).toContain("read-only");
      expect(c).not.toContain("implementer per task");
      expect(c).toContain("`hanoman-fase-*`");
    }
  });
  it("codex tak terpengaruh executeMode: klausa Execute sama untuk inline & subagent", () => {
    expect(phaseDelegationClause("Execute", roster, "codex", "inline"))
      .toBe(phaseDelegationClause("Execute", roster, "codex", "subagent"));
    expect(phaseDelegationClause("Execute", roster, "codex")).toContain("implementer per task");
  });
  it("withPhaseDelegation membaca executeMode dari AgentDef fase hasil buildPhaseAgents", () => {
    const sub = buildPhaseAgents({ ...planFor("feature"), executeMode: "subagent" }, {
      flow: "feature", method: resolveMethod("superpowers"), verifyScope: "changed", context: "K" });
    expect(at(sub, "Execute").executeMode).toBe("subagent");
    expect(at(withPhaseDelegation(sub, roster, "claude"), "Execute").instructions).toContain("implementer per task");
    expect(at(withPhaseDelegation(agentsFor("feature"), roster, "claude"), "Execute").instructions)
      .toContain("JANGAN mendelegasikan implementasi");
  });
  it("Kerjakan & reviewer tak menerima klausa delegasi; fase lain menerimanya di ujung instruksi", () => {
    expect(phaseDelegationClause("Kerjakan", roster, "claude")).toBe("");
    const defs = withPhaseDelegation(agentsFor("feature"), roster, "claude");
    const base = agentsFor("feature");
    for (const [i, d] of defs.entries()) {
      if (d.name === REVIEW) expect(d.instructions).toBe(base[i]!.instructions);
      else expect(d.instructions.startsWith(base[i]!.instructions)).toBe(true);
      if (d.name !== REVIEW) expect(d.instructions).toContain("=== DELEGASI ===");
      expect(d.context).toBe("KONTEKS-UJI");
    }
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


describe("Antigravity phase protocol (SPEC-1442)", () => {
  const native = () => {
    const plan = planFor("feature", "antigravity");
    const defs = buildPhaseAgents(plan, { flow: "feature", method: resolveMethod("superpowers"), verifyScope: "changed", context: "KONTEKS-UJI" });
    return { plan, defs };
  };
  it("renders native tiers without exact model/effort or foreground promises", () => {
    const { plan, defs } = native();
    expect(defs).toHaveLength(6);
    for (const def of defs) {
      expect(def).toMatchObject({ model: "inherit", effort: null, tools: null });
      expect(renderAntigravityAgent(def, defs)).toContain('model: "inherit"');
    }
    const prompt = orchestratorClause(plan);
    expect(prompt).toContain("invoke_subagent");
    expect(prompt).toContain("send_message ke conversation ID child yang sama");
    expect(prompt).toContain("asynchronous");
    expect(prompt).toContain("protocol wait");
    expect(prompt).toContain("effort native unknown");
    expect(prompt).not.toContain("sudah terkunci");
    expect(prompt).not.toContain("tool Agent");
    expect(prompt).not.toContain("spawn_agent");
    expect(prompt).not.toContain("SendMessage");
    expect(prompt).not.toContain("AskUserQuestion");
    expect(prompt).not.toContain("· null");
  });
  it("relays all decisions and rework to the same child, with review before parent-only marker", () => {
    const prompt = orchestratorClause(native().plan);
    expect(prompt).toContain("ajukan SEMUA pertanyaannya");
    expect(prompt).toContain("opsi, rekomendasi dan alasannya");
    expect(prompt).toContain("reviewer yang SAMA lewat send_message");
    expect(prompt).toContain("satu-satunya penulis berkas itu");
    expect(prompt).toContain('tail -1 "$HANOMAN_PHASE_FILE"');
    expect(prompt).toContain("JANGAN menulis `Execute done` tanpa `Verdict: lulus`");
    expect(prompt).toContain("maks 2 putaran rework");
    expect(prompt).toContain("Percobaan: 2/2");
    expect(prompt).toContain('cat "$HANOMAN_PHASE_FILE"');
  });
  it("reviewer read-only is instructional only; phase delegation names only compatible live customs", () => {
    const { defs } = native();
    const roster: AgentDef[] = [
      { name: "native-research", description: "lookup", instructions: "research", model: "flash", effort: null, tools: null, mentions: [] },
      { name: "auditor-unavailable", description: "audit", instructions: "audit", model: null, tools: null, mentions: [], workspacePolicy: "read-only" },
      { name: "isolated-unavailable", description: "code", instructions: "code", model: null, tools: null, mentions: [], workspacePolicy: "isolated-worktree" },
      { name: "model-unavailable", description: "code", instructions: "code", model: "gemini-3.8-flash-high", tools: null, mentions: [] },
    ];
    const live = withPhaseDelegation(defs, roster, "antigravity");
    const execute = at(live, "Execute").instructions;
    expect(execute).toContain("invoke_subagent");
    expect(execute).toContain("native-research");
    expect(execute).not.toContain("auditor-unavailable");
    expect(execute).not.toContain("isolated-unavailable");
    expect(execute).not.toContain("model-unavailable");
    expect(execute).not.toContain("berjalan foreground");
    expect(execute).toContain("SENDIRI");
    expect(execute).toContain("rekomendasi dan alasannya");
    const reviewer = live.find(d => d.name === REVIEW)!;
    expect(reviewer.workspacePolicy).toBeUndefined();
    expect(reviewer.instructions).toContain("read-only instruksional");
    expect(reviewer.instructions).toContain("bukan enforcement runtime");
    expect(reviewer.instructions).not.toContain("=== DELEGASI ===");
    expect(reviewer.instructions).toContain("JANGAN mengubah, membuat, atau menghapus");
  });
  it.each([
    // Hash defs diperbarui sengaja oleh ADR-0225 (bentuk plan, keputusan di depan, aturan foreground);
    // hash parent tak berubah — klausa orchestrator tak disentuh.
    ["claude", "26812ce4a0bd69e52ab388cfd259a44831b09a7f9b0969e0e2044880442fb0f4", "aef0fe90e7b00045ff5f35a04ad22cf85985ca7c5b90913818a86e5b184ff4ac"],
    ["codex", "a77bc5f636771d2637d85d7f53bfd0c129fc53fcf2853a577beaf98bf8b7741a", "b60111bd6f3052aecc90cebd8c2b9f80c08be6b9d9e2c637ade494a8837e5c6d"],
  ] as const)("%s existing parent/phase prompts stay byte-identical", (runtime, parentHash, defsHash) => {
    const plan = planFor("feature", runtime);
    const defs = withPhaseDelegation(buildPhaseAgents(plan, { flow: "feature", method: resolveMethod("superpowers"), verifyScope: "changed", context: "KONTEKS-UJI" }), [], runtime);
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(hash(orchestratorClause(plan))).toBe(parentHash);
    expect(hash(JSON.stringify(defs))).toBe(defsHash);
  });
});
