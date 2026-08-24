import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { setBounded } from "./bounded-rate-limit";
import { COOKIE_NAME, lookupSession } from "./auth";
import { verifyDeviceToken } from "./device-token";

export const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 2_048;
const MAX_CONNECTIONS_PER_PRINCIPAL = 8;
const PROTOCOL_PREFIX = "hanoman-ticket.";

export type WsTarget = "events" | "sync" | `terminal:${string}`;
export type WsPrincipal = { kind: "user" | "agent" | "device" | "test"; id: string };
type Ticket = { principal: WsPrincipal; target: WsTarget; expiresAt: number };

declare module "fastify" { interface FastifyRequest { wsPrincipal?: WsPrincipal } }

const tickets = new Map<string, Ticket>();
const connections = new Map<string, number>();

function pruneTickets(now: number): void {
  for (const [token, ticket] of tickets) if (ticket.expiresAt <= now) tickets.delete(token);
}

export function issueWsTicket(principal: WsPrincipal, target: WsTarget, now = Date.now()): string {
  pruneTickets(now);
  const token = randomBytes(24).toString("base64url");
  setBounded(tickets, token, { principal, target, expiresAt: now + TICKET_TTL_MS }, MAX_TICKETS);
  return token;
}

export function consumeWsTicket(token: string, target: WsTarget, now = Date.now()): WsPrincipal {
  pruneTickets(now);
  const ticket = tickets.get(token);
  tickets.delete(token);
  if (!ticket || ticket.target !== target || ticket.expiresAt <= now) throw new Error("invalid WebSocket ticket");
  return ticket.principal;
}

export function wsTicketProtocol(token: string): string { return `${PROTOCOL_PREFIX}${token}`; }

export function ticketFromProtocol(value: string | string[] | undefined): string | null {
  const joined = Array.isArray(value) ? value.join(",") : value;
  const protocol = joined?.split(",").map((v) => v.trim()).find((v) => v.startsWith(PROTOCOL_PREFIX));
  return protocol?.slice(PROTOCOL_PREFIX.length) || null;
}

export function wsControlOrigins(env: Record<string, string | undefined>): Set<string> {
  const values = new Set<string>();
  for (const raw of env.HANOMAN_CONTROL_ORIGINS?.split(",") ?? []) {
    const value = raw.trim();
    if (value) values.add(new URL(value).origin);
  }
  return values;
}

export function assertWsOrigin(origin: string | undefined, allowed: Set<string>): void {
  if (!origin || !allowed.has(origin)) throw new Error("WebSocket Origin rejected");
}

// SPEC-761 menutup gerbang Origin secara fail-closed dan mengisi daftarnya HANYA dari
// `HANOMAN_CONTROL_ORIGINS`. Instalasi polos (`npm i -g hanoman` → `hanoman`) tak pernah menyetel
// env itu, sehingga SETIAP WebSocket browser ditolak 401: kanal `events` dan `terminal:<id>`
// sama-sama mati, dan terminal — fitur inti produk — kosong sejak paket dipasang, padahal tmux
// serta REST-nya sehat. Gejalanya menipu karena tak ada yang gagal selain upgrade WS-nya.
//
// Di luar production gerbangnya karena itu turun ke SAME-ORIGIN, bukan terbuka: Origin tetap
// dicocokkan exact oleh `assertWsOrigin`, hanya acuannya Host request itu sendiri alih-alih daftar
// env. Halaman lintas-situs tetap ditolak, jadi pertahanan CSWSH tidak berkurang — lapis utamanya
// pun tetap tiket one-use yang hanya bisa diambil lewat `POST /api/ws-tickets` bercookie.
//
// Production TIDAK ikut turun (ADR-0117): `assertRuntimeBoundary` sudah menolak boot tanpa origin
// split, dan invariant-nya menuntut kebijakan host ditegakkan aplikasi, bukan disimpulkan dari
// request yang datang.
export function wsAllowlistFor(
  configured: Set<string>,
  host: string | undefined,
  env: Record<string, string | undefined>,
): Set<string> {
  if (configured.size > 0 || env.NODE_ENV === "production") return configured;
  const value = host?.trim().toLowerCase();
  if (!value) return configured;
  // Divalidasi lewat URL, bukan regex: sekali jalan ia menolak path, credential, dan spasi
  // sementara IPv6 (`[::1]:8787`) tetap utuh — regex host gampang salah di keduanya.
  let parsed: URL;
  try { parsed = new URL(`http://${value}`); } catch { return configured; }
  if (!parsed.host || parsed.username || parsed.password || parsed.pathname !== "/"
    || parsed.search || parsed.hash) return configured;
  const hosts = new Set([parsed.host]);
  // Browser MENGHILANGKAN port default dari Origin (`https://x`, bukan `https://x:443`) sementara
  // sebagian proxy tetap menuliskannya di Host. Tanpa bentuk telanjangnya, deployment di belakang
  // proxy semacam itu gagal cocok padahal host-nya sama.
  if (parsed.port === "80" || parsed.port === "443") hosts.add(parsed.hostname);
  const allowed = new Set<string>();
  // Kedua scheme untuk host yang sama: di belakang proxy TLS browser mengirim Origin `https://`
  // sementara server hanya pernah melihat Host tanpa scheme, jadi scheme tak bisa dibandingkan.
  for (const candidate of hosts) { allowed.add(`http://${candidate}`); allowed.add(`https://${candidate}`); }
  return allowed;
}

