import { randomBytes, timingSafeEqual } from "node:crypto";
import { Socket } from "node:net";

/* SPEC-1215 · ADR-0165 §3 · rahasia per PROSES yang menandai request dispatcher relay. Hanya hidup di
   memori: tak pernah ke disk, log, maupun env proses anak — itulah yang membedakannya dari token
   turunan sesi (session-event-token) yang sengaja diwariskan ke pane. */
const SECRET = randomBytes(32).toString("base64url");

export const relaySecret = (): string => SECRET;

export function isRelaySecret(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const a = Buffer.from(value);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Terukur di spike S0a: `inject` → `MockSocket`, `injectWS` → `undefined`, jaringan → `net.Socket`
    (TLS turunan `net.Socket`). Rahasia yang bocor tetap tak berguna dari jaringan. */
export function isInProcessRequest(raw: { socket?: unknown }): boolean {
  return !(raw.socket instanceof Socket);
}
