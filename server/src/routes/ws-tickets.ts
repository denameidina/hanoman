import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { issueWsTicket } from "../services/ws-admission";

const targetSchema = z.string().refine((value) => value === "events" || value.startsWith("terminal:"));

export default async function (app: FastifyInstance, opts: { allowTestPrincipal?: boolean }) {
  app.post("/ws-tickets", async (req, reply) => {
    const parsed = z.object({ target: targetSchema }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid target" });
    const principal = req.user
      ? { kind: "user" as const, id: req.user.id }
      : req.agent
        ? { kind: "agent" as const, id: req.agent.id }
        : opts.allowTestPrincipal
          ? { kind: "test" as const, id: "test" }
          : null;
    if (!principal) return reply.code(401).send({ error: "unauthorized" });
    return { ticket: issueWsTicket(principal, parsed.data.target as "events" | `terminal:${string}`) };
  });
}
