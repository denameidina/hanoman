import {
  RELAY_MAX_INFLIGHT, RELAY_PROTOCOL, RELAY_REASSEMBLY_MAX_BYTES, RELAY_REQUEST_BODY_MAX_BYTES, RELAY_REQ_TIMEOUT_MS,
  utf8Bytes, zClientToHubFrame, type PresenceControlView, type RelayActor, type RelayMethod,
} from "@hanoman/shared";
import { registerDeviceSocket } from "../device-sockets";
import { runningVersion } from "../update";

/* SPEC-1215 · ADR-0165 · sisi HUB: satu socket relay per device, keadaan di MEMORI (prinsip ADR-0148).
   Restart hub = peta kosong; klien menyambung ulang lewat backoff-nya. Route HTTP yang memakai
   `requestRelay` lahir di SPEC-1216 — di turunan A ia diekspor dan dibuktikan lewat test. */

export type RelaySocket = { send(data: string): void; close(code?: number, reason?: string): void; readyState: number };
export type RelayResponse = { status: number; contentType: string | null; body: string };
type RelayErrorKind = "offline" | "protocol-mismatch" | "busy" | "timeout" | "too-large" | "protocol";
export class RelayError extends Error {
  constructor(readonly kind: RelayErrorKind, message: string = kind) { super(message); }
}

type Pending = {
  resolve: (r: RelayResponse) => void; reject: (e: RelayError) => void; timer: NodeJS.Timeout;
  status?: number; contentType: string | null; chunks: string[]; bytes: number;
};
type Link = { socket: RelaySocket; control: PresenceControlView | null; pending: Map<string, Pending>; unregister: () => void };

const links = new Map<string, Link>();
// Bertahan sesudah socket 4001 ditutup: operator hub harus MELIHAT "versi tak cocok", bukan "offline".
const mismatches = new Map<string, PresenceControlView>();
let counter = 0;

function settle(link: Link, id: string, outcome: RelayResponse | RelayError): void {
  const p = link.pending.get(id);
  if (!p) return;
  link.pending.delete(id);
  clearTimeout(p.timer);
  if (outcome instanceof RelayError) p.reject(outcome); else p.resolve(outcome);
}
function failAll(link: Link, kind: RelayErrorKind): void {
  for (const id of [...link.pending.keys()]) settle(link, id, new RelayError(kind));
}
function sendCancel(link: Link, id: string): void {
  try { link.socket.send(JSON.stringify({ t: "cancel", id })); } catch { /* socket tertutup */ }
}

export function attachRelaySocket(deviceId: string, socket: RelaySocket): { onMessage(raw: string): void; onClose(): void } {
  const previous = links.get(deviceId);
  if (previous) {
    links.delete(deviceId);
    previous.unregister();
    failAll(previous, "offline");
    try { previous.socket.close(4000, "replaced"); } catch { /* sudah tertutup */ }
  }
  const link: Link = { socket, control: null, pending: new Map(), unregister: registerDeviceSocket(deviceId, "relay", socket) };
  links.set(deviceId, link);

  return {
    onMessage(raw: string): void {
      let parsed: ReturnType<typeof zClientToHubFrame.safeParse>;
      try { parsed = zClientToHubFrame.safeParse(JSON.parse(raw)); } catch { return; }
      if (!parsed.success) return;
      const f = parsed.data;
      if (f.t === "hello") {
        const control: PresenceControlView = {
          state: "available", protocol: f.protocol, version: f.version, capabilities: f.capabilities, since: new Date().toISOString(),
        };
        if (f.protocol !== RELAY_PROTOCOL) {
          mismatches.set(deviceId, { ...control, state: "protocol-mismatch" });
          socket.close(4001, "protocol mismatch");
          return;
        }
        mismatches.delete(deviceId);
        link.control = control;
        try { socket.send(JSON.stringify({ t: "welcome", v: 1, protocol: RELAY_PROTOCOL, version: runningVersion() })); } catch { /* noop */ }
        return;
      }
      if (f.t === "res") {
        const p = link.pending.get(f.id);
        if (!p) return;
        if (p.status === undefined) {
          if (f.status === undefined) { settle(link, f.id, new RelayError("protocol", "part pertama tanpa status")); return; }
          p.status = f.status;
          p.contentType = f.contentType ?? null;
        }
        p.bytes += utf8Bytes(f.part);
        if (p.bytes > RELAY_REASSEMBLY_MAX_BYTES) { sendCancel(link, f.id); settle(link, f.id, new RelayError("too-large")); return; }
        p.chunks.push(f.part);
        if (f.end) settle(link, f.id, { status: p.status, contentType: p.contentType, body: p.chunks.join("") });
      }
      // opened/geometry/data/close = stream, milik SPEC-1218.
    },
    onClose(): void {
      // Close event socket LAMA bisa tiba sesudah penggantinya terpasang — jangan hapus yang baru.
      if (links.get(deviceId) === link) links.delete(deviceId);
      link.unregister();
      failAll(link, "offline");
    },
  };
}

export function requestRelay(
  deviceId: string,
  r: { method: RelayMethod; path: string; query?: string; body?: unknown; actor: RelayActor },
  opts: { timeoutMs?: number } = {},
): Promise<RelayResponse> {
  const link = links.get(deviceId);
  if (!link || link.socket.readyState !== 1 || !link.control)
    return Promise.reject(new RelayError(mismatches.has(deviceId) ? "protocol-mismatch" : "offline"));
  if (link.pending.size >= RELAY_MAX_INFLIGHT) return Promise.reject(new RelayError("busy"));
  if (r.body !== undefined && utf8Bytes(JSON.stringify(r.body)) > RELAY_REQUEST_BODY_MAX_BYTES)
    return Promise.reject(new RelayError("too-large"));
  const id = `r${++counter}`;
  return new Promise<RelayResponse>((resolve, reject) => {
    const timer = setTimeout(() => { sendCancel(link, id); settle(link, id, new RelayError("timeout")); }, opts.timeoutMs ?? RELAY_REQ_TIMEOUT_MS);
    timer.unref?.();
    link.pending.set(id, { resolve, reject, timer, contentType: null, chunks: [], bytes: 0 });
    try {
      link.socket.send(JSON.stringify({
        t: "req", id, method: r.method, path: r.path,
        ...(r.query ? { query: r.query } : {}), ...(r.body !== undefined ? { body: r.body } : {}), actor: r.actor,
      }));
    } catch { settle(link, id, new RelayError("offline")); }
  });
}

export function relayControlFor(deviceId: string): PresenceControlView | null {
  return links.get(deviceId)?.control ?? mismatches.get(deviceId) ?? null;
}

/** Test-only. */
export function __resetRelayHub(): void {
  for (const link of links.values()) { link.unregister(); failAll(link, "offline"); }
  links.clear();
  mismatches.clear();
}
