import { z } from "zod";
import { zProject, zBriefPayload, zQaPayload, zGoalPayload, zSpec, zScheduler, zAgent, zLead } from "./entities";
import {
  zLeadGate, zLeadKind, zLeadConfidence, zLeadAction, zLeadStatus, zLeadChoice,
  zLeadFlowStatus, zLeadSelect,
} from "./lead";
import { zAutoMerge } from "./auto-merge";
import { zPrdStatus } from "./prd-status";
import type { Spec, Notification } from "./entities";
import { zProjectKind, zSpecSource, zPriority, zStage, zTicketCategory, zTicketStatus, zVerifyScope } from "./enums";
import { payloadMatchesSource } from "./spec-source";

// SPEC-198 · amplop daftar via API: search/filter/paginasi dilakukan server-side.
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };

// SPEC-213 · terbitkan device token (nama device untuk pengenal manusia).
export const zIssueDeviceToken = z.object({ name: z.string().min(1) });

// SPEC-213 · ADR-0047 · ringkasan hasil sesi (activity log). Whitelist field — tanpa transkrip/kredensial.
export const zSessionResult = z.object({
  id: z.string(), projectId: z.string(), specId: z.string().nullable(),
  oldStage: z.string().nullable(), newStage: z.string().nullable(),
  commitSha: z.string().nullable(), branch: z.string().nullable(), prUrl: z.string().nullable(),
  status: z.string(), deviceId: z.string().nullable(), author: z.string().nullable(),
  createdAt: z.string(),
});
export type SessionResultView = z.infer<typeof zSessionResult>;

// SPEC-362 · ADR-0079 · satu baris riwayat sesi terminal. `transcriptBytes` non-null = transkrip
// tersedia; isinya sendiri diambil terpisah lewat endpoint transcript (bisa sampai 1 MiB).
export const zSessionHistory = z.object({
  id: z.string(), sessionId: z.string(), projectId: z.string(), specId: z.string().nullable(),
  title: z.string().nullable(), kind: z.string(), flow: z.string().nullable(), agent: z.string(),
  model: z.string().nullable(), effort: z.string().nullable(), branch: z.string().nullable(),
  cwd: z.string(), startedAt: z.string(), endedAt: z.string().nullable(),
  exitCode: z.number().nullable(), transcriptBytes: z.number().nullable(),
});
export type SessionHistoryView = z.infer<typeof zSessionHistory>;

export const zCreateProject = z.object({
  name: z.string().min(1), kind: zProjectKind, repoDir: z.string().optional(),
  gitRemote: z.string().optional(),
  desc: z.string().default("") });
// SPEC-146: hanya label tampilan. `id` memikul kunci asing Spec; `kind`,
// `repoDir` dan `stack` menentukan tempat sesi/scan/terminal hidup. Body
// kosong `{}` sah dan berarti no-op — refinement "minimal satu field" tak menjaga apa pun.
// SPEC-255 · ADR-0064 · slug project: huruf-kecil/angka, tanda hubung hanya di tengah (tak boleh
// awal/akhir). Dipakai operasi rename id (bukan field PATCH). Regex = gate 400 endpoint rename.
export const zProjectId = z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "slug tak sah");
export const zRenameProject = z.object({ newId: zProjectId });
export const zUpdateProject = z.object({
  name: z.string().min(1).optional(),
  desc: z.string().optional(),
  gitRemote: z.string().optional(),   // SPEC-213 · set git remote resmi project
  repoDir: z.string().nullable().optional(),   // SPEC-217 · path default/server editable (null = kosongkan)
  schedulerOptIn: z.boolean().optional(),   // SPEC-294 · opt-in scheduler otonom (lokal, tak disync)
  leadOptIn: z.boolean().optional(),        // SPEC-409 · ADR-0091 · opt-in hanoman-lead (lokal, tak disync)
  // SPEC-486 · ADR-0103 · kebijakan auto-merge project (null = kosongkan → tanpa auto-merge).
  // Divalidasi server terhadap repo (checkAutoMerge): repoDir wajib ada, branch wajib nyata.
  autoMerge: zAutoMerge.nullable().optional(),
});
export const zCreateSpec = z.object({
  project: z.string(), source: zSpecSource, title: z.string().min(1),
  priority: zPriority, payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]),
  branchFrom: z.string().min(1).optional(),
  // SPEC-447 · ADR-0093 · divalidasi server (id ada / satu project / bukan diri sendiri / non-siklus).
  dependsOn: z.array(z.string()).optional() })
  // SPEC-197 · ikat source ke bentuk payload: `qa` → QaPayload (punya `severity`), selain itu →
  // BriefPayload. Union saja tak menjaganya (objek non-strict), jadi `deriveSpecFields` bisa
  // menurunkan objective/priority dari bentuk yang salah. superRefine menegakkannya di boundary.
  // SPEC-407 · kini TIGA-arah: `qa` ↔ `severity`, `goal` ↔ `goal`, selain itu → brief. Payload
  // goal yang menyelinap ke source brief akan melahirkan spec ber-objective kosong.
  // SPEC-546 · ADR-0109 · predikatnya kini hidup di `spec-source.ts` dan dipakai jalur konversi
  // (`zChangeSpecSource`, `checkSourceChange`) juga — satu definisi, bukan dua yang bisa melenceng.
  .superRefine((o, ctx) => {
    if (!payloadMatchesSource(o.source, o.payload))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "bentuk payload tak cocok dengan source" });
  });
