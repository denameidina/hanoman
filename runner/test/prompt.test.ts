import { describe, it, expect } from "vitest";
import { PIPELINES, startPrompt, startProjectPrompt, continuePrompt, resumePrompt, startPrdPrompt, startScaffoldPrompt, startBreakdownPrompt, startGoalPrompt } from "../src/prompt";

const spec = { id: "SPEC-162", title: "Sesi interaktif", source: "brief",
  priority: "high", objective: "Ganti runOne dengan tmux" };

// SPEC-394 · prompt lanjutan: kerangka startPrompt + blok RESUME. Ia harus MENYEBUT keadaan
// nyata (fase tercatat, bentuk worktree) — agen tak punya cara lain mengetahuinya.
describe("resumePrompt", () => {
  const ctx = { recorded: ["Audit done", "Spec skipped"], next: "Plan", worktreeKept: true };

  it("menyebut fase yang sudah tercatat dan fase berikutnya", () => {
    const p = resumePrompt("qa", spec, "hanoman/spec-394", ctx);
    expect(p).toContain("MELANJUTKAN");
    expect(p).toContain("Audit done");
    expect(p).toContain("Spec skipped");
    expect(p).toContain("Lanjutkan dari fase: Plan.");
    // Fase yang BELUM tercatat tak boleh dikarang. Sengaja bukan "Execute done": kalimat itu
    // memang ada di phaseInstruction (gerbang plan ADR-0029), jadi assertion-nya akan lulus palsu.
    expect(p).not.toContain("Plan skipped");
    expect(p).not.toContain("Plan done");
  });

  it("membedakan worktree utuh dari worktree yang dibangun ulang", () => {
    const utuh = resumePrompt("qa", spec, "b", { ...ctx, worktreeKept: true });
    const ulang = resumePrompt("qa", spec, "b", { ...ctx, worktreeKept: false });
    expect(utuh).toContain("belum di-commit");
    expect(ulang).toContain("DIBANGUN ULANG");
    expect(ulang).toContain("TIDAK ada");
  });

  it("tetap membawa kerangka startPrompt: fase, otonomi, skill, push, dan blok backlog", () => {
    const p = resumePrompt("qa", spec, "hanoman/spec-394", ctx);
    expect(p).toContain("Kerjakan fase berurutan: Audit → Spec → Plan → Execute.");
    expect(p).toContain("$HANOMAN_PHASE_FILE");
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-394");
    expect(p).toContain(spec.id);
    expect(p).toContain(spec.objective);
    expect(p).toContain("superpowers:test-driven-development");
  });

  it("membawa klausa scope verifikasi seperti startPrompt", () => {
    expect(resumePrompt("qa", spec, "b", ctx, undefined, "changed")).toContain("Scope verifikasi");
    expect(resumePrompt("qa", spec, "b", ctx, undefined, "full")).not.toContain("Scope verifikasi");
  });

  it("tanpa fase tercatat tetap sah — worktree-nya sendiri yang jadi alasan melanjutkan", () => {
    const p = resumePrompt("qa", spec, "b", { recorded: [], next: "Audit", worktreeKept: true });
    expect(p).toContain("Belum ada fase yang tercatat");
    expect(p).toContain("Lanjutkan dari fase: Audit.");
    // Audit belum tercatat → keputusan pasca-Audit (ADR-0040) memang masih di depan.
    expect(p).toContain("Keputusan pasca-Audit");
  });

  // Sesudah Audit tercatat, keputusan pasca-Audit SUDAH mewujud sebagai baris fase. Mengulanginya
  // mengundang agen membatalkan keputusan sesi sebelumnya di tengah jalan.
  it("Audit sudah tercatat → klausa keputusan pasca-Audit tak diulang", () => {
    expect(resumePrompt("qa", spec, "b", ctx)).not.toContain("Keputusan pasca-Audit");
    expect(resumePrompt("qa", spec, "b", { ...ctx, recorded: ["Audit skipped"], next: "Spec" }))
      .not.toContain("Keputusan pasca-Audit");
  });

  it("semua fase tercatat → disuruh memeriksa sisa task plan, bukan fase berikutnya", () => {
    const p = resumePrompt("qa", spec, "b",
      { recorded: ["Audit done", "Spec done", "Plan done", "Execute done"], worktreeKept: true });
    expect(p).toContain("Semua fase sudah tercatat");
    expect(p).not.toContain("Lanjutkan dari fase:");
  });
});

