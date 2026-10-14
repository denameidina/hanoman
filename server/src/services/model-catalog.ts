import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveHome } from "@hanoman/runner";
import {
  bundledModelCatalog, replaceModelCatalog, type ModelCatalog, type ClaudeModel, type CodexModel, type AntigravityModel, type Agent,
} from "@hanoman/shared";
import { parseCachedCatalog } from "./model-catalog-parser";
import { catalogProbeKey, probeModelCatalog } from "./model-catalog-probe";
import { RuntimeLaunchError } from "./session-sandbox";

type CatalogDeps = {
  probe: (agent: Agent) => Promise<readonly ClaudeModel[] | readonly CodexModel[] | readonly AntigravityModel[]>;
  read: () => Promise<unknown>;
  write: (catalog: ModelCatalog, current?: () => boolean) => Promise<void>;
  now: () => number;
  install?: (catalog: ModelCatalog) => void;
  key?: () => string;
};
export function createModelCatalogService(deps: CatalogDeps) {
  let state = bundledModelCatalog();
  let initialized = false;
  let inflight: Promise<ModelCatalog> | null = null;
  let inflightKey: string | undefined;
  let generation = 0;
  const publish = () => { deps.install?.(state); };
  async function refresh(): Promise<ModelCatalog> {
    const key = deps.key?.();
    if (inflight && inflightKey === key) return inflight;
    inflightKey = key;
    const currentGeneration = ++generation;
    const current = () => currentGeneration === generation && key === deps.key?.();
    const operation = (async () => {
      if (!initialized) {
        initialized = true;
        try {
          const cached = parseCachedCatalog(await deps.read());
          if (!current()) return state;
          state = cached;
          for (const agent of ["claude", "codex", "antigravity"] as const) {
            if (state.providers[agent].updatedAt) state.providers[agent].source = "cache";
          }
          publish();
        } catch { /* Missing or invalid cache uses the bundled catalog. */ }
      }
      for (const agent of ["claude", "codex", "antigravity"] as const) {
        if (!current()) return state;
        const checkedAt = new Date(deps.now()).toISOString();
        try {
          const models = await deps.probe(agent);
          if (!current()) return state;
          if (!models.length) throw new Error("empty catalog");
          // CLI yang terpasang adalah sumber RESMI begitu ia berhasil menjawab — bukan digabung
          // selamanya dengan katalog bawaan statis. Katalog bawaan hanya dipakai sebelum probe
          // pertama sukses atau saat probe gagal (lihat cabang catch di bawah); union permanen
          // membuat id lama yang sudah diganti CLI (mis. model dipensiunkan/direname) tak pernah
          // hilang dari picker walau CLI tak menyebutnya lagi.
          state = agent === "claude"
            ? { ...state, claude: models as readonly ClaudeModel[] }
            : agent === "codex" ? { ...state, codex: models as readonly CodexModel[] }
            : { ...state, antigravity: models as readonly AntigravityModel[] };
          state = { ...state, providers: { ...state.providers, [agent]: {
            source: "cli", checkedAt, updatedAt: checkedAt, error: null,
          } } };
        } catch (error) {
          if (!current()) return state;
          state = { ...state, providers: { ...state.providers, [agent]: {
            ...state.providers[agent], checkedAt,
            error: error instanceof RuntimeLaunchError ? error.message
              : "Katalog CLI belum dapat diperbarui; menggunakan daftar terakhir.",
          } } };
        }
        publish();
      }
      if (!current()) return state;
      try { await deps.write(state, current); }
      catch {
        if (!current()) return state;
        state = { ...state, providers: Object.fromEntries(
          Object.entries(state.providers).map(([agent, status]) =>
            [agent, { ...status, error: status.error ?? "Cache model tidak dapat disimpan." }]),
        ) as ModelCatalog["providers"] };
        publish();
      }
      return state;
    })().finally(() => { if (inflight === operation) inflight = null; });
    inflight = operation;
    return operation;
  }
  return { snapshot: () => state, refresh };
}

export async function writeModelCatalogCache(file: string, catalog: ModelCatalog, current = () => true): Promise<void> {
  const sanitized = parseCachedCatalog(catalog);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(sanitized), { mode: 0o600, flag: "wx" });
    if (current()) await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}

const cacheFile = () => join(resolveHome(), "model-catalog.json");
export const modelCatalogService = createModelCatalogService({
  probe: probeModelCatalog,
  key: catalogProbeKey,
  read: async () => {
    const content = await readFile(cacheFile(), "utf8");
    if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new Error("oversized cache");
    return JSON.parse(content);
  },
  write: (catalog, current) => writeModelCatalogCache(cacheFile(), catalog, current),
  now: Date.now,
  install: (catalog) => replaceModelCatalog(catalog.claude, catalog.codex, catalog.antigravity),
});

export function startModelDiscovery(): () => void {
  void modelCatalogService.refresh();
  const timer = setInterval(() => { void modelCatalogService.refresh(); }, 5 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
