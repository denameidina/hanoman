// Audit UI/UX 2026-10 · Fase 3C · katalog IA Pengaturan. Empat niat (intent) berisi bagian (section)
// yang masing-masing dirender sebagai satu layar. Kunci bagian juga kunci persist (`settings/tab`,
// ADR-0115) dan nilai deep link `#bagian=<kunci>`; kunci lama tetap dipetakan lewat `normalizeSection`.
import {
  BUILTIN_RUNTIME_DEFAULTS, BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS, CODEX_DEFAULTS, CONFLICT_DEFAULTS, DEFAULT_METHOD, GOAL_DEFAULTS,
  LEAD_DEFAULTS, LOG_RETENTION_DEFAULTS, LOG_SHIPPING_DEFAULTS, MODELS, ORCHESTRATION_DEFAULTS,
  PORTAL_CHAT_DEFAULTS, REMOTE_CONTROL_DEFAULTS, SCHEDULER_DEFAULTS, TELEGRAM_DEFAULTS,
  claudeEfforts, coerceClaudeEffort, modelSelectOptions,
} from "@hanoman/shared";
import type { Setting } from "@hanoman/shared";
import { RUNTIME_LABEL } from "../../lib/labels";

export const AGENT_LABEL = RUNTIME_LABEL;

export type SectionKey =
  | "sesi" | "model"
  | "agent" | "telegram" | "webhook" | "akses-klien" | "perangkat" | "kendali-jarak-jauh"
  | "akun" | "users" | "setup" | "konfigurasi" | "aktivitas" | "custom-agent" | "zona-bahaya";
export type IntentKey = "sesi" | "model" | "integrasi" | "lanjutan";

export interface SectionDef { key: SectionKey; label: string; icon: string; keywords: string }
export interface IntentDef { key: IntentKey; label: string; icon: string; collapsible?: boolean; sections: SectionDef[] }

/** Empat niat. Niat dengan satu bagian tak punya daftar bagian di navigasi (langsung ke layarnya). */
export const SETTINGS_INTENTS: readonly IntentDef[] = [
  { key: "sesi", label: "Sesi harian", icon: "bell", sections: [
    { key: "sesi", label: "Sesi harian", icon: "bell",
      keywords: "notifikasi suara selesai keputusan gagal full-auto scaffold agen model default effort goal kondisi verifikasi scope metode workflow" },
  ] },
  { key: "model", label: "Agen & model", icon: "cpu", sections: [
    { key: "model", label: "Agen & model", icon: "cpu",
      keywords: "override konflik rebase merge lead operator obrolan portal jatah orkestrasi fase effort model runtime" },
  ] },
  { key: "integrasi", label: "Integrasi & akses", icon: "webhook", sections: [
    { key: "agent", label: "Akses AI Agent", icon: "bot", keywords: "token agent capability mcp master switch" },
    { key: "telegram", label: "Telegram", icon: "send", keywords: "bot token chat allowlist gateway operator agen progress uji koneksi" },
    { key: "webhook", label: "Webhook", icon: "webhook", keywords: "endpoint secret peristiwa pengiriman dokumentasi" },
    { key: "akses-klien", label: "Akses klien", icon: "user-check", keywords: "portal klien grant lihat tulis mulai sesi" },
    { key: "perangkat", label: "Perangkat", icon: "key-round", keywords: "token perangkat sinkron server pusat" },
    { key: "kendali-jarak-jauh", label: "Kendali jarak jauh", icon: "shield", keywords: "izin server pusat perangkat kendali" },
  ] },
  { key: "lanjutan", label: "Lanjutan", icon: "sliders-horizontal", collapsible: true, sections: [
    { key: "akun", label: "Akun", icon: "user-round", keywords: "password email logout ganti masuk" },
    { key: "users", label: "Pengguna", icon: "users", keywords: "undang hapus pengguna email password" },
    { key: "setup", label: "Setup awal", icon: "shield", keywords: "peruntukan hardening setup ulang" },
    { key: "konfigurasi", label: "Konfigurasi", icon: "sliders-horizontal", keywords: "env rahasia bootstrap sinkron runtime variabel" },
    { key: "aktivitas", label: "Log aktivitas", icon: "activity", keywords: "log sesi project hasil commit pr hapus" },
    { key: "custom-agent", label: "Custom agent", icon: "bot", keywords: "persona agen mention katalog" },
    { key: "zona-bahaya", label: "Zona bahaya", icon: "alert-triangle", keywords: "reset default kembalikan semua setelan" },
  ] },
];

export const DEFAULT_SECTION: SectionKey = "sesi";
export const SECTION_KEYS: readonly SectionKey[] = SETTINGS_INTENTS.flatMap((i) => i.sections.map((s) => s.key));

const isSectionKey = (v: string): v is SectionKey => (SECTION_KEYS as readonly string[]).includes(v);

