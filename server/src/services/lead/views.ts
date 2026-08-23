import type { Paginated, LeadStatusView, LeadDecisionView, LeadFlowView } from "@hanoman/shared";
import { prisma } from "../../db";
import { listSessionsAsync, liveDecisions } from "../pty";
import { listQueue } from "../scheduler/queue";
import { getLead, leadActive } from "./config";
import { listDecisions, toDecisionView } from "./trail";
import { listFlows, toFlowView } from "./flow";
import { decidingIds, queuedIds } from "./deciding";
import { leadGateStats } from "./gate";
import { lastPulse } from "./engine";

// SPEC-908 · satu definisi untuk ketiga route lead dan topik siar `lead`. Sebelumnya inline di
// routes/lead.ts; menyalinnya ke hub berarti dua serializer yang bisa berselisih diam-diam.

export async function buildLeadStatus(): Promise<LeadStatusView> {
  const cfg = await getLead();
  const projects = await prisma.project.findMany({
    where: { leadOptIn: true }, select: { id: true, name: true }, orderBy: { id: "asc" },
  });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // SPEC-402 · bacaan tmux yang gagal MELEMPAR; layar status tak boleh ikut 500 karenanya.
  // SPEC-908 · versi ASINKRON: fungsi ini kini juga dipanggil hub siar, yang berbagi event loop
  // dengan PTY terminal — `execFileSync` tmux memblokirnya (SPEC-479/812).
  let live: Awaited<ReturnType<typeof listSessionsAsync>> = [];
  try { live = (await listSessionsAsync()).filter((s) => !s.exited); } catch { /* tmux tak terbaca */ }
  let waiting: string[] = [];
  try { waiting = liveDecisions().filter((d) => d.waiting).map((d) => d.id); }
  catch { /* idem */ }
  const rows = await Promise.all(projects.map(async (p) => ({
    projectId: p.id, name: p.name,
    optIn: true,
    paused: !leadActive(cfg, p.id),
    decisions24h: await prisma.leadDecision.count({ where: { projectId: p.id, createdAt: { gte: since } } }),
    openSessions: live.filter((s) => s.projectId === p.id).length,
  })));
  const last = lastPulse();
  return {
    config: cfg, projects: rows,
    queue: (await listQueue()).map((q) => ({
      id: q.id, specId: q.specId, projectId: q.projectId, source: q.source,
      priority: q.priority, status: q.status, sessionId: q.sessionId, note: q.note,
      enqueuedAt: q.enqueuedAt.toISOString(),
      launchedAt: q.launchedAt ? q.launchedAt.toISOString() : null,
    })),
    deciding: decidingIds(), queued: queuedIds(), waiting,
    lastPulseAt: last ? new Date(last).toISOString() : null,
    // SPEC-479 · keadaan gerbang konkurensi. Tanpa ini "lead sedang penuh" dan "lead diam"
    // terlihat identik di layar, dan salah baca itulah yang melahirkan tiketnya.
    gate: { ...leadGateStats(), capacity: cfg.maxConcurrent },
  };
}

// Filter route TETAP seluas semula (specId/sessionId/status/flowId/take/skip) — yang dipersempit
// hanya parameter TOPIK siar. Karena itu bentuk argumennya diambil dari `listDecisions` sendiri.
export async function buildLeadDecisions(
  f: Parameters<typeof listDecisions>[0],
): Promise<Paginated<LeadDecisionView>> {
  const r = await listDecisions(f);
  return { items: r.rows.map(toDecisionView), total: r.total, page: r.page, pageSize: r.pageSize };
}

export async function buildLeadFlows(
  f: Parameters<typeof listFlows>[0],
): Promise<Paginated<LeadFlowView>> {
  const r = await listFlows(f);
  return { items: r.rows.map(toFlowView), total: r.total, page: r.page, pageSize: r.pageSize };
}
