import type { Spec } from "@prisma/client";
import { grantsCapability, type RelayActor } from "@hanoman/shared";
import { prisma } from "../db";

type PrincipalSource = {
  user?: { id: string; email: string } | null;
  agent?: { id: string; capabilities: string[] } | null;
  // SPEC-1216 · ADR-0165 §6 · req.remote (server/src/services/relay/gate.ts). Urutan: user → remote → agent.
  remote?: { actor: RelayActor; capabilities: string[] } | null;
};

export function launchPrincipal(source: PrincipalSource): string | null {
  if (source.user) return `user:${source.user.email}`;
  if (source.remote && grantsCapability(source.remote.capabilities, "sessions:spawn"))
    return `remote:${source.remote.actor.email}@${source.remote.actor.hubOrigin}`;
  if (source.agent && grantsCapability(source.agent.capabilities, "sessions:write"))
    return `agent:${source.agent.id}`;
  return null;
}

export async function approveLaunch(specId: string, principal: string): Promise<void> {
  await prisma.spec.updateMany({
    where: { id: specId, launchApprovedAt: null },
    data: { launchApprovedAt: new Date(), launchApprovedBy: principal },
  });
}

export function assertLaunchApproved(spec: Pick<Spec, "id" | "launchApprovedAt">): void {
  if (!spec.launchApprovedAt) throw new Error(`launch ${spec.id} belum disetujui principal sessions:write`);
}
