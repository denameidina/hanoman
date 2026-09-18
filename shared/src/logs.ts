import { z } from "zod";

/* SPEC-1215 · ADR-0166 · kontrak log terpusat. Turunan A memakai lajur `event` untuk audit lokal;
   ingest, pengiriman, dan pencarian (beserta konstanta batch/spool/kuota) ditambahkan SPEC-1217. */

export const LOG_LANES = ["event", "server", "transcript"] as const;
export const zLogLane = z.enum(LOG_LANES);
export type LogLane = z.infer<typeof zLogLane>;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const zLogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof zLogLevel>;

export const LOG_MSG_MAX_BYTES = 4 * 1024;
export const LOG_DATA_MAX_BYTES = 8 * 1024;

/** `max(seqTerakhir + 1, now × 1000)`: monoton lintas restart DAN instal ulang ber-token sama tanpa
    menulis penghitung per baris; ≈ 1,8 × 10¹⁵ masih integer aman JS. Autoincrement lokal ditolak
    karena reset saat instal ulang, dan hub akan menolak semua entrinya sebagai duplikat senyap. */
export function nextSeq(last: number, now: number): number {
  return Math.max(last + 1, Math.floor(now) * 1000);
}

export type LogEntryView = {
  id: number; deviceId: string; deviceName: string; lane: LogLane;
  /** BigInt di DB → string di kawat: JSON tak punya bigint. */
  seq: string; ts: string; receivedAt: string; level: LogLevel; kind: string;
  projectId: string | null; specId: string | null; sessionId: string | null;
  msg: string; data: Record<string, unknown> | null; hasTranscript: boolean;
};

export const LOG_SHIPPING_DEFAULTS = { event: true, server: false, transcript: false };
export const zLogShipping = z.object({
  event: z.boolean().default(true),
  server: z.boolean().default(false),
  transcript: z.boolean().default(false),
});
export type LogShipping = z.infer<typeof zLogShipping>;

export const LOG_RETENTION_DEFAULTS = { eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 256 * 1024 ** 2 };
const days = (d: number) => z.number().int().min(1).max(365).default(d);
export const zLogRetention = z.object({
  eventDays: days(90), serverDays: days(7), transcriptDays: days(30),
  maxBytes: z.number().int().min(16 * 1024 ** 2).max(4 * 1024 ** 3).default(256 * 1024 ** 2),
});
export type LogRetention = z.infer<typeof zLogRetention>;

export const LOG_BATCH_MAX_ENTRIES = 500;
export const LOG_BODY_MAX_BYTES = 1 * 1024 * 1024;
export const LOG_DECODED_MAX_BYTES = 2 * 1024 * 1024;
export const LOG_TRANSCRIPT_MAX_BYTES = 1 * 1024 * 1024;
export const LOG_SPOOL_MAX_BYTES = 64 * 1024 * 1024;
export const LOG_SPOOL_SEGMENT_BYTES = 1 * 1024 * 1024;
export const LOG_LOCAL_PENDING_MAX_ROWS = 50_000;
export const LOG_REPEAT_WINDOW_MS = 60_000;
export const LOG_INGEST_MAX_PER_HOUR = 20_000;
export const LOG_SEARCH_MAX_RANGE_DAYS = 31;
export const LOG_SEARCH_MAX_LIMIT = 200;
export const LOG_SHIP_MAX_BATCHES_PER_TICK = 4;
export const LOG_UNSUPPORTED_RETRY_MS = 30 * 60_000;

// §S4.7 SPEC-1215 · satu baris pada kawat, sebelum diserap ke LogEntry hub.
export const zLogWireEntry = z.object({
  seq: z.string().regex(/^\d+$/),
  ts: z.string().datetime(),
  level: zLogLevel,
  kind: z.string().min(1).max(64),
  projectId: z.string().nullish(),
  specId: z.string().nullish(),
  sessionId: z.string().nullish(),
  msg: z.string().max(LOG_MSG_MAX_BYTES),
  data: z.record(z.unknown()).nullish(),
  transcript: z.string().max(LOG_TRANSCRIPT_MAX_BYTES).nullish(),
}).strict();
export type LogWireEntry = z.infer<typeof zLogWireEntry>;

export const zLogBatch = z.object({
  lane: zLogLane,
  entries: z.array(zLogWireEntry).min(1).max(LOG_BATCH_MAX_ENTRIES),
}).strict();
export type LogBatch = z.infer<typeof zLogBatch>;

// §S4.8 · GET /api/logs — rentang wajib ≤ 31 hari, kursor opaque, tanpa `total` (ADR-0107 exc. #4).
export const zLogSearchQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  deviceId: z.string().optional(),
  projectId: z.string().optional(),
  specId: z.string().optional(),
  lane: z.string().optional(),
  level: zLogLevel.optional(),
  kind: z.string().optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LOG_SEARCH_MAX_LIMIT).default(LOG_SEARCH_MAX_LIMIT),
}).strict().refine((v) => Date.parse(v.to) >= Date.parse(v.from), { message: "to < from" })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= LOG_SEARCH_MAX_RANGE_DAYS * 86_400_000,
    { message: `rentang > ${LOG_SEARCH_MAX_RANGE_DAYS} hari` });
export type LogSearchQuery = z.infer<typeof zLogSearchQuery>;