/** Kunci lama dari sebelum Fase 3C (tab "Umum" dan "Orkestrasi" sudah pindah). Map, bukan objek: kunci
    seperti "constructor" tak boleh lolos sebagai bagian. */
const LEGACY_SECTION = new Map<string, SectionKey>([["umum", "sesi"], ["orkestrasi", "model"]]);

/** Kunci persist/hash → bagian yang dikenal. Nilai tak dikenal (atau rusak) jatuh ke bagian default. */
export function normalizeSection(raw: unknown): SectionKey {
  if (typeof raw !== "string") return DEFAULT_SECTION;
  const mapped = LEGACY_SECTION.get(raw) ?? raw;
  return isSectionKey(mapped) ? mapped : DEFAULT_SECTION;
}

export function intentOf(section: SectionKey): IntentDef {
  return SETTINGS_INTENTS.find((i) => i.sections.some((s) => s.key === section)) ?? SETTINGS_INTENTS[0]!;
}

export function sectionDef(section: SectionKey): SectionDef {
  const found = SETTINGS_INTENTS.flatMap((i) => i.sections).find((s) => s.key === section);
  return found ?? SETTINGS_INTENTS[0]!.sections[0]!;
}

/** Nama bagian lengkap untuk pemilih mobile: "Integrasi & akses · Telegram". */
export function sectionPath(section: SectionKey): string {
  const intent = intentOf(section);
  return intent.sections.length > 1 ? `${intent.label} · ${sectionDef(section).label}` : intent.label;
}

/** Deep link: `/settings#bagian=telegram`. Parameter hash lain (mis. `spec=`) dibiarkan utuh. */
export function readHashSection(hash: string): SectionKey | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("bagian");
  return raw && isSectionKey(raw) ? raw : null;
}

// ─── Default & katalog model (dipindah dari SettingsScreen; sumbernya tetap @hanoman/shared) ───

/** Status CLI codex dari GET /codex/version (versi null = tak terpasang / tak terbaca). */
export interface CodexVersionState { version: string | null; minRequired: string }

/** Claude: effort dinaikkan/diturunkan sesuai katalog model (sumber sama dengan picker Start). */
export const claudeEffortOptions = (model: string) =>
  claudeEfforts(model).map((v) => ({ value: v, label: v === "xhigh" ? "x-high" : v }));
export const claudeOptions = (model: string) => modelSelectOptions(MODELS, model);
export const claudeEffortPatch = (model: string, effort: string): Partial<Setting> => {
  const next = coerceClaudeEffort(model, effort);
  return next === effort ? {} : { effort: next };
};

/** Nada notifikasi backlog selesai (durasi bervariasi). "off" = senyap; toast dan daftar tetap jalan. */
export const S_SOUNDS = [
  { value: "blip", label: "Blip · 0.1s" }, { value: "pop", label: "Pop · 0.1s" },
  { value: "short", label: "Short · 0.15s" }, { value: "ping", label: "Ping · 0.2s" },
  { value: "coin", label: "Coin · 0.3s" }, { value: "alert", label: "Alert · 0.3s" },
  { value: "medium", label: "Medium · 0.4s" }, { value: "chime", label: "Chime · 0.4s" },
  { value: "success", label: "Success · 0.4s" }, { value: "bell", label: "Bell · 0.5s" },
  { value: "marimba", label: "Marimba · 0.6s" }, { value: "long", label: "Long · 0.8s" },
  { value: "fanfare", label: "Fanfare · 0.9s" }, { value: "off", label: "Senyap" },
];

/** Default lengkap untuk "Reset ke default". Tiap kunci di sini harus ada di tipe `Setting`. */
export const S_DEFAULTS: Setting = {
  model: "sonnet", effort: "medium",
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", notifyDecisionTelegram: true,
  agentAccessEnabled: false,
  scheduler: SCHEDULER_DEFAULTS,
  goal: GOAL_DEFAULTS,
  agent: "claude",
  codex: CODEX_DEFAULTS,
  antigravity: BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS,
  verifyScope: "changed",
  method: DEFAULT_METHOD,
  conflict: CONFLICT_DEFAULTS,
  lead: LEAD_DEFAULTS,
  telegram: TELEGRAM_DEFAULTS,
  portalChat: PORTAL_CHAT_DEFAULTS,
  orchestration: ORCHESTRATION_DEFAULTS,
  remoteControl: REMOTE_CONTROL_DEFAULTS,
  logShipping: LOG_SHIPPING_DEFAULTS,
  logRetention: LOG_RETENTION_DEFAULTS,
  // SPEC-881 · stempel suntingan agen bawaan. Wajib di tipe `Setting`.
  builtinAgents: {},
  builtinAgentPolicies: {},
  builtinRuntimeDefaults: BUILTIN_RUNTIME_DEFAULTS,
};
