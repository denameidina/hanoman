export type AntigravityModel = { id: string; label: string; efforts: readonly string[] };

export const ANTIGRAVITY_CHILD_TIERS = ["inherit", "flash", "pro"] as const;
export type AntigravityChildTier = (typeof ANTIGRAVITY_CHILD_TIERS)[number];

export const BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS = {
  model: "gemini-3.8-flash-high",
  effort: "high",
} as const;

export let ANTIGRAVITY_MODELS: readonly AntigravityModel[] = [{
  id: BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS.model,
  label: "Gemini 3.8 Flash High",
  efforts: [BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS.effort],
}];

export function replaceAntigravityModelCatalog(models: readonly AntigravityModel[]): void {
  ANTIGRAVITY_MODELS = models;
}

export function antigravityEfforts(modelId: string): readonly string[] {
  const known = ANTIGRAVITY_MODELS.find((model) => model.id === modelId);
  if (known) return known.efforts;
  // CLI slugs encode one verified level; help alone does not prove every model supports all levels.
  const suffix = /-(low|medium|high)$/.exec(modelId)?.[1];
  return suffix ? [suffix] : [];
}

export function isAntigravityChildTier(value: unknown): value is AntigravityChildTier {
  return ANTIGRAVITY_CHILD_TIERS.some((tier) => tier === value);
}