export function admitBrowserWs(
  req: FastifyRequest,
  target: Exclude<WsTarget, "sync">,
  allowedOrigins: Set<string>,
): WsPrincipal {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (!origin && process.env.NODE_ENV === "test" && allowedOrigins.size === 0)
    return { kind: "test", id: "test" };
  // `process.env` seperti baris di atas: modul ini tak menerima env aplikasi, dan yang dibutuhkan
  // hanya penanda production yang sama dipakai `assertRuntimeBoundary`.
  const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
  assertWsOrigin(origin, wsAllowlistFor(allowedOrigins, host, process.env));
  const token = ticketFromProtocol(req.headers["sec-websocket-protocol"]);
  if (!token) throw new Error("WebSocket ticket required");
  const principal = consumeWsTicket(token, target);
  if (principal.kind === "user" && req.user?.id !== principal.id) throw new Error("WebSocket principal mismatch");
  if (principal.kind === "agent" && req.agent?.id !== principal.id) throw new Error("WebSocket principal mismatch");
  return principal;
}

// SPEC-908 · siapa yang boleh MENGIRIM frame `sub` di /events/ws. Bukan kehati-hatian umum:
// `/events/ws` dipetakan ke capability GLOBAL_READ untuk agent token (`capabilityForRoute`,
// ADR-0065), sementara topik langganan menyentuh domain `support` (tiket), `lead`, dan `ide`.
// Tanpa gerbang ini satu agent token ber-read global memperoleh baca ke tiga domain yang tak
// diberikan kepadanya. Dashboard (principal cookie) adalah satu-satunya konsumen → nol fungsi
// hilang. Grup siar global tetap dilayani untuk principal mana pun — KECUALI yang ditandai
// `cookieOnly` di `services/events.ts` (SPEC-919: `presence`), yang memakai bit yang SAMA ini.
export function canSubscribeTopics(principal: WsPrincipal): boolean {
  if (principal.kind === "user") return true;
  return principal.kind === "test" && process.env.NODE_ENV === "test";
}

export function openWsConnection(principal: WsPrincipal): () => void {
  const key = `${principal.kind}:${principal.id}`;
  const count = connections.get(key) ?? 0;
  if (count >= MAX_CONNECTIONS_PER_PRINCIPAL) throw new Error("WebSocket connection limit");
  connections.set(key, count + 1);
  return () => {
    const remaining = (connections.get(key) ?? 1) - 1;
    if (remaining <= 0) connections.delete(key); else connections.set(key, remaining);
  };
}

export async function revalidateWsPrincipal(req: FastifyRequest, principal: WsPrincipal): Promise<boolean> {
  if (principal.kind === "test") return process.env.NODE_ENV === "test";
  if (principal.kind === "user") {
    const token = req.cookies?.[COOKIE_NAME];
    return !!token && (await lookupSession(token))?.id === principal.id;
  }
  if (principal.kind === "device") {
    const token = bearerToken(req);
    return !!token && (await verifyDeviceToken(token))?.id === principal.id;
  }
  return req.agent?.id === principal.id;
}

