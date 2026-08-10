import { prisma } from "../../db";
import type { SchedulerCron, SchedulerCronRun } from "@prisma/client";
import { parseCron, nextRun } from "@hanoman/shared";
import { recordCronRun } from "../notifications";

// SPEC-646 · ADR-0112 · seberapa terlambat sebuah jatuh tempo masih boleh dijalankan. Ia menjawab
// DUA pertanyaan sekaligus dengan satu angka, dan itu disengaja: "server mati saat jatuh tempo" dan
// "cap penuh saat jatuh tempo" adalah keterlambatan yang sama dari sudut pandang operator — jadwal
// pukul 07:00 kehilangan maknanya bila berjalan pukul 09:00, apa pun sebabnya.
export const GRACE_MS = 30 * 60_000;

export function computeNextRun(expr: string, after: Date): Date | null {
  const spec = parseCron(expr);
  return spec ? nextRun(spec, after) : null;
}

// Jatuh tempo TERBARU yang ≤ now, berikut jumlah yang dilompati. Inilah yang membuat "jangan
// menembak burst run tertunggak setelah restart" jadi sifat struktural alih-alih niat baik: jatuh
// tempo yang dilompati tak pernah menjadi baris antrean, ia menjadi angka di dalam alasan SATU
// baris `skipped`.
function latestDue(expr: string, from: Date, now: number): { due: Date; missed: number } | null {
  let cursor = from;
  let due: Date | null = null;
  let missed = -1;
  // Batas iterasi menjaga cron bermenit (`* * * * *`) yang tertinggal berbulan-bulan tak
  // menggantung tick: sesudah batasnya, yang tercatat tetap jatuh tempo terakhir yang terhitung.
  for (let i = 0; i < 20_000; i++) {
    const nxt = computeNextRun(expr, cursor);
    if (!nxt || nxt.getTime() > now) break;
    due = nxt; missed++; cursor = nxt;
  }
  return due ? { due, missed: Math.max(0, missed) } : null;
}

/**
 * Materialisasi jatuh tempo → baris `SchedulerCronRun`, lalu kedaluwarsakan baris yang menua.
 *
 * Dipanggil tiap tick SEBELUM gerbang `paused`, dan itu disengaja: Pause adalah rem PELUNCURAN,
 * bukan penghapus antrean (ADR-0072 keputusan 4). Jatuh tempo yang lewat selama jeda tetap
 * tercatat, dan melanjutkan jeda dalam grace tetap menjalankannya.
 */
export async function sweepCronDue(now: number): Promise<void> {
  const crons = await prisma.schedulerCron.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date(now) } },
  });
  for (const cron of crons) await materialize(cron, now);
  await expireStale(now);
}

async function materialize(cron: SchedulerCron, now: number): Promise<void> {
  // `nextRunAt` kosong tak pernah lolos filter pemanggil; yang tersisa cuma nilai nyata. Dikurangi
  // satu milidetik karena `nextRun` mencari yang STRICTLY setelah acuannya — tanpa itu jatuh tempo
  // yang persis sama dengan `nextRunAt` terlewat.
  const from = new Date(cron.nextRunAt!.getTime() - 1);
  const hit = latestDue(cron.expr, from, now);
  // Selalu majukan `nextRunAt` walau tak ada jatuh tempo yang terklaim: expr yang jadwalnya sudah
  // habis (mis. tanggal yang tak pernah ada) tak boleh membuat cron ini dipungut tiap tick.
  await prisma.schedulerCron.update({
    where: { id: cron.id }, data: { nextRunAt: computeNextRun(cron.expr, new Date(now)) },
  });
  if (!hit) return;

  const late = now - hit.due.getTime() > GRACE_MS;
  const missedNote = hit.missed > 0
    ? `terlewat ${hit.missed} jatuh tempo — scheduler tak berjalan`
    : "terlewat — scheduler tak berjalan saat jatuh tempo";
  try {
    await prisma.schedulerCronRun.create({
      data: {
        cronId: cron.id, projectId: cron.projectId, dueAt: hit.due,
        ...(late ? { status: "skipped", note: missedNote } : {}),
      },
    });
  } catch {
    return;   // P2002: jatuh tempo ini sudah pernah diklaim — justru kunci idempotensinya
  }
  if (late) await recordCronRun(cron.id, cron.name, cron.projectId, hit.due, "skipped", missedNote);
}

