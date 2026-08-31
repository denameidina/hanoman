import { z } from "zod";

// SPEC-450 · ADR-0094 · kontrak murni custom agent. Nol I/O: dipakai server (validasi + resolusi
// scope), runner (render argv/prompt), dan UI (bentuk form) dari satu sumber.

/**
 * SPEC-484 · ADR-0101 · mesin sesi (ADR-0074) sebagai PENYARING di definisi agen.
 * Tinggal DI SINI, bukan di `agent-catalog.ts`, karena `runtime` adalah bagian kontrak custom
 * agent sementara katalog membutuhkan `DEFAULT_AGENT_TOOLS` dari berkas ini — menaruhnya di sana
 * membuat impor melingkar, dan konstanta yang dibaca saat modul dievaluasi jadi `undefined`.
 */
export const AGENT_RUNTIMES = ["claude", "codex"] as const;
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number];
export const zAgentRuntime = z.enum(AGENT_RUNTIMES);

export const AGENT_RUNTIME_LABELS: Record<AgentRuntime, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
};

export const AGENT_ACTIVATIONS = ["always", "smart"] as const;
export type AgentActivation = (typeof AGENT_ACTIVATIONS)[number];
export const zAgentActivation = z.enum(AGENT_ACTIVATIONS);

export const AGENT_WORKSPACE_POLICIES = ["inherit", "read-only", "isolated-worktree"] as const;
export type AgentWorkspacePolicy = (typeof AGENT_WORKSPACE_POLICIES)[number];
export const zAgentWorkspacePolicy = z.enum(AGENT_WORKSPACE_POLICIES);

/** Slug nama agen. Nama adalah KUNCI objek `--agents` claude, jadi ia harus aman & stabil. */
export const AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * ADR-0094 keputusan 6 · KONSTANTA MODUL, bukan konfigurasi (pola LEAD_ACTIONS, ADR-0091).
 * SENGAJA tanpa `Task`: itulah yang membuat agen daun tak punya alat memanggil siapa pun.
 * Aman terhadap gotcha M4 — nama tool yang tak dikenal versi claude dibuang SENYAP, dan membuang
 * hanya mengurangi kemampuan; tak ada jalan bagi konstanta basi untuk memberikan `Task`.
 */
export const DEFAULT_AGENT_TOOLS = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch",
] as const;

/** Alat delegasi claude. Terukur (ADR-0094 M2): tanpa ini agen tak bisa memanggil agen lain. */
export const MENTION_TOOL = "Task";

/** Anggaran hop lapis 3 (prosa). Bukan jaminan — jaminannya lapis 1 & 2. */
export const MENTION_MAX_HOPS = 3;

/** Scope global memakai literal ini di `id` (bukan string kosong: id harus terbaca manusia). */
export const GLOBAL_SCOPE = "global";

export const zCustomAgent = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  name: z.string().regex(AGENT_NAME_RE),
  description: z.string(),
  instructions: z.string(),
  tools: z.array(z.string()).nullable(),
  model: z.string().nullable(),
  mentions: z.array(z.string()).nullable(),
  runtime: z.enum(AGENT_RUNTIMES).nullable(),
  activation: zAgentActivation.default("always"),
  effort: z.string().nullable().default(null),
  workspacePolicy: zAgentWorkspacePolicy.default("inherit"),
  maxTurns: z.number().int().min(1).max(200).nullable().default(null),
  timeoutSeconds: z.number().int().min(30).max(3600).nullable().default(null),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomAgent = z.infer<typeof zCustomAgent>;

const zCreateCustomAgentFields = z.object({
  projectId: z.string().nullable().optional(),
  name: z.string().regex(AGENT_NAME_RE),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(20_000),
  tools: z.array(z.string()).nullable().optional(),
  model: z.string().nullable().optional(),
  mentions: z.array(z.string()).nullable().optional(),
  // SPEC-484 · ADR-0101 · PENYARING mesin sesi, bukan pemilih proses. null/absen = ikut sesi induk.
  runtime: z.enum(AGENT_RUNTIMES).nullable().optional(),
  activation: zAgentActivation.optional(),
  effort: z.string().trim().min(1).max(50).nullable().optional(),
  workspacePolicy: zAgentWorkspacePolicy.optional(),
  maxTurns: z.number().int().min(1).max(200).nullable().optional(),
  timeoutSeconds: z.number().int().min(30).max(3600).nullable().optional(),
  enabled: z.boolean().optional(),
});

