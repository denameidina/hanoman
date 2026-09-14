import { z } from "zod";
import type { Capability } from "./agent";
import type { LogEntryView } from "./logs";

/* SPEC-1215 · ADR-0165 · kontrak kanal relay hub → klien.

   Relay TIDAK punya katalog operasi: hub menunnel request ke route REST/WS yang SUDAH ada, dan
   klien menjalankannya ulang in-process. Karena itu yang dikunci di sini hanya amplop frame,
   anggaran byte, dan dua pagar murni — allowlist route dan kosakata grant. Semua fungsi di sini
   murni supaya bisa diuji tabel positif DAN negatif tanpa server. */

export const RELAY_PROTOCOL = 1;
/** ½ `maxPayload` 64 KiB (pola `PRESENCE_MAX_FRAME_BYTES`): frame di atasnya ditutup `ws` dengan 1009. */
export const RELAY_PART_MAX_BYTES = 32 * 1024;
export const RELAY_MAX_STREAMS = 6;
/** Cermin `MAX_INFLIGHT` ADR-0145. */
export const RELAY_MAX_INFLIGHT = 4;
/** Cermin `PULL_MAX_BYTES` ADR-0138. */
export const RELAY_RESPONSE_MAX_BYTES = 1024 * 1024;
export const RELAY_REASSEMBLY_MAX_BYTES = 1024 * 1024;
export const RELAY_REQUEST_BODY_MAX_BYTES = 32 * 1024;
export const RELAY_CREDIT_INITIAL = 256 * 1024;
export const RELAY_CREDIT_REFILL_BELOW = 64 * 1024;
export const RELAY_SOCKET_MAX_BUFFERED = 1024 * 1024;
export const RELAY_RESYNC_MIN_MS = 5_000;
export const RELAY_REQ_TIMEOUT_MS = 30_000;
/** Pembuatan worktree bisa melewati 30 dtk. */
export const RELAY_SPAWN_TIMEOUT_MS = 120_000;
export const RELAY_OPEN_TIMEOUT_MS = 10_000;
export const RELAY_MAX_FRAMES_PER_MIN = 12_000;
export const RELAY_IDLE_STREAM_CLOSE_MS = 2_000;
/** Hub lama (upgrade relay 404) diketuk lagi paling cepat 30 menit kemudian. */
export const RELAY_UNSUPPORTED_RETRY_MS = 30 * 60_000;

export const RELAY_HEADER = "x-hanoman-relay";
export const RELAY_ACTOR_HEADER = "x-hanoman-relay-actor";
export const RELAY_MODE_HEADER = "x-hanoman-relay-mode";

/** Subset katalog capability yang BOLEH diberikan ke hub. `danger` selain `sessions:spawn` tak pernah masuk. */
export const REMOTE_CAPABILITIES = [
  "sessions:read", "sessions:write", "sessions:spawn", "backlog:read", "backlog:write", "ide:read",
] as const satisfies readonly Capability[];
export const zRemoteCapability = z.enum(REMOTE_CAPABILITIES);
export type RemoteCapability = z.infer<typeof zRemoteCapability>;

/** Grant LOCAL-only di `Setting.data.remoteControl`. `setting` tak ada di `SYNCED`, jadi hub tak bisa menyalakannya. */
export const zRemoteControl = z.object({
  enabled: z.boolean().default(false),
  capabilities: z.array(zRemoteCapability).default([]),
});
export type RemoteControl = z.infer<typeof zRemoteControl>;
export const REMOTE_CONTROL_DEFAULTS: RemoteControl = { enabled: false, capabilities: [] };

/** `null` = sah. Setiap grant yang tak kosong wajib memuat `sessions:read`: tulis/mulai/selesai tanpa
    bisa melihat sesinya membuat operator hub bertindak buta di mesin orang lain. */
export function validateRemoteGrant(caps: readonly string[]): string | null {
  const known = new Set<string>(REMOTE_CAPABILITIES);
  const unknown = caps.filter((c) => !known.has(c));
  if (unknown.length) return `capability di luar REMOTE_CAPABILITIES: ${unknown.join(", ")}`;
  if (caps.length > 0 && !caps.includes("sessions:read"))
    return "grant tanpa sessions:read ditolak — Tulis/Mulai/Selesai butuh Lihat";
  return null;
}

