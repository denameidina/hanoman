import { paths, type EventMsg } from "@hanoman/shared";
import { api } from "./client";

// SPEC-199 · satu koneksi WS dibagi semua consumer (ref-count, pola api/limits.ts). Server
// mendorong frame per-grup; tiap consumer filter berdasarkan msg.t. Reconnect backoff +
// tutup saat tab hidden (server kirim snapshot penuh tiap connect → state re-sync sendiri).
const subs = new Set<(m: EventMsg) => void>();
let ws: WebSocket | undefined;
let backoff = 500;
let intentionalClose = false;
let opening = false;

// SPEC-897 · status koneksi diturunkan dari socket yang SAMA — tanpa channel, endpoint, atau poll
// baru (ADR-0039). `connected` menyala pada FRAME PERTAMA, bukan pada `onopen`: socket terbuka
// adalah fakta transport, bukan fakta pengiriman (pelajaran terukur SPEC-878/ADR-0134). `paused`
// terpisah karena tab hidden menutup socket dengan SENGAJA — menyebutnya gangguan berarti tiap
// kembali dari tab lain memudarkan pet.
export type EventsStatus = { connected: boolean; since: number; paused: boolean };

const statusSubs = new Set<(s: EventsStatus) => void>();
let status: EventsStatus = {
  connected: false, since: Date.now(),
  paused: typeof document !== "undefined" && document.hidden,
};

function setStatus(next: Partial<EventsStatus>): void {
  const merged = { ...status, ...next };
  if (merged.connected === status.connected && merged.since === status.since
    && merged.paused === status.paused) return;
  status = merged;
  for (const s of statusSubs) s(status);
}

export const eventsStatus = (): EventsStatus => status;

// Pengamat murni: TIDAK membuka socket. Yang membuka tetap `subscribe`, dan App sudah
// memanggilnya untuk `specs`/`sessions` (plus NotificationsContext).
export function subscribeStatus(handler: (s: EventsStatus) => void): () => void {
  statusSubs.add(handler);
  return () => { statusSubs.delete(handler); };
}

async function open(): Promise<void> {
  if (ws || opening || (typeof document !== "undefined" && document.hidden)) return;
  opening = true;
  intentionalClose = false;
  let ticket: string;
  try { ({ ticket } = await api.issueWsTicket("events")); }
  catch { opening = false; scheduleReconnect(); return; }
  if (intentionalClose || !subs.size) { opening = false; return; }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${scheme}//${location.host}${paths.eventsWs}`, [`hanoman-ticket.${ticket}`]);
  opening = false;
  ws.onopen = () => { backoff = 500; };
  ws.onmessage = (ev) => {
    let m: EventMsg;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    if (!status.connected) setStatus({ connected: true, since: Date.now() });
    for (const s of subs) s(m);
  };
  ws.onclose = () => {
    ws = undefined;
    if (status.connected) setStatus({ connected: false, since: Date.now() });
    scheduleReconnect();
  };
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

function scheduleReconnect(): void {
  if (intentionalClose || !subs.size) return;
  setTimeout(() => { if (subs.size) void open(); }, backoff);
  backoff = Math.min(backoff * 2, 10_000);
}

function close(): void { intentionalClose = true; try { ws?.close(); } catch { /* noop */ } ws = undefined; }

function onVisibility(): void {
  if (document.hidden) {
    // `paused` dulu, baru tutup: onclose yang menyusul harus sudah membawa paused = true.
    setStatus({ paused: true });
    close();
  } else {
    setStatus(status.connected ? { paused: false } : { paused: false, since: Date.now() });
    if (subs.size) void open();
  }
}

export function subscribe(handler: (m: EventMsg) => void): () => void {
  subs.add(handler);
  if (subs.size === 1) {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    void open();
  }
  return () => {
    subs.delete(handler);
    if (subs.size === 0) {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      close();
    }
  };
}