// nullable, bukan optional: `null` berarti "kosongkan, kembali ke default project",
// dan itu harus terbedakan dari "jangan sentuh".
// branchFrom: nullable+optional — `null` mengosongkan (kembali ke default project),
// `undefined` berarti jangan sentuh. stage: revert backward-only (SPEC-167); confirmDelete
// mengizinkan penghapusan artefak setelah dry-run.
export const zPatchSpec = z.object({
  branchFrom: z.string().min(1).nullable().optional(),
  stage: zStage.optional(),
  confirmDelete: z.boolean().optional(),
  // SPEC-186 · edit konten selagi item belum dimulai. Ditolak server bila sudah mulai.
  title: z.string().min(1).optional(),
  priority: zPriority.optional(),
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).optional(),   // SPEC-407 · +goal
  // SPEC-447 · ADR-0093 · SENGAJA di luar gerbang `editingContent` (SPEC-186): gerbang itu
  // melindungi konten yang sudah jadi dasar kerja sesi berjalan, sedangkan dependsOn hanya
  // menggerbangi peluncuran BERIKUTNYA. `[]` = kosongkan.
  dependsOn: z.array(z.string()).optional(),
  // SPEC-486 · ADR-0103 · override per item; `null` mengembalikannya ke warisan project.
  // SENGAJA di luar gerbang `editingContent` (SPEC-186), sama seperti dependsOn: ia menggerbangi
  // apa yang terjadi SESUDAH kerja, bukan konten yang sedang dikerjakan sesi hidup.
  autoMerge: zAutoMerge.nullable().optional(),
});
// SPEC-546 · ADR-0109 · ubah type/source item IN-PLACE. Operasi khusus, bukan field `zPatchSpec`:
// gerbangnya berbeda dari `editingContent` (SPEC-186) — ia mengunci FLOW, bukan label — dan
// preseden ADR-0064 (rename project) sudah menetapkan bentuk "operasi khusus" untuk perubahan
// yang punya gerbang & efek sampingnya sendiri.
// `payload` OPSIONAL: tak dikirim = server memakai `convertPayload` (jalur agen lewat REST tetap
// menghasilkan baris yang sah alih-alih 400).
export const zChangeSpecSource = z.object({
  source: zSpecSource,
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).optional(),
}).superRefine((o, ctx) => {
  if (o.payload !== undefined && !payloadMatchesSource(o.source, o.payload))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "bentuk payload tak cocok dengan source" });
});
// SPEC-175 · rebase/merge branch hasil done spec. target = "local:<b>" | "origin:<b>".
export const zIntegrate = z.object({
  op: z.enum(["merge", "rebase"]),
  target: z.string().regex(/^(local|origin):.+/),
});
// SPEC-162 · yang berjalan adalah sesi tmux, bukan baris Run. `flow` menggantikan `kind`.
export const zSessionSummary = z.object({
  status: z.enum(["running", "idle"]),
  phase: z.string().nullable(),
  flow: z.string().nullable(),
});
export const zProjectView = zProject.extend({
  binding: z.string().nullable(),   // SPEC-217 · override repoDir per-mesin (null = pakai Project.repoDir)
  backlog: z.number().int(), topStage: z.string(), session: zSessionSummary,
  activity: z.string(), commit: z.string(),
  helpEnabled: z.boolean().default(false),   // SPEC-253 · Help Center publik aktif
  schedulerOptIn: z.boolean().default(false),   // SPEC-294 · opt-in scheduler otonom
  leadOptIn: z.boolean().default(false),        // SPEC-409 · ADR-0091 · opt-in hanoman-lead
  autoMerge: zAutoMerge.nullable().default(null) });   // SPEC-486 · ADR-0103 · null = tanpa auto-merge
export type ProjectView = z.infer<typeof zProjectView>;

