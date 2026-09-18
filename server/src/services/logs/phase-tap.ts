/* SPEC-1217 §D1/AC-S1 · diff murni Map<sessionId, phase|null> di memori terhadap snapshot presence
   tiap tick 3 dtk (buildLocalPresence). BUKAN hook pty ketiga — pty.ts sengaja nol I/O DB. */
import { appendEvent } from "./event-log";

type Row = { sessionId: string; projectId: string; specId?: string; phase?: string };
let known = new Map<string, string | undefined>();

export function observePhases(rows: Row[]): void {
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.sessionId);
    const prev = known.get(r.sessionId);
    if (!known.has(r.sessionId)) { known.set(r.sessionId, r.phase); continue; } // baris pertama: baseline, tak menulis
    if (prev !== r.phase) {
      void appendEvent({
        kind: "session.phase", msg: `sesi ${r.sessionId} fase ${prev ?? "?"} → ${r.phase ?? "?"}`,
        projectId: r.projectId, specId: r.specId ?? null, sessionId: r.sessionId,
        data: { from: prev, to: r.phase },
      });
      known.set(r.sessionId, r.phase);
    }
  }
  for (const id of [...known.keys()]) if (!seen.has(id)) known.delete(id); // hilang dari snapshot → dibuang, tanpa event
}

export function __resetPhaseTap(): void { known = new Map(); }
