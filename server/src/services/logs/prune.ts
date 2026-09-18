/* SPEC-1215 §S3.6 · pola sama dengan reconcileTranscripts (session-history.ts): baris dulu, berkas
   transkrip sesudahnya, yatim dipungut. Local ("deviceId":"local") belum-ack tak pernah tersapu
   umur (AC-S7) — disaring lewat LogCursor("local", lane) sebagai batas atas seq yang boleh dihapus. */
import type { LogRetention } from "@hanoman/shared";
import { prisma } from "../../db";
import { deleteTranscript } from "../transcript-store";

const LANE_DAYS: Record<string, keyof LogRetention> = { event: "eventDays", server: "serverDays", transcript: "transcriptDays" };
const CHUNK = 5_000;

export async function pruneLogs(
  now: Date, retention: LogRetention, opts: { dryRun?: boolean } = {},
): Promise<{ logsPruned: number; logBytesFreed: number }> {
  let logsPruned = 0, logBytesFreed = 0;

  for (const [lane, key] of Object.entries(LANE_DAYS)) {
    const cutoff = new Date(now.getTime() - retention[key] * 86_400_000);
    const localCursor = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: "local", lane } } });
    const ackSeq = localCursor?.seq ?? -1n; // -1 → nol baris local terhapus (belum pernah ack)
    for (;;) {
      const batch = await prisma.logEntry.findMany({
        where: {
          lane, ts: { lt: cutoff },
          OR: [{ deviceId: { not: "local" } }, { deviceId: "local", seq: { lte: ackSeq } }],
        },
        take: CHUNK, select: { id: true, bytes: true, transcriptKey: true },
      });
      if (batch.length === 0) break;
      if (!opts.dryRun) {
        await prisma.logEntry.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
        for (const b of batch) if (b.transcriptKey && !b.transcriptKey.includes("/")) await deleteTranscript(b.transcriptKey).catch(() => {});
      }
      logsPruned += batch.length;
      logBytesFreed += batch.reduce((s, b) => s + b.bytes, 0);
      if (batch.length < CHUNK) break;
    }
  }

  // Plafon bytes total, terlepas dari lajur/umur: hapus terlama sampai di bawah maxBytes.
  for (;;) {
    const agg = await prisma.logEntry.aggregate({ _sum: { bytes: true } });
    const total = agg._sum.bytes ?? 0;
    if (total <= retention.maxBytes) break;
    const batch = await prisma.logEntry.findMany({
      orderBy: [{ ts: "asc" }, { id: "asc" }], take: CHUNK, select: { id: true, bytes: true, transcriptKey: true },
    });
    if (batch.length === 0) break;
    let freed = 0;
    const toDelete: number[] = [];
    for (const b of batch) {
      if (total - freed <= retention.maxBytes) break;
      toDelete.push(b.id); freed += b.bytes;
      if (b.transcriptKey && !b.transcriptKey.includes("/")) await deleteTranscript(b.transcriptKey).catch(() => {});
    }
    if (toDelete.length === 0) break;
    if (!opts.dryRun) await prisma.logEntry.deleteMany({ where: { id: { in: toDelete } } });
    logsPruned += toDelete.length; logBytesFreed += freed;
  }

  return { logsPruned, logBytesFreed };
}

/** Berkas `remote-transcripts/<deviceId>/<seq>.txt` tanpa baris `LogEntry.transcriptKey` yang
    merujuknya (pola `reconcileTranscripts`, `session-history.ts:170-200`, termasuk tenggang). */
export async function reconcileRemoteTranscripts(): Promise<{ orphans: number }> {
  const { readdir, unlink, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { resolveDataDirs } = await import("@hanoman/runner");
  const root = join(resolveDataDirs().home, "remote-transcripts");
  let deviceDirs: string[];
  try { deviceDirs = await readdir(root); } catch { return { orphans: 0 }; }
  const rows = await prisma.logEntry.findMany({ where: { transcriptKey: { contains: "/" } }, select: { transcriptKey: true } });
  const referenced = new Set(rows.map((r) => r.transcriptKey!));
  const gracePeriodMs = 60 * 60_000;
  let orphans = 0;
  for (const dev of deviceDirs) {
    let files: string[];
    try { files = await readdir(join(root, dev)); } catch { continue; }
    for (const f of files) {
      const key = `${dev}/${f}`;
      if (referenced.has(key)) continue;
      const st = await stat(join(root, dev, f)).catch(() => null);
      if (!st || Date.now() - st.mtimeMs < gracePeriodMs) continue;
      await unlink(join(root, dev, f)).catch(() => {});
      orphans++;
    }
  }
  return { orphans };
}
