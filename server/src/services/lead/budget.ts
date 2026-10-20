import type { Lead, LeadProject, LimitsStatus, LimitWindow } from "@hanoman/shared";
import { prisma } from "../../db";
import { getLead } from "./config";
import { leadProjectConfig } from "./project-config";
import { getScheduler } from "../scheduler/config";
import { listPanesAsync } from "../pty";
import { currentLaunchStatus } from "../session-launch-gate";
import { getLimits } from "../limits";
import { getCodexLimits } from "../codex-limits";
import { getAntigravityLimits } from "../antigravity-limits";
import { sessionAgentDefaults } from "../settings";

// ADR-0228 · JATAH PELUNCURAN. Server yang menentukan BERAPA backlog boleh diluncurkan lead;
// lead hanya memilih YANG MANA. Kasus 2026-10-20: 7 backlog crm diluncurkan dalam 30 dtk lalu
// 7/7 gagal — tak ada satu pun pembacaan kuota, beban host, atau hasil sesi sebelumnya di jalur
// lead. Fungsi murni `computeBudget` memegang aturannya; `launchBudget` hanya mengumpulkan angka.

export type BudgetInput = {
  slotsFree: number;
  hostOk: boolean;
  quota: { status: "ok" | "error"; maxUsedPct: number };
  /** Sesi lead yang baru diluncurkan dan belum melewati `rampProbeMin` menit. */
  inProbe: number;
  /** Kegagalan beruntun terbaru sesi yang diluncurkan lead di proyek ini. */
  failStreak: number;
  cfg: LeadProject;
};
export type Budget = { n: number; reasons: string[]; tripped: boolean };

export function computeBudget(i: BudgetInput): Budget {
  const reasons: string[] = [];
  let n = Math.max(0, i.slotsFree);
  if (n === 0) reasons.push("slot scheduler penuh");
  if (!i.hostOk) { n = 0; reasons.push("host menolak (beban/memori, ADR-0161)"); }
  if (i.quota.status !== "ok") { n = 0; reasons.push("data kuota engine tak terbaca — gagal aman"); }
  else if (i.quota.maxUsedPct >= i.cfg.quotaStopPct) {
    n = 0; reasons.push(`kuota engine ${Math.round(i.quota.maxUsedPct)}% ≥ ${i.cfg.quotaStopPct}%`);
  }
  const ramp = Math.max(0, i.cfg.rampStep - i.inProbe);
  if (ramp < n) {
    n = ramp;
    reasons.push(`ramp: ${i.inProbe} sesi lead masih dalam probe ${i.cfg.rampProbeMin} menit (maks ${i.cfg.rampStep} sekaligus)`);
  }
  const tripped = i.failStreak >= i.cfg.failStreak;
  if (tripped) { n = 0; reasons.push(`${i.failStreak} sesi lead gagal beruntun — pemutus menyala`); }
  return { n, reasons, tripped };
}

export type BudgetDeps = {
  cfg: () => Promise<Lead>;
  status: () => Promise<{ slotsFree: number; hostOk: boolean }>;
  quota: () => Promise<{ status: "ok" | "error"; maxUsedPct: number }>;
  leadItems: (projectId: string) => Promise<{ status: string; launchedAt: Date | null }[]>;
  now: () => number;
};

async function prodStatus(): Promise<{ slotsFree: number; hostOk: boolean }> {
  const st = await currentLaunchStatus(await listPanesAsync(), await getScheduler());
  const loadOk = st.loadPerCore === null || st.loadPerCore <= st.maxLoadPerCore;
  const memOk = st.memAvailablePct === null || st.memAvailablePct >= st.minMemAvailablePct;
  // Gerbang host yang dimatikan operator (`launchGuard.enabled: false`) tak menahan jatah — itu
  // pilihannya sendiri; slot & kuota tetap berlaku.
  return { slotsFree: st.maxConcurrent - st.liveAgentCount, hostOk: !st.enabled || (loadOk && memOk) };
}

/** `stale` = angka terakhir yang sah masih dipakai; hanya `unavailable` yang berarti buta. */
const quotaOf = (dto: { status: LimitsStatus; windows: LimitWindow[] }): { status: "ok" | "error"; maxUsedPct: number } =>
  dto.status === "unavailable"
    ? { status: "error", maxUsedPct: 0 }
    : { status: "ok", maxUsedPct: Math.max(0, ...dto.windows.map((w) => w.usedPct)) };

/** Kuota engine yang AKAN dipakai sesi pekerja: jendela terpakai terbesar. */
async function prodQuota(): Promise<{ status: "ok" | "error"; maxUsedPct: number }> {
  const { agent } = await sessionAgentDefaults();
  if (agent === "codex") return quotaOf(await getCodexLimits());
  if (agent === "antigravity") return quotaOf(await getAntigravityLimits());
  return quotaOf(await getLimits());
}

export const prodBudgetDeps: BudgetDeps = {
  cfg: getLead,
  status: prodStatus,
  quota: () => prodQuota().catch(() => ({ status: "error" as const, maxUsedPct: 0 })),
  leadItems: (projectId) => prisma.schedulerQueueItem.findMany({
    where: { projectId, source: "lead", launchedAt: { not: null } },
    orderBy: { launchedAt: "desc" }, take: 20, select: { status: true, launchedAt: true },
  }),
  now: Date.now,
};

export async function launchBudget(projectId: string, deps: BudgetDeps = prodBudgetDeps): Promise<Budget> {
  const cfg = leadProjectConfig(await deps.cfg(), projectId);
  const [status, quota, items] = await Promise.all([deps.status(), deps.quota(), deps.leadItems(projectId)]);
  const probeMs = cfg.rampProbeMin * 60_000;
  const inProbe = items.filter((i) => i.status === "launched" && i.launchedAt
    && deps.now() - i.launchedAt.getTime() < probeMs).length;
  // Deret dihitung dari yang TERBARU; sesi yang masih berjalan dilewati (belum punya hasil), dan
  // hasil apa pun selain `failed` memutus deretnya.
  let failStreak = 0;
  for (const i of items) {
    if (i.status === "launched") continue;
    if (i.status !== "failed") break;
    failStreak++;
  }
  return computeBudget({ ...status, quota, inProbe, failStreak, cfg });
}