describe("startPrompt", () => {
  it("memuat identitas backlog item dan objective-nya", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("SPEC-162");
    expect(p).toContain("Ganti runOne dengan tmux");
    expect(p).toContain("Sesi interaktif");
  });

  it("menyebut setiap fase pipeline flow-nya, berurutan", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    for (const phase of PIPELINES.feature) expect(p).toContain(phase);
    expect(p.indexOf("Brainstorm")).toBeLessThan(p.indexOf("Execute"));
  });

  it("flow qa memakai pipeline-nya sendiri, bukan feature", () => {
    const p = startPrompt("qa", spec, "hanoman/spec-162");
    expect(p).toContain("Audit");
    expect(p).not.toContain("Brainstorm");
  });

  // SPEC-237 · flow audit-only: Audit → Laporan, dokumen saja, tanpa Execute.
  it("pipeline audit = Audit → Laporan, tanpa Plan/Execute", () => {
    expect(PIPELINES.audit).toEqual(["Audit", "Laporan"]);
  });
  it("startPrompt audit menginstruksikan dokumen audit tanpa perbaikan kode", () => {
    const p = startPrompt("audit", spec, "hanoman/spec-237");
    expect(p).toContain("Audit");
    expect(p).toContain("Laporan");
    expect(p).not.toContain("Execute");
    expect(p.toLowerCase()).toContain("jangan");
    expect(p.toLowerCase()).toContain("dokumen audit");
  });

  it("menginstruksikan append ke $HANOMAN_PHASE_FILE, bukan tulis-timpa", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("$HANOMAN_PHASE_FILE");
    expect(p).toContain(">>");
  });

  it("menyuruh agen push ke branchTo-nya sendiri", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).toContain("hanoman/spec-162");
    expect(p).toContain("git push");
  });

  it("feature: menyuruh invoke skill superpowers per fase", () => {
    const p = startPrompt("feature", spec, "b");
    for (const s of ["superpowers:brainstorming", "superpowers:writing-plans",
      "superpowers:executing-plans", "superpowers:test-driven-development",
      "superpowers:verification-before-completion"]) expect(p).toContain(s);
    expect(p).toContain("Skills superpowers WAJIB");
  });

  // SPEC-338 · satu prompt melayani claude & codex. "Skill tool" adalah istilah Claude Code;
  // codex memuat skill secara native, jadi prompt menyebut HASIL yang diminta, bukan mekanismenya.
  it("instruksi skill netral-agen — tak menyebut mekanisme khas satu CLI", () => {
    const p = startPrompt("feature", spec, "hanoman/x");
    expect(p).toContain("superpowers:brainstorming");
    expect(p).not.toContain("Skill tool");
  });

  it("qa: Audit memakai systematic-debugging, tanpa brainstorming", () => {
    const p = startPrompt("qa", spec, "b");
    expect(p).toContain("superpowers:systematic-debugging");
    expect(p).not.toContain("superpowers:brainstorming");
  });

  // SPEC-204 · ADR-0040: pasca-Audit, temuan berconfidence tinggi & langsung → lewati Spec+Plan.
  it("qa: menginstruksikan jalur cepat — lewati Spec & Plan bila temuan langsung dikerjakan", () => {
    const p = startPrompt("qa", spec, "b");
    expect(p).toContain("confidence");
    expect(p).toContain("Spec skipped");
    expect(p).toContain("Plan skipped");
    // keputusan berpangkal pada hasil Audit
    expect(p.indexOf("Audit")).toBeLessThan(p.indexOf("Spec skipped"));
  });

  it("feature: TIDAK membawa klausa jalur cepat Audit (khusus qa)", () => {
    const p = startPrompt("feature", spec, "b");
    expect(p).not.toContain("Spec skipped");
    expect(p).not.toContain("Plan skipped");
  });

  // SPEC-244 · ADR-0059: qa dinaikkan dari audit (payload.fromAudit) → lewati fase Audit, baca dokumen audit.
  it("qa dinaikkan dari audit: lewati fase Audit, baca dokumen audit", () => {
    const p = startPrompt("qa", { ...spec, payload: { severity: "major", steps: "", expected: "", actual: "", env: "", fromAudit: "SPEC-237" } }, "hanoman/spec-244");
    expect(p).toContain("LANJUTAN dari audit SPEC-237");
    expect(p).toContain("Audit skipped");
    expect(p).toContain("audit-spec-237-");
  });
  it("qa tanpa fromAudit: TIDAK membawa klausa lanjutan audit", () => {
    expect(startPrompt("qa", spec, "b")).not.toContain("LANJUTAN dari audit");
  });

  it("payload ikut saat ada, dan tak menghasilkan 'undefined' saat tak ada", () => {
    expect(startPrompt("qa", { ...spec, payload: { severity: "major" } }, "b")).toContain("severity");
    expect(startPrompt("qa", spec, "b")).not.toContain("undefined");
  });

  // SPEC-173: Execute belum selesai selama plan masih punya kotak `- [ ]`.
  it("feature/qa: melarang Execute done sebelum semua kotak plan - [x]", () => {
    for (const flow of ["feature", "qa"] as const) {
      const p = startPrompt(flow, spec, "b");
      expect(p).toContain("Execute BELUM selesai");
      expect(p).toContain("- [x]");
    }
  });

  // SPEC-187 · ADR-0035: lanjut antar-fase tanpa berhenti; berhenti hanya untuk keputusan manusia.
  it("feature/qa: menyuruh terus lanjut antar-fase, berhenti hanya untuk keputusan manusia", () => {
    for (const flow of ["feature", "qa"] as const) {
      const p = startPrompt(flow, spec, "b");
      expect(p).toContain("tanpa berhenti di batas antar-fase");
      expect(p).toContain("keputusan manusia");
    }
  });

  // SPEC-376 · ADR-0080 · scope verifikasi. Default pemanggil lama (parameter absen) harus
  // tetap seperti dulu: tanpa klausa. Klausa hanya muncul saat diminta eksplisit.
  it("tanpa parameter verifyScope, prompt tak memuat klausa scope (kompatibel mundur)", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162");
    expect(p).not.toContain("$HANOMAN_BASE_SHA");
  });

  it("verifyScope changed menyisipkan klausa scope ke prompt", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162", undefined, "changed");
    expect(p).toContain("$HANOMAN_BASE_SHA");
    expect(p).toContain("Scope verifikasi");
  });

  it("verifyScope full tak menyisipkan klausa apa pun", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-162", undefined, "full");
    expect(p).not.toContain("$HANOMAN_BASE_SHA");
  });

  // Flow audit-only tak menulis kode → tak ada test untuk dijalankan; klausa di sana hanya
  // menambah token. Sengaja tak disisipkan meski scope-nya `changed`.
  it("flow audit tak membawa klausa scope walau verifyScope changed", () => {
    const p = startPrompt("audit", spec, "hanoman/spec-237", undefined, "changed");
    expect(p).not.toContain("$HANOMAN_BASE_SHA");
  });

  it("continuePrompt ikut membawa klausa scope", () => {
    const p = continuePrompt("feature", spec, "hanoman/spec-162", undefined, "changed");
    expect(p).toContain("$HANOMAN_BASE_SHA");
  });
});

