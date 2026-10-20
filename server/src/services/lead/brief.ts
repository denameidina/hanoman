import type { LeadApprovalView, LeadEventView } from "@hanoman/shared";
import { prisma } from "../../db";
import { listSessionsAsync } from "../pty";
import { UNSTARTED_SPEC_WHERE } from "../scheduler/queue";
import { launchBudget, type Budget } from "./budget";
import { toEventView } from "./inbox";
import { toApprovalView } from "./approvals";

// ADR-0228 · "periksa dulu" yang murah: satu panggilan memberi pane lead jatah, kuota, sesi hidup,
// backlog siap, inbox, dan izin yang menunggu. Sumber yang SAMA dipakai kurir untuk bagian
// "Situasi sekarang" tiap batch — dua sumber angka akan berselisih diam-diam (SPEC-432).

export type LeadBrief = {
  budget: Budget;
  live: { id: string; specId: string | null; exited: boolean }[];
  ready: { id: string; title: string; priority: string }[];
  inbox: LeadEventView[];
  approvals: LeadApprovalView[];
};

export async function buildBrief(projectId: string): Promise<{ text: string; data: LeadBrief }> {
  const [budget, sessions, ready, inbox, approvals] = await Promise.all([
    launchBudget(projectId),
    listSessionsAsync().catch(() => []),
    prisma.spec.findMany({
      where: { ...UNSTARTED_SPEC_WHERE, projectId }, select: { id: true, title: true, priority: true },
      orderBy: { id: "asc" }, take: 30,
    }),
    prisma.leadEvent.findMany({
      where: { projectId, status: { in: ["open", "delivered"] } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 30,
    }),
    prisma.leadApproval.findMany({ where: { projectId, status: "pending" }, orderBy: { createdAt: "asc" } }),
  ]);
  const live = sessions.filter((s) => s.projectId === projectId && !s.id.startsWith("lead-"))
    .map((s) => ({ id: s.id, specId: s.specId ?? null, exited: s.exited }));
  const data: LeadBrief = { budget, live, ready, inbox: inbox.map(toEventView), approvals: approvals.map(toApprovalView) };
  const text = [
    `Jatah peluncuran: ${budget.n}${budget.reasons.length ? ` (${budget.reasons.join("; ")})` : ""}`,
    `Sesi pekerja: ${live.map((s) => `${s.id}${s.specId ? ` [${s.specId}]` : ""}${s.exited ? " (mati)" : ""}`).join(", ") || "tak ada"}`,
    `Backlog siap: ${ready.map((r) => `${r.id} [${r.priority}]`).join(", ") || "tak ada"}`,
    `Inbox terbuka: ${inbox.length} · Menunggu izin manusia: ${approvals.length}`,
  ].join("\n");
  return { text, data };
}
