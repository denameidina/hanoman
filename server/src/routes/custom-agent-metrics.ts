import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentMetrics, updateAgentInvocationDisposition } from "../services/agent-invocations";

const zQuery = z.object({
  projectId: z.string().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
const zPatch = z.object({
  disposition: z.enum(["accepted", "partial", "rejected", "false-positive"]),
  note: z.string().max(500).nullable().optional(),
}).strict();

export default async function (app: FastifyInstance) {
  app.get("/custom-agents/metrics", async (req, reply) => {
    const parsed = zQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const from = parsed.data.from ? new Date(parsed.data.from) : undefined;
    const to = parsed.data.to ? new Date(parsed.data.to) : undefined;
    if (from && to && from > to) return reply.code(400).send({ error: "from harus sebelum to" });
    return agentMetrics({ projectId: parsed.data.projectId, from, to });
  });

  app.patch("/custom-agents/invocations/:id", async (req, reply) => {
    const body = zPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const id = String((req.params as { id?: string }).id ?? "");
    const view = await updateAgentInvocationDisposition(id, body.data.disposition, body.data.note);
    return view ?? reply.code(404).send({ error: "invocation tidak ditemukan" });
  });
}