// SPEC-294 · ADR-0072 · baris antrean scheduler untuk panel (daun #6). Tanggal = string ISO.
export const zSchedulerQueueItem = z.object({
  id: z.string(), specId: z.string(), projectId: z.string(),
  source: z.string(), priority: z.string(), status: z.string(),
  sessionId: z.string().nullable(), note: z.string().nullable(),
  enqueuedAt: z.string(), launchedAt: z.string().nullable(),
});
export type SchedulerQueueItemView = z.infer<typeof zSchedulerQueueItem>;

// SPEC-299 · ADR-0072 · view respons GET /api/scheduler/state (daun #6). Cerminan bentuk yang
// dikembalikan routes/scheduler.ts apa adanya — parse non-strict (field ekstra spt cwd diabaikan).
export const zSchedulerSourceView = z.object({
  id: z.string(), enabled: z.boolean(), everyMin: z.number(),
  lastRunAt: z.string().nullable(), nextRunAt: z.string().nullable(),
});
export type SchedulerSourceView = z.infer<typeof zSchedulerSourceView>;

export const zSchedulerSessionView = z.object({
  id: z.string(), projectId: z.string(), specId: z.string(),
  flow: z.string().optional(), branch: z.string().optional(),
  decision: z.boolean(), exited: z.boolean(),
});
export type SchedulerSessionView = z.infer<typeof zSchedulerSessionView>;

// SPEC-523 · `queue` DICABUT dari state: ia daftar tanpa batas dan kini punya endpoint sendiri
// (`GET /scheduler/queue`, amplop Paginated). State membawa hitungannya saja.
export const zSchedulerQueueCounts = z.object({
  queued: z.number().int(), launched: z.number().int(),
  done: z.number().int(), failed: z.number().int(),
  // SPEC-522 · `canceled` adalah nilai kelima `status`; hitungannya ikut supaya panel bisa
  // menampilkan seksi "Dibatalkan" tanpa memuat daftarnya.
  canceled: z.number().int(),
});
export type SchedulerQueueCounts = z.infer<typeof zSchedulerQueueCounts>;

export const zSchedulerState = z.object({
  config: zScheduler,
  cap: z.number(), liveCount: z.number(),
  sources: z.array(zSchedulerSourceView),
  queueCounts: zSchedulerQueueCounts,
  sessions: z.array(zSchedulerSessionView),
});
export type SchedulerStateView = z.infer<typeof zSchedulerState>;

// SPEC-409 · ADR-0091 · satu baris jejak keputusan hanoman-lead (AC-23). Tanggal = string ISO.
// `refs` sudah tersaring di server: hanya rujukan yang benar-benar ada di repo (AC-6).
export const zLeadDecisionView = z.object({
  id: z.string(), projectId: z.string(),
  specId: z.string().nullable(), sessionId: z.string().nullable(),
  gate: zLeadGate, kind: zLeadKind,
  question: z.string(), answer: z.string(), reason: z.string(),
  refs: z.array(z.string()),
  confidence: zLeadConfidence, action: zLeadAction,
  // SPEC-480 · ADR-0098 · pilihan sebagai data. `options` adalah menu yang DIKIRIM peminta, jadi
  // jejaknya bisa dibaca ulang tanpa peminta ("opsi 2 dari 3").
  choice: z.string().nullable().default(null),
  choiceIndex: z.number().nullable().default(null),
  options: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
  // SPEC-485 · ADR-0102 · jawaban SELALU daftar di permukaan baca. Baris pra-migrasi tak punya
  // kolomnya, jadi `toDecisionView` MENURUNKANNYA dari `choice`/`choiceIndex` — itulah yang
  // membuat riwayat lama tetap terbaca sesudah perubahan skema.
  choices: z.array(zLeadChoice).default([]),
  select: zLeadSelect.nullable().default(null),
  flowId: z.string().nullable().default(null),
  step: z.number().nullable().default(null),
  status: zLeadStatus, weighty: z.boolean(),
  supersededById: z.string().nullable(),
  createdAt: z.string(),
});
export type LeadDecisionView = z.infer<typeof zLeadDecisionView>;

// SPEC-485 · ADR-0102 · satu RANTAI keputusan sebagai objek berstatus. Langkahnya dibaca lewat
// `GET /lead/decisions?flowId=` — sengaja bukan bersarang di sini: langkah adalah baris jejak
// biasa, dan menyalinnya ke serializer kedua berarti dua bentuk yang bisa berselisih.
export const zLeadFlowView = z.object({
  id: z.string(), projectId: z.string(),
  specId: z.string().nullable(), sessionId: z.string().nullable(),
  gate: zLeadGate, status: zLeadFlowStatus,
  title: z.string(), steps: z.number(),
  closeReason: z.string().nullable(),
  openedAt: z.string(), closedAt: z.string().nullable(), expiresAt: z.string(),
});
export type LeadFlowView = z.infer<typeof zLeadFlowView>;

