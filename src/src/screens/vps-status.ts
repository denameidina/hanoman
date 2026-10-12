import type { VpsView } from "@hanoman/shared";
import { relativeTime } from "../lib/time-format";

/* Audit UI/UX 2026-10 · Fase 3J · status VPS dan alur perbaikan, dalam bentuk murni yang bisa diuji.

   Daftar VPS menampilkan tiga langkah (Terhubung → Diaudit → Diperkuat), masing-masing dengan teks
   yang bisa dibaca tanpa warna. Alur perbaikan di checklist hanya boleh menerapkan dari pratinjau yang
   dibuat untuk pilihan yang SAMA dengan pilihan saat ini. */

export type VpsStepKey = "terhubung" | "diaudit" | "diperkuat";
export type VpsStepState = "done" | "todo" | "gagal";
export type VpsStep = { key: VpsStepKey; label: string; state: VpsStepState; text: string };

/** Batas "masih terhubung": healthcheck tiap 5 menit, jadi 2× interval (SPEC-164 §4). */
const REACH_WINDOW_MS = 10 * 60_000;

export const isReachableAt = (v: VpsView, now: number): boolean =>
  !!v.lastSeenAt && now - new Date(v.lastSeenAt).getTime() < REACH_WINDOW_MS;

/** Tiga langkah status VPS. VPS yang belum pernah terhubung itu keadaan netral (`todo`), bukan `gagal`. */
export function vpsSteps(v: VpsView, now: number = Date.now()): VpsStep[] {
  const reach: Pick<VpsStep, "state" | "text"> = !v.lastSeenAt
    ? { state: "todo", text: "belum terhubung" }
    : isReachableAt(v, now)
      ? { state: "done", text: "terhubung" }
      : { state: "gagal", text: "tidak terjangkau" };
  const audit: Pick<VpsStep, "state" | "text"> = v.lastAuditAt
    ? { state: "done", text: `diaudit ${relativeTime(v.lastAuditAt, now) || "—"}` }
    : { state: "todo", text: "belum diaudit" };
  const harden: Pick<VpsStep, "state" | "text"> = v.lastAuditAt && v.hardened
    ? { state: "done", text: "diperkuat" }
    : { state: "todo", text: "belum diperkuat" };
  return [
    { key: "terhubung", label: "Terhubung", ...reach },
    { key: "diaudit", label: "Diaudit", ...audit },
    { key: "diperkuat", label: "Diperkuat", ...harden },
  ];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const sa = new Set(a);
  return sa.size === new Set(b).size && b.every((x) => sa.has(x));
};

/** Terapkan hanya boleh bila pratinjau ada DAN dibuat untuk pilihan yang persis sama dengan pilihan sekarang. */
export function canApplyRemediation(selected: readonly string[], previewFor: readonly string[] | null): boolean {
  return selected.length > 0 && previewFor !== null && sameSet(selected, previewFor);
}

/** Label skor di daftar. `null`/tak ada = belum pernah diaudit (ADR-0211), tampil sebagai strip. */
export const scoreText = (score: number | null | undefined): string =>
  score == null ? "Skor —" : `Skor ${score}%`;
