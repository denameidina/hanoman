import type { Spec } from "@prisma/client";
import { prisma } from "../db";
import { notifySynced } from "./sync-notify";

export type ReviewedResult =
  | { ok: true; spec: Spec }
  | { ok: false; reason: "not-found" | "not-done" };

// ADR-0218 · SATU titik tulis penanda "sudah ditinjau". Route `POST /specs/:id/reviewed` memanggilnya;
// tak ada call site kedua. Penanda hanya bermakna untuk item `done`, jadi menandai item yang belum
// selesai ditolak (409 di route). Membatalkan selalu boleh.
//
// Idempoten: menandai ulang TIDAK menggeser stempelnya (tinjauan pertama yang dicatat), dan
// membatalkan yang sudah kosong tak menulis apa-apa. Penulisan dijaga CAS `stage: done`, jadi bila
// stage ditarik mundur antara baca dan tulis, penanda tak pernah mendarat di item yang belum selesai
// (tanda seperti itu tak akan di-reset oleh recordCompletion, lihat schema `reviewedAt`).
export async function markSpecReviewed(id: string, reviewed: boolean): Promise<ReviewedResult> {
  const spec = await prisma.spec.findUnique({ where: { id } });
  if (!spec) return { ok: false, reason: "not-found" };
  if (reviewed && spec.stage !== "done") return { ok: false, reason: "not-done" };

  const { count } = reviewed
    ? await prisma.spec.updateMany({ where: { id, stage: "done", reviewedAt: null }, data: { reviewedAt: new Date() } })
    : await prisma.spec.updateMany({ where: { id, reviewedAt: { not: null } }, data: { reviewedAt: null } });
  if (count > 0) await notifySynced("spec", id);   // SPEC-213/330 · antre push, hub publish ke feed

  // Baca ulang, bukan pakai `spec` di atas: penulisan dan balasan harus melihat keadaan yang sama.
  const fresh = await prisma.spec.findUnique({ where: { id } });
  if (!fresh) return { ok: false, reason: "not-found" };
  if (reviewed && fresh.stage !== "done") return { ok: false, reason: "not-done" };
  return { ok: true, spec: fresh };
}
