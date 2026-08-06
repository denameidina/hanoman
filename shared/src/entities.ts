import { z } from "zod";
import { zStage, zSpecSource, zDocStatus, zPriority, zProjectKind, zAgent, zVerifyScope } from "./enums";
import { TELEGRAM_DEFAULTS, zTelegramSettings } from "./telegram";
import { zAgentEngine, type AgentEngine } from "./agent-engine";
import { zAutoMerge } from "./auto-merge";

export type Stage = z.infer<typeof zStage>;
// SPEC-338 · ADR-0074 · mesin sesi. Di-re-ekspor dari sini supaya konsumen setelan cukup
// mengimpor satu modul (pola yang sama dipakai Stage di atas).
export { zAgent };
export type Agent = z.infer<typeof zAgent>;

export const zProject = z.object({
  id: z.string(), name: z.string(), desc: z.string(), kind: zProjectKind,
  repoDir: z.string().nullable().optional(),
  gitRemote: z.string().nullable().optional(),         // SPEC-213 · git remote resmi (clone di client)
  stack: z.string().default(""),                       // ADR-0004
  docStatus: zDocStatus, coverage: z.number().int().min(0).max(100),
  createdAt: z.string(),
});
export type Project = z.infer<typeof zProject>;

export const zBriefPayload = z.object({
  context: z.string(), outcome: z.string(), constraints: z.string(), priority: zPriority,
  // SPEC-340 · ADR-0076 · brief yang DINAIKKAN dari audit. Tanpa field ini zod membuangnya di
  // boundary (objek non-strict) dan runner tak pernah melihat asal-usulnya. Cermin zQaPayload.
  fromAudit: z.string().optional() });
export const zQaPayload = z.object({
  severity: z.enum(["critical","major","minor"]), steps: z.string(),
  expected: z.string(), actual: z.string(), env: z.string(),
  fromAudit: z.string().optional() });   // SPEC-244 · qa dinaikkan dari audit → sinyal skip fase Audit (ADR-0059)
// SPEC-407 · ADR-0089 · bentuk payload KETIGA: backlog goal. Sesi mengejar SATU goal tanpa fase
// perencanaan, jadi yang disimpan bukan konteks+outcome melainkan goal itu sendiri. `goal` wajib —
// `Spec.objective` diturunkan darinya (deriveSpecFields) DAN ia jadi inti kondisi Stop hook
// (ADR-0073). `done` = bukti berhenti yang dituntut; kosong berarti "goal itu sendiri buktinya".
export const zGoalPayload = z.object({
  goal: z.string(), done: z.string(), constraints: z.string(), priority: zPriority });

// SPEC-447 · ADR-0093 · alasan sebuah backlog item tertahan. `missing` = dependency-nya tak ada
// (mis. terhapus di mesin lain sebelum sync menyusul); `unfinished` = stage belum `done`;
// `unmerged` = sudah `done` tapi commit-nya belum ada di branch basis item ini.
export const zSpecBlocker = z.object({
  id: z.string(), reason: z.enum(["missing", "unfinished", "unmerged"]),
});
export type SpecBlocker = z.infer<typeof zSpecBlocker>;

// SPEC-546 · ADR-0109 · satu baris jejak konversi type. `payload` = bentuk LAMA utuh — itulah
// yang membuat field tanpa padanan di bentuk baru (`convertPayload().dropped`) tidak pernah
// benar-benar hilang.
export const zSourceChange = z.object({
  at: z.string(), from: z.string(), to: z.string(), by: z.string(),
  payload: z.unknown().optional(),
});
export type SourceChange = z.infer<typeof zSourceChange>;