// Balasan kontrak "minta putusan" (pintu #1). Peminta mesin membaca ini, bukan prosa bebas (AC-1).
export const zLeadAnswer = z.object({
  id: z.string(),
  decision: z.string(), reason: z.string(),
  refs: z.array(z.string()),
  confidence: zLeadConfidence, action: zLeadAction,
  // SPEC-480 · ADR-0098 · inilah yang membuat balasan ini benar-benar terbaca mesin: opsi yang
  // dipilih sebagai field, bukan sesuatu yang harus ditebak dari `decision`. `decision`/`reason`
  // di sini TERPANGKAS (jejak penuh ada di `GET /lead/decisions`).
  choice: zLeadChoice.nullable().default(null),
  missing: z.array(z.string()).default([]),
  // SPEC-485 · ADR-0102 · `choices` adalah bentuk yang berlaku; `choice` di atas tinggal
  // `choices[0]`. `flowId`/`flowStatus` memberi peminta pegangan untuk melanjutkan rantainya.
  choices: z.array(zLeadChoice).default([]),
  flowId: z.string().nullable().default(null),
  flowStatus: zLeadFlowStatus.nullable().default(null),
});
export type LeadAnswer = z.infer<typeof zLeadAnswer>;

// GET /api/lead/status — status lead + antrean kerja yang ia tata + sesi yang sedang dipimpin.
export const zLeadProjectStatus = z.object({
  projectId: z.string(), name: z.string(),
  optIn: z.boolean(), paused: z.boolean(),
  decisions24h: z.number(), openSessions: z.number(),
});
export type LeadProjectStatus = z.infer<typeof zLeadProjectStatus>;

export const zLeadStatusView = z.object({
  config: zLead,
  projects: z.array(zLeadProjectStatus),
  queue: z.array(zSchedulerQueueItem),
  deciding: z.array(z.string()),      // id sesi yang sedang disusun keputusannya (AC-3)
  queued: z.array(z.string()).default([]),   // SPEC-479 · id sesi yang menunggu SLOT, bukan manusia
  waiting: z.array(z.string()),       // id sesi ber-marker keputusan terisi
  lastPulseAt: z.string().nullable(),
  // SPEC-479 (QA) · keadaan gerbang konkurensi. Batas yang tak terlihat operator terbaca sebagai
  // "lead diam" — persis salah baca yang melahirkan tiket itu. `.default()` supaya klien lama
  // tetap mem-parse respons ini.
  gate: z.object({
    inFlight: z.number(),
    queued: z.number(),
    capacity: z.number(),
  }).default({ inFlight: 0, queued: 0, capacity: 1 }),
});
export type LeadStatusView = z.infer<typeof zLeadStatusView>;

// SPEC-407 · +goal · sesi dua fase (Goal → Verifikasi) tanpa fase perencanaan sama sekali.
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown", "goal"]);
export type FlowName = z.infer<typeof zFlow>;
// SPEC-237 · satu-satunya pemetaan source → flow (client memakainya saat start sesi).
// qa → audit lalu execute perbaikan; audit → dokumen saja (Audit → Laporan, tanpa Execute).
export function flowForSource(source: string): FlowName {
  return source === "qa" ? "qa"
    : source === "audit" ? "audit"
    // SPEC-407 · goal → sesi dua fase yang langsung mengejar goal item, tanpa perencanaan.
    : source === "goal" ? "goal"
    : "feature";
}

// SPEC-210 · brief awal PRD (sesi prd project-level, tanpa Spec). Disisipkan ke prompt sesi.
export const zPrdBrief = z.object({
  title: z.string().min(1),
  context: z.string(),
  outcome: z.string(),
  constraints: z.string().optional(),
});
export type PrdBrief = z.infer<typeof zPrdBrief>;

// SPEC-210 · item daftar PRD (dokumen docs/prd/*.md). projectId/projectName menyertai tiap item
// agar view lintas-project ("Semua project") bisa mengelompokkan & membuka PRD ke project asalnya.
export const zPrdDoc = z.object({
  slug: z.string(),
  name: z.string(),
  path: z.string(),
  title: z.string(),
  live: z.boolean(),
  projectId: z.string(),
  projectName: z.string(),
  // SPEC-520 · status TURUNAN dari backlog yang lahir dari PRD ini (ADR-0018/0019) — bukan
  // kolom, bukan prosa di dalam dokumennya. `live` di atas menjawab pertanyaan LAIN
  // (freshest-wins dari worktree sesi prd hidup) dan sengaja tetap ortogonal.
  status: zPrdStatus,
  specCount: z.number().int().nonnegative(),
  doneCount: z.number().int().nonnegative(),
});
export type PrdDoc = z.infer<typeof zPrdDoc>;

