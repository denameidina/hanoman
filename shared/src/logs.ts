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
