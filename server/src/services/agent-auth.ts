import type { FastifyRequest } from "fastify";
import { verifyAgentToken } from "./agent-token";
import { getSetting } from "./settings";

// SPEC-257 · ADR-0065 · auth AI agent. Cermin req.user/req.device.
declare module "fastify" { interface FastifyRequest { agent?: { id: string; capabilities: string[] } } }

export function agentTokenFromReq(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7);
  return undefined;
}

// null bila master switch off / token invalid / disabled / revoked.
export async function authenticateAgent(token: string): Promise<{ id: string; capabilities: string[] } | null> {
  const { agentAccessEnabled } = await getSetting();
  if (!agentAccessEnabled) return null;
  return verifyAgentToken(token);
}
