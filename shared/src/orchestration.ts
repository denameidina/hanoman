// ADR-0164 · orkestrasi subagent per fase — konstanta & tipe TANPA impor. `entities.ts` membangun
// skema `Setting.orchestration`, sementara resolver yang butuh katalog model hidup di
// `orchestration-plan.ts`: menaruh keduanya di satu berkas menutup lingkaran impor.

export const ORCHESTRATION_FLOWS = [
  "feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown", "goal", "no_effort",
] as const;
export type OrchestrationFlow = (typeof ORCHESTRATION_FLOWS)[number];

// Pindahan `PIPELINES` (runner/src/prompt.ts) APA ADANYA; runner mengekspornya ulang dengan nama
// lama. Ia pindah ke sini karena Settings & modal Start butuh daftar yang sama, dan frontend tak
// mengimpor runner.
export const FLOW_PHASES: Readonly<Record<OrchestrationFlow, readonly string[]>> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"],
  prd: ["Brainstorm", "PRD"],
  audit: ["Audit", "Laporan"],
  breakdown: ["Analisis", "Breakdown"],
  // SPEC-337 · ADR-0075 · audit lintas project: fase & stage-map identik audit-only, scope-nya
  // yang berbeda (project utama + tetangga ProjectLink).
  // SPEC-407 · ADR-0089 · backlog goal: tak ada fase perencanaan sama sekali. `Goal` = kerjakan,
  // `Verifikasi` = buktikan. Kedua nama unik lintas daftar ini — syarat peta REACHED di server,
  // yang berkunci nama fase saja.
  goal: ["Goal", "Verifikasi"],
  // SPEC-825 · ADR-0123 · task remeh: SATU fase. Nama `Kerjakan` unik lintas daftar ini — syarat
  // peta REACHED server, yang berkunci nama fase saja.
  no_effort: ["Kerjakan"],
};

/** Awalan yang dicadangkan: skema custom agent menolaknya supaya registry native tak tertimpa. */
export const PHASE_AGENT_PREFIX = "hanoman-fase-";

export function phaseAgentName(phase: string): string {
  return PHASE_AGENT_PREFIX
    + phase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const isPhaseAgentName = (name: string): boolean => name.startsWith(PHASE_AGENT_PREFIX);

/** Hook fail-open dan relay spool bisa terlambat; ⚠ baru menyala sesudah tenggang ini. */
export const PHASE_EVIDENCE_GRACE_MS = 60_000;

export type PhasePlanEntry = { phase: string; agentName: string; model: string; effort: string };
export type PhasePlan = {
  flow: OrchestrationFlow; runtime: "claude" | "codex"; phases: PhasePlanEntry[];
};
