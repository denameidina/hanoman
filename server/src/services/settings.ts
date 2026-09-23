import { prisma } from "../db";
import {
  zSetting, SCHEDULER_DEFAULTS, GOAL_DEFAULTS, CODEX_DEFAULTS, CONFLICT_DEFAULTS,
  RETIRED_CODEX_MODELS, LEAD_DEFAULTS, coerceCodexEffort, codexModel, type Setting, type Agent, type Codex,
  type Orchestration, type PhaseOverrides,
  TELEGRAM_DEFAULTS, CHANGELOG_ENGINE_DEFAULTS, DEFAULT_METHOD, PORTAL_CHAT_DEFAULTS, ORCHESTRATION_DEFAULTS,
  REMOTE_CONTROL_DEFAULTS, LOG_SHIPPING_DEFAULTS, LOG_RETENTION_DEFAULTS,
  BUILTIN_RUNTIME_DEFAULTS,
} from "@hanoman/shared";

// Model id + effort yang diteruskan apa adanya ke `claude --model` / `--effort`.
const STEP = { model: "sonnet", effort: "medium" };
// DB yang masih segar belum punya baris Setting (ia lahir di PUT /settings pertama). Default
// ini menjaga API tetap boot alih-alih melempar P2025.
export const DEFAULT_SETTING: Setting = {
  ...STEP,
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false,   // SPEC-257 · akses AI agent off sampai dibuka manusia
  scheduler: SCHEDULER_DEFAULTS,   // SPEC-294 · ADR-0072 · semua knob scheduler default mati
  goal: GOAL_DEFAULTS,             // SPEC-332 · ADR-0073 · mode goal default mati
  agent: "claude",                 // SPEC-338 · ADR-0074 · mesin sesi default
  codex: CODEX_DEFAULTS,           // SPEC-338 · ADR-0074 · model/effort codex
  verifyScope: "changed",          // SPEC-376 · ADR-0080 · uji hanya yang berubah
  method: DEFAULT_METHOD,          // SPEC-734 · ADR-0113 · metode workflow default
  conflict: CONFLICT_DEFAULTS,     // SPEC-383 · ADR-0081 · default sesi konflik (opt-in, mati)
  lead: LEAD_DEFAULTS,             // SPEC-409 · ADR-0091 · hanoman-lead (master switch mati)
  telegram: TELEGRAM_DEFAULTS,     // SPEC-476 · ADR-0096 · gateway Telegram opt-in
  changelog: CHANGELOG_ENGINE_DEFAULTS, // SPEC-518 · agen pembuat changelog (opt-in, mati)
  portalChat: PORTAL_CHAT_DEFAULTS, // SPEC-854 · ADR-0130 · chat portal klien (opt-in, mati)
  orchestration: ORCHESTRATION_DEFAULTS, // ADR-0164 · orkestrasi subagent per fase (default aktif)
  remoteControl: REMOTE_CONTROL_DEFAULTS, // SPEC-1215 · ADR-0165 · grant LOCAL-only, default mati
  logShipping: LOG_SHIPPING_DEFAULTS,     // SPEC-1215 · ADR-0166
  logRetention: LOG_RETENTION_DEFAULTS,   // SPEC-1215 · ADR-0166
  builtinAgents: {},               // SPEC-881 · ADR-0136 · sidik jari seed (lokal, tak disync)
  builtinAgentPolicies: {},        // SPEC-950 · marker safety policy sekali-jalan (lokal)
  builtinRuntimeDefaults: BUILTIN_RUNTIME_DEFAULTS, // seed rekomendasi model/fase; user edit dipertahankan
};

