import { FLOW_PHASES, ORCHESTRATION_FLOWS, type OrchestrationFlow } from "./orchestration";
import { z } from "zod";

// Naikkan versi ini setiap kali rekomendasi bawaan berubah. Seed server memakai versi ini
// bersama marker per bagian untuk memperbarui konfigurasi bawaan tanpa menimpa edit operator.
export const RUNTIME_DEFAULTS_VERSION = "2026-09-23-v2";

export const zRuntimeDefaultState = z.enum(["seeded", "user"]);
export type RuntimeDefaultState = z.infer<typeof zRuntimeDefaultState>;

export const zBuiltinRuntimeDefaults = z.object({
  version: z.string().default(RUNTIME_DEFAULTS_VERSION),
  claude: z.object({
    model: zRuntimeDefaultState.default("seeded"),
    effort: zRuntimeDefaultState.default("seeded"),
  }).default({}),
  codex: z.object({
    model: zRuntimeDefaultState.default("seeded"),
    effort: zRuntimeDefaultState.default("seeded"),
  }).default({}),
  orchestration: z.record(z.string(), zRuntimeDefaultState).default({}),
});
export type BuiltinRuntimeDefaults = z.infer<typeof zBuiltinRuntimeDefaults>;

// Alias native CLI, bukan id terpatok: ikut berpindah saat CLI merilis model baru.
export const BUILTIN_CLAUDE_RUNTIME_DEFAULTS = {
  model: "sonnet",
  effort: "medium",
} as const;

export const BUILTIN_CODEX_RUNTIME_DEFAULTS = {
  model: "gpt-5.6-terra",
  effort: "medium",
} as const;

export const LEGACY_CLAUDE_RUNTIME_DEFAULTS = {
  model: "claude-opus-5",
  effort: "xhigh",
} as const;

export const LEGACY_CODEX_RUNTIME_DEFAULTS = {
  model: "gpt-5.6-sol",
  effort: "xhigh",
} as const;

export const LEGACY_ORCHESTRATION_FLOW_DEFAULT = {
  enabled: true,
  // Amandemen ADR-0170 P2 · bentuk HASIL parse zod (default `inline`), bukan bentuk mentah lama.
  executeMode: "inline",
  claude: {},
  codex: {},
} as const;

type PhaseCellDefault = { model: string; effort: string };
type FlowDefault = {
  enabled: boolean;
  executeMode: "inline" | "subagent";
  claude: Record<string, PhaseCellDefault>;
  codex: Record<string, PhaseCellDefault>;
};

const cell = (model: string, effort: string): PhaseCellDefault => ({ model, effort });
const flow = (
  claude: Record<string, PhaseCellDefault>,
  codex: Record<string, PhaseCellDefault>,
  enabled = true,
): FlowDefault => ({ enabled, executeMode: "inline", claude, codex });