// SPEC-298 · klausa autonomy per mode untuk sesi yang diluncurkan scheduler.
describe("autonomy per mode (SPEC-298)", () => {
  it("full-control: putuskan sendiri, tanpa pengawas, tembus sampai done — bukan klausa tanya", () => {
    const p = startPrompt("feature", spec, "b", "full-control");
    expect(p).toContain("TANPA pengawas");
    expect(p).toContain("JANGAN berhenti");
    expect(p).not.toContain("tanyakan di terminal");
  });
  it("butuh-keputusan: klausa lama (berhenti untuk keputusan manusia, tanya di terminal)", () => {
    const p = startPrompt("feature", spec, "b", "butuh-keputusan");
    expect(p).toContain("tanpa berhenti di batas antar-fase");
    expect(p).toContain("tanyakan di terminal");
    expect(p).not.toContain("TANPA pengawas");
  });
  it("default (manual, tanpa arg): identik klausa lama", () => {
    expect(startPrompt("feature", spec, "b")).toContain("tanyakan di terminal");
    expect(startPrompt("feature", spec, "b")).not.toContain("TANPA pengawas");
  });
  it("continuePrompt menghormati mode full-control", () => {
    const p = continuePrompt("feature", spec, "b", "full-control");
    expect(p).toContain("TANPA pengawas");
  });
});