// Baris Setting adalah `Json` bebas bentuk, dan baris yang ditulis SEBELUM SPEC-162 masih
// menyimpan `steps`/`maxConcurrent`/`askTimeoutMin` tanpa `model` maupun `effort`. Dikembalikan
// mentah, `s.model` di UI menjadi undefined dan sesi lahir dengan `claude --model undefined`.
// `.parse` mengisi default untuk kunci yang hilang; bentuk yang benar-benar rusak jatuh ke
// DEFAULT_SETTING, bukan melempar dan membuat layar Settings kosong.
export async function getSetting(): Promise<Setting> {
  const raw = (await prisma.setting.findUnique({ where: { id: 1 } }))?.data;
  if (raw === undefined || raw === null) return DEFAULT_SETTING;
  const parsed = zSetting.safeParse(raw);
  if (!parsed.success) return DEFAULT_SETTING;
  return {
    ...parsed.data,
    model: RETIRED_MODELS[parsed.data.model] ?? parsed.data.model,
    codex: normalizeCodex(parsed.data.codex),
    orchestration: normalizeOrchestration(parsed.data.orchestration),
  };
}

// S6 · pola `model`/`normalizeCodex` diperluas ke model subagent fase. `null` = warisi orchestrator
// dan dibiarkan; effort codex dikoersi hanya bila modelnya sendiri diketahui (sel yang mewarisi
// model dikoersi `resolvePhasePlan` terhadap model hasil resolusi).
const normalizeClaudeModel = (m: string): string => RETIRED_MODELS[m] ?? m;
const normalizeCodexModel = (m: string): string => codexModel(m) ? m : RETIRED_CODEX_MODELS[m] ?? m;
function normalizePhaseRuntime<T extends { model?: string | null; effort?: string | null }>(
  runtime: Agent, cell: T,
): T {
  if (!cell.model) return cell;
  const model = runtime === "codex" ? normalizeCodexModel(cell.model) : normalizeClaudeModel(cell.model);
  const effort = runtime === "codex" && cell.effort ? coerceCodexEffort(model, cell.effort) : cell.effort;
  return { ...cell, model, effort };
}
function normalizeOrchestration(o: Orchestration): Orchestration {
  const out = {} as Record<string, Orchestration[keyof Orchestration]>;
  for (const [flow, cfg] of Object.entries(o)) {
    const cells = (runtime: Agent) => Object.fromEntries(Object.entries(cfg[runtime])
      .map(([phase, cell]) => [phase, normalizePhaseRuntime(runtime, cell)]));
    out[flow] = { ...cfg, claude: cells("claude"), codex: cells("codex") };
  }
  return out as Orchestration;
}
/** S6 · override fase transient per sesi, dinormalisasi dengan aturan yang sama dengan sel Setting. */
export function normalizePhaseOverrides(runtime: Agent, o: PhaseOverrides | undefined): PhaseOverrides | undefined {
  if (!o) return o;
  return Object.fromEntries(Object.entries(o).map(([phase, v]) => [phase, normalizePhaseRuntime(runtime, v)]));
}

/**
 * SPEC-339 · cermin RETIRED_MODELS untuk blok codex, plus koersi effort. Urutannya penting:
 * effort divalidasi terhadap model HASIL pemetaan, bukan model tersimpan — memetakan
 * `gpt-5.4` (tanpa ultra) ke gpt-5.5 tak ada gunanya bila effort `ultra`-nya dibiarkan.
 */
function normalizeCodex(c: Codex): Codex {
  const model = codexModel(c.model) ? c.model : RETIRED_CODEX_MODELS[c.model] ?? c.model;
  return { model, effort: coerceCodexEffort(model, c.effort) };
}

// Id model yang sudah pensiun dipetakan ke penggantinya saat dibaca. Penggantinya alias native
// (bukan id terpatok lain) supaya pemetaan ini tak perlu diperbarui tiap CLI merilis model baru.
const RETIRED_MODELS: Record<string, string> = { "claude-opus-4-8": "opus" };
/**
 * SPEC-162 · model+effort DEFAULT untuk sesi claude interaktif, argv saat sesi lahir.
 * SPEC-252 · ADR-0061 · ini adalah default global; Start bisa meng-override per sesi.
 */
