import type { Agent } from "./entities";
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
  // ADR-0230 · `Review` = fase resmi sesudah Execute (dulu langkah R di dalam Execute, ADR-0170 #4).
  // ADR-0233 · `Mockup` = fase opsional sesudah Spec: gambar UI disetujui sebelum Plan, dilewati agen
  // bila backlog tak menyentuh UI.
  feature: ["Brainstorm", "Objective", "Spec", "Mockup", "Plan", "Execute", "Review"],
  qa: ["Audit", "Spec", "Mockup", "Plan", "Execute", "Review"],
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

// Amandemen ADR-0170 P2 · cara fase Execute (claude ber-orkestrasi) mengerjakan plan. `inline` =
// agen fase mengerjakan task sendiri (`executing-plans`); `subagent` = implementer + review per task
// (`subagent-driven-development`). Default `inline`: subagent per task terukur terlalu lambat.
export const EXECUTE_MODES = ["inline", "subagent"] as const;
export type ExecuteMode = (typeof EXECUTE_MODES)[number];
/** Flow yang punya fase kerja (Execute/Goal) — hanya di sini `executeMode` bermakna. */
export const EXECUTE_MODE_FLOWS: ReadonlySet<OrchestrationFlow> = new Set(
  ORCHESTRATION_FLOWS.filter((f) => FLOW_PHASES[f].some((p) => p === "Execute" || p === "Goal")),
);

export type PhasePlanEntry = { phase: string; agentName: string; model: string; effort: string | null };

// ADR-0170 P2 · reviewer independen hasil Execute. ADR-0230 · kini agen fase `Review` biasa (fase
// pipeline resmi flow feature & qa), bukan lampiran Execute. Defaultnya tetap konstanta peran — penilai
// independen butuh model kuat walau orchestrator murah — dan sel Setting
// `orchestration.<flow>.<runtime>.Review` / `phaseOverrides.Review` meng-override-nya. Agen fase lain
// (yang dilarang memanggil `hanoman-fase-*`) tetap tak bisa memanggilnya: hanya orchestrator.
export const REVIEWER_CELL = "Review";
export const REVIEWER_FLOWS: ReadonlySet<OrchestrationFlow> = new Set(
  ORCHESTRATION_FLOWS.filter((f) => FLOW_PHASES[f].includes(REVIEWER_CELL)),
);
export const REVIEWER_DEFAULTS: Readonly<Record<Agent, { model: string; effort: string | null }>> = {
  claude: { model: "opus", effort: "high" },
  codex: { model: "gpt-5.6-sol", effort: "high" },
  antigravity: { model: "inherit", effort: null },
};
/** ADR-0230 · fase yang `skipped`-nya TIDAK dihitung tercapai/lengkap (server, gate codex, prompt). */
export const UNSKIPPABLE_PHASES: ReadonlySet<string> = new Set([REVIEWER_CELL]);

export const MOCKUP_PHASE = "Mockup";
/** ADR-0233 · fase yang belum tercatat dibaca `skipped` bila fase sesudahnya sudah tercatat: sesi yang
 *  lahir sebelum fase itu ada tak pernah menulis barisnya, dan pipeline-nya tak boleh tersandera. */
export const OPTIONAL_PHASES: ReadonlySet<string> = new Set([MOCKUP_PHASE]);

export type PhasePlan = {
  flow: OrchestrationFlow; runtime: Agent; phases: PhasePlanEntry[];
  /** Amandemen ADR-0170 P2 · absen (pemanggil lama) = `inline`. */
  executeMode?: ExecuteMode;
};
