import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { zIssueDeviceToken, type DeviceTokenView } from "@hanoman/shared";
import { prisma } from "../db";
import { issueDeviceToken, revokeDeviceToken } from "../services/device-token";
import { closeDeviceSockets } from "../services/device-sockets";
import { agentOwnerUserId } from "../services/agent-token";
import { auditAgentAdmin } from "../services/admin-audit";

// SPEC-213 · ADR-0044 · kelola device token. Plaintext token hanya balik di POST (sekali). List &
// revoke tak pernah membuka rahasia.
//
// ADR-0197 · dulu cookie-only. Agent token pemegang `devices:read|write` kini boleh memakainya, TAPI
// device token adalah identitas MESIN milik sebuah akun (`DeviceToken.userId`) — agen tak punya akun.
// Pemilik dalam konteks agen = akun admin yang menerbitkan agent token itu (`AgentToken.createdBy`,
// menelusuri rantai `agent:<id>`). Tanpa pemilik manusia → 409, bukan diam-diam memilih akun lain.
// Agen hanya melihat/mencabut token MILIK pemilik itu; token akun lain tampak 404.
const view = (t: {
  id: string; name: string; createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null;
}): DeviceTokenView => ({
  id: t.id, name: t.name, createdAt: t.createdAt.toISOString(),
  lastSeenAt: t.lastSeenAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null,
});

/** Id akun pemilik untuk request ini, atau `null` setelah membalas 409. */
async function ownerId(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  if (req.user) return req.user.id;
  if (req.agent) {
    const owner = await agentOwnerUserId(req.agent.id);
    if (owner) return owner;
    reply.code(409).send({ error: "agent token ini tak punya akun admin penerbit — device token dicetak atas nama sebuah akun" });
    return null;
  }
  reply.code(401).send({ error: "unauthorized" });
  return null;
}

export default async function (app: FastifyInstance) {
  app.get("/device-tokens", async (req, reply) => {
    const userId = await ownerId(req, reply);
    if (!userId) return reply;
    return (await prisma.deviceToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(view);
  });

  app.post("/device-tokens", async (req, reply) => {
    const p = zIssueDeviceToken.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const userId = await ownerId(req, reply);
    if (!userId) return reply;
    const issued = await issueDeviceToken(userId, p.data.name);
    await auditAgentAdmin(req, "device-token.created", `device token "${issued.name}" dicetak`, {
      deviceId: issued.id, name: issued.name, userId,
    });
    return reply.code(201).send(issued);
  });

  app.delete("/device-tokens/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.agent) {
      const userId = await ownerId(req, reply);
      if (!userId) return reply;
      const row = await prisma.deviceToken.findUnique({ where: { id } });
      if (!row || row.userId !== userId) return reply.code(404).send({ error: "not found" });
    }
    if (!(await revokeDeviceToken(id))) return reply.code(404).send({ error: "not found" });
    // SPEC-1215 · ADR-0165 §7 · SESUDAH revokedAt tertulis (reconnect langsung 401) dan SEBELUM 204:
    // socket sync + relay device ini ditutup sekarang, tak menunggu revalidasi 60 dtk.
    closeDeviceSockets(id, 1008, "token revoked");
    await auditAgentAdmin(req, "device-token.revoked", "device token dicabut", { deviceId: id });
    return reply.code(204).send();
  });
}
