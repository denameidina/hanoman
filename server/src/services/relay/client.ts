import type { IncomingMessage } from "node:http";
import type { WebSocket as WsSocket } from "ws";
import { RELAY_PROTOCOL, RELAY_UNSUPPORTED_RETRY_MS, type RelayLinkState, type RelayLinkStatus, type RemoteControl } from "@hanoman/shared";
import { nextBackoff, withJitter } from "../backoff";
import { appendEvent } from "../logs/event-log";
import { getSetting } from "../settings";
import { runningVersion } from "../update";
import { createRelayDispatcher, type InjectableApp, type RelayDispatcher } from "./dispatcher";

/* SPEC-1215 · ADR-0165 §1/§7 · sisi KLIEN: socket relay KEDUA ke hub. Dibuka HANYA bila grant lokal
   menyala — tanpa grant tak ada jalur perintah sama sekali, bukan handler yang menolak. Semua di sini
   fire-and-forget di belakang backoff: hub mati tak pernah memblokir peluncuran, terminal, maupun
   sync lokal (K11). `generation` membatalkan callback socket lama sesudah stop/refresh/restart. */

let app: InjectableApp | null = null;
let target: { base: string; token: string } | null = null;
let sock: WsSocket | undefined;
let dispatcher: RelayDispatcher | undefined;
let timer: NodeJS.Timeout | undefined;
let delay = 0;
let lastDelayMs: number | null = null;
let generation = 0;
let lastLinkLogged: RelayLinkState | null = null;
const OFF: RelayLinkStatus = { state: "off", since: null, hubOrigin: null, lastClose: null };
let status: RelayLinkStatus = { ...OFF };

export function installRelayClient(a: InjectableApp): void { app = a; }
export function relayClientStatus(): RelayLinkStatus { return { ...status }; }

function setState(state: RelayLinkState, patch: Partial<Pick<RelayLinkStatus, "hubOrigin" | "lastClose">> = {}): void {
  const prev = status.state;
  status = { ...status, ...patch, state, since: prev === state ? status.since : new Date().toISOString() };
  // Dicatat hanya saat keadaan BERMAKNA berganti (pola ADR-0131 §3): `connecting`/`backoff` antar
  // ketukan adalah langkah antara, dan hub yang terus menolak tak boleh melahirkan satu baris per ketukan.
  const meaningful = state === "open" || state === "unsupported" || state === "rejected"
    || (state === "backoff" && prev === "open") || (state === "off" && lastLinkLogged !== null && lastLinkLogged !== "off");
  if (prev === state || !meaningful || state === lastLinkLogged) return;
  lastLinkLogged = state;
  void appendEvent({
    kind: "remote.link", level: state === "open" || state === "off" ? "info" : "warn",
    msg: `relay ${prev} → ${state}`,
    data: { state, hubOrigin: status.hubOrigin, code: status.lastClose?.code ?? null },
  });
}

function schedule(gen: number, ms: number): void {
  if (timer) clearTimeout(timer);
  lastDelayMs = ms;
  timer = setTimeout(() => { timer = undefined; void connect(gen); }, ms);
  timer.unref?.();
}
function scheduleBackoff(gen: number): void { delay = nextBackoff(delay); schedule(gen, withJitter(delay)); }

function dropSocket(code: number, reason: string): void {
  const s = sock;
  sock = undefined;
  dispatcher?.cancelAll();
  dispatcher = undefined;
  if (!s) return;
  try { if (s.readyState === 0) s.terminate(); else s.close(code, reason); } catch { /* sudah tertutup */ }
}

const originOf = (base: string): string | null => { try { return new URL(base).origin; } catch { return null; } };

