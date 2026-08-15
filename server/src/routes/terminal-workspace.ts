import type { FastifyInstance, FastifyReply } from "fastify";
import { zTerminalWorkspaceWrite } from "@hanoman/shared";
import {
  InvalidStoredTerminalWorkspaceError,
  readTerminalWorkspace,
  writeTerminalWorkspace,
} from "../services/terminal-workspace";

const storedInvalid = (reply: FastifyReply) =>
  reply.code(422).send({ error: "stored terminal workspace is invalid" });

export default async function terminalWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/terminal/workspace", async (request, reply) => {
    try {
      return await readTerminalWorkspace(request.user!.id);
    } catch (error) {
      if (error instanceof InvalidStoredTerminalWorkspaceError) return storedInvalid(reply);
      throw error;
    }
  });

  app.put("/terminal/workspace", async (request, reply) => {
    const parsed = zTerminalWorkspaceWrite.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await writeTerminalWorkspace(request.user!.id, parsed.data);
      if (!result.ok) {
        return reply.code(409).send({ code: "revision-conflict", current: result.current });
      }
      return result.current;
    } catch (error) {
      if (error instanceof InvalidStoredTerminalWorkspaceError) return storedInvalid(reply);
      throw error;
    }
  });
}
