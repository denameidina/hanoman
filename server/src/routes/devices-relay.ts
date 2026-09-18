import type { FastifyInstance } from "fastify";
import { zRelayPath, RELAY_METHODS, RELAY_REQ_TIMEOUT_MS, RELAY_SPAWN_TIMEOUT_MS, type RelayActor } from "@hanoman/shared";
import { prisma } from "../db";
import { requestRelay, RelayError, type RelayResponse } from "../services/relay/hub";
import { appendEvent } from "../services/logs/event-log";
import { relayControlFor } from "../services/relay/hub";

// SPEC-1216 · ADR-0165 §4/§6 · permukaan HTTP hub yang meneruskan aksi sesi ke klien opt-in.
// COOKIE_ONLY (top `devices`, Task 1): agen/remote tak boleh mendelegasikan aksi lintas mesin.
const STATUS_FOR: Record<RelayError["kind"], number> = {
  offline: 503, "protocol-mismatch": 409, "too-large": 413, busy: 429, protocol: 502, timeout: 504,
};

function specIdOf(path: string, body: unknown): string | undefined {
  const m = path.match(/\/specs\/([^/]+)/);
  if (m) return m[1];
  if (body && typeof body === "object" && "spec" in (body as any) && typeof (body as any).spec === "string") return (body as any).spec;
  return undefined;
}

export default async function (app: FastifyInstance) {
  app.route({
    method: [...RELAY_METHODS] as any,
    url: "/devices/:deviceId/relay/*",
    handler: async (req, reply) => {
      // Principal: gate app.ts sudah menolak req.agent/req.remote lebih dulu (route COOKIE_ONLY),
      // jadi di sini req.user wajib ada.
      if (!req.user) return reply.code(401).send({ error: "unauthorized" });
      const { deviceId } = req.params as { deviceId: string };
      const wildcard = (req.params as { "*"?: string })["*"] ?? "";
      const path = `/api/${wildcard}`;
      if (!zRelayPath.safeParse(path).success) return reply.code(400).send({ error: "path relay tak sah" });

      const hasBody = req.method !== "GET" && req.method !== "DELETE";
      const ct = req.headers["content-type"] ?? "";
      if (hasBody && req.body !== undefined && req.body !== null && !ct.includes("application/json"))
        return reply.code(415).send({ error: "content-type harus application/json", relay: "unsupported-media" });

      const device = await prisma.deviceToken.findFirst({ where: { id: deviceId, revokedAt: null } });
      const started = Date.now();
      const method = req.method as typeof RELAY_METHODS[number];
      const q = req.raw.url?.split("?")[1];
      const specId = specIdOf(path, req.body);
      const audit = (status: number, extra: Record<string, unknown> = {}) => appendEvent({
        kind: "relay.request", level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        msg: `${method} ${path} → ${status}`, specId,
        data: { deviceId, actor: { userId: req.user!.id, email: req.user!.email }, method, path, status, ms: Date.now() - started, ...extra },
      });

      if (!device) { await audit(404); return reply.code(404).send({ error: "device tak dikenal", relay: "unknown-device" }); }

      const hubOrigin = String(req.headers.origin ?? `${req.protocol}://${req.headers.host}`).slice(0, 200);
      const actor: RelayActor = { hubOrigin, userId: req.user.id, email: req.user.email };
      const timeoutMs = method === "POST" && path === "/api/terminal/sessions" ? RELAY_SPAWN_TIMEOUT_MS : RELAY_REQ_TIMEOUT_MS;

      let res: RelayResponse;
      try {
        res = await requestRelay(deviceId, {
          method, path, ...(q ? { query: q } : {}),
          ...(hasBody && req.body !== undefined ? { body: req.body } : {}), actor,
        }, { timeoutMs });
      } catch (e) {
        if (e instanceof RelayError) {
          const status = STATUS_FOR[e.kind];
          const extra = e.kind === "offline" ? { presence: relayControlFor(deviceId) ? "online" : "offline" } : {};
          await audit(status, extra);
          return reply.code(status).send({ error: e.message, relay: e.kind, ...extra });
        }
        throw e;
      }
      await audit(res.status);
      return reply.code(res.status)
        .header("content-type", res.contentType ?? "application/json")
        .header("x-hanoman-device", deviceId)
        .send(res.body);
    },
  });
}
