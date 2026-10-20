import type { LeadAct, LeadActResult, LeadEventKind, LeadVerdict } from "@hanoman/shared";
import { prisma } from "../../db";
import { checkAct, type GuardResult, type GuardInput } from "./guard";
import { resolveEvent } from "./inbox";
import { launchBudget } from "./budget";
import { executeEventVerdict, specIdOfOption } from "./post";

// ADR-0228 · SATU-SATUNYA pintu tindakan pane lead. Guard dulu, lalu tiga cabang: tolak (lead
// membaca alasannya dan event tetap terbuka), tahan sebagai izin manusia, atau lepaskan — ke
// penunggu event (pintu tanya/kontrak) atau langsung dieksekusi (event denyut tanpa penunggu).

export type ActDeps = {
  guard: (i: GuardInput) => Promise<GuardResult>;
  budget: (projectId: string) => Promise<{ n: number; reasons: string[] }>;
  createApproval: (i: { eventId: string; projectId: string; act: LeadAct; report: string[]; target: string | null }) => Promise<{ id: string }>;
  execute: (eventId: string, verdict: LeadVerdict) => Promise<{ applied: { ok: boolean; detail: string } | null }>;
};

let createApprovalImpl: ActDeps["createApproval"] = async () => { throw new Error("antrean izin lead belum terpasang"); };
/** Dipasang `approvals.ts` — menghindari impor sirkular act ⇄ approvals. */
export function setCreateApproval(fn: ActDeps["createApproval"]): void { createApprovalImpl = fn; }

export const prodActDeps: ActDeps = {
  guard: (i) => checkAct(i),
  budget: (p) => launchBudget(p),
  createApproval: (i) => createApprovalImpl(i),
  execute: (id, v) => executeEventVerdict(id, v, {}, { alreadyClosed: true }),
};

export async function processAct(projectId: string, act: LeadAct, deps: ActDeps = prodActDeps): Promise<LeadActResult> {
  const e = await prisma.leadEvent.findUnique({ where: { id: act.eventId } });
  if (!e || e.projectId !== projectId) return { outcome: "ditolak", code: "event-closed", detail: "event tak ada untuk proyek ini" };
  const v = act.verdict;
  const choices = v.choices.length ? v.choices : (v.choice.trim() ? [v.choice] : []);
  const payload = e.payload as { mode?: string; request?: unknown } | null;
  const base: Omit<GuardInput, "specId"> = {
    projectId, eventKind: e.kind as LeadEventKind, eventOpen: e.status === "open" || e.status === "delivered",
    action: v.action, sessionId: e.sessionId, decision: v.decision, choices, reason: v.reason, evidence: act.evidence,
  };

  // Ambil backlog memilih BEBERAPA spec sekaligus: jumlahnya dibatasi jatah, dan tiap pilihan
  // digerbangi sendiri — semuanya lolos atau tak satu pun.
  const picking = e.kind === "pulse" && v.action === "start-session";
  const targets: (string | null)[] = picking ? choices.map(specIdOfOption).filter(Boolean) : [e.specId];
  if (picking) {
    if (!targets.length) return { outcome: "ditolak", code: "spec-empty", detail: "start-session tanpa pilihan backlog di `choices`" };
    const b = await deps.budget(projectId);
    if (targets.length > b.n)
      return { outcome: "ditolak", code: "budget-zero", detail: `memilih ${targets.length} backlog melebihi jatah ${b.n}${b.reasons.length ? ` (${b.reasons.join("; ")})` : ""}` };
  }
  const report: string[] = [];
  let ask = false;
  for (const specId of targets) {
    const g = await deps.guard({ ...base, specId });
    if (g.outcome === "ditolak") return { outcome: "ditolak", code: g.code, detail: g.report.join("; ") };
    if (g.outcome === "butuh-izin") ask = true;
    for (const r of g.report) if (!report.includes(r)) report.push(r);
  }

  if (ask) {
    const ap = await deps.createApproval({
      eventId: e.id, projectId, act, report,
      target: targets.filter(Boolean).join(", ") || e.sessionId,
    });
    return { outcome: "butuh-izin", approvalId: ap.id, detail: report.join("; ") || "menunggu izin manusia" };
  }

  if (!(await resolveEvent(e.id, { verdict: v, evidence: act.evidence })))
    return { outcome: "ditolak", code: "event-closed", detail: "event sudah ditutup" };
  if (payload?.mode === "post" && payload.request) {
    const r = await deps.execute(e.id, v).catch((err: Error) => ({ applied: { ok: false, detail: err.message } }));
    return { outcome: "lolos", detail: r.applied?.detail ?? (report.join("; ") || "dicatat") };
  }
  return { outcome: "lolos", detail: report.join("; ") || "diteruskan" };
}
