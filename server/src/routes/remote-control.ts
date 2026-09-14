import type { FastifyInstance } from "fastify";
import { validateRemoteGrant, zRemoteControlPut } from "@hanoman/shared";
import { remoteControlView, updateRemoteControl } from "../services/remote-control";

// SPEC-1215 · ADR-0165 §4/§7 · grant kendali jarak jauh mesin INI. COOKIE_ONLY (top `remote-control`):
// agent token maupun principal `remote` tak boleh menaikkan haknya sendiri (cermin /agent-tokens).
export default async function (app: FastifyInstance) {
  app.get("/remote-control", async () => remoteControlView());

  app.put("/remote-control", async (req, reply) => {
    const parsed = zRemoteControlPut.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const why = parsed.data.control ? validateRemoteGrant(parsed.data.control.capabilities) : null;
    if (why) return reply.code(400).send({ error: why });
    return updateRemoteControl(parsed.data, req.user?.email ?? "unknown");
  });
}
