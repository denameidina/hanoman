import {
  BUILTIN_CLAUDE_RUNTIME_DEFAULTS, BUILTIN_CODEX_RUNTIME_DEFAULTS, BUILTIN_ORCHESTRATION_DEFAULTS,
  BUILTIN_RUNTIME_DEFAULTS, LEGACY_CLAUDE_RUNTIME_DEFAULTS, LEGACY_CODEX_RUNTIME_DEFAULTS,
  LEGACY_ORCHESTRATION_FLOW_DEFAULT, ORCHESTRATION_FLOWS, RUNTIME_DEFAULTS_VERSION,
  FLOW_PHASES, zBuiltinRuntimeDefaults, zFlowOrchestration, zSetting,
  type BuiltinRuntimeDefaults, type OrchestrationFlow, type Setting, type RuntimeDefaultState,
} from "@hanoman/shared";
import { prisma } from "../db";

type RuntimeDefaultStates = {
  claude: { model: RuntimeDefaultState; effort: RuntimeDefaultState };
  codex: { model: RuntimeDefaultState; effort: RuntimeDefaultState };
  orchestration: Record<string, RuntimeDefaultState>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// JSON.stringify cukup untuk objek Setting karena seluruh inputnya berasal dari JSON dan object
// key order dijaga oleh zod/seed. Mengurutkan key membuat perbandingan tahan terhadap urutan field.
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

const seededFlowStates = (): Record<string, RuntimeDefaultState> =>
  Object.fromEntries(Object.keys(BUILTIN_RUNTIME_DEFAULTS.orchestration).map((key) => [key, "seeded"]));

const markerFrom = (states: RuntimeDefaultStates): BuiltinRuntimeDefaults => ({
  version: RUNTIME_DEFAULTS_VERSION,
  claude: states.claude,
  codex: states.codex,
  orchestration: states.orchestration,
});

const legacyFlow = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const parsed = zFlowOrchestration.safeParse(value);
  return parsed.success && same(parsed.data, LEGACY_ORCHESTRATION_FLOW_DEFAULT);
};

function inferLegacyStates(raw: unknown): RuntimeDefaultStates {
  const object = isRecord(raw) ? raw : {};
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
  const rawCodex = object.codex;
  const rawOrchestration = isRecord(object.orchestration) ? object.orchestration : {};
  const orchestration = seededFlowStates();

  for (const flow of ORCHESTRATION_FLOWS) {
    const rawFlow = rawOrchestration[flow];
    if (!has("orchestration") || rawFlow === undefined) continue;
    if (!legacyFlow(rawFlow)) {
      const flowObject = isRecord(rawFlow) ? rawFlow : {};
      if (Object.prototype.hasOwnProperty.call(flowObject, "enabled") && flowObject.enabled !== true)
        orchestration[`${flow}.enabled`] = "user";
      for (const runtime of ["claude", "codex"] as const) {
        const rawRuntime = isRecord(flowObject[runtime]) ? flowObject[runtime] : {};
        for (const phase of FLOW_PHASES[flow]) {
          const rawCell = rawRuntime[phase];
          if (!isRecord(rawCell)) continue;
          for (const field of ["model", "effort"] as const) {
            if (Object.prototype.hasOwnProperty.call(rawCell, field))
              orchestration[`${flow}.${runtime}.${phase}.${field}`] = "user";
          }
        }
      }
    }
  }

  const claudeModel = !has("model") || object.model === LEGACY_CLAUDE_RUNTIME_DEFAULTS.model ? "seeded" : "user";
  const claudeEffort = !has("effort") || object.effort === LEGACY_CLAUDE_RUNTIME_DEFAULTS.effort ? "seeded" : "user";
  const rawCodexObject = isRecord(rawCodex) ? rawCodex : {};
  const codexModel = !has("codex") || !Object.prototype.hasOwnProperty.call(rawCodexObject, "model")
    || rawCodexObject.model === LEGACY_CODEX_RUNTIME_DEFAULTS.model ? "seeded" : "user";
  const codexEffort = !has("codex") || !Object.prototype.hasOwnProperty.call(rawCodexObject, "effort")
    || rawCodexObject.effort === LEGACY_CODEX_RUNTIME_DEFAULTS.effort ? "seeded" : "user";
  return {
    claude: { model: claudeModel, effort: claudeEffort },
    codex: { model: codexModel, effort: codexEffort },
    orchestration,
  };
}

function statesFor(raw: unknown, setting: Setting): RuntimeDefaultStates {
  const object = isRecord(raw) ? raw : {};
  const marker = zBuiltinRuntimeDefaults.safeParse(object.builtinRuntimeDefaults);
  if (marker.success) {
    const orchestration = seededFlowStates();
    for (const flow of ORCHESTRATION_FLOWS) {
      const prefix = `${flow}.`;
      for (const [key, state] of Object.entries(marker.data.orchestration)) {
        if (key.startsWith(prefix)) orchestration[key] = state;
      }
    }
    return { claude: marker.data.claude, codex: marker.data.codex, orchestration };
  }
  return inferLegacyStates(raw);
}