function validateCreateWorkspacePolicy(
  value: { runtime?: AgentRuntime | null; workspacePolicy?: AgentWorkspacePolicy },
  ctx: z.RefinementCtx,
) {
  if (value.workspacePolicy === "isolated-worktree" && value.runtime !== "claude") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["workspacePolicy"],
      message: "isolated-worktree hanya tersedia untuk Claude Code",
    });
  }
}

export const zCreateCustomAgent = zCreateCustomAgentFields.superRefine(validateCreateWorkspacePolicy);
export type CreateCustomAgent = z.infer<typeof zCreateCustomAgent>;

// `name` & `projectId` DIBUANG dari payload update: id diturunkan dari keduanya, dan changefeed
// sync tak punya operasi hapus — rename yang mengubah id meninggalkan baris yatim di setiap mesin
// lain (ADR-0094 keputusan 2). Ganti nama = hapus + buat baru.
export const zUpdateCustomAgent = zCreateCustomAgentFields
  .omit({ name: true, projectId: true })
  .partial()
  .superRefine((value, ctx) => {
    if (value.workspacePolicy === "isolated-worktree"
      && value.runtime !== undefined && value.runtime !== "claude") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspacePolicy"],
        message: "isolated-worktree hanya tersedia untuk Claude Code",
      });
    }
  });
export type UpdateCustomAgent = z.infer<typeof zUpdateCustomAgent>;

export const customAgentId = (projectId: string | null, name: string): string =>
  `${projectId ?? GLOBAL_SCOPE}:${name}`;

/** Kolom `Json` menyeberang lewat sync dari client versi lain → dibaca defensif. */
export function mentionsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && x && !out.includes(x)) out.push(x);
  return out;
}

/**
 * Kolom ini menyeberang sync dari client versi lain. Nilai asing dibaca sebagai `null` (warisi) —
 * katalog persona tak pernah boleh menyusut habis karena satu string yang tak dikenal.
 */
export function runtimeOf(v: unknown): AgentRuntime | null {
  return typeof v === "string" && (AGENT_RUNTIMES as readonly string[]).includes(v)
    ? (v as AgentRuntime)
    : null;
}

export function activationOf(v: unknown): AgentActivation {
  return typeof v === "string" && (AGENT_ACTIVATIONS as readonly string[]).includes(v)
    ? (v as AgentActivation)
    : "always";
}

export function workspacePolicyOf(v: unknown): AgentWorkspacePolicy {
  return typeof v === "string" && (AGENT_WORKSPACE_POLICIES as readonly string[]).includes(v)
    ? (v as AgentWorkspacePolicy)
    : "inherit";
}

export function effortOf(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= 50 ? v : null;
}

export function maxTurnsOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 200 ? v : null;
}

export function timeoutSecondsOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 30 && v <= 3600 ? v : null;
}

/**
 * `tools` punya TIGA nilai yang wajib tetap berbeda (ADR-0101 keputusan 4):
 * `null` = "tak diisi" (pakai DEFAULT) · `[]` = "sengaja kosong" (agen tanpa tool sama sekali) ·
 * `["*"]` = "semua tool yang dikenal katalog", di-expand `expandTools()` sebelum materialisasi.
 */
export function toolsOf(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && x && !out.includes(x)) out.push(x);
  return out;
}

/**
 * ADR-0094 keputusan 5 lapis 2 · `Task` diturunkan dari `mentions`, BUKAN dari ketikan operator.
 * `Task` yang diketik operator DICABUT saat mentions kosong: allowlist yang menang, bukan daftar
 * tool. hanoman selalu memancarkan tools eksplisit — agen tanpa `tools` mewarisi SELURUH tool
 * termasuk `Task`, dan lapis ini akan lenyap tanpa jejak.
 */
export function resolveTools(a: { tools?: string[] | null; mentions?: string[] | null }): string[] {
  const base = a.tools ?? [...DEFAULT_AGENT_TOOLS];
  const canMention = (a.mentions ?? []).length > 0;
  const out = base.filter((t) => t !== MENTION_TOOL);
  if (canMention) out.push(MENTION_TOOL);
  return out;
}

/**
 * Bentuk yang dikirim `/api/custom-agents`. `inherited` HANYA muncul saat diminta per-project
 * (true = baris global yang berlaku di sana, read-only dari permukaan project). `createdAt`/
 * `updatedAt` sengaja tak ikut: UI tak memakainya, dan panel ini bukan halaman audit.
 */
