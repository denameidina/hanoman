import { payloadShapeFor, priorityFromSeverity } from "@hanoman/shared";

// SPEC-186 · derivasi priority + objective dari source+payload. Satu sumber untuk POST /specs,
// PATCH /specs/:id, dan — sejak SPEC-546 — POST /specs/:id/source. Dipindah dari routes/specs.ts
// justru karena pemakai ketiga itu: fungsi turunan yang dipakai lintas berkas tak boleh hidup
// sebagai fungsi lokal sebuah route.
//
// qa → priority dari severity, objective dari actual/steps; brief → priority manual, objective
// dari outcome/context.
export function deriveSpecFields(source: string, payload: any, manualPriority: string) {
  // SPEC-407 · ADR-0089 · backlog goal: objective ADALAH goal-nya (yang dibaca prompt sesi &
  // kondisi Stop hook). Prioritas tetap manual — tak ada severity untuk diturunkan, dan operator
  // yang tahu seberapa mendesak goal itu.
  // SPEC-825 · ADR-0123 · digerbangi BENTUK payload, bukan nama source: `no_effort` memakai bentuk
  // yang sama, dan predikat bentuknya tetap satu (`payloadShapeFor`).
  if (payloadShapeFor(source) === "goal") {
    const pick = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      priority: manualPriority,
      objective: pick(payload?.goal) || pick(payload?.done) || "— goal belum diisi.",
    };
  }
  const isQa = source === "qa";
  // SPEC-546 · aturan severity→priority kini fungsi bersama (`priorityFromSeverity`), sumber yang
  // sama dipakai `convertPayload` — dua ternari yang berdiri sendiri pasti melenceng suatu hari.
  const priority = isQa && payload && "severity" in payload
    ? priorityFromSeverity(payload.severity) : manualPriority;
  const objective = isQa && payload && "actual" in payload
    ? (payload.actual || payload.steps || "— audit untuk menelusuri akar masalah.")
    : (payload && "outcome" in payload ? (payload.outcome || payload.context || "— brainstorm untuk memperjelas objective.") : "");
  return { priority, objective };
}
