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
/**
 * Id yang disimpan adalah ALIAS native CLI (`default`, `sonnet`, `opus[1m]`, `haiku`), bukan id
 * terpatok: alias ikut berpindah saat CLI merilis model baru, jadi setelan tak basi. `default`
 * (rekomendasi CLI) selalu di urutan pertama. Selain itu satu baris per `resolvedModel` — baris
 * alias menang atas baris id-terpatok bila keduanya menunjuk model yang sama.
 */
export function parseClaudeModels(raw: unknown): ClaudeModel[] {
  const rows = z.array(claudeRow).min(1).max(500).parse(raw);
  let preferred: ClaudeModel | null = null;
  const models = new Map<string, ClaudeModel>();
  for (const row of rows) {
    const resolved = row.resolvedModel ?? row.value;
    const parts = row.description?.split(" · ");
    // Head hanya valid saat description berformat "<Nama Model> · <tagline>"; CLI 2.1.282+
    // cuma memakai format itu untuk baris `default` — baris lain berisi tagline polos tanpa
    // nama model, yang tak boleh dipakai sebagai label.
    const head = parts && parts.length > 1 ? parts[0] : undefined;
    const model: ClaudeModel = {
      id: row.value,
      label: row.value === "default" && head ? `${row.displayName} · ${head}` : head ?? row.displayName,
      resolved,
      ...(row.supportedEffortLevels ? { efforts: sorted(row.supportedEffortLevels) } : {}),
    };
    if (row.value === "default") { preferred ??= model; continue; }
    const existing = models.get(resolved);
    if (!existing || (existing.id === resolved && row.value !== resolved)) models.set(resolved, model);
  }
  return preferred ? [preferred, ...models.values()] : [...models.values()];
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
    claude: z.array(z.object({ id, label, resolved: id.optional(), efforts: efforts.optional() }))
      .min(1).max(1000),
    codex: z.array(z.object({ id, label, efforts: efforts.min(1), fallback: id, minClient: z.string() }))
      .min(1).max(1000),
    providers: z.object({ claude: status, codex: status }),
  }).parse(raw);
}
