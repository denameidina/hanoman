import { PHASE_AGENT_PREFIX, type MethodDef, type PhasePlan, type PhasePlanEntry } from "@hanoman/shared";
import type { AgentDef } from "./custom-agents";
import type { Flow, VerifyScope } from "./types";
import {
  ESCALATION_CONTRACT, REVERSE_PHASE_GUIDE, SCAFFOLD_PHASE_GUIDE, WORK_PHASES, breakdownPhaseLines,
  codeStyleClause, guideLine, methodClause, phaseSkillsFor, prdPhaseLines, scopeClause,
} from "./prompt";
import { REVERSE_STANDARD } from "./reverse-standard";

// ADR-0164 · agen fase. Setiap fase flow dikerjakan subagent native `hanoman-fase-<slug>` yang
// model/effort-nya terkunci saat sesi lahir. Instruksinya potongan prompt yang di mode sesi tunggal
// hidup di prompt parent — dipindah ke fase pemiliknya, supaya kedua mode tak berselisih soal CARA
// sebuah fase dikerjakan.

export type PhaseAgentContext = {
  flow: Flow;
  method: MethodDef;
  verifyScope?: VerifyScope;
  /** Blok ekor prompt sesi tunggal (backlog/project/brief/PRD). Subagent lahir dengan konteks
   *  TERPISAH dan tak pernah melihat prompt parent, jadi blok ini wajib ikut di instruksinya. */
  context: string;
  /** flow prd: slug `docs/prd/<slug>.md`; flow breakdown: slug + judul PRD. */
  prd?: { slug: string; title?: string };
  /** id backlog audit asal (`payload.fromAudit`) untuk feature/qa lanjutan audit. */
  fromAudit?: string;
};

const PROJECT_FLOWS: ReadonlySet<Flow> = new Set(["reverse", "scaffold", "prd", "breakdown"]);
const DOC_WRITING_PHASES: ReadonlySet<string> = new Set(["Docs teknis", "Konvensi & index", "Doc index"]);

const PHASE_AGENT_AUTONOMY =
  "Kamu dipanggil orchestrator sesi hanoman, bukan manusia. Checkpoint \"review\"/\"approval\" milik "
  + "skill BUKAN titik berhenti — lanjut sampai fase ini tuntas. JANGAN bertanya ke manusia secara "
  + "langsung: bila butuh keputusan yang mengubah bentuk kerja (data model, kontrak API, scope), atau "
  + "panduan fase menyuruhmu bertanya ke manusia di terminal, tulis SATU pertanyaan di bagian "
  + "`Pertanyaan untuk manusia:` laporanmu lalu berhenti. Jawabannya datang sebagai pesan susulan ke "
  + "agen yang sama — lanjutkan dari sana dengan konteks yang sudah kamu punya.";

const PHASE_AGENT_RULES = [
  "Batas peran fase:",
  "- JANGAN menulis `$HANOMAN_PHASE_FILE` — orchestrator satu-satunya penulis marker fase.",
  "- JANGAN `git push` — push milik orchestrator. Commit artefak fasemu sendiri sebelum melapor.",
  `- JANGAN memanggil agen berawalan \`${PHASE_AGENT_PREFIX}\`. Custom agent lain boleh dipanggil bila relevan.`,
  "- Kerjakan HANYA fase ini; fase lain dikerjakan agen fasenya sendiri.",
].join("\n");

const PHASE_AGENT_REPORT = [
  "Kontrak laporan (wajib, di akhir):",
  "- Baris pertama: `Status: selesai | sebagian | terhalang`.",
  "- `Artefak:` path berkas yang kamu tulis/ubah.",
  "- `Bukti:` perintah yang dijalankan beserta hasil yang benar-benar kamu baca.",
  "- `Pertanyaan untuk manusia:` (opsional) SATU pertanyaan; bila ada, berhenti di situ.",
  "- `Rekomendasi fase:` (opsional) mis. `jalur-cepat` sesudah Audit qa.",
  "Klaim tanpa bukti bukan bukti. Maksimal 1200 kata.",
].join("\n");