/**
 * Pure upgrade operation used by boot and tests. `null` means the stored Setting is invalid and
 * must be left alone for the operator to inspect; boot must never replace a corrupt row silently.
 */
export function applyRuntimeDefaults(raw: unknown): { data: Setting; changed: boolean } | null {
  const isFresh = raw === undefined || raw === null;
  const parsed = isFresh
    ? zSetting.safeParse({ autoDefault: true, autoScaffold: true, notifyFail: true })
    : zSetting.safeParse(raw);
  if (!parsed.success) return null;

  const states = statesFor(raw, parsed.data);
  const orchestration = { ...parsed.data.orchestration };
  for (const flow of ORCHESTRATION_FLOWS) {
    const builtIn = BUILTIN_ORCHESTRATION_DEFAULTS[flow];
    const existing = parsed.data.orchestration[flow];
    const nextFlow = {
      ...existing,
      enabled: states.orchestration[`${flow}.enabled`] !== "user" ? builtIn.enabled : existing.enabled,
      claude: { ...existing.claude }, codex: { ...existing.codex },
    };
    for (const runtime of ["claude", "codex"] as const) {
      for (const phase of FLOW_PHASES[flow]) {
        const existingCell = nextFlow[runtime][phase] ?? { model: null, effort: null };
        const builtInCell = builtIn[runtime][phase]!;
        nextFlow[runtime][phase] = {
          model: states.orchestration[`${flow}.${runtime}.${phase}.model`] !== "user"
            ? builtInCell.model : existingCell.model,
          effort: states.orchestration[`${flow}.${runtime}.${phase}.effort`] !== "user"
            ? builtInCell.effort : existingCell.effort,
        };
      }
    }
    orchestration[flow] = nextFlow;
  }
  const data = zSetting.parse({
    ...parsed.data,
    model: states.claude.model === "seeded" ? BUILTIN_CLAUDE_RUNTIME_DEFAULTS.model : parsed.data.model,
    effort: states.claude.effort === "seeded" ? BUILTIN_CLAUDE_RUNTIME_DEFAULTS.effort : parsed.data.effort,
    codex: {
      model: states.codex.model === "seeded" ? BUILTIN_CODEX_RUNTIME_DEFAULTS.model : parsed.data.codex.model,
      effort: states.codex.effort === "seeded" ? BUILTIN_CODEX_RUNTIME_DEFAULTS.effort : parsed.data.codex.effort,
    },
    orchestration,
    builtinRuntimeDefaults: markerFrom(states),
  });
  return { data, changed: isFresh || !same(raw, data) };
}

/** Called once before custom-agent cache installation, so the first session sees current defaults. */
export async function seedRuntimeDefaults(): Promise<void> {
  try {
    const raw = (await prisma.setting.findUnique({ where: { id: 1 } }))?.data;
    const result = applyRuntimeDefaults(raw);
    if (!result?.changed) return;
    await prisma.setting.upsert({
      where: { id: 1 }, update: { data: result.data }, create: { id: 1, data: result.data },
    });
  } catch {
    // Runtime defaults must not prevent the server or the first session from starting.
  }
}

/** Mark only values changed through Settings/API as user-owned; future seeds then preserve them. */
export function markRuntimeDefaultsUserEdited(before: Setting, next: Setting): BuiltinRuntimeDefaults {
  const parsed = zBuiltinRuntimeDefaults.safeParse(before.builtinRuntimeDefaults);
  const current = parsed.success ? parsed.data : {
    ...BUILTIN_RUNTIME_DEFAULTS,
    claude: { ...BUILTIN_RUNTIME_DEFAULTS.claude },
    codex: { ...BUILTIN_RUNTIME_DEFAULTS.codex },
    orchestration: { ...BUILTIN_RUNTIME_DEFAULTS.orchestration },
  };
  const orchestration = { ...seededFlowStates(), ...current.orchestration };
  if (before.model !== next.model) current.claude.model = "user";
  if (before.effort !== next.effort) current.claude.effort = "user";
  if (before.codex.model !== next.codex.model) current.codex.model = "user";
  if (before.codex.effort !== next.codex.effort) current.codex.effort = "user";
  for (const flow of ORCHESTRATION_FLOWS) {
    if (before.orchestration[flow].enabled !== next.orchestration[flow].enabled)
      orchestration[`${flow}.enabled`] = "user";
    for (const runtime of ["claude", "codex"] as const) {
      for (const phase of FLOW_PHASES[flow]) {
        for (const field of ["model", "effort"] as const) {
          if (before.orchestration[flow][runtime][phase]?.[field]
            !== next.orchestration[flow][runtime][phase]?.[field])
            orchestration[`${flow}.${runtime}.${phase}.${field}`] = "user";
        }
      }
    }
  }
  return {
    version: RUNTIME_DEFAULTS_VERSION,
    claude: { ...current.claude },
    codex: { ...current.codex },
    orchestration,
  };
}
