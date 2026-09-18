/* SPEC-1215 §S4.8 · kursor opaque base64url({ts,id}), LIKE Prisma biasa (tanpa FTS/raw SQL).
   TANPA `total` (pengecualian keempat ADR-0107, dikunci ADR-0166 §7). */
import type { LogEntryView, LogSearchQuery } from "@hanoman/shared";
import { prisma } from "../../db";
import { toLogEntryView } from "./event-log";
import { readTranscript } from "../transcript-store";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDirs } from "@hanoman/runner";

function decodeCursor(c?: string): { ts: string; id: number } | null {
  if (!c) return null;
  try { return JSON.parse(Buffer.from(c, "base64url").toString("utf8")); } catch { return null; }
}
function encodeCursor(ts: string, id: number): string {
  return Buffer.from(JSON.stringify({ ts, id }), "utf8").toString("base64url");
}

export async function searchLogs(q: LogSearchQuery): Promise<{ items: LogEntryView[]; nextCursor: string | null } | null> {
  const cur = decodeCursor(q.cursor);
  if (q.cursor && !cur) return null; // kursor cacat → pemanggil (route) membalas 400
  const levelOrder = ["debug", "info", "warn", "error"] as const;
  const minLevels = q.level ? levelOrder.slice(levelOrder.indexOf(q.level)) : undefined;
  const where = {
    ts: { gte: new Date(q.from), lte: new Date(q.to) },
    ...(q.deviceId ? { deviceId: q.deviceId } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.specId ? { specId: q.specId } : {}),
    ...(q.lane ? { lane: { in: q.lane.split(",") } } : {}),
    ...(minLevels ? { level: { in: minLevels } } : {}),
    ...(q.kind ? { kind: { startsWith: q.kind } } : {}),
    ...(q.q ? { msg: { contains: q.q } } : {}),
    ...(cur ? { OR: [{ ts: { lt: new Date(cur.ts) } }, { ts: new Date(cur.ts), id: { lt: cur.id } }] } : {}),
  };
  const rows = await prisma.logEntry.findMany({ where, orderBy: [{ ts: "desc" }, { id: "desc" }], take: q.limit });
  const items = rows.map(toLogEntryView);
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === q.limit && last ? encodeCursor(last.ts.toISOString(), last.id) : null;
  return { items, nextCursor };
}

export async function readRemoteTranscript(id: number): Promise<string | null> {
  const row = await prisma.logEntry.findUnique({ where: { id } });
  if (!row || row.lane !== "transcript" || !row.transcriptKey) return null;
  if (row.deviceId === "local") return readTranscript(row.transcriptKey);
  const path = join(resolveDataDirs().home, "remote-transcripts", row.transcriptKey);
  try { return await readFile(path, "utf8"); } catch { return null; }
}
