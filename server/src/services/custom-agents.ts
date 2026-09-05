import { prisma } from "../db";
import {
  activationOf, effortOf, effectiveAgents, detectCycle, maxTurnsOf, mentionsOf, toolsOf,
  runtimeOf, timeoutSecondsOf, workspacePolicyOf, expandTools, ALL_TOOLS, GLOBAL_SCOPE,
  BUILTIN_AGENTS, modelsForRuntime,
  type CustomAgent, type AgentNode, type Agent,
} from "@hanoman/shared";
import { codexNativeAgentsSupported, type AgentDef } from "@hanoman/runner";
import {
  collectChangedFiles, registerCodexNativeAgentSupport, registerCustomAgentSource,
  type AgentSelectionContext,
} from "./pty";
import { agentToolIds } from "./agent-tool-catalog";
import { seedBuiltinAgents } from "./builtin-agents";
import { _resetCodexVersionCache, getCodexVersion } from "./codex-version";

// SPEC-450 · ADR-0094 keputusan 7 · katalog custom agent untuk lapis proses.
//
// Cache WAJIB sinkron: `createSession` sinkron sementara Prisma tidak, dan definisi agen harus
// sudah ada saat argv dirakit — bukan sesaat sesudahnya. Pola yang sama dipakai `effectiveStr()`
// (config runtime, ADR-0049). `pty.ts` tetap nol dependensi DB: ia memanggil sumber yang
// mendaftarkan diri, dan karena `createSession` adalah pintu SATU-SATUNYA semua kelahiran sesi,
// tak ada call site yang bisa lupa memasangnya (kelas bug SPEC-431/ADR-0093).

/** Bentuk baris yang cukup untuk semua keputusan di berkas ini (bukan tipe Prisma penuh). */
export type CustomAgentRow = {
  id: string;
  projectId: string | null;
  name: string;
  description: string;
  instructions: string;
  tools: unknown;
  model: string | null;
  mentions: unknown;
  /** SPEC-484 · ADR-0101 · dibaca `runtimeOf` — nilai asing dari sync = null (warisi). */
  runtime: unknown;
  activation?: unknown;
  effort?: unknown;
  workspacePolicy?: unknown;
  maxTurns?: unknown;
  timeoutSeconds?: unknown;
  enabled: boolean;
};

export { collectChangedFiles };
export type { AgentSelectionContext };

export function selectAgentRows(
  rows: CustomAgentRow[],
  context: AgentSelectionContext,
): CustomAgentRow[] {
  return rows.filter((row) => {
    if (!row.enabled) return false;
    const runtime = runtimeOf(row.runtime);
    if (runtime !== null && runtime !== context.runtime) return false;
    if (workspacePolicyOf(row.workspacePolicy) === "isolated-worktree"
      && context.runtime !== "claude") return false;
    return true;
  });
}

let cache: CustomAgentRow[] = [];
let codexNativeSupport: { version: string | null; ok: boolean } = { version: null, ok: false };
let codexSupportRefreshTimer: NodeJS.Timeout | null = null;
let codexSupportRefreshTail: Promise<void> = Promise.resolve();
// SPEC-484 · ADR-0101 · repoDir per project untuk sumber MCP ber-scope project
// (`<repoDir>/.mcp.json`, `~/.claude.json` projects[<repoDir>]). Di-cache karena `agentDefsFor`
// SINKRON — ia dibaca dari `createSession`, sementara resolusi binding butuh DB. Di-refresh
// bersama katalog agen; binding yang berubah tanpa mutasi agen paling buruk membuat ekspansi `*`
// melewatkan server MCP ber-scope project sampai mutasi berikutnya.
let repoDirCache = new Map<string, string | null>();

export function currentCustomAgentRuntimeSupport(): { version: string | null; ok: boolean } {
  return { ...codexNativeSupport };
}

const asCustomAgent = (r: CustomAgentRow): CustomAgent => ({
  id: r.id, projectId: r.projectId, name: r.name,
  description: r.description, instructions: r.instructions,
  tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
  runtime: runtimeOf(r.runtime),
  activation: activationOf(r.activation), effort: effortOf(r.effort),
  workspacePolicy: workspacePolicyOf(r.workspacePolicy),
  maxTurns: maxTurnsOf(r.maxTurns), timeoutSeconds: timeoutSecondsOf(r.timeoutSeconds),
  enabled: r.enabled,
  createdAt: "", updatedAt: "",   // tak dipakai lapis ini
});

