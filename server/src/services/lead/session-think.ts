import type { LeadEventKind, LeadGate, LeadKind, LeadSelect } from "@hanoman/shared";
import { getLead } from "./config";
import { leadProjectConfig } from "./project-config";
import { openEvent, awaitEvent } from "./inbox";

// ADR-0228 · OTAK = SESI. Pengganti `brain.think`: prompt yang sama (`leadPrompt`) menjadi satu
// event di inbox, dan jawaban pane (bentuk `zLeadVerdict`) dikembalikan sebagai teks JSON supaya
// `decide()` mem-parse-nya lewat `parseLeadVerdict` persis seperti keluaran `claude -p` dulu.

export class LeadLateError extends Error {}
export class LeadRejectedError extends Error {}

export type ThinkCtx = {
  projectId: string; gate: LeadGate; kind: LeadKind; question: string; options: string[];
  select: LeadSelect | null; sessionId: string | null; specId: string | null; timeoutMs: number;
  /** Dipanggil begitu event lahir — `decide()` menautkan baris jejaknya ke event itu. */
  onEvent?: (eventId: string) => void;
};
export type SessionThinkDeps = { ensure: (projectId: string) => Promise<void> };

let defaultEnsure: (projectId: string) => Promise<void> = async () => {};
/** Dipasang `lead-session.ts` — menghindari impor sirkular inbox ⇄ sesi. */
export function setEnsureLeadSession(fn: (projectId: string) => Promise<void>): void { defaultEnsure = fn; }

export function eventKindFor(gate: LeadGate, kind: LeadKind): LeadEventKind {
  if (gate === "detected" || gate === "contract") return "ask";
  if (kind === "order") return "pulse";
  return "session-ended";
}

/** Tenggat per jenis: pertanyaan memakai SLA proyek; sisanya dua kali tenggat antar-jemput. */
export async function thinkTimeoutMs(projectId: string, gate: LeadGate, kind: LeadKind): Promise<number> {
  const cfg = await getLead();
  return eventKindFor(gate, kind) === "ask"
    ? leadProjectConfig(cfg, projectId).answerSlaSec * 1000
    : cfg.deliverTimeoutSec * 2000;
}

export async function thinkViaSession(prompt: string, o: ThinkCtx,
  deps: SessionThinkDeps = { ensure: (p) => defaultEnsure(p) }): Promise<string> {
  // Pane yang gagal lahir tak menggagalkan apa pun di sini: event tetap menunggu, tenggatnya yang memutus.
  await deps.ensure(o.projectId).catch(() => undefined);
  const kind = eventKindFor(o.gate, o.kind);
  const e = await openEvent({
    projectId: o.projectId, kind, question: o.question,
    payload: { prompt, gate: o.gate, leadKind: o.kind, options: o.options, select: o.select, mode: "wait" },
    sessionId: o.sessionId, specId: o.specId,
    deadlineMs: kind === "ask" ? Date.now() + o.timeoutMs : null,
  });
  o.onEvent?.(e.id);
  const r = await awaitEvent(e.id, o.timeoutMs);
  if (r.status === "answered") return JSON.stringify(r.verdict);
  if (r.status === "rejected") throw new LeadRejectedError("tindakan lead ditolak manusia — diserahkan ke manusia");
  if (r.status === "human") throw new LeadLateError("manusia mengambil alih event ini");
  throw new LeadLateError(`sesi lead tak menjawab dalam ${Math.round(o.timeoutMs / 1000)} dtk — diserahkan ke manusia`);
}
