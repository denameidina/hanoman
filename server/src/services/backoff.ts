/* SPEC-919 · ADR-0147 · reconnect dulu `setTimeout(…, 3000)` datar: terhadap hub yang mati ia
   mengetuk 20×/menit selamanya. Dipindah dari sync-client.ts (SPEC-1215, keputusan Plan P9) supaya
   tautan relay memakai rumus yang SAMA tanpa impor siklik relay/client ↔ sync-client. */
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const nextBackoff = (prev: number): number =>
  prev <= 0 ? RECONNECT_MIN_MS : Math.min(RECONNECT_MAX_MS, prev * 2);
export const withJitter = (ms: number, rnd: () => number = Math.random): number =>
  Math.round(ms * (0.8 + rnd() * 0.4));