export function toDef(r: CustomAgentRow): AgentDef {
  return {
    id: r.id,
    name: r.name, description: r.description, instructions: r.instructions,
    tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
    activation: activationOf(r.activation), effort: effortOf(r.effort),
    workspacePolicy: workspacePolicyOf(r.workspacePolicy),
    maxTurns: maxTurnsOf(r.maxTurns), timeoutSeconds: timeoutSecondsOf(r.timeoutSeconds),
  };
}

function recommendedModel(row: CustomAgentRow, runtime: Agent): string | null {
  if (row.model) return row.model;
  if (row.projectId !== null) return null;
  const builtin = BUILTIN_AGENTS.find((agent) => agent.name === row.name);
  if (!builtin) return null;
  const model = builtin.models[runtime];
  if (runtime === "claude" && (model === "haiku" || model === "sonnet")) return model;
  return modelsForRuntime(runtime).some((entry) => entry.id === model) ? model : null;
}

function toRuntimeDef(row: CustomAgentRow, runtime: Agent): AgentDef {
  return { ...toDef(row), model: recommendedModel(row, runtime) };
}

/** Isi ulang cache dari DB. Dipanggil saat boot dan sesudah SETIAP mutasi (route & sync). */
export async function loadCustomAgents(): Promise<void> {
  try {
    cache = (await prisma.customAgent.findMany()) as unknown as CustomAgentRow[];
    // Binding per-mesin menang atas `Project.repoDir` — urutan yang sama dengan `resolveRepoDir`.
    const projects = await prisma.project.findMany({ select: { id: true, repoDir: true } });
    const bindings = await prisma.localBinding.findMany({ select: { projectId: true, repoDir: true } });
    const next = new Map<string, string | null>();
    for (const p of projects) next.set(p.id, p.repoDir ?? null);
    for (const b of bindings) next.set(b.projectId, b.repoDir ?? null);
    repoDirCache = next;
  } catch {
    // Katalog agen tak pernah boleh menggagalkan boot maupun kelahiran sesi (ADR-0094 keputusan 7).
    cache = [];
    repoDirCache = new Map();
  }
}

/** SINKRON — dibaca dari titik cekik `createSession`. */
export function agentDefsFor(context: AgentSelectionContext): AgentDef[];
export function agentDefsFor(projectId: string, agent: Agent): AgentDef[];
export function agentDefsFor(
  contextOrProjectId: AgentSelectionContext | string,
  legacyAgent?: Agent,
): AgentDef[] {
  const legacy = typeof contextOrProjectId === "string";
  const context: AgentSelectionContext = legacy
    ? {
      projectId: contextOrProjectId, runtime: legacyAgent ?? "claude", cwd: "",
      changedFiles: [],
    }
    : contextOrProjectId;
  const { projectId } = context;
  const globals = cache.filter((r) => r.projectId === null).map(asCustomAgent);
  const project = cache.filter((r) => r.projectId === projectId).map(asCustomAgent);
  const effectiveIds = new Set(effectiveAgents(globals, project).map((agent) => agent.id));
  const effectiveRows = cache.filter((row) => effectiveIds.has(row.id));
  // Semua definisi enabled + runtime/policy-compatible hidup sepanjang sesi. `activation=smart`
  // mengarahkan parent kapan mendelegasikan berdasarkan pekerjaan TERKINI; ia tidak boleh
  // membekukan capability dari flow/diff saat sesi lahir.
  const eff = legacy
    ? effectiveRows.filter((row) => row.enabled
      && (runtimeOf(row.runtime) === null || runtimeOf(row.runtime) === context.runtime)
      && !(workspacePolicyOf(row.workspacePolicy) === "isolated-worktree"
        && context.runtime !== "claude"))
    : selectAgentRows(effectiveRows, context);
  // Katalog hanya dihitung bila ada yang benar-benar memakai `*` — pembacaan berkas konfigurasi
  // tak perlu terjadi di setiap kelahiran sesi.
  const needsCatalog = eff.some((row) => (toolsOf(row.tools) ?? []).includes(ALL_TOOLS));
  const catalogIds = needsCatalog ? agentToolIds(repoDirCache.get(projectId) ?? null) : [];
  return eff.map((row) => {
    const a = asCustomAgent(row);
    return {
      ...toRuntimeDef(row, context.runtime),
    // Ekspansi terjadi DI SINI, sebelum `resolveTools` di runner: meneruskan `"*"` apa adanya
    // membuat claude membuangnya senyap (agen tanpa alat), sementara menerjemahkannya jadi `null`
    // membuat agen mewarisi SELURUH tool termasuk `Task` — lapis 2 anti-loop lenyap tanpa jejak.
      tools: expandTools(a.tools, catalogIds), mentions: a.mentions ?? [],
    };
  });
}

