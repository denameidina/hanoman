import type { OverviewDTO } from "@hanoman/shared";
import { prisma } from "../db";
import { AGENT_KINDS, addDays, computeOverview, startOfDay } from "./overview-metrics";
import { limitSeries, recordingSince, waitSpans } from "./overview-recorder";

// ADR-0220 · pengumpul sumber Overview. Tiap sumber dibaca terpisah: satu query gagal membuat
// panelnya null (computeOverview), bukan seluruh Overview hilang dari dashboard.
async function settle<T>(label: string, p: Promise<T>): Promise<T | null> {
  try { return await p; } catch (err) { console.warn(`overview: sumber ${label} gagal:`, err); return null; }
}

const RECORD_WINDOW_DAYS = 90;

export async function getOverview(now = Date.now()): Promise<OverviewDTO> {
  const since = new Date(addDays(startOfDay(now), -(RECORD_WINDOW_DAYS - 1)));
  const sinceYesterday = new Date(addDays(startOfDay(now), -1));
  const [specs, sessions, invocations] = await Promise.all([
    settle("spec", prisma.spec.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { startedAt: { gte: since } }, { doneAt: { gte: since } }] },
      select: { createdAt: true, startedAt: true, doneAt: true },
    })),
    settle("sessionHistory", prisma.sessionHistory.findMany({
      where: { kind: { in: [...AGENT_KINDS] },
        OR: [{ startedAt: { gte: since } }, { endedAt: null }, { endedAt: { gte: since } }] },
      select: { kind: true, startedAt: true, endedAt: true, exitCode: true, endedReason: true },
    })),
    settle("agentInvocation", prisma.agentInvocation.findMany({
      where: { startedAt: { gte: sinceYesterday } },
      select: { agentName: true, startedAt: true, inputTokens: true, outputTokens: true, cachedTokens: true },
    })),
  ]);
  return computeOverview(now, {
    specs, sessions, invocations, waits: waitSpans(), limits: limitSeries(), recordingSince: recordingSince(),
  });
}
