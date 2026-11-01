import { useSyncExternalStore } from "react";
import type { AccountLimitsDTO } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";
import { api } from "./client";

// ADR-0234 · store limit per akun runtime — cermin api/antigravity-limits.ts (singleton ref-count di atas
// satu WS siar), berlangganan grup `accountLimits`.
let state: AccountLimitsDTO[] = [];
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => {
      if (m.t === "accountLimits") { state = m.accounts; for (const s of subs) s(); }
    });
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && unsub) { unsub(); unsub = undefined; }
  };
}

const EMPTY: AccountLimitsDTO[] = [];
const noSubscribe = () => () => {};

/**
 * `enabled=false` → tak berlangganan sama sekali (dan mengembalikan []). Dipakai chip akun sesi: sesi
 * tanpa akun non-bawaan — mayoritas — tak perlu menambah pelanggan ke kanal siar.
 */
export function useAccountLimits(enabled = true): AccountLimitsDTO[] {
  return useSyncExternalStore(enabled ? subscribe : noSubscribe,
    () => (enabled ? state : EMPTY), () => (enabled ? state : EMPTY));
}

/**
 * Muat sekali lewat HTTP untuk form (Start / Sesi baru). TAK PERNAH melempar: test yang me-mock `api`
 * sebagian tanpa `getAccountLimits` (kelas jebakan SPEC-884) cukup melihat field Akun tersembunyi.
 */
export async function loadAccountLimits(): Promise<AccountLimitsDTO[]> {
  try { return await Promise.resolve().then(() => api.getAccountLimits()); } catch { return []; }
}

// Untuk test: kembalikan store ke keadaan awal antar kasus.
export function _resetAccountLimitsStore(): void { state = []; }