// SPEC-273 · breakdown PRD → N backlog paralel-independen. Item = brief satu backlog.
export const zBreakdownItem = z.object({
  title: z.string().min(1),
  context: z.string().default(""),
  outcome: z.string().default(""),
  priority: zPriority.default("sedang"),
});
export type BreakdownItem = z.infer<typeof zBreakdownItem>;
// Hasil parse manifest docs/prd/<slug>.breakdown.md (live = dibaca dari worktree sesi breakdown hidup).
export const zBreakdownDoc = z.object({
  items: z.array(zBreakdownItem),
  live: z.boolean(),
});
export type BreakdownDoc = z.infer<typeof zBreakdownDoc>;
// Materialize breakdown → N spec. prdPath dipakai untuk provenance di teks Konteks (tanpa kolom baru).
export const zBatchCreateSpec = z.object({
  project: z.string(),
  items: z.array(zBreakdownItem).min(1),
  branchFrom: z.string().min(1).optional(),
  prdPath: z.string().optional(),
});
export type BatchCreateSpec = z.infer<typeof zBatchCreateSpec>;

// SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit. Ditulis sesi audit sebagai SATU blok
// ```json di dokumen audit SoT (pola manifest breakdown, ADR-0069) lalu dibaca server sebagai
// NILAI TURUNAN (ADR-0018) — bukan kolom DB. Default longgar: manifest ditulis agen, jadi hanya
// `target` yang wajib; sisanya boleh absen.
export const zEscalationTarget = z.enum(["none", "qa", "brief", "prd"]);
export type EscalationTarget = z.infer<typeof zEscalationTarget>;

export const zEscalationPrefill = z.object({
  title: z.string().default(""),
  context: z.string().default(""),
  outcome: z.string().default(""),
  constraints: z.string().default(""),
  severity: z.string().default(""),   // hanya dipakai target qa
  steps: z.string().default(""),      // hanya dipakai target qa
});
export type EscalationPrefill = z.infer<typeof zEscalationPrefill>;

export const zAuditEscalation = z.object({
  target: zEscalationTarget,
  reason: z.string().default(""),
  alternatives: z.array(zEscalationTarget).default([]),
  prefill: zEscalationPrefill.default({}),
});
export type AuditEscalation = z.infer<typeof zAuditEscalation>;

// Respons GET /specs/:id/escalation. escalation null = belum ada rekomendasi terbaca
// (audit pra-SPEC-340, sesi masih berjalan, atau blok json rusak) — keadaan normal, bukan error.
export const zAuditEscalationView = z.object({
  escalation: zAuditEscalation.nullable(),
  docPath: z.string().nullable(),
  live: z.boolean(),
});
export type AuditEscalationView = z.infer<typeof zAuditEscalationView>;

// Sesi terminal dibuka untuk sebuah project (repoDir-nya, terminal biasa) atau untuk sebuah
// backlog item — yang terakhir lahir di worktree-nya sendiri, dengan prompt awal (SPEC-162).
export const zTerminalSession = z.union([
  // SPEC-236 · terminal biasa NON-claude: shell mentah di repoDir project. Tanpa flow (bukan
  // pipeline claude). DIDAHULUKAN: z.object non-strict membuang key asing, jadi bila varian
  // longgar {project,flow?} lebih dulu, {project,shell:true} akan lolos sbg plain (shell dibuang).
  z.object({ project: z.string(), shell: z.literal(true) }),
  // SPEC-166 · "reverse" = sesi project-level di worktree-nya sendiri, menyusun Source of Truth
  // dari kode. TANPA override runtime: sesi project-level mengikuti Setting.agent (ADR-0074).
  // Terminal biasa (tanpa flow) kini punya variannya SENDIRI di bawah — lihat SPEC-517.
  z.object({ project: z.string(), flow: z.literal("reverse") }),
  // SPEC-210 · sesi prd project-level di worktree sendiri; menghasilkan dokumen PRD dari brief.
  // SPEC-340 · ADR-0076 · eskalasi audit → PRD: branchFrom = branch audit (worktree lahir dari sana,
  // resolveCommit + fallback origin/<rev>), fromAudit = id spec audit (isi dokumennya disematkan ke
  // prompt). Keduanya opsional & independen; tanpa keduanya perilaku lama utuh (HEAD, prompt polos).
  z.object({ project: z.string(), flow: z.literal("prd"), brief: zPrdBrief,
    branchFrom: z.string().min(1).optional(), fromAudit: z.string().min(1).optional() }),
  // SPEC-273 · sesi breakdown project-level: pecah SATU PRD (prdPath) → manifest N backlog.
  z.object({ project: z.string(), flow: z.literal("breakdown"), prdPath: z.string().min(1) }),
  // SPEC-222 · scaffold: sesi project-level from-scratch, menyusun SoT dari ide. Tanpa brief
  // (diseed dari Project.desc), tanpa Spec — cermin reverse.
  z.object({ project: z.string(), flow: z.literal("scaffold") }),
  // SPEC-517 · terminal agen biasa: agen (claude|codex) + model + effort boleh dipilih PER SESI,
  // seperti picker Start backlog (ADR-0061/0074). Kosong → default global (Setting).
  // `flow: z.undefined()` BUKAN hiasan: varian ini permisif dan diletakkan SESUDAH semua varian
  // ber-flow, jadi tanpa gerbang itu body flow yang CACAT ({project, flow:"prd"} tanpa brief)
  // akan lolos ke sini dan melahirkan terminal biasa secara senyap alih-alih dijawab 400.
  z.object({
    project: z.string(), flow: z.undefined(),
    agent: zAgent.optional(), model: z.string().optional(), effort: z.string().optional(),
  }),
  // SPEC-252 · ADR-0061 — model & effort per SESI: override opsional saat Start; kosong → global.
  // SPEC-332 · ADR-0073 — mode goal per SESI: `goal` undefined → ikut Setting.goal.enabled,
  // false → mati walau global nyala; `goalCondition` kosong → template global → default bawaan.
  // SPEC-338 · ADR-0074 — agen per SESI: undefined → ikut Setting.agent (default global).
  // SPEC-376 · ADR-0080 — scope verifikasi per SESI: undefined → ikut Setting.verifyScope.
  z.object({
    spec: z.string(), flow: zFlow, model: z.string().optional(), effort: z.string().optional(),
    goal: z.boolean().optional(), goalCondition: z.string().max(4000).optional(),
    agent: zAgent.optional(),
    verifyScope: zVerifyScope.optional(),
    // SPEC-447 · ADR-0093 — lewati gerbang dependency. Hanya jalur manusia; UI hanya
    // mengirimkannya sesudah operator melihat daftar pemblokirnya.
    force: z.boolean().optional(),
  }),
]);

