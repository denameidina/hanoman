/* SPEC-1215 §S4.7 · ADR-0166 §3 · enam langkah ingest hub: redaksi lapis 2 → transkrip (tmp+rename,
   Task 12 memanggilnya sebelum transaksi) → transaksi high-water mark LogCursor → kuota. Nol
   skipDuplicates/upsert-per-baris (ditolak ADR-0166) — saring seq>cursor lalu createMany. */
import { redactText, redactValue, type LogBatch, LOG_INGEST_MAX_PER_HOUR } from "@hanoman/shared";
import { prisma } from "../../db";
import { knownSecrets } from "./redact-known";

type IngestResult = {
  status: 200 | 400 | 413 | 429;
  body: { lane?: string; accepted?: number; duplicate?: number; lastSeq?: string; error?: string; retryAfterSec?: number };
};

const QUOTA_WINDOW_MS = 3_600_000;
let quota = new Map<string, { windowStart: number; count: number }>();

function checkQuota(deviceId: string, n: number, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
  let w = quota.get(deviceId);
  if (!w || now - w.windowStart >= QUOTA_WINDOW_MS) { w = { windowStart: now, count: 0 }; quota.set(deviceId, w); }
  if (w.count + n > LOG_INGEST_MAX_PER_HOUR) {
    return { ok: false, retryAfterSec: Math.ceil((w.windowStart + QUOTA_WINDOW_MS - now) / 1000) };
  }
  w.count += n;
  return { ok: true };
}

export async function ingestBatch(deviceId: string, batch: LogBatch): Promise<IngestResult> {
  const { lane, entries } = batch;
  // seq naik ketat dalam batch.
  for (let i = 1; i < entries.length; i++) {
    if (BigInt(entries[i]!.seq) <= BigInt(entries[i - 1]!.seq)) return { status: 400, body: { error: "seq tak naik ketat" } };
  }
  const now = Date.now();
  const q = checkQuota(deviceId, entries.length, now);
  if (!q.ok) return { status: 429, body: { error: "quota", retryAfterSec: q.retryAfterSec } };

  const known = knownSecrets();
  const redacted: typeof entries = [];
  let gapCount = 0;
  for (const e of entries) {
    try {
      redacted.push({ ...e, msg: redactText(e.msg, known), data: e.data ? redactValue(e.data, known) : e.data });
    } catch {
      gapCount++;
    }
  }
  if (gapCount > 0) {
    await prisma.logEntry.create({
      data: {
        deviceId, lane: "event", seq: BigInt(Date.now()) * 1000n, ts: new Date(), level: "warn",
        kind: "log.gap", msg: "celah log: redaction-failed",
        data: { lost: gapCount, reason: "redaction-failed" }, bytes: 64,
      },
    }).catch(() => {});
  }
  if (redacted.length === 0) return { status: 200, body: { lane, accepted: 0, duplicate: 0, lastSeq: "0" } };

  const result = await prisma.$transaction(async (tx) => {
    const cursor = await tx.logCursor.findUnique({ where: { deviceId_lane: { deviceId, lane } } });
    const hwm = cursor?.seq ?? 0n;
    const fresh = redacted.filter((e) => BigInt(e.seq) > hwm);
    const duplicate = redacted.length - fresh.length;
    if (fresh.length > 0) {
      await tx.logEntry.createMany({
        data: fresh.map((e) => ({
          deviceId, lane, seq: BigInt(e.seq), ts: new Date(e.ts), level: e.level, kind: e.kind,
          projectId: e.projectId ?? null, specId: e.specId ?? null, sessionId: e.sessionId ?? null,
          msg: e.msg, data: e.data ?? undefined, bytes: Buffer.byteLength(e.msg, "utf8"),
        })),
      });
      const lastSeq = BigInt(fresh[fresh.length - 1]!.seq);
      await tx.logCursor.upsert({
        where: { deviceId_lane: { deviceId, lane } }, update: { seq: lastSeq },
        create: { deviceId, lane, seq: lastSeq },
      });
    }
    return { accepted: fresh.length, duplicate, lastSeq: (cursor?.seq ?? (fresh.length ? BigInt(fresh[fresh.length - 1]!.seq) : 0n)).toString() };
  });
  return { status: 200, body: { lane, ...result } };
}

export function __resetIngestQuota(): void { quota = new Map(); }