const ATTACHMENT_NOTE =
  "Bila serah-terima menyebut manifest lampiran (`INDEX.md`), baca manifest itu dan lampiran yang "
  + "relevan di awal fase.";

/** Defensif seperti `readSpecMethod`: payload datang dari kolom Json. */
export function fromAuditOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>).fromAudit;
  return typeof value === "string" && value ? value : undefined;
}

function backlogGuide(flow: Flow, phase: string, ctx: PhaseAgentContext): string {
  const m = ctx.method;
  switch (phase) {
    case "Brainstorm":
      return "- Brainstorm: gali konteks, alternatif, dan keputusan untuk backlog ini dari Source of Truth "
        + `dan kode. Tulis hasilnya sebagai bagian \`## Konteks & keputusan\` di dokumen spec baru di `
        + `\`${m.specDir}/\` (nama berkas \`<YYYY-MM-DD>-<spec-id>-<slug>-design.md\`) dan laporkan path-nya.`
        + (ctx.fromAudit
          ? ` Backlog ini LANJUTAN audit ${ctx.fromAudit}: baca \`internal/docs/research/audit-`
            + `${ctx.fromAudit.toLowerCase()}-*.md\` lebih dulu dan pakai temuannya sebagai bahan — jangan `
            + "menginvestigasi ulang dari nol."
          : "");
    case "Objective":
      return "- Objective: baca dokumen spec dari fase Brainstorm (path-nya di serah-terima), lalu tambahkan "
        + "bagian `## Objective` berisi SATU objective terukur beserta kriteria suksesnya.";
    case "Spec":
      return flow === "qa"
        ? `- Spec: tulis dokumen spec perbaikan di \`${m.specDir}/\` dari dokumen audit fase Audit (path-nya `
          + "di serah-terima): akar masalah, bentuk perbaikan, dan acceptance criteria gaya EARS."
        : "- Spec: lengkapi dokumen spec yang sama — arsitektur, komponen, kontrak data/API, penanganan "
          + "galat, dan acceptance criteria gaya EARS. Perbarui docs Source of Truth yang tersentuh.";
    case "Plan":
      return `- Plan: tulis plan implementasi berkotak \`- [ ]\` di \`${m.planDir}/\` untuk backlog ini dari `
        + "dokumen spec-nya (path di serah-terima).";
    case "Execute":
      return `- Execute: kerjakan plan di \`${m.planDir}/**\` untuk backlog ini. Execute BELUM selesai selama `
        + "plan masih punya task `- [ ]`: kerjakan SEMUA task sampai tiap kotak jadi `- [x]` sebelum melapor "
        + "`Status: selesai`. hanoman menahan backlog di `executing`, bukan `done`, selama masih ada `- [ ]`.";
    case "Audit":
      return flow === "audit"
        ? "- Audit: ini audit-only — investigasi SAJA, JANGAN menulis perbaikan kode apa pun. Telusuri akar "
          + "masalah / log / jawaban dan nilai apakah issue terdefinisi dengan baik. Laporkan temuan beserta "
          + "buktinya; dokumennya ditulis fase Laporan."
        : "- Audit: telusuri akar masalah dengan bukti (reproduksi, log, kode) dan tulis dokumen audit ke "
          + "`internal/docs/research/audit-<spec-id>-<slug>.md`. Lalu putuskan jalurnya dari hasil Audit, "
          + "bukan default: bila temuan berconfidence tinggi dan perbaikannya bisa dikerjakan langsung (diff "
          + "kecil, akar masalah jelas), tulis `Rekomendasi fase: jalur-cepat` beserta alasannya — "
          + "orchestrator akan melewati Spec & Plan dan dokumen audit menjadi doc-of-record perbaikan itu. "
          + "Bila temuan luas, berisiko, atau ambigu, tulis `Rekomendasi fase: penuh`.";
    case "Laporan":
      return "- Laporan: tulis DOKUMEN AUDIT ke Source of Truth `internal/docs/research/audit-<spec-id>-<slug>.md` "
        + "(ikuti konvensi audit yang ada), tautkan di `internal/docs/README.md`, memuat: keluhan/pertanyaan, "
        + "temuan (dengan bukti/log), apakah issue terdefinisi baik, dan rekomendasi tindak lanjut. Commit "
        + "dokumen itu. Tak ada kode fitur.\n\n" + ESCALATION_CONTRACT;
    case "Goal":
      return "- Goal: kerjakan goal di blok KONTEKS sampai tercapai. TIDAK ada design doc, plan berkotak, "
        + "maupun backlog baru.";
    case "Verifikasi":
      return "- Verifikasi: bukan formalitas — jalankan perintah yang membuktikan goal-nya tercapai "
        + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output bukan bukti.";
    case "Kerjakan":
      return "- Kerjakan: SATU pekerjaan remeh. Langsung kerjakan dan buktikan seperlunya di fase yang sama. "
        + "Jangan menulis design doc, plan berkotak, backlog baru, atau fase tambahan.";
    default:
      return "";
  }
}