export const zSpec = z.object({
  id: z.string(), projectId: z.string(), title: z.string(), source: zSpecSource,
  stage: zStage, priority: zPriority, author: z.string(), objective: z.string(),
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).nullable(),   // SPEC-407 · +goal
  branchFrom: z.string().nullable(),                   // SPEC-143 · null = default project (main)
  baseSha: z.string().nullable(),                      // SPEC-186 · null = belum pernah ada sesi (belum dimulai)
  // SPEC-408 · ADR-0090 · stempel waktu backlog (ISO string di wire — kolom DateTime di DB).
  // `startedAt` null = belum pernah dikerjakan; ia tak pernah ditulis ulang saat sesi dilanjutkan.
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  // SPEC-447 · ADR-0093 · id backlog yang harus selesai & ter-merge lebih dulu. Server selalu
  // menormalkannya ke array (kolom DB-nya `Json?`); `.default([])` menjaga respons lama.
  dependsOn: z.array(z.string()).default([]),
  // Turunan (bukan kolom): dihitung `liveSpecs` dari stage dependency + git. Klien tak pernah
  // mengirimkannya — `.default([])` supaya bentuk lama tetap parse.
  blockedBy: z.array(zSpecBlocker).default([]),
  // SPEC-486 · ADR-0103 · override kebijakan auto-merge item ini; null = warisi project.
  // `.nullable().default(null)` menjaga respons/klien versi lama tetap parse.
  autoMerge: zAutoMerge.nullable().default(null),
  // SPEC-546 · ADR-0109 · jejak konversi type. `.default([])` menjaga respons/klien versi lama
  // tetap parse; kolom DB-nya `Json?` sehingga baris yang belum pernah dikonversi mengirim
  // `null` — pemakai UI menulis `spec.sourceHistory ?? []`, cermin `blockedBy`.
  sourceHistory: z.array(zSourceChange).default([]),
});
export type Spec = z.infer<typeof zSpec>;

// SPEC-180/184 · nada notifikasi (aset .wav di src/public/sounds). "off" = senyap.
const NOTIFY_SOUNDS = ["off", "short", "medium", "long",
  "blip", "pop", "ping", "coin", "alert", "chime", "success", "bell", "marimba", "fanfare"] as const;

// SPEC-162 · satu model per sesi interaktif, dipakai sebagai argv saat sesi lahir. Manusia
// tetap bebas mengetik `/model` di dalam terminal. `steps` (model per fase), `maxConcurrent`,
// dan `askTimeoutMin` hilang bersama runner headless.
// SPEC-238 · daftar pilihan valid untuk UI (server tetap lenient z.string()). +Fable, +max, +ultracode.
// SPEC-252 · ADR-0061 — dipakai picker "Mulai sesi" (model/effort per sesi) + kartu default global Settings.
export const MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
] as const;
export const EFFORTS = ["xhigh", "high", "medium", "low", "max", "ultracode"] as const;

// SPEC-338 · ADR-0074 · katalog codex. Slug diteruskan apa adanya ke `codex -m`; effort ke
// `-c model_reasoning_effort="<v>"` (codex tak punya flag --effort).
// SPEC-339 · effort adalah properti MODEL, bukan properti CLI. GPT-5.6 menambah `max` (kedalaman
// nalar maksimum) dan `ultra` (nalar maksimum + delegasi tugas ke subagent), TAPI Luna tak
// mendukung `ultra` dan seluruh model 5.5 ke bawah tak mendukung keduanya. Dua daftar sejajar
// karena itu tak lagi cukup — tiap model membawa daftar effort-nya sendiri.
// Nilai diverifikasi terhadap `codex debug models` (codex-cli 0.145.0) dan
// codex-rs/models-manager/models.json upstream.
export type CodexModel = {
  id: string; label: string;
  /** Effort yang didukung model ini, urut kuat → ringan. */
  efforts: readonly string[];
  /** Dipakai bila effort tersimpan tak didukung model ini. Wajib ada di `efforts`. */
  fallback: string;
  /** `minimal_client_version` dari manifest codex — dasar peringatan versi lunak (SPEC-339). */
  minClient: string;
};

const E_5_6 = ["ultra", "max", "xhigh", "high", "medium", "low"] as const;
const E_LUNA = ["max", "xhigh", "high", "medium", "low"] as const;
// Irisan yang didukung SETIAP model codex — juga jawaban untuk model yang belum kita daftar.
const E_BASE = ["xhigh", "high", "medium", "low"] as const;

