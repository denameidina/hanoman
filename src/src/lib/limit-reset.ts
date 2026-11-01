import type { LimitWindow, LimitsStatus } from "@hanoman/shared";

/**
 * ADR-0234 · angka `stale` (akun menganggur, token kedaluwarsa) menyesatkan bila window-nya sudah
 * reset sejak snapshot diambil. Window seperti itu ditampilkan "sudah reset", bukan persen lama.
 */
export function resetPassed(w: LimitWindow, status: LimitsStatus, now: number = Date.now()): boolean {
  return status !== "ok" && !!w.resetsAt && Date.parse(w.resetsAt) <= now;
}