function projectGuide(flow: Flow, phase: string, ctx: PhaseAgentContext): string {
  if (flow === "reverse") return guideLine(REVERSE_PHASE_GUIDE, phase);
  if (flow === "scaffold") return guideLine(SCAFFOLD_PHASE_GUIDE, phase);
  const slug = ctx.prd?.slug ?? flow;
  const lines: Record<string, string> = flow === "prd"
    ? prdPhaseLines(slug)
    : breakdownPhaseLines(slug, ctx.prd?.title ?? slug);
  return lines[phase] ?? "";
}

export function phaseAgentInstructions(
  entry: PhasePlanEntry, index: number, plan: PhasePlan, ctx: PhaseAgentContext,
): string {
  const { flow, method } = ctx;
  const phase = entry.phase;
  const guide = PROJECT_FLOWS.has(flow) ? projectGuide(flow, phase, ctx) : backlogGuide(flow, phase, ctx);
  const skills = phaseSkillsFor(flow, phase, method);
  const work = (WORK_PHASES as readonly string[]).includes(phase);
  return [
    `Kamu agen fase "${phase}" (fase ${index + 1}/${plan.phases.length}) flow ${flow} hanoman. Ikuti `
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam "
      + "commit yang sama.",
    guide,
    DOC_WRITING_PHASES.has(phase) ? `=== STANDAR DOCS ===\n${REVERSE_STANDARD}` : "",
    skills.length
      ? `Skills ${method.label} WAJIB untuk fase ini — muat & ikuti dengan mekanisme yang tersedia di agenmu: `
        + skills.join(", ")
      : "",
    work ? scopeClause(flow, ctx.verifyScope) : "",
    work ? codeStyleClause(flow) : "",
    methodClause(method),
    ATTACHMENT_NOTE,
    PHASE_AGENT_AUTONOMY,
    PHASE_AGENT_RULES,
    PHASE_AGENT_REPORT,
    `=== KONTEKS ===\n${ctx.context}`,
  ].filter(Boolean).join("\n\n");
}

export function buildPhaseAgents(plan: PhasePlan, ctx: PhaseAgentContext): AgentDef[] {
  return plan.phases.map((entry, index) => ({
    kind: "phase" as const,
    phase: entry.phase,
    name: entry.agentName,
    description: `Fase ${entry.phase} flow ${plan.flow} hanoman — hanya dipanggil orchestrator sesi ini.`,
    instructions: phaseAgentInstructions(entry, index, plan, ctx),
    tools: null,
    model: entry.model,
    effort: entry.effort,
    mentions: [],
  }));
}
