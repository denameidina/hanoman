import { z } from "zod";
import { zAgentEngine } from "./agent-engine";
import { zAgent } from "./enums";

// SPEC-476 · ADR-0096 · Telegram hanya kanal ke sesi operator. Master switch opt-in;
// progress kanal aktif secara default setelah operator menyalakan gateway.
// SPEC-492 · `engine` = runtime/model/effort KHUSUS sesi operator Telegram. Bebannya beda jauh
// dari sesi kerja (baca API lalu rangkum, bukan tulis kode), jadi ia boleh punya setelan sendiri.
// Opt-in, default MATI → instalasi yang sudah jalan tetap mewarisi default global sesudah upgrade.
export const zTelegramSettings = z.object({
  enabled: z.boolean().default(false),
  progress: z.boolean().default(true),
  engine: zAgentEngine.default({}),
});
export type TelegramSettings = z.infer<typeof zTelegramSettings>;
export const TELEGRAM_DEFAULTS: TelegramSettings = zTelegramSettings.parse({});

/**
 * SPEC-477 · ADR-0097 · pola kredensial. Gerbang TULIS saja — nilai yang datang dari `.env`
 * sengaja tak divalidasi: instance yang hidup hari ini dengan token berbentuk tak terduga harus
 * tetap hidup.
 */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
/** Channel & supergroup NEGATIF — `^\d+$` akan menolak persis kasus "Channel ID". */
export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d+$/;
/** Allowlist adalah numeric USER id: selalu non-negatif, dipisah koma/spasi. */
export const TELEGRAM_ALLOWLIST_PATTERN = /^\d+(?:[\s,]+\d+)*$/;

export const TELEGRAM_CONFIG_KEYS = [
  "HANOMAN_TELEGRAM_BOT_TOKEN",
  "HANOMAN_TELEGRAM_AGENT_TOKEN",
  "HANOMAN_TELEGRAM_ALLOWED_USER_IDS",
  "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
] as const;
export type TelegramConfigKey = (typeof TELEGRAM_CONFIG_KEYS)[number];

export const zTelegramReadiness = z.enum([
  "disabled", "misconfigured", "ready", "running", "error",
]);

export const zTelegramGatewayStatus = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  running: z.boolean(),
  readiness: zTelegramReadiness,
  botUsername: z.string().min(1).nullable().default(null),
  allowlistCount: z.number().int().min(0),
  agentTokenConfigured: z.boolean(),
  missingCapabilities: z.array(z.string()).default([]),
  lastUpdateAt: z.string().datetime().nullable().default(null),
  lastError: z.string().nullable().default(null),
});
export type TelegramGatewayStatus = z.infer<typeof zTelegramGatewayStatus>;

export const zTelegramMemoryRecord = z.object({
  id: z.string().min(1),
  chatId: z.string().min(1),
  content: z.string().trim().min(1).max(1_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TelegramMemoryRecord = z.infer<typeof zTelegramMemoryRecord>;

export const zTelegramChatContext = z.object({
  chatId: z.string().min(1),
  userId: z.string().min(1),
  sessionId: z.string().nullable(),
  activeProjectId: z.string().nullable(),
  activeSessionId: z.string().nullable(),
  personalityAgentId: z.string().nullable(),
  summary: z.string().max(4_000).nullable(),
  agent: zAgent,
  model: z.string().min(1),
  effort: z.string().min(1),
  memories: z.array(zTelegramMemoryRecord),
});
export type TelegramChatContext = z.infer<typeof zTelegramChatContext>;

export const TELEGRAM_REPLY_KINDS = [
  "progress", "final", "decision", "failure", "confirmation",
] as const;
export const zTelegramReplyKind = z.enum(TELEGRAM_REPLY_KINDS);

export const zTelegramConfirmationRequest = z.object({
  description: z.string().trim().min(1).max(500),
  method: z.enum(["POST", "PATCH", "PUT", "DELETE"]),
  path: z.string().startsWith("/api/").max(1_000),
});

export const zTelegramReplyInput = z.object({
  chatId: z.string().min(1),
  updateId: z.number().int().nonnegative(),
  kind: zTelegramReplyKind,
  text: z.string().trim().min(1).max(12_000),
  summary: z.string().trim().min(1).max(4_000).optional(),
  remember: z.array(z.string().trim().min(1).max(1_000)).max(20).optional(),
  confirmation: zTelegramConfirmationRequest.optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "confirmation" && !value.confirmation) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmation"], message: "confirmation required" });
  }
  if (value.kind !== "confirmation" && value.confirmation) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmation"], message: "confirmation only valid for confirmation replies" });
  }
});
export type TelegramReplyInput = z.infer<typeof zTelegramReplyInput>;

export const zTelegramAuditRecord = z.object({
  id: z.string().min(1),
  chatId: z.string().nullable(),
  userId: z.string().nullable(),
  updateId: z.number().int().nonnegative().nullable(),
  action: z.string().min(1),
  outcome: z.string().min(1),
  correlationId: z.string().nullable(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  statusCode: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type TelegramAuditRecord = z.infer<typeof zTelegramAuditRecord>;

export const zTerminalSteerInput = z.object({
  text: z.string().trim().min(1).max(16_000),
});
export type TerminalSteerInput = z.infer<typeof zTerminalSteerInput>;

/** Rename sesi terminal: nama kustom operator. String kosong = hapus nama kustom (kembali ke label turunan). */
export const SESSION_NAME_MAX = 80;
export const zTerminalRenameInput = z.object({ name: z.string().max(SESSION_NAME_MAX * 4) });
export type TerminalRenameInput = z.infer<typeof zTerminalRenameInput>;