export async function sessionModel(): Promise<{ model: string; effort: string }> {
  const { model, effort } = await getSetting();
  return { model, effort };
}

/**
 * SPEC-338 · ADR-0074 · default sesi yang SUDAH sesuai agennya: memilih model/effort dari blok
 * yang benar, supaya sesi codex tak pernah lahir dengan `codex -m claude-opus-5`. `sessionModel()`
 * di atas tetap ada (khusus claude) untuk pemanggil yang memang hanya butuh blok claude.
 */
export async function sessionAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const s = await getSetting();
  return agentDefaultsOf(s);
}

function agentDefaultsOf(s: Setting): { agent: Agent; model: string; effort: string } {
  return s.agent === "codex"
    ? { agent: "codex", model: s.codex.model, effort: s.codex.effort }
    : { agent: "claude", model: s.model, effort: s.effort };
}

/**
 * SPEC-383 · ADR-0081 · default untuk sesi penyelesai konflik rebase/merge (tiga pintu:
 * `POST /specs/:id/integrate`, `finishGraphOp` di `routes/ide.ts`, dan
 * `POST /terminal/sessions/:id/integrate`). OPT-IN: selama `conflict.enabled` mati, ia
 * mendelegasikan penuh ke `sessionAgentDefaults()` — perilaku pra-SPEC-383, tanpa kejutan.
 *
 * Effort codex dikoersi di sini seperti blok codex global (`normalizeCodex`), supaya blok konflik
 * tak bisa menyimpan pasangan model+effort yang nanti ditolak codex saat sesi lahir (SPEC-339).
 * Pemanggil WAJIB menurunkan `ensureCodexTrust` dari `agent` HASIL fungsi ini, bukan dari
 * `Setting.agent` — override codex di atas default claude akan mengulang bug SPEC-377.
 */
export async function conflictSessionDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const s = await getSetting();
  const c = s.conflict ?? CONFLICT_DEFAULTS;
  if (!c.enabled) return agentDefaultsOf(s);
  return c.agent === "codex"
    ? { agent: "codex", model: c.model, effort: coerceCodexEffort(c.model, c.effort) }
    : { agent: "claude", model: c.model, effort: c.effort };
}

/**
 * SPEC-517 · default untuk TERMINAL AGEN BIASA (`POST /terminal/sessions {project}`), dengan
 * override per-request. Cermin `conflictSessionDefaults()`, tapi sumber override-nya request —
 * bukan blok Setting — karena pilihannya dibuat operator di form saat sesi dibuat.
 *
 * Aturan mengikat: `o.agent` yang terisi memilih BLOK Setting agen itu, bukan sekadar menukar
 * nama biner. Membaca `Setting.model` untuk sesi codex melahirkan `codex -m claude-opus-5` —
 * persis bug SPEC-377. Pemanggil WAJIB menurunkan `ensureCodexTrust` dari `agent` HASIL fungsi
 * ini, bukan dari `Setting.agent`: sejak SPEC-517 keduanya bisa berbeda di jalur ini.
 *
 * Effort codex dikoersi di sini (cermin `normalizeCodex`/`conflictSessionDefaults`) supaya picker
 * dan argv tak pernah berselisih; `createSession` tetap titik cekik terakhirnya (SPEC-339).
 */
export async function terminalAgentDefaults(
  o: { agent?: Agent; model?: string; effort?: string },
): Promise<{ agent: Agent; model: string; effort: string }> {
  const s = await getSetting();
  const base = o.agent
    ? (o.agent === "codex"
      ? { agent: "codex" as const, model: s.codex.model, effort: s.codex.effort }
      : { agent: "claude" as const, model: s.model, effort: s.effort })
    : agentDefaultsOf(s);
  const model = o.model ?? base.model;
  const effort = o.effort ?? base.effort;
  return base.agent === "codex"
    ? { agent: "codex", model, effort: coerceCodexEffort(model, effort) }
    : { agent: "claude", model, effort };
}
