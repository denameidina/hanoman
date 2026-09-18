/* SPEC-1215 §S4.7 · ADR-0166 §2 · dikuras syncTick() yang SUDAH ADA — TANPA timer baru. Per lajur,
   ≤ LOG_SHIP_MAX_BATCHES_PER_TICK batch @ ≤ LOG_BATCH_MAX_ENTRIES. ack 200 → LogCursor("local")
   maju; 400 → gap; 404 → tunda LOG_UNSUPPORTED_RETRY_MS; 429 → tunda retryAfterSec (lajur itu saja). */
import {
  LOCAL_DEVICE_ID, LOG_BATCH_MAX_ENTRIES, LOG_LANES, LOG_SHIP_MAX_BATCHES_PER_TICK,
  LOG_UNSUPPORTED_RETRY_MS, type LogLane, type LogWireEntry,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { readSpoolSegments, removeSpoolSegment } from "./spool";
import { appendGap } from "./event-log";
// Type-only: tak menimbulkan siklus runtime (sync-client.ts mengimpor shipLogs dari modul ini).
import type { Transport } from "../sync-client";

const pausedUntil = new Map<LogLane, number>();

async function loadCursor(lane: LogLane): Promise<bigint> {
  const c = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: LOCAL_DEVICE_ID, lane } } });
  return c?.seq ?? 0n;
}

async function nextBatch(lane: LogLane, since: bigint): Promise<LogWireEntry[]> {
  if (lane === "server") {
    const segs = await readSpoolSegments("server");
    const flat = segs.flatMap((s) => s.entries);
    return flat.slice(0, LOG_BATCH_MAX_ENTRIES);
  }
  const rows = await prisma.logEntry.findMany({
    where: { deviceId: LOCAL_DEVICE_ID, lane, seq: { gt: since } }, orderBy: { seq: "asc" }, take: LOG_BATCH_MAX_ENTRIES,
  });
  return rows.map((r) => ({
    seq: r.seq.toString(), ts: r.ts.toISOString(), level: r.level as LogWireEntry["level"], kind: r.kind,
    projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    msg: r.msg, data: r.data as Record<string, unknown> | null,
  }));
}

async function shipLane(lane: LogLane, transport: Transport): Promise<void> {
  const now = Date.now();
  if ((pausedUntil.get(lane) ?? 0) > now) return;
  let since = await loadCursor(lane);
  for (let i = 0; i < LOG_SHIP_MAX_BATCHES_PER_TICK; i++) {
    const entries = await nextBatch(lane, since);
    if (entries.length === 0) return;
    const res = await transport("POST", "/api/sync/logs", { lane, entries });
    if (res.status === 200) {
      const body = res.body as { lastSeq?: string };
      const last = body.lastSeq ? BigInt(body.lastSeq) : BigInt(entries[entries.length - 1]!.seq);
      await prisma.logCursor.upsert({
        where: { deviceId_lane: { deviceId: LOCAL_DEVICE_ID, lane } }, update: { seq: last },
        create: { deviceId: LOCAL_DEVICE_ID, lane, seq: last },
      });
      since = last;
      if (lane === "server") {
        const segs = await readSpoolSegments("server");
        for (const s of segs) if (s.entries.every((e) => BigInt(e.seq) <= last)) await removeSpoolSegment(s.file);
      }
      continue;
    }
    if (res.status === 400) { await appendGap("rejected"); since = BigInt(entries[entries.length - 1]!.seq); continue; } // anti-livelock ADR-0082
    if (res.status === 404) { pausedUntil.set(lane, now + LOG_UNSUPPORTED_RETRY_MS); return; }
    if (res.status === 429) {
      const retry = (res.body as { retryAfterSec?: number }).retryAfterSec ?? 60;
      pausedUntil.set(lane, now + retry * 1000);
      return;
    }
    return; // 413/5xx: hentikan lajur ini untuk tick ini, coba lagi tick berikutnya
  }
}

/** Dipanggil dari syncTick() SESUDAH syncOnce(); fire-and-forget di sisi pemanggil (K11/AC-M2). */
export async function shipLogs(transport: Transport): Promise<void> {
  for (const lane of LOG_LANES) {
    try { await shipLane(lane, transport); } catch (e) { console.warn(`shipper ${lane} gagal: ${(e as Error).message}`); }
  }
}

export function __resetShipperPause(): void { pausedUntil.clear(); }
