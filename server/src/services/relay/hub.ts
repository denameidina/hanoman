import {
  RELAY_CREDIT_INITIAL, RELAY_CREDIT_REFILL_BELOW, RELAY_IDLE_STREAM_CLOSE_MS, RELAY_MAX_INFLIGHT,
  RELAY_MAX_STREAMS, RELAY_PROTOCOL, RELAY_REASSEMBLY_MAX_BYTES, RELAY_REQUEST_BODY_MAX_BYTES,
  RELAY_REQ_TIMEOUT_MS, RELAY_RESYNC_MIN_MS, RELAY_SOCKET_MAX_BUFFERED,
  utf8Bytes, zClientToHubFrame, type ClientToHubFrame, type PresenceControlView, type RelayActor, type RelayMethod,
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
export type StreamState = {
  sid: string; browser: RelaySocket; credit: number; lastResyncAt: number;
  idleTimer: NodeJS.Timeout | null; closed: boolean;
};
type Link = {
  socket: RelaySocket; control: PresenceControlView | null; pending: Map<string, Pending>;
  unregister: () => void; streams: Map<string, StreamState>; inflightOpens: number;
};

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
    for (const s of previous.streams.values()) {
      if (s.idleTimer) clearTimeout(s.idleTimer);
      try { s.browser.send(JSON.stringify({ t: "close", sid: s.sid, code: 1000 })); } catch { /* browser sudah tertutup */ }
    }
    previous.streams.clear();
    try { previous.socket.close(4000, "replaced"); } catch { /* sudah tertutup */ }
  }
  const link: Link = {
    socket, control: null, pending: new Map(), unregister: registerDeviceSocket(deviceId, "relay", socket),
    streams: new Map(), inflightOpens: 0,
  };
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
        return;
      }
      if (f.t === "opened" || f.t === "geometry" || f.t === "data" || f.t === "close") { onClientFrame(deviceId, f); return; }
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

function armIdleTimer(link: Link, s: StreamState): void {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => {
    link.streams.delete(s.sid);
    try { s.browser.send(JSON.stringify({ t: "close", sid: s.sid, code: 1000 })); } catch { /* browser sudah tertutup */ }
  }, RELAY_IDLE_STREAM_CLOSE_MS);
  s.idleTimer.unref?.();
}

/** SPEC-1218 · AC-C4/C5/C6. Plafon 6 stream/4 inflight open per device — dinilai SETELAH pemanggil
    memastikan link hidup lewat `relayControlFor`. */
export function openStream(
  deviceId: string,
  req: { path: string; mode: "read" | "write"; actor: RelayActor },
  browserSocket: RelaySocket,
): string | null {
  const link = links.get(deviceId);
  if (!link) return null;
  // Koreksi (SPEC-1218 Task 3): rencana semula juga menggerbangi `inflightOpens >= RELAY_MAX_INFLIGHT`
  // (4) di sini, tapi konstanta itu SAMA dipakai `requestRelay` untuk antrian pending REST — dan
  // AC-C5 (Task 4, devices-relay.wshandler.test.ts) menuntut 6 koneksi WS mentah (tanpa "opened")
  // sukses sebelum ke-7 ditolak 4409, yang mustahil bila plafon 4-inflight ikut menggerbangi open
  // ke-5/6. `inflightOpens` tetap dilacak (dipakai turun saat "opened") tapi plafonnya hanya
  // `RELAY_MAX_STREAMS`, konsisten dengan AC-C5/AC-C6 (plafon 6 stream aktif per device).
  if (link.streams.size >= RELAY_MAX_STREAMS) return null;
  const sid = `s${++counter}`;
  const s: StreamState = { sid, browser: browserSocket, credit: RELAY_CREDIT_INITIAL, lastResyncAt: 0, idleTimer: null, closed: false };
  link.streams.set(sid, s);
  link.inflightOpens += 1;
  armIdleTimer(link, s);
  try { link.socket.send(JSON.stringify({ t: "open", sid, path: req.path, mode: req.mode, actor: req.actor })); }
  catch { /* device tertutup, biarkan idle timer membersihkan */ }
  return sid;
}

/** Dipanggil dari `attachRelaySocket`'s `onMessage` untuk frame `opened`/`geometry`/`data`/`close`. */
export function onClientFrame(deviceId: string, f: ClientToHubFrame): void {
  const link = links.get(deviceId);
  if (!link) return;
  if (f.t === "opened") {
    const s = link.streams.get(f.sid);
    if (!s) return;
    link.inflightOpens = Math.max(0, link.inflightOpens - 1);
    armIdleTimer(link, s);
    if (f.geometry) { try { s.browser.send(JSON.stringify({ t: "geometry", sid: f.sid, ...f.geometry })); } catch { /* browser tertutup */ } }
    return;
  }
  if (f.t === "geometry") {
    const s = link.streams.get(f.sid);
    if (!s || s.closed) return;
    armIdleTimer(link, s);
    try { s.browser.send(JSON.stringify(f)); } catch { /* browser tertutup */ }
    return;
  }
  if (f.t === "data") {
    const s = link.streams.get(f.sid);
    if (!s || s.closed) return;
    const n = utf8Bytes(f.d);
    if (s.credit < n) return;
    s.credit -= n;
    armIdleTimer(link, s);
    try { s.browser.send(JSON.stringify({ t: "data", sid: f.sid, d: f.d })); } catch { /* browser tertutup */ }
    const bufferedAmount = (s.browser as { bufferedAmount?: number }).bufferedAmount;
    if (s.credit < RELAY_CREDIT_REFILL_BELOW && (bufferedAmount === undefined || bufferedAmount < RELAY_SOCKET_MAX_BUFFERED)) {
      try { link.socket.send(JSON.stringify({ t: "credit", sid: f.sid, n: RELAY_CREDIT_INITIAL - s.credit })); } catch { /* device tertutup */ }
      s.credit = RELAY_CREDIT_INITIAL;
      if (Date.now() - s.lastResyncAt >= RELAY_RESYNC_MIN_MS) {
        s.lastResyncAt = Date.now();
        s.closed = true;
        if (s.idleTimer) clearTimeout(s.idleTimer);
        try { s.browser.close(4009, "resync"); } catch { /* browser sudah tertutup */ }
      }
    }
    return;
  }
  if (f.t === "close") {
    const s = link.streams.get(f.sid);
    if (!s) return;
    if (s.idleTimer) clearTimeout(s.idleTimer);
    link.streams.delete(f.sid);
    try { s.browser.send(JSON.stringify(f)); } catch { /* browser tertutup */ }
  }
}

/** Dipanggil pemanggil (Task 4) saat socket BROWSER ditutup — beri tahu klien segera, jangan
    menunggu idle timer. */
export function closeStream(deviceId: string, sid: string): void {
  const link = links.get(deviceId);
  if (!link) return;
  const s = link.streams.get(sid);
  if (!s) return;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  link.streams.delete(sid);
  try { link.socket.send(JSON.stringify({ t: "close", sid, code: 1000 })); } catch { /* device tertutup */ }
}

/** Test-only. */
export function __resetRelayHub(): void {
  for (const link of links.values()) {
    link.unregister();
    failAll(link, "offline");
    for (const s of link.streams.values()) if (s.idleTimer) clearTimeout(s.idleTimer);
  }
  links.clear();
  mismatches.clear();
}