// Rekomendasi operasional (v2): effort mengikuti PERAN fase, bukan seragam.
// - Fase penentu arah (Spec, Plan, Audit qa, Analisis, Doc index, PRD) → Opus/Sol · high: salahnya
//   menjalar ke semua fase sesudahnya, keluarannya pendek sehingga effort tinggi murah.
// - Eksekusi kode (Execute, Goal) → Sonnet/Terra · high: fase terpanjang; coding paling peka effort,
//   dan medium cenderung menambah putaran revisi yang justru lebih mahal per task selesai.
// - Fase interaktif dengan manusia (Brainstorm, Objective, Wawancara) → Sonnet/Terra · medium.
// - Verifikasi → Opus/Sol · medium: model berbeda dari eksekutor menangkap hijau palsu.
// - Menulis ulang temuan (Laporan, Serah terima) → Sonnet/Terra · medium/low.
// no_effort sengaja mati sebagai pagar agar task remeh tidak menyalakan pipeline.
export const BUILTIN_ORCHESTRATION_DEFAULTS: Record<OrchestrationFlow, FlowDefault> = {
  feature: flow(
    {
      Brainstorm: cell("sonnet", "medium"),
      Objective: cell("sonnet", "medium"),
      Spec: cell("opus", "high"),
      Plan: cell("opus", "high"),
      Execute: cell("sonnet", "high"),
    },
    {
      Brainstorm: cell("gpt-5.6-terra", "medium"),
      Objective: cell("gpt-5.6-terra", "medium"),
      Spec: cell("gpt-5.6-sol", "high"),
      Plan: cell("gpt-5.6-sol", "high"),
      Execute: cell("gpt-5.6-terra", "high"),
    },
  ),
  qa: flow(
    {
      Audit: cell("opus", "high"),
      Spec: cell("opus", "high"),
      Plan: cell("sonnet", "high"),
      Execute: cell("sonnet", "high"),
    },
    {
      Audit: cell("gpt-5.6-sol", "high"),
      Spec: cell("gpt-5.6-sol", "high"),
      Plan: cell("gpt-5.6-terra", "high"),
      Execute: cell("gpt-5.6-terra", "high"),
    },
  ),
  scaffold: flow(
    {
      Brainstorm: cell("sonnet", "medium"),
      Objective: cell("sonnet", "medium"),
      "Doc index": cell("opus", "high"),
    },
    {
      Brainstorm: cell("gpt-5.6-terra", "medium"),
      Objective: cell("gpt-5.6-terra", "medium"),
      "Doc index": cell("gpt-5.6-sol", "high"),
    },
  ),
  reverse: flow(
    {
      Scan: cell("sonnet", "medium"),
      "Docs teknis": cell("sonnet", "high"),
      Wawancara: cell("sonnet", "medium"),
      "Konvensi & index": cell("opus", "medium"),
      "Serah terima": cell("sonnet", "low"),
    },
    {
      Scan: cell("gpt-5.6-terra", "medium"),
      "Docs teknis": cell("gpt-5.6-terra", "high"),
      Wawancara: cell("gpt-5.6-terra", "medium"),
      "Konvensi & index": cell("gpt-5.6-sol", "medium"),
      "Serah terima": cell("gpt-5.6-terra", "low"),
    },
  ),
  prd: flow(
    {
      Brainstorm: cell("sonnet", "medium"),
      PRD: cell("opus", "high"),
    },
    {
      Brainstorm: cell("gpt-5.6-terra", "medium"),
      PRD: cell("gpt-5.6-sol", "high"),
    },
  ),
  audit: flow(
    {
      Audit: cell("opus", "high"),
      Laporan: cell("sonnet", "medium"),
    },
    {
      Audit: cell("gpt-5.6-sol", "high"),
      Laporan: cell("gpt-5.6-terra", "medium"),
    },
  ),
  breakdown: flow(
    {
      Analisis: cell("opus", "high"),
      Breakdown: cell("opus", "medium"),
    },
    {
      Analisis: cell("gpt-5.6-sol", "high"),
      Breakdown: cell("gpt-5.6-sol", "medium"),
    },
  ),
  goal: flow(
    {
      Goal: cell("sonnet", "high"),
      Verifikasi: cell("opus", "medium"),
    },
    {
      Goal: cell("gpt-5.6-terra", "high"),
      Verifikasi: cell("gpt-5.6-sol", "medium"),
    },
  ),
  no_effort: flow(
    { Kerjakan: cell("haiku", "low") },
    { Kerjakan: cell("gpt-5.6-terra", "low") },
    false,
  ),
};

const seededFlows = Object.fromEntries(ORCHESTRATION_FLOWS.flatMap((flow) => [
  [`${flow}.enabled`, "seeded"],
  ...(["claude", "codex"] as const).flatMap((runtime) =>
    FLOW_PHASES[flow].flatMap((phase) => [
      [`${flow}.${runtime}.${phase}.model`, "seeded"],
      [`${flow}.${runtime}.${phase}.effort`, "seeded"],
    ])),
])) as Record<string, RuntimeDefaultState>;

export const BUILTIN_RUNTIME_DEFAULTS: BuiltinRuntimeDefaults = {
  version: RUNTIME_DEFAULTS_VERSION,
  claude: { model: "seeded", effort: "seeded" },
  codex: { model: "seeded", effort: "seeded" },
  orchestration: seededFlows,
};