// SPEC-172 · reopen: lanjut di Execute untuk spec yang keburu `done`, tanpa mengulang pipeline.
describe("continuePrompt", () => {
  const branch = "hanoman/spec-162";

  it("identitas & objective backlog item ikut", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("SPEC-162");
    expect(p).toContain("Ganti runOne dengan tmux");
  });

  it("lanjut di Execute, tak mengulang pipeline dari awal", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("Execute");
    expect(p).toContain("docs/superpowers/plans");
    expect(p).not.toContain("Brainstorm");
    expect(p).not.toContain("Kerjakan fase berurutan"); // phaseInstruction absen
    expect(p).not.toContain("$HANOMAN_PHASE_FILE");
  });

  it("hanya skill fase Execute yang di-invoke", () => {
    const p = continuePrompt("feature", spec, branch);
    for (const s of ["superpowers:executing-plans", "superpowers:test-driven-development",
      "superpowers:verification-before-completion"]) expect(p).toContain(s);
    expect(p).not.toContain("superpowers:brainstorming");
    expect(p).not.toContain("superpowers:writing-plans");
  });

  it("tetap menyuruh commit + push ke branch-nya", () => {
    const p = continuePrompt("feature", spec, branch);
    expect(p).toContain("git push");
    expect(p).toContain("hanoman/spec-162");
  });

  it("memuat marker MELANJUTKAN di awal (dipakai server untuk verifikasi pilihan prompt)", () => {
    expect(continuePrompt("feature", spec, branch)).toContain("MELANJUTKAN");
  });

  it("payload ikut saat ada, tanpa 'undefined' saat tidak", () => {
    expect(continuePrompt("qa", { ...spec, payload: { severity: "major" } }, "b")).toContain("severity");
    expect(continuePrompt("feature", spec, "b")).not.toContain("undefined");
  });

  // SPEC-187 · ADR-0035: reopen Execute pun lanjut tanpa berhenti antar-checkpoint.
  it("membawa klausa otonomi (berhenti hanya untuk keputusan manusia)", () => {
    expect(continuePrompt("feature", spec, branch)).toContain("tanpa berhenti di batas antar-fase");
  });
});

// SPEC-166 · sesi reverse project-level: prompt-nya membawa standar docs lengkap.
describe("startProjectPrompt", () => {
  const project = { id: "termilo", name: "termilo", desc: "booking SaaS", stack: "cloudflare" };

  it("reverse: kelima fase berurutan, dengan instruksi phase file", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    const phases = ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"];
    expect(PIPELINES.reverse).toEqual(phases);
    for (const ph of phases) expect(p).toContain(ph);
    expect(p.indexOf("Scan")).toBeLessThan(p.indexOf("Serah terima"));
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("memuat standar docs: kategori, ADR, EARS, index, hook", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    for (const t of ["STANDAR DOCS", "internal/docs/", "ADR-NNNN", "Event-driven",
      "ensure-docs-updated.py", "Reading Order"]) expect(p).toContain(t);
  });

  it("wawancara: satu pertanyaan per giliran, dilarang mengarang", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("SATU pertanyaan");
    expect(p).toContain("menunggu input");
    expect(p).toContain("Jangan mengarang");
  });

  it("commit+push per fase ke branch-nya, dengan fallback tanpa origin", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("refs/heads/reverse-docs");
    expect(p).toContain("origin tidak ada");
  });

  it("identitas project ikut, tanpa 'undefined'", () => {
    const p = startProjectPrompt("reverse", project, "reverse-docs");
    expect(p).toContain("termilo");
    expect(p).toContain("booking SaaS");
    expect(p).not.toContain("undefined");
  });

  // SPEC-173: klausa plan hanya untuk flow ber-fase Plan+Execute; reverse tak punya.
  it("reverse: tanpa klausa penyelesaian plan (tak ada fase Plan+Execute)", () => {
    expect(startProjectPrompt("reverse", project, "reverse-docs")).not.toContain("Execute BELUM selesai");
  });

  // SPEC-187 · ADR-0035: reverse dikecualikan — Wawancara memang interaktif, satu tanya per giliran.
  it("reverse: TIDAK membawa klausa otonomi", () => {
    expect(startProjectPrompt("reverse", project, "reverse-docs")).not.toContain("tanpa berhenti di batas antar-fase");
  });
});

