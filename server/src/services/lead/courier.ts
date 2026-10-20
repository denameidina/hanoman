import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LeadEvent } from "@prisma/client";
import { resolveHome } from "@hanoman/runner";
import { prisma } from "../../db";
import { sendToPane, getSessionAsync } from "../pty";
import { getLead } from "./config";
import { pendingBatch, markDelivered, setEventOpenedHook } from "./inbox";
import { leadSessionId, noteDelivered, rotateLeadSession, ensureLeadSession } from "./lead-session";
import { humanActiveAt } from "./human-input";
import { formatBatch } from "./lead-prompt";

// ADR-0228 · KURIR. Satu-satunya yang mengetik ke pane lead. Ia menunggu pane DIAM (hook Stop) dan
// manusia tak sedang mengetik; event yang datang selama lead bekerja ikut batch berikutnya. Pane
// yang baru lahir dianggap diam sesudah giliran pertamanya (Stop pertama), bukan saat lahir.
//
// Batch DITULIS KE BERKAS, dan yang diketik ke pane hanya satu baris yang menunjuknya:
// `sendToPane` meratakan baris baru jadi spasi dan mengetik per potongan 1 KB (ADR-0085), jadi
// beberapa prompt lengkap sekaligus akan kehilangan strukturnya di kolom input TUI.

const idle = new Set<string>();
const sending = new Set<string>();
export function __resetCourier(): void { idle.clear(); sending.clear(); }
export function markLeadIdle(sessionId: string): void { idle.add(sessionId); }
export function isLeadIdle(id: string): boolean { return idle.has(id); }

const HUMAN_QUIET_MS = 120_000;

export const batchDir = (projectId: string): string => join(resolveHome(), "lead-batches", projectId);

export type CourierDeps = {
  live: (id: string) => Promise<boolean>;
  batch: (projectId: string) => Promise<LeadEvent[]>;
  human: (id: string) => number | null;
  brief: (projectId: string) => Promise<string>;
  /** Tulis isi batch; mengembalikan path berkasnya. */
  write: (projectId: string, text: string) => string;
  send: (id: string, line: string) => Promise<boolean>;
  markDelivered: (ids: string[]) => Promise<void>;
  ensure: (projectId: string) => Promise<void>;
  now: () => number;
};

let briefFn: (projectId: string) => Promise<string> = async () => "(situasi tak tersedia — panggil /brief)";
/** Dipasang route lead-pane — sumber `brief` yang SAMA dengan GET /lead-pane/brief. */
export function setBriefBuilder(fn: (projectId: string) => Promise<string>): void { briefFn = fn; }

export const prodCourierDeps: CourierDeps = {
  live: async (id) => { const s = await getSessionAsync(id).catch(() => undefined); return !!s && !s.exited; },
  batch: pendingBatch,
  human: humanActiveAt,
  brief: (p) => briefFn(p).catch(() => "(situasi tak tersedia — panggil /brief)"),
  write: (projectId, text) => {
    const dir = batchDir(projectId);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    writeFileSync(file, text);
    return file;
  },
  send: (id, line) => sendToPane(id, line),
  markDelivered,
  ensure: async (p) => { await ensureLeadSession(p).catch(() => null); },
  now: Date.now,
};

/** Antar satu batch bila pane hidup, diam, dan manusia tak sedang mengetik. Mengembalikan jumlah event. */
export async function deliver(projectId: string, deps: CourierDeps = prodCourierDeps): Promise<number> {
  const id = leadSessionId(projectId);
  if (sending.has(id)) return 0;
  if (!(await deps.live(id))) { await deps.ensure(projectId); return 0; }
  if (!idle.has(id)) return 0;
  const h = deps.human(id);
  if (h !== null && deps.now() - h < HUMAN_QUIET_MS) return 0;
  sending.add(id);
  try {
    const events = await deps.batch(projectId);
    if (!events.length) return 0;
    const file = deps.write(projectId, formatBatch(events, await deps.brief(projectId)));
    const ask = events.filter((e) => e.kind === "ask").length;
    const line = `[hanoman] ${events.length} event menunggu keputusanmu${ask ? ` (${ask} pertanyaan sesi pekerja yang tertahan)` : ""}. Baca seluruhnya: cat ${file} — lalu jawab tiap event dengan act.`;
    if (!(await deps.send(id, line))) return 0;
    idle.delete(id);
    await deps.markDelivered(events.map((e) => e.id));
    return events.length;
  } finally { sending.delete(id); }
}

/** Dipanggil tick engine & hook pembukaan event. Tak pernah merotasi — itu milik `onLeadStop`. */
export async function deliverAll(projects: string[], deps: CourierDeps = prodCourierDeps): Promise<void> {
  for (const p of projects) {
    try {
      const n = await deliver(p, deps);
      if (n) noteDelivered(p, n);
    } catch (e) { console.error(`kurir lead ${p}:`, e); }
  }
}

export type StopDeps = {
  rotateAfter: () => Promise<number>;
  delivered: (projectId: string) => number;
  /** Event `open` + `delivered` proyek itu. */
  openCount: (projectId: string) => Promise<number>;
  rotate: (projectId: string) => Promise<unknown>;
  deliver: (projectId: string) => Promise<number>;
};
export const prodStopDeps: StopDeps = {
  rotateAfter: async () => (await getLead()).rotateAfterEvents,
  delivered: (p) => noteDelivered(p, 0),
  openCount: (p) => prisma.leadEvent.count({ where: { projectId: p, status: { in: ["open", "delivered"] } } }),
  rotate: (p) => rotateLeadSession(p),
  deliver: async (p) => { const n = await deliver(p); if (n) noteDelivered(p, n); return n; },
};

/**
 * Giliran pane lead selesai (hook Stop). Rotasi HANYA di sini: pane diam dan tak ada event yang
 * masih terbuka — merotasi di tengah giliran memutus lead yang sedang mengerjakan batch.
 */
export async function onLeadStop(sessionId: string, projectId: string, deps: StopDeps = prodStopDeps):
  Promise<"rotated" | "delivered" | "idle"> {
  markLeadIdle(sessionId);
  if (deps.delivered(projectId) >= await deps.rotateAfter() && (await deps.openCount(projectId)) === 0) {
    await deps.rotate(projectId);
    return "rotated";
  }
  return (await deps.deliver(projectId)) ? "delivered" : "idle";
}

setEventOpenedHook((p) => { void deliverAll([p]); });
