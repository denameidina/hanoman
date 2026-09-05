import { bundledModelCatalog, replaceModelCatalog, type ModelCatalog } from "@hanoman/shared";

let catalog = bundledModelCatalog();
const listeners = new Set<() => void>();
export const modelCatalogSnapshot = () => catalog;
export function installModelCatalog(next: ModelCatalog): void {
  if (!next?.claude?.length || !next?.codex?.length || !next.providers) return;
  replaceModelCatalog(next.claude, next.codex);
  catalog = next;
  for (const listener of listeners) listener();
}
export function subscribeModelCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
