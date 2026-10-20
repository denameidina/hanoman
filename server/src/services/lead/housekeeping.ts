import type { Lead } from "@hanoman/shared";
import { prisma } from "../../db";
import { leadActive, leadProjects, pauseLeadProject } from "./config";
import { sweepInbox } from "./inbox";
import { expireApprovals } from "./approvals";
import { ensureLeadSession, leadSessionFailures, rotateLeadSession } from "./lead-session";
import { deliverAll } from "./courier";

// ADR-0228 · rumah tangga sesi lead, menumpang tick lead yang sudah ada (ADR-0024: tanpa timer
// baru). Urutan: sapu tenggat & izin kedaluwarsa (berlaku walau Pause — itu menutup, bukan
// memutuskan), lalu — bila tak dijeda — hidupkan pane yang punya pekerjaan, rem proyek yang pane-nya
// gagal lahir berulang, rotasi pane yang macet, dan antar batch yang tertunda.

export const PANE_FAIL_LIMIT = 3;

export type HousekeepingDeps = {
  sweep: (now: number, deliverTimeoutMs: number) => Promise<unknown>;
  expire: (now: number, ttlMs: number) => Promise<unknown>;
  projects: () => Promise<string[]>;
  hasOpen: (projectId: string) => Promise<boolean>;
  /** Event yang sudah ≥ 2 kali dikembalikan sapuan (pane tak menjawab di gilirannya). */
  stuck: (projectId: string) => Promise<boolean>;
  clearStuck: (projectId: string) => Promise<void>;
  ensure: (projectId: string) => Promise<unknown>;
  failures: (projectId: string) => number;
  pause: (projectId: string, why: string) => Promise<void>;
  rotate: (projectId: string) => Promise<unknown>;
  deliver: (projects: string[]) => Promise<void>;
};

export const prodHousekeepingDeps: HousekeepingDeps = {
  sweep: sweepInbox,
  expire: expireApprovals,
  projects: leadProjects,
  hasOpen: async (p) => !!(await prisma.leadEvent.findFirst({ where: { projectId: p, status: "open" }, select: { id: true } })),
  stuck: async (p) => !!(await prisma.leadEvent.findFirst({ where: { projectId: p, status: "open", attempts: { gte: 2 } }, select: { id: true } })),
  clearStuck: async (p) => { await prisma.leadEvent.updateMany({ where: { projectId: p, status: "open", attempts: { gte: 2 } }, data: { attempts: 0 } }); },
  ensure: (p) => ensureLeadSession(p),
  failures: leadSessionFailures,
  pause: pauseLeadProject,
  rotate: (p) => rotateLeadSession(p),
  deliver: (ps) => deliverAll(ps),
};

export async function leadSessionHousekeeping(now: number, cfg: Lead, deps: HousekeepingDeps = prodHousekeepingDeps): Promise<void> {
  await deps.sweep(now, cfg.deliverTimeoutSec * 1000).catch((e) => console.error("lead inbox sweep:", e));
  await deps.expire(now, cfg.approvalTtlMin * 60_000).catch((e) => console.error("lead approval expire:", e));
  if (cfg.paused) return;
  const projects = (await deps.projects()).filter((p) => leadActive(cfg, p));
  const live: string[] = [];
  for (const p of projects) {
    try {
      if (await deps.hasOpen(p)) await deps.ensure(p).catch(() => null);
      if (deps.failures(p) >= PANE_FAIL_LIMIT) {
        await deps.pause(p, `pane lead gagal lahir ${PANE_FAIL_LIMIT}× beruntun — pertanyaan sesi pekerja jatuh ke manusia`);
        continue;
      }
      // Spec §4 · pane yang dua kali melewatkan event yang sama dianggap macet di gilirannya.
      if (await deps.stuck(p)) { await deps.clearStuck(p); await deps.rotate(p).catch(() => null); }
      live.push(p);
    } catch (e) { console.error(`lead housekeeping ${p}:`, e); }
  }
  await deps.deliver(live).catch((e) => console.error("lead deliver:", e));
}
