import type { LeadFlow } from "@prisma/client";
import { LEAD_FLOW_OPEN, type LeadFlowStatus, type LeadFlowView, type LeadGate } from "@hanoman/shared";
import { prisma } from "../../db";
import { leadWindow } from "./page";

// SPEC-485 · ADR-0102 · satu RANTAI keputusan sebagai objek berstatus.
//
// Sampai spec ini, "alur" hanya ada sebagai kebetulan: beberapa baris `LeadDecision` yang berdekatan
// waktunya. Karena itu tak ada tempat untuk menegakkan "pertanyaan lanjutan hanya boleh masuk ke
// alur yang masih aktif", dan tak ada yang bisa ditanya "sudah di-submit belum".
//
// Modul ini sengaja TIDAK punya fungsi hapus — cermin `trail.ts` (AC-32): jejak keputusan tak
// dihapus lead maupun operator, dan alur adalah bagian dari jejak itu.

/** Alasan sebuah alur ditutup. Terbatas supaya jejaknya bisa disaring, bukan prosa bebas. */
export type FlowCloseReason = "tunggal" | "submit" | "operator" | "kedaluwarsa";

/**
 * Alur yang tak ada atau sudah tertutup. Dibedakan dari galat lain karena route menerjemahkannya
 * jadi **409** — "tak ada yang rusak, kesempatannya yang sudah lewat".
 */
export class LeadFlowClosedError extends Error {
  constructor(readonly flowId: string, readonly flowStatus: string) {
    super(`rantai keputusan ${flowId} sudah ${flowStatus === "tak-ada" ? "tidak ada" : flowStatus}`);
    this.name = "LeadFlowClosedError";
  }
}

const isOpen = (s: string): boolean => (LEAD_FLOW_OPEN as readonly string[]).includes(s);

/** Judul alur = pertanyaan pertama, terpangkas. Ia yang dibaca operator di daftar. */
const flowTitle = (q: string): string => q.replace(/\s+/g, " ").trim().slice(0, 200);

export async function openFlow(i: {
  projectId: string; specId?: string | null; sessionId?: string | null;
  gate: LeadGate; title: string; ttlMin: number;
}): Promise<LeadFlow> {
  return prisma.leadFlow.create({
    data: {
      projectId: i.projectId, specId: i.specId ?? null, sessionId: i.sessionId ?? null,
      gate: i.gate, title: flowTitle(i.title),
      expiresAt: new Date(Date.now() + Math.max(1, i.ttlMin) * 60_000),
    },
  });
}

/** Lanjutkan rantai. Tertutup / tak ada → `LeadFlowClosedError`; TAK PERNAH dibuatkan diam-diam. */
export async function joinFlow(id: string): Promise<LeadFlow> {
  const row = await prisma.leadFlow.findUnique({ where: { id } });
  if (!row) throw new LeadFlowClosedError(id, "tak-ada");
  if (!isOpen(row.status)) throw new LeadFlowClosedError(id, row.status);
  return row;
}

/**
 * Satu langkah selesai dijalankan. `answered` = langkah itu melahirkan keputusan yang BERLAKU;
 * langkah yang gagal tetap menaikkan `steps` (ia benar-benar terjadi dan memakai giliran agen) tapi
 * tak memindahkan status — alur yang semua langkahnya gagal masih "menunggu jawaban", dan itu
 * pembacaan yang benar bagi operator.
 */
export async function markFlowStep(id: string, answered: boolean): Promise<void> {
  const row = await prisma.leadFlow.findUnique({ where: { id } });
  if (!row || !isOpen(row.status)) return;
  await prisma.leadFlow.update({
    where: { id },
    data: {
      steps: { increment: 1 },
      ...(answered && row.status === "menunggu" ? { status: "sebagian" } : {}),
    },
  });
}

/**
 * Tutup alur. `null` bila ia sudah tertutup — penutupan PERTAMA yang berlaku, dan alasannya tak
 * boleh ditulis ulang: "operator membatalkan" dan "peminta men-submit" adalah dua peristiwa berbeda
 * yang harus tetap terbedakan di jejak.
 */
export async function closeFlow(id: string, reason: FlowCloseReason): Promise<LeadFlow | null> {
  const row = await prisma.leadFlow.findUnique({ where: { id } });
  if (!row || !isOpen(row.status)) return null;
  const status: LeadFlowStatus = reason === "operator" || reason === "kedaluwarsa" ? "dibatalkan" : "selesai";
  return prisma.leadFlow.update({
    where: { id }, data: { status, closeReason: reason, closedAt: new Date() },
  });
}

// SPEC-523 · amplop, bukan array telanjang. `total` menghormati penyaring.
export async function listFlows(f: {
  projectId?: string; status?: string; take?: number; skip?: number; page?: number; limit?: number;
} = {}): Promise<{ rows: LeadFlow[]; total: number; page: number; pageSize: number }> {
  const where = {
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
  const w = leadWindow(f);
  const total = await prisma.leadFlow.count({ where });
  const rows = await prisma.leadFlow.findMany({
    where, orderBy: { createdAt: "desc" }, take: w.take, skip: w.skip,
  });
  return { rows, total, page: w.page, pageSize: w.pageSize };
}

/**
 * Alur yang ditinggalkan punya UJUNG. Peminta bisa mati di tengah rantai (sesi ditutup, agen
 * crash), dan tanpa penyapu ini alurnya `sebagian` selamanya — tak ada yang tahu apakah ia masih
 * ditunggu. Dipanggil dari tick lead; tak pernah membuat timer sendiri (ADR-0024).
 *
 * Idempoten: `closeFlow` melewatkan yang sudah tertutup, jadi dua putaran yang berpapasan tak
 * saling merusak dan penyapu ini tak butuh penjaga re-entrancy sendiri.
 */
export async function expireFlows(now: Date): Promise<LeadFlow[]> {
  const due = await prisma.leadFlow.findMany({
    where: { status: { in: [...LEAD_FLOW_OPEN] }, expiresAt: { lt: now } },
    orderBy: { createdAt: "asc" }, take: 100,
  });
  const out: LeadFlow[] = [];
  for (const f of due) {
    const closed = await closeFlow(f.id, "kedaluwarsa");
    if (closed) out.push(closed);
  }
  return out;
}

export function toFlowView(r: LeadFlow): LeadFlowView {
  return {
    id: r.id, projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    gate: r.gate as LeadFlowView["gate"], status: r.status as LeadFlowView["status"],
    title: r.title, steps: r.steps, closeReason: r.closeReason,
    openedAt: r.openedAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    expiresAt: r.expiresAt.toISOString(),
  };
}
