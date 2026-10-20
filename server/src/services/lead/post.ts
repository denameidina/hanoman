import type { LeadDecision, LeadEvent } from "@prisma/client";
import type { LeadEventKind, LeadVerdict } from "@hanoman/shared";
import { prisma } from "../../db";
import { enqueue } from "../scheduler/queue";
import { prepareDecision, finalizeDecision, type DecideRequest, type PreparedDecision } from "./decide";
import { eventKindFor } from "./session-think";
import { openEvent, resolveEvent } from "./inbox";
import { applyAction, type ApplyResult } from "./apply";

// ADR-0228 · EVENT TANPA PENUNGGU. Denyut berjalan di tick lead: bila ia menunggu jawaban pane
// lewat `decide()`, seluruh tick macet — dan izin merge yang menunggu manusia berjam-jam akan
// kedaluwarsa sebelum disetujui. Maka event pintu denyut dibuka di sini dan pembukanya langsung
// kembali; keputusannya dieksekusi saat pane `act` lolos atau saat izinnya disetujui.

/** Bagian `PreparedDecision` yang disimpan di payload (prompt sudah ada di `payload.prompt`). */
type Stored = Omit<PreparedDecision, "prompt">;

/** Label opsi denyut berbentuk `SPEC-123 · [tinggi] judul` — id = token pertama. */
export const specIdOfOption = (label: string): string => label.trim().split(/\s+/)[0] ?? "";

/** Kode di awal `detail` hasil integrasi yang gagal (`apply.ts`) — pemicu event `integrate-failed`. */
const INTEGRATE_FAIL = /^(verify-failed|conflict|worktree-dirty|plan-open|integrate-busy):/;

export async function postDecision(req: DecideRequest, kind?: LeadEventKind): Promise<LeadEvent | null> {
  const p = await prepareDecision(req);
  if (!p) return null;
  const { prompt, ...stored } = p;
  return openEvent({
    projectId: req.projectId, kind: kind ?? eventKindFor(req.gate, req.kind), question: req.question,
    payload: {
      prompt, gate: req.gate, leadKind: req.kind, options: p.options, select: req.select ?? null,
      mode: "post", request: stored, flowId: p.flowId, step: p.step,
    },
    sessionId: req.sessionId ?? null, specId: req.specId ?? null,
  });
}

/** Dedupe denyut: event dengan awalan pertanyaan yang sama masih menunggu jawaban? */
export async function hasOpenPosted(projectId: string, questionPrefix: string): Promise<boolean> {
  return !!(await prisma.leadEvent.findFirst({
    where: { projectId, status: { in: ["open", "delivered"] }, question: { startsWith: questionPrefix } },
    select: { id: true },
  }));
}

export type ExecuteDeps = {
  apply: (row: LeadDecision) => Promise<ApplyResult>;
  enqueue: typeof enqueue;
  finalize: typeof finalizeDecision;
  post: typeof postDecision;
};
const prodExecuteDeps: ExecuteDeps = { apply: (r) => applyAction(r), enqueue, finalize: finalizeDecision, post: postDecision };

/**
 * Jalankan keputusan pane atas event `post`. `alreadyClosed` = pemanggil (act/izin) sudah menutup
 * event lewat `resolveEvent`; tanpa itu fungsi ini menutupnya dulu dan menolak event yang sudah
 * tertutup — tak ada eksekusi ganda.
 */
export async function executeEventVerdict(
  eventId: string, verdict: LeadVerdict, over: Partial<ExecuteDeps> = {}, opts: { alreadyClosed?: boolean } = {},
): Promise<{ row: LeadDecision; applied: ApplyResult | null }> {
  const deps = { ...prodExecuteDeps, ...over };
  const e = await prisma.leadEvent.findUnique({ where: { id: eventId } });
  const payload = e?.payload as { mode?: string; request?: Stored; prompt?: string } | null;
  if (!e || payload?.mode !== "post" || !payload.request) throw new Error(`event ${eventId} bukan event denyut`);
  if (!opts.alreadyClosed && !(await resolveEvent(eventId, { verdict, evidence: [] })))
    throw new Error(`event ${eventId} sudah ditutup`);

  const prepared: PreparedDecision = { ...payload.request, prompt: payload.prompt ?? "" };
  const row = await deps.finalize(prepared, JSON.stringify(verdict), undefined, eventId);
  await prisma.leadEvent.update({ where: { id: eventId }, data: { decisionId: row.id } }).catch(() => null);
  if (row.status !== "berlaku" || row.action === "none") return { row, applied: null };

  // Ambil backlog: HANYA pilihan lead yang diantrekan — tak ada "sisa masuk di belakang".
  if (row.action === "start-session" && prepared.req.kind === "order") {
    const picked = (Array.isArray(row.choices) ? (row.choices as { option?: unknown }[]) : [])
      .map((c) => specIdOfOption(String(c?.option ?? ""))).filter(Boolean);
    const specs = await prisma.spec.findMany({ where: { id: { in: picked } }, select: { id: true, projectId: true, priority: true } });
    for (const s of specs) await deps.enqueue({ specId: s.id, projectId: s.projectId, source: "lead", priority: s.priority });
    return { row, applied: { ok: true, detail: `diantrekan: ${specs.map((s) => s.id).join(", ") || "tak ada"}` } };
  }

  const applied = await deps.apply(row).catch((err: Error) => ({ ok: false, detail: err.message }));
  if (!applied.ok && INTEGRATE_FAIL.test(applied.detail) && row.specId) {
    await deps.post({
      projectId: row.projectId, specId: row.specId, sessionId: row.sessionId,
      gate: "pulse", kind: "quality",
      question: `Integrasi ${row.specId} gagal: ${applied.detail.split("\n")[0]}. Lanjutkan sesi pekerja untuk memperbaikinya, atau eskalasi ke manusia?`,
      options: [
        "resume-session — lanjutkan sesi pekerja; tulis di `decision` apa yang harus ia perbaiki",
        "none — eskalasi ke manusia; isi `missing` dengan apa yang kurang",
      ],
      notes: [applied.detail.slice(0, 1800)],
    }, "integrate-failed").catch(() => null);
  }
  return { row, applied };
}