export type CustomAgentView = {
  id: string;
  projectId: string | null;
  name: string;
  description: string;
  instructions: string;
  tools: string[] | null;
  model: string | null;
  mentions: string[];
  /** SPEC-484 · ADR-0101 · null = ikut sesi induk (dipakai sesi claude MAUPUN codex). */
  runtime: AgentRuntime | null;
  activation: AgentActivation;
  effort: string | null;
  workspacePolicy: AgentWorkspacePolicy;
  maxTurns: number | null;
  timeoutSeconds: number | null;
  enabled: boolean;
  /**
   * SPEC-881 · ADR-0136 · DITURUNKAN di lapis response, BUKAN kolom. Kolom baru berarti kolom baru
   * di changefeed sync, dan hub versi lama menolak SELURUH push yang membawanya (kelas SPEC-880).
   * Pola yang sama dengan `inherited` di bawah.
   */
  builtin?: boolean;
  /** Isi baris tak lagi cocok dengan sidik jari yang terakhir ditulis seed DI MESIN INI. */
  builtinEdited?: boolean;
  /** Turunan runtime/policy; enabled tetap berarti preferensi operator. */
  available?: boolean;
  availabilityReason?: string;
  inherited?: boolean;
};

export type AgentNode = { name: string; mentions: string[] };

export const AGENT_DISPOSITIONS = [
  "pending", "accepted", "partial", "rejected", "false-positive",
] as const;
export type AgentDisposition = (typeof AGENT_DISPOSITIONS)[number];

export type AgentInvocationView = {
  id: string; sessionId: string; projectId: string; specId: string | null;
  runtime: AgentRuntime; customAgentId: string | null; agentName: string; model: string | null;
  status: string; startedAt: string; endedAt: string | null; durationMs: number | null;
  inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null;
  resultExcerpt: string | null; resultHash: string | null; workspaceChanged: boolean;
  disposition: AgentDisposition; dispositionNote: string | null; evaluatedAt: string | null;
};

export type AgentDispositionCounts = {
  pending: number; accepted: number; partial: number; rejected: number; falsePositive: number;
};

export type AgentMetricView = {
  agentName: string; invocationCount: number; medianDurationMs: number | null;
  inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null;
  dispositions: AgentDispositionCounts; operationalPrecision: number | null;
  workspaceChanged: boolean;
};

export type AgentMetricsView = { agents: AgentMetricView[]; recent: AgentInvocationView[] };

/**
 * DFS berwarna. Mengembalikan jalur siklus (`["a","b","a"]`) atau null. Mention ke nama yang tak
 * ada diabaikan — validasi rujukan tugas lapis route, bukan lapis graf.
 */
export function detectCycle(nodes: AgentNode[]): string[] | null {
  const edges = new Map(nodes.map((n) => [n.name, n.mentions] as const));
  const state = new Map<string, 0 | 1 | 2>(); // 0 belum · 1 di stack · 2 selesai
  const stack: string[] = [];

  const walk = (name: string): string[] | null => {
    if (state.get(name) === 1) return [...stack.slice(stack.indexOf(name)), name];
    if (state.get(name) === 2) return null;
    state.set(name, 1);
    stack.push(name);
    for (const next of edges.get(name) ?? []) {
      if (!edges.has(next)) continue;
      const found = walk(next);
      if (found) return found;
    }
    stack.pop();
    state.set(name, 2);
    return null;
  };

  for (const n of nodes) {
    const found = walk(n.name);
    if (found) return found;
  }
  return null;
}

/**
 * Himpunan efektif untuk satu project: global ∪ project, project MENIMPA global bernama sama.
 * Urutan operasinya mengikat: menimpa dulu, MENYARING `enabled` belakangan — jadi agen project
 * yang dimatikan MENYEMBUNYIKAN global bernama sama (itu caranya mematikan agen global di satu
 * project). Urutan keluaran diurutkan nama agar argv & roster deterministik (test kontrak argv
 * membandingkan string).
 */
export function effectiveAgents(globals: CustomAgent[], project: CustomAgent[]): CustomAgent[] {
  const byName = new Map<string, CustomAgent>();
  for (const a of globals) byName.set(a.name, a);
  for (const a of project) byName.set(a.name, a);
  return [...byName.values()]
    .filter((a) => a.enabled)
    .sort((x, y) => x.name.localeCompare(y.name));
}
