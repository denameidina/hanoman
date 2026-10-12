import type { FastifyRequest } from "fastify";
import {
  RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_MODE_HEADER, grantsCapability, isAccessRequestRoute, relayRouteAllowed, remoteCapabilityFor,
  zRelayActor, type RelayActor, type RemoteCapability, type RemoteControl,
} from "@hanoman/shared";
import { getSetting } from "../settings";
import { checkAgentCapability } from "../agent-capabilities";
import { isInProcessRequest, isRelaySecret } from "./secret";

export type RemoteContext = { actor: RelayActor; capabilities: RemoteCapability[]; mode: "read" | "write" };
declare module "fastify" { interface FastifyRequest { remote?: RemoteContext } }

type Verdict =
  | { ok: true; remote: RemoteContext }
  | { ok: false; status: 401 | 403; body: { error: string; need?: string } };

export const encodeRelayActor = (a: RelayActor): string => Buffer.from(JSON.stringify(a)).toString("base64url");

export function decodeRelayActor(value: unknown): RelayActor | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = zRelayActor.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

const UNAUTHORIZED = { ok: false, status: 401, body: { error: "unauthorized" } } as const;

/** Urutan disengaja: bukti in-process dan rahasia DULU (murah, tanpa DB), baru grant (DB), lalu
    allowlist SEBELUM capability — `backlog:write` sah tak boleh membuka `PATCH /specs`. */
export async function admitRemoteRequest(
  req: Pick<FastifyRequest, "headers" | "method" | "url" | "raw">,
  readGrant: () => Promise<RemoteControl> = async () => (await getSetting()).remoteControl,
): Promise<Verdict> {
  if (!isInProcessRequest(req.raw) || !isRelaySecret(req.headers[RELAY_HEADER])) return UNAUTHORIZED;
  const actor = decodeRelayActor(req.headers[RELAY_ACTOR_HEADER]);
  if (!actor) return UNAUTHORIZED;
  const grant = await readGrant();
  // ADR-0217 · dua rute permintaan tingkat dijawab 403 saat master mati, BUKAN 401: hub meneruskan 401 ke
  // klien, dan layar membacanya sebagai sesi operator habis (melempar ke Login).
  if (!grant.enabled)
    return isAccessRequestRoute(req.method, req.url)
      ? { ok: false, status: 403, body: { error: "kendali jarak jauh mati" } }
      : UNAUTHORIZED;
  if (!relayRouteAllowed(req.method, req.url)) return { ok: false, status: 403, body: { error: "relay route not allowed" } };
  const path = req.url.split("?")[0] ?? req.url;
  const mode = req.headers[RELAY_MODE_HEADER] === "read" ? "read" : "write";
  // ADR-0217 · permintaan tingkat akses TIDAK menuntut capability grant: ia hanya mengantre, dan
  // grant baru berlaku bila operator lokal menyetujuinya (route persetujuannya COOKIE_ONLY dan tak
  // ada di allowlist). Hub yang grant-nya kosong pun tetap bisa meminta Lihat.
  if (isAccessRequestRoute(req.method, req.url))
    return { ok: true, remote: { actor, capabilities: grant.capabilities, mode } };
  const override = remoteCapabilityFor(req.method, path, mode);
  if (override) {
    if (!grantsCapability(grant.capabilities, override))
      return { ok: false, status: 403, body: { error: "capability required", need: override } };
  } else {
    const verdict = checkAgentCapability(grant.capabilities, req.method, path);
    if (!verdict.ok) {
      return {
        ok: false, status: 403,
        body: verdict.reason === "cookie-only" ? { error: "cookie session required" } : { error: "capability required", need: verdict.need },
      };
    }
  }
  return { ok: true, remote: { actor, capabilities: grant.capabilities, mode } };
}