// Jendela revalidasi per socket saat frame terus berdatangan. Satu query `lookupSession` per
// detik per socket, bukan satu per keystroke; sesi yang dicabut tetap terputus dalam ≤ 1 dtk
// sejak frame berikutnya — jauh di bawah interval 60 dtk yang menjaga socket diam.
export const WS_REVALIDATE_EVERY_MS = 1_000;

export type PrincipalWatch = {
  /** Keputusan per frame, SINKRON: `false` hanya sesudah verdict "dicabut" benar-benar terbit. */
  admit(): boolean;
  /** Pemeriksaan paksa (interval 60 dtk), tanpa menggandakan yang sedang berjalan. */
  refresh(): void;
  dispose(): void;
};

/**
 * Pengawas principal satu socket terminal. Verdict dibaca SINKRON oleh `admit()`; pemeriksaannya
 * (`revalidateWsPrincipal` → Prisma) berjalan di latar dan di-throttle `everyMs`.
 *
 * Terukur di jalur lama (`await revalidateWsPrincipal` per frame, SPEC-761): dua frame beruntun
 * berlomba di Prisma dan `writeTo` kedua mendahului yang pertama — `bcdef` mendarat `bdcef` di
 * tmux pada 200 keystroke beruntun, 3 dari 3 run; satu query yang tertahan pool memakan 5 dtk dan
 * P1008 menutup socket yang sah dengan "session revoked". Urutan ke pty wajib sama dengan urutan
 * kedatangan frame, dan itu hanya terjamin bila tak ada satu pun `await` di antara keduanya.
 *
 * Pemeriksaan yang GAGAL (DB tak terjangkau, pool habis) bukan verdict: socket tetap dilayani dan
 * diperiksa lagi di frame berikutnya. Ini cermin perilaku nyata interval 60 dtk yang sudah ada —
 * penolakannya tak pernah ditangkap, hanya tercetak lewat `unhandledRejection` di server.ts —
 * jadi jendela pencabutan saat DB tumbang tak berubah, sementara terminal tak lagi mati karena
 * P1008 milik sync.
 */
export function createPrincipalWatch(opts: {
  check: () => Promise<boolean>;
  onRevoked: () => void;
  now?: () => number;
  everyMs?: number;
}): PrincipalWatch {
  const now = opts.now ?? Date.now;
  const everyMs = opts.everyMs ?? WS_REVALIDATE_EVERY_MS;
  let revoked = false;
  let disposed = false;
  let inFlight = false;
  // Jendela dihitung dari PERCOBAAN terakhir, bukan verdict terakhir: pemeriksaan yang gagal pun
  // menunggu jendelanya — DB yang sedang sakit tak boleh dihujani satu query per keystroke.
  let attemptedAt: number | null = null;
  const run = (): void => {
    if (revoked || disposed || inFlight) return;
    inFlight = true;
    attemptedAt = now();
    opts.check().then((ok) => {
      inFlight = false;
      if (disposed || revoked || ok) return;
      revoked = true;
      opts.onRevoked();
    }, () => { inFlight = false; });
  };
  return {
    admit() {
      if (revoked) return false;
      if (attemptedAt === null || now() - attemptedAt >= everyMs) run();
      return true;
    },
    refresh() { run(); },
    dispose() { disposed = true; },
  };
}

export function bearerToken(req: FastifyRequest): string | null {
  const value = req.headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : null;
}

export class WsMessageGuard {
  private count = 0;
  private resetAt = 0;

  constructor(private readonly opts: { maxBytes?: number; perWindow?: number; windowMs?: number } = {}) {}

  accept(raw: Buffer | ArrayBuffer | Buffer[], now = Date.now()):
  { ok: true } | { ok: false; code: 1008 | 1009; reason: string } {
    const bytes = Array.isArray(raw)
      ? raw.reduce((sum, part) => sum + part.byteLength, 0)
      : raw.byteLength;
    if (bytes > (this.opts.maxBytes ?? MAX_WS_MESSAGE_BYTES))
      return { ok: false, code: 1009, reason: "message too large" };
    if (now >= this.resetAt) { this.count = 0; this.resetAt = now + (this.opts.windowMs ?? 60_000); }
    this.count += 1;
    if (this.count > (this.opts.perWindow ?? 120)) return { ok: false, code: 1008, reason: "rate limit" };
    return { ok: true };
  }
}