/**
 * ADR-0094 gotcha 2 · memeriksa graf global SAJA tidak cukup. Agen project boleh menimpa nama
 * global, jadi `g→h` yang asiklik di scope global bisa menjadi `g→h(project)→g` di dalam satu
 * project. Validasi berjalan atas scope global DAN setiap project yang punya custom agent.
 */
export function validateGraph(rows: CustomAgentRow[]): { scope: string; cycle: string[] } | null {
  const projectScopes = [...new Set(rows.map((r) => r.projectId).filter((p): p is string => p !== null))];
  const globals = rows.filter((r) => r.projectId === null).map(asCustomAgent);
  for (const scope of [null, ...projectScopes]) {
    const project = scope === null ? [] : rows.filter((r) => r.projectId === scope).map(asCustomAgent);
    const nodes: AgentNode[] = effectiveAgents(globals, project)
      .map((a) => ({ name: a.name, mentions: a.mentions ?? [] }));
    const cycle = detectCycle(nodes);
    if (cycle) return { scope: scope ?? GLOBAL_SCOPE, cycle };
  }
  return null;
}

/**
 * Nama di `mentions` yang tak terlihat dari scope si penyebut. Agen GLOBAL hanya boleh menyebut
 * agen global — kalau tidak, definisi global akan bergantung pada isi satu project dan tak lagi
 * bisa dipakai di project lain.
 */
export function unknownMentions(row: CustomAgentRow, all: CustomAgentRow[]): string[] {
  const visible = new Set(
    all
      .filter((r) => r.projectId === null || (row.projectId !== null && r.projectId === row.projectId))
      .map((r) => r.name),
  );
  return mentionsOf(row.mentions).filter((m) => !visible.has(m));
}

type CodexSupportProbe = () => Promise<string | null>;
const defaultCodexSupportProbe: CodexSupportProbe = async () => {
  _resetCodexVersionCache();
  return getCodexVersion();
};

/** Re-probe the exact host/image binary used by future sessions and publish atomically. */
export async function refreshCustomAgentRuntimeSupport(
  probe: CodexSupportProbe = defaultCodexSupportProbe,
): Promise<void> {
  // Timer dan config mutation dapat tiba bersamaan. Urutan queue adalah urutan permintaan, jadi
  // probe lama wajib selesai sebelum probe config terbaru memublikasikan nilai akhirnya.
  const refresh = codexSupportRefreshTail.then(async () => {
    const version = await probe();
    codexNativeSupport = { version, ok: codexNativeAgentsSupported(version) };
  });
  codexSupportRefreshTail = refresh.catch(() => {});
  return refresh;
}

/** Dipanggil sekali dari server.ts, sesudah config DB dimuat dan SEBELUM sesi pertama lahir. */
export async function installCustomAgents(): Promise<void> {
  // SPEC-881 · ADR-0136 · urutannya MENGIKAT: seed dulu, baru cache. Terbalik berarti sesi pertama
  // sesudah boot lahir tanpa agen bawaan — argv-nya sah, agennya cuma tak ada — dan gejalanya
  // hilang sendiri di boot berikutnya.
  await seedBuiltinAgents();
  await loadCustomAgents();
  await refreshCustomAgentRuntimeSupport();
  registerCodexNativeAgentSupport(() => codexNativeSupport);
  registerCustomAgentSource((context) => agentDefsFor(context));
  // Upgrade biner/image di tempat ikut terdeteksi tanpa restart. `unref` menjaga timer ini tidak
  // menahan shutdown/test; perubahan path via runtime config di-refresh langsung oleh config-apply.
  if (!codexSupportRefreshTimer) {
    codexSupportRefreshTimer = setInterval(() => {
      void refreshCustomAgentRuntimeSupport()
        .catch((error) => console.error("custom agent: probe Codex gagal:", error));
    }, 5 * 60_000);
    codexSupportRefreshTimer.unref();
  }
}