async function connect(gen: number): Promise<void> {
  if (gen !== generation || !app || !target) return;
  let grant: RemoteControl;
  try { grant = (await getSetting()).remoteControl; } catch { grant = { enabled: false, capabilities: [] }; }
  if (gen !== generation || !app || !target) return;
  // AC-A1 · grant mati = socket TAK PERNAH dibuka: "default mati" terbaca dari topologi.
  if (!grant.enabled) { setState("off"); return; }
  const { WebSocket } = await import("ws");
  if (gen !== generation || !app || !target) return;
  const url = `${target.base.replace(/^http/, "ws").replace(/\/$/, "")}/api/sync/relay/ws`;
  setState("connecting");
  const s = new WebSocket(url, { headers: { authorization: `Bearer ${target.token}` } });
  const d = createRelayDispatcher({ app, send: (json) => { if (s.readyState === 1) s.send(json); } });
  sock = s;
  dispatcher = d;
  let settled = false;

  s.on("unexpected-response", (_req, res: IncomingMessage) => {
    settled = true;
    const code = res.statusCode ?? 0;
    res.resume();
    try { s.terminate(); } catch { /* noop */ }
    if (gen !== generation) return;
    if (sock === s) { sock = undefined; dispatcher = undefined; }
    if (code === 404) {
      // AC-A12 · hub versi lama. Mengetuk tiap detik selamanya hanya membebani kedua sisi.
      setState("unsupported", { lastClose: { code, reason: "hub tak mendukung relay" } });
      schedule(gen, RELAY_UNSUPPORTED_RETRY_MS);
      return;
    }
    setState("rejected", { lastClose: { code, reason: "upgrade relay ditolak hub" } });
    scheduleBackoff(gen);
  });
  s.on("open", () => {
    if (gen !== generation) return;
    delay = 0;
    setState("open", { lastClose: null });
    s.send(JSON.stringify({ t: "hello", v: 1, protocol: RELAY_PROTOCOL, version: runningVersion(), capabilities: grant.capabilities }));
  });
  s.on("message", (raw: Buffer) => { if (gen === generation) d.onMessage(raw.toString("utf8")); });
  s.on("close", (code: number, reason: Buffer) => {
    d.cancelAll();
    if (settled || gen !== generation) return;
    if (sock === s) { sock = undefined; dispatcher = undefined; }
    const lastClose = { code, reason: reason.toString("utf8") };
    if (code === 4001) {
      // Protokol beda: menyambung ulang tiap detik tak akan pernah cocok sampai salah satu sisi upgrade.
      setState("rejected", { lastClose });
      schedule(gen, RELAY_UNSUPPORTED_RETRY_MS);
      return;
    }
    setState("backoff", { lastClose });
    scheduleBackoff(gen);
  });
  s.on("error", () => { /* 'close' atau 'unexpected-response' menyusul */ });
}

/** Sinkron dan tak pernah memblokir pemanggil (AC-M2). */
export function startRelayClient(base: string, token: string): void {
  const gen = ++generation;
  if (timer) { clearTimeout(timer); timer = undefined; }
  dropSocket(1001, "restart");
  target = { base, token };
  delay = 0;
  status = { ...status, hubOrigin: originOf(base) };
  void connect(gen);
}

export function stopRelayClient(): void {
  generation++;
  if (timer) { clearTimeout(timer); timer = undefined; }
  target = null;
  dropSocket(1001, "shutdown");
  setState("off", { hubOrigin: null, lastClose: null });
}

/** AC-A5 · grant berubah: socket relay (dan setiap permintaan yang sedang dijalankan dispatcher)
    ditutup SEBELUM promise ini resolve — `PUT /remote-control` membalas sesudahnya. Dibuka ulang
    dengan `hello` baru bila grant masih menyala. */
export async function refreshRelayClient(): Promise<void> {
  const gen = ++generation;
  if (timer) { clearTimeout(timer); timer = undefined; }
  dropSocket(4003, "grant changed");
  delay = 0;
  setState("off", { lastClose: null });
  if (target) void connect(gen);
}

/** Test-only. */
export function __relayClientLastDelayMs(): number | null { return lastDelayMs; }
/** Test-only. */
export function __resetRelayClient(): void {
  stopRelayClient();
  app = null;
  lastDelayMs = null;
  lastLinkLogged = null;
  status = { ...OFF };
}
