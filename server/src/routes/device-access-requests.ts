import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ACCESS_REQUEST_UNSUPPORTED_MESSAGE, RELAY_REQ_TIMEOUT_MS, zAccessRequestCreate, type RelayActor,
} from "@hanoman/shared";
import { prisma } from "../db";
import { requestRelay, RelayError, relayControlFor } from "../services/relay/hub";
import { appendEvent } from "../services/logs/event-log";

/* ADR-0217 · opsi C dari ADR-0216, sisi HUB. Hub MEMINTA tingkat akses ke perangkat remote lewat relay;
   perangkat tujuan hanya menyimpan permintaan itu dan operator lokalnya yang memutuskan. Rute ini tak
   menerapkan apa pun ke grant perangkat tujuan. Principal = cookie manusia atau agen ber-`relay:exec`
   (capabilityForRoute: `/devices/*` → relay:exec, sama dengan relay generik). */

const STATUS_FOR: Record<RelayError["kind"], number> = {
  offline: 503, "protocol-mismatch": 409, "too-large": 413, busy: 429, protocol: 502, timeout: 504,
};

export default async function (app: FastifyInstance) {
  async function forward(req: FastifyRequest, reply: FastifyReply, deviceId: string, method: "GET" | "POST", body?: unknown) {
    const principal = req.user
      ? { id: req.user.id, email: req.user.email }
      : req.agent ? { id: `agent:${req.agent.id}`, email: `agent:${req.agent.id}` } : null;
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    const device = await prisma.deviceToken.findFirst({ where: { id: deviceId, revokedAt: null } });
    const path = "/api/remote-control/access-requests";
    const started = Date.now();
    const audit = (status: number, extra: Record<string, unknown> = {}) => appendEvent({
      kind: "relay.request", level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: `${method} ${path} → ${status}`,
      data: { deviceId, actor: { userId: principal.id, email: principal.email }, method, path, status, ms: Date.now() - started, ...extra },
    });
    if (!device) {
      await audit(404, { relay: "unknown-device" });
      return reply.code(404).send({ error: "device tak dikenal", relay: "unknown-device" });
    }
    const hubOrigin = String(req.headers.origin ?? `${req.protocol}://${req.headers.host}`).slice(0, 200);
    const actor: RelayActor = { hubOrigin, userId: principal.id, email: principal.email };
    try {
      const res = await requestRelay(deviceId, { method, path, actor, ...(body !== undefined ? { body } : {}) }, { timeoutMs: RELAY_REQ_TIMEOUT_MS });
      // Perangkat yang belum memuat ADR-0217 menolak rute ini di allowlist-nya (403 "relay route not
      // allowed"). Itu BUKAN galat permintaan: beri tahu operator dengan jelas, jangan biarkan 403 membingungkan.
      if (res.status === 403 && res.body.includes(ACCESS_REQUEST_UNSUPPORTED_MESSAGE)) {
        await audit(409, { relay: "unsupported-message" });
        return reply.code(409).send({
          error: "perangkat ini belum mendukung permintaan tingkat akses; perbarui hanoman di perangkat itu",
          relay: "unsupported-message", presence: relayControlFor(deviceId) ? "online" : "offline",
        });
      }
      // 401 dari perangkat = relay-nya menolak sesi (bukan sesi operator di hub ini). Diteruskan apa adanya,
      // klien membacanya sebagai sesi habis dan melempar operator ke Login. Maka dipetakan ke 502.
      if (res.status === 401) {
        await audit(502, { relay: "device-unauthorized" });
        return reply.code(502).send({
          error: "perangkat menolak sesi relay; periksa kendali jarak jauh di perangkat itu",
          relay: "device-unauthorized",
        });
      }
      await audit(res.status);
      return reply.code(res.status).header("content-type", res.contentType ?? "application/json")
        .header("x-hanoman-device", deviceId).send(res.body);
    } catch (e) {
      if (e instanceof RelayError) {
        const status = STATUS_FOR[e.kind];
        const extra = e.kind === "offline" ? { presence: relayControlFor(deviceId) ? "online" : "offline" } : {};
        await audit(status, { relay: e.kind, ...extra });
        return reply.code(status).send({ error: e.message, relay: e.kind, ...extra });
      }
      throw e;
    }
  }

  app.post("/devices/:deviceId/access-requests", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const parsed = zAccessRequestCreate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return forward(req, reply, deviceId, "POST", parsed.data);
  });

  app.get("/devices/:deviceId/access-requests", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    return forward(req, reply, deviceId, "GET");
  });
}
