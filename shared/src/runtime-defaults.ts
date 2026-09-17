import { FLOW_PHASES, ORCHESTRATION_FLOWS, type OrchestrationFlow } from "./orchestration";
import { z } from "zod";

// Naikkan versi ini setiap kali rekomendasi bawaan berubah. Seed server memakai versi ini
// bersama marker per bagian untuk memperbarui konfigurasi bawaan tanpa menimpa edit operator.
export const RUNTIME_DEFAULTS_VERSION = "2026-09-17-v1";

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

export const BUILTIN_CLAUDE_RUNTIME_DEFAULTS = {
  model: "claude-sonnet-5",
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
  claude: {},
  codex: {},
} as const;

type PhaseCellDefault = { model: string; effort: string };
type FlowDefault = {
  enabled: boolean;
  claude: Record<string, PhaseCellDefault>;
  codex: Record<string, PhaseCellDefault>;
};

const cell = (model: string, effort: string): PhaseCellDefault => ({ model, effort });
const flow = (
  claude: Record<string, PhaseCellDefault>,
  codex: Record<string, PhaseCellDefault>,
  enabled = true,
): FlowDefault => ({ enabled, claude, codex });

// Rekomendasi operasional: Sonnet/Terra untuk pekerjaan rutin, Opus/Sol untuk fase yang
// membutuhkan sintesis atau keputusan lebih berat. Semua effort medium menjaga biaya dan durasi
// tetap seimbang; no_effort sengaja mati sebagai pagar agar task remeh tidak menyalakan pipeline.
export const BUILTIN_ORCHESTRATION_DEFAULTS: Record<OrchestrationFlow, FlowDefault> = {
  feature: flow(
    {
      Brainstorm: cell("claude-sonnet-5", "medium"),
      Objective: cell("claude-sonnet-5", "medium"),
      Spec: cell("claude-opus-5", "medium"),
      Plan: cell("claude-sonnet-5", "medium"),
      Execute: cell("claude-sonnet-5", "medium"),
    },
    {
      Brainstorm: cell("gpt-5.6-terra", "medium"),
      Objective: cell("gpt-5.6-terra", "medium"),
      Spec: cell("gpt-5.6-sol", "medium"),
      Plan: cell("gpt-5.6-terra", "medium"),
      Execute: cell("gpt-5.6-terra", "medium"),
    },
  ),
  qa: flow(
    {
      Audit: cell("claude-sonnet-5", "medium"),
      Spec: cell("claude-opus-5", "medium"),
      Plan: cell("claude-sonnet-5", "medium"),
      Execute: cell("claude-sonnet-5", "medium"),
    },
    {
      Audit: cell("gpt-5.6-terra", "medium"),
      Spec: cell("gpt-5.6-sol", "medium"),
      Plan: cell("gpt-5.6-terra", "medium"),
      Execute: cell("gpt-5.6-terra", "medium"),
    },
  ),
  scaffold: flow(
    {
      Brainstorm: cell("claude-sonnet-5", "medium"),
      Objective: cell("claude-sonnet-5", "medium"),
      "Doc index": cell("claude-opus-5", "medium"),
    },
    {
      Brainstorm: cell("gpt-5.6-terra", "medium"),
      Objective: cell("gpt-5.6-terra", "medium"),
      "Doc index": cell("gpt-5.6-sol", "medium"),
    },
  ),
  reverse: flow(
    {
      Scan: cell("claude-sonnet-5", "medium"),
      "Docs teknis": cell("claude-sonnet-5", "medium"),
      Wawancara: cell("claude-sonnet-5", "medium"),
      "Konvensi & index": cell("claude-sonnet-5", "medium"),
      "Serah terima": cell("claude-sonnet-5", "medium"),
    },
    {
      Scan: cell("gpt-5.6-terra", "medium"),
      "Docs teknis": cell("gpt-5.6-terra", "medium"),
      Wawancara: cell("gpt-5.6-terra", "medium"),
      "Konvensi & index": cell("gpt-5.6-terra", "medium"),
      "Serah terima": cell("gpt-5.6-terra", "medium"),
    },
  ),
  prd: flow(
    {
      Brainstorm: cell("claude-sonnet-5", "medium"),
      PRD: cell("claude-opus-5", "medium"),
    },
    {
      Brainstorm: cell("gpt-5.6-terra", "medium"),
      PRD: cell("gpt-5.6-sol", "medium"),
    },
  ),
  audit: flow(
    {
      Audit: cell("claude-sonnet-5", "medium"),
      Laporan: cell("claude-sonnet-5", "medium"),
    },
    {
      Audit: cell("gpt-5.6-terra", "medium"),
      Laporan: cell("gpt-5.6-terra", "medium"),
    },
  ),
  breakdown: flow(
    {
      Analisis: cell("claude-opus-5", "medium"),
      Breakdown: cell("claude-opus-5", "medium"),
    },
    {
      Analisis: cell("gpt-5.6-sol", "medium"),
      Breakdown: cell("gpt-5.6-sol", "medium"),
    },
  ),
  goal: flow(
    {
      Goal: cell("claude-sonnet-5", "medium"),
      Verifikasi: cell("claude-sonnet-5", "medium"),
    },
    {
      Goal: cell("gpt-5.6-terra", "medium"),
      Verifikasi: cell("gpt-5.6-terra", "medium"),
    },
  ),
  no_effort: flow(
    { Kerjakan: cell("claude-haiku-4-5", "low") },
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