export const CODEX_MODELS: readonly CodexModel[] = [
  { id: "gpt-5.6-sol",   label: "GPT-5.6 Sol",   efforts: E_5_6,  fallback: "xhigh", minClient: "0.144.0" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", efforts: E_5_6,  fallback: "xhigh", minClient: "0.144.0" },
  { id: "gpt-5.6-luna",  label: "GPT-5.6 Luna",  efforts: E_LUNA, fallback: "xhigh", minClient: "0.144.0" },
  { id: "gpt-5.5",       label: "GPT-5.5",       efforts: E_BASE, fallback: "xhigh", minClient: "0.124.0" },
];

// Gabungan semua effort codex. Dipertahankan demi pemanggil lama, TAPI bukan lagi sumber pilihan
// UI — picker wajib memakai `codexEfforts(model)` supaya kombinasi tolak tak pernah tampil.
export const CODEX_EFFORTS = E_5_6;

export function codexModel(id: string): CodexModel | undefined {
  return CODEX_MODELS.find((m) => m.id === id);
}

/** Effort yang boleh dipilih untuk sebuah model. Model tak dikenal → irisan aman, bukan kosong. */
export function codexEfforts(modelId: string): readonly string[] {
  return codexModel(modelId)?.efforts ?? E_BASE;
}

/**
 * Turunkan `effort` ke nilai yang benar-benar didukung `modelId`. Model tak dikenal meneruskan
 * effort apa adanya: katalog ini kurasi UI, bukan gerbang validasi — server sengaja lenient
 * (`z.string()`), dan model baru yang belum sempat didaftar tak boleh jadi mustahil dijalankan.
 */
export function coerceCodexEffort(modelId: string, effort: string): string {
  const m = codexModel(modelId);
  if (!m) return effort;
  return m.efforts.includes(effort) ? effort : m.fallback;
}

/**
 * SPEC-339 · perbandingan versi numerik per segmen. String compare salah: "0.9.0" akan dianggap
 * LEBIH BARU dari "0.144.0". Dipakai server (endpoint versi) dan web (catatan lunak) — satu
 * implementasi, bukan tiga salinan yang lambat laun berbeda.
 */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * SPEC-339 · apakah codex CLI terpasang terlalu tua untuk `modelId`. Seluruh aturan peringatan
 * ada di sini, jadi Settings dan picker Start tak bisa berbeda pendapat:
 * versi tak terdeteksi (`null`) → false (ketiadaan bukti bukan bukti ketiadaan);
 * model tak dikenal → false (tak ada tuntutan versi yang bisa kita klaim).
 */
export function codexClientTooOld(modelId: string, version: string | null): boolean {
  const need = codexModel(modelId)?.minClient;
  if (!need || !version) return false;
  return cmpVersion(version, need) < 0;
}

/**
 * Model yang tak lagi ada di picker → penggantinya saat dibaca (cermin RETIRED_MODELS milik claude).
 * Semua dipetakan ke `gpt-5.5`, SENGAJA bukan ke 5.6: gpt-5.5 hanya butuh klien 0.124.0, sedangkan
 * trio 5.6 butuh 0.144.0. Pensiun tak boleh memindahkan setelan orang ke model yang CLI-nya belum
 * sanggup menjalankannya.
 */
export const RETIRED_CODEX_MODELS: Record<string, string> = {
  "gpt-5.4": "gpt-5.5",
  "gpt-5.4-mini": "gpt-5.5",
  "gpt-5.3-codex-spark": "gpt-5.5",
};

// Default model/effort codex. Model/effort claude sengaja TETAP di `Setting.model`/`Setting.effort`
// (kontrak GET /settings + baris Setting lama), jadi blok ini hanya untuk codex.
export const zCodex = z.object({
  model: z.string().default("gpt-5.6-sol"),
  effort: z.string().default("xhigh"),
});
export type Codex = z.infer<typeof zCodex>;
export const CODEX_DEFAULTS: Codex = zCodex.parse({});

// SPEC-294 · ADR-0072 · knob scheduler otonom. Semua default MATI. Ditambahkan ke zSetting sebagai
// .default(SCHEDULER_DEFAULTS) → baris Setting lama tanpa blok ini tetap parse (key hilang diisi default).
const zSourceCommon = { enabled: z.boolean().default(false) };
export const zScheduler = z.object({
  enabled: z.boolean().default(false),      // master subsystem switch
  paused: z.boolean().default(false),       // rem darurat (Pause): blokir drain ≤1 tick
  maxConcurrent: z.number().int().min(1).default(2),   // cap sesi hidup
  autonomy: z.enum(["full-control", "butuh-keputusan"]).default("butuh-keputusan"), // dikonsumsi daun #5
  sources: z.object({
    backlog: z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(15) }).default({}),
    triase:  z.object({ ...zSourceCommon, everyMin: z.number().int().min(1).default(30) }).default({}),
  }).default({}),
});
export type Scheduler = z.infer<typeof zScheduler>;
export const SCHEDULER_DEFAULTS: Scheduler = zScheduler.parse({});

