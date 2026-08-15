import type { Prisma, Spec } from "@prisma/client";
import { prisma } from "../db";
import { recordCompletion } from "./notifications";
import { recordSessionResult } from "./session-result";
import { notifySynced } from "./sync-notify";

export type ManualDoneInput = { by: string; reason?: string; at?: Date };
export type CompleteResult = { ok: false } | { ok: true; spec: Spec };

// SPEC-804 · ADR-0120 · SATU titik cekik penyelesaian manual. Route memanggilnya; tak ada call
// site kedua. Efek samping penyelesaian sudah tiga kali dibayar repo ini saat disalin ke banyak
// call site (SPEC-431 `baseSha`, SPEC-448 `rootBypassEnv`, SPEC-475 `headSha`).
export async function completeSpecManually(spec: Spec, input: ManualDoneInput): Promise<CompleteResult> {
  const at = input.at ?? new Date();
  const manualDone = {
    at: at.toISOString(), by: input.by, ...(input.reason ? { reason: input.reason } : {}),
  };
  // CAS `stage != done`: sesi atau overlay stage-live bisa mencapai `done` di bawah kita, dan dua
  // penulisan atas satu transisi berarti dua jejak untuk satu peristiwa. Yang kalah menyerah.
  // Tap Prisma ADR-0100 memancarkan `spec.stage_changed` dari `updateMany` ini.
  const { count } = await prisma.spec.updateMany({
    where: { id: spec.id, stage: { not: "done" } },
    data: { stage: "done", manualDone: manualDone as Prisma.InputJsonValue },
  });
  if (count === 0) return { ok: false };
  // `doneAt` + notifikasi `done:` lewat fungsi yang SUDAH dipanggil ketiga jalur persist `done`
  // (advanceStage · scheduler/reconcile · liveSpecs) — bukan disalin ke sini.
  await recordCompletion(spec.id, spec.title, spec.projectId);
  // ADR-0047 · activity log. `commitSha`/`branch` sengaja tak diisi: memang tak ada.
  await recordSessionResult({
    projectId: spec.projectId, specId: spec.id, oldStage: spec.stage, newStage: "done",
    status: "done", author: input.by,
  }).catch(() => { /* activity log opsional, pola advanceStage */ });
  await notifySynced("spec", spec.id); // SPEC-213/330 · client antre push, hub publish ke feed
  return { ok: true, spec: (await prisma.spec.findUnique({ where: { id: spec.id } }))! };
}
