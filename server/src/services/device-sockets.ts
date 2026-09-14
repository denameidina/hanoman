/* SPEC-1215 · ADR-0165 §7 · registry MEMORI deviceId → socket sync & relay yang sedang terbuka.
   Tanpanya pencabutan device token hanya menyetel `revokedAt`, dan socket yang sudah terbuka baru mati
   lewat revalidasi 60 dtk (routes/sync.ts) — padahal socket relay adalah jalur RCE ke mesin klien. */

export type DeviceSocketKind = "sync" | "relay";
type Closable = { close(code?: number, reason?: string): void };
type Entry = { kind: DeviceSocketKind; socket: Closable };

const byDevice = new Map<string, Set<Entry>>();

export function registerDeviceSocket(deviceId: string, kind: DeviceSocketKind, socket: Closable): () => void {
  const entry: Entry = { kind, socket };
  let set = byDevice.get(deviceId);
  if (!set) { set = new Set(); byDevice.set(deviceId, set); }
  set.add(entry);
  return () => {
    const current = byDevice.get(deviceId);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) byDevice.delete(deviceId);
  };
}

export function closeDeviceSockets(deviceId: string, code = 1008, reason = "token revoked"): number {
  const set = byDevice.get(deviceId);
  if (!set) return 0;
  byDevice.delete(deviceId);
  for (const { socket } of set) {
    try { socket.close(code, reason); } catch { /* sudah tertutup */ }
  }
  return set.size;
}

export function deviceSocketCount(deviceId: string, kind?: DeviceSocketKind): number {
  let n = 0;
  for (const e of byDevice.get(deviceId) ?? []) if (!kind || e.kind === kind) n++;
  return n;
}

/** Test-only. */
export function __resetDeviceSockets(): void { byDevice.clear(); }