export const zDocFileContent = z.object({ content: z.string() });
export const zDocIndexCat = z.object({
  cat: z.string(), files: z.array(z.string()), linked: z.boolean(),
  scored: z.boolean(), root: z.boolean().optional() });
export const zDocIndex = z.object({ coverage: z.number(), tree: z.array(zDocIndexCat) });

// SPEC-164 · modul VPS. host/user masuk ke argv ssh dan (user) ke string perintah
// `sudo -n env SSH_USER=…` — regex ini trust boundary, bukan kosmetik.
const HOST_RE = /^[A-Za-z0-9._-]+$/;
const USER_RE = /^[a-z_][a-z0-9_-]*$/i;
export const zCreateVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535).default(22),
  keyPath: z.string().min(1).optional(),
  // SPEC-165 · transien: dipakai sekali untuk memasang key hanoman, lalu dibuang.
  // TIDAK PERNAH disimpan, di-log, atau dikembalikan. Bila diisi, `keyPath` diabaikan.
  password: z.string().min(1).optional(),
});
// Tanpa default: PATCH {name} tak boleh diam-diam mengembalikan port ke 22.
export const zPatchVps = z.object({
  name: z.string().min(1), host: z.string().min(1).regex(HOST_RE),
  user: z.string().min(1).regex(USER_RE),
  port: z.number().int().min(1).max(65535),
  keyPath: z.string().min(1).nullable(), // null = kembali ke key default server
  password: z.string().min(1),           // SPEC-165 · diisi = bootstrap ulang
}).partial();
// SPEC-169 · auth. Tanpa RBAC — semua user setara. Password min 8 saat dibuat/diubah;
// login menerima min 1 (validasi asli lewat verify hash, error selalu generic).
export const zLogin = z.object({ email: z.string().email(), password: z.string().min(1) });
export const zSignup = z.object({ email: z.string().email(), password: z.string().min(8) });
export const zChangePassword = z.object({
  currentPassword: z.string().min(1), newPassword: z.string().min(8) });
export type UserView = { id: string; email: string; createdAt: string };
export type AuthStatus = { needsSetup: boolean; user: UserView | null };

export const zVpsCheck = z.object({
  check: z.string(), status: z.enum(["pass", "fail", "warn", "na"]), detail: z.string() });
export type VpsCheck = z.infer<typeof zVpsCheck>;
export type VpsHealth = { uptime: string; disk: string; mem: string; load: string };
export type VpsView = {
  id: string; name: string; host: string; port: number; user: string; keyPath: string | null;
  createdAt: string; lastSeenAt: string | null; health: VpsHealth | null;
  lastAuditAt: string | null; audit: VpsCheck[] | null; hardened: boolean;
};

