import type { LeadApproval, Prisma } from "@prisma/client";
import { zLeadVerdict, type LeadAct, type LeadApprovalView } from "@hanoman/shared";
import { prisma } from "../../db";
import { closeEvent, openEvent, resolveEvent } from "./inbox";
import { setCreateApproval } from "./act";
import { executeEventVerdict } from "./post";
import { recordLeadNotice } from "../notifications";
import { pushApprovalToTelegram } from "../telegram/notify";

// ADR-0228 · ANTREAN IZIN. Verdict lead DITAHAN apa adanya; persetujuan melepaskannya ke event
// yang sama, jadi tindakan yang jalan persis yang dilihat manusia. Kedaluwarsa = ditolak: tak ada
// tindakan lead yang pernah jalan karena manusia diam.

const strs = (j: unknown): string[] => (Array.isArray(j) ? j.map(String) : []);

export function toApprovalView(a: LeadApproval): LeadApprovalView {
  return {
    id: a.id, eventId: a.eventId, projectId: a.projectId, action: a.action, target: a.target,
    reason: a.reason, evidence: strs(a.evidence), gateReport: strs(a.gateReport),
    status: a.status as LeadApprovalView["status"], decidedBy: a.decidedBy,
    decidedAt: a.decidedAt?.toISOString() ?? null, note: a.note, createdAt: a.createdAt.toISOString(),
  };
}

export type ApprovalDeps = {
  notice: (title: string, projectId: string, approvalId: string) => Promise<void>;
  push: typeof pushApprovalToTelegram;
};
const prodApprovalDeps: ApprovalDeps = {
  notice: (title, projectId, id) => recordLeadNotice(`approval:${id}`, title, projectId),
  push: (p) => pushApprovalToTelegram(p),
};

export async function createApproval(
  i: { eventId: string; projectId: string; act: LeadAct; report: string[]; target: string | null },
  deps: ApprovalDeps = prodApprovalDeps,
): Promise<{ id: string }> {
  const a = await prisma.leadApproval.create({ data: {
    eventId: i.eventId, projectId: i.projectId, action: i.act.verdict.action, target: i.target,
    reason: i.act.verdict.reason, evidence: i.act.evidence as Prisma.InputJsonValue,
    gateReport: i.report as Prisma.InputJsonValue,
    verdict: i.act.verdict as unknown as Prisma.InputJsonValue,
  } });
  const title = `Lead minta izin · ${a.action}${a.target ? ` ${a.target}` : ""}: ${i.act.verdict.decision.replace(/\s+/g, " ").slice(0, 90)}`;
  await deps.notice(title, i.projectId, a.id).catch(() => undefined);
  void deps.push({ id: a.id, title, reason: a.reason, report: i.report }).catch(() => 0);
  return { id: a.id };
}

/**
 * Putuskan satu izin. Idempoten: hanya `pending` yang berpindah (`updateMany`), keputusan kedua
 * menjawab `null`. Disetujui → event dilepas dengan verdict yang ditahan (penunggunya jalan, atau
 * — event denyut — dieksekusi di sini). Ditolak → event ditutup dan lead diberi event `rejected`.
 */
export async function decideApproval(id: string, d: { approve: boolean; by: string; note?: string }): Promise<LeadApprovalView | null> {
  const moved = await prisma.leadApproval.updateMany({
    where: { id, status: "pending" },
    data: { status: d.approve ? "approved" : "rejected", decidedBy: d.by, decidedAt: new Date(), note: d.note ?? null },
  });
  if (moved.count !== 1) return null;
  const a = (await prisma.leadApproval.findUnique({ where: { id } }))!;
  if (d.approve) {
    const verdict = zLeadVerdict.parse(a.verdict);
    const ev = await prisma.leadEvent.findUnique({ where: { id: a.eventId }, select: { payload: true } });
    const ok = await resolveEvent(a.eventId, { verdict, evidence: strs(a.evidence) });
    if (!ok) {
      await prisma.leadApproval.update({ where: { id }, data: {
        note: `${a.note ? `${a.note} ` : ""}(event sudah tertutup — tak ada yang dijalankan)`,
      } });
    } else if ((ev?.payload as { mode?: string } | null)?.mode === "post") {
      // Event denyut tak punya penunggu: izin yang disetujui MENJALANKANNYA di sini.
      await executeEventVerdict(a.eventId, verdict, {}, { alreadyClosed: true }).catch((e: Error) =>
        prisma.leadApproval.update({ where: { id }, data: { note: `eksekusi gagal: ${e.message}` } }));
    }
  } else {
    await rejectBack(a, d.note ?? null, "menolak");
  }
  return toApprovalView((await prisma.leadApproval.findUnique({ where: { id } }))!);
}

async function rejectBack(a: LeadApproval, note: string | null, verb: string): Promise<void> {
  await closeEvent(a.eventId, "rejected");
  const what = `\`${a.action}\`${a.target ? ` untuk ${a.target}` : ""}`;
  await openEvent({
    projectId: a.projectId, kind: "rejected",
    question: `Manusia ${verb} ${a.action}${a.target ? ` ${a.target}` : ""}`,
    payload: {
      prompt: [
        `Manusia ${verb} tindakanmu ${what}.`,
        `Alasanmu waktu itu: ${a.reason}`,
        `Catatan manusia: ${note ?? "(tanpa catatan)"}`,
        "Sesuaikan langkahmu ke depan. Jawab event ini dengan action `none` dan tulis di `decision` apa yang akan kamu lakukan berbeda.",
      ].join("\n"),
      gate: "contract", leadKind: "answer", options: [], select: null, mode: "post",
    },
  });
}

/** Sapuan (tick lead): izin yang lewat `ttlMs` kedaluwarsa = ditolak, tindakannya tak pernah jalan. */
export async function expireApprovals(now: number, ttlMs: number): Promise<number> {
  const due = await prisma.leadApproval.findMany({ where: { status: "pending", createdAt: { lt: new Date(now - ttlMs) } } });
  let n = 0;
  for (const a of due) {
    const moved = await prisma.leadApproval.updateMany({ where: { id: a.id, status: "pending" }, data: { status: "expired", decidedAt: new Date(now) } });
    if (moved.count === 1) { n++; await rejectBack(a, null, "tak menjawab (kedaluwarsa)"); }
  }
  return n;
}

export async function listApprovalsPage(f: { projectId?: string; status?: string; page?: string; limit?: string } = {}):
  Promise<{ items: LeadApprovalView[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(100, Math.max(1, Number(f.limit) || 20));
  const page = Math.max(1, Number(f.page) || 1);
  const where: Prisma.LeadApprovalWhereInput = {
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.leadApproval.count({ where }),
    prisma.leadApproval.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { items: rows.map(toApprovalView), total, page, pageSize };
}

setCreateApproval((i) => createApproval(i));
