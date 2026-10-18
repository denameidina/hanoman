import { useSyncExternalStore } from "react";
import type { AntigravityLimitsDTO } from "@hanoman/shared";
import { subscribe as subscribeEvents } from "./events";

// ADR-0224 · store limit Antigravity — cermin api/codex-limits.ts (singleton ref-count di atas satu
// koneksi WS siar), berlangganan grup `antigravityLimits` yang TERPISAH: sumbernya beda dari limit
// Claude maupun Codex, jadi satu frame tak boleh menimpa atau menyegarkan yang lain.
let state: AntigravityLimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };
let unsub: (() => void) | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    unsub = subscribeEvents((m) => {
      if (m.t === "antigravityLimits") { state = m.limits; for (const s of subs) s(); }
    });
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && unsub) { unsub(); unsub = undefined; }
  };
}

export function useAntigravityLimits(): AntigravityLimitsDTO {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// Untuk test: kembalikan store ke keadaan awal antar kasus.
export function _resetAntigravityLimitsStore(): void {
  state = { status: "unavailable", windows: [], fetchedAt: null };
}