// SPEC-210 · sesi prd project-level: PM menyusun dokumen PRD dari brief + brainstorm interaktif.
describe("startPrdPrompt", () => {
  const project = { id: "acme", name: "Acme", desc: "d", stack: "ts" };
  const brief = { title: "Jadwal Invoice Berulang", context: "PM butuh penjadwalan", outcome: "invoice terjadwal" };

  it("memuat fase Brainstorm lalu PRD, berurutan, dengan instruksi phase file", () => {
    const p = startPrdPrompt(project, brief, "prd/jadwal-invoice-berulang");
    expect(PIPELINES.prd).toEqual(["Brainstorm", "PRD"]);
    expect(p).toContain("Brainstorm → PRD"); // urutan fase di phaseInstruction
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("menyuruh tulis dokumen ke docs/prd/<slug>.md", () => {
    const p = startPrdPrompt(project, brief, "prd/jadwal-invoice-berulang");
    expect(p).toContain("docs/prd/jadwal-invoice-berulang.md");
  });

  it("menyisipkan brief + identitas project, tanpa 'undefined'", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("Jadwal Invoice Berulang");
    expect(p).toContain("PM butuh penjadwalan");
    expect(p).toContain("acme");
    expect(p).not.toContain("undefined");
  });

  it("invoke skill brainstorming + push ke branchTo, keluaran HANYA dokumen PRD", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("superpowers:brainstorming");
    expect(p).toContain("refs/heads/prd/x");
    expect(p).toContain("git push");
    expect(p).toContain("HANYA dokumen PRD");
  });

  it("brainstorm interaktif satu pertanyaan per giliran (PM menonton terminal)", () => {
    const p = startPrdPrompt(project, brief, "prd/x");
    expect(p).toContain("SATU pertanyaan");
  });

  it("tanpa klausa penyelesaian plan (tak ada fase Plan+Execute)", () => {
    expect(startPrdPrompt(project, brief, "prd/x")).not.toContain("Execute BELUM selesai");
  });
});

// SPEC-222 · sesi scaffold project-level: dari ide → seluruh doc index. Reverse tanpa Scan.
describe("startScaffoldPrompt", () => {
  const project = { id: "kirana", name: "Kirana", desc: "marketplace jasa lokal", stack: "" };

  it("memuat fase Brainstorm → Objective → Doc index berurutan + instruksi phase file", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(PIPELINES.scaffold).toEqual(["Brainstorm", "Objective", "Doc index"]);
    for (const ph of PIPELINES.scaffold) expect(p).toContain(ph);
    expect(p.indexOf("Brainstorm")).toBeLessThan(p.indexOf("Doc index"));
    expect(p).toContain("$HANOMAN_PHASE_FILE");
  });

  it("membawa STANDAR DOCS lengkap (kategori, ADR, EARS, index, hook)", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    for (const t of ["STANDAR DOCS", "internal/docs/", "ADR-NNNN", "Event-driven",
      "ensure-docs-updated.py", "Reading Order"]) expect(p).toContain(t);
  });

  it("brainstorm interaktif satu pertanyaan per giliran, diseed dari ide, dilarang mengarang", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("SATU pertanyaan");
    expect(p).toContain("Jangan mengarang");
    expect(p).toContain("marketplace jasa lokal"); // ide (desc) ikut menyeed
  });

  it("pipeline TANPA fase Scan (bukan reverse) dan prompt TANPA klausa otonomi", () => {
    // Scan tak boleh jadi fase scaffold; kata "Scan" boleh muncul di STANDAR DOCS bawaan
    // (petunjuk Stop hook), jadi asersi pada pipeline & baris fase, bukan seluruh string.
    expect(PIPELINES.scaffold).not.toContain("Scan");
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("Kerjakan fase berurutan: Brainstorm → Objective → Doc index");
    expect(p).not.toContain("tanpa berhenti di batas antar-fase");
  });

  it("commit+push per fase ke branch scaffold-docs dengan fallback tanpa origin, tanpa 'undefined'", () => {
    const p = startScaffoldPrompt(project, "scaffold-docs");
    expect(p).toContain("refs/heads/scaffold-docs");
    expect(p).toContain("origin tidak ada");
    expect(p).toContain("Kirana");
    expect(p).not.toContain("undefined");
  });

  it("tanpa klausa penyelesaian plan (tak ada fase Plan+Execute)", () => {
    expect(startScaffoldPrompt(project, "scaffold-docs")).not.toContain("Execute BELUM selesai");
  });
});