// SPEC-332 · ADR-0073 · mode goal untuk sesi backlog: Claude Code menolak berhenti sampai kondisi
// terbukti. Default MATI; `condition` kosong = pakai template DoD bawaan runner
// (defaultGoalCondition). Batas 4000 = batas kondisi `/goal` di Claude Code. Dipasang ke zSetting
// lewat .default() seperti `scheduler` (SPEC-294) → baris Setting lama tetap parse, tanpa migration.
export const zGoal = z.object({
  enabled: z.boolean().default(false),
  condition: z.string().max(4000).default(""),
});
export type Goal = z.infer<typeof zGoal>;
export const GOAL_DEFAULTS: Goal = zGoal.parse({});

// SPEC-383 · ADR-0081 · default KHUSUS sesi penyelesai konflik rebase/merge. Opt-in: `enabled`
// mati berarti sesi konflik mewarisi default global (`sessionAgentDefaults()`) persis seperti
// sebelum SPEC-383 — instalasi yang ada tak berubah perilakunya sampai operator menyalakannya.
// Satu triple (agen + model + effort), bukan blok per-agen bercabang seperti Setting akar:
// menukar agen di UI menukar model/effort-nya sekalian, cermin `pickAgent` di StartSessionModal.
// Dipasang ke zSetting lewat .default() seperti goal/codex/verifyScope → baris Setting lama tetap
// parse, TANPA migration (kolom `Setting.data` bertipe Json).
export const zConflict = z.object({
  enabled: z.boolean().default(false),
  agent: zAgent.default("claude"),
  // Lenient z.string() seperti `model`/`effort` di akar: katalog ditegakkan UI, bukan server.
  model: z.string().default("claude-opus-5"),
  effort: z.string().default("xhigh"),
});
export type Conflict = z.infer<typeof zConflict>;
export const CONFLICT_DEFAULTS: Conflict = zConflict.parse({});

// SPEC-518 · runtime/model/effort KHUSUS agen pembuat changelog (SPEC-516/ADR-0105). Bentuknya
// `zAgentEngine` yang sudah dipakai `lead.engine` & `telegram.engine` — bukan definisi kelima,
// justru itu alasan bentuk bersama itu lahir di SPEC-492.
//
// FLAT, bukan `changelog.engine`: `lead`/`telegram` menyarangkan `engine` karena bloknya sudah
// memuat knob lain (rem darurat, denyut, allowlist). Blok ini HANYA override agen — persis kasus
// `zConflict` di atas, yang juga flat. Menyarangkan berarti satu tingkat kosong tanpa tetangga.
//
// Opt-in: `enabled` mati → `changelogAgentDefaults()` mendelegasikan penuh ke
// `sessionAgentDefaults()`. Dipasang ke `zSetting` lewat `.default()` seperti conflict/goal/codex →
// baris Setting lama tetap parse, TANPA migration.
export const CHANGELOG_ENGINE_DEFAULTS: AgentEngine = zAgentEngine.parse({});

