import { prisma } from "../db";
import {
  activationOf, effortOf, effectiveAgents, detectCycle, maxTurnsOf, mentionsOf, toolsOf,
  runtimeOf, timeoutSecondsOf, workspacePolicyOf, expandTools, ALL_TOOLS, GLOBAL_SCOPE,
  type CustomAgent, type AgentNode, type Agent,
} from "@hanoman/shared";
import type { AgentDef } from "@hanoman/runner";
import { registerCustomAgentSource } from "./pty";
import { agentToolIds } from "./agent-tool-catalog";
import { seedBuiltinAgents } from "./builtin-agents";

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

let cache: CustomAgentRow[] = [];
// SPEC-484 · ADR-0101 · repoDir per project untuk sumber MCP ber-scope project
// (`<repoDir>/.mcp.json`, `~/.claude.json` projects[<repoDir>]). Di-cache karena `agentDefsFor`
// SINKRON — ia dibaca dari `createSession`, sementara resolusi binding butuh DB. Di-refresh
// bersama katalog agen; binding yang berubah tanpa mutasi agen paling buruk membuat ekspansi `*`
// melewatkan server MCP ber-scope project sampai mutasi berikutnya.
let repoDirCache = new Map<string, string | null>();

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
    name: r.name, description: r.description, instructions: r.instructions,
    tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
    activation: activationOf(r.activation), effort: effortOf(r.effort),
    workspacePolicy: workspacePolicyOf(r.workspacePolicy),
    maxTurns: maxTurnsOf(r.maxTurns), timeoutSeconds: timeoutSecondsOf(r.timeoutSeconds),
  };
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
export function agentDefsFor(projectId: string, agent: Agent): AgentDef[] {
  const globals = cache.filter((r) => r.projectId === null).map(asCustomAgent);
  const project = cache.filter((r) => r.projectId === projectId).map(asCustomAgent);
  // SPEC-484 · ADR-0101 keputusan 2 · penyaring: null = ikut sesi induk (dipakai KEDUA mesin).
  const eff = effectiveAgents(globals, project)
    .filter((a) => a.runtime === null || a.runtime === agent);
  // Katalog hanya dihitung bila ada yang benar-benar memakai `*` — pembacaan berkas konfigurasi
  // tak perlu terjadi di setiap kelahiran sesi.
  const needsCatalog = eff.some((a) => (a.tools ?? []).includes(ALL_TOOLS));
  const catalogIds = needsCatalog ? agentToolIds(repoDirCache.get(projectId) ?? null) : [];
  return eff.map((a) => ({
    name: a.name, description: a.description, instructions: a.instructions,
    // Ekspansi terjadi DI SINI, sebelum `resolveTools` di runner: meneruskan `"*"` apa adanya
    // membuat claude membuangnya senyap (agen tanpa alat), sementara menerjemahkannya jadi `null`
    // membuat agen mewarisi SELURUH tool termasuk `Task` — lapis 2 anti-loop lenyap tanpa jejak.
    tools: expandTools(a.tools, catalogIds), model: a.model, mentions: a.mentions ?? [],
    activation: a.activation, effort: a.effort, workspacePolicy: a.workspacePolicy,
    maxTurns: a.maxTurns, timeoutSeconds: a.timeoutSeconds,
  }));
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

/** Dipanggil sekali dari server.ts, SEBELUM sesi pertama bisa lahir. */
export async function installCustomAgents(): Promise<void> {
  // SPEC-881 · ADR-0136 · urutannya MENGIKAT: seed dulu, baru cache. Terbalik berarti sesi pertama
  // sesudah boot lahir tanpa agen bawaan — argv-nya sah, agennya cuma tak ada — dan gejalanya
  // hilang sendiri di boot berikutnya.
  await seedBuiltinAgents();
  await loadCustomAgents();
  registerCustomAgentSource((projectId, agent) => agentDefsFor(projectId, agent));
}
