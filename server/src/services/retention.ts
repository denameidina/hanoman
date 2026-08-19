import { prisma } from "../db";
import { deleteTranscript as deleteTranscriptFile } from "./transcript-store";
import { reconcileTranscripts } from "./session-history";
import { deleteUpload } from "./uploads";

export const RETENTION_DAYS = {
  tickets: 90, newTickets: 180, sessions: 30, deliveries: 30, sessionResults: 90,
} as const;

type RetentionOptions = {
  now?: Date; dryRun?: boolean; batchSize?: number; holds?: Set<string>;
};
type RetentionDeps = { deleteTranscript?: (key: string) => Promise<void>; deleteUpload?: (key: string) => Promise<void> };
export type RetentionReport = {
  candidates: number; deleted: number; bytes: number; failed: number;
  orphans: number; dangling: number;
};

const before = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export async function runRetention(
  opts: RetentionOptions = {},
  deps: RetentionDeps = {},
): Promise<RetentionReport> {
  const report: RetentionReport = {
    candidates: 0, deleted: 0, bytes: 0, failed: 0, orphans: 0, dangling: 0,
  };
  await deleteExpired(report, opts, deps);
  // SPEC-845 · ADR-0125 · rekonsiliasi jalan di SETIAP sapuan, termasuk saat jatah batch habis di
  // tengah jalan — berkas yatim justru lahir dari penghapusan yang terpotong. Ini juga satu-satunya
  // job maintenance-nya: tak ada timer maupun proses kedua (ADR-0024).
  const gc = await reconcileTranscripts({ dryRun: opts.dryRun });
  report.orphans = gc.orphans;
  report.dangling = gc.dangling;
  report.failed += gc.failed;
  return report;
}

async function deleteExpired(
  report: RetentionReport,
  opts: RetentionOptions,
  deps: RetentionDeps,
): Promise<void> {
  const now = opts.now ?? new Date();
  const holds = opts.holds ?? new Set<string>();
  let remaining = Math.min(Math.max(opts.batchSize ?? 100, 1), 1_000);
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
      await prisma.sessionHistory.delete({ where: { id: row.id } });
      report.deleted++; remaining--;
    } catch { report.failed++; continue; }
    // Berkas dihapus SESUDAH barisnya commit (ADR-0125): kegagalan di sini menyisakan yatim, yang
    // rekonsiliasi di akhir sapuan ini juga sudah memungutnya — bukan bukti hancur milik baris hidup.
    if (row.transcriptKey) await removeTranscript(row.transcriptKey).catch(() => { /* jadi yatim */ });
    if (remaining <= 0) return;
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
    if (remaining <= 0) return;
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
    if (remaining <= 0) return;
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
}

let timer: NodeJS.Timeout | undefined;
export function startRetentionSweep(): void {
  if (timer) return;
  const sweep = () => {
    const holds = new Set((process.env.HANOMAN_RETENTION_HOLDS ?? "").split(",").map((v) => v.trim()).filter(Boolean));
    void runRetention({ holds }).then((report) => {
      if (report.deleted || report.failed || report.orphans || report.dangling) {
        console.log(`retention: ${report.deleted} dihapus, ${report.failed} gagal, `
          + `${report.orphans} transkrip yatim disapu, ${report.dangling} metadata menggantung dibersihkan`);
      }
    }).catch((error) => console.error("retention sweep:", error));
  };
  sweep();
  timer = setInterval(sweep, 24 * 60 * 60_000);
  timer.unref?.();
}