// SPEC-409 · ADR-0091 · hanoman-lead. Master switch default MATI (AC-30): selama mati hanoman
// berperilaku persis seperti sebelum PRD orchestrator. Kolom `Setting.data` bertipe Json →
// blok ini TANPA migration, cermin scheduler/goal/conflict.
//
// `engine` = agen yang menjalankan lead (OQ-1). Opt-in seperti `zConflict`: selama `enabled`
// mati, lead memakai `sessionAgentDefaults()` — satu setelan agen, bukan dua yang bisa berselisih.
// SPEC-492 · bentuknya pindah ke `./agent-engine` supaya `Setting.telegram.engine` memakai
// definisi yang SAMA, bukan salinan yang bisa bercabang diam-diam. Nama lama dipertahankan:
// seluruh pemanggil `zLeadEngine`/`LeadEngine` tetap utuh.
export const zLeadEngine = zAgentEngine;
export type LeadEngine = AgentEngine;

export const zLead = z.object({
  enabled: z.boolean().default(false),            // master switch (AC-30)
  paused: z.boolean().default(false),             // rem darurat global (AC-27)
  pausedProjects: z.array(z.string()).default([]),// rem per project (AC-15/US-4)
  everyMin: z.number().int().min(1).max(1440).default(5),   // denyut proaktif (OQ-2)
  // SPEC-432 · batas waktu satu putusan (AC-4/35). Default 120 dtk MELAWAN prompt lead sendiri
  // ("kumpulkan bukti dulu: SoT, ADR, plan, kode, riwayat git") dan kalah: satu keputusan `order`
  // nyata terukur 306 dtk pada claude-opus-5 · xhigh, jadi 7/7 baris jejak operator berstatus
  // `gagal`. 600 dtk memberi kelonggaran di atas ongkos terukur itu; yang memangkas ongkosnya
  // sendiri adalah paragraf anggaran waktu di `leadPrompt` (306 dtk → 101 dtk).
  timeoutSec: z.number().int().min(10).max(900).default(600),
  // AC-11 / OQ-10 · berapa jawaban otomatis berturut-turut untuk SATU sesi sebelum lead berhenti.
  maxAutoAnswers: z.number().int().min(1).max(20).default(3),
  // SPEC-479 (QA) · berapa putusan boleh DISUSUN SEKALIGUS, untuk KETIGA pintu bersama. Sebelum
  // knob ini jawabannya tak pernah dinyatakan, jadi ia jatuh ke bentuk kode tiap pintu: 1 di pintu
  // deteksi (`for`+`await`, terukur `maxInFlight = 1` dengan tangga tunggu linier) dan tak hingga
  // di pintu kontrak (Fastify konkuren, terukur 12 permintaan → 12 proses agen). Default 2 diambil
  // dari mesin tempat keluhan lahir — 8 GB / 8 core yang sudah menanggung sesi pekerja di tmux,
  // sementara satu `claude -p --effort xhigh` adalah runtime Node penuh, bukan panggilan HTTP tipis.
  maxConcurrent: z.number().int().min(1).max(16).default(2),
  // Deadline penerimaan: menunggu slot lebih lama dari ini → penolakan EKSPLISIT yang bisa dicoba
  // ulang (503 + Retry-After di pintu kontrak), bukan gantung. Wajib ada karena Fastify menyetel
  // `requestTimeout: 0` (terukur dari `buildApp()`) — tak ada pihak lain yang akan memutus peminta.
  // 0 = tanpa antrean sama sekali: penuh berarti langsung ditolak.
  queueWaitSec: z.number().int().min(0).max(900).default(120),
  // SPEC-485 · ADR-0102 · umur maksimum satu RANTAI keputusan yang dibiarkan terbuka. Peminta bisa
  // mati di tengah rantai (sesi ditutup, agen crash); tanpa batas ini alurnya `sebagian` selamanya
  // dan tak ada yang tahu apakah ia masih ditunggu. Penyapunya menumpang tick lead yang sudah ada —
  // ADR-0024 melarang timer/scheduler baru.
  flowTtlMin: z.number().int().min(1).max(1440).default(60),
  // OQ-3 · syarat objektif sebelum lead boleh mengintegrasikan ke branch utama. Default MENYALA:
  // risiko "kode masuk main tanpa mata manusia" diterima sadar, tapi syaratnya tetap terukur.
  requireGreenBeforeIntegrate: z.boolean().default(true),
  engine: zLeadEngine.default({}),
});
export type Lead = z.infer<typeof zLead>;
export const LEAD_DEFAULTS: Lead = zLead.parse({});