// SPEC-220 · checklist kepatuhan (katalog 232 item + status per VPS). Server menghidrasi penuh
// (frontend tak mengimpor katalog server). Lihat internal/docs/architecture/vps-compliance.md.
export type VpsItemStatus = "pass" | "fail" | "warn" | "na" | "unknown";
export type VpsMode = "AUTO" | "AUDIT" | "INFO";
export type VpsSeverity = "critical" | "high" | "medium" | "low";
export type ChecklistItem = {
  id: string; section: string; sectionTitle: string; level: string; title: string; code?: string;
  mode: VpsMode; severity: VpsSeverity; probe: boolean; remediable: boolean; appLayer: boolean;
  status: VpsItemStatus; na: boolean; attested: boolean;
  drifted: boolean; // SPEC-221 · regresi pass→fail/warn sejak snapshot sebelumnya (AC-19)
  actorEmail: string | null; naReason: string | null; attestNote: string | null;
};
// SPEC-221 · suggestion = saran applicability app-layer (advisory). applicable:false → sarankan N/A.
export type ChecklistSuggestion = { applicable: boolean; detail: string };
export type ChecklistSection = {
  id: string; title: string; icon: string; score: number;
  suggestion?: ChecklistSuggestion; items: ChecklistItem[] };
export type ChecklistView = {
  vpsId: string; scoreTotal: number; scoreBySection: Record<string, number>;
  lastAuditAt: string | null; sections: ChecklistSection[];
};

// SPEC-220 · body request untuk aksi item & remediasi
export const zMarkNa = z.object({ na: z.boolean(), reason: z.string().max(500).optional() });
// SPEC-221 · tandai N/A banyak item sekaligus (untuk "tandai seksi N/A" advisory app-layer)
export const zMarkNaBulk = z.object({
  itemIds: z.array(z.string()).min(1).max(64), na: z.boolean(), reason: z.string().max(500).optional() });
export const zAttest = z.object({ note: z.string().max(500).optional() });
export const zRemediate = z.object({ items: z.array(z.string()).min(1).max(64) });

// SPEC-220 · satu langkah remediasi. `would` = dry-run (tak menyentuh VPS), ok/fail = apply.
export type RemediateStep = { item: string; status: "would" | "ok" | "fail"; detail: string };

// SPEC-181 · limit langganan Claude realtime (dari GET /api/oauth/usage → limits[])
export type LimitSeverity = "normal" | "warning" | "critical";
export type LimitsStatus = "ok" | "stale" | "unavailable";
export type LimitWindow = {
  key: string;               // "session" | "weekly_all" | "weekly_scoped:Opus"
  label: string;             // "Sesi 5 jam" | "Mingguan" | "Mingguan Opus"
  usedPct: number;           // 0..100 (dibulatkan dari `percent`)
  resetsAt: string | null;   // ISO 8601 (`resets_at`) atau null
  severity: LimitSeverity;   // API `severity`; fallback dari usedPct bila hilang
  isActive: boolean;         // API `is_active` — window yang sedang mengikat
};
export type LimitsDTO = {
  status: LimitsStatus;
  windows: LimitWindow[];
  fetchedAt: string | null;  // ISO waktu fetch sukses terakhir; null bila belum pernah
};

// SPEC-338 · ADR-0074 · limit codex. Bentuknya sama (window dipakai ulang) tapi SUMBERNYA beda dan
// itu penting: limit claude = panggilan API live tiap 30 dtk; limit codex = SNAPSHOT terakhir yang
// codex sendiri tulis ke rollout sesinya (`rate_limits`) — tak ada endpoint kuota yang dipanggil,
// tak ada token codex yang disentuh. Karena itu `fetchedAt` di sini = waktu SNAPSHOT, bukan waktu
// baca, dan `stale` berarti "belum ada sesi codex baru", bukan "fetch gagal".
export type CodexLimitsDTO = {
  status: LimitsStatus;
  windows: LimitWindow[];
  fetchedAt: string | null;  // ISO timestamp snapshot codex; null bila belum pernah ada
  plan: string | null;       // `plan_type` codex (mis. "pro"); null bila tak dilaporkan
};

// SPEC-398 · ADR-0087 · versi hanoman = semver paket npm (dulu SHA git, SPEC-214).
// SPEC-405 · ADR-0088 · panel tak lagi murni read-only: bila proses server ini anak dari
// `hanoman start`, ia boleh MEMINTA dipasang ulang. `command` tetap ada — ia satu-satunya
// jalan saat tak ada supervisor.
export type UpdateRegistryStatus = "ok" | "unavailable";  // unavailable = offline / opt-out / paket belum terbit
export type UpdateStatus = {
  currentVersion: string;                 // versi yang sedang berjalan (build-info.json → package.json)
  latestVersion: string | null;           // versi terbaru di registry; null bila tak terbaca
  registry: { status: UpdateRegistryStatus; checkedAt: string | null };
  updateAvailable: boolean;               // compareSemver(latest, current) > 0
  command: string;                        // "npm i -g hanoman@latest"; "" bila sudah terkini
  // SPEC-405 · ADR-0088 · true HANYA bila env HANOMAN_SUPERVISOR=1 (disuntik `hanoman start`).
  // Konstan seumur proses, jadi aman ikut frame siar `update` yang di-recompute tiap 300 dtk.
  canApply: boolean;
};