const cpBytes = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Panjang UTF-8 tanpa `Buffer`: modul ini juga diimpor dashboard (browser). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    n += cpBytes(cp);
    if (cp > 0xffff) i++;
  }
  return n;
}

/** Potong teks jadi bagian ≤ `maxBytes` byte UTF-8 tanpa pernah membelah satu code point. */
export function splitUtf8(text: string, maxBytes = RELAY_PART_MAX_BYTES): string[] {
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    const b = cpBytes(cp);
    if (bytes + b > maxBytes && i > start) { parts.push(text.slice(start, i)); start = i; bytes = 0; }
    bytes += b;
    i += width;
  }
  parts.push(text.slice(start));
  return parts;
}

/** Aktor adalah KLAIM hub: klien mencatatnya apa adanya, ia tak bisa memverifikasi manusia di hub. */
export const zRelayActor = z.object({
  hubOrigin: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  email: z.string().min(1).max(320),
}).strict();
export type RelayActor = z.infer<typeof zRelayActor>;

const zId = z.string().min(1).max(64);
const UNSAFE_PATH = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\|[?#]/i;
const zRelayPath = z.string().max(2048).regex(/^\/api\//).refine((p) => !UNSAFE_PATH.test(p), "path relay tak sah");
const zPart = z.string().refine((s) => utf8Bytes(s) <= RELAY_PART_MAX_BYTES, "part relay > 32 KiB");
export const RELAY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type RelayMethod = (typeof RELAY_METHODS)[number];

// ── hub → klien ────────────────────────────────────────────────────────────────────────────
const zWelcome = z.object({ t: z.literal("welcome"), v: z.literal(1), protocol: z.number().int(), version: z.string().max(40) }).strict();
const zReq = z.object({
  t: z.literal("req"), id: zId, method: z.enum(RELAY_METHODS), path: zRelayPath,
  query: z.string().max(2048).optional(), body: z.unknown().optional(), actor: zRelayActor,
}).strict();
const zCancel = z.object({ t: z.literal("cancel"), id: zId }).strict();
const zOpen = z.object({ t: z.literal("open"), sid: zId, path: zRelayPath, mode: z.enum(["read", "write"]), actor: zRelayActor }).strict();
const zHubData = z.object({ t: z.literal("data"), sid: zId, d: zPart }).strict();
const zCredit = z.object({ t: z.literal("credit"), sid: zId, n: z.number().int().min(1).max(4 * 1024 * 1024) }).strict();
const zClose = z.object({ t: z.literal("close"), sid: zId, code: z.number().int().min(1000).max(4999), reason: z.string().max(120).optional() }).strict();
export const zHubToClientFrame = z.discriminatedUnion("t", [zWelcome, zReq, zCancel, zOpen, zHubData, zCredit, zClose]);
export type HubToClientFrame = z.infer<typeof zHubToClientFrame>;
export type RelayReqFrame = z.infer<typeof zReq>;

// ── klien → hub ────────────────────────────────────────────────────────────────────────────
const zHello = z.object({
  t: z.literal("hello"), v: z.literal(1),
  // Sengaja number, bukan literal: hub harus bisa MELIHAT protokol yang beda untuk menutup 4001
  // dan menampilkan "protocol-mismatch", bukan membuang frame-nya senyap.
  protocol: z.number().int(), version: z.string().max(40),
  capabilities: z.array(zRemoteCapability).max(REMOTE_CAPABILITIES.length),
}).strict();
const zRes = z.object({
  t: z.literal("res"), id: zId, status: z.number().int().min(100).max(599).optional(),
  contentType: z.string().max(200).optional(), part: zPart, end: z.boolean(),
}).strict();
const zGeometryFields = { cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) };
const zOpened = z.object({ t: z.literal("opened"), sid: zId, geometry: z.object(zGeometryFields).strict().optional() }).strict();
const zGeometry = z.object({ t: z.literal("geometry"), sid: zId, ...zGeometryFields }).strict();
const zClientData = z.object({ t: z.literal("data"), sid: zId, d: zPart, more: z.literal(true).optional() }).strict();
export const zClientToHubFrame = z.discriminatedUnion("t", [zHello, zRes, zOpened, zGeometry, zClientData, zClose]);
export type ClientToHubFrame = z.infer<typeof zClientToHubFrame>;

// ── allowlist route (lapis kedua di atas capability) ──────────────────────────────────────
// `backlog:write` juga membuka `PATCH /specs`, lampiran, dll. Capability sendirian terlalu lebar
// untuk mesin orang lain, jadi permukaan relay dibatasi DI SINI, deny-by-default.
const RELAY_ROUTES: readonly (readonly [string, RegExp])[] = [
  ["GET", /^\/terminal\/sessions$/],
  ["POST", /^\/terminal\/sessions$/],
  ["GET", /^\/terminal\/sessions\/[^/]+\/(?:phases|dialog|ws)$/],
  ["POST", /^\/terminal\/sessions\/[^/]+\/(?:steer|interrupt|dialog\/answer|dialog\/takeover)$/],
  ["GET", /^\/terminal\/sessions\/[^/]+\/review(?:\/.+)?$/],
  ["GET", /^\/specs\/[^/]+\/(?:docs|review)(?:\/.+)?$/],
  ["GET", /^\/projects\/[^/]+\/(?:tree|file|working-status|file-diff|status|graph|graph\/search|compare|compare\/file)$/],
  ["GET", /^\/projects\/[^/]+\/commit\/[^/]+(?:\/file)?$/],
  ["POST", /^\/specs\/[^/]+\/done$/],
  ["GET", /^\/events\/ws$/],
];
const REVIEW_SEGMENT = /\/review(?:\/|$)/;
const UNSAFE_SEGMENT = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i;

export function relayRouteAllowed(method: string, url: string): boolean {
  const q = url.indexOf("?");
  const path = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? "" : url.slice(q + 1);
  if (!path.startsWith("/api/") || UNSAFE_SEGMENT.test(path)) return false;
  const rel = path.slice("/api".length);
  const m = method.toUpperCase();
  if (!RELAY_ROUTES.some(([rm, re]) => rm === m && re.test(rel))) return false;
  // Unduhan review = byte mentah ber-content-disposition; di luar permukaan relay (ADR-0165 §5).
  if (REVIEW_SEGMENT.test(rel) && new URLSearchParams(query).has("download")) return false;
  return true;
}

/** Hanya `POST /terminal/sessions` yang dinilai body-nya: varian shell/project/reverse/prd = sesi
    tanpa backlog, di luar grant "Mulai sesi". Dipanggil di `preHandler` (body sudah di-parse). */
export function relayBodyAllowed(method: string, path: string, body: unknown): boolean {
  const p = path.split("?")[0];
  if (method.toUpperCase() !== "POST" || p !== "/api/terminal/sessions") return true;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const spec = (body as { spec?: unknown }).spec;
  return typeof spec === "string" && spec.length > 0;
}

/** Satu pengecualian atas `capabilityForRoute`: WS terminal baca-saja menuntut `sessions:read`,
    bukan `sessions:write` — dispatcher (SPEC-1218) membuang `in`/`diag` sebelum route. */
export function remoteCapabilityFor(method: string, path: string, mode: "read" | "write"): Capability | null {
  const p = path.split("?")[0] ?? "";
  return method.toUpperCase() === "GET" && mode === "read" && /^\/api\/terminal\/sessions\/[^/]+\/ws$/.test(p)
    ? "sessions:read" : null;
}

// ── /api/remote-control ───────────────────────────────────────────────────────────────────
export const zRemoteControlPut = z.object({
  control: z.object({ enabled: z.boolean(), capabilities: z.array(z.string().max(40)).max(20) }).strict().optional(),
  logs: z.object({ event: z.boolean(), server: z.boolean(), transcript: z.boolean() }).strict().optional(),
}).strict();
export type RemoteControlPut = z.infer<typeof zRemoteControlPut>;

export type RelayLinkState = "off" | "connecting" | "open" | "backoff" | "unsupported" | "rejected";
export type RelayLinkStatus = {
  state: RelayLinkState; since: string | null; hubOrigin: string | null;
  lastClose: { code: number; reason: string } | null;
};
/** `shipping` ditambahkan SPEC-1217 bersama shipper-nya (keputusan Plan P6). */
export type RemoteControlView = {
  control: RemoteControl;
  logs: { event: boolean; server: boolean; transcript: boolean };
  relay: RelayLinkStatus;
  audit: LogEntryView[];
};
