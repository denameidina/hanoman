import { prisma } from "../db";
import {
  zSetting, SCHEDULER_DEFAULTS, GOAL_DEFAULTS, CODEX_DEFAULTS, CONFLICT_DEFAULTS,
  RETIRED_CODEX_MODELS, LEAD_DEFAULTS, coerceCodexEffort, type Setting, type Agent, type Codex,
  TELEGRAM_DEFAULTS, CHANGELOG_ENGINE_DEFAULTS,
} from "@hanoman/shared";

// Model id + effort yang diteruskan apa adanya ke `claude --model` / `--effort`.
const STEP = { model: "claude-opus-5", effort: "xhigh" };
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
  conflict: CONFLICT_DEFAULTS,     // SPEC-383 · ADR-0081 · default sesi konflik (opt-in, mati)
  lead: LEAD_DEFAULTS,             // SPEC-409 · ADR-0091 · hanoman-lead (master switch mati)
  telegram: TELEGRAM_DEFAULTS,     // SPEC-476 · ADR-0096 · gateway Telegram opt-in
  changelog: CHANGELOG_ENGINE_DEFAULTS, // SPEC-518 · agen pembuat changelog (opt-in, mati)
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
  };
}

/**
 * SPEC-339 · cermin RETIRED_MODELS untuk blok codex, plus koersi effort. Urutannya penting:
 * effort divalidasi terhadap model HASIL pemetaan, bukan model tersimpan — memetakan
 * `gpt-5.4` (tanpa ultra) ke gpt-5.5 tak ada gunanya bila effort `ultra`-nya dibiarkan.
 */
function normalizeCodex(c: Codex): Codex {
  const model = RETIRED_CODEX_MODELS[c.model] ?? c.model;
  return { model, effort: coerceCodexEffort(model, c.effort) };
}

// Id model yang sudah tidak ada di picker (MODELS) dipetakan ke penggantinya saat dibaca, supaya
// baris Setting lama tak menyisakan nilai yang tak bisa dipilih lagi di UI.
const RETIRED_MODELS: Record<string, string> = { "claude-opus-4-8": "claude-opus-5" };
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
