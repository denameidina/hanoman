import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { zAgentTokenCreate, zAgentTokenPatch, CAPABILITIES, exceedingCapabilities } from "@hanoman/shared";
import {
  AGENT_CREATOR_PREFIX, getAgentToken, issueAgentToken, listAgentTokens, patchAgentToken, revokeAgentToken,
} from "../services/agent-token";
import { auditAgentAdmin } from "../services/admin-audit";

// SPEC-257 · ADR-0065 · kelola agent token. Plaintext token hanya balik di POST (sekali). List &
// patch tak pernah membuka rahasia.
//
// ADR-0196 · route ini DULU cookie-only. Kini agent token pemegang `tokens:read|write` boleh
// memakainya, dengan pagar TAK-ESKALASI-DIRI yang ditegakkan DI SINI (peta route→capability tak
// melihat body, jadi tak bisa menegakkannya):
//   1. POST   · capabilities yang diminta ⊆ capability MILIK PEMANGGIL (write ⊇ read; danger hanya
//               bila pemanggil memegang persis danger itu). Token hasil cetak tak pernah lebih
//               berkuasa dari pencetaknya.
//   2. PATCH  · (a) capabilities baru ⊆ milik pemanggil; (b) token TARGET sendiri tak boleh lebih
//               berkuasa dari pemanggil — agen lemah tak boleh menonaktifkan/menurunkan token yang
//               manusia beri hak lebih besar; (c) TOKEN SENDIRI tak bisa diubah.
//   3. DELETE · (b) dan (c) yang sama. Token yang mencabut dirinya sendiri memutus kanal agen
//               tanpa pemberitahuan; manusia yang memutuskan itu di dashboard.
// Pemanggil cookie (manusia) TIDAK dibatasi apa pun — perilaku lama utuh.

const forbid = (reply: FastifyReply, error: string, extra: Record<string, unknown> = {}) =>
  reply.code(403).send({ error, ...extra });

/** `null` = lolos; selain itu respons 403 yang sudah terkirim. Hanya berlaku untuk principal agen. */
function guardTarget(
  req: FastifyRequest, reply: FastifyReply, id: string, targetCaps: readonly string[],
): FastifyReply | null {
  if (!req.agent) return null;
  if (id === req.agent.id)
    return forbid(reply, "agent token tidak boleh mengubah atau mencabut dirinya sendiri — minta manusia di dashboard", { self: true });
  const exceeds = exceedingCapabilities(req.agent.capabilities, targetCaps);
  if (exceeds.length)
    return forbid(reply, "token target lebih berkuasa dari pemanggil — hanya token yang capability-nya himpunan-bagian milik pemanggil yang boleh diubah/dicabut", { exceeds });
  return null;
}

export default async function (app: FastifyInstance) {
  // Static route sebelum "/:id" agar tak ketangkap param.
  app.get("/agent-tokens/capabilities", async () => ({ capabilities: CAPABILITIES }));

  app.get("/agent-tokens", async () => ({ items: await listAgentTokens() }));

  app.post("/agent-tokens", async (req, reply) => {
    const p = zAgentTokenCreate.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (req.agent) {
      const exceeds = exceedingCapabilities(req.agent.capabilities, p.data.capabilities);
      if (exceeds.length)
        return forbid(reply, "token baru tidak boleh memuat capability yang tidak dimiliki pemanggil", { exceeds });
    }
    const { view, token } = await issueAgentToken({
      ...p.data, capabilities: [...new Set(p.data.capabilities)],
      createdBy: req.agent ? `${AGENT_CREATOR_PREFIX}${req.agent.id}` : req.user?.id,
    });
    await auditAgentAdmin(req, "agent-token.created", `agent token "${view.name}" dicetak`, {
      tokenId: view.id, name: view.name, capabilities: view.capabilities,
    });
    return reply.code(201).send({ ...view, token });
  });

  app.patch("/agent-tokens/:id", async (req, reply) => {
    const p = zAgentTokenPatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { id } = req.params as { id: string };
    if (req.agent) {
      const target = await getAgentToken(id);
      if (!target) return reply.code(404).send({ error: "not found" });
      const denied = guardTarget(req, reply, id, target.capabilities);
      if (denied) return denied;
      if (p.data.capabilities) {
        const exceeds = exceedingCapabilities(req.agent.capabilities, p.data.capabilities);
        if (exceeds.length)
          return forbid(reply, "token tidak boleh dinaikkan melebihi capability pemanggil", { exceeds });
      }
    }
    const before = req.agent ? await getAgentToken(id) : null;
    const view = await patchAgentToken(id, p.data.capabilities
      ? { ...p.data, capabilities: [...new Set(p.data.capabilities)] } : p.data);
    if (!view) return reply.code(404).send({ error: "not found" });
    await auditAgentAdmin(req, "agent-token.updated", `agent token "${view.name}" diubah`, {
      tokenId: id, patch: p.data, before: before ? { capabilities: before.capabilities, enabled: before.enabled } : null,
    });
    return reply.send(view);
  });

  app.delete("/agent-tokens/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.agent) {
      const target = await getAgentToken(id);
      if (!target) return reply.code(404).send({ error: "not found" });
      const denied = guardTarget(req, reply, id, target.capabilities);
      if (denied) return denied;
    }
    if (!(await revokeAgentToken(id))) return reply.code(404).send({ error: "not found" });
    await auditAgentAdmin(req, "agent-token.revoked", "agent token dicabut", { tokenId: id });
    return reply.code(204).send();
  });
}
