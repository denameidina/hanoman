import { prisma } from "../../db";
import type { CronReport } from "@prisma/client";
import {
  CRON_REPORT_KEEP, cronReportFilename, truncateCronReport,
  type CronReportDetail, type CronReportView,
} from "@hanoman/shared";
import { notifySynced } from "../sync-notify";
import { deleteSynced } from "../sync-delete";

// ADR-0222 · laporan hasil satu run cron. Sumbernya `last_assistant_message` hook `Stop` sesi
// `cron-*` (routes/session-events.ts). Id laporan = id run, jadi tulis ulang idempoten dan dua
// mesin tak bisa menerbitkan laporan ganda untuk run yang sama.

const pad = (n: number) => String(n).padStart(2, "0");
/** Tanggal LOKAL mesin penjalan (zona yang sama dengan jadwal cron, ADR-0204). */
export const localRunDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Simpan pesan akhir agen sebagai laporan run `launched` TERBARU untuk sesi cron ini. Giliran
 * terakhir menang (cron bisa berganti beberapa giliran). `null` = bukan sesi cron / tak ada run
 * yang cocok / pesan kosong. Tak pernah melempar ke pemanggil hook: kegagalan menulis laporan tak
 * boleh menjatuhkan jalur event sesi.
 */
export async function recordCronReport(sessionId: string, message: unknown): Promise<{ id: string } | null> {
  if (!sessionId.startsWith("cron-") || typeof message !== "string" || !message.trim()) return null;
  const run = await prisma.schedulerCronRun.findFirst({
    where: { sessionId, status: "launched" }, orderBy: [{ startedAt: "desc" }, { dueAt: "desc" }],
  });
  if (!run) return null;
  if (!(await prisma.project.findUnique({ where: { id: run.projectId }, select: { id: true } }))) return null;
  const cron = await prisma.schedulerCron.findUnique({ where: { id: run.cronId }, select: { name: true } });
  const { body, bytes } = truncateCronReport(message);

  const existing = await prisma.cronReport.findUnique({ where: { id: run.id }, select: { body: true } });
  if (existing?.body === body) return { id: run.id };   // tak ada perubahan → tak ada trafik sync
  const data = {
    projectId: run.projectId, cronId: run.cronId, cronName: cron?.name ?? run.cronId,
    runDate: localRunDate(run.dueAt), dueAt: run.dueAt, sessionId, body, bytes,
  };
  await prisma.cronReport.upsert({ where: { id: run.id }, create: { id: run.id, ...data }, update: data });
  await notifySynced("cronReport", run.id);
  await pruneCronReports(run.cronId);
  return { id: run.id };
}

/** Retensi: hanya {@link CRON_REPORT_KEEP} laporan terbaru per cron; sisanya `deleteSynced` (tombstone). */
export async function pruneCronReports(cronId: string): Promise<number> {
  const old = await prisma.cronReport.findMany({
    where: { cronId }, orderBy: { dueAt: "desc" }, skip: CRON_REPORT_KEEP, select: { id: true },
  });
  for (const r of old) await deleteSynced("cronReport", r.id);
  return old.length;
}

const view = (r: Omit<CronReport, "body">): CronReportView => ({
  id: r.id, projectId: r.projectId, cronId: r.cronId, cronName: r.cronName, runDate: r.runDate,
  dueAt: r.dueAt.toISOString(), sessionId: r.sessionId, bytes: r.bytes,
  filename: cronReportFilename({ runDate: r.runDate, cronName: r.cronName, id: r.id }),
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});
const detail = (r: CronReport): CronReportDetail => ({ ...view(r), body: r.body });

type Filter = { projectId?: string; cronId?: string };
const whereOf = (f: Filter) => ({
  ...(f.projectId ? { projectId: f.projectId } : {}), ...(f.cronId ? { cronId: f.cronId } : {}),
});

// Tanpa `body`: daftar harian × banyak cron tak boleh mengangkut ratusan KiB per halaman.
// Cron TIDAK divalidasi keberadaannya — cron milik mesin lain tak ada di DB ini, laporannya ada.
export async function listCronReports(f: Filter & { page?: string; limit?: string } = {}):
  Promise<{ items: CronReportView[]; total: number; page: number; pageSize: number }> {
  const where = whereOf(f);
  const total = await prisma.cronReport.count({ where });
  const pageSize = f.limit ? Math.min(Math.max(1, Math.floor(+f.limit) || 1), 200) : (total || 1);
  const page = f.page ? Math.max(1, Math.floor(+f.page) || 1) : 1;
  const rows = await prisma.cronReport.findMany({
    where, orderBy: { dueAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, omit: { body: true },
  });
  return { items: rows.map(view), total, page, pageSize };
}

export async function getCronReport(id: string): Promise<CronReportDetail | null> {
  const r = await prisma.cronReport.findUnique({ where: { id } });
  return r ? detail(r) : null;
}

export async function latestCronReport(f: Filter): Promise<CronReportDetail | null> {
  const r = await prisma.cronReport.findFirst({ where: whereOf(f), orderBy: { dueAt: "desc" } });
  return r ? detail(r) : null;
}
