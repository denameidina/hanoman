import { prisma } from "../db";
import { deleteTranscript as deleteTranscriptFile } from "./transcript-store";
import { deleteUpload } from "./uploads";

export const RETENTION_DAYS = {
  tickets: 90, newTickets: 180, sessions: 30, deliveries: 30, sessionResults: 90,
} as const;

type RetentionOptions = {
  now?: Date; dryRun?: boolean; batchSize?: number; holds?: Set<string>;
};
type RetentionDeps = { deleteTranscript?: (key: string) => Promise<void>; deleteUpload?: (key: string) => Promise<void> };
export type RetentionReport = { candidates: number; deleted: number; bytes: number; failed: number };

const before = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export async function runRetention(
  opts: RetentionOptions = {},
  deps: RetentionDeps = {},
): Promise<RetentionReport> {
  const now = opts.now ?? new Date();
  const holds = opts.holds ?? new Set<string>();
  let remaining = Math.min(Math.max(opts.batchSize ?? 100, 1), 1_000);
  const report: RetentionReport = { candidates: 0, deleted: 0, bytes: 0, failed: 0 };
  const removeTranscript = deps.deleteTranscript ?? deleteTranscriptFile;
  const removeUpload = deps.deleteUpload ?? deleteUpload;

  const sessions = await prisma.sessionHistory.findMany({
    where: { endedAt: { not: null, lt: before(now, RETENTION_DAYS.sessions) } },
    orderBy: { endedAt: "asc" }, take: remaining,
  });
  for (const row of sessions) {
    if (holds.has(`session:${row.id}`)) continue;
    report.candidates++; report.bytes += row.transcriptBytes ?? 0;
    if (opts.dryRun) continue;
    try {
      if (row.transcriptKey) await removeTranscript(row.transcriptKey);
      await prisma.sessionHistory.delete({ where: { id: row.id } });
      report.deleted++; remaining--;
    } catch { report.failed++; }
    if (remaining <= 0) return report;
  }

  const tickets = await prisma.ticket.findMany({
    where: { OR: [
      { status: "new", createdAt: { lt: before(now, RETENTION_DAYS.newTickets) } },
      { status: { in: ["accepted", "rejected"] }, createdAt: { lt: before(now, RETENTION_DAYS.tickets) } },
    ] },
    include: { attachments: true }, orderBy: { createdAt: "asc" }, take: remaining,
  });
  for (const row of tickets) {
    if (holds.has(`ticket:${row.id}`)) continue;
    report.candidates++; report.bytes += row.attachments.reduce((sum, file) => sum + file.size, 0);
    if (opts.dryRun) continue;
    try {
      for (const file of row.attachments) await removeUpload(file.storageKey);
      await prisma.ticket.delete({ where: { id: row.id } });
      report.deleted++; remaining--;
    } catch { report.failed++; }
    if (remaining <= 0) return report;
  }

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { status: { in: ["sent", "failed", "dropped"] }, createdAt: { lt: before(now, RETENTION_DAYS.deliveries) } },
    orderBy: { createdAt: "asc" }, take: remaining,
  });
  for (const row of deliveries) {
    if (holds.has(`delivery:${row.id}`)) continue;
    report.candidates++;
    if (!opts.dryRun) {
      try { await prisma.webhookDelivery.delete({ where: { id: row.id } }); report.deleted++; remaining--; }
      catch { report.failed++; }
    }
    if (remaining <= 0) return report;
  }

  const results = await prisma.sessionResult.findMany({
    where: { createdAt: { lt: before(now, RETENTION_DAYS.sessionResults) } },
    orderBy: { createdAt: "asc" }, take: remaining,
  });
  for (const row of results) {
    if (holds.has(`result:${row.id}`)) continue;
    report.candidates++;
    if (!opts.dryRun) {
      try { await prisma.sessionResult.delete({ where: { id: row.id } }); report.deleted++; remaining--; }
      catch { report.failed++; }
    }
    if (remaining <= 0) break;
  }
  return report;
}

let timer: NodeJS.Timeout | undefined;
export function startRetentionSweep(): void {
  if (timer) return;
  const sweep = () => {
    const holds = new Set((process.env.HANOMAN_RETENTION_HOLDS ?? "").split(",").map((v) => v.trim()).filter(Boolean));
    void runRetention({ holds }).then((report) => {
      if (report.deleted || report.failed) console.log(`retention: ${report.deleted} dihapus, ${report.failed} gagal`);
    }).catch((error) => console.error("retention sweep:", error));
  };
  sweep();
  timer = setInterval(sweep, 24 * 60 * 60_000);
  timer.unref?.();
}
