import type { FastifyInstance, FastifyRequest } from "fastify";
import { zLeadAct } from "@hanoman/shared";
import { verifySessionEventToken } from "../services/session-event-token";
import { getSessionAsync } from "../services/pty";
import { isLeadSessionId } from "../services/lead/lead-session";
import { processAct } from "../services/lead/act";
import { buildBrief } from "../services/lead/brief";
import { setBriefBuilder } from "../services/lead/courier";

// ADR-0228 · permukaan PANE LEAD. Kredensialnya token HMAC turunan per sesi (ADR-0146), pola
// `/api/session-events` — dan karena itu COOKIE_ONLY di peta capability: agen yang bisa meniru
// "pane lead proyek X" bisa menggerakkan seluruh proyek itu. Itu peniruan identitas, bukan izin.
// Proyek yang dilayani pane diambil dari pane tmux-nya sendiri, tak pernah dari body.

const bearer = (h: unknown): string => (typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : "");

async function paneOf(req: FastifyRequest): Promise<{ code: 200; projectId: string } | { code: 401 | 403 | 404; error: string }> {
  const id = String(req.headers["x-hanoman-session"] ?? "");
  const tok = bearer(req.headers.authorization);
  if (!id || !tok || !verifySessionEventToken(id, tok)) return { code: 401, error: "unauthorized" };
  if (!isLeadSessionId(id)) return { code: 403, error: "bukan pane lead" };
  const s = await getSessionAsync(id);
  if (!s || s.exited) return { code: 404, error: "pane lead tak hidup" };
  return { code: 200, projectId: s.projectId };
}

export default async function leadPane(app: FastifyInstance): Promise<void> {
  setBriefBuilder(async (p) => (await buildBrief(p)).text);

  app.get("/lead-pane/brief", async (req, reply) => {
    const p = await paneOf(req);
    if (p.code !== 200) return reply.code(p.code).send({ error: p.error });
    return buildBrief(p.projectId);
  });

  app.post("/lead-pane/act", async (req, reply) => {
    const p = await paneOf(req);
    if (p.code !== 200) return reply.code(p.code).send({ error: p.error });
    const parsed = zLeadAct.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return processAct(p.projectId, parsed.data);
  });
}
