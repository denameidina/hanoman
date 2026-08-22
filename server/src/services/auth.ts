import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type { UserView } from "@hanoman/shared";
import { resolveHardening } from "@hanoman/runner";
import { prisma } from "../db";
import { BoundedRateLimiter } from "./bounded-rate-limit";

// Sesi tervalidasi ditempel di request oleh gate onRequest (app.ts).
declare module "fastify" {
  interface FastifyRequest { user?: UserView }
}

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const COOKIE_NAME = "hn_session";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(hashHex, "hex");
  return key.length === want.length && timingSafeEqual(key, want);
}

export const newSessionToken = () => randomBytes(32).toString("base64url");
export const sessionId = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<string> {
  const token = newSessionToken();
  await prisma.session.create({
    data: { id: sessionId(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return token;
}
export async function lookupSession(token: string) {
  const s = await prisma.session.findUnique({ where: { id: sessionId(token) }, include: { user: true } });
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  // SPEC-617 · nonaktif ditegakkan DI SINI, bukan hanya di login: sesi yang sudah terbit hidup
  // 7 hari, jadi menutup login saja adalah pencabutan yang tak mencabut apa pun hari ini.
  if (s.user.disabled) return null;
  return {
    id: s.user.id, email: s.user.email,
    role: s.user.role as UserView["role"],
    createdAt: s.user.createdAt.toISOString(),
  };
}
export async function deleteSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId(token) } });
}
export async function deleteUserSessions(userId: string, exceptToken?: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptToken ? { id: { not: sessionId(exceptToken) } } : {}) },
  });
}

// ponytail: throttle in-memory, reset saat restart, per-proses — cukup single VPS;
// ganti ke store bersama kalau nanti multi-instance.
const fails = new BoundedRateLimiter({ windowMs: 60_000, limit: 9, maxKeys: 4_096 });
export function loginThrottle(ip: string): { blocked: boolean } {
  const state = loginStates.get(ip);
  return { blocked: !!state && state.until > Date.now() };
}
const loginStates = new Map<string, { n: number; until: number }>();
export function noteLoginFail(ip: string): void {
  const verdict = fails.hit(ip);
  loginStates.set(ip, { n: 0, until: verdict.blocked ? Date.now() + verdict.retryAfterMs : 0 });
  while (loginStates.size > 4_096) loginStates.delete(loginStates.keys().next().value!);
}
export function clearLoginFails(ip: string): void { fails.clear(ip); loginStates.delete(ip); }

/**
 * SPEC-884 · ADR-0138 · `Secure` diturunkan dari SKEMA REQUEST, bukan dari `NODE_ENV`.
 *
 * `x-forwarded-proto` sengaja dibaca LANGSUNG dari header, bukan lewat `req.protocol`: Fastify
 * hanya memercayai header itu bila `trustProxy` terisi, dan `trustProxyFromEnv` mengembalikan
 * `false` tanpa `HANOMAN_TRUST_PROXY` (`services/ingress-policy.ts:55-57`). Instance di balik TLS
 * yang tak menyetel variabel itu — bentuk hanoman lokal di balik Cloudflare Tunnel — karena itu
 * akan KEHILANGAN `Secure` yang hari ini didapatnya dari `NODE_ENV`.
 *
 * Memercayai header ini aman karena arahnya satu: menyuntiknya hanya bisa membuat cookie lebih
 * ketat. Melonggarkannya menuntut MENGHAPUS header, dan header yang absen memang berarti request
 * polos. Yang mungkin terjadi hanyalah cookie `Secure` di koneksi http — cookie tak terkirim,
 * gagal tertutup.
 */
export function cookieOpts(req: { protocol?: string; headers: Record<string, unknown> }) {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  const https = req.protocol === "https" || forwarded === "https";
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: https || resolveHardening(process.env),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