export const zSetting = z.object({
  model: z.string().default("claude-opus-5"),
  effort: z.string().default("xhigh"),
  autoDefault: z.boolean(),
  autoScaffold: z.boolean(),
  notifyFail: z.boolean(),
  notifyDone: z.boolean().default(true),                                   // SPEC-180
  notifySound: z.enum(NOTIFY_SOUNDS).default("short"),                     // SPEC-180
  notifyDecision: z.boolean().default(true),                              // SPEC-184
  notifyDecisionSound: z.enum(NOTIFY_SOUNDS).default("alert"),            // SPEC-184
  agentAccessEnabled: z.boolean().default(false),                        // SPEC-257 · master switch akses AI agent
  scheduler: zScheduler.default(SCHEDULER_DEFAULTS),                      // SPEC-294 · ADR-0072 · knob scheduler (default mati)
  goal: zGoal.default(GOAL_DEFAULTS),                                     // SPEC-332 · ADR-0073 · mode goal (default mati)
  agent: zAgent.default("claude"),                                        // SPEC-338 · ADR-0074 · mesin sesi default
  codex: zCodex.default(CODEX_DEFAULTS),                                  // SPEC-338 · ADR-0074 · model/effort codex
  verifyScope: zVerifyScope.default("changed"),                           // SPEC-376 · ADR-0080 · scope verifikasi sesi
  conflict: zConflict.default(CONFLICT_DEFAULTS),                         // SPEC-383 · ADR-0081 · default sesi konflik rebase/merge
  lead: zLead.default(LEAD_DEFAULTS),                                     // SPEC-409 · ADR-0091 · hanoman-lead (default mati)
  telegram: zTelegramSettings.default(TELEGRAM_DEFAULTS),                 // SPEC-476 · ADR-0096 · gateway Telegram (default mati)
  changelog: zAgentEngine.default(CHANGELOG_ENGINE_DEFAULTS),             // SPEC-518 · agen pembuat changelog (opt-in, mati)
});
export type Setting = z.infer<typeof zSetting>;

// SPEC-180/184 · notifikasi. type done|decision; specId null untuk sesi reverse; sessionId
// = target redirect terminal. Tanggal = string ISO (JSON). readAt null = unread.
export const zNotification = z.object({
  id: z.string(),
  // SPEC-253 · +ticket; SPEC-298 · +fail (sesi scheduler gagal/limit)
  // SPEC-409 · +lead (ADR-0091): keputusan berbobot / ragu / tindakan terkunci ditolak. MEMBERI
  // TAHU, bukan meminta izin — tak ada pekerjaan yang menunggu notifikasi ini dibaca (AC-25).
  // SPEC-384 · −error (ADR-0092) · dicabut bersama error monitoring.
  type: z.enum(["done", "decision", "ticket", "fail", "lead"]).default("done"),
  specId: z.string().nullable(),
  sessionId: z.string().nullable(),
  title: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.string(), readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof zNotification>;

export const zDocFile = z.object({
  projectId: z.string(), path: z.string(), category: z.string(),
  content: z.string(), linked: z.boolean(), root: z.boolean() });
export type DocFile = z.infer<typeof zDocFile>;

// SPEC-213 · ADR-0044 · view device token (tanpa tokenHash / plaintext). Tanggal = string ISO.
export const zDeviceTokenView = z.object({
  id: z.string(), name: z.string(), createdAt: z.string(),
  lastSeenAt: z.string().nullable(), revokedAt: z.string().nullable(),
});
export type DeviceTokenView = z.infer<typeof zDeviceTokenView>;
