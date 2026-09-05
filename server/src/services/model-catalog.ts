import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveHome } from "@hanoman/runner";
import {
  bundledModelCatalog, replaceModelCatalog, type ModelCatalog, type ClaudeModel, type CodexModel,
} from "@hanoman/shared";
import { parseCachedCatalog } from "./model-catalog-parser";
import { probeModelCatalog } from "./model-catalog-probe";

type Agent = "claude" | "codex";
type CatalogDeps = {
  probe: (agent: Agent) => Promise<readonly ClaudeModel[] | readonly CodexModel[]>;
  read: () => Promise<unknown>;
  write: (catalog: ModelCatalog) => Promise<void>;
  now: () => number;
  install?: (catalog: ModelCatalog) => void;
};
const merge = <T extends { id: string }>(old: readonly T[], fresh: readonly T[]): T[] =>
  [...new Map([...old, ...fresh].map((m) => [m.id, m])).values()];

export function createModelCatalogService(deps: CatalogDeps) {
  let state = bundledModelCatalog();
  let initialized = false;
  let inflight: Promise<ModelCatalog> | null = null;
  const publish = () => { deps.install?.(state); };
  async function refresh(): Promise<ModelCatalog> {
    if (inflight) return inflight;
    inflight = (async () => {
      if (!initialized) {
        initialized = true;
        try {
          state = parseCachedCatalog(await deps.read());
          for (const agent of ["claude", "codex"] as const) {
            if (state.providers[agent].updatedAt) state.providers[agent].source = "cache";
          }
          publish();
        } catch { /* Missing or invalid cache uses the bundled catalog. */ }
      }
      for (const agent of ["claude", "codex"] as const) {
        const checkedAt = new Date(deps.now()).toISOString();
        try {
          const models = await deps.probe(agent);
          if (!models.length) throw new Error("empty catalog");
          state = agent === "claude"
            ? { ...state, claude: merge(bundledModelCatalog().claude, models as readonly ClaudeModel[]) }
            : { ...state, codex: merge(bundledModelCatalog().codex, models as readonly CodexModel[]) };
          state = { ...state, providers: { ...state.providers, [agent]: {
            source: "cli", checkedAt, updatedAt: checkedAt, error: null,
          } } };
        } catch {
          state = { ...state, providers: { ...state.providers, [agent]: {
            ...state.providers[agent], checkedAt,
            error: "Katalog CLI belum dapat diperbarui; menggunakan daftar terakhir.",
          } } };
        }
        publish();
      }
      try { await deps.write(state); }
      catch {
        state = { ...state, providers: Object.fromEntries(
          Object.entries(state.providers).map(([agent, status]) =>
            [agent, { ...status, error: status.error ?? "Cache model tidak dapat disimpan." }]),
        ) as ModelCatalog["providers"] };
        publish();
      }
      return state;
    })().finally(() => { inflight = null; });
    return inflight;
  }
  return { snapshot: () => state, refresh };
}

const cacheFile = () => join(resolveHome(), "model-catalog.json");
export const modelCatalogService = createModelCatalogService({
  probe: probeModelCatalog,
  read: async () => {
    const content = await readFile(cacheFile(), "utf8");
    if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new Error("oversized cache");
    return JSON.parse(content);
  },
  write: async (catalog) => {
    const file = cacheFile();
    await mkdir(dirname(file), { recursive: true });
    const temp = file + "." + process.pid + ".tmp";
    await writeFile(temp, JSON.stringify(catalog), { mode: 0o600 });
    await rename(temp, file);
  },
  now: Date.now,
  install: (catalog) => replaceModelCatalog(catalog.claude, catalog.codex),
});

export function startModelDiscovery(): () => void {
  void modelCatalogService.refresh();
  const timer = setInterval(() => { void modelCatalogService.refresh(); }, 5 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
