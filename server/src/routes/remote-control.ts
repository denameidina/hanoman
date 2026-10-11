import type { FastifyInstance } from "fastify";
import { exceedingCapabilities, grantsCapability, validateRemoteGrant, zRemoteControlPut } from "@hanoman/shared";
import { remoteControlView, updateRemoteControl } from "../services/remote-control";
import { getSetting } from "../services/settings";
import { adminActor, auditAgentAdmin } from "../services/admin-audit";

// SPEC-1215 · ADR-0165 §4/§7 · grant kendali jarak jauh mesin INI.
//
// ADR-0196 · dulu COOKIE_ONLY (agen tak boleh menaikkan haknya sendiri). Kini agent token pemegang
// `remote:read` (GET) / `remote:control` (PUT) boleh memakainya, dengan pagar tak-eskalasi-diri di
// SINI: grant yang diberikan ke hub (`control.capabilities`) hanya boleh memuat capability yang
// DIMILIKI pemanggil, dan blok `logs` (mengirim transkrip/log server ke hub = data keluar) hanya
// boleh diubah pemanggil yang juga memegang `logs:write`. Pemanggil cookie tak dibatasi.
export default async function (app: FastifyInstance) {
  app.get("/remote-control", async () => remoteControlView());

  app.put("/remote-control", async (req, reply) => {
    const parsed = zRemoteControlPut.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const why = parsed.data.control ? validateRemoteGrant(parsed.data.control.capabilities) : null;
    if (why) return reply.code(400).send({ error: why });
    if (req.agent) {
      if (parsed.data.control) {
        const exceeds = exceedingCapabilities(req.agent.capabilities, parsed.data.control.capabilities);
        if (exceeds.length)
          return reply.code(403).send({ error: "grant jarak jauh tidak boleh memuat capability yang tidak dimiliki pemanggil", exceeds });
      }
      if (parsed.data.logs) {
        const now = (await getSetting()).logShipping;
        const l = parsed.data.logs;
        const changed = now.event !== l.event || now.server !== l.server || now.transcript !== l.transcript;
        if (changed && !grantsCapability(req.agent.capabilities, "logs:write"))
          return reply.code(403).send({ error: "capability required", need: "logs:write" });
      }
    }
    const view = await updateRemoteControl(parsed.data, adminActor(req));
    await auditAgentAdmin(req, "remote-control.updated", "grant kendali jarak jauh/lajur log diubah", {
      control: parsed.data.control ?? null, logs: parsed.data.logs ?? null,
    });
    return view;
  });
}
