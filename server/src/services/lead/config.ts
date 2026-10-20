import { prisma } from "../../db";
import type { Prisma } from "@prisma/client";
import { coerceCodexEffort, type Lead, type Agent } from "@hanoman/shared";
import { getSetting, sessionAgentDefaults } from "../settings";
import { recordLeadNotice } from "../notifications";

// SPEC-409 · ADR-0091 · blok lead hidup di dalam Setting singleton (id=1), cermin scheduler
// (SPEC-294) & conflict (SPEC-383). getSetting sudah mengisi default (zSetting.lead =
// LEAD_DEFAULTS) untuk baris lama tanpa blok ini → tanpa migration.
export async function getLead(): Promise<Lead> {
  return (await getSetting()).lead;
}

/** Ganti seluruh blok lead; pertahankan field Setting lain (pola setScheduler). */
export async function setLead(next: Lead): Promise<Lead> {
  const cur = await getSetting();
  const data = { ...cur, lead: next } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  return next;
}

/**
 * OQ-1 · agen yang MENJALANKAN lead. Opt-in seperti `conflictSessionDefaults()`: selama
 * `lead.engine.enabled` mati, lead memakai default sesi global — satu setelan agen, bukan dua yang
 * bisa berselisih diam-diam. Effort codex dikoersi di sini (SPEC-339: effort adalah properti MODEL),
 * supaya blok lead tak bisa menyimpan pasangan yang nanti ditolak codex.
 */
export async function leadAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const s = await getSetting();
  const e = s.lead.engine;
  if (!e.enabled) return sessionAgentDefaults();
  return { agent: e.agent, model: e.model,
    effort: e.agent === "codex" ? coerceCodexEffort(e.model, e.effort) : e.effort };
}

/**
 * AC-15/AC-27/AC-30 · satu gerbang untuk "boleh bertindak?" — dipakai SEMUA pintu (kontrak,
 * deteksi otomatis, denyut). Master switch mati → hanoman berperilaku persis seperti sebelum
 * PRD ini; Pause global/per-project → tak ada keputusan baru, tak ada ketikan ke pane, tak ada
 * penataan urutan untuk project itu.
 */
export function leadActive(cfg: Lead, projectId?: string | null): boolean {
  if (!cfg.enabled || cfg.paused) return false;
  if (projectId && cfg.pausedProjects.includes(projectId)) return false;
  return true;
}

/** Project yang opt-in lead (cermin schedulerOptIn). Project non-opt-in tak pernah tersentuh. */
export async function leadProjects(): Promise<string[]> {
  const rows = await prisma.project.findMany({ where: { leadOptIn: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * ADR-0228 · rem otomatis per proyek: pemutus beruntun (`budget.ts`) atau pane lead yang gagal lahir
 * berulang. Memakai pause per-project yang sudah ada (AC-15) — operator membukanya dari tempat yang
 * sama. Idempoten: proyek yang sudah dijeda tak dijeda/dinotifikasi lagi.
 */
export async function pauseLeadProject(projectId: string, why: string): Promise<void> {
  const cfg = await getLead();
  if (cfg.pausedProjects.includes(projectId)) return;
  await setLead({ ...cfg, pausedProjects: [...cfg.pausedProjects, projectId] });
  await recordLeadNotice(`pause:${projectId}:${Date.now()}`, `Lead menjeda ${projectId}: ${why}`, projectId).catch(() => undefined);
}
