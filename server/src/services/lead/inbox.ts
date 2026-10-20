import type { LeadEvent, Prisma } from "@prisma/client";
import {
  LEAD_EVENT_PRIORITY,
  type LeadEventKind, type LeadEventView, type LeadGate, type LeadKind, type LeadSelect, type LeadVerdict,
} from "@hanoman/shared";
import { prisma } from "../../db";

// ADR-0228 · INBOX SESI LEAD. Barisnya di DB (selamat dari restart); yang in-memory hanya penunggu
// — janji milik pemanggil yang sedang menunggu di proses ini. Restart memutus penunggu, dan itu
// benar: pemanggilnya (rantai dialog, route kontrak) ikut mati bersama proses.

export type LeadEventPayload = {
  prompt: string; gate: LeadGate; leadKind: LeadKind; options: string[]; select: LeadSelect | null;
  // `post` = event TANPA penunggu (denyut/tindak lanjut sesi): dieksekusi saat `act` atau saat
  // izin disetujui — bukan oleh pemanggil yang menunggu (`post.ts`).
  mode?: "wait" | "post";
  request?: unknown;
  flowId?: string;
  step?: number;
};
export type EventOutcome =
  | { status: "answered"; verdict: LeadVerdict; evidence: string[] }
  | { status: "late" | "human" | "rejected" };

const OPEN = ["open", "delivered"];
const waiters = new Map<string, (o: EventOutcome) => void>();
let opened: (projectId: string) => void = () => {};

/** Dipasang kurir (`courier.ts`): event baru membangunkan pengantaran tanpa menunggu tick. */
export function setEventOpenedHook(fn: (projectId: string) => void): void { opened = fn; }
export function __resetInbox(): void { waiters.clear(); opened = () => {}; }

export async function openEvent(i: {
  projectId: string; kind: LeadEventKind; question: string; payload: LeadEventPayload;
  sessionId?: string | null; specId?: string | null; deadlineMs?: number | null;
}): Promise<LeadEvent> {
  const e = await prisma.leadEvent.create({ data: {
    projectId: i.projectId, kind: i.kind, priority: LEAD_EVENT_PRIORITY[i.kind],
    question: i.question.slice(0, 2000), payload: i.payload as unknown as Prisma.InputJsonValue,
    sessionId: i.sessionId ?? null, specId: i.specId ?? null,
    deadlineAt: i.deadlineMs ? new Date(i.deadlineMs) : null,
  } });
  try { opened(i.projectId); } catch { /* kurir gagal dibangunkan; tick berikutnya menyusul */ }
  return e;
}

/** Tunggu event ditutup. Batas waktu menutupnya sebagai `late` — jawaban yang datang sesudahnya kalah. */
export function awaitEvent(id: string, timeoutMs: number): Promise<EventOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      void closeEvent(id, "late").catch(() => false).finally(() => resolve({ status: "late" }));
    }, timeoutMs);
    waiters.set(id, (o) => { clearTimeout(timer); waiters.delete(id); resolve(o); });
  });
}

/** Penutupan ATOMIK: hanya baris yang MASIH terbuka yang berpindah — jawaban ganda kalah di sini. */
async function transition(id: string, data: Prisma.LeadEventUpdateManyMutationInput): Promise<boolean> {
  const r = await prisma.leadEvent.updateMany({ where: { id, status: { in: OPEN } }, data });
  return r.count === 1;
}

export async function resolveEvent(id: string, r: { verdict: LeadVerdict; evidence: string[]; decisionId?: string }): Promise<boolean> {
  const ok = await transition(id, { status: "done", closedAt: new Date(), ...(r.decisionId ? { decisionId: r.decisionId } : {}) });
  if (ok) waiters.get(id)?.({ status: "answered", verdict: r.verdict, evidence: r.evidence });
  return ok;
}

/** `rejected` menutup event sebagai `done` (ada keputusan — manusia menolaknya); penunggunya diberi tahu. */
export async function closeEvent(id: string, status: "late" | "human" | "rejected"): Promise<boolean> {
  const ok = await transition(id, { status: status === "rejected" ? "done" : status, closedAt: new Date() });
  if (ok) waiters.get(id)?.({ status });
  return ok;
}

export async function isEventOpen(id: string): Promise<boolean> {
  return !!(await prisma.leadEvent.findFirst({ where: { id, status: { in: OPEN } }, select: { id: true } }));
}

/** Batch berikutnya: `open` saja, prioritas kelas lalu umur. */
export function pendingBatch(projectId: string): Promise<LeadEvent[]> {
  return prisma.leadEvent.findMany({
    where: { projectId, status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 20,
  });
}

export async function markDelivered(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.leadEvent.updateMany({
    where: { id: { in: ids }, status: "open" }, data: { status: "delivered", deliveredAt: new Date() },
  });
}

/**
 * Sapuan (menumpang tick lead, ADR-0024). Tenggat lewat → `late` (jatuh ke manusia, ADR-0167).
 * Terkirim tapi tak dijawab dalam `deliverTimeoutMs` → kembali `open` dengan `attempts` naik —
 * engine merotasi pane yang dua kali melewatkan event yang sama.
 */
export async function sweepInbox(now: number, deliverTimeoutMs: number): Promise<{ late: number; requeued: number }> {
  const due = await prisma.leadEvent.findMany({
    where: { status: { in: OPEN }, deadlineAt: { lt: new Date(now) } }, select: { id: true },
  });
  let late = 0;
  for (const e of due) if (await closeEvent(e.id, "late")) late++;
  const stale = await prisma.leadEvent.updateMany({
    where: { status: "delivered", deliveredAt: { lt: new Date(now - deliverTimeoutMs) } },
    data: { status: "open", deliveredAt: null, attempts: { increment: 1 } },
  });
  return { late, requeued: stale.count };
}

export function toEventView(e: LeadEvent): LeadEventView {
  return {
    id: e.id, projectId: e.projectId, kind: e.kind as LeadEventView["kind"],
    status: e.status as LeadEventView["status"], priority: e.priority, question: e.question,
    specId: e.specId, sessionId: e.sessionId,
    deadlineAt: e.deadlineAt?.toISOString() ?? null, deliveredAt: e.deliveredAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(), decisionId: e.decisionId,
  };
}

/** Halaman inbox untuk manusia (route `GET /lead/inbox`); pola paginasi `listDecisions`. */
export async function listInboxPage(f: { projectId?: string; status?: string; page?: string; limit?: string } = {}):
  Promise<{ items: LeadEventView[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(100, Math.max(1, Number(f.limit) || 20));
  const page = Math.max(1, Number(f.page) || 1);
  const where: Prisma.LeadEventWhereInput = {
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.leadEvent.count({ where }),
    prisma.leadEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { items: rows.map(toEventView), total, page, pageSize };
}
