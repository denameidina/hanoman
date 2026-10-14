import { bundledModelCatalog, replaceModelCatalog, type ModelCatalog } from "@hanoman/shared";

let catalog = bundledModelCatalog();
const listeners = new Set<() => void>();
export const modelCatalogSnapshot = () => catalog;
type LegacyModelCatalog = Omit<ModelCatalog, "antigravity" | "providers"> & {
  antigravity?: ModelCatalog["antigravity"];
  providers: Pick<ModelCatalog["providers"], "claude" | "codex"> & Partial<Pick<ModelCatalog["providers"], "antigravity">>;
};
export function installModelCatalog(next: LegacyModelCatalog): void {
  if (!next?.claude?.length || !next?.codex?.length || !next.providers) return;
  if (next.antigravity && !next.antigravity.length) return;
  const bundled = bundledModelCatalog();
  catalog = { ...next, antigravity: next.antigravity ?? bundled.antigravity,
    providers: { ...next.providers, antigravity: next.providers.antigravity ?? bundled.providers.antigravity } };
  replaceModelCatalog(catalog.claude, catalog.codex, catalog.antigravity);
  for (const listener of listeners) listener();
}
export function subscribeModelCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
