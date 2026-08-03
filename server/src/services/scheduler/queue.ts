import { prisma } from "../../db";
import type { SchedulerQueueItem } from "@prisma/client";

const RANK: Record<string, number> = { tinggi: 0, sedang: 1, rendah: 2 };

// SPEC-431 · definisi TUNGGAL "backlog yang boleh diambil otomatis", dipakai checker `backlog`
// (SPEC-295) DAN denyut lead (SPEC-409) — dua pemakai yang sebelumnya menyalin predikatnya dan
// karena itu salah dengan cara yang sama persis.
//
// Dua syarat, dan keduanya wajib:
//   `baseSha: null`      — belum pernah punya worktree, jadi tak ada sesi berjalan yang direbut.
//   `stage: not "done"`  — masih perlu dikerjakan.
//
// `baseSha` SENDIRIAN bukan proksi "belum mulai": ia menjawab "apakah hanoman pernah membuatkan
// worktree", dan kolomnya baru ada sejak ADR-0030. Item yang selesai sebelum itu, ditandai selesai
// manual (`PATCH /specs/:id { stage }`), atau dikerjakan di checkout lain permanen ber-`baseSha`
// null — terukur di DB produksi: 27 `Spec` `done` ber-`baseSha` null, dan 27 dari 29 baris antrean
// menunjuk ke sana. Enam di antaranya telanjur diluncurkan sebagai sesi tmux sungguhan (jalur
// `isContinue`/SPEC-172, worktree + branch baru + `startedAt` ditimpa). `startedAt` (SPEC-408) tak
// menolong: ia ditulis di titik cekik yang SAMA dengan `baseSha`, jadi null untuk 27 item yang sama.
export const UNSTARTED_SPEC_WHERE = { baseSha: null, stage: { not: "done" } } as const;

export type EnqueueInput = { specId: string; projectId: string; source: string; priority: string };

// Idempoten via specId @unique: bila item sudah ada (queued/launched/done/failed) → no-op (update {}),
// jangan resurrect item yang sudah diproses. Backlog checker menyaring `UNSTARTED_SPEC_WHERE`;
// errors/triase membuat Spec baru tiap kali, jadi re-enqueue hanya kena dalam jendela queued/launched.
export async function enqueue(i: EnqueueInput): Promise<void> {
  await prisma.schedulerQueueItem.upsert({
    where: { specId: i.specId },
    update: {},
    create: { specId: i.specId, projectId: i.projectId, source: i.source, priority: i.priority },
  });
}

export function listQueue(status?: string): Promise<SchedulerQueueItem[]> {
  return prisma.schedulerQueueItem.findMany({ where: status ? { status } : undefined });
}

// Item siap-drain, urut prioritas lalu FIFO (enqueuedAt). Sort di memori: himpunan kecil.
export async function queued(): Promise<SchedulerQueueItem[]> {
  const items = await prisma.schedulerQueueItem.findMany({ where: { status: "queued" } });
  return items.sort((a, b) =>
    (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1)
    || a.enqueuedAt.getTime() - b.enqueuedAt.getTime());
}

// SPEC-522 · CAS, bukan `update` polos: operator bisa membatalkan baris ini SELAGI `launch()`
// men-spawn worktree + sesi tmux (hitungan detik). `update` polos akan menimpa `canceled` jadi
// `launched` secara senyap — operator menekan Batalkan, UI membenarkannya, lalu keadaan berbalik
// sendiri. `false` = pembatalan menang; pemanggil yang memutuskan apa yang dicatat tentang sesi
// yang telanjur lahir.
export async function markLaunched(id: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.schedulerQueueItem.updateMany({
    where: { id, status: "queued" },
    data: { status: "launched", sessionId, launchedAt: new Date() },
  });
  return count > 0;
}
export async function markFailed(id: string, note?: string): Promise<void> {
  await prisma.schedulerQueueItem.update({ where: { id }, data: { status: "failed", note: note ?? null } });
}
// `note` opsional: rekonsiliasi akhir sesi (SPEC-298) menutup tanpa alasan, sementara gerbang
// "sudah selesai" (SPEC-431) menutup baris yang tak pernah punya sesi dan harus bisa dijelaskan.
export async function markDone(id: string, note?: string): Promise<void> {
  await prisma.schedulerQueueItem.update({
    where: { id }, data: { status: "done", ...(note ? { note } : {}) },
  });
}
export function queueItemForSpec(specId: string): Promise<SchedulerQueueItem | null> {
  return prisma.schedulerQueueItem.findUnique({ where: { specId } });
}
export function schedulerItemForSession(sessionId: string): Promise<SchedulerQueueItem | null> {
  return prisma.schedulerQueueItem.findFirst({ where: { sessionId } });
}

// SPEC-447 · ADR-0093 · alasan sebuah baris DIAM di antrean, tanpa mengubah statusnya — dan sejak
// SPEC-522 juga catatan sesi yatim pada baris `canceled`, jadi namanya bukan lagi `noteQueued`.
// Ditulis HANYA saat berubah: governor berdenyut tiap 10 detik, dan menulis note identik tiap tick
// berarti ~8.640 write/hari untuk informasi yang sama.
export async function noteRow(id: string, note: string): Promise<void> {
  const row = await prisma.schedulerQueueItem.findUnique({ where: { id }, select: { note: true } });
  if (row?.note === note) return;
  await prisma.schedulerQueueItem.update({ where: { id }, data: { note } });
}

// SPEC-522 · pembatalan & pengembalian sebuah baris antrean. Keduanya **CAS** (`updateMany`
// ber-`where` status = satu pernyataan SQL bersyarat), bukan baca-lalu-`if`-lalu-tulis: di antara
// dua pernyataan itu governor bisa meluncurkan barisnya, dan kendala "item yang sudah punya sesi
// aktif tak boleh dibunuh diam-diam" akan jadi sekadar niat baik. `false` = transisinya ditolak;
// pemanggil membaca ulang statusnya untuk menyusun alasan.
//
// `canceled` adalah TOMBSTONE, bukan penghapusan: `enqueue()` memakai `upsert` ber-`update:{}`,
// jadi checker `backlog` yang menjumpai spec yang sama pada cadence berikutnya tak bisa
// menghidupkannya. Menghapus barisnya justru akan membuat pembatalan membatalkan dirinya sendiri
// (spec-nya masih cocok `UNSTARTED_SPEC_WHERE`). Pola yang sama dipakai SPEC-431 (`markDone` +
// `ALREADY_DONE_NOTE`) untuk menutup baris basi.
export async function markCanceled(id: string, note: string): Promise<boolean> {
  const { count } = await prisma.schedulerQueueItem.updateMany({
    where: { id, status: "queued" }, data: { status: "canceled", note },
  });
  return count > 0;
}
export async function markRequeued(id: string): Promise<boolean> {
  const { count } = await prisma.schedulerQueueItem.updateMany({
    where: { id, status: "canceled" }, data: { status: "queued", note: null },
  });
  return count > 0;
}

// SPEC-522 · gerbang pra-proses governor: `drain()` mengambil snapshot `queued()` SEKALI lalu
// memproses itemnya berurutan, dan tiap peluncuran men-spawn worktree + sesi tmux (hitungan
// detik) — item di posisi ke-N bisa duduk puluhan detik di dalam loop sesudah snapshotnya diambil.
export async function isQueued(id: string): Promise<boolean> {
  const row = await prisma.schedulerQueueItem.findUnique({ where: { id }, select: { status: true } });
  return row?.status === "queued";
}
