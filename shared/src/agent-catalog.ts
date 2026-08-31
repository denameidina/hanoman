import { DEFAULT_AGENT_TOOLS, type AgentEffort, type AgentRuntime } from "./custom-agent";
import { MODELS, EFFORTS, CODEX_MODELS } from "./entities";

// SPEC-484 · ADR-0101 · katalog pilihan form Custom Agent. Nol I/O: dipakai server (validasi +
// ekspansi `*`) dan UI (opsi dropdown) dari SATU sumber. Bagian yang butuh I/O — penemuan server
// MCP dari berkas konfigurasi — hidup di server (`services/agent-tool-catalog.ts`).
//
// Impor SATU ARAH: berkas ini membaca `custom-agent.ts`, tak pernah sebaliknya. `AGENT_RUNTIMES`
// karena itu tinggal di sana — melingkarkannya membuat `DEFAULT_AGENT_TOOLS` terbaca `undefined`
// saat modul dievaluasi, dan gejalanya "Cannot read properties of undefined", bukan galat impor.

/**
 * Pintasan "semua tools". Disimpan sebagai `tools: ["*"]` — SENGAJA bukan `null`, sebab tiga
 * nilai ini wajib tetap berbeda: `null` = tak diisi (pakai DEFAULT_AGENT_TOOLS) · `[]` = sengaja
 * tanpa tool · `["*"]` = semua tool yang dikenal katalog.
 */
export const ALL_TOOLS = "*";

export type AgentToolInfo = { id: string; label: string; group: "shortcut" | "builtin" | "mcp" };

export const ALL_TOOLS_ENTRY: AgentToolInfo = {
  id: ALL_TOOLS, label: "Semua tools", group: "shortcut",
};

/**
 * ADR-0101 keputusan 3 · katalog bawaan PERSIS `DEFAULT_AGENT_TOOLS`, bukan daftar kedua yang
 * lebih panjang. ADR-0094 M4 mengukur nama tool tak dikenal DIBUANG claude tanpa satu pun pesan,
 * jadi menawarkan nama yang belum diukur berarti menawarkan pilihan yang tidak melakukan apa-apa.
 * `Task` tak pernah di sini: ia diturunkan dari `mentions` (lapis 2 anti-loop).
 */
export const BUILTIN_AGENT_TOOLS: AgentToolInfo[] = DEFAULT_AGENT_TOOLS.map((id) => ({
  id, label: id, group: "builtin" as const,
}));

/**
 * Satu entri per SERVER MCP. Nama tool aslinya hanya bisa diketahui dengan menyambung ke server
 * (= melahirkan proses, arah yang ditolak ADR-0094), sementara claude sendiri mengeja bentuk
 * "semua tool dari satu server" sebagai `mcp__<server>__*`.
 */
export const mcpToolEntry = (server: string): AgentToolInfo => ({
  id: `mcp__${server}__*`, label: `${server} — semua tool`, group: "mcp",
});

export type AgentModelInfo = { id: string; label: string; runtime: AgentRuntime };

/** Model yang sah untuk sebuah runtime. `null` (warisi) → GABUNGAN keduanya. */
export function modelsForRuntime(rt: AgentRuntime | null): AgentModelInfo[] {
  const claude: AgentModelInfo[] = MODELS.map((m) => ({ id: m.id, label: m.label, runtime: "claude" }));
  const codex: AgentModelInfo[] = CODEX_MODELS.map((m) => ({ id: m.id, label: m.label, runtime: "codex" }));
  if (rt === "claude") return claude;
  if (rt === "codex") return codex;
  return [...claude, ...codex];
}

const codexCommonEfforts = (): AgentEffort[] => {
  const first = CODEX_MODELS[0]?.efforts ?? [];
  return first.filter((effort) => CODEX_MODELS.every((model) => model.efforts.includes(effort))) as AgentEffort[];
};

/** Effort yang sah untuk pasangan runtime/model; warisan ambigu memakai irisan kedua runtime. */
export function effortsForRuntimeModel(
  runtime: AgentRuntime | null,
  model: string | null,
): AgentEffort[] {
  if (runtime === "claude" || (!runtime && model && MODELS.some((entry) => entry.id === model))) {
    return [...EFFORTS] as AgentEffort[];
  }
  const codexModel = model ? CODEX_MODELS.find((entry) => entry.id === model) : undefined;
  if (runtime === "codex" || codexModel) {
    return [...(codexModel?.efforts ?? codexCommonEfforts())] as AgentEffort[];
  }
  const codex = new Set(codexCommonEfforts());
  return EFFORTS.filter((effort) => codex.has(effort as AgentEffort)) as AgentEffort[];
}

/**
 * `["*"]` → seluruh id katalog; selain itu apa adanya. Idempoten (katalog tak pernah memuat `*`).
 * Dipanggil SEBELUM `resolveTools` — meneruskan `"*"` apa adanya membuat claude membuangnya
 * senyap, sementara menerjemahkannya jadi `null` membuat agen mewarisi SELURUH tool termasuk
 * `Task` dan lapis 2 anti-loop lenyap tanpa jejak (gotcha 5 ADR-0094).
 */
export function expandTools(tools: string[] | null, catalogIds: string[]): string[] | null {
  if (tools === null) return null;
  if (!tools.includes(ALL_TOOLS)) return tools;
  return catalogIds.filter((id) => id !== ALL_TOOLS);
}

export type AgentCatalogView = {
  tools: AgentToolInfo[];
  models: AgentModelInfo[];
  runtimes: { id: AgentRuntime; label: string }[];
};