// SPEC-252 · ADR-0061 — model & effort per SESI; prompt tak lagi memuat instruksi per-fase.
describe("prompt tanpa instruksi model/effort per-fase (SPEC-252)", () => {
  it("startPrompt tak memuat blok per-fase apa pun", () => {
    const p = startPrompt("feature", spec, "b");
    expect(p).not.toContain("Model & effort per fase");
    expect(p).not.toContain("/model claude");
    expect(p).not.toContain("/effort");
  });
  it("startProjectPrompt/startScaffoldPrompt/startPrdPrompt juga bersih dari blok per-fase", () => {
    const proj = { id: "p1", name: "P", desc: "d", stack: "s" };
    expect(startProjectPrompt("reverse", proj, "reverse-docs")).not.toContain("Model & effort per fase");
    expect(startScaffoldPrompt(proj, "scaffold-docs")).not.toContain("Model & effort per fase");
    expect(startPrdPrompt(proj, { title: "t", context: "c", outcome: "o" }, "prd/t")).not.toContain("Model & effort per fase");
  });
});

describe("startBreakdownPrompt (SPEC-273)", () => {
  const project = { id: "acme", name: "Acme", desc: "", stack: "" };
  const prd = { title: "Jadwal Invoice Berulang", path: "docs/prd/jadwal-invoice.md",
    content: "# Jadwal Invoice Berulang\n\nScope: A, B, C." };
  const p = startBreakdownPrompt(project, prd, "breakdown/jadwal-invoice");

  it("pipeline breakdown = Analisis → Breakdown", () => {
    expect(PIPELINES.breakdown).toEqual(["Analisis", "Breakdown"]);
  });
  it("menyematkan isi PRD dan path manifest", () => {
    expect(p).toContain("Scope: A, B, C.");
    expect(p).toContain("docs/prd/jadwal-invoice.breakdown.md");
  });
  it("mewajibkan backlog non-overlapping tanpa cross-dependency", () => {
    expect(p.toLowerCase()).toContain("non-overlapping");
    expect(p.toLowerCase()).toContain("dependency");
    expect(p).toContain("```json");
  });
  it("push ke branch breakdown + tak menulis kode fitur", () => {
    expect(p).toContain("git push origin HEAD:refs/heads/breakdown/jadwal-invoice");
    expect(p).toContain("JANGAN menulis kode fitur");
  });
});

