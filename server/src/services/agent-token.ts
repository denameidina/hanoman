import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { AgentTokenView } from "@hanoman/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";

// SPEC-257 · ADR-0065 · kredensial AI agent. Hash-at-rest (pola DeviceToken/ingest-key).
// Plaintext hanya lahir & tampil sekali; DB simpan sha256(token).
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

type Row = {
  id: string; name: string; tokenPrefix: string; capabilities: unknown; projectIds: unknown; enabled: boolean;
  createdBy: string | null; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null;
};

const idsOf = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

export function toAgentTokenView(t: Row): AgentTokenView {
  return {
    id: t.id, name: t.name, tokenPrefix: t.tokenPrefix,
    capabilities: (Array.isArray(t.capabilities) ? t.capabilities : []) as AgentTokenView["capabilities"],
    projectIds: idsOf(t.projectIds),
    enabled: t.enabled, createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
  };
}

export async function issueAgentToken(input: {
  name: string; capabilities: string[]; projectIds?: string[]; createdBy?: string;
}): Promise<{ view: AgentTokenView; token: string }> {
  const token = "hnm_agt_" + randomBytes(24).toString("hex"); // 48 hex chars
  const row = await prisma.agentToken.create({
    data: {
      name: input.name, tokenHash: hash(token), tokenPrefix: token.slice(0, 16),
      capabilities: input.capabilities, createdBy: input.createdBy ?? null,
      ...(input.projectIds !== undefined ? { projectIds: input.projectIds } : {}),
    },
  });
  return { view: toAgentTokenView(row as Row), token };
}

// Lookup by hash (unique); timingSafeEqual menjaga pola konsisten dgn ingest-key.
export async function verifyAgentToken(token: string):
  Promise<{ id: string; capabilities: string[]; projectIds: string[] | null } | null> {
  if (!token) return null;
  const row = await prisma.agentToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!row || !row.enabled || row.revokedAt) return null;
  const a = Buffer.from(hash(token), "hex");
  const b = Buffer.from(row.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await prisma.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return {
    id: row.id,
    capabilities: (Array.isArray(row.capabilities) ? row.capabilities : []) as string[],
    projectIds: idsOf(row.projectIds),
  };
}

export async function listAgentTokens(): Promise<AgentTokenView[]> {
  const rows = await prisma.agentToken.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => toAgentTokenView(r as Row));
}

export async function patchAgentToken(
  id: string, patch: { name?: string; capabilities?: string[]; enabled?: boolean; projectIds?: string[] | null },
): Promise<AgentTokenView | null> {
  const row = await prisma.agentToken.findUnique({ where: { id } });
  if (!row) return null;
  const updated = await prisma.agentToken.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.capabilities !== undefined ? { capabilities: patch.capabilities } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.projectIds !== undefined
        ? { projectIds: patch.projectIds === null ? Prisma.JsonNull : patch.projectIds } : {}),
    },
  });
  return toAgentTokenView(updated as Row);
}

export async function revokeAgentToken(id: string): Promise<boolean> {
  const row = await prisma.agentToken.findUnique({ where: { id } });
  if (!row) return false;
  await prisma.agentToken.update({ where: { id }, data: { revokedAt: new Date() } });
  return true;
}