// SPEC-405 · ADR-0088 · kode keluar sentinel: "aku minta dipasang ulang". Server yang keluar,
// supervisor `hanoman start` yang membacanya lalu memasang + menjalankan ulang. 75 = EX_TEMPFAIL —
// non-zero, jadi `Restart=on-failure` di unit systemd yang didokumentasikan tetap masuk akal.
export const UPDATE_RESTART_EXIT = 75;

// Dua langkah sengaja: tanpa `confirm` endpoint hanya melapor (dry-run), dengan `confirm` ia
// benar-benar keluar. Nilai non-boolean DITOLAK — "ya"/1 tak boleh terbaca sebagai persetujuan.
export const zUpdateApplyBody = z.object({ confirm: z.boolean().optional() });
export type UpdateApplyBody = z.infer<typeof zUpdateApplyBody>;

// SPEC-199 · bentuk sesi di wire (cermin services/pty.ts SessionInfo & client TerminalSession).
export type SessionDTO = {
  id: string; projectId: string; specId?: string; flow?: string; cwd: string;
  branch?: string; exited: boolean; decision: boolean;   // SPEC-230 · branch integrasi sesi (PRD: prd/<slug>)
  // SPEC-402 · kode keluar pane MATI; undefined selama pane hidup. `exited` sendirian tak bisa
  // membedakan sesi yang tuntas dari agen yang dihentikan di tengah kerja.
  exitCode?: number;
};

// SPEC-199 · frame siar dashboard (server → klien), lewat GET /events/ws (ADR-0039). Read-only
// feed: tak ada frame klien → server. Per-grup, bukan snapshot monolitik — perubahan satu grup
// tak mengirim ulang yang lain.
export type EventMsg =
  | { t: "specs"; specs: Spec[] }
  | { t: "sessions"; sessions: SessionDTO[] }
  // SPEC-523 · `total` ikut disiarkan: bell menampilkan 50 teratas, dan tanpa angka ini 50 itu
  // terbaca sebagai "semuanya". Bentuk daftar frame tak berubah (tetap 50 teratas).
  | { t: "notifications"; items: Notification[]; unread: number; total: number; page: number; pageSize: number }
  | { t: "limits"; limits: LimitsDTO }
  | { t: "codexLimits"; limits: CodexLimitsDTO }   // SPEC-338 · ADR-0074 · grup terpisah dari `limits`
  | { t: "vps"; vps: VpsView[] }
  | { t: "update"; update: UpdateStatus };

// SPEC-253 · Help Center — DTO triase + halaman publik.
export const zTicketView = z.object({
  id: z.string(), projectId: z.string(), number: z.number().int(),
  category: z.string(), title: z.string(), reporterEmail: z.string(),
  status: z.string(), specId: z.string().nullable(), attachmentCount: z.number().int(),
  createdAt: z.string(),
});
export type TicketView = z.infer<typeof zTicketView>;
export const zTicketAttachmentView = z.object({
  id: z.string(), filename: z.string(), mimeType: z.string(), size: z.number().int(),
});
export type TicketAttachmentView = z.infer<typeof zTicketAttachmentView>;
export const zTicketDetail = zTicketView.extend({
  detail: z.string(),
  attachments: z.array(zTicketAttachmentView),
  spec: zSpec.nullable(),                 // SPEC-293 · backlog tertaut (stage → status turunan)
  publicStatusUrl: z.string(),            // SPEC-293 · link publik status tiket (shareToken)
});
export type TicketDetail = z.infer<typeof zTicketDetail>;
// SPEC-269 · input edit tiket (triase). Semua field opsional; minimal satu.
export const zTicketEditInput = z
  .object({
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(20000),
    category: zTicketCategory,
    status: zTicketStatus,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "tak ada field yang diubah" });
export type TicketEditInput = z.infer<typeof zTicketEditInput>;
// halaman publik (tak butuh auth)
export const zHelpInfo = z.object({ projectName: z.string(), categories: z.array(z.string()) });
export type HelpInfo = z.infer<typeof zHelpInfo>;
export const zPublicTicketStatus = z.object({
  number: z.number().int(), category: z.string(), title: z.string(),
  status: z.string(), createdAt: z.string(),
});
export type PublicTicketStatus = z.infer<typeof zPublicTicketStatus>;
