import type { Client } from "./pty";
import { isOptionalEntity, setAcceptedHook } from "./sync";

// ADR-0180 · klien sync membawa entitas opsional yang dimintanya (query `entities=` saat upgrade WS).
export type SyncClient = Client & { accept?: Set<string> };

// SPEC-213 · ADR-0046 · siar changefeed sync ke instance client terhubung. Meniru pola siar
// services/events.ts: satu Set klien, frame lahir saat SyncLog di-append (accepted write).
const clients = new Set<SyncClient>();

export function attachSync(c: SyncClient): void { clients.add(c); }
export function detachSync(c: SyncClient): void { clients.delete(c); }

export function broadcastSyncLog(row: { entity: string; recordId: string; version: number; data: unknown; seq: string }): void {
  const s = JSON.stringify({ t: "sync", ...row });
  for (const c of clients) {
    // ADR-0180 · klien yang tak menyebut entitas opsional tak boleh menerimanya (client lama melempar).
    if (isOptionalEntity(row.entity) && !c.accept?.has(row.entity)) continue;
    try { c.send(s); } catch { clients.delete(c); }
  }
}

// Sambungkan hook accepted-write service sync ke siar. Idempoten (dipanggil sekali saat modul
// dimuat oleh route sync). Nol dependency di service sync itu sendiri.
setAcceptedHook((row) => broadcastSyncLog(row));

// Test-only: kosongkan klien.
export function __resetSyncHub(): void { clients.clear(); }