// Baris `queued` yang tak terluncurkan sampai grace habis ditutup sebagai `skipped`, membawa alasan
// TERAKHIR yang menghalanginya (mis. "cap penuh"). Tanpa ini sebuah jatuh tempo pukul 07:00 bisa
// diam-diam berjalan pukul 15:00 begitu slot kosong — persis yang membuat jadwal jam tertentu
// kehilangan maknanya.
async function expireStale(now: number): Promise<void> {
  const stale = await prisma.schedulerCronRun.findMany({
    where: { status: "queued", dueAt: { lt: new Date(now - GRACE_MS) } },
  });
  for (const run of stale) {
    const note = run.note ?? "tak terluncurkan sampai batas keterlambatan";
    await prisma.schedulerCronRun.update({ where: { id: run.id }, data: { status: "skipped", note } });
    const cron = await prisma.schedulerCron.findUnique({ where: { id: run.cronId } });
    await recordCronRun(run.cronId, cron?.name ?? run.cronId, run.projectId, run.dueAt, "skipped", note);
  }
}

// Urut jatuh tempo (FIFO waktu), bukan prioritas: cron tak punya prioritas, dan yang paling lama
// menunggu adalah yang paling dekat kedaluwarsa.
export function queuedCronRuns(): Promise<SchedulerCronRun[]> {
  return prisma.schedulerCronRun.findMany({ where: { status: "queued" }, orderBy: { dueAt: "asc" } });
}

// CAS seperti `markLaunched` antrean spec: operator bisa menonaktifkan/menghapus cron SELAGI
// sesinya lahir, dan `update` polos akan menimpa keadaan itu diam-diam.
export async function markCronLaunched(id: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.schedulerCronRun.updateMany({
    where: { id, status: "queued" },
    data: { status: "launched", sessionId, startedAt: new Date(), note: null },
  });
  return count > 0;
}
export async function markCronFailed(id: string, note: string): Promise<void> {
  await prisma.schedulerCronRun.updateMany({ where: { id, status: "queued" }, data: { status: "failed", note } });
}
export async function markCronSkipped(id: string, note: string): Promise<void> {
  await prisma.schedulerCronRun.updateMany({ where: { id, status: "queued" }, data: { status: "skipped", note } });
}
// Ditulis HANYA saat berubah: tick berdenyut tiap 10 detik, dan menulis note identik tiap tick
// berarti ribuan write/hari untuk informasi yang sama (cermin `noteRow` antrean spec).
export async function noteCronRun(id: string, note: string): Promise<void> {
  const row = await prisma.schedulerCronRun.findUnique({ where: { id }, select: { note: true } });
  if (row?.note === note) return;
  await prisma.schedulerCronRun.updateMany({ where: { id, status: "queued" }, data: { note } });
}

export async function listCronRunsPage(cronId: string, f: { page?: string; limit?: string } = {}):
  Promise<{ items: SchedulerCronRun[]; total: number; page: number; pageSize: number }> {
  const where = { cronId };
  const total = await prisma.schedulerCronRun.count({ where });
  const pageSize = f.limit ? Math.max(1, Math.floor(+f.limit) || 1) : (total || 1);
  const page = f.page ? Math.max(1, Math.floor(+f.page) || 1) : 1;
  const items = await prisma.schedulerCronRun.findMany({
    where, orderBy: { dueAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { items, total, page, pageSize };
}
