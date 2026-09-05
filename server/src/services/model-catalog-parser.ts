import { z } from "zod";
import type { ClaudeModel, CodexModel, ModelCatalog } from "@hanoman/shared";

const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]*$/);
const label = z.string().min(1).max(300);
const effort = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);
const efforts = z.array(effort).max(32);
const order = ["ultracode", "ultra", "max", "xhigh", "high", "medium", "low", "minimal", "none"];
const sorted = (values: string[]) => [...new Set(values)].sort((a, b) =>
  (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));

const claudeRow = z.object({
  value: id, resolvedModel: id.optional(), displayName: label,
  description: z.string().max(2000).optional(),
  supportedEffortLevels: efforts.optional(),
});
export function parseClaudeModels(raw: unknown): ClaudeModel[] {
  const rows = z.array(claudeRow).min(1).max(500).parse(raw);
  const models = new Map<string, ClaudeModel>();
  for (const row of rows) {
    const model: ClaudeModel = {
      id: row.resolvedModel ?? row.value,
      label: row.description?.split(" · ")[0] || row.displayName,
      ...(row.supportedEffortLevels ? { efforts: sorted(row.supportedEffortLevels) } : {}),
    };
    if (!models.has(model.id)) models.set(model.id, model);
    if (row.value !== model.id && row.value !== "default") {
      models.set(row.value, { ...model, id: row.value, label: row.displayName });
    }
  }
  return [...models.values()];
}

const codexRow = z.object({
  slug: id, display_name: label.optional(), visibility: z.string().optional(),
  supported_reasoning_levels: z.array(z.object({ effort })).min(1).max(32),
  default_reasoning_level: effort,
  minimal_client_version: z.string().regex(/^\d+\.\d+\.\d+$/).nullable().optional(),
});
export function parseCodexModels(raw: unknown): CodexModel[] {
  const { models: rows } = z.object({ models: z.array(z.unknown()).max(500) }).parse(raw);
  const visible = rows.filter((row) => typeof row === "object" && row !== null
    && (row as { visibility?: string }).visibility !== "hide");
  const models = z.array(codexRow).min(1).parse(visible).map((row) => {
    const levels = sorted(row.supported_reasoning_levels.map((r) => r.effort));
    if (!levels.includes(row.default_reasoning_level)) throw new Error("invalid default effort");
    return { id: row.slug, label: row.display_name ?? row.slug, efforts: levels,
      fallback: row.default_reasoning_level, minClient: row.minimal_client_version ?? "" };
  });
  return [...new Map(models.map((m) => [m.id, m])).values()];
}

/** Allowlist persisted fields: raw initialize includes account details and must never be cached. */
export function parseCachedCatalog(raw: unknown): ModelCatalog {
  const status = z.object({
    source: z.enum(["bundled", "cache", "cli"]), checkedAt: z.string().nullable(),
    updatedAt: z.string().nullable(), error: z.string().nullable(),
  });
  return z.object({
    claude: z.array(z.object({ id, label, efforts: efforts.optional() })).min(1).max(1000),
    codex: z.array(z.object({ id, label, efforts: efforts.min(1), fallback: id, minClient: z.string() }))
      .min(1).max(1000),
    providers: z.object({ claude: status, codex: status }),
  }).parse(raw);
}