// SPEC-407 · ADR-0089 · sesi backlog GOAL. Yang dihapus justru KERANGKA-nya: prompt ini harus
// mengeja goal-nya, dua fasenya, dan pintu keluar yang dibuktikan — tanpa menyeret satu pun
// artefak perencanaan (design doc, plan berkotak, skill brainstorming/writing-plans).
describe("startGoalPrompt (SPEC-407)", () => {
  const goalSpec = {
    id: "SPEC-407", title: "Backlog goal", source: "goal", priority: "tinggi",
    objective: "p95 < 200 ms",
    payload: { goal: "p95 /api/specs < 200 ms", done: "output benchmark < 200 ms",
      constraints: "tanpa cache eksternal", priority: "tinggi" },
  };

  it("pipeline goal berisi dua fase", () => {
    expect(PIPELINES.goal).toEqual(["Goal", "Verifikasi"]);
  });

  it("mengeja goal, selesai-bila, batasan, dua fase, dan push", () => {
    const p = startGoalPrompt(goalSpec, "hanoman/spec-407");
    expect(p).toContain("Goal: p95 /api/specs < 200 ms");
    expect(p).toContain("Selesai bila: output benchmark < 200 ms");
    expect(p).toContain("Batasan: tanpa cache eksternal");
    expect(p).toContain("Kerjakan fase berurutan: Goal → Verifikasi.");
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-407");
    expect(p).toContain("SPEC-407");
  });

  it("tak menyeret pipeline perencanaan maupun skill-nya", () => {
    const p = startGoalPrompt(goalSpec, "b");
    expect(p).not.toContain("Kerjakan fase berurutan: Brainstorm");
    expect(p).not.toContain("superpowers:brainstorming");
    expect(p).not.toContain("superpowers:writing-plans");
    // Gerbang plan ADR-0029 hanya untuk pipeline ber-Plan+Execute; sesi goal tak berplan.
    expect(p).not.toContain("docs/superpowers/plans");
    // Pintu keluarnya tetap dijaga.
    expect(p).toContain("superpowers:verification-before-completion");
  });

  it("membawa klausa scope verifikasi — sesi goal menulis kode meski tanpa fase Execute", () => {
    expect(startGoalPrompt(goalSpec, "b", { verifyScope: "changed" }))
      .toContain("Scope verifikasi: HANYA yang berubah");
    expect(startGoalPrompt(goalSpec, "b")).not.toContain("Scope verifikasi");
  });

  it("payload rusak → jatuh ke objective spec, tanpa melempar", () => {
    const p = startGoalPrompt({ ...goalSpec, payload: { context: "c" } }, "b");
    expect(p).toContain("Goal: p95 < 200 ms");
    expect(p).not.toContain("Selesai bila:");
    expect(p).not.toContain("undefined");
  });

  it("varian resume menyebut keadaan nyata tanpa menyuruh mencari plan", () => {
    const p = startGoalPrompt(goalSpec, "hanoman/spec-407", {
      resume: { recorded: ["Goal done"], next: "Verifikasi", worktreeKept: true },
    });
    expect(p).toContain("MELANJUTKAN");
    expect(p).toContain("Goal done");
    expect(p).toContain("Lanjutkan dari fase: Verifikasi.");
    expect(p).not.toContain("docs/superpowers/plans");
  });

  // resumePrompt (flow ber-Plan) TIDAK boleh ikut kehilangan kalimat plannya.
  it("resumePrompt flow feature tetap menyuruh membaca plan", () => {
    const p = resumePrompt("feature", spec, "b", { recorded: ["Brainstorm done"], next: "Objective", worktreeKept: true });
    expect(p).toContain("docs/superpowers/plans/**");
  });
});

// SPEC-543 · ADR-0108 · klausa gaya kode. Gerbangnya `writesCode(flow)` — sumber kebenaran yang
// SAMA dengan klausa scope (ADR-0080 keputusan 4), jadi flow dokumen tetap tak membayar token
// untuk instruksi yang tak punya kode untuk diterapkan.
describe("klausa gaya kode (SPEC-543)", () => {
  const MARK = "Gaya kode —";
  const project = { id: "p", name: "P", desc: "d", stack: "s" };

  it("startPrompt flow feature & qa membawanya", () => {
    expect(startPrompt("feature", spec, "b")).toContain(MARK);
    expect(startPrompt("qa", spec, "b")).toContain(MARK);
  });

  it("continuePrompt & resumePrompt membawanya", () => {
    expect(continuePrompt("feature", spec, "b")).toContain(MARK);
    expect(resumePrompt("feature", spec, "b", { recorded: [], next: "Execute", worktreeKept: true }))
      .toContain(MARK);
  });

  it("startGoalPrompt membawanya (flow goal menulis kode walau tanpa fase Execute)", () => {
    expect(startGoalPrompt({ ...spec, source: "goal" }, "b")).toContain(MARK);
  });

  // Tak bergantung pada verifyScope: klausa gaya kode tak punya knob (ADR-0108 keputusan 4).
  it("hadir tanpa parameter verifyScope maupun dengan verifyScope full", () => {
    expect(startPrompt("feature", spec, "b")).toContain(MARK);
    expect(startPrompt("feature", spec, "b", undefined, "full")).toContain(MARK);
  });

  it("flow dokumen tidak membawanya", () => {
    expect(startPrompt("audit", spec, "b")).not.toContain(MARK);
    expect(startProjectPrompt("reverse", project, "b")).not.toContain(MARK);
    expect(startScaffoldPrompt(project, "b")).not.toContain(MARK);
    expect(startPrdPrompt(project, { title: "t", context: "c", outcome: "o" }, "prd/x"))
      .not.toContain(MARK);
    expect(startBreakdownPrompt(project, { title: "t", path: "docs/prd/x.md", content: "c" }, "prd/x"))
      .not.toContain(MARK);
  });

  it("hanya muncul SEKALI dalam satu prompt", () => {
    const p = startPrompt("feature", spec, "b", undefined, "changed");
    expect(p.split(MARK).length - 1).toBe(1);
  });
});
